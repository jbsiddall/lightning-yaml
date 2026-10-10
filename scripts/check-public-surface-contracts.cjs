#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'scripts/public-surface-contract-manifest.json');
const sourceFiles = [
  'src/index.ts',
  'src/core.ts',
  'src/errors.ts',
  'src/yaml-compat.ts',
  'src/js-yaml-compat.ts',
  'src/compat-options.ts',
];
const formalConstructs = [
  ['SurfaceValues', 'datatype', 'OptionSurface'],
  ['SurfaceValues', 'datatype', 'Argument'],
  ['SurfaceValues', 'predicate', 'WellFormedArgument'],
  ['SurfaceValues', 'predicate', 'IsUndefinedArgument'],
  ['SurfaceValues', 'predicate', 'IsNullishArgument'],
  ['SurfaceValues', 'predicate', 'IsLooselyNullishArgument'],
  ['SurfaceValues', 'predicate', 'IsFunctionArgument'],
  ['SurfaceValues', 'predicate', 'IsArrayArgument'],
  ['SurfaceValues', 'predicate', 'IsObjectArgument'],
  ['SurfaceValues', 'predicate', 'IsTrueArgument'],
  ['SurfaceValues', 'predicate', 'IsCoreText'],
  ['SurfaceValues', 'predicate', 'IsVersion12Text'],
  ['SurfaceValues', 'predicate', 'IsCoreSchema'],
  ['SurfaceValues', 'predicate', 'FalsyNumberBits'],
  ['SurfaceValues', 'predicate', 'Truthy'],
  ['SurfaceOptions', 'function', 'YamlParseSlot'],
  ['SurfaceOptions', 'function', 'YamlStringifySlot'],
  ['SurfaceOptions', 'function', 'JsYamlLoadAllSlot'],
  ['SurfaceOptions', 'predicate', 'YamlOptionsPrimitiveRejected'],
  ['SurfaceOptions', 'predicate', 'RuleRejects'],
  ['SurfaceOptions', 'function', 'OwnRuleCode'],
  ['SurfaceOptions', 'method', 'SelectYamlParseOptions'],
  ['SurfaceOptions', 'method', 'SelectYamlStringifyOptions'],
  ['SurfaceOptions', 'method', 'SelectJsYamlLoadAllOptions'],
  ['SurfaceOptions', 'method', 'RejectYamlOptionsPrimitive'],
  ['SurfaceOptions', 'method', 'RejectRecognizedOption'],
];
const optionProofMethods = [
  'SurfaceOptions.SelectYamlParseOptions',
  'SurfaceOptions.SelectYamlStringifyOptions',
  'SurfaceOptions.SelectJsYamlLoadAllOptions',
  'SurfaceOptions.RejectYamlOptionsPrimitive',
  'SurfaceOptions.RejectRecognizedOption',
];
const recognizedRuleCodes = new Map([
  ['AcceptAny', [1, 'AcceptAny']],
  ['RequireCoreSchemaIdentity', [2, 'RequireCoreSchemaIdentity']],
  ['RequireExactlyTrue', [3, 'RequireExactlyTrue']],
  ['RejectEveryDefinedValue', [4, 'RejectEveryDefinedValue']],
  ['RejectTruthy', [5, 'RejectTruthy']],
  ['RequireCoreText', [6, 'RequireCoreText']],
  ['RequireVersion12Text', [7, 'RequireVersion12Text']],
]);
const statusNames = new Set([
  'specified-complete',
  'verified-local',
  'trusted-host',
  'blocked-known-defect',
  'deferred-global-proof',
]);

function loadTypeScript() {
  try {
    return require('typescript');
  } catch {
    throw new Error('TypeScript is required to check the public source inventory; install project dev dependencies first.');
  }
}

function getModifiers(ts, node) {
  return ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : [];
}

function isExported(ts, node) {
  return getModifiers(ts, node).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function isTypeOnly(ts, node) {
  return ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node);
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function propertyName(ts, node) {
  if (!node.name) return undefined;
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isNumericLiteral(node.name)) return node.name.text;
  return undefined;
}

function exportedNames(ts, sourceFile) {
  const runtime = new Set();
  const types = new Set();
  const defaults = new Map();
  const variables = new Map();
  for (const node of sourceFile.statements) {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) variables.set(declaration.name.text, declaration.initializer);
      }
    }
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        const target = element.name.text;
        (node.isTypeOnly || element.isTypeOnly ? types : runtime).add(target);
      }
      continue;
    }
    if (ts.isVariableStatement(node) && isExported(ts, node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) throw new Error(`${sourceFile.fileName}: exported destructuring requires explicit inventory support`);
        runtime.add(declaration.name.text);
      }
    }
    if (isExported(ts, node) && node.name) {
      const name = node.name.text;
      (isTypeOnly(ts, node) ? types : runtime).add(name);
    }
    if (ts.isExportAssignment(node)) {
      const expression = node.expression;
      const variableName = ts.isIdentifier(expression) ? expression.text : undefined;
      const value = variableName ? variables.get(variableName) : expression;
      const members = new Map();
      if (value && ts.isObjectLiteralExpression(value)) {
        for (const property of value.properties) {
          const name = propertyName(ts, property);
          if (name === undefined) throw new Error(`${sourceFile.fileName}: unsupported computed/spread default export property`);
          if (ts.isShorthandPropertyAssignment(property)) members.set(name, name);
          else if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer)) members.set(name, property.initializer.text);
          else throw new Error(`${sourceFile.fileName}: default object property ${name} is not an identifier alias`);
        }
        defaults.set(variableName ?? 'default', members);
      } else {
        defaults.set('default', new Map([['default', ts.isIdentifier(expr) ? expr.text : expr.getText(sourceFile)]]));
      }
    }
  }
  return { runtime, types, defaults };
}

function objectLiteralKeys(ts, sourceFile, variableName) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== variableName) continue;
      if (!declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) return new Set();
      return new Set(declaration.initializer.properties.map((property) => propertyName(ts, property)).filter(Boolean));
    }
  }
  return new Set();
}

function unwrapExpression(ts, expression) {
  while (expression && (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression))) expression = expression.expression;
  return expression;
}

function classifyOptionRule(ts, expression, helpers, sourceFile, seen = new Set()) {
  const value = unwrapExpression(ts, expression);
  if (ts.isIdentifier(value) && helpers.has(value.text)) {
    if (seen.has(value.text)) throw new Error(`${sourceFile.fileName}: cyclic option rule helper ${value.text}`);
    return classifyOptionRule(ts, helpers.get(value.text), helpers, sourceFile, new Set([...seen, value.text]));
  }
  if (ts.isCallExpression(value) && ts.isIdentifier(value.expression) && helpers.has(value.expression.text)) {
    const helper = unwrapExpression(ts, helpers.get(value.expression.text));
    if (ts.isArrowFunction(helper) && ts.isArrowFunction(unwrapExpression(ts, helper.body))) {
      if (value.arguments.length !== 1 || !(ts.isStringLiteral(value.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(value.arguments[0]))) {
        throw new Error(`${sourceFile.fileName}: option-rule factory requires one literal rejection message`);
      }
      return classifyOptionRule(ts, helper.body, helpers, sourceFile, new Set([...seen, value.expression.text]));
    }
    return classifyOptionRule(ts, helper, helpers, sourceFile, new Set([...seen, value.expression.text]));
  }
  if (!ts.isArrowFunction(value)) throw new Error(`${sourceFile.fileName}: option rule is not an inspectable arrow function`);
  const body = unwrapExpression(ts, value.body);
  if (body.kind === ts.SyntaxKind.NullKeyword) return [1, 'AcceptAny'];
  if (ts.isStringLiteral(body) || ts.isNoSubstitutionTemplateLiteral(body) || ts.isTemplateExpression(body)) return [4, 'RejectEveryDefinedValue'];
  if (!ts.isConditionalExpression(body)) throw new Error(`${sourceFile.fileName}: unrecognized option rule body`);
  const condition = unwrapExpression(ts, body.condition);
  const whenTrue = unwrapExpression(ts, body.whenTrue);
  const whenFalse = unwrapExpression(ts, body.whenFalse);
  const trueIsNull = whenTrue.kind === ts.SyntaxKind.NullKeyword;
  const falseIsNull = whenFalse.kind === ts.SyntaxKind.NullKeyword;
  const trueIsRejectReason = ts.isStringLiteral(whenTrue) || ts.isNoSubstitutionTemplateLiteral(whenTrue) || ts.isTemplateExpression(whenTrue);
  const falseIsRejectReason = ts.isStringLiteral(whenFalse) || ts.isNoSubstitutionTemplateLiteral(whenFalse) || ts.isTemplateExpression(whenFalse);
  if (ts.isCallExpression(condition) && ts.isIdentifier(condition.expression) && condition.expression.text === 'rejectsRecognizedOption' &&
      condition.arguments.length >= 1 && ts.isPropertyAccessExpression(unwrapExpression(ts, condition.arguments[0])) &&
      ts.isIdentifier(unwrapExpression(ts, condition.arguments[0]).expression) && unwrapExpression(ts, condition.arguments[0]).expression.text === 'RecognizedRule') {
    const ruleName = unwrapExpression(ts, condition.arguments[0]).name.text;
    const policy = recognizedRuleCodes.get(ruleName);
    if (!policy) throw new Error(`${sourceFile.fileName}: unknown RecognizedRule member ${ruleName}`);
    if ((trueIsRejectReason || (policy[0] === 5 && ts.isIdentifier(whenTrue))) && falseIsNull) return policy;
    throw new Error(`${sourceFile.fileName}: recognized option decision does not reject only when the generated rule says to reject`);
  }
  if (ts.isBinaryExpression(condition) && condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken && trueIsNull && falseIsRejectReason) {
    if (condition.right.kind === ts.SyntaxKind.TrueKeyword) return [3, 'RequireExactlyTrue'];
    if (ts.isStringLiteral(condition.right) && condition.right.text === 'core') return [6, 'RequireCoreText'];
    if (ts.isStringLiteral(condition.right) && condition.right.text === '1.2') return [7, 'RequireVersion12Text'];
    if (ts.isIdentifier(condition.right) && condition.right.text === 'CORE_SCHEMA') return [2, 'RequireCoreSchemaIdentity'];
  }
  if (ts.isIdentifier(condition) && value.parameters.length === 1 && ts.isIdentifier(value.parameters[0].name) && condition.text === value.parameters[0].name.text && falseIsNull && !trueIsNull) return [5, 'RejectTruthy'];
  throw new Error(`${sourceFile.fileName}: unrecognized option-rule conditional ${value.getText()}`);
}

function optionRulePolicies(ts, sourceFile, variableName, surface, helpers) {
  const scopedHelpers = new Map(helpers);
  const policies = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) scopedHelpers.set(declaration.name.text, declaration.initializer);
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== variableName || !ts.isObjectLiteralExpression(declaration.initializer)) continue;
      for (const property of declaration.initializer.properties) {
        const name = propertyName(ts, property);
        if (name === undefined || !ts.isPropertyAssignment(property)) throw new Error(`${sourceFile.fileName}: unsupported option-rule entry in ${variableName}`);
        try {
          policies.set(name, classifyOptionRule(ts, property.initializer, scopedHelpers, sourceFile));
        } catch (error) {
          throw new Error(`${sourceFile.fileName}: option rule ${name}: ${error.message}`);
        }
      }
    }
  }
  return policies;
}

function interfaceProperties(ts, sourceFile, interfaceName) {
  const found = new Set();
  for (const statement of sourceFile.statements) {
    if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== interfaceName) continue;
    for (const member of statement.members) {
      const name = propertyName(ts, member);
      if (name !== undefined) found.add(name);
    }
  }
  return found;
}

function classMembers(ts, sourceFile, className) {
  const found = new Set();
  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement) || statement.name?.text !== className) continue;
    for (const member of statement.members) {
      const name = ts.isConstructorDeclaration(member) ? 'constructor' : propertyName(ts, member);
      if (name !== undefined) found.add(name);
    }
  }
  return found;
}

function recognizedRuleEnumValues(ts, sourceFile) {
  const values = new Map();
  for (const statement of sourceFile.statements) {
    if (!ts.isEnumDeclaration(statement) || statement.name.text !== 'RecognizedRule') continue;
    if (!statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ConstKeyword)) throw new Error('RecognizedRule must remain a const enum');
    for (const member of statement.members) {
      const name = propertyName(ts, member);
      if (!name || !member.initializer || !ts.isNumericLiteral(member.initializer)) throw new Error('RecognizedRule members require explicit numeric values');
      values.set(name, Number(member.initializer.text));
    }
  }
  return values;
}

function deriveExpectedRows(ts, sourceOverrides = {}, enforceExportCounts = true) {
  const source = new Map();
  for (const relativePath of sourceFiles) {
    const sourceText = sourceOverrides[relativePath] ?? fs.readFileSync(path.join(root, relativePath), 'utf8');
    source.set(relativePath, ts.createSourceFile(relativePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
  }
  const actualRuleCodes = recognizedRuleEnumValues(ts, source.get('src/compat-options.ts'));
  const expectedRuleCodes = new Map([...recognizedRuleCodes].map(([name, [code]]) => [name, code]));
  if (JSON.stringify([...actualRuleCodes].sort()) !== JSON.stringify([...expectedRuleCodes].sort())) throw new Error('RecognizedRule const-enum mapping changed');
  const expected = new Map();
  const optionRuleHelpers = new Map();
  for (const sourceFile of source.values()) for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) optionRuleHelpers.set(declaration.name.text, declaration.initializer);
    }
  }
  const add = (id, kind, sourcePath, detail = {}) => {
    expected.set(id, { id, kind, source: sourcePath, ...detail });
  };
  const modules = [
    ['root', 'src/index.ts'],
    ['yaml', 'src/yaml-compat.ts'],
    ['js-yaml', 'src/js-yaml-compat.ts'],
  ];
  for (const [moduleName, relativePath] of modules) {
    const names = exportedNames(ts, source.get(relativePath));
    const expectedCounts = { root: 5, yaml: 4, 'js-yaml': 12 };
    const expectedDefaults = { root: 0, yaml: 4, 'js-yaml': 12 };
    const defaultCount = [...names.defaults.values()].reduce((sum, members) => sum + members.size, 0);
    if (enforceExportCounts && (names.runtime.size !== expectedCounts[moduleName] || defaultCount !== expectedDefaults[moduleName])) {
      throw new Error(`${moduleName}: AST export inventory produced ${names.runtime.size} named runtime exports/${defaultCount} default members; expected ${expectedCounts[moduleName]}/${expectedDefaults[moduleName]}`);
    }
    for (const name of names.runtime) add(`${moduleName}:runtime:${name}`, 'runtime-export', relativePath, { name });
    for (const name of names.types) add(`${moduleName}:type:${name}`, 'type-export', relativePath, { name });
    for (const [defaultName, members] of names.defaults) {
      for (const [key, target] of members) add(`${moduleName}:default:${key}`, 'default-alias', relativePath, { name: key, alias: defaultName, aliasTarget: target });
    }
  }

  const yaml = source.get('src/yaml-compat.ts');
  for (const name of interfaceProperties(ts, source.get('src/js-yaml-compat.ts'), 'Mark')) add(`js-yaml:property:Mark.${name}`, 'public-property', 'src/js-yaml-compat.ts', { name: `Mark.${name}` });
  for (const name of ['name', 'reason', 'mark']) add(`js-yaml:property:YAMLException.${name}`, 'public-property', 'src/js-yaml-compat.ts', { name: `YAMLException.${name}` });
  for (const name of classMembers(ts, source.get('src/js-yaml-compat.ts'), 'YAMLException')) add(`js-yaml:member:YAMLException.${name}`, 'public-member', 'src/js-yaml-compat.ts', { name: `YAMLException.${name}` });
  for (const name of classMembers(ts, source.get('src/js-yaml-compat.ts'), 'Schema')) add(`js-yaml:member:Schema.${name}`, 'public-member', 'src/js-yaml-compat.ts', { name: `Schema.${name}` });
  for (const name of interfaceProperties(ts, source.get('src/js-yaml-compat.ts'), 'TagDefinition')) add(`js-yaml:property:TagDefinition.${name}`, 'public-property', 'src/js-yaml-compat.ts', { name: `TagDefinition.${name}` });
  for (const name of interfaceProperties(ts, source.get('src/js-yaml-compat.ts'), 'LoadOptions')) add(`js-yaml:option:LoadOptions.${name}`, 'option-field', 'src/js-yaml-compat.ts', { name: `LoadOptions.${name}` });
  for (const name of interfaceProperties(ts, source.get('src/js-yaml-compat.ts'), 'DumpOptions')) add(`js-yaml:option:DumpOptions.${name}`, 'option-field', 'src/js-yaml-compat.ts', { name: `DumpOptions.${name}` });
  for (const [rules, sourcePath, prefix, surface] of [
    ['LOAD_OPTION_RULES', 'src/js-yaml-compat.ts', 'js-yaml:load-rule', 'JsLoad'],
    ['DUMP_OPTION_RULES', 'src/js-yaml-compat.ts', 'js-yaml:dump-rule', 'JsDump'],
    ['PARSE_OPTION_RULES', 'src/yaml-compat.ts', 'yaml:parse-rule', 'YamlRead'],
    ['STRINGIFY_OPTION_RULES', 'src/yaml-compat.ts', 'yaml:stringify-rule', 'YamlWrite'],
  ]) {
    for (const [name, policy] of optionRulePolicies(ts, source.get(sourcePath), rules, surface, optionRuleHelpers)) add(`${prefix}:${name}`, 'option-rule', sourcePath, { name, policyCode: policy[0], policyName: policy[1], surface });
  }
  for (const name of interfaceProperties(ts, yaml, 'CompatDocument')) add(`yaml:document-property:CompatDocument.${name}`, 'document-property', 'src/yaml-compat.ts', { name: `CompatDocument.${name}` });

  for (const id of [
    'root:route:parse', 'root:route:parseAll', 'root:route:stringify',
    'yaml:mode:parse-no-reviver', 'yaml:mode:parse-reviver',
    'yaml:mode:parseAllDocuments-success-error', 'yaml:mode:parseDocument-success-error',
    'yaml:mode:stringify-options',
    'js-yaml:mode:load', 'js-yaml:mode:loadAll-no-iterator', 'js-yaml:mode:loadAll-iterator', 'js-yaml:mode:dump',
    'cross:validation:prototype-option-lookup', 'cross:validation:own-enumerable-getters',
    'yaml:document:captured-contents', 'yaml:document:no-custom-toString',
    'js-yaml:callback:iterator-order-this-errors', 'yaml:callback:reviver-order-this-mutation-errors',
    'js-yaml:helpers:tag-factories', 'js-yaml:helpers:schema-constructor-withTags-identities',
    'js-yaml:helpers:tag-properties-and-ignored-options', 'js-yaml:exception:error-prototype-and-constructor-call',
    'yaml:document:property-descriptors', 'yaml:reviver:cyclic-graph-native-exhaustion',
    'root:options:effectful-read-order', 'root:writer:two-phase-host-reads',
    'root:errors:error-object-observation', 'build:export-object-observation',
    'build:package-exports', 'build:browser-global', 'root:namespace:no-default-export',
  ]) {
    const behavioralSource = id === 'root:namespace:no-default-export' ? 'src/index.ts'
      : id === 'root:options:effectful-read-order' ? 'src/dafny/surfaces/NativeSurface.dfy'
      : id === 'root:writer:two-phase-host-reads' ? 'src/dafny/core/Serializer.dfy'
      : id === 'root:errors:error-object-observation' ? 'src/errors.ts'
      : id === 'build:browser-global' ? 'tsup.config.ts'
      : id.startsWith('build:') ? 'package.json'
      : id.startsWith('cross:') ? 'src/compat-options.ts'
      : id.startsWith('js-yaml:') ? 'src/js-yaml-compat.ts'
      : id.startsWith('yaml:') ? 'src/yaml-compat.ts'
      : 'src/core.ts';
    add(id, 'behavioral-route', behavioralSource);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const [name, entry] of Object.entries(pkg.exports)) {
    add(`package:exports:${name}`, 'package-export', 'package.json', { name, target: entry });
    if (typeof entry === 'string') add(`package:export-target:${name}:target`, 'package-export-target', 'package.json', { name, target: entry });
    else for (const [condition, value] of Object.entries(entry)) {
      if (typeof value === 'string') add(`package:export-target:${name}:${condition}`, 'package-export-target', 'package.json', { name, target: value });
      else if (value && typeof value === 'object') for (const [subcondition, target] of Object.entries(value)) add(`package:export-target:${name}:${condition}:${subcondition}`, 'package-export-target', 'package.json', { name, target });
    }
  }
  for (const name of ['main', 'module', 'types', 'unpkg', 'jsdelivr', 'files']) add(`package:metadata:${name}`, 'package-metadata', 'package.json', { name, target: pkg[name] });
  return expected;
}

function validationErrors(manifest, expected) {
  const errors = [];
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.entries)) return ['manifest must have version 1 and an entries array'];
  const byId = new Map();
  for (const [index, entry] of manifest.entries.entries()) {
    if (!entry || typeof entry.id !== 'string') {
      errors.push(`entry ${index} has no string id`);
      continue;
    }
    if (byId.has(entry.id)) errors.push(`duplicate manifest row: ${entry.id}`);
    byId.set(entry.id, entry);
    if (!statusNames.has(entry.status)) errors.push(`${entry.id}: unknown status ${String(entry.status)}`);
    if (!entry.route || typeof entry.route !== 'string' || !entry.route.includes('#')) errors.push(`${entry.id}: route must name an actual source member with #`);
    if (!['behavior-summary-only', 'known-defect-described'].includes(entry.specificationStatus)) errors.push(`${entry.id}: missing or unknown specificationStatus`);
    if (entry.status === 'verified-local' && (!Array.isArray(entry.verifiedMethods) || entry.verifiedMethods.length === 0)) errors.push(`${entry.id}: verified-local requires named verifiedMethods`);
    if (entry.status !== 'verified-local' && Array.isArray(entry.verifiedMethods) && entry.verifiedMethods.length) errors.push(`${entry.id}: verifiedMethods contradict status ${entry.status}`);
    if (entry.status === 'blocked-known-defect' && (!entry.openDefect || entry.specificationStatus !== 'known-defect-described')) errors.push(`${entry.id}: blocked-known-defect requires an openDefect and known-defect-described status`);
    if (entry.status === 'verified-local' && entry.kind !== 'local-proof') errors.push(`${entry.id}: public inventory presence cannot establish a local proof claim`);
    if (['behavioral-route', 'option-rule'].includes(entry.kind)) errors.push(...formalRequirementErrors(entry));
    const sourceRow = expected.get(entry.id);
    if (!sourceRow) errors.push(`unknown manifest row not derived from source/package: ${entry.id}`);
    else if (entry.kind !== sourceRow.kind || entry.source !== sourceRow.source || entry.name !== sourceRow.name || entry.alias !== sourceRow.alias || entry.aliasTarget !== sourceRow.aliasTarget || entry.policyCode !== sourceRow.policyCode || entry.policyName !== sourceRow.policyName || entry.surface !== sourceRow.surface || JSON.stringify(entry.target) !== JSON.stringify(sourceRow.target)) errors.push(`${entry.id}: kind/source/name/alias/option-policy/package-target disagrees with AST/package inventory`);
    if (entry.route && !routeExists(entry.route)) errors.push(`${entry.id}: route target does not exist in its source`);
  }
  for (const id of expected.keys()) if (!byId.has(id)) errors.push(`missing manifest row: ${id}`);
  return errors;
}

function expectedConditionalMethods(entry) {
  if (entry.kind === 'option-rule') return ['SurfaceOptions.OwnRuleCode', 'SurfaceOptions.RejectRecognizedOption'];
  const routes = {
    'yaml:mode:parse-no-reviver': ['SurfaceOptions.SelectYamlParseOptions'],
    'yaml:mode:parse-reviver': ['SurfaceOptions.SelectYamlParseOptions'],
    'yaml:mode:stringify-options': ['SurfaceOptions.SelectYamlStringifyOptions'],
    'js-yaml:mode:loadAll-no-iterator': ['SurfaceOptions.SelectJsYamlLoadAllOptions'],
    'js-yaml:mode:loadAll-iterator': ['SurfaceOptions.SelectJsYamlLoadAllOptions'],
    'cross:validation:prototype-option-lookup': ['SurfaceOptions.RejectRecognizedOption', 'SurfaceOptions.RejectYamlOptionsPrimitive'],
    'cross:validation:own-enumerable-getters': ['SurfaceOptions.RejectRecognizedOption'],
  };
  return routes[entry.id] ?? [];
}

function formalRequirementErrors(entry) {
  const errors = [];
  const requirement = entry.formalRequirements;
  if (!requirement || !Array.isArray(requirement.targetMethods)) return [`${entry.id}: missing per-entry formal pre/post/effect requirements`];
  const methods = expectedConditionalMethods(entry);
  if (JSON.stringify([...requirement.targetMethods].sort()) !== JSON.stringify([...methods].sort())) errors.push(`${entry.id}: formal requirement method targets disagree with the scoped proof inventory`);
  const expectedStatus = methods.length ? 'pending-port-integration' : 'pending-design';
  if (requirement.status !== expectedStatus) errors.push(`${entry.id}: formal requirement status must remain ${expectedStatus}`);
  for (const clause of ['preconditions', 'successPostcondition', 'errorPostcondition', 'effectPostcondition']) {
    const reference = requirement[clause];
    if (typeof reference !== 'string' || !reference.includes('docs/contracts/')) errors.push(`${entry.id}: missing ${clause} contract reference`);
    else {
      const relativePath = reference.match(/docs\/contracts\/[a-z-]+\.md/)?.[0];
      if (!relativePath || !fs.existsSync(path.join(root, relativePath))) errors.push(`${entry.id}: ${clause} reference points to a missing contract page`);
    }
  }
  if (typeof requirement.scope !== 'string' || !requirement.scope.trim()) errors.push(`${entry.id}: missing formal proof scope disclosure`);
  return errors;
}

function stripDafnyComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function moduleBody(source, moduleName) {
  const cleanSource = stripDafnyComments(source);
  const start = new RegExp(`\\bmodule\\s+${moduleName}\\s*\\{`).exec(cleanSource);
  if (!start) return '';
  let depth = 1;
  let cursor = start.index + start[0].length;
  const bodyStart = cursor;
  while (cursor < cleanSource.length && depth > 0) {
    if (cleanSource[cursor] === '{') depth += 1;
    else if (cleanSource[cursor] === '}') depth -= 1;
    cursor += 1;
  }
  return depth === 0 ? cleanSource.slice(bodyStart, cursor - 1) : '';
}

function hasDafnyConstruct(source, moduleName, kind, name) {
  const body = moduleBody(source, moduleName);
  if (!body) return false;
  if (kind === 'method') {
    const declaration = new RegExp(`\\bmethod\\s+${name}\\b([^\\{]*)\\{`, 'm').exec(body);
    return Boolean(declaration && /\brequires\b/.test(declaration[1]) && /\bensures\b/.test(declaration[1]));
  }
  if (kind === 'datatype') return new RegExp(`\\bdatatype\\s+${name}\\b[^=]*=`, 'm').test(body);
  const declaration = new RegExp(`(?:\\bghost\\s+)?\\b${kind}\\s+${name}\\b[\\s\\S]*?\\{`, 'm').exec(body);
  return Boolean(declaration);
}

function formalCoverageErrors(manifest) {
  const declared = manifest.optionsTrancheConstructCoverage;
  if (!declared || !Array.isArray(declared.expected)) return ['optionsTrancheConstructCoverage must list exact expected options-tranche Dafny constructs'];
  if (!Array.isArray(declared.present)) return ['optionsTrancheConstructCoverage present must list exact found Dafny constructs'];
  const expectedNames = formalConstructs.map(([moduleName, kind, name]) => `${moduleName}.${name}:${kind}`).sort();
  const actualNames = declared.expected.map((entry) => `${entry.module}.${entry.name}:${entry.kind}`).sort();
  const errors = [];
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) errors.push('optionsTrancheConstructCoverage expected list disagrees with the checker inventory');
  const locations = {
    SurfaceValues: ['core/SurfaceValues.dfy', 'src/dafny/core/SurfaceValues.dfy'],
    SurfaceOptions: ['core/SurfaceOptions.dfy', 'src/dafny/core/SurfaceOptions.dfy'],
  };
  const content = new Map();
  for (const [moduleName, paths] of Object.entries(locations)) {
    const foundPath = paths.find((relativePath) => fs.existsSync(path.join(root, relativePath)));
    content.set(moduleName, foundPath ? fs.readFileSync(path.join(root, foundPath), 'utf8') : '');
  }
  const present = [];
  for (const [moduleName, kind, name] of formalConstructs) {
    const source = content.get(moduleName);
    if (hasDafnyConstruct(source, moduleName, kind, name)) present.push(`${moduleName}.${name}:${kind}`);
  }
  const expectedPresent = [...declared.present].sort();
  if (JSON.stringify(expectedPresent) !== JSON.stringify(present.sort())) errors.push(`optionsTrancheConstructCoverage present list disagrees with scoped Dafny definitions (found ${present.length}/${formalConstructs.length})`);
  if (declared.expectedCount !== formalConstructs.length || declared.presentCount !== present.length || declared.missingCount !== formalConstructs.length - present.length) errors.push('optionsTrancheConstructCoverage counts disagree with scoped Dafny definitions');
  if (declared.scope !== 'options-tranche-only') errors.push('optionsTrancheConstructCoverage must be labelled options-tranche-only');
  return errors;
}

function optionProofCoverageErrors(manifest) {
  const coverage = manifest.conditionalOptionProofCoverage;
  if (!coverage || !Array.isArray(coverage.methods)) return ['conditionalOptionProofCoverage must list exact selected method symbols'];
  const errors = [];
  if (JSON.stringify([...coverage.methods].sort()) !== JSON.stringify([...optionProofMethods].sort())) errors.push('conditionalOptionProofCoverage method list disagrees with the checker inventory');
  if (coverage.methodCount !== optionProofMethods.length || coverage.obligationCount !== 6) errors.push('conditionalOptionProofCoverage expected method/obligation counts disagree with verifier inventory');
  if (!['pending-port-integration', 'conditional-policy-only'].includes(coverage.status)) errors.push(`conditionalOptionProofCoverage has unsupported status ${String(coverage.status)}`);
  if (!Array.isArray(coverage.policyDefinitionSymbols) || JSON.stringify(coverage.policyDefinitionSymbols) !== JSON.stringify(['SurfaceOptions.OwnRuleCode'])) errors.push('conditionalOptionProofCoverage must include the OwnRuleCode policy definition');
  return errors;
}

function dafnyPolicyErrors(expected, sourceOverride) {
  const paths = ['core/SurfaceOptions.dfy', 'src/dafny/core/SurfaceOptions.dfy'];
  const sourcePath = paths.find((relativePath) => fs.existsSync(path.join(root, relativePath)));
  if (!sourcePath) return [];
  const source = sourceOverride ?? fs.readFileSync(path.join(root, sourcePath), 'utf8');
  const policyBody = /ghost function OwnRuleCode\([\s\S]*?\n  }/.exec(source)?.[0];
  if (!policyBody) return ['SurfaceOptions.OwnRuleCode definition is missing'];
  const dafnyPolicy = new Map();
  const duplicateRules = new Set();
  const surfaceBlocks = [...policyBody.matchAll(/if surface == V\.(JsLoad|JsDump|YamlRead) then([\s\S]*?)(?=\n\s*else if surface == V\.|\n\s*else\n)/g)];
  const finalSurface = /\n\s*else\n([\s\S]*?)\n\s*}/.exec(policyBody)?.[1];
  if (finalSurface) surfaceBlocks.push([null, 'YamlWrite', finalSurface]);
  for (const [, surface, block] of surfaceBlocks) {
    for (const [, keysText, codeText] of block.matchAll(/((?:key\s*==\s*"[^"]+"\s*(?:\|\|\s*)?)+)then\s*(\d+)/g)) {
      const code = Number(codeText);
      for (const [, key] of keysText.matchAll(/key\s*==\s*"([^"]+)"/g)) {
        const qualifiedKey = `${surface}:${key}`;
        if (dafnyPolicy.has(qualifiedKey)) duplicateRules.add(qualifiedKey);
        dafnyPolicy.set(qualifiedKey, code);
      }
    }
  }
  const tsPolicies = new Map();
  for (const row of expected.values()) if (row.kind === 'option-rule') {
    const key = `${row.surface}:${row.name}`;
    tsPolicies.set(key, row.policyCode);
  }
  const errors = [];
  for (const key of duplicateRules) errors.push(`SurfaceOptions.OwnRuleCode contains duplicate policy entries for ${key}`);
  for (const [key, code] of tsPolicies) {
    const [, surface, option] = /^([^:]+):(.+)$/.exec(key);
    const expectedCode = dafnyPolicy.get(`${surface}:${option}`);
    if (expectedCode !== code) errors.push(`SurfaceOptions.OwnRuleCode policy for ${surface}.${option} is ${String(expectedCode)}; TypeScript rule requires ${code}`);
  }
  for (const key of dafnyPolicy.keys()) if (!tsPolicies.has(key)) errors.push(`SurfaceOptions.OwnRuleCode contains unknown TypeScript option policy ${key}`);
  return errors;
}

function hasDirectNamedNode(ts, sourceFile, name) {
  for (const node of sourceFile.statements) {
    if (node.name && node.name.text === name) return true;
    if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return true;
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.some((element) => element.name.text === name)) return true;
  }
  return false;
}

function hasNestedNamedNode(ts, sourceFile, owner, member) {
  for (const node of sourceFile.statements) {
    if (node.name?.text === owner && (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))) {
      return node.members?.some((part) => (ts.isConstructorDeclaration(part) ? 'constructor' : propertyName(ts, part)) === member) ?? false;
    }
    if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== owner || !declaration.initializer) continue;
      const initializer = declaration.initializer;
      if (!ts.isObjectLiteralExpression(initializer)) return false;
      return initializer.properties.some((part) => propertyName(ts, part) === member);
    }
  }
  return false;
}

function routeExists(route) {
  const ts = loadTypeScript();
  const typed = /^(?:TS|TypeScript):([^#]+)#([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?$/.exec(route);
  if (typed) {
    const [, relativePath, owner, member] = typed;
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath)) return false;
    const sourceFile = ts.createSourceFile(relativePath, fs.readFileSync(absolutePath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    if (member) return hasNestedNamedNode(ts, sourceFile, owner, member);
    if (relativePath === 'tsup.config.ts' && owner === 'globalName') {
      let found = false;
      function visit(node) {
        if (ts.isPropertyAssignment(node) && propertyName(ts, node) === owner) found = true;
        if (!found) ts.forEachChild(node, visit);
      }
      visit(sourceFile);
      return found;
    }
    return hasDirectNamedNode(ts, sourceFile, owner);
  }
  const dafny = /^Dafny:([^#]+)#([A-Za-z_$][\w$]*)$/.exec(route);
  if (dafny) {
    const [, relativePath, symbol] = dafny;
    const absolutePath = path.join(root, relativePath);
    return fs.existsSync(absolutePath) && new RegExp(`\\b(?:method|function|predicate|lemma|datatype|class)\\s+${symbol}\\b`).test(fs.readFileSync(absolutePath, 'utf8'));
  }
  const packageMember = /^package\.json#(main|module|types|unpkg|jsdelivr|files)$/.exec(route);
  if (packageMember) return Object.hasOwn(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')), packageMember[1]);
  const packageExport = /^package\.json#exports\[("[^"]+")\](?:\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*))?$/.exec(route);
  if (packageExport) {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const entry = pkg.exports[JSON.parse(packageExport[1])];
    if (packageExport[2]) {
      let current = entry;
      for (const part of packageExport[2].split('.')) current = current && current[part];
      return current !== undefined;
    }
    return entry !== undefined;
  }
  return false;
}

function distributionErrors() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const requiredFiles = ['docs/contracts', 'scripts/public-surface-contract-manifest.json'];
  return requiredFiles.filter((file) => !pkg.files.includes(file)).map((file) => `package files list does not ship ${file}`);
}

function checkNegativeCases(manifest, expected, ts) {
  const base = validationErrors(manifest, expected);
  if (base.length) throw new Error(`self-test base manifest invalid: ${base.join('; ')}`);
  const missing = structuredClone(manifest);
  missing.entries.pop();
  if (!validationErrors(missing, expected).some((error) => error.startsWith('missing manifest row: '))) throw new Error('negative gate failed to reject a missing source row');
  const extra = structuredClone(manifest);
  extra.entries.push({ id: 'forged:surface', kind: 'runtime-export', source: 'src/index.ts', route: 'forged', status: 'specified-complete', contract: 'forged row' });
  if (!validationErrors(extra, expected).some((error) => error.startsWith('unknown manifest row not derived from source/package: '))) throw new Error('negative gate failed to reject an extra row');
  const inventedProof = structuredClone(manifest);
  const target = inventedProof.entries[0];
  target.status = 'verified-local';
  target.verifiedMethods = [];
  if (!validationErrors(inventedProof, expected).some((error) => error.includes('verified-local requires named verifiedMethods'))) throw new Error('negative gate failed to reject an unsupported proof claim');
  const unknownStatus = structuredClone(manifest);
  unknownStatus.entries[0].status = 'verified-everything';
  if (!validationErrors(unknownStatus, expected).some((error) => error.includes('unknown status'))) throw new Error('negative gate failed to reject an unknown status');
  const badRoute = structuredClone(manifest);
  badRoute.entries.find((entry) => entry.id === 'yaml:runtime:parse').route = 'TS:src/yaml-compat.ts#missingOperation';
  if (!validationErrors(badRoute, expected).some((error) => error.includes('route target does not exist'))) throw new Error('negative gate failed to reject a forged route');
  const badAlias = structuredClone(manifest);
  badAlias.entries.find((entry) => entry.id === 'yaml:default:parse').aliasTarget = 'stringify';
  if (!validationErrors(badAlias, expected).some((error) => error.includes('yaml:default:parse: kind/source/name/alias/option-policy/package-target'))) throw new Error('negative gate failed to reject a forged default alias');

  const jsYamlSource = fs.readFileSync(path.join(root, 'src/js-yaml-compat.ts'), 'utf8');
  const removedSource = jsYamlSource.replace('export const CORE_SCHEMA: Schema = new Schema();', 'const CORE_SCHEMA: Schema = new Schema();');
  if (removedSource === jsYamlSource) throw new Error('source-removal mutation fixture no longer matches');
  const removedRows = deriveExpectedRows(ts, { 'src/js-yaml-compat.ts': removedSource }, false);
  if (!validationErrors(manifest, removedRows).some((error) => error.includes('js-yaml:runtime:CORE_SCHEMA'))) throw new Error('negative gate failed to catch an exported const removed from source');
  const addedSource = `${jsYamlSource}\nexport function publicInventoryMutation(): undefined { return undefined; }\n`;
  const addedRows = deriveExpectedRows(ts, { 'src/js-yaml-compat.ts': addedSource }, false);
  if (!validationErrors(manifest, addedRows).some((error) => error.includes('js-yaml:runtime:publicInventoryMutation'))) throw new Error('negative gate failed to catch an export added to source');
  const yamlSource = fs.readFileSync(path.join(root, 'src/yaml-compat.ts'), 'utf8');
  const changedAliasSource = yamlSource.replace('const yamlCompat = { parse, parseAllDocuments, parseDocument, stringify };', 'const yamlCompat = { parse: stringify, parseAllDocuments, parseDocument, stringify };');
  if (changedAliasSource === yamlSource) throw new Error('default-alias mutation fixture no longer matches');
  const changedAliasRows = deriveExpectedRows(ts, { 'src/yaml-compat.ts': changedAliasSource }, false);
  if (!validationErrors(manifest, changedAliasRows).some((error) => error.includes('yaml:default:parse: kind/source/name/alias/option-policy/package-target'))) throw new Error('negative gate failed to catch a default alias initializer change');
  const changedPolicySource = yamlSource.replace('mapAsMap: activatesFeature(', 'mapAsMap: notYetSupported(');
  if (changedPolicySource === yamlSource) throw new Error('option-policy mutation fixture no longer matches');
  const changedPolicyRows = deriveExpectedRows(ts, { 'src/yaml-compat.ts': changedPolicySource }, false);
  if (!validationErrors(manifest, changedPolicyRows).some((error) => error.includes('yaml:parse-rule:mapAsMap: kind/source/name/alias/option-policy/package-target'))) throw new Error('negative gate failed to catch an option-policy change');
  const compatOptionsSource = fs.readFileSync(path.join(root, 'src/compat-options.ts'), 'utf8');
  const changedRuleEnum = compatOptionsSource.replace('AcceptAny = 1', 'AcceptAny = 4');
  if (changedRuleEnum === compatOptionsSource) throw new Error('recognized-rule enum mutation fixture no longer matches');
  let enumMutationRejected = false;
  try {
    deriveExpectedRows(ts, { 'src/compat-options.ts': changedRuleEnum }, false);
  } catch (error) {
    enumMutationRejected = String(error).includes('RecognizedRule const-enum mapping changed');
  }
  if (!enumMutationRejected) throw new Error('negative gate failed to catch a changed RecognizedRule const-enum value');
  const forgedPolicy = structuredClone(manifest);
  const policyRow = forgedPolicy.entries.find((entry) => entry.id === 'yaml:parse-rule:mapAsMap');
  policyRow.policyCode = 4;
  if (!validationErrors(forgedPolicy, expected).some((error) => error.includes('yaml:parse-rule:mapAsMap: kind/source/name/alias/option-policy/package-target'))) throw new Error('negative gate failed to catch a forged policy code');
  const missingFormalRequirement = structuredClone(manifest);
  delete missingFormalRequirement.entries.find((entry) => entry.id === 'root:route:parse').formalRequirements;
  if (!validationErrors(missingFormalRequirement, expected).some((error) => error.includes('root:route:parse: missing per-entry formal'))) throw new Error('negative gate failed to catch a missing per-entry formal requirement');
  const overstatedFormalRequirement = structuredClone(manifest);
  overstatedFormalRequirement.entries.find((entry) => entry.id === 'root:route:parse').formalRequirements.status = 'specified-complete';
  if (!validationErrors(overstatedFormalRequirement, expected).some((error) => error.includes('root:route:parse: formal requirement status must remain pending-design'))) throw new Error('negative gate failed to catch an overstated per-entry formal status');
  const optionsPaths = ['core/SurfaceOptions.dfy', 'src/dafny/core/SurfaceOptions.dfy'];
  const optionsPath = optionsPaths.find((relativePath) => fs.existsSync(path.join(root, relativePath)));
  if (optionsPath) {
    const optionsSource = fs.readFileSync(path.join(root, optionsPath), 'utf8');
    const changedCode = optionsSource.replace('if key == "schema" then 2', 'if key == "schema" then 1');
    if (changedCode === optionsSource) throw new Error('Dafny code-table mutation fixture no longer matches');
    if (!dafnyPolicyErrors(expected, changedCode).some((error) => error.includes('JsLoad.schema'))) throw new Error('negative gate failed to catch a Dafny option-policy code change');
  }
  const validMethod = 'module SurfaceOptions { method Selected() requires true ensures true { } }';
  const commentOnlyMethod = `module SurfaceOptions { // method Selected() requires true ensures true { }
}`;
  const uncontractedMethod = 'module SurfaceOptions { method Selected() requires true { } }';
  if (!hasDafnyConstruct(validMethod, 'SurfaceOptions', 'method', 'Selected')) throw new Error('formal source fixture failed to recognize a namespaced method with requires/ensures');
  if (hasDafnyConstruct(commentOnlyMethod, 'SurfaceOptions', 'method', 'Selected')) throw new Error('formal source gate accepted a comment-only method');
  if (hasDafnyConstruct(uncontractedMethod, 'SurfaceOptions', 'method', 'Selected')) throw new Error('formal source gate accepted a method without ensures');
}

function main() {
  const ts = loadTypeScript();
  const expected = deriveExpectedRows(ts);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.contractCompleteness || manifest.contractCompleteness.behavioralSpecification === 'complete' || !Array.isArray(manifest.contractCompleteness.unresolvedFormalContracts) || manifest.contractCompleteness.unresolvedFormalContracts.length === 0) {
    process.stderr.write('manifest must disclose remaining formal-contract gaps\n');
    process.exitCode = 1;
    return;
  }
  if (!Array.isArray(manifest.contractCompleteness.verifiedPublicOperations) || manifest.contractCompleteness.verifiedPublicOperations.length !== 0) {
    process.stderr.write('this snapshot has no verified public operations; do not infer proofs from inventory rows\n');
    process.exitCode = 1;
    return;
  }
  const errors = validationErrors(manifest, expected);
  errors.push(...distributionErrors());
  errors.push(...formalCoverageErrors(manifest));
  errors.push(...optionProofCoverageErrors(manifest));
  errors.push(...dafnyPolicyErrors(expected));
  if (errors.length) {
    process.stderr.write(`${errors.map((error) => `- ${error}`).join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  checkNegativeCases(manifest, expected, ts);
  const mutationCount = 17 + (fs.existsSync(path.join(root, 'src/dafny/core/SurfaceOptions.dfy')) || fs.existsSync(path.join(root, 'core/SurfaceOptions.dfy')) ? 1 : 0);
  process.stdout.write(`Public contract inventory covers ${expected.size} AST/package-derived rows; options tranche definitions present: ${manifest.optionsTrancheConstructCoverage.presentCount}/${formalConstructs.length}; ${mutationCount} fail-closed source/manifest mutation cases passed. This does not measure full public-surface formal coverage.\n`);
}

main();
