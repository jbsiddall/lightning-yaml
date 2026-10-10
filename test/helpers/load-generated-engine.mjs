import { readFileSync } from 'node:fs';
import { Native } from '../../src/dafny/native.ts';

const sourceUrl = new URL('../../src/dafny/generated/engine.js', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8');
const shape = JSON.parse(readFileSync(new URL('../../scripts/dafny-shape-manifest.json', import.meta.url), 'utf8'));
const engineMethods = shape.methodRenames['DafnyCore.Engine'];
if (!engineMethods) throw new Error('shape manifest does not contain the generated Engine method map');

export function loadGeneratedEngine(overrides = {}) {
  const importLine = "import { Native } from '../native.ts';";
  const exportLine = 'export { DafnyCore, Serializer };';
  if (!source.includes(importLine) || !source.includes(exportLine)) {
    throw new Error('generated engine module shape changed; update this diagnostic loader');
  }
  const module = { exports: {} };
  const wiredNative = {
    __default: { ...Native.__default, ...overrides },
  };
  const executable = source
    .replace(importLine, '')
    .replace(exportLine, 'module.exports = { DafnyCore, Serializer };');
  new Function('Native', 'module', executable)(wiredNative, module);
  return {
    ...module.exports,
    engineMethod(instance, name) {
      const generatedName = engineMethods[name];
      if (!generatedName || typeof instance[generatedName] !== 'function') {
        throw new Error(`generated Engine method map is missing ${name}`);
      }
      return instance[generatedName].bind(instance);
    },
  };
}
