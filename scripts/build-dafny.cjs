'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const COMPILER_VERSION = '4.11.0';
const SOURCES = [
  'src/dafny/core/Native.dfy',
  'src/dafny/core/TagValues.dfy',
  'src/dafny/core/Engine.dfy',
  'src/dafny/core/Serializer.dfy',
  'src/dafny/core/SurfaceValues.dfy',
  'src/dafny/core/SurfaceOptions.dfy',
  'src/dafny/core/SurfaceHelpers.dfy',
  'src/dafny/core/SurfaceErrors.dfy',
  'src/dafny/core/SurfaceHost.dfy',
  'src/dafny/core/SurfaceModel.dfy',
  'src/dafny/core/Binary64Scale.dfy',
  'src/dafny/core/NativeBudgetContracts.dfy',
  'src/dafny/core/NativeContracts.dfy',
  'src/dafny/core/FacadeFlow.dfy',
  'src/dafny/core/FacadeContracts.dfy',
  'src/dafny/core/PublicObjects.dfy',
  'src/dafny/core/ObjectsAndErrors.dfy',
  'src/dafny/core/ErrorTranslation.dfy',
  'src/dafny/core/HostObservation.dfy',
  'src/dafny/core/SurfaceWitness.dfy',
  'src/dafny/core/NativeTraceLemmas.dfy',
  'src/dafny/core/NativePhaseIntro.dfy',
  'src/dafny/core/NativePrefixComposition.dfy',
  'src/dafny/core/NativeParseComposition.dfy',
  'src/dafny/core/NativeParseTransport.dfy',
  'src/dafny/core/NativeErrorTextContracts.dfy',
  'src/dafny/core/RawMarkContracts.dfy',
  'src/dafny/surfaces/NativeSurface.dfy',
];
const OUTPUT = 'src/dafny/generated/engine.js';
const MODULES = new Set(['TagValues', 'DafnyCore', 'Serializer', 'SurfaceOptions', 'SurfaceHelpers', 'SurfaceErrors', 'NativeSurface']);
const OMITTED = new Set([
  '_dafny', '_System', '_module', 'SurfaceValues', 'SurfaceHost',
  'SurfaceModel', 'Binary64Scale', 'NativeBudgetContracts', 'NativeContracts', 'FacadeFlow', 'FacadeContracts',
  'PublicObjects', 'ObjectsAndErrors', 'ErrorTranslation',
  'HostObservation', 'SurfaceWitness',
  'NativeTraceLemmas',
  'NativePhaseIntro',
  'NativePrefixComposition',
  'NativeParseComposition',
  'NativeParseTransport',
  'NativeErrorTextContracts',
  'RawMarkContracts',
]);
const OMITTED_MODEL_MODULES = new Set([...OMITTED].filter(name =>
  !['_dafny', '_System', '_module', 'SurfaceHost'].includes(name)));
const DAFNY_RUNTIME_SITES = {
  areEqual: {
    'Helpers.BuildOmap': 1,
    'Helpers.ValidatePairs': 1,
    'Engine.IsNullWord': 5,
    'Engine.IsBoolWord': 6,
    'Engine.ResolvePlainText': 1,
    'Engine.ScanTag': 1,
    'Engine.ApplyScalarTag': 20,
    'Engine.ParseTaggedFlowContent': 4,
    'Engine.ParseFlowMap': 1,
    'Engine.ParseBlockScalar': 1,
    'Engine.ParseTagDirectiveArgs': 2,
    'Engine.ParseDirectives': 2,
    'Engine.ApplyCollectionTag': 24,
    'Engine.ParseBlockNode': 2,
    'Engine.ParseTaggedBlockNode': 7,
    'Engine.ParseBlockMapBody': 1,
    'Writer.LooksLikeTypedScalar': 10,
    'Writer.WriteRootStringScalar': 2,
    'Writer.WriteBinaryScalar': 1,
  },
  EuclideanDivisionNumber: {
    'Helpers.DecodeBinary': 3,
    'Writer.HexEscape': 1,
    'Writer.EncodeBase64': 8,
  },
  EuclideanModuloNumber: {
    'Helpers.DecodeBinary': 3,
    'Writer.HexEscape': 1,
    'Writer.EncodeBase64': 6,
  },
};

function sourceDigest() {
  const hash = crypto.createHash('sha256');
  for (const filename of SOURCES) {
    hash.update(filename);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(ROOT, filename)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function statementName(statement) {
  if (!ts.isVariableStatement(statement)) return undefined;
  const declarations = statement.declarationList.declarations;
  if (declarations.length !== 1 || !ts.isIdentifier(declarations[0].name)) return undefined;
  return declarations[0].name.text;
}

function validateNativeTypeModule(statement, source) {
  const assignments = [...statement.getText(source).matchAll(/\$module\.([A-Za-z_$][\w$]*)\s*=/g)].map(match => match[1]);
  const expected = ['Counter', 'Index', 'Unit'];
  if (assignments.length !== expected.length || expected.some(name => !assignments.includes(name))) {
    throw new Error(`unsupported generated Native module contents: ${assignments.join(', ')}`);
  }
}

function lowerDafnyRuntime(sourceText) {
  const source = ts.createSourceFile('lowering.js', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const seen = Object.fromEntries(Object.keys(DAFNY_RUNTIME_SITES).map(name => [name, new Map()]));
  const replacements = {
    areEqual: 'jsEqual',
    EuclideanDivisionNumber: 'euclideanDivisionNumber',
    EuclideanModuloNumber: 'euclideanModuloNumber',
  };
  function collectSites(node, className = '', methodName = '') {
    if (ts.isClassExpression(node) || ts.isClassDeclaration(node)) className = node.name?.text || className;
    if (ts.isMethodDeclaration(node)) methodName = node.name?.getText(source) || methodName;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) && node.expression.expression.text === '_dafny') {
      const helper = node.expression.name.text;
      if (!seen[helper]) throw new Error(`unsupported Dafny runtime call _dafny.${helper}`);
      const key = `${className}.${methodName}`;
      const map = seen[helper];
      map.set(key, (map.get(key) || 0) + 1);
    }
    ts.forEachChild(node, child => collectSites(child, className, methodName));
  }
  collectSites(source);
  const transformer = context => root => {
    const visit = node => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) && node.expression.expression.text === '_dafny') {
        const name = node.expression.name.text;
        if (!replacements[name]) throw new Error(`unsupported reachable Dafny runtime call _dafny.${name}`);
        const callee = ts.factory.createPropertyAccessExpression(
          ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('Native'), '__default'), replacements[name]);
        return ts.factory.updateCallExpression(node, callee, node.typeArguments, node.arguments.map(argument => ts.visitNode(argument, visit)));
      }
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === '_dafny') {
        if (node.name.text === 'ZERO' || node.name.text === 'ONE') {
          return ts.factory.createNumericLiteral(node.name.text === 'ZERO' ? '0' : '1');
        }
        throw new Error(`unsupported Dafny runtime value _dafny.${node.name.text}`);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit);
  };
  const result = ts.transform(source, [transformer]);
  const lowered = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(result.transformed[0]);
  result.dispose();
  for (const name of Object.keys(replacements)) {
    const actual = Object.fromEntries(seen[name]);
    const normalize = sites => Object.fromEntries(Object.entries(sites).sort(([left], [right]) => left.localeCompare(right)));
    if (JSON.stringify(normalize(actual)) !== JSON.stringify(normalize(DAFNY_RUNTIME_SITES[name]))) {
      throw new Error(`Dafny runtime helper callsites changed for ${name}: ${JSON.stringify(actual)}`);
    }
  }
  if (lowered.includes('_dafny')) throw new Error('Dafny runtime reference remains after the audited lowering pass');
  assertNoOmittedModelReferences(lowered);
  return lowered;
}

function assertNoOmittedModelReferences(sourceText, additionalOmitted = []) {
  const omittedModules = new Set([...OMITTED_MODEL_MODULES, ...additionalOmitted]);
  const source = ts.createSourceFile('omitted-module-check.js', sourceText,
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (source.parseDiagnostics.length) throw new Error('lowered Dafny output was not valid JavaScript');
  function visit(node) {
    if (ts.isIdentifier(node) && omittedModules.has(node.text)) {
      throw new Error(`omitted model/proof module ${node.text} remains reachable in generated output`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

function extractModules(generated) {
  const source = ts.createSourceFile('generated.js', generated, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (source.parseDiagnostics.length) throw new Error('Dafny output was not valid JavaScript');
  const retained = [];
  const seen = new Set();
  for (const statement of source.statements) {
    const name = statementName(statement);
    if (ts.isExpressionStatement(statement) && /^BigNumber\.config\(/.test(statement.expression.getText(source))) continue;
    if (name === 'BigNumber') {
      const text = statement.getText(source);
      if (!/require\(['"]bignumber\.js['"]\)/.test(text)) throw new Error('unsupported BigNumber binding shape');
      continue;
    }
    if (name === 'Native') {
      validateNativeTypeModule(statement, source);
      continue;
    }
    if (name && OMITTED.has(name)) continue;
    if (!name || !MODULES.has(name) || seen.has(name)) {
      throw new Error(`unsupported Dafny top-level output shape at ${statement.getText(source).slice(0, 100)}`);
    }
    seen.add(name);
    retained.push(statement.getText(source));
  }
  for (const name of MODULES) if (!seen.has(name)) throw new Error(`Dafny output is missing module binding ${name}`);
  return lowerDafnyRuntime(retained.join('\n\n'));
}

function extract(generated, digest) {
  const lowered = extractModules(generated);
  const shape = require('./dafny-shape-transform.cjs').transformGenerated(
    lowered, fs.readFileSync(path.join(ROOT, 'src/dafny/native.ts'), 'utf8'));
  const nativeText = fs.readFileSync(path.join(ROOT, 'src/dafny/native.ts'), 'utf8');
  const surfaceBindings = {
    surfaceCaptureEndStream: 'nativeSurfaceCaptureEndStream',
    surfaceCaptureIsArray: 'nativeSurfaceCaptureIsArray',
    surfaceCaptureNormalizationRecord: 'nativeSurfaceCaptureNormalizationRecord',
    surfaceCaptureParseAll: 'nativeSurfaceCaptureParseAll',
    surfaceCaptureParseSingle: 'nativeSurfaceCaptureParseSingle',
    surfaceCaptureReset: 'nativeSurfaceCaptureReset',
    surfaceCaptureTypeError: 'nativeSurfaceCaptureTypeError',
    surfaceCaptureWriterStringify: 'nativeSurfaceCaptureWriterStringify',
    surfaceCompletionIsThrown: 'nativeSurfaceCompletionIsThrown',
    surfaceCompletionValue: 'nativeSurfaceCompletionValue',
    surfaceIsExactlyTrue: 'nativeSurfaceIsExactlyTrue',
    surfaceIsNullish: 'nativeSurfaceIsNullish',
    surfaceIsString: 'nativeSurfaceIsString',
    surfaceIsTruthy: 'nativeSurfaceIsTruthy',
    surfaceMultiplyBy1024: 'nativeSurfaceMultiplyBy1024',
    surfaceNormalizationBudget: 'nativeSurfaceNormalizationBudget',
    surfaceNormalizationIntern: 'nativeSurfaceNormalizationIntern',
    surfaceNormalizationStrict: 'nativeSurfaceNormalizationStrict',
    surfaceReadProperty: 'nativeSurfaceReadProperty',
    surfaceReturnedString: 'nativeSurfaceReturnedString',
    surfaceTemplateString: 'nativeSurfaceTemplateString',
  };
  const expectedSurfaceSites = {
    surfaceCaptureEndStream: 1, surfaceCaptureIsArray: 1, surfaceCaptureNormalizationRecord: 1,
    surfaceCaptureParseAll: 1, surfaceCaptureParseSingle: 1, surfaceCaptureReset: 1,
    surfaceCaptureTypeError: 2, surfaceCaptureWriterStringify: 1,
    surfaceCompletionIsThrown: 17, surfaceCompletionValue: 15, surfaceIsExactlyTrue: 1,
    surfaceIsNullish: 4, surfaceIsString: 1, surfaceIsTruthy: 2, surfaceMultiplyBy1024: 1,
    surfaceNormalizationBudget: 1, surfaceNormalizationIntern: 1, surfaceNormalizationStrict: 1,
    surfaceReadProperty: 7, surfaceReturnedString: 2, surfaceTemplateString: 3,
  };
  const ts = require('typescript');
  const source = ts.createSourceFile('generated.js', shape.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (source.parseDiagnostics.length) throw new Error('generated surface adapter was not valid JavaScript');
  const actualSurfaceSites = Object.create(null);
  const aliases = Object.create(null);
  for (const [index, [member, binding]] of Object.entries(surfaceBindings).entries()) {
    if (!nativeText.includes(`const ${binding} =`)) throw new Error(`missing native surface binding ${binding}`);
    aliases[member] = `n${shape.nativeImports.length + index}`;
  }
  function rewrite(node, context) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        ts.isPropertyAccessExpression(node.expression.expression) &&
        ts.isIdentifier(node.expression.expression.expression) && node.expression.expression.expression.text === 'SurfaceHost' &&
        node.expression.expression.name.text === '__default') {
      const member = node.expression.name.text;
      if (!Object.hasOwn(surfaceBindings, member)) throw new Error(`unmanifested SurfaceHost.${member}`);
      actualSurfaceSites[member] = (actualSurfaceSites[member] || 0) + 1;
      return ts.factory.updateCallExpression(node, ts.factory.createIdentifier(aliases[member]), node.typeArguments,
        node.arguments.map(arg => ts.visitNode(arg, child => rewrite(child, context))));
    }
    return ts.visitEachChild(node, child => rewrite(child, context), context);
  }
  const result = ts.transform(source, [context => root => ts.visitNode(root, node => rewrite(node, context))]);
  const surfaceText = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(result.transformed[0]);
  result.dispose();
  assertNoOmittedModelReferences(surfaceText, ['SurfaceHost']);
  const sort = obj => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
  if (JSON.stringify(sort(actualSurfaceSites)) !== JSON.stringify(sort(expectedSurfaceSites))) {
    throw new Error(`SurfaceHost callsite inventory changed: ${JSON.stringify(actualSurfaceSites)}`);
  }
  const surfaceImports = Object.entries(surfaceBindings).map(([member, binding]) => ({ binding, alias: aliases[member] }));
  const allImports = [...shape.nativeImports, ...surfaceImports];
  const imports = allImports.map(({ binding, alias }) => `${binding} as ${alias}`).join(', ');
  if (!imports) throw new Error('generated Dafny output has no native helper imports');
  return `// Dafny program compiled into JavaScript by Dafny ${COMPILER_VERSION}.\n// Copyright by the contributors to the Dafny Project.\n// SPDX-License-Identifier: MIT\n// Sources sha256 ${digest}; extraction and guarded output-shape lowering are audited in scripts/build-dafny.cjs.\nimport { ${imports} } from '../native.ts';\n\n${surfaceText}\n\nexport { DafnyCore, Serializer, SurfaceOptions, SurfaceHelpers, SurfaceErrors, NativeSurface };\n`;
}

function main() {
  const check = process.argv.includes('--check');
  const writeShapeManifest = process.argv.includes('--write-shape-manifest');
  const inputIndex = process.argv.indexOf('--input');
  if (inputIndex < 0 || !process.argv[inputIndex + 1]) throw new Error('the compiler wrapper must pass --input <Dafny JS output>');
  const digest = sourceDigest();
  const compilerOutput = fs.readFileSync(process.argv[inputIndex + 1], 'utf8');
  if (writeShapeManifest) {
    if (check) throw new Error('--write-shape-manifest cannot be combined with --check');
    const lowered = extractModules(compilerOutput);
    const manifestPath = path.join(ROOT, 'scripts/dafny-shape-manifest.json');
    const transform = require('./dafny-shape-transform.cjs');
    const manifest = transform.createManifest(lowered, fs.readFileSync(path.join(ROOT, 'src/dafny/native.ts'), 'utf8'));
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    process.stdout.write(`Wrote reviewed-shape candidate ${path.relative(ROOT, manifestPath)} from Dafny ${COMPILER_VERSION}; update and review its guard digest before generation\n`);
    return;
  }
  const artifact = extract(compilerOutput, digest);
  const outputPath = path.join(ROOT, OUTPUT);
  if (check) {
    const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
    if (current !== artifact) throw new Error(`${OUTPUT} is stale; run pnpm dafny:generate`);
    process.stdout.write(`Dafny ${COMPILER_VERSION} output is reproducible (${digest})\n`);
  } else {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, artifact);
    process.stdout.write(`Generated ${OUTPUT} from ${digest} with Dafny ${COMPILER_VERSION}\n`);
  }
}

if (require.main === module) {
  try { main(); }
  catch (error) { process.stderr.write(`Dafny generation: ${error.message}\n`); process.exitCode = 1; }
}

module.exports = { assertNoOmittedModelReferences, OMITTED_MODEL_MODULES };
