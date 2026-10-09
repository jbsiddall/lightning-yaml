'use strict';

// Audited, primitive-only lowering of Dafny compiler output. Keep this pass
// fail-closed: the checked manifest pins callsites, static literal getters,
// class members and every internal method rename.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(__dirname, 'dafny-shape-manifest.json');
const IDENTITY_NAMES = [
  'boolValue', 'booleanValue', 'mapFromValue', 'mapValue', 'numberAsCounter',
  'numberValue', 'setValue', 'stringValue', 'stringValueOf',
];
const SIMPLE_NATIVE_NAMES = ['concat', 'numberAdd', 'numberLessEqual', 'numberMulAdd', 'numberNegate', 'slice', 'stringLength'];
const KEEP_METHODS = {
  Engine: new Set(['__ctor', 'Reset', 'EndStream', 'ParseSingle', 'ParseAll', 'IsDocMarkerAt',
    'ConsumeDocStartMarker', 'ConsumeDocEndMarker', 'ParseNextDocument']),
  Writer: new Set(['__ctor', 'Stringify']),
};

function sha256(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function unparen(node) { while (ts.isParenthesizedExpression(node)) node = node.expression; return node; }
function peelCasts(node) {
  while (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
}
function parse(text, filename = 'generated.js') {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (source.parseDiagnostics.length) throw new Error('shape transform received invalid JavaScript');
  return source;
}
function visitClass(node, callback) {
  function walk(current, moduleName = '') {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name) && ['DafnyCore', 'Serializer', 'TagValues'].includes(current.name.text)) {
      ts.forEachChild(current, child => walk(child, current.name.text));
      return;
    }
    if (moduleName && ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(current.left) && ts.isIdentifier(current.left.expression) && current.left.expression.text === '$module' &&
        (ts.isClassExpression(current.right) || ts.isClassDeclaration(current.right))) {
      callback(current.right, moduleName, current.left.name.text);
    }
    ts.forEachChild(current, child => walk(child, moduleName));
  }
  walk(node);
}

function nativeIdentityInventory(nativeText) {
  const source = ts.createSourceFile('native.ts', nativeText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = source.statements.find(statement => ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => ts.isIdentifier(item.name) && item.name.text === 'Native'));
  if (!declaration) throw new Error('Native declaration missing');
  const binding = declaration.declarationList.declarations.find(item => ts.isIdentifier(item.name) && item.name.text === 'Native');
  const frozen = unparen(binding.initializer);
  if (!ts.isCallExpression(frozen) || frozen.expression.getText(source) !== 'Object.freeze') throw new Error('Native freeze shape changed');
  const host = unparen(frozen.arguments[0]);
  const property = host.properties.find(item => ts.isPropertyAssignment(item) && item.name.getText(source) === '__default');
  const hostFreeze = unparen(property?.initializer);
  if (!ts.isCallExpression(hostFreeze) || hostFreeze.expression.getText(source) !== 'Object.freeze') throw new Error('Native.__default freeze shape changed');
  const object = unparen(hostFreeze.arguments[0]);
  const shapes = Object.create(null);
  for (const method of object.properties) {
    if (!ts.isMethodDeclaration(method) || !ts.isIdentifier(method.name) || !IDENTITY_NAMES.includes(method.name.text)) continue;
    if (method.parameters.length !== 1 || !ts.isIdentifier(method.parameters[0].name) || !method.body || method.body.statements.length !== 1 ||
        !ts.isReturnStatement(method.body.statements[0]) || !method.body.statements[0].expression) throw new Error(`Native.${method.name.text} is not a single-return cast`);
    const returned = peelCasts(method.body.statements[0].expression);
    if (!ts.isIdentifier(returned) || returned.text !== method.parameters[0].name.text) throw new Error(`Native.${method.name.text} is not an identity cast`);
    shapes[method.name.text] = method.parameters[0].name.text;
  }
  if (Object.keys(shapes).length !== IDENTITY_NAMES.length) throw new Error('Native identity helper inventory changed');
  const simpleMethods = object.properties.filter(item => ts.isMethodDeclaration(item) && ts.isIdentifier(item.name) && SIMPLE_NATIVE_NAMES.includes(item.name.text));
  if (simpleMethods.length !== SIMPLE_NATIVE_NAMES.length) throw new Error('Native simple-expression helper inventory changed');
  for (const method of simpleMethods) validateNativeSimpleBody(method, source);
  return shapes;
}

function isParam(node, params, index) {
  node = peelCasts(node);
  return ts.isIdentifier(node) && ts.isIdentifier(params[index]?.name) && node.text === params[index].name.text;
}
function binary(node, operator, left, right, params) {
  return ts.isBinaryExpression(node) && node.operatorToken.kind === operator && isParam(node.left, params, left) && isParam(node.right, params, right);
}
function validateNativeSimpleBody(method, source) {
  if (!method.body || method.body.statements.length !== 1 || !ts.isReturnStatement(method.body.statements[0]) || !method.body.statements[0].expression) throw new Error(`Native.${method.name.text} body is not a single expression`);
  const expr = method.body.statements[0].expression;
  const params = method.parameters;
  let valid = false;
  switch (method.name.text) {
    case 'numberMulAdd': {
      const value = peelCasts(expr);
      valid = params.length === 3 && ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken &&
        binary(value.left, ts.SyntaxKind.AsteriskToken, 0, 1, params) && isParam(value.right, params, 2);
      break;
    }
    case 'numberNegate': {
      const value = peelCasts(expr);
      valid = params.length === 1 && ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.MinusToken && isParam(value.operand, params, 0);
      break;
    }
    case 'numberAdd': valid = params.length === 2 && binary(expr, ts.SyntaxKind.PlusToken, 0, 1, params); break;
    case 'numberLessEqual': valid = params.length === 2 && binary(expr, ts.SyntaxKind.LessThanEqualsToken, 0, 1, params); break;
    case 'concat': valid = params.length === 2 && binary(expr, ts.SyntaxKind.PlusToken, 0, 1, params); break;
    case 'slice': {
      const value = peelCasts(expr);
      valid = params.length === 3 && ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) && value.expression.name.text === 'slice' &&
        isParam(value.expression.expression, params, 0) && value.arguments.length === 2 && isParam(value.arguments[0], params, 1) && isParam(value.arguments[1], params, 2);
      break;
    }
    case 'stringLength': {
      const value = peelCasts(expr);
      valid = params.length === 1 && ts.isPropertyAccessExpression(value) && value.name.text === 'length' && isParam(value.expression, params, 0);
      break;
    }
  }
  if (!valid) throw new Error(`Native.${method.name.text} body no longer matches its audited primitive expression`);
}

function isSimpleArgument(node) {
  node = unparen(node);
  return ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node) || node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword;
}

function gatherSimpleNativeSites(source) {
  const calls = Object.create(null), inline = Object.create(null);
  function walk(node, className = '', methodName = '') {
    if (ts.isClassExpression(node) || ts.isClassDeclaration(node)) className = node.name?.text || className;
    if (ts.isMethodDeclaration(node)) methodName = node.name?.getText(source) || methodName;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.expression.getText(source) === 'Native' &&
        node.expression.expression.name.text === '__default' && SIMPLE_NATIVE_NAMES.includes(node.expression.name.text)) {
      const name = node.expression.name.text, site = `${className}.${methodName}`;
      calls[name] ||= Object.create(null);
      calls[name][site] = (calls[name][site] || 0) + 1;
      if (node.arguments.every(isSimpleArgument)) {
        inline[name] ||= Object.create(null);
        inline[name][site] = (inline[name][site] || 0) + 1;
      }
    }
    ts.forEachChild(node, child => walk(child, className, methodName));
  }
  walk(source);
  return { calls, inline };
}

function gatherIdentitySites(source) {
  const sites = Object.create(null);
  function walk(node, moduleName = '', className = '', methodName = '') {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ['DafnyCore', 'Serializer', 'TagValues'].includes(node.name.text)) moduleName = node.name.text;
    if (ts.isClassExpression(node) || ts.isClassDeclaration(node)) className = node.name?.text || className;
    if (ts.isMethodDeclaration(node)) methodName = node.name?.getText(source) || methodName;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.expression.getText(source) === 'Native' &&
        node.expression.expression.name.text === '__default' && IDENTITY_NAMES.includes(node.expression.name.text)) {
      const name = node.expression.name.text;
      if (node.arguments.length !== 1) throw new Error(`Native.${name} call arity changed`);
      const site = `${moduleName}.${className}.${methodName}`;
      sites[name] ||= Object.create(null);
      sites[name][site] = (sites[name][site] || 0) + 1;
    }
    ts.forEachChild(node, child => walk(child, moduleName, className, methodName));
  }
  walk(source);
  return sites;
}

function discoverGetters(source) {
  const getters = Object.create(null);
  function collect(node, moduleName = '') {
    visitClass(node, (klass, owner, name) => {
      if (!['TagValues', 'Serializer'].includes(owner) || name !== '__default') return;
      const className = `${owner}.__default`;
      for (const member of klass.members) {
        if (!ts.isGetAccessorDeclaration(member) || !member.modifiers?.some(mod => mod.kind === ts.SyntaxKind.StaticKeyword) || !member.body) continue;
        if (member.body.statements.length !== 1 || !ts.isReturnStatement(member.body.statements[0]) || !member.body.statements[0].expression) throw new Error(`unexpected static getter body ${className}.${member.name.getText(source)}`);
        const literal = member.body.statements[0].expression;
        if (!ts.isNumericLiteral(literal) && !ts.isStringLiteral(literal)) throw new Error(`nonliteral static getter ${className}.${member.name.getText(source)}`);
        getters[`${className}.${member.name.getText(source)}`] = {
          kind: ts.isNumericLiteral(literal) ? 'number' : 'string',
          value: literal.text,
          uses: 0,
        };
      }
    });
    ts.forEachChild(node, child => collect(child, moduleName));
  }
  collect(source);
  for (const node of walkNodes(source)) {
    if (!ts.isPropertyAccessExpression(node)) continue;
    const key = node.getText(source);
    if (Object.hasOwn(getters, key)) getters[key].uses++;
  }
  return getters;
}

function discoverCharCodeSites(source) {
  const sites = Object.create(null);
  const allowedReceivers = new Set(['_this.src', 's', 'text', 'expected', '_0_handle']);
  function walk(node, className = '', methodName = '') {
    if (ts.isClassExpression(node) || ts.isClassDeclaration(node)) className = node.name?.text || className;
    if (ts.isMethodDeclaration(node)) methodName = node.name?.getText(source) || methodName;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'charCodeAt' &&
        node.arguments.length === 1 && ts.isNumericLiteral(node.arguments[0]) && node.arguments[0].text === '0') {
      const indexed = unparen(node.expression.expression);
      if (ts.isElementAccessExpression(indexed) && indexed.argumentExpression && indexed.expression) {
        const receiver = unparen(indexed.expression);
        const receiverName = ts.isPropertyAccessExpression(receiver) ? receiver.getText(source) : ts.isIdentifier(receiver) ? receiver.text : '';
        if (!allowedReceivers.has(receiverName)) throw new Error(`unsupported indexed-string charCodeAt receiver ${receiverName || receiver.getText(source)}`);
        const site = `${className}.${methodName}`;
        sites[site] ||= Object.create(null);
        sites[site][receiverName] = (sites[site][receiverName] || 0) + 1;
      }
    }
    ts.forEachChild(node, child => walk(child, className, methodName));
  }
  walk(source);
  return sites;
}
function* walkNodes(root) { yield root; for (const child of root.getChildren()) yield* walkNodes(child); }

function discoverMethods(source) {
  const methods = Object.create(null);
  for (const statement of source.statements) visitClass(statement, (klass, moduleName, className) => {
    if (!['DafnyCore.Engine', 'Serializer.Writer'].includes(`${moduleName}.${className}`)) return;
    const map = Object.create(null);
    let next = 0;
    for (const member of klass.members) {
      if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name)) continue;
      const original = member.name.text;
      if (original === '_parentTraits') continue;
      if (map[original] !== undefined) throw new Error(`duplicate ${className} method ${original}`);
      if (KEEP_METHODS[className]?.has(original)) map[original] = original;
      else map[original] = `m${(next++).toString(36)}`;
    }
    methods[`${moduleName}.${className}`] = map;
  });
  return methods;
}

function discoverMethodAccessSites(source, methodMaps) {
  const shortMaps = Object.fromEntries(Object.entries(methodMaps).map(([classPath, map]) => [classPath.split('.').at(-1), map]));
  const internalNames = new Set(Object.entries(shortMaps).flatMap(([, map]) => Object.keys(map).filter(name => map[name] !== name)));
  const accesses = Object.fromEntries(Object.keys(shortMaps).map(name => [name, Object.create(null)]));
  function walk(node, className = '') {
    if ((ts.isClassExpression(node) || ts.isClassDeclaration(node)) && node.name && shortMaps[node.name.text]) className = node.name.text;
    const mapped = shortMaps[className];
    if (mapped && ts.isPropertyAccessExpression(node) && mapped[node.name.text] && mapped[node.name.text] !== node.name.text) {
      const receiver = unparen(node.expression);
      if (!(ts.isIdentifier(receiver) && ['_this', 'this'].includes(receiver.text))) throw new Error(`unsupported escaped ${className}.${node.name.text} reference`);
      accesses[className][node.name.text] = (accesses[className][node.name.text] || 0) + 1;
    } else if (!mapped && ts.isPropertyAccessExpression(node) && internalNames.has(node.name.text)) {
      throw new Error(`internal method reference escaped Engine/Writer class: ${node.name.text}`);
    }
    ts.forEachChild(node, child => walk(child, className));
  }
  walk(source);
  return accesses;
}

function discoverMetadata(source) {
  let parentTraits = 0, typeNames = 0, otherRefs = 0;
  function walk(node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(source) === '_parentTraits') {
      if (!node.body || node.body.statements.length !== 1 || !ts.isReturnStatement(node.body.statements[0]) ||
          !node.body.statements[0].expression || !ts.isArrayLiteralExpression(node.body.statements[0].expression) || node.body.statements[0].expression.elements.length !== 0) throw new Error('unexpected _parentTraits method');
      parentTraits++;
      return;
    }
    if (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression) && node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.expression.left) && node.expression.left.name.text === '_tname' && ts.isStringLiteral(node.expression.right)) {
      typeNames++;
      return;
    }
    if (ts.isPropertyAccessExpression(node) && ['_parentTraits', '_tname'].includes(node.name.text)) otherRefs++;
    ts.forEachChild(node, walk);
  }
  walk(source);
  return { parentTraits, typeNames, otherRefs };
}

function createManifest(generatedText, nativeText) {
  const source = parse(generatedText);
  const native = nativeIdentityInventory(nativeText);
  const methods = discoverMethods(source);
  const methodAccessSites = discoverMethodAccessSites(source, methods);
  return {
    version: 1,
    nativeSha256: sha256(nativeText),
    nativeIdentityHelpers: Object.keys(native).sort(),
    identitySites: gatherIdentitySites(source),
    simpleNativeSites: gatherSimpleNativeSites(source),
    charCodeSites: discoverCharCodeSites(source),
    getters: discoverGetters(source),
    metadata: discoverMetadata(source),
    methodRenames: methods,
    methodAccessSites,
  };
}

function validateManifest(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('generated output shape differs from scripts/dafny-shape-manifest.json; review and update the pinned shape manifest');
  if (actual.metadata.parentTraits !== 6 || actual.metadata.typeNames !== 6 || actual.metadata.otherRefs !== 0) throw new Error('unsupported Dafny reflection metadata shape');
  for (const [className, map] of Object.entries(actual.methodRenames)) {
    if (!Object.values(map).includes('m0')) throw new Error(`${className} has no mapped internal method`);
    if (new Set(Object.values(map)).size !== Object.keys(map).length) throw new Error(`${className} method mangling collides`);
  }
}

function printerTransform(source, transformer) {
  const result = ts.transform(source, [transformer]);
  if (!ts.isSourceFile(result.transformed[0])) throw new Error(`shape pass returned ${ts.SyntaxKind[result.transformed[0]?.kind] || typeof result.transformed[0]} instead of a SourceFile`);
  const text = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(result.transformed[0]);
  result.dispose();
  return text;
}

function inlineIdentityCalls(text, expectedSites) {
  const source = parse(text);
  const actualSites = gatherIdentitySites(source);
  if (JSON.stringify(actualSites) !== JSON.stringify(expectedSites)) throw new Error('identity cast callsites changed');
  return printerTransform(source, context => root => {
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.expression.getText(source) === 'Native' &&
          node.expression.expression.name.text === '__default' && IDENTITY_NAMES.includes(node.expression.name.text)) {
        return ts.visitNode(node.arguments[0], visit);
      }
      return ts.visitEachChild(node, visit, context);
    }
    return ts.visitNode(root, visit);
  });
}

function inlineStaticGetters(text, expectedGetters) {
  const source = parse(text);
  const actual = discoverGetters(source);
  if (JSON.stringify(actual) !== JSON.stringify(expectedGetters)) throw new Error('literal static getter inventory or usage changed');
  return printerTransform(source, context => root => {
    function visit(node) {
      if (ts.isPropertyAccessExpression(node)) {
        const getter = expectedGetters[node.getText(source)];
        if (getter) return getter.kind === 'number' ? ts.factory.createNumericLiteral(getter.value) : ts.factory.createStringLiteral(getter.value);
      }
      return ts.visitEachChild(node, visit, context);
    }
    return ts.visitNode(root, visit);
  });
}

function inlineSimpleNativeExpressions(text, expectedSites) {
  const source = parse(text);
  const actualSites = gatherSimpleNativeSites(source);
  if (JSON.stringify(actualSites) !== JSON.stringify(expectedSites)) throw new Error('simple Native expression callsites changed');
  return printerTransform(source, context => root => {
    function visit(node, className = '', methodName = '') {
      if (ts.isClassExpression(node) || ts.isClassDeclaration(node)) className = node.name?.text || className;
      if (ts.isMethodDeclaration(node)) methodName = node.name?.getText(source) || methodName;
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.expression.getText(source) === 'Native' &&
          node.expression.expression.name.text === '__default' && SIMPLE_NATIVE_NAMES.includes(node.expression.name.text) && node.arguments.every(isSimpleArgument)) {
        const name = node.expression.name.text;
        const args = node.arguments.map(arg => ts.visitNode(arg, child => visit(child, className, methodName)));
        const left = args[0];
        switch (name) {
          case 'numberMulAdd':
            return ts.factory.createBinaryExpression(ts.factory.createBinaryExpression(left, ts.SyntaxKind.AsteriskToken, args[1]), ts.SyntaxKind.PlusToken, args[2]);
          case 'numberNegate': return ts.factory.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, left);
          case 'numberAdd': case 'concat': return ts.factory.createBinaryExpression(left, ts.SyntaxKind.PlusToken, args[1]);
          case 'numberLessEqual': return ts.factory.createBinaryExpression(left, ts.SyntaxKind.LessThanEqualsToken, args[1]);
          case 'slice': return ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(left, 'slice'), undefined, args.slice(1));
          case 'stringLength': return ts.factory.createPropertyAccessExpression(left, 'length');
        }
      }
      return ts.visitEachChild(node, child => visit(child, className, methodName), context);
    }
    return ts.visitNode(root, node => visit(node));
  });
}

function inlineIndexedStringCodeUnits(text, expectedSites) {
  const source = parse(text);
  const actualSites = discoverCharCodeSites(source);
  if (JSON.stringify(actualSites) !== JSON.stringify(expectedSites)) throw new Error('indexed-string charCodeAt site inventory changed');
  return printerTransform(source, context => root => {
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'charCodeAt' &&
          node.arguments.length === 1 && ts.isNumericLiteral(node.arguments[0]) && node.arguments[0].text === '0') {
        const indexed = unparen(node.expression.expression);
        if (ts.isElementAccessExpression(indexed) && indexed.argumentExpression) {
          const receiver = unparen(indexed.expression);
          return ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(receiver, 'charCodeAt'), undefined,
            [ts.visitNode(indexed.argumentExpression, visit)]);
        }
      }
      return ts.visitEachChild(node, visit, context);
    }
    return ts.visitNode(root, visit);
  });
}

function removeReflectionMetadata(text, expected) {
  const source = parse(text);
  const actual = discoverMetadata(source);
  if (JSON.stringify(actual) !== JSON.stringify(expected) || actual.otherRefs !== 0) throw new Error('reflection metadata shape or references changed');
  let parentTraits = 0, typeNames = 0;
  return printerTransform(source, context => {
    function visit(node) {
      if (ts.isMethodDeclaration(node) && node.name.getText(source) === '_parentTraits') { parentTraits++; return undefined; }
      if (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression) && ts.isPropertyAccessExpression(node.expression.left) && node.expression.left.name.text === '_tname') { typeNames++; return undefined; }
      return ts.visitEachChild(node, visit, context);
    }
    return root => {
      const output = ts.visitNode(root, visit);
      if (parentTraits !== expected.parentTraits || typeNames !== expected.typeNames) throw new Error('metadata removal count changed');
      return output;
    };
  });
}

function mangleInternalMethods(text, expectedMaps, expectedAccessSites) {
  const source = parse(text);
  const actualMaps = discoverMethods(source);
  if (JSON.stringify(actualMaps) !== JSON.stringify(expectedMaps)) throw new Error('class method inventory changed');
  const actualAccessSites = discoverMethodAccessSites(source, expectedMaps);
  if (JSON.stringify(actualAccessSites) !== JSON.stringify(expectedAccessSites)) throw new Error('internal method accesssite inventory changed');
  const renameMaps = Object.fromEntries(Object.entries(expectedMaps).map(([pathName, map]) => [pathName.split('.').at(-1), map]));
  const accessCounts = Object.fromEntries(Object.keys(renameMaps).map(name => [name, Object.create(null)]));
  const transformed = printerTransform(source, context => root => {
    function visit(node, className = '') {
      if ((ts.isClassExpression(node) || ts.isClassDeclaration(node)) && node.name && renameMaps[node.name.text]) className = node.name.text;
      const map = renameMaps[className];
      if (map && ts.isPropertyAccessExpression(node) && map[node.name.text] && map[node.name.text] !== node.name.text) {
        const receiver = unparen(node.expression);
        if (!(ts.isIdentifier(receiver) && ['_this', 'this'].includes(receiver.text))) throw new Error(`unsupported escaped ${className}.${node.name.text} reference`);
        accessCounts[className][node.name.text] = (accessCounts[className][node.name.text] || 0) + 1;
        const expr = ts.visitNode(node.expression, child => visit(child, className));
        return ts.factory.updatePropertyAccessExpression(node, expr, ts.factory.createIdentifier(map[node.name.text]));
      }
      if (map && ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && map[node.name.text] && map[node.name.text] !== node.name.text) {
        const visited = ts.visitEachChild(node, child => visit(child, className), context);
        return ts.factory.updateMethodDeclaration(visited, visited.modifiers, visited.asteriskToken, ts.factory.createIdentifier(map[node.name.text]),
          visited.questionToken, visited.typeParameters, visited.parameters, visited.type, visited.body);
      }
      return ts.visitEachChild(node, child => visit(child, className), context);
    }
    return ts.visitNode(root, node => visit(node));
  });
  if (JSON.stringify(accessCounts) !== JSON.stringify(expectedAccessSites)) throw new Error('internal method access lowering count changed');
  return { text: transformed, accessCounts };
}

function transformGenerated(generatedText, nativeText) {
  const source = parse(generatedText);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const actual = createManifest(generatedText, nativeText);
  validateManifest(actual, manifest);
  let transformed = inlineIdentityCalls(generatedText, manifest.identitySites);
  transformed = inlineSimpleNativeExpressions(transformed, manifest.simpleNativeSites);
  transformed = inlineIndexedStringCodeUnits(transformed, manifest.charCodeSites);
  transformed = inlineStaticGetters(transformed, manifest.getters);
  transformed = removeReflectionMetadata(transformed, manifest.metadata);
  const renamed = mangleInternalMethods(transformed, manifest.methodRenames, manifest.methodAccessSites);
  return { text: renamed.text, methodAccessCounts: renamed.accessCounts };
}

if (require.main === module && process.argv.includes('--write-manifest')) {
  const generatedPath = path.join(ROOT, 'src/dafny/generated/engine.js');
  const nativePath = path.join(ROOT, 'src/dafny/native.ts');
  const manifest = createManifest(fs.readFileSync(generatedPath, 'utf8'), fs.readFileSync(nativePath, 'utf8'));
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  process.stdout.write(`Wrote ${path.relative(ROOT, MANIFEST_PATH)}\n`);
}

module.exports = {
  transformGenerated,
  createManifest,
  nativeIdentityInventory,
  validateNativeSimpleBody,
  discoverCharCodeSites,
};
