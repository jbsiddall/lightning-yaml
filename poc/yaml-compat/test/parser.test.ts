/**
 * Differential tests for the yaml-compat POC parser.
 *
 * Tests toJS deepStrictEqual against real yaml v2.9.0 on the corpus +
 * adversarial inputs. Also tests AST structure, comments, ranges, and errors.
 *
 * Run:  node --import tsx --test poc/yaml-compat/test/parser.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'yaml';
import {
  parse, parseDocument, parseAllDocuments,
  Scalar, YAMLMap, YAMLSeq, Pair, Alias,
  isScalar, isMap, isSeq, isPair, isAlias, isNode, isCollection,
  visit,
  Document,
} from '../src/index.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CORPUS = join(HERE, '..', 'bench', 'corpus');

// ---- Helper ----------------------------------------------------------------

function loadCorpus() {
  return readdirSync(CORPUS)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => ({
      name: f.replace(/\.yaml$/, ''),
      path: join(CORPUS, f),
      text: readFileSync(join(CORPUS, f), 'utf8'),
      isMultidoc: f.startsWith('multidoc-'),
    }));
}

// ---- Corpus differential: toJS ---------------------------------------------

describe('Corpus toJS differential', () => {
  for (const fx of loadCorpus()) {
    it(fx.name, () => {
      if (fx.isMultidoc) {
        const ours = parseAllDocuments(fx.text);
        const theirs = yaml.parseAllDocuments(fx.text);
        assert.equal(ours.length, theirs.length, 'doc count');
        for (let i = 0; i < ours.length; i++) {
          assert.deepStrictEqual(
            ours[i].toJS(),
            theirs[i].toJS(),
            `doc ${i} toJS`,
          );
        }
      } else {
        assert.deepStrictEqual(parse(fx.text), yaml.parse(fx.text));
      }
    });
  }
});

// ---- Adversarial tests -----------------------------------------------------

describe('Adversarial', () => {
  it('merge keys with merge:true', () => {
    const text = `
defaults: &d
  a: 1
  b: 2
item:
  <<: *d
  c: 3
`;
    const ours = parse(text, { merge: true });
    const theirs = yaml.parse(text, { merge: true });
    assert.deepStrictEqual(ours, theirs);
  });

  it('deep anchor/alias reuse', () => {
    const text = `
a: &ref
  x: 1
  y: 2
b: *ref
c:
  nested: *ref
`;
    const ours = parse(text);
    const theirs = yaml.parse(text);
    assert.deepStrictEqual(ours, theirs);
  });

  it('multi-doc with directives', () => {
    const text = `%YAML 1.2
---
a: 1
---
b: 2
...
`;
    const ours = parseAllDocuments(text);
    const theirs = yaml.parseAllDocuments(text);
    assert.equal(ours.length, theirs.length);
    for (let i = 0; i < ours.length; i++) {
      assert.deepStrictEqual(ours[i].toJS(), theirs[i].toJS());
    }
  });

  it('weird indentation', () => {
    // yaml lib may error on this; we just need to not crash
    const text = `a:\n    b: 1\n    c:\n      d: 2\n  e: 3\n`;
    const doc = parseDocument(text);
    // Either parses or has errors — both acceptable
    assert.ok(doc.contents !== undefined);
  });

  it('quoted escapes', () => {
    const text = `
single: 'it''s a test'
double: "hello\\nworld\\ttab"
unicode: "\\u0041\\u0042"
`;
    const ours = parse(text);
    const theirs = yaml.parse(text);
    assert.deepStrictEqual(ours, theirs);
  });

  it('YAML 1.1 booleans', () => {
    const text = `
a: yes
b: no
c: on
d: off
e: Yes
f: NO
`;
    const ours = parse(text, { version: '1.1' });
    const theirs = yaml.parse(text, { version: '1.1' });
    assert.deepStrictEqual(ours, theirs);
  });

  it('duplicate keys with uniqueKeys:false (last wins)', () => {
    const text = `a: 1\nb: 2\na: 3`;
    const ours = parse(text, { uniqueKeys: false });
    const theirs = yaml.parse(text, { uniqueKeys: false });
    assert.deepStrictEqual(ours, theirs);
  });

  it('duplicate keys with uniqueKeys:true (error)', () => {
    const text = `a: 1\na: 2`;
    const doc = parseDocument(text, { uniqueKeys: true });
    assert.ok(doc.errors.length > 0, 'should have errors');
  });

  it('error: malformed input produces errors', () => {
    const text = `{key: [unclosed`;
    const doc = parseDocument(text);
    assert.ok(doc.errors.length > 0);
  });

  it('block scalar literal', () => {
    const text = `script: |\n  echo hello\n  echo world\n`;
    const ours = parse(text);
    const theirs = yaml.parse(text);
    assert.deepStrictEqual(ours, theirs);
  });

  it('block scalar folded', () => {
    const text = `desc: >\n  This is a\n  long description\n`;
    const ours = parse(text);
    const theirs = yaml.parse(text);
    assert.deepStrictEqual(ours, theirs);
  });

  it('block scalar chomping', () => {
    const text = `
strip: |-
  line1
  line2
clip: |
  line1
  line2
keep: |+
  line1
  line2
`;
    const ours = parse(text);
    const theirs = yaml.parse(text);
    assert.deepStrictEqual(ours, theirs);
  });

  it('flow collections nested', () => {
    const text = `
a: [1, [2, 3], {b: 4}]
c: {x: [1, 2], y: {z: 3}}
`;
    const ours = parse(text);
    const theirs = yaml.parse(text);
    assert.deepStrictEqual(ours, theirs);
  });

  it('empty document', () => {
    const doc = parseDocument('');
    assert.equal(doc.contents, null);
    assert.equal(doc.errors.length, 0);
  });

  it('null values', () => {
    const text = `a:\nb: null\nc: ~\nd: Null`;
    const ours = parse(text);
    const theirs = yaml.parse(text);
    assert.deepStrictEqual(ours, theirs);
  });

  it('numeric types', () => {
    const text = `
int: 42
neg: -7
float: 3.14
sci: 1.5e10
hex: 0xFF
oct: 0o77
inf: .inf
neg_inf: -.inf
nan: .nan
`;
    const ours = parse(text);
    const theirs = yaml.parse(text);
    // NaN !== NaN, so compare separately
    assert.ok(Number.isNaN((ours as Record<string, unknown>).nan));
    assert.ok(Number.isNaN((theirs as Record<string, unknown>).nan));
    delete (ours as Record<string, unknown>).nan;
    delete (theirs as Record<string, unknown>).nan;
    assert.deepStrictEqual(ours, theirs);
  });
});

// ---- Options matrix --------------------------------------------------------

describe('Options matrix', () => {
  const simpleYaml = `a: 1\nb: true\nc: hello`;

  it('version 1.2 (default)', () => {
    const result = parse(simpleYaml) as Record<string, unknown>;
    assert.equal(result.a, 1);
    assert.equal(result.b, true);
    assert.equal(result.c, 'hello');
  });

  it('version 1.1 — yes/no/on/off as booleans', () => {
    const text = `a: yes\nb: no\nc: on\nd: off`;
    const result = parse(text, { version: '1.1' }) as Record<string, unknown>;
    assert.equal(result.a, true);
    assert.equal(result.b, false);
    assert.equal(result.c, true);
    assert.equal(result.d, false);
  });

  it('strict mode', () => {
    // strict:true should still parse valid YAML
    const result = parse(simpleYaml, { strict: true });
    assert.deepStrictEqual(result, { a: 1, b: true, c: 'hello' });
  });

  it('uniqueKeys:false — last wins', () => {
    const text = `a: 1\na: 2`;
    const result = parse(text, { uniqueKeys: false }) as Record<string, unknown>;
    assert.equal(result.a, 2);
  });

  it('merge keys', () => {
    const text = `d: &d\n  x: 1\nitem:\n  <<: *d\n  y: 2`;
    const result = parse(text, { merge: true }) as Record<string, unknown>;
    const item = result.item as Record<string, unknown>;
    assert.equal(item.x, 1);
    assert.equal(item.y, 2);
  });
});

// ---- AST structure ---------------------------------------------------------

describe('AST structure', () => {
  it('Document has contents, errors, warnings', () => {
    const doc = parseDocument('a: 1\nb: 2\n');
    assert.ok(doc.contents);
    assert.ok(isMap(doc.contents));
    assert.equal(doc.errors.length, 0);
    assert.ok(Array.isArray(doc.warnings));
  });

  it('parseDocument never throws on parse errors', () => {
    const doc = parseDocument('{unclosed: [');
    assert.ok(doc.errors.length > 0);
  });

  it('Node types are correct', () => {
    const doc = parseDocument('a: 1\nb: [2, 3]\n');
    const map = doc.contents as YAMLMap;
    assert.ok(isMap(map));
    assert.equal(map.items.length, 2);
    assert.ok(isPair(map.items[0]));
    assert.ok(isScalar(map.items[0]!.key));
    assert.ok(isScalar(map.items[0]!.value));
    assert.ok(isSeq(map.items[1]!.value));
  });

  it('Scalar types are correct', () => {
    const doc = parseDocument('"hello"');
    const s = doc.contents as Scalar;
    assert.equal(s.type, 'QUOTE_DOUBLE');
    assert.equal(s.value, 'hello');
  });

  it('Range is [start, valueEnd, nodeEnd] tuple', () => {
    const doc = parseDocument('a: 1\n');
    const map = doc.contents as YAMLMap;
    assert.ok(map.range);
    assert.equal(map.range.length, 3);
    assert.equal(typeof map.range[0], 'number');
    assert.equal(typeof map.range[1], 'number');
    assert.equal(typeof map.range[2], 'number');
  });
});

// ---- visit / isX -----------------------------------------------------------

describe('visit and type guards', () => {
  it('visit traverses all nodes', () => {
    const doc = parseDocument('a: 1\nb: [2, 3]\n');
    const visited: string[] = [];
    visit(doc, {
      Map: (_key, node) => { visited.push('map'); },
      Seq: (_key, node) => { visited.push('seq'); },
      Scalar: (_key, node) => { visited.push('scalar'); },
      Pair: (_key, node) => { visited.push('pair'); },
    });
    assert.ok(visited.includes('map'));
    assert.ok(visited.includes('seq'));
    assert.ok(visited.includes('scalar'));
    assert.ok(visited.includes('pair'));
  });

  it('visit.SKIP skips children', () => {
    const doc = parseDocument('a:\n  b: 1\n  c: 2\nd: 3\n');
    const scalars: string[] = [];
    visit(doc, {
      Map: (_key, _node) => visit.SKIP,
      Scalar: (_key, node) => { scalars.push(String(node.value)); },
    });
    // Map was skipped, so no scalars inside it
    assert.equal(scalars.length, 0);
  });

  it('isX guards work', () => {
    assert.ok(isScalar(new Scalar(42)));
    assert.ok(isMap(new YAMLMap()));
    assert.ok(isSeq(new YAMLSeq()));
    assert.ok(isPair(new Pair(new Scalar('k'), new Scalar('v'))));
    assert.ok(isAlias(new Alias('ref')));
    assert.ok(isNode(new Scalar(1)));
    assert.ok(isCollection(new YAMLMap()));
    assert.ok(isCollection(new YAMLSeq()));
    assert.ok(!isScalar(new YAMLMap()));
    assert.ok(!isMap(new Scalar(1)));
  });
});

// ---- Comment preservation --------------------------------------------------

describe('Comments', () => {
  it('blank-line-separated comment → doc.commentBefore', () => {
    // Comment separated by blank line → doc.commentBefore (eemeli semantics)
    const doc = parseDocument('# top comment\n\na: 1\n');
    assert.ok(doc.commentBefore?.includes('top comment'),
      'blank-line-separated comment should be doc.commentBefore');
    const map = doc.contents as YAMLMap;
    const firstKey = map.items[0]?.key as Scalar;
    assert.equal(firstKey?.commentBefore, null,
      'first key should NOT have the doc-level comment');
  });

  it('adjacent comment → first key commentBefore', () => {
    // Comment directly before content (no blank line) → first node's commentBefore
    const doc = parseDocument('# before a\na: 1\n');
    assert.equal(doc.commentBefore, null,
      'adjacent comment should NOT be doc.commentBefore');
    const map = doc.contents as YAMLMap;
    const firstKey = map.items[0]?.key as Scalar;
    assert.ok(firstKey?.commentBefore?.includes('before a'),
      'adjacent comment should attach to first key');
  });

  it('comment before --- doc marker → doc.commentBefore', () => {
    const doc = parseDocument('# before marker\n---\na: 1\n');
    assert.ok(doc.commentBefore?.includes('before marker'),
      'comment before --- should be doc.commentBefore');
  });

  it('comment between keys attaches to next key', () => {
    const doc = parseDocument('a: 1\n# between\nb: 2\n');
    const map = doc.contents as YAMLMap;
    const secondKey = map.items[1]?.key as Scalar;
    assert.ok(secondKey?.commentBefore?.includes('between'),
      'comment between keys should attach to the next key');
  });
});

// ---- Error path tests ------------------------------------------------------

describe('Error paths', () => {
  it('malformed flow produces errors', () => {
    const doc = parseDocument('[1, 2,');
    assert.ok(doc.errors.length > 0);
  });

  it('unterminated quote produces errors', () => {
    const doc = parseDocument('"hello');
    assert.ok(doc.errors.length > 0);
  });

  it('error has position info', () => {
    const doc = parseDocument('{unclosed');
    if (doc.errors.length > 0) {
      const err = doc.errors[0]!;
      assert.ok(err.pos.length > 0);
      assert.ok(err.pos[0]!.line >= 1);
      assert.ok(err.pos[0]!.col >= 1);
    }
  });
});

// ---- Alias cycles and maxAliasCount (B2) -----------------------------------

describe('Alias cycles and maxAliasCount', () => {
  it('alias cycle does not crash toJS()', () => {
    const doc = parseDocument('a: &a\n  ref: *a\n');
    // Should not throw — creates a circular JS object
    const result = doc.toJS() as Record<string, unknown>;
    assert.ok(result.a !== undefined);
    // Verify circular reference
    assert.equal((result.a as Record<string, unknown>).ref, result.a);
  });

  it('maxAliasCount enforced — throws ReferenceError when exceeded', () => {
    const doc = parseDocument('a: &a [1, 2]\nb: *a\nc: *a\nd: *a\n');
    assert.throws(
      () => doc.toJS({ maxAliasCount: 2 }),
      (err: Error) => err instanceof ReferenceError && /Excessive alias count/.test(err.message),
    );
  });

  it('maxAliasCount: -1 means unlimited', () => {
    const doc = parseDocument('a: &a\n  ref: *a\n');
    // Should not throw with unlimited aliases
    const result = doc.toJS({ maxAliasCount: -1 }) as Record<string, unknown>;
    assert.ok(result.a !== undefined);
  });

  it('deep alias reuse within limit succeeds', () => {
    const doc = parseDocument('a: &a\n  x: 1\nb: *a\nc: *a\nd: *a\n');
    const result = doc.toJS() as Record<string, unknown>;
    assert.deepStrictEqual(result.b, { x: 1 });
    assert.deepStrictEqual(result.c, { x: 1 });
    assert.deepStrictEqual(result.d, { x: 1 });
  });
});

// ---- !!binary throws (M1) -------------------------------------------------

describe('!!binary tag', () => {
  it('!!binary throws NotImplemented on toJS()', () => {
    const doc = parseDocument('data: !!binary "SGVsbG8="');
    assert.throws(
      () => doc.toJS(),
      (err: Error) => /!!binary/.test(err.message),
    );
  });

  it('parse() with !!binary throws', () => {
    assert.throws(
      () => parse('data: !!binary "SGVsbG8="'),
      (err: Error) => /!!binary/.test(err.message),
    );
  });
});

// ---- strict mode (m4) ------------------------------------------------------

describe('strict mode', () => {
  it('strict:true detects tabs in indentation', () => {
    const doc = parseDocument('a:\n\tb: 1\n', { strict: true });
    assert.ok(doc.errors.length > 0, 'should have errors for tab indentation');
    assert.ok(doc.errors.some(e => /Tabs are not allowed/.test(e.message)),
      'error should mention tabs');
  });

  it('strict:false allows tabs in indentation', () => {
    const doc = parseDocument('a:\n\tb: 1\n', { strict: false });
    const tabErrors = doc.errors.filter(e => /Tabs are not allowed/.test(e.message));
    assert.equal(tabErrors.length, 0, 'strict:false should not flag tabs');
  });
});

// ---- toString best-effort (m5) ---------------------------------------------

describe('toString best-effort', () => {
  it('toString renders even when document has errors', () => {
    const doc = parseDocument('{unclosed: [');
    assert.ok(doc.errors.length > 0, 'should have parse errors');
    // Should not throw — renders what it can
    const str = doc.toString();
    assert.ok(typeof str === 'string');
  });
});
