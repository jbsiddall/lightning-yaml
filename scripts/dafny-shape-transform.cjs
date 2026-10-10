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
const SIMPLE_NATIVE_NAMES = [
  'arrayGet', 'arrayLength', 'concat', 'isArray', 'isBoolean', 'isNull', 'isNumber', 'isObject', 'isString', 'isUndefined',
  'jsEqual', 'mapGet', 'mapHas', 'mapSize', 'numberAdd', 'numberLessEqual', 'numberMulAdd', 'numberNegate',
  'objectGet', 'setHas', 'slice', 'stringLength',
];
const VOID_NATIVE_NAMES = ['arrayPush', 'arraySet', 'mapSet', 'setAdd'];
const KEEP_METHODS = {
  Engine: new Set(['__ctor', 'Reset', 'EndStream', 'ParseSingle', 'ParseAll', 'IsDocMarkerAt',
    'ConsumeDocStartMarker', 'ConsumeDocEndMarker', 'ParseNextDocument']),
  Writer: new Set(['__ctor', 'Stringify']),
};
// Runtime fields inspected by the generated-parser diagnostic tests are part
// of the test ABI. Other Engine/Writer state stays per-instance but is private
// to the generated implementation and may receive short property names.
const KEEP_FIELDS = { Engine: new Set(['pos', 'len', 'src', 'lineStart']), Writer: new Set() };
const REMOVED_METADATA_FIELDS = new Set(['_tname']);

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
  const voidMethods = object.properties.filter(item => ts.isMethodDeclaration(item) && ts.isIdentifier(item.name) && VOID_NATIVE_NAMES.includes(item.name.text));
  if (simpleMethods.length !== SIMPLE_NATIVE_NAMES.length || voidMethods.length !== VOID_NATIVE_NAMES.length) throw new Error('Native primitive helper inventory changed');
  for (const method of simpleMethods) validateNativeSimpleBody(method, source);
  for (const method of voidMethods) validateNativeVoidBody(method, source);
  return shapes;
}

function isParam(node, params, index) {
  node = peelCasts(node);
  return ts.isIdentifier(node) && ts.isIdentifier(params[index]?.name) && node.text === params[index].name.text;
}
function binary(node, operator, left, right, params) {
  return ts.isBinaryExpression(node) && node.operatorToken.kind === operator && isParam(node.left, params, left) && isParam(node.right, params, right);
}
function typeofComparison(node, operator, type, params, index = 0) {
  return ts.isBinaryExpression(node) && node.operatorToken.kind === operator && ts.isTypeOfExpression(peelCasts(node.left)) &&
    isParam(node.left.expression, params, index) && ts.isStringLiteral(node.right) && node.right.text === type;
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
    case 'arrayGet': case 'objectGet': {
      const value = peelCasts(expr);
      valid = params.length === 2 && ts.isElementAccessExpression(value) && isParam(value.expression, params, 0) && isParam(value.argumentExpression, params, 1);
      break;
    }
    case 'arrayLength': case 'mapSize': {
      const value = peelCasts(expr);
      valid = params.length === 1 && ts.isPropertyAccessExpression(value) && value.name.text === (method.name.text === 'arrayLength' ? 'length' : 'size') && isParam(value.expression, params, 0);
      break;
    }
    case 'mapGet': case 'mapHas': case 'setHas': {
      const value = peelCasts(expr);
      const expected = method.name.text === 'mapGet' ? 'get' : 'has';
      valid = params.length === 2 && ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) && value.expression.name.text === expected &&
        isParam(value.expression.expression, params, 0) && value.arguments.length === 1 && isParam(value.arguments[0], params, 1);
      break;
    }
    case 'isNull': case 'isUndefined':
      valid = params.length === 1 && ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
        isParam(expr.left, params, 0) && (method.name.text === 'isNull' ? expr.right.kind === ts.SyntaxKind.NullKeyword : ts.isIdentifier(expr.right) && expr.right.text === 'undefined');
      break;
    case 'isBoolean': case 'isNumber': case 'isString':
      valid = params.length === 1 && typeofComparison(expr, ts.SyntaxKind.EqualsEqualsEqualsToken,
        method.name.text === 'isBoolean' ? 'boolean' : method.name.text === 'isNumber' ? 'number' : 'string', params);
      break;
    case 'isArray': {
      const value = peelCasts(expr);
      valid = params.length === 1 && ts.isCallExpression(value) && value.expression.getText(source) === 'Array.isArray' &&
        value.arguments.length === 1 && isParam(value.arguments[0], params, 0);
      break;
    }
    case 'isObject': {
      const value = peelCasts(expr);
      valid = params.length === 1 && ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
        typeofComparison(value.left, ts.SyntaxKind.EqualsEqualsEqualsToken, 'object', params) &&
        ts.isBinaryExpression(value.right) && value.right.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken &&
        isParam(value.right.left, params, 0) && value.right.right.kind === ts.SyntaxKind.NullKeyword;
      break;
    }
    case 'jsEqual': valid = params.length === 2 && binary(expr, ts.SyntaxKind.EqualsEqualsEqualsToken, 0, 1, params); break;
  }
  if (!valid) throw new Error(`Native.${method.name.text} body no longer matches its audited primitive expression`);
}

function validateNativeVoidBody(method, source) {
  if (!method.body || method.body.statements.length !== 1 || !ts.isExpressionStatement(method.body.statements[0])) throw new Error(`Native.${method.name.text} is not a single primitive statement`);
  const expr = method.body.statements[0].expression;
  const params = method.parameters;
  let valid = false;
  const expectedMethod = method.name.text === 'arrayPush' ? 'push' : method.name.text === 'mapSet' ? 'set' : 'add';
  switch (method.name.text) {
    case 'arrayPush': case 'mapSet': case 'setAdd': {
      const value = peelCasts(expr);
      const arity = method.name.text === 'arrayPush' || method.name.text === 'setAdd' ? 1 : 2;
      valid = params.length === arity + 1 && ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) &&
        value.expression.name.text === expectedMethod && isParam(value.expression.expression, params, 0) && value.arguments.length === arity &&
        value.arguments.every((arg, i) => isParam(arg, params, i + 1));
      break;
    }
    case 'arraySet': {
      const value = peelCasts(expr);
      valid = params.length === 3 && ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isElementAccessExpression(value.left) && isParam(value.left.expression, params, 0) && isParam(value.left.argumentExpression, params, 1) &&
        isParam(value.right, params, 2);
      break;
    }
  }
  if (!valid) throw new Error(`Native.${method.name.text} body no longer matches its audited primitive statement`);
}

function isSimpleArgument(node) {
  node = unparen(node);
  return ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node) || node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword;
}

function gatherSimpleNativeSites(source) {
  const calls = Object.create(null), inline = Object.create(null), statementInline = Object.create(null);
  function walk(node, className = '', methodName = '') {
    if (ts.isClassExpression(node) || ts.isClassDeclaration(node)) className = node.name?.text || className;
    if (ts.isMethodDeclaration(node)) methodName = node.name?.getText(source) || methodName;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.expression.getText(source) === 'Native' &&
        node.expression.expression.name.text === '__default' && [...SIMPLE_NATIVE_NAMES, ...VOID_NATIVE_NAMES].includes(node.expression.name.text)) {
      const name = node.expression.name.text, site = `${className}.${methodName}`;
      calls[name] ||= Object.create(null);
      calls[name][site] = (calls[name][site] || 0) + 1;
      if (node.arguments.every(isSimpleArgument)) {
        if (SIMPLE_NATIVE_NAMES.includes(name)) {
          inline[name] ||= Object.create(null);
          inline[name][site] = (inline[name][site] || 0) + 1;
        } else if (ts.isExpressionStatement(node.parent) && node.parent.expression === node) {
          statementInline[name] ||= Object.create(null);
          statementInline[name][site] = (statementInline[name][site] || 0) + 1;
        }
      }
    }
    ts.forEachChild(node, child => walk(child, className, methodName));
  }
  walk(source);
  return { calls, inline, statementInline };
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

function isSelfReceiver(node) {
  node = unparen(node);
  return ts.isThis(node) || (ts.isIdentifier(node) && ['_this', 'this'].includes(node.text));
}

function discoverInstanceFields(source) {
  const fieldMaps = Object.create(null);
  const fieldCounts = Object.create(null);
  for (const className of ['Engine', 'Writer']) {
    const fields = new Set();
    const accesses = Object.create(null);
    let found = 0;
    function walk(node, within = false) {
      if ((ts.isClassExpression(node) || ts.isClassDeclaration(node)) && node.name?.text === className) {
        within = true;
      }
      if (within && ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isPropertyAccessExpression(node.left) && isSelfReceiver(node.left.expression)) {
        fields.add(node.left.name.text);
      }
      if (within && ts.isPropertyAccessExpression(node) && isSelfReceiver(node.expression)) {
        accesses[node.name.text] = (accesses[node.name.text] || 0) + 1;
        found++;
      }
      ts.forEachChild(node, child => walk(child, within));
    }
    walk(source);
    if (!found) throw new Error(`generated ${className} instance fields missing`);
    const names = [...fields].filter(name => !KEEP_FIELDS[className].has(name) && !REMOVED_METADATA_FIELDS.has(name)).sort();
    const map = Object.create(null);
    let next = 0;
    for (const name of names) map[name] = `_f${(next++).toString(36)}`;
    if (new Set(Object.values(map)).size !== Object.keys(map).length) throw new Error(`${className} field mangling collides`);
    for (const name of Object.keys(map)) {
      if (!accesses[name]) throw new Error(`assigned ${className}.${name} has no instance access`);
    }
    fieldMaps[className] = map;
    fieldCounts[className] = Object.fromEntries(Object.keys(map).sort().map(name => [name, accesses[name]]));
  }
  const owners = new Map();
  for (const [className, map] of Object.entries(fieldMaps)) {
    for (const name of Object.keys(map)) owners.set(name, className);
  }
  function rejectEscaped(node, className = '') {
    if ((ts.isClassExpression(node) || ts.isClassDeclaration(node)) && node.name && fieldMaps[node.name.text]) className = node.name.text;
    if (ts.isPropertyAccessExpression(node) && owners.has(node.name.text)) {
      const owner = owners.get(node.name.text);
      if (className !== owner || !isSelfReceiver(node.expression)) {
        throw new Error(`unsupported escaped ${owner}.${node.name.text} field reference`);
      }
    }
    if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression) && owners.has(node.argumentExpression.text) && isSelfReceiver(node.expression)) {
      throw new Error(`unsupported dynamic ${className}.${node.argumentExpression.text} field reference`);
    }
    ts.forEachChild(node, child => rejectEscaped(child, className));
  }
  rejectEscaped(source);
  return { fieldMaps, fieldCounts };
}

function assignmentStatement(node) {
  if (!node || !ts.isExpressionStatement(node) || !ts.isBinaryExpression(node.expression) || node.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return undefined;
  return node.expression;
}

function safeTempTarget(node) {
  if (ts.isIdentifier(node)) return 'identifier';
  if (ts.isPropertyAccessExpression(node) && isSelfReceiver(node.expression)) return 'self-property';
  return undefined;
}

function discoverSyntheticTempSites(source) {
  const sites = Object.create(null);
  function walk(node, className = '', methodName = '') {
    if ((ts.isClassExpression(node) || ts.isClassDeclaration(node)) && node.name) className = node.name.text;
    if (ts.isMethodDeclaration(node)) {
      methodName = node.name?.getText(source) || methodName;
      if (!node.body) return;
      let hasClosure = false;
      const declarations = new Map();
      const pairs = new Map();
      const occurrences = new Map();
      function inspect(current) {
        if (ts.isFunctionExpression(current) || ts.isArrowFunction(current)) hasClosure = true;
        if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name) && /^_out\d+$/.test(current.name.text)) {
          declarations.set(current.name.text, (declarations.get(current.name.text) || 0) + 1);
          if (current.initializer) throw new Error(`synthetic output ${current.name.text} has an initializer`);
        }
        if (ts.isIdentifier(current) && /^_out\d+$/.test(current.text)) occurrences.set(current.text, (occurrences.get(current.text) || 0) + 1);
        ts.forEachChild(current, inspect);
      }
      inspect(node.body);
      function scanBlocks(current) {
        if (ts.isBlock(current)) {
          for (let i = 0; i + 1 < current.statements.length; i++) {
            const first = assignmentStatement(current.statements[i]);
            const second = assignmentStatement(current.statements[i + 1]);
            if (!first || !ts.isIdentifier(first.left) || !/^_out\d+$/.test(first.left.text) || !second ||
                !ts.isIdentifier(second.right) || second.right.text !== first.left.text) continue;
            if (hasClosure || declarations.get(first.left.text) !== 1) throw new Error(`synthetic output ${first.left.text} escapes its generated method`);
            const target = safeTempTarget(second.left);
            if (!target) throw new Error(`unsupported synthetic output target ${second.left.getText(source)}`);
            const key = `${className}.${methodName}`;
            if (!sites[key]) sites[key] = { identifier: 0, 'self-property': 0 };
            sites[key][target]++;
            pairs.set(first.left.text, (pairs.get(first.left.text) || 0) + 1);
            i++;
          }
        }
        ts.forEachChild(current, scanBlocks);
      }
      scanBlocks(node.body);
      for (const [name, count] of pairs) {
        if (occurrences.get(name) !== 1 + 2 * count) throw new Error(`synthetic output ${name} has an unpinned read or write`);
      }
      return;
    }
    ts.forEachChild(node, child => walk(child, className, methodName));
  }
  walk(source);
  return sites;
}

function inlineSyntheticTemps(text, expectedSites) {
  const source = parse(text);
  const actualSites = discoverSyntheticTempSites(source);
  if (JSON.stringify(actualSites) !== JSON.stringify(expectedSites)) throw new Error('synthetic output temporary site inventory changed');
  const counts = Object.create(null);
  const transformed = printerTransform(source, context => root => {
    function visit(node, className = '', methodName = '') {
      if ((ts.isClassExpression(node) || ts.isClassDeclaration(node)) && node.name) className = node.name.text;
      if (ts.isMethodDeclaration(node)) methodName = node.name?.getText(source) || methodName;
      if (ts.isBlock(node)) {
        const statements = [];
        for (let i = 0; i < node.statements.length; i++) {
          const first = assignmentStatement(node.statements[i]);
          const second = assignmentStatement(node.statements[i + 1]);
          if (first && ts.isIdentifier(first.left) && /^_out\d+$/.test(first.left.text) && second &&
              ts.isIdentifier(second.right) && second.right.text === first.left.text && safeTempTarget(second.left)) {
            const key = `${className}.${methodName}`;
            if (!expectedSites[key]) throw new Error('synthetic output pair moved outside its pinned method');
            const target = safeTempTarget(second.left);
            if (!counts[key]) counts[key] = { identifier: 0, 'self-property': 0 };
            counts[key][target]++;
            const rhs = ts.visitNode(first.right, child => visit(child, className, methodName));
            const nextExpr = ts.factory.updateBinaryExpression(second, second.left, second.operatorToken, rhs);
            statements.push(ts.factory.updateExpressionStatement(node.statements[i + 1], nextExpr));
            i++;
          } else statements.push(ts.visitNode(node.statements[i], child => visit(child, className, methodName)));
        }
        return ts.factory.updateBlock(node, statements);
      }
      return ts.visitEachChild(node, child => visit(child, className, methodName), context);
    }
    return ts.visitNode(root, node => visit(node));
  });
  const normalized = Object.fromEntries(Object.keys(expectedSites).map(key => [key, {
    identifier: counts[key]?.identifier || 0,
    'self-property': counts[key]?.['self-property'] || 0,
  }]));
  if (JSON.stringify(normalized) !== JSON.stringify(expectedSites)) throw new Error('synthetic output rewrite count changed');
  return { text: transformed, siteCounts: actualSites };
}

function mangleInstanceFields(text, expectedMaps, expectedCounts) {
  const source = parse(text);
  const actual = discoverInstanceFields(source);
  if (JSON.stringify(actual.fieldMaps) !== JSON.stringify(expectedMaps) || JSON.stringify(actual.fieldCounts) !== JSON.stringify(expectedCounts)) {
    throw new Error('instance field inventory or access counts changed');
  }
  const counts = Object.fromEntries(Object.keys(expectedMaps).map(name => [name, Object.create(null)]));
  const transformed = printerTransform(source, context => root => {
    function visit(node, className = '') {
      if ((ts.isClassExpression(node) || ts.isClassDeclaration(node)) && node.name && expectedMaps[node.name.text]) className = node.name.text;
      const map = expectedMaps[className];
      if (map && ts.isPropertyAccessExpression(node) && map[node.name.text]) {
        if (!isSelfReceiver(node.expression)) throw new Error(`unsupported escaped ${className}.${node.name.text} field reference`);
        counts[className][node.name.text] = (counts[className][node.name.text] || 0) + 1;
        const receiver = ts.visitNode(node.expression, child => visit(child, className));
        return ts.factory.updatePropertyAccessExpression(node, receiver, ts.factory.createIdentifier(map[node.name.text]));
      }
      return ts.visitEachChild(node, child => visit(child, className), context);
    }
    return ts.visitNode(root, node => visit(node));
  });
  const normalizedCounts = Object.fromEntries(Object.entries(expectedMaps).map(([className, map]) => [
    className,
    Object.fromEntries(Object.keys(map).sort().map(name => [name, counts[className][name] || 0])),
  ]));
  if (JSON.stringify(normalizedCounts) !== JSON.stringify(expectedCounts)) throw new Error('instance field reference escaped its declaring class');
  return { text: transformed, accessCounts: normalizedCounts };
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
  const identitySites = gatherIdentitySites(source);
  const afterIdentity = parse(inlineIdentityCalls(generatedText, identitySites));
  const methods = discoverMethods(source);
  const methodAccessSites = discoverMethodAccessSites(source, methods);
  const instanceFields = discoverInstanceFields(source);
  return {
    version: 1,
    nativeSha256: sha256(nativeText),
    nativeIdentityHelpers: Object.keys(native).sort(),
    identitySites,
    simpleNativeSites: gatherSimpleNativeSites(afterIdentity),
    charCodeSites: discoverCharCodeSites(source),
    getters: discoverGetters(source),
    metadata: discoverMetadata(source),
    methodRenames: methods,
    methodAccessSites,
    fieldRenames: instanceFields.fieldMaps,
    fieldAccessSites: instanceFields.fieldCounts,
    syntheticTempSites: discoverSyntheticTempSites(source),
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
          node.expression.expression.name.text === '__default' &&
          [...SIMPLE_NATIVE_NAMES, ...VOID_NATIVE_NAMES].includes(node.expression.name.text) && node.arguments.every(isSimpleArgument)) {
        const name = node.expression.name.text;
        const statementOnly = VOID_NATIVE_NAMES.includes(name);
        if (statementOnly && !(ts.isExpressionStatement(node.parent) && node.parent.expression === node)) {
          return ts.visitEachChild(node, child => visit(child, className, methodName), context);
        }
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
          case 'arrayGet': case 'objectGet': return ts.factory.createElementAccessExpression(left, args[1]);
          case 'arrayLength': return ts.factory.createPropertyAccessExpression(left, 'length');
          case 'mapGet': return ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(left, 'get'), undefined, [args[1]]);
          case 'mapHas': case 'setHas': return ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(left, 'has'), undefined, [args[1]]);
          case 'mapSize': return ts.factory.createPropertyAccessExpression(left, 'size');
          case 'isNull': return ts.factory.createBinaryExpression(left, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.factory.createNull());
          case 'isUndefined': return ts.factory.createBinaryExpression(left, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.factory.createIdentifier('undefined'));
          case 'isBoolean': case 'isNumber': case 'isString':
            return ts.factory.createBinaryExpression(ts.factory.createTypeOfExpression(left), ts.SyntaxKind.EqualsEqualsEqualsToken,
              ts.factory.createStringLiteral(name === 'isBoolean' ? 'boolean' : name === 'isNumber' ? 'number' : 'string'));
          case 'isObject':
            return ts.factory.createBinaryExpression(
              ts.factory.createBinaryExpression(ts.factory.createTypeOfExpression(left), ts.SyntaxKind.EqualsEqualsEqualsToken, ts.factory.createStringLiteral('object')),
              ts.SyntaxKind.AmpersandAmpersandToken,
              ts.factory.createBinaryExpression(left, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.factory.createNull()));
          case 'isArray': return ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('Array'), 'isArray'), undefined, [left]);
          case 'jsEqual': return ts.factory.createBinaryExpression(left, ts.SyntaxKind.EqualsEqualsEqualsToken, args[1]);
          case 'arrayPush': return ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(left, 'push'), undefined, [args[1]]);
          case 'arraySet': return ts.factory.createBinaryExpression(ts.factory.createElementAccessExpression(left, args[1]), ts.SyntaxKind.EqualsToken, args[2]);
          case 'mapSet': return ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(left, 'set'), undefined, [args[1], args[2]]);
          case 'setAdd': return ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(left, 'add'), undefined, [args[1]]);
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
  let transformed = inlineSyntheticTemps(generatedText, manifest.syntheticTempSites).text;
  transformed = inlineIdentityCalls(transformed, manifest.identitySites);
  transformed = inlineSimpleNativeExpressions(transformed, manifest.simpleNativeSites);
  transformed = inlineIndexedStringCodeUnits(transformed, manifest.charCodeSites);
  transformed = inlineStaticGetters(transformed, manifest.getters);
  transformed = removeReflectionMetadata(transformed, manifest.metadata);
  const renamed = mangleInternalMethods(transformed, manifest.methodRenames, manifest.methodAccessSites);
  const fields = mangleInstanceFields(renamed.text, manifest.fieldRenames, manifest.fieldAccessSites);
  return { text: fields.text, methodAccessCounts: renamed.accessCounts, fieldAccessCounts: fields.accessCounts };
}

if (require.main === module && process.argv.includes('--write-manifest')) {
  const inputIndex = process.argv.indexOf('--input');
  if (inputIndex < 0 || !process.argv[inputIndex + 1]) throw new Error('--write-manifest requires --input <unshaped extracted Dafny module JS>');
  const generatedPath = path.resolve(process.argv[inputIndex + 1]);
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
  discoverInstanceFields,
  mangleInstanceFields,
  discoverSyntheticTempSites,
  inlineSyntheticTemps,
  gatherSimpleNativeSites,
  inlineIdentityCalls,
};
