// Run after compiling Scan.dfy and Native.dfy to JavaScript.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');

function loadGenerated(name) {
  const filename = path.join(__dirname, `${name}.js`);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(__dirname);
  loaded._compile(fs.readFileSync(filename, 'utf8') +
    `\nmodule.exports = {entry: ${name}.__default.FlowPlainLine, dafny: _dafny, BigNumber};\n`, filename);
  return loaded.exports;
}

// Port of src/core.ts:scanFlowPlainLine, with parser globals supplied as args.
const FLOW_INDICATOR = 1;
const PLAIN_STOP = 2;
const CH = new Uint8Array(256);
for (const c of ',[]{}') CH[c.charCodeAt(0)] = FLOW_INDICATOR | PLAIN_STOP;
for (const c of ':#\n\r') CH[c.charCodeAt(0)] = PLAIN_STOP;
function scanJs(src, from) {
  const len = src.length;
  let p = from;
  while (p < len) {
    const c = src.charCodeAt(p);
    if ((CH[c] & PLAIN_STOP) !== 0) {
      if (c === 58) {
        const nc = p + 1 < len ? src.charCodeAt(p + 1) : -1;
        if (nc === -1 || nc === 32 || nc === 9 || nc === 10 || nc === 13 ||
          (CH[nc] & FLOW_INDICATOR) !== 0) break;
      } else if (c === 35) {
        if (p > from) {
          const prev = src.charCodeAt(p - 1);
          if (prev === 32 || prev === 9) break;
        }
      } else break;
    }
    p++;
  }
  return p;
}

const plain = loadGenerated('Scan');
const native = loadGenerated('Native');
const codeUnits = loadGenerated('CodeUnits');
const toCodeUnits = s => Uint16Array.from({length: s.length}, (_, i) => s.charCodeAt(i));
const toCodeUnitsNode = s => {
  const bytes = Buffer.from(s, 'utf16le');
  return new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
};
const cases = ['hello', 'hello,world', 'a:b', 'a: b', 'a # comment', '#tag',
  'abc\nnext', 'abc\rnext', 'abc[rest', 'abc:]', 'abc:word', '😀 x,rest'];
for (const s of cases) {
  const expected = scanJs(s, 0);
  const seq1 = plain.dafny.Seq.UnicodeFromString(s);
  const seq2 = native.dafny.Seq.UnicodeFromString(s);
  const unicodeExpected = [...s.slice(0, expected)].length;
  assert.equal(plain.entry(seq1, new plain.BigNumber(0)).toNumber(), unicodeExpected, s);
  assert.equal(native.entry(seq2, 0), unicodeExpected, s);
  assert.equal(codeUnits.entry(toCodeUnits(s), 0), expected, s);
  assert.equal(codeUnits.entry(toCodeUnitsNode(s), 0), expected, s);
}
let seed = 0x12345678;
const alphabet = 'abc09 :#\t\n\r,[]{}';
for (let sample = 0; sample < 500; sample++) {
  let s = '';
  for (let i = 0; i < 1 + sample % 60; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    s += alphabet[(seed >>> 0) % alphabet.length];
  }
  const from = sample % s.length;
  const expected = scanJs(s, from);
  assert.equal(plain.entry(plain.dafny.Seq.UnicodeFromString(s), new plain.BigNumber(from)).toNumber(), expected, s);
  assert.equal(native.entry(native.dafny.Seq.UnicodeFromString(s), from), expected, s);
  assert.equal(codeUnits.entry(toCodeUnits(s), from), expected, s);
}

const iterations = Number(process.env.ITERATIONS || 30000);
function measure(fn, count) {
  let sum = 0;
  const start = process.hrtime.bigint();
  for (let i = 0; i < count; ++i) sum += fn();
  const ns = Number(process.hrtime.bigint() - start) / count;
  if (sum === -1) throw Error('unreachable');
  return ns;
}
for (const length of [64, 1024]) {
  const s = 'alpha0123'.repeat(Math.ceil(length / 9)).slice(0, length) + ',tail';
  const seq1 = plain.dafny.Seq.UnicodeFromString(s);
  const seq2 = native.dafny.Seq.UnicodeFromString(s);
  const units = toCodeUnits(s);
  const zero = new plain.BigNumber(0);
  const runners = {
    js: () => scanJs(s, 0),
    dafnyInt: () => plain.entry(seq1, zero).toNumber(),
    dafnyNative: () => native.entry(seq2, 0),
    dafnyNativeWithConversion: () => native.entry(native.dafny.Seq.UnicodeFromString(s), 0),
    dafnyCodeUnits: () => codeUnits.entry(units, 0),
    dafnyCodeUnitsWithConversion: () => codeUnits.entry(toCodeUnits(s), 0),
    dafnyCodeUnitsWithNodeBuffer: () => codeUnits.entry(toCodeUnitsNode(s), 0),
  };
  for (const fn of Object.values(runners)) measure(fn, 1000);
  const results = {};
  for (const [name, fn] of Object.entries(runners)) {
    const rounds = [];
    for (let round = 0; round < 5; round++) rounds.push(measure(fn, iterations));
    rounds.sort((a, b) => a - b);
    results[name] = Number(rounds[2].toFixed(1));
  }
  console.log(JSON.stringify({length, iterations, nsPerCallMedian: results,
    nativeOverJs: Number((results.dafnyNative / results.js).toFixed(1)),
    intOverJs: Number((results.dafnyInt / results.js).toFixed(1))}));
}
