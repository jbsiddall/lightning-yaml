const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');

console.log(JSON.stringify({node: process.version, platform: process.platform,
  arch: process.arch, benchmark: 'isolated kernels; 7 rotated rounds, median',
  oldRepresentationConversion: 'outside timed region; old variants measured on ASCII only'}));

function load(name, entry, host = false) {
  const filename = path.join(__dirname, name + '.js');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(__dirname);
  let source = fs.readFileSync(filename, 'utf8');
  if (host) source += '\nBridge.__default.quoteEnd = require("./extern-host.cjs").quoteEnd;\n';
  if (entry) source += `\nmodule.exports = {entry: ${entry}, runtime: _dafny, BigNumber};\n`;
  loaded._compile(source, filename);
  return loaded.exports;
}
const unicode = load('Native', 'Native.__default');
const big = load('Scan', 'Scan.__default');
const utf16 = load('NativeUtf16', 'Native.__default').entry;
const numeric = load('Shapes', 'Shapes.__default').entry;
const direct = load('DirectCast', 'DirectCast.__default').entry;
const numericMin = load('Shapes.min');
const rewritten = load('Shapes.rewritten');
const rewrittenMin = load('Shapes.rewritten.min');
const extern = load('ExternHotPath', 'Bridge.__default', true).entry;
const host = require('./extern-host.cjs');

const CH = new Uint8Array(256);
for (const c of ',[]{}') CH[c.charCodeAt(0)] = 3;
for (const c of ':#\n\r') CH[c.charCodeAt(0)] = 2;
function nativeFlow(s, from) {
  let p = from;
  while (p < s.length) {
    const c = s.charCodeAt(p);
    if ((CH[c] & 2) !== 0) {
      if (c === 58) {
        const next = p + 1 < s.length ? s.charCodeAt(p + 1) : -1;
        if (next === -1 || next === 32 || next === 9 || next === 10 || next === 13 ||
            (CH[next] & 1) !== 0) break;
      } else if (c === 35) {
        if (p > from) {
          const prev = s.charCodeAt(p - 1);
          if (prev === 32 || prev === 9) break;
        }
      } else break;
    }
    p++;
  }
  return p;
}
const flowFns = {utf16: utf16.FlowPlainLine, flatChars: numeric.FlowPlainChars,
  directCast: direct.FlowPlainLine,
  numeric: numeric.FlowPlainLine,
  numericMin: numericMin.FlowPlainLine, rewritten: rewritten.FlowPlainLine,
  rewrittenMin: rewrittenMin.FlowPlainLine};
const quoteFns = {flatChars: numeric.QuoteChars,
  directCast: direct.QuoteEnd,
  numeric: numeric.QuoteEnd, numericMin: numericMin.QuoteEnd,
  rewritten: rewritten.QuoteEnd, rewrittenMin: rewrittenMin.QuoteEnd,
  extern: extern.QuoteThroughExtern};
let checks = 0;
function check(s, from) {
  const flow = nativeFlow(s, from), quote = host.quoteEnd(s, from);
  for (const [name, fn] of Object.entries(flowFns)) {
    assert.equal(fn(s, from), flow, `flow ${name} ${JSON.stringify(s)} @ ${from}`);
    checks++;
  }
  for (const [name, fn] of Object.entries(quoteFns)) {
    assert.equal(fn(s, from), quote, `quote ${name} ${JSON.stringify(s)} @ ${from}`);
    checks++;
  }
}
const cases = ['', 'hello: world', 'a:b', 'a # comment', '#tag', 'abc:]',
  '😀 x,tail', '\ud800,tail', '\udfff: tail', '"😀"', 'x\\"tail', 'x\n"tail'];
let seed = 0x56789abc;
const alphabet = 'abc09 :#\t\n\r,[]{}\\"😀\ud800\udfff';
for (let sample = 0; sample < 512; sample++) {
  let s = '';
  for (let i = 0; i < sample % 48; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    s += alphabet[(seed >>> 0) % alphabet.length];
  }
  cases.push(s);
}
for (const s of cases) for (let from = 0; from <= s.length; from++) check(s, from);
for (let unit = 0; unit < 65536; unit++) check(String.fromCharCode(unit), 0);
console.log(JSON.stringify({validation: 'passed', checks,
  scope: 'differential tests + all single UTF-16 units; not an all-string proof'}));

function measure(fn, count) {
  let sum = 0;
  const start = process.hrtime.bigint();
  for (let i = 0; i < count; i++) sum += fn(i);
  if (sum === -1) throw Error('unreachable');
  return Number(process.hrtime.bigint() - start) / count;
}
const iterations = Number(process.env.ITERATIONS || 5000);
for (const length of [64, 1024]) {
  const texts = Array.from({length: 128}, (_, i) => {
    const word = String.fromCharCode(65 + i % 26) +
      'alpha0123'.repeat(Math.ceil((length + 8) / 9)).slice(0, length - 1 + i % 7);
    return {flow: word + ',tail', quote: word + '"tail'};
  });
  const uni = texts.map(x => unicode.runtime.Seq.UnicodeFromString(x.flow));
  const bigSeq = texts.map(x => big.runtime.Seq.UnicodeFromString(x.flow));
  const zero = new big.BigNumber(0);
  const groups = {
    flow: {
      nativeJs: i => nativeFlow(texts[i & 127].flow, 0),
      dafnyBigInt: i => big.entry.FlowPlainLine(bigSeq[i & 127], zero).toNumber(),
      dafnyUnicode: i => unicode.entry.FlowPlainLine(uni[i & 127], 0),
      ...Object.fromEntries(Object.entries(flowFns).map(([name, fn]) =>
        [name, i => fn(texts[i & 127].flow, 0)])),
    },
    quote: {
      nativeJs: i => host.quoteEnd(texts[i & 127].quote, 0),
      ...Object.fromEntries(Object.entries(quoteFns).map(([name, fn]) =>
        [name, i => fn(texts[i & 127].quote, 0)])),
    }
  };
  for (const [kernel, runners] of Object.entries(groups)) {
    const names = Object.keys(runners), rounds = Object.fromEntries(names.map(n => [n, []]));
    for (const name of names) measure(runners[name], name === 'dafnyBigInt' ? 300 : 3000);
    for (let round = 0; round < 7; round++) {
      // Rotate order to reduce systematic timing-order effects.
      for (let j = 0; j < names.length; j++) {
        const name = names[(j + round) % names.length];
        rounds[name].push(measure(runners[name], name === 'dafnyBigInt' ? 500 : iterations));
      }
    }
    const median = Object.fromEntries(names.map(name => {
      rounds[name].sort((a, b) => a - b);
      return [name, Number(rounds[name][3].toFixed(1))];
    }));
    console.log(JSON.stringify({kernel, length, iterations, nsPerCallMedian: median,
      relativeToNative: Object.fromEntries(names.map(name =>
        [name, Number((median[name] / median.nativeJs).toFixed(2))]))}));
  }
}
