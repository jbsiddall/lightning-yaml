const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require(path.resolve('node_modules/typescript'));
const dir = path.resolve('.sandbox-tmp/type-audit');
fs.mkdirSync(dir, { recursive: true });
const source = fs.readFileSync('experiments/dafny-hotpath/DirectCast.js', 'utf8');
const parsed = ts.createSourceFile('DirectCast.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let kernel;
function visit(node) {
  if (ts.isClassExpression(node) && node.name?.text === '__default' &&
      node.members.some(m => m.name?.getText(parsed) === 'FlowPlainLine')) kernel = node.getText(parsed);
  ts.forEachChild(node, visit);
}
visit(parsed);
assert(kernel, 'Generated kernel class not found');
fs.writeFileSync(path.join(dir, 'official.js'), `export const Kernel = ${kernel};\n`);
const options = { allowJs: true, declaration: true, emitDeclarationOnly: true,
  strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  outDir: path.join(dir, 'types'), skipLibCheck: false, types: [] };
const declarationProgram = ts.createProgram([path.join(dir, 'official.js')], options);
assert.equal(ts.getPreEmitDiagnostics(declarationProgram).length, 0);
assert.equal(declarationProgram.emit().emitSkipped, false);
const declarations = fs.readFileSync(path.join(dir, 'types/official.d.ts'), 'utf8');
assert.match(declarations, /FlowPlainLine\(s: any, from: any\): number/);
console.log(JSON.stringify({ officialInferredDeclarations: declarations.trim() }));

// Source-derived fixtures, not output from executing the community generator.
// Pinned emitter paths and their scope are recorded in the report.
const community = `
export type Option<T> = { type: 'None' } | { type: 'Some'; value: T };
export interface Settings { value: Option<string> }
export const identity = (x: unknown): unknown => x;
export const toJson = <T>(value: any, T_toJson: (x: any) => any): Option<T> => {
  return { type: 'Some', value: T_toJson(value.dtor_value) };
};
const settings: Settings = { value: { type: 'None' } };
// @ts-expect-error Emitted fields are required, although preprocessing reads missing fields as undefined.
const omitted: Settings = {};
// @ts-expect-error The emitted Option type excludes the null input accepted by --null-options.
const nullable: Settings = { value: null };
// @ts-expect-error Likewise for undefined.
const undefinedField: Settings = { value: undefined };
// @ts-expect-error A generic identity relationship is lost.
const sameString: string = identity('a');
// No diagnostic: any prevents checking the callback against T.
export const wrong: Option<string> = toJson<string>({ dtor_value: 7 }, () => 7);
`;
const facade = `
import { Kernel } from './official.js';
export interface ScanOptions { enabled?: boolean | undefined }
export function scan(s: string, from = 0, options?: ScanOptions): number {
  if (typeof s !== 'string' || s.length >= 2147483647 || !Number.isInteger(from) ||
      from < 0 || from > s.length) throw new TypeError('Invalid scan input');
  if (options?.enabled === false) return from;
  const result: unknown = Kernel.FlowPlainLine(s, from);
  if (typeof result !== 'number' || !Number.isInteger(result) || result < from || result > s.length)
    throw new TypeError('Invalid generated result');
  return result;
}
const n: number = scan('a,tail');
scan('a', undefined, {enabled: undefined});
// @ts-expect-error Wrong input type.
scan(3);
// @ts-expect-error null is not an optional argument.
scan('a', null);
// @ts-expect-error Wrong option value.
scan('a', 0, {enabled: 'yes'});
// @ts-expect-error Optional property must be checked before use.
const flag: boolean = ({} as ScanOptions).enabled;
// @ts-expect-error A parse-like unknown result cannot claim a user schema.
const doc: {name: string} = (null as unknown);
`;
fs.writeFileSync(path.join(dir, 'community.ts'), community);
fs.writeFileSync(path.join(dir, 'facade.ts'), facade);
const program = ts.createProgram([path.join(dir, 'community.ts'), path.join(dir, 'facade.ts')],
  { ...options, allowJs: true, emitDeclarationOnly: false, declaration: false, noEmit: true });
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) console.log(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCurrentDirectory: () => dir, getCanonicalFileName: x => x, getNewLine: () => '\n' }));
assert.equal(diagnostics.length, 0, 'Strict type fixtures failed or an expected error stopped being detected');
const js = ts.transpileModule(community, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }}).outputText;
const communityExports = {};
new Function('exports', js)(communityExports);
assert.deepEqual(communityExports.wrong, {type: 'Some', value: 7});
console.log(JSON.stringify({ typescript: ts.version, strict: true,
  exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
  communityFixtures: 'source-derived; expected typing limitations reproduced',
  uncheckedConverterResult: communityExports.wrong, typedFacadeConsumerChecks: 'passed',
  scope: 'official generated kernel extraction + emitter-derived fixtures; not a full dafny2js build or YAML rewrite' }));
