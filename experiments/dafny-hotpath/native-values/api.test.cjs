'use strict';
const assert = require('node:assert/strict');
const { createNativeApi } = require('./dist/api.js');

assert.throws(() => createNativeApi(null), TypeError);
assert.throws(() => createNativeApi({ Demo() {} }), TypeError);
const malformed = createNativeApi({ Demo: () => ({ null: null }), BuildNumbers: () => ['wrong'] });
assert.throws(() => malformed.demo(), TypeError);
assert.throws(() => malformed.numbers(1), TypeError);
assert.throws(() => malformed.numbers(-1), RangeError);
assert.throws(() => malformed.numbers(1.5), RangeError);
assert.throws(() => malformed.numbers(2147483647), RangeError);
const sparse = [];
sparse.length = 1;
assert.throws(() => createNativeApi({ Demo() {}, BuildNumbers: () => sparse }).numbers(1), TypeError);

const child = { number: 7, text: 'native text', boolean: true };
const demo = { child, list: [child, child], null: null, undefined: undefined };
demo.self = demo;
const raw = createNativeApi({ Demo: () => demo, BuildNumbers: () => [0, 1] });
assert.equal(raw.demo(), demo);
assert.equal(raw.numbers(2).length, 2);
delete demo.undefined;
assert.throws(() => raw.demo(), TypeError);
Object.defineProperty(demo, 'undefined', { get: () => undefined, enumerable: true });
assert.throws(() => raw.demo(), TypeError);
console.log('Strict API: native reference retention and malformed boundary rejection passed');
