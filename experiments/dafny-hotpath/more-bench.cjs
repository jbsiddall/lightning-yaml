const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');

const filename = path.join(__dirname, 'MoreHotPaths.js');
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(__dirname);
loaded._compile(fs.readFileSync(filename, 'utf8') +
  '\nmodule.exports = MoreHotPaths.__default;\n', filename);
const dafny = loaded.exports;

const units = s => {
  const bytes = Buffer.from(s, 'utf16le');
  return new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
};

// Isolated ports of src/core.ts's corresponding functions.
function blockPlainEnd(src, from) {
  const len = src.length;
  let p = from;
  let atColon = false;
  while (p < len) {
    const c = src.charCodeAt(p);
    if (c === 10 || c === 13) break;
    if (c === 58) {
      const nc = p + 1 < len ? src.charCodeAt(p + 1) : -1;
      if (nc === -1 || nc === 32 || nc === 9 || nc === 10 || nc === 13) {
        atColon = true;
        break;
      }
    } else if (c === 35 && p > from) {
      const prev = src.charCodeAt(p - 1);
      if (prev === 32 || prev === 9) break;
    }
    p++;
  }
  let e = p;
  while (e > from) {
    const w = src.charCodeAt(e - 1);
    if (w !== 32 && w !== 9) break;
    e--;
  }
  return [p, e, atColon];
}

function matchFlowKey(src, pos, key) {
  if (src.charCodeAt(pos) !== 34) return pos;
  const n = key.length;
  const q = pos + 1;
  let i = 0;
  while (i < n && src.charCodeAt(q + i) === key.charCodeAt(i)) i++;
  if (i !== n || src.charCodeAt(q + n) !== 34) return pos;
  return q + n + 1;
}

function simpleQuoteEnd(src, from) {
  const n = src.length;
  const e = src.indexOf('"', from);
  if (e < 0) return n;
  const slash = src.indexOf('\\', from);
  if (slash >= 0 && slash < e) return n;
  const lf = src.indexOf('\n', from);
  if (lf >= 0 && lf < e) return n;
  return e;
}

function typedArrayQuoteEnd(src, from) {
  const n = src.length;
  const e = src.indexOf(34, from);
  if (e < 0) return n;
  const slash = src.indexOf(92, from);
  if (slash >= 0 && slash < e) return n;
  const lf = src.indexOf(10, from);
  if (lf >= 0 && lf < e) return n;
  return e;
}

for (const src of ['hello', 'abc: value', 'abc:', 'abc:word', 'a # comment', '#tag',
  'abc \t\nnext', 'a\rb', '😀 key: value', 'x,[y]']) {
  for (const from of [0, Math.min(2, src.length)]) {
    assert.deepEqual(dafny.BlockPlainEnd(units(src), from), blockPlainEnd(src, from), `block ${src}`);
  }
}
for (const [src, pos, key] of [
  ['"abc": 1', 0, 'abc'], ['"abc": 1', 0, 'abd'], ['"ab\\c": 1', 0, 'ab\\c'],
  ['x"name"', 1, 'name'], ['"nameX"', 0, 'name'], ['"😀": 1', 0, '😀'],
  ['""', 0, ''], ['unquoted', 0, 'unquoted']
]) assert.equal(dafny.MatchFlowKey(units(src), pos, units(key)), matchFlowKey(src, pos, key), `key ${src}`);
for (const src of ['"abc"', '"ab\\nc"', '"abc\nnext"', '"abc', '"😀text"']) {
  assert.equal(dafny.SimpleQuoteEnd(units(src), 1), simpleQuoteEnd(src, 1), `quote ${src}`);
  assert.equal(typedArrayQuoteEnd(units(src), 1), simpleQuoteEnd(src, 1), `typed quote ${src}`);
}
let seed = 0x24681357;
const alphabet = 'abc09 :#\t\n\r,[]{}\\"';
for (let sample = 0; sample < 500; sample++) {
  let body = '';
  for (let i = 0; i < sample % 41; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    body += alphabet[(seed >>> 0) % alphabet.length];
  }
  const from = sample % (body.length + 1);
  assert.deepEqual(dafny.BlockPlainEnd(units(body), from), blockPlainEnd(body, from));
  const quoted = '"' + body + '"';
  assert.equal(dafny.SimpleQuoteEnd(units(quoted), 1), simpleQuoteEnd(quoted, 1));
  const key = body.replace(/["\\\n\r]/g, 'a');
  const flow = '"' + key + '": 1';
  assert.equal(dafny.MatchFlowKey(units(flow), 0, units(key)), matchFlowKey(flow, 0, key));
}

function measure(fn, count) {
  let sum = 0;
  const start = process.hrtime.bigint();
  for (let i = 0; i < count; i++) sum += fn(i);
  if (sum === -1) throw Error('unreachable');
  return Number(process.hrtime.bigint() - start) / count;
}
const iterations = Number(process.env.ITERATIONS || 10000);
for (const length of [64, 1024]) {
  const word = 'alpha0123'.repeat(Math.ceil(length / 9)).slice(0, length);
  const block = word + ': value';
  const flow = '"' + word + '": 1';
  const quoted = '"' + word + '"';
  const bu = units(block), fu = units(flow), qu = units(quoted), ku = units(word);
  const kernels = {
    block: {
      js: () => blockPlainEnd(block, 0)[1],
      dafny: () => dafny.BlockPlainEnd(bu, 0)[1],
      withBuffer: () => dafny.BlockPlainEnd(units(block), 0)[1],
    },
    key: {
      js: () => matchFlowKey(flow, 0, word),
      dafny: () => dafny.MatchFlowKey(fu, 0, ku),
      withBuffer: () => dafny.MatchFlowKey(units(flow), 0, ku),
    },
    quote: {
      js: () => simpleQuoteEnd(quoted, 1),
      dafny: () => dafny.SimpleQuoteEnd(qu, 1),
      withBuffer: () => dafny.SimpleQuoteEnd(units(quoted), 1),
      typedArrayIndexOf: () => typedArrayQuoteEnd(qu, 1),
    },
  };
  for (const [kernel, runners] of Object.entries(kernels)) {
    const ns = {};
    for (const [name, fn] of Object.entries(runners)) {
      measure(fn, 1000);
      const rounds = Array.from({length: 5}, () => measure(fn, iterations)).sort((a, b) => a - b);
      ns[name] = Number(rounds[2].toFixed(1));
    }
    console.log(JSON.stringify({kernel, length, iterations, nsPerCallMedian: ns,
      generatedOverJs: Number((ns.dafny / ns.js).toFixed(1)),
      withBufferOverJs: Number((ns.withBuffer / ns.js).toFixed(1))}));
  }

  // Rotate among inputs so the quote result cannot be treated as a constant.
  const quotes = Array.from({length: 128}, (_, i) =>
    '"' + String.fromCharCode(65 + i % 26) + word.slice(1) + '"');
  const quoteUnits = quotes.map(units);
  const varied = {
    js: i => simpleQuoteEnd(quotes[i & 127], 1),
    dafny: i => dafny.SimpleQuoteEnd(quoteUnits[i & 127], 1),
    withBuffer: i => dafny.SimpleQuoteEnd(units(quotes[i & 127]), 1),
    typedArrayIndexOf: i => typedArrayQuoteEnd(quoteUnits[i & 127], 1),
  };
  const ns = {};
  for (const [name, fn] of Object.entries(varied)) {
    measure(fn, 1000);
    const rounds = Array.from({length: 5}, () => measure(fn, iterations)).sort((a, b) => a - b);
    ns[name] = Number(rounds[2].toFixed(1));
  }
  console.log(JSON.stringify({kernel: 'quote-varied', length, iterations, nsPerCallMedian: ns,
    generatedOverJs: Number((ns.dafny / ns.js).toFixed(1))}));
}
