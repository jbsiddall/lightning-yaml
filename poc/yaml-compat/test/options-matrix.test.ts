import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import * as yaml from 'yaml';
import type { ParseOptions } from '../src/options.ts';
import type { StringifyOptions } from '../src/stringify.ts';
import { parse, parseDocument, parseAllDocuments, stringify } from '../src/index.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CORPUS = join(HERE, '..', 'bench', 'corpus');

// Purpose: every supported option permutation must behave like the `yaml`
// library (or throw loudly when unimplemented). Fixing one matrix here keeps
// the whole compat contract under one roof instead of a sprawling set of
// per-option spot checks.

// Supported parse options, one config per option at a non-default value.
const PARSE_CONFIGS: Array<{ name: string; opts: ParseOptions }> = [
  { name: 'baseline', opts: {} },
  { name: 'version:1.1', opts: { version: '1.1' } },
  { name: 'strict:false', opts: { strict: false } },
  { name: 'uniqueKeys:false', opts: { uniqueKeys: false } },
  { name: 'merge:true', opts: { merge: true } },
  { name: 'keepSourceTokens:true', opts: { keepSourceTokens: true } },
] as const;

// Supported stringify options, one config per option at a non-default value.
const STRINGIFY_CONFIGS: Array<{ name: string; opts: StringifyOptions }> = [
  { name: 'baseline', opts: {} },
  { name: 'indent:4', opts: { indent: 4 } },
  { name: 'singleQuote:true', opts: { singleQuote: true } },
  { name: 'key:QUOTE_SINGLE', opts: { defaultKeyType: 'QUOTE_SINGLE' } },
  { name: 'key:QUOTE_DOUBLE', opts: { defaultKeyType: 'QUOTE_DOUBLE' } },
  { name: 'nullStr:~', opts: { nullStr: '~' } },
  { name: 'trueStr:yes', opts: { trueStr: 'yes' } },
  { name: 'falseStr:no', opts: { falseStr: 'no' } },
  { name: 'indentSeq:false', opts: { indentSeq: false } },
  { name: 'minContentWidth:80', opts: { minContentWidth: 80 } },
  { name: 'version:1.1', opts: { version: '1.1' } },
] as const;

// Multi-document stream: single-doc parse() raises MULTIPLE_DOCS by design, so
// it must go through parseAllDocuments on both sides.
const MULTIDOC = new Set(['multidoc-k8s']);

const fixtures = Object.fromEntries(
  readdirSync(CORPUS)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => [f.replace(/\.yaml$/, ''), readFileSync(join(CORPUS, f), 'utf8')]),
);

// The two multi-MB stress fixtures are 40x+ the cost of the rest of the matrix
// to re-parse under every config, and their categories (block-style, JSON
// records) are already covered here by block-config / json-records-medium;
// their full round-trip is exercised by the corpus-differential test in
// stringify.test.ts. Option coverage doesn't need the fat fixtures.
const LARGE = new Set(['large-block', 'json-records-large']);
const MATRIX_FIXTURES = Object.fromEntries(
  Object.entries(fixtures).filter(([name]) => !LARGE.has(name)),
);

// ---- Dimension A: parse value parity ---------------------------------------

describe('parse option parity vs yaml', () => {
  for (const [name, text] of Object.entries(MATRIX_FIXTURES)) {
    for (const { name: cfg, opts } of PARSE_CONFIGS) {
      it(`${name} × ${cfg}`, () => {
        if (MULTIDOC.has(name)) {
          const ourVals = parseAllDocuments(text, opts).map((d) => d.toJS({ merge: opts.merge }));
          const eemVals = yaml.parseAllDocuments(text, opts as any).map((d) => d.toJS({ merge: opts.merge }));
          assert.ok(isDeepStrictEqual(ourVals, eemVals), `value divergence for ${name} × ${cfg}`);
        } else {
          const ourVal = parse(text, opts);
          const eemVal = yaml.parse(text, opts as any);
          assert.ok(isDeepStrictEqual(ourVal, eemVal), `value divergence for ${name} × ${cfg}`);
        }
      });
    }
  }
});

// ---- Dimension B: stringify parity ------------------------------------------

describe('stringify option parity vs yaml', () => {
  // trueStr/falseStr only kick in on in-memory booleans (round-tripped bools
  // keep their source spelling), so the fixture rows above don't exercise them.
  it('trueStr/falseStr apply on in-memory booleans', () => {
    for (const opts of [{ trueStr: 'yes', falseStr: 'no' }, { trueStr: 'on', falseStr: 'off' }]) {
      assert.equal(
        stringify({ a: true, b: false }, opts),
        yaml.stringify({ a: true, b: false }, opts as any),
      );
    }
  });
  for (const [name, text] of Object.entries(MATRIX_FIXTURES)) {
    for (const { name: cfg, opts } of STRINGIFY_CONFIGS) {
      it(`${name} × ${cfg}`, () => {
        let ourOut: string, eemOut: string;
        if (MULTIDOC.has(name)) {
          ourOut = parseAllDocuments(text).map((d) => d.toString(opts)).join('');
          eemOut = yaml.parseAllDocuments(text).map((d) => d.toString(opts as any)).join('');
        } else {
          ourOut = stringify(parseDocument(text), opts);
          eemOut = yaml.stringify(yaml.parseDocument(text), opts as any);
        }
        // Byte-identical is ideal; if bytes differ the rendered values must
        // still be equal under the yaml library's own parse (DIVERGENT fails).
        if (ourOut === eemOut) return;
        if (MULTIDOC.has(name)) {
          const ourVals = yaml.parseAllDocuments(ourOut).map((d) => d.toJS());
          const eemVals = yaml.parseAllDocuments(eemOut).map((d) => d.toJS());
          assert.ok(isDeepStrictEqual(ourVals, eemVals), `stringify divergence for ${name} × ${cfg}`);
        } else {
          assert.ok(isDeepStrictEqual(yaml.parse(ourOut), yaml.parse(eemOut)), `stringify divergence for ${name} × ${cfg}`);
        }
      });
    }
  }
});

// ---- Unimplemented options throw loudly -------------------------------------

describe('unimplemented options throw (Not implemented in POC)', () => {
  for (const opt of ['mapAsMap', 'intAsBigInt', 'stringKeys', 'reviver', 'prettyErrors']) {
    it(`parse rejects ${opt}`, () => {
      assert.throws(() => parse('a: 1', { [opt]: true } as any), /Not implemented in POC/);
    });
  }

  it('stringify rejects lineWidth != 80', () => {
    assert.throws(() => stringify({ a: 1 }, { lineWidth: 40 }), /Not implemented in POC: lineWidth/);
    assert.doesNotThrow(() => stringify({ a: 1 }, { lineWidth: 80 }));
  });

  it('stringify rejects flowLevel != -1', () => {
    assert.throws(() => stringify({ a: 1 }, { flowLevel: 0 }), /Not implemented in POC: flowLevel/);
    assert.doesNotThrow(() => stringify({ a: 1 }, { flowLevel: -1 }));
  });

  it('stringify rejects defaultStringType != PLAIN', () => {
    for (const t of ['QUOTE_SINGLE', 'QUOTE_DOUBLE', 'BLOCK_FOLDED', 'BLOCK_LITERAL']) {
      assert.throws(() => stringify({ a: 'x' }, { defaultStringType: t as any }), /Not implemented in POC: defaultStringType/);
    }
    assert.doesNotThrow(() => stringify({ a: 'x' }, { defaultStringType: 'PLAIN' }));
  });

  it('stringify rejects directives: true', () => {
    assert.throws(() => stringify({ a: 1 }, { directives: true }), /Not implemented in POC: directives/);
    assert.doesNotThrow(() => stringify({ a: 1 }, { directives: false }));
  });
});