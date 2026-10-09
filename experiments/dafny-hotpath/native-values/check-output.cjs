#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const BUILTIN_CALLS = new Set([
  'Array', 'Array.isArray', 'Object.is', 'Object.keys', 'Object.values',
  'Object.entries', 'Object.create', 'Object.defineProperty',
  'Object.defineProperties', 'Object.getOwnPropertyDescriptor',
  'Object.getPrototypeOf', 'Object.freeze', 'Symbol',
  'Object.prototype.hasOwnProperty.call', 'Number', 'Number.isFinite',
  'Number.isInteger', 'Number.isSafeInteger', 'Number.isNaN', 'String',
  'String.fromCharCode', 'String.fromCodePoint', 'Boolean', 'JSON.parse',
  'JSON.stringify', 'Math.min', 'Math.max', 'Math.floor', 'Math.ceil',
  'Math.trunc', 'Math.abs',
]);
const BUILTIN_CONSTRUCTORS = new Set([
  'Array', 'Map', 'WeakMap', 'Set', 'WeakSet', 'Error', 'TypeError', 'RangeError',
]);
const PROTECTED_NAMES = new Set(['Number', 'String', 'Boolean', 'Array', 'Map', 'WeakMap', 'Set', 'WeakSet', 'Object', 'Symbol', 'BigInt', 'BigNumber', '_dafny', 'require']);

function expressionName(node, source) {
  if (ts.isParenthesizedExpression(node)) return expressionName(node.expression, source);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.CommaToken && ts.isNumericLiteral(node.left) && node.left.text === '0') return expressionName(node.right, source);
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    return `${expressionName(node.expression, source)}.${node.name.text}`;
  }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
    return `${expressionName(node.expression, source)}.${node.argumentExpression.text}`;
  }
  return node.getText(source).replace(/\s+/g, '');
}

function audit({ generated = [], wholeFiles = [], allowedCalls = [], allowedConstructors = [] }, base = process.cwd()) {
  const diagnostics = [];
  const reported = new Set();
  const sources = new Map();
  const definitions = new Map();
  const shortNames = new Map();
  const declaredNames = new Set();
  const calls = new Set(allowedCalls);
  const constructors = new Set(allowedConstructors);
  const visited = new Set();
  const indexedNodes = new Map();
  const imports = new Map();

  function report(source, node, message) {
    const position = node ? source.getLineAndCharacterOfPosition(node.getStart(source)) : { line: 0, character: 0 };
    const diagnostic = `${source.fileName}:${position.line + 1}:${position.character + 1}: ${message}`;
    if (!reported.has(diagnostic)) {
      reported.add(diagnostic);
      diagnostics.push(diagnostic);
    }
  }
  function read(filename) {
    const absolute = path.resolve(base, filename);
    if (sources.has(absolute)) return sources.get(absolute);
    let content;
    try { content = fs.readFileSync(absolute, 'utf8'); }
    catch (error) { diagnostics.push(`${absolute}: cannot read audited file: ${error.message}`); return undefined; }
    const source = ts.createSourceFile(absolute, content, ts.ScriptTarget.Latest, true,
      /\.[cm]?tsx?$/.test(absolute) ? ts.ScriptKind.TS : ts.ScriptKind.JS);
    sources.set(absolute, source);
    for (const diagnostic of source.parseDiagnostics) {
      report(source, { getStart: () => diagnostic.start || 0 }, `parse error: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
    }
    return source;
  }
  function register(name, node, source, owner) {
    const entry = { name, node, source, owner };
    indexedNodes.set(node, entry);
    if (!definitions.has(name)) definitions.set(name, []);
    definitions.get(name).push(entry);
    const short = name.split('.').at(-1);
    if (!shortNames.has(short)) shortNames.set(short, []);
    shortNames.get(short).push(entry);
  }
  function index(source) {
    function visit(node, moduleName = '', className = '') {
      if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
        declaredNames.add(node.name.text);
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const initializer = node.initializer;
        let call = initializer;
        if (ts.isParenthesizedExpression(call)) call = call.expression;
        if (ts.isCallExpression(call)) {
          let callee = call.expression;
          if (ts.isParenthesizedExpression(callee)) callee = callee.expression;
          if (ts.isFunctionExpression(callee) || ts.isArrowFunction(callee)) {
            ts.forEachChild(callee, child => visit(child, node.name.text, ''));
            return;
          }
        }
        if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
          register(moduleName ? `${moduleName}.${node.name.text}` : node.name.text, initializer, source, moduleName);
        }
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left)) {
        let target = expressionName(node.left, source);
        if (moduleName && target.startsWith('$module.')) target = `${moduleName}.${target.slice(8)}`;
        if (ts.isClassExpression(node.right)) {
          ts.forEachChild(node.right, child => visit(child, moduleName, target));
          return;
        }
        if (ts.isFunctionExpression(node.right) || ts.isArrowFunction(node.right)) register(target, node.right, source, moduleName);
      }
      if (ts.isClassDeclaration(node) && node.name) className = moduleName ? `${moduleName}.${node.name.text}` : node.name.text;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
        const objectName = moduleName ? `${moduleName}.${node.name.text}` : node.name.text;
        for (const property of node.initializer.properties) {
          if (ts.isMethodDeclaration(property) && ts.isIdentifier(property.name)) register(`${objectName}.${property.name.text}`, property, source, objectName);
          if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && (ts.isArrowFunction(property.initializer) || ts.isFunctionExpression(property.initializer))) register(`${objectName}.${property.name.text}`, property.initializer, source, objectName);
        }
      }
      if (ts.isMethodDeclaration(node) && className && node.name && ts.isIdentifier(node.name)) register(`${className}.${node.name.text}`, node, source, className);
      if (ts.isFunctionDeclaration(node) && node.name) register(moduleName ? `${moduleName}.${node.name.text}` : node.name.text, node, source, moduleName);
      ts.forEachChild(node, child => visit(child, moduleName, className));
    }
    visit(source);
  }

  for (const entry of generated) {
    if (!entry || typeof entry.file !== 'string' || !Array.isArray(entry.roots) || entry.roots.length === 0 || entry.roots.some(root => typeof root !== 'string')) {
      diagnostics.push('manifest: every generated file needs a file and at least one explicit named root');
      continue;
    }
    read(entry.file);
  }
  for (const filename of wholeFiles) read(filename);
  for (const source of sources.values()) index(source);

  function moduleSource(specifier, source) {
    if (typeof specifier !== 'string' || !specifier.startsWith('.')) return undefined;
    const absolute = path.resolve(path.dirname(source.fileName), specifier);
    const extension = source.fileName.endsWith('.d.ts') ? '.d.ts' : /\.[cm]?tsx?$/.test(source.fileName) ? '.ts' : '.js';
    const candidates = /\.[cm]?[jt]s$/.test(absolute) ? [absolute] : [absolute + extension, path.join(absolute, 'index' + extension)];
    return candidates.map(filename => sources.get(filename)).find(Boolean);
  }
  for (const source of sources.values()) {
    const bindings = new Map();
    imports.set(source, bindings);
    function addImport(alias, specifier, member) {
      const target = moduleSource(specifier, source);
      if (target) bindings.set(alias, { source: target, member });
    }
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement)) {
        const specifier = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : undefined;
        const clause = statement.importClause;
        if (!clause) addImport('', specifier, '', statement);
        else {
          if (clause.name) addImport(clause.name.text, specifier, 'default', statement);
          if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) addImport(clause.namedBindings.name.text, specifier, '', statement);
          if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
            for (const element of clause.namedBindings.elements) addImport(element.name.text, specifier, (element.propertyName || element.name).text, statement);
          }
        }
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const initializer = declaration.initializer;
          if (initializer && ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression) && initializer.expression.text === 'require' && initializer.arguments.length === 1 && ts.isStringLiteral(initializer.arguments[0])) {
            const specifier = initializer.arguments[0].text;
            if (ts.isIdentifier(declaration.name)) addImport(declaration.name.text, specifier, '', declaration);
            else if (ts.isObjectBindingPattern(declaration.name)) {
              for (const element of declaration.name.elements) {
                if (ts.isIdentifier(element.name)) addImport(element.name.text, specifier, (element.propertyName || element.name).getText(source), declaration);
              }
            }
          }
        }
      }
    }
  }

  function resolve(name, owner, source) {
    const names = [name];
    if (owner && name.startsWith('$module.')) names.push(`${owner.split('.')[0]}.${name.slice(8)}`);
    if (name.startsWith('this.') && owner) names.push(`${owner}.${name.slice(5)}`);
    if (!name.includes('.') && owner) {
      names.push(`${owner}.${name}`);
      const moduleName = owner.split('.')[0];
      names.push(`${moduleName}.${name}`);
    }
    for (const candidate of names) {
      const matches = definitions.get(candidate);
      if (matches) {
        const local = matches.filter(entry => entry.source === source);
        if (local.length === 1) return local[0];
        if (local.length > 1) return null;
      }
    }
    const [alias, ...members] = name.split('.');
    const imported = imports.get(source).get(alias);
    if (imported) {
      const targetName = imported.member ? [imported.member, ...members].join('.') : members.join('.');
      const target = (definitions.get(targetName) || []).filter(entry => entry.source === imported.source);
      if (target.length === 1) return target[0];
      return target.length > 1 ? null : undefined;
    }
    if (!name.includes('.')) {
      const matches = (shortNames.get(name) || []).filter(entry => entry.source === source);
      if (matches.length === 1) return matches[0];
    }
    return undefined;
  }
  function scan(node, source, owner = '') {
    if (indexedNodes.has(node)) owner = indexedNodes.get(node).owner;
    if (ts.isImportDeclaration(node) && (!ts.isStringLiteral(node.moduleSpecifier) || !moduleSource(node.moduleSpecifier.text, source))) {
      report(source, node, 'import must resolve to an explicitly audited local source/declaration file');
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      const target = expressionName(node.left, source).split('.')[0];
      if (imports.get(source).has(target)) report(source, node, `mutation of imported binding ${target}; static module call resolution requires immutable bindings`);
    }
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name && ts.isIdentifier(node.name) && PROTECTED_NAMES.has(node.name.text)) {
      report(source, node.name, `redefinition of protected native/runtime name ${node.name.text}`);
    }
    if (node.kind === ts.SyntaxKind.AnyKeyword) report(source, node, 'explicit TypeScript any; use unknown or a checked native type');
    if (node.kind === ts.SyntaxKind.BigIntKeyword || ts.isBigIntLiteral(node)) report(source, node, 'BigInt representation in audited native path');
    if (ts.isIdentifier(node) && /^(?:BigNumber|BigInt|_dafny)$/.test(node.text)) report(source, node, `Dafny runtime/boxing reference ${node.text}`);
    if (ts.isPropertyAccessExpression(node) && /^create_/.test(node.name.text)) report(source, node, `generated datatype constructor ${node.name.text}`);
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = expressionName(node.expression, source);
      const isNew = ts.isNewExpression(node);
      if (!isNew && name === 'require' && !declaredNames.has('require') && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) && moduleSource(node.arguments[0].text, source)) {
        // Audited local modules are scanned independently; imports do not execute unchecked dependencies.
      } else if (isNew && /^(?:Number|String|Boolean|Object)$/.test(name)) {
        report(source, node, `primitive/object boxing via new ${name}`);
      } else {
        let shadowed = false;
        if (ts.isIdentifier(node.expression)) {
          for (let parent = node.parent; parent; parent = parent.parent) {
            if (ts.isFunctionLike(parent) && parent.parameters.some(parameter => ts.isIdentifier(parameter.name) && parameter.name.text === name)) shadowed = true;
          }
        }
        if (shadowed) {
          report(source, node, `indirect call through parameter ${name}; runtime callees must be explicitly named`);
          ts.forEachChild(node, child => scan(child, source, owner));
          return;
        }
        const helper = resolve(name, owner, source);
        if (helper) {
          if (!visited.has(helper)) {
            visited.add(helper);
            scan(helper.node, helper.source, helper.owner);
          }
        } else if (helper === null) {
          report(source, node, `ambiguous helper ${name}; use an unambiguous named call`);
        } else {
          const builtin = (isNew ? BUILTIN_CONSTRUCTORS : BUILTIN_CALLS).has(name) && !declaredNames.has(name.split('.')[0]);
          if (!builtin && !(isNew ? constructors : calls).has(name)) {
            report(source, node, `unaudited ${isNew ? 'constructor' : 'call'} ${name}; add its source for traversal or explicitly audit its manifest allowlist entry`);
          }
        }
      }
    }
    ts.forEachChild(node, child => scan(child, source, owner));
  }

  for (const entry of generated) {
    if (!entry || !Array.isArray(entry.roots)) continue;
    const source = sources.get(path.resolve(base, entry.file));
    if (!source) continue;
    for (const name of entry.roots) {
      const matches = (definitions.get(name) || []).filter(definition => definition.source === source);
      if (matches.length !== 1) {
        report(source, undefined, `required generated root ${name} ${matches.length ? 'is ambiguous' : 'was not found'}; compiler output/manifest changed`);
      } else {
        visited.add(matches[0]);
        scan(matches[0].node, source, matches[0].owner);
      }
    }
  }
  for (const filename of wholeFiles) {
    const source = sources.get(path.resolve(base, filename));
    if (source) scan(source, source);
  }
  if (generated.length === 0 && wholeFiles.length === 0) diagnostics.push('no files were audited');
  return { ok: diagnostics.length === 0, diagnostics, checkedFiles: sources.size };
}

function main(args) {
  let config = { wholeFiles: [] };
  let base = process.cwd();
  if (args[0] === '--manifest') {
    if (!args[1]) throw new Error('--manifest needs a JSON path');
    const filename = path.resolve(args[1]);
    config = JSON.parse(fs.readFileSync(filename, 'utf8'));
    base = path.dirname(filename);
    args = args.slice(2);
  }
  config.wholeFiles = [...(config.wholeFiles || []), ...args.map(filename => path.resolve(filename))];
  const result = audit(config, base);
  if (!result.ok) {
    for (const diagnostic of result.diagnostics) process.stderr.write(`${diagnostic}\n`);
    process.exitCode = 1;
  } else process.stdout.write(`native output guard passed (${result.checkedFiles} files)\n`);
}

module.exports = { audit };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`native output guard: ${error.message}\n`); process.exitCode = 1; }
}
