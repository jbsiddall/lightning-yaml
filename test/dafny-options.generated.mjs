import assert from 'node:assert/strict';
import test from 'node:test';
import { SurfaceOptions } from '../src/dafny/generated/engine.js';
import * as yaml from '../src/yaml-compat.ts';
import * as jsYaml from '../src/js-yaml-compat.ts';

const options = SurfaceOptions.__default;

test('generated yaml parse selector preserves third-slot precedence and function shorthand', () => {
  assert.equal(options.SelectYamlParseOptions(false, true, true), true);
  assert.equal(options.SelectYamlParseOptions(false, true, false), false);
  assert.equal(options.SelectYamlParseOptions(true, true, true), false);
  assert.equal(options.SelectYamlParseOptions(false, false, true), false);
});

test('generated yaml stringify selector excludes functions and arrays before selecting options', () => {
  assert.equal(options.SelectYamlStringifyOptions(false, false, true, true), true);
  assert.equal(options.SelectYamlStringifyOptions(true, false, true, true), false);
  assert.equal(options.SelectYamlStringifyOptions(false, true, true, true), false);
  assert.equal(options.SelectYamlStringifyOptions(false, false, true, false), false);
});

test('generated js-yaml loadAll selector uses the object second slot', () => {
  assert.equal(options.SelectJsYamlLoadAllOptions(true), true);
  assert.equal(options.SelectJsYamlLoadAllOptions(false), false);
});

test('generated yaml stringify primitive gate preserves loose-nullish and object cases', () => {
  assert.equal(options.RejectYamlOptionsPrimitive(true, false), false);
  assert.equal(options.RejectYamlOptionsPrimitive(false, true), false);
  assert.equal(options.RejectYamlOptionsPrimitive(false, false), true);
});

test('generated recognized option decision implements all seven rule codes', () => {
  const decide = (code, value = {}) => options.RejectRecognizedOption(
    code,
    value.undefinedValue ?? false,
    value.truthyValue ?? true,
    value.coreSchemaIdentity ?? false,
    value.exactlyTrue ?? false,
    value.coreText ?? false,
    value.version12Text ?? false,
  );
  assert.equal(decide(1), false);
  assert.equal(decide(1, { undefinedValue: true, truthyValue: false }), false);
  assert.equal(decide(2, { coreSchemaIdentity: true }), false);
  assert.equal(decide(2), true);
  assert.equal(decide(3, { exactlyTrue: true }), false);
  assert.equal(decide(3, { truthyValue: true }), true);
  assert.equal(decide(4, { truthyValue: false }), true);
  assert.equal(decide(4, { undefinedValue: true, truthyValue: false }), false);
  assert.equal(decide(5, { truthyValue: false }), false);
  assert.equal(decide(5, { truthyValue: true }), true);
  assert.equal(decide(6, { coreText: true }), false);
  assert.equal(decide(6), true);
  assert.equal(decide(7, { version12Text: true }), false);
  assert.equal(decide(7), true);
});

function assertPublicRouteCalls(methodName, invoke) {
  const sentinel = Object.freeze({ route: methodName });
  const original = options[methodName];
  options[methodName] = () => { throw sentinel; };
  try {
    assert.throws(invoke, (error) => error === sentinel, `${methodName} was bypassed by the public API`);
  } finally {
    options[methodName] = original;
  }
}

test('public yaml and js-yaml overloads call the generated option selectors', () => {
  assertPublicRouteCalls('SelectYamlParseOptions', () => yaml.parse('a: 1', undefined, {}));
  assertPublicRouteCalls('SelectYamlStringifyOptions', () => yaml.stringify('a', {}));
  assertPublicRouteCalls('SelectJsYamlLoadAllOptions', () => jsYaml.loadAll('a: 1', {}));
  assertPublicRouteCalls('RejectYamlOptionsPrimitive', () => yaml.stringify('a', undefined, true));
});

test('public option tables call the generated recognized-option decision', () => {
  assertPublicRouteCalls('RejectRecognizedOption', () => yaml.parse('a: 1', { schema: 'json' }));
  assertPublicRouteCalls('RejectRecognizedOption', () => yaml.stringify('a', { schema: 'json' }));
  assertPublicRouteCalls('RejectRecognizedOption', () => jsYaml.load('a: 1', { schema: jsYaml.CORE_SCHEMA }));
  assertPublicRouteCalls('RejectRecognizedOption', () => jsYaml.loadAll('a: 1', { schema: jsYaml.CORE_SCHEMA }));
  assertPublicRouteCalls('RejectRecognizedOption', () => jsYaml.dump('a', { schema: jsYaml.CORE_SCHEMA }));
});
