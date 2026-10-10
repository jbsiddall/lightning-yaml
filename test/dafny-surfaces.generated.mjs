import assert from 'node:assert/strict';
import test from 'node:test';
import * as yaml from '../src/yaml-compat.ts';
import * as jsYaml from '../src/js-yaml-compat.ts';
import { NotImplementedError, YAMLParseError } from '../src/errors.ts';
import { SurfaceErrors, SurfaceHelpers } from '../src/dafny/generated/engine.js';

function assertMethodRoute(target, methodName, invoke) {
  const sentinel = Object.freeze({ methodName });
  const original = target[methodName];
  target[methodName] = () => { throw sentinel; };
  try {
    assert.throws(invoke, (error) => error === sentinel, `${methodName} was not called by its public route`);
  } finally {
    target[methodName] = original;
  }
}

test('generated helper methods are the implementations used by public tag and document APIs', () => {
  assert.equal(SurfaceHelpers.__default.TagKindName(0), 'scalar');
  assert.equal(SurfaceHelpers.__default.TagKindName(1), 'sequence');
  assert.equal(SurfaceHelpers.__default.TagKindName(2), 'mapping');

  assertMethodRoute(SurfaceHelpers.__default, 'TagKindName', () => jsYaml.defineScalarTag('!tag'));
  assertMethodRoute(SurfaceHelpers.__default, 'TagKindName', () => jsYaml.defineSequenceTag('!tag'));
  assertMethodRoute(SurfaceHelpers.__default, 'TagKindName', () => jsYaml.defineMappingTag('!tag'));
  assertMethodRoute(SurfaceHelpers.__default, 'ReturnSchemaIdentity', () => new jsYaml.Schema().withTags({}));
  const document = yaml.parseDocument('value');
  assertMethodRoute(SurfaceHelpers.__default, 'ReturnCapturedContents', () => document.toJS());
  assertMethodRoute(SurfaceHelpers.__default, 'ReturnCapturedContents', () => document.toJSON());
});

test('generated error-field methods are used by the public error constructors', () => {
  assert.equal(SurfaceErrors.__default.ParseErrorName(), 'YAMLParseError');
  assert.equal(SurfaceErrors.__default.NotImplementedErrorName(), 'NotImplementedError');
  assert.equal(SurfaceErrors.__default.YamlExceptionName(), 'YAMLException');

  assertMethodRoute(SurfaceErrors.__default, 'ParseErrorName', () => new YAMLParseError('bad yaml'));
  assertMethodRoute(SurfaceErrors.__default, 'NotImplementedErrorName', () => new NotImplementedError('parse'));
  assertMethodRoute(SurfaceErrors.__default, 'YamlExceptionName', () => new jsYaml.YAMLException('reason'));
  assertMethodRoute(SurfaceErrors.__default, 'ChooseExceptionReason', () => new jsYaml.YAMLException());
  assertMethodRoute(SurfaceErrors.__default, 'ChooseExceptionMark', () => new jsYaml.YAMLException('reason'));
});
