import { readFileSync } from 'node:fs';
import { Native } from '../../src/dafny/native-diagnostics.ts';

const sourceUrl = new URL('../../src/dafny/generated/engine.js', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8');
const shape = JSON.parse(readFileSync(new URL('../../scripts/dafny-shape-manifest.json', import.meta.url), 'utf8'));
const engineMethods = shape.methodRenames['DafnyCore.Engine'];
const engineFields = shape.fieldRenames.Engine;
if (!engineMethods) throw new Error('shape manifest does not contain the generated Engine method map');
if (!engineFields) throw new Error('shape manifest does not contain the generated Engine field map');

export function loadGeneratedEngine(overrides = {}) {
  const importPattern = /^import \{ ([^\n]+) \} from '\.\.\/native\.ts';$/m;
  const exportLine = 'export { DafnyCore, Serializer, SurfaceOptions, SurfaceHelpers, SurfaceErrors };';
  const importMatch = source.match(importPattern);
  if (!importMatch || !source.includes(exportLine)) {
    throw new Error('generated engine module shape changed; update this diagnostic loader');
  }
  const module = { exports: {} };
  const bindings = importMatch[1].split(', ').map(specifier => {
    const match = specifier.match(/^(native[\w$]+) as (n\d+)$/);
    if (!match) throw new Error(`unsupported generated native import ${specifier}`);
    const [, binding, alias] = match;
    const suffix = binding.slice('native'.length);
    const member = suffix[0] === '_' ? suffix : suffix[0].toLowerCase() + suffix.slice(1);
    const value = Object.hasOwn(overrides, member) ? overrides[member] : Native.__default[member];
    return { alias, value };
  });
  const executable = source
    .replace(importPattern, '')
    .replace(exportLine, 'module.exports = { DafnyCore, Serializer, SurfaceOptions, SurfaceHelpers, SurfaceErrors };');
  new Function(...bindings.map(({ alias }) => alias), 'module', executable)(...bindings.map(({ value }) => value), module);
  return {
    ...module.exports,
    engineMethod(instance, name) {
      const generatedName = engineMethods[name];
      if (!generatedName || typeof instance[generatedName] !== 'function') {
        throw new Error(`generated Engine method map is missing ${name}`);
      }
      return instance[generatedName].bind(instance);
    },
    setEngineField(instance, name, value) {
      const generatedName = engineFields[name] ?? name;
      instance[generatedName] = value;
    },
  };
}
