import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'yaml';
import { parse, parseDocument, parseAllDocuments, stringify, Document } from '../src/index.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CORPUS = join(HERE, '..', 'bench', 'corpus');

// ---- Corpus differential round-trip ----------------------------------------

describe('corpus differential round-trip', () => {
  const BYTE_IDENTICAL = new Set([
    'block-config',
    'comments-docker-compose',
    'comments-k8s-deployment',
    'json-records-small',
    'json-records-medium',
    'json-records-large',
    'large-block',
  ]);

  const MULTIDOC = new Set(['multidoc-k8s']);

  const files = readdirSync(CORPUS).filter((f) => f.endsWith('.yaml'));

  for (const file of files) {
    const name = file.replace('.yaml', '');
    it(name, () => {
      const text = readFileSync(join(CORPUS, file), 'utf8');

      if (MULTIDOC.has(name)) {
        // Multi-doc: parseAllDocuments + join, compare value equality per doc
        const ourDocs = parseAllDocuments(text);
        const yamlDocs = yaml.parseAllDocuments(text);
        const ourOutput = ourDocs.map((d) => d.toString()).join('');
        const yamlOutput = yamlDocs.map((d) => d.toString()).join('');
        // Compare parsed values per document
        const ourValues = yaml.parseAllDocuments(ourOutput).map((d) => d.toJS());
        const origValues = yamlDocs.map((d) => d.toJS());
        assert.deepEqual(ourValues, origValues);
        return;
      }

      const ourOutput = stringify(parseDocument(text));
      const yamlOutput = yaml.stringify(yaml.parseDocument(text));

      if (BYTE_IDENTICAL.has(name)) {
        assert.equal(ourOutput, yamlOutput);
      } else {
        // Value equality — our parser doesn't preserve spaceBefore on map keys
        const ourValue = yaml.parse(ourOutput);
        const origValue = yaml.parse(text);
        assert.deepEqual(ourValue, origValue);
      }
    });
  }
});

// ---- Basic stringify -------------------------------------------------------

describe('basic stringify', () => {
  it('stringifies a plain object', () => {
    assert.equal(stringify({ a: 1, b: 2 }), 'a: 1\nb: 2\n');
  });

  it('stringifies an array', () => {
    assert.equal(stringify([1, 2, 3]), '- 1\n- 2\n- 3\n');
  });

  it('stringifies nested structures', () => {
    const result = stringify({ a: [1, 2], b: { c: 3 } });
    assert.equal(result, 'a:\n  - 1\n  - 2\nb:\n  c: 3\n');
  });
});

// ---- Comment preservation --------------------------------------------------

describe('comment preservation', () => {
  it('preserves top and between comments', () => {
    const text = '# top\na: 1\n# between\nb: 2\n';
    const ourOut = parseDocument(text).toString();
    const yamlOut = yaml.stringify(yaml.parseDocument(text));
    assert.equal(ourOut, yamlOut);
  });

  it('preserves nested comments with indentation', () => {
    const text = 'a:\n  # nested\n  b: 1\n';
    const ourOut = parseDocument(text).toString();
    const yamlOut = yaml.stringify(yaml.parseDocument(text));
    assert.equal(ourOut, yamlOut);
  });
});

// ---- Flow collections ------------------------------------------------------

describe('flow collections', () => {
  it('round-trips flow sequence', () => {
    const text = 'a: [1, 2, 3]\n';
    const ourOut = parseDocument(text).toString();
    const yamlOut = yaml.stringify(yaml.parseDocument(text));
    assert.equal(ourOut, yamlOut);
  });

  it('round-trips flow mapping', () => {
    const text = 'a: {x: 1, y: 2}\n';
    const ourOut = parseDocument(text).toString();
    const yamlOut = yaml.stringify(yaml.parseDocument(text));
    assert.equal(ourOut, yamlOut);
  });
});

// ---- Block scalars ---------------------------------------------------------

describe('block scalars', () => {
  it('round-trips literal block scalar', () => {
    const text = 'script: |\n  echo hello\n';
    const ourOut = parseDocument(text).toString();
    const yamlOut = yaml.stringify(yaml.parseDocument(text));
    assert.equal(ourOut, yamlOut);
  });

  it('round-trips folded block scalar', () => {
    const text = 'desc: >\n  hello\n  world\n';
    const ourOut = parseDocument(text).toString();
    const yamlOut = yaml.stringify(yaml.parseDocument(text));
    assert.equal(ourOut, yamlOut);
  });
});

// ---- Anchors/aliases -------------------------------------------------------

describe('anchors and aliases', () => {
  it('round-trips anchor/alias', () => {
    const text = 'a: &ref\n  x: 1\nb: *ref\n';
    const ourOut = parseDocument(text).toString();
    const yamlOut = yaml.stringify(yaml.parseDocument(text));
    assert.equal(ourOut, yamlOut);
  });
});

// ---- Options ---------------------------------------------------------------

describe('stringify options', () => {
  it('respects indent: 4', () => {
    const result = stringify({ a: { b: 1 } }, { indent: 4 });
    assert.equal(result, 'a:\n    b: 1\n');
  });

  it('respects custom nullStr', () => {
    const result = stringify({ a: null }, { nullStr: '~' });
    assert.equal(result, 'a: ~\n');
  });

  it('respects custom trueStr', () => {
    const result = stringify({ a: true }, { trueStr: 'yes' });
    assert.equal(result, 'a: yes\n');
  });

  it('accepts a Document instance', () => {
    const doc = parseDocument('a: 1\n');
    const result = stringify(doc);
    assert.equal(result, 'a: 1\n');
  });
});

// ---- Options validation ----------------------------------------------------

describe('options validation', () => {
  it('throws on unknown option', () => {
    assert.throws(
      () => stringify({}, { unknownOpt: true } as any),
      /Not implemented in POC: unknownOpt/,
    );
  });
});

// ---- Document.toString() ---------------------------------------------------

describe('Document.toString()', () => {
  it('delegates to stringify', () => {
    const doc = parseDocument('a: 1\n');
    assert.equal(doc.toString(), stringify(doc));
  });
});

// ---- B1: block scalar + comment regression ---------------------------------

describe('block scalar + comment (B1)', () => {
  it('literal block scalar with following comment preserves value', () => {
    const text = 'script: |\n  echo hi\n# after block\nb: 2\n';
    const ourOut = parseDocument(text).toString();
    const yamlOut = yaml.stringify(yaml.parseDocument(text));
    assert.equal(ourOut, yamlOut);
    // Value must not be corrupted
    const reparsed = yaml.parse(ourOut);
    assert.equal(reparsed.script, 'echo hi\n');
  });

  it('folded block scalar with following comment preserves value', () => {
    const text = 'desc: >\n  hello\n# after\nb: 2\n';
    const ourOut = parseDocument(text).toString();
    const yamlOut = yaml.stringify(yaml.parseDocument(text));
    assert.equal(ourOut, yamlOut);
  });
});

// ---- M1: blank-line preservation -------------------------------------------

describe('blank-line preservation (M1)', () => {
  it('preserves blank line between map keys', () => {
    const text = 'a: 1\n\nb: 2\n';
    const ourOut = parseDocument(text).toString();
    const yamlOut = yaml.stringify(yaml.parseDocument(text));
    assert.equal(ourOut, yamlOut);
  });

  it('preserves blank line before comment block', () => {
    const text = 'a: 1\n\n# comment\nb: 2\n';
    const ourOut = parseDocument(text).toString();
    const yamlOut = yaml.stringify(yaml.parseDocument(text));
    assert.equal(ourOut, yamlOut);
  });

  it('no blank line when none in source', () => {
    const text = 'a: 1\nb: 2\n';
    const ourOut = parseDocument(text).toString();
    const yamlOut = yaml.stringify(yaml.parseDocument(text));
    assert.equal(ourOut, yamlOut);
  });
});

// ---- M2: option dispositions -----------------------------------------------

describe('option dispositions (M2)', () => {
  it('throws on lineWidth != 80', () => {
    assert.throws(
      () => stringify({ a: 1 }, { lineWidth: 20 }),
      /Not implemented in POC: lineWidth/,
    );
  });

  it('accepts lineWidth: 80 (default)', () => {
    assert.doesNotThrow(() => stringify({ a: 1 }, { lineWidth: 80 }));
  });

  it('throws on flowLevel != -1', () => {
    assert.throws(
      () => stringify({ a: { b: 1 } }, { flowLevel: 0 }),
      /Not implemented in POC: flowLevel/,
    );
  });

  it('accepts flowLevel: -1 (default)', () => {
    assert.doesNotThrow(() => stringify({ a: 1 }, { flowLevel: -1 }));
  });

  it('throws on defaultStringType != PLAIN', () => {
    assert.throws(
      () => stringify({ a: 'hello' }, { defaultStringType: 'QUOTE_DOUBLE' }),
      /Not implemented in POC: defaultStringType/,
    );
  });

  it('throws on directives: true', () => {
    assert.throws(
      () => stringify({ a: 1 }, { directives: true }),
      /Not implemented in POC: directives/,
    );
  });

  it('accepts directives: false (default)', () => {
    assert.doesNotThrow(() => stringify({ a: 1 }, { directives: false }));
  });
});

// ---- M3: multiline → block scalar ------------------------------------------

describe('multiline block scalar choice (M3)', () => {
  it('uses block scalar for multiline strings with trailing newline', () => {
    const result = stringify({ a: 'line1\nline2\n' });
    const expected = yaml.stringify({ a: 'line1\nline2\n' });
    assert.equal(result, expected);
    assert.ok(result.includes('|'));
  });

  it('uses block scalar for multiline strings without trailing newline', () => {
    const result = stringify({ a: 'line1\nline2' });
    const expected = yaml.stringify({ a: 'line1\nline2' });
    assert.equal(result, expected);
  });
});

// ---- M-new-1: all-newline and leading-newline strings ----------------------

describe('block scalar edge cases (M-new-1)', () => {
  const cases: [string, string][] = [
    ['single newline', '\n'],
    ['two newlines', '\n\n'],
    ['three newlines', '\n\n\n'],
    ['leading newline + content', '\nhello\n'],
    ['content + trailing blank', 'hello\n\n'],
    ['content + two trailing blanks', 'hello\n\n\n'],
    ['two leading newlines + content', '\n\nhello\n'],
    ['content around blank', 'a\n\nb\n'],
    ['leading space content', ' hello\n'],
    ['leading blank then space content', '\n hello\n'],
  ];

  for (const [name, value] of cases) {
    it(`byte-matches eemeli and round-trips: ${name}`, () => {
      const ours = stringify({ a: value });
      const eemeli = yaml.stringify({ a: value });
      assert.equal(ours, eemeli);
      const reparsed = yaml.parse(ours);
      assert.equal(reparsed.a, value);
    });
  }
});

// ---- m-new-2: blank-line indent in parsed block scalar ---------------------

describe('blank-line indent in block scalar (m-new-2)', () => {
  it('byte-matches eemeli for block scalar with blank line', () => {
    const text = 'a: |\n  \n  hello\n';
    const ourOut = parseDocument(text).toString();
    const yamlOut = yaml.stringify(yaml.parseDocument(text));
    assert.equal(ourOut, yamlOut);
  });
});

// ---- M4: empty document ----------------------------------------------------

describe('empty document (M4)', () => {
  it('renders empty document as null\\n like eemeli', () => {
    const result = stringify(parseDocument(''));
    const expected = yaml.stringify(yaml.parseDocument(''));
    assert.equal(result, expected);
    assert.equal(result, 'null\n');
  });
});

// ---- m4: bare document markers ---------------------------------------------

describe('bare document markers (m4)', () => {
  it('blank line between --- and ... with no content', () => {
    const result = stringify(parseDocument('---\n...\n'));
    const expected = yaml.stringify(yaml.parseDocument('---\n...\n'));
    assert.equal(result, expected);
    assert.equal(result, '---\n\n...\n');
  });
});

// ---- R3: adversarial string battery (≥30 shapes) ---------------------------

describe('adversarial string battery (R3)', () => {
  // Shapes where YAML block scalars strip whitespace-only trailing lines,
  // so even eemeli can't value-roundtrip. We assert byte-match + reparse
  // equivalence with eemeli (the oracle).
  const NON_ROUNDTRIPPABLE = new Set([
    ' \n', '   \n', '  \n  \n', ' \t \n',
  ]);

  const shapes: [string, string][] = [
    // Line endings
    ['\\r', '\r'],
    ['\\r\\r', '\r\r'],
    ['a\\rb\\n', 'a\rb\n'],
    ['a\\r\\nb\\n', 'a\r\nb\n'],
    ['a\\r\\nb', 'a\r\nb'],
    ['\\r\\n', '\r\n'],
    ['hello\\rworld\\n', 'hello\rworld\n'],
    // Whitespace-only trailing lines
    ['sp+lf', ' \n'],
    ['3sp+lf', '   \n'],
    ['2sp+lf+2sp+lf', '  \n  \n'],
    ['tab+lf', '\t\n'],
    ['sp+tab+sp+lf', ' \t \n'],
    ['a+lf+3sp+lf', 'a\n   \n'],
    ['a+lf+sp+lf', 'a\n \n'],
    ['a+lf+tab+lf', 'a\n\t\n'],
    // Blank-line runs
    ['lf', '\n'],
    ['lf+lf', '\n\n'],
    ['lf+lf+lf', '\n\n\n'],
    ['lf+hello+lf', '\nhello\n'],
    ['hello+lf+lf', 'hello\n\n'],
    ['hello+lf+lf+lf', 'hello\n\n\n'],
    ['lf+lf+hello+lf', '\n\nhello\n'],
    ['a+lf+lf+b+lf', 'a\n\nb\n'],
    // Leading/trailing spaces on content lines
    ['sp+a+lf+b+lf', ' a\nb\n'],
    ['a+sp+lf+b+lf', 'a \nb\n'],
    ['a+lf+sp+b+lf', 'a\n b\n'],
    ['2sp+hello+lf+2sp+world+lf', '  hello\n  world\n'],
    // Tabs in content
    ['a+tab+b+lf+c+lf', 'a\tb\nc\n'],
    ['tab+a+lf', '\ta\n'],
    // Unicode line breaks (literal U+2028, U+2029)
    ['a+u2028+b+lf', 'a b\n'],
    ['a+u2029+b+lf', 'a b\n'],
    // Control chars
    ['a+null+b+lf', 'a\0b\n'],
    ['a+esc+b+lf', 'a\x1bb\n'],
    // Indicator starts on lines
    ['dash+a+lf+b+lf', '- a\nb\n'],
    ['colon+a+lf', ': a\n'],
    ['hash+x+lf+y+lf', '# x\ny\n'],
    ['amp+a+x+lf', '&a x\n'],
    ['bang+t+x+lf', '!t x\n'],
    ['lbrace+a1+rbrace+lf+b+lf', '{a: 1}\nb\n'],
    ['lbracket1+rbracket+lf+b+lf', '[1]\nb\n'],
    // Bare oddities
    ['empty', ''],
    ['sp', ' '],
    ['a', 'a'],
    ['a+lf', 'a\n'],
    ['line1+lf+line2', 'line1\nline2'],
    ['true+lf+false+lf', 'true\nfalse\n'],
    ['123+lf+456+lf', '123\n456\n'],
    // Indent-sensitivity
    ['a+lf+2sp+b+lf+4sp+c+lf', 'a\n  b\n    c\n'],
  ];

  for (const [name, value] of shapes) {
    it(`byte-matches and reparses: ${name}`, () => {
      const ours = stringify({ a: value });
      const eemeli = yaml.stringify({ a: value });
      assert.equal(ours, eemeli, `byte-match for ${JSON.stringify(value)}`);
      const ourReparsed = yaml.parse(ours);
      const eemReparsed = yaml.parse(eemeli);
      if (NON_ROUNDTRIPPABLE.has(value)) {
        // eemeli itself can't roundtrip these (YAML strips ws-only lines in block scalars)
        assert.equal(ourReparsed.a, eemReparsed.a);
      } else {
        assert.equal(ourReparsed.a, value, `value-exact reparse for ${JSON.stringify(value)}`);
      }
    });
  }
});

// ---- PR5b fix round 1: indent / trueStr / version:1.1 parity --------------

const SEQ_OF_MAPS = `- name: app
  enabled: true
  ports:
    - name: http
      containerPort: 8080
      protocol: TCP
  livenessProbe:
    httpGet:
      path: /healthz
    initialDelaySeconds: 30
- name: other
  count: 2
  sparse: null
`;

describe('PR5b-F1: non-2 indent emits valid aligned YAML for seq-of-maps', () => {
  for (const indent of [2, 3, 4, 6]) {
    it(`indent ${indent}: reparse-equal + byte-match eemeli`, () => {
      const ours = stringify(parseDocument(SEQ_OF_MAPS), { indent });
      const theirs = yaml.parseDocument(SEQ_OF_MAPS).toString({ indent });
      assert.deepEqual(yaml.parse(ours), yaml.parse(SEQ_OF_MAPS), `reparse matches original`);
      assert.strictEqual(ours, theirs, `byte-match indent ${indent}`);
    });
  }
});

describe('PR5b-F2: trueStr/falseStr preserve round-tripping bool source', () => {
  const src = 'flag: true\non: false\nnested:\n  also: true\n';
  for (const opts of [
    { trueStr: 'yes', falseStr: 'no' },
    { trueStr: 'Y', falseStr: 'N' },
  ]) {
    it(`byte-matches eemeli for ${JSON.stringify(opts)}`, () => {
      const ours = stringify(parseDocument(src), opts);
      const theirs = yaml.parseDocument(src).toString(opts);
      assert.strictEqual(ours, theirs);
    });
  }
});

describe('PR5b-F3: version:"1.1" resolves merge keys', () => {
  it('merges `<<` like eemeli when version is 1.1', () => {
    const src = `b: &b\n  x: 1\n  y: 2\nsvc:\n  <<: *b\n  z: 3\n`;
    const ours = parse(src, { version: '1.1' }) as Record<string, any>;
    const theirs = yaml.parse(src, { version: '1.1' }) as Record<string, any>;
    assert.deepEqual(ours.svc.x, theirs.svc.x, 'merge value x');
    assert.deepEqual(ours.svc.z, theirs.svc.z, 'own key z');
    assert.ok(!('<<' in ours.svc), '`<<` resolved, not kept as a data key');
  });

  it('does NOT resolve `<<` by default (1.2), matching eemeli', () => {
    const src = `b: &b\n  x: 1\nsvc:\n  <<: *b\n  z: 3\n`;
    const ours = parse(src) as Record<string, any>;
    const theirs = yaml.parse(src) as Record<string, any>;
    assert.ok('<<' in ours.svc);
    assert.deepEqual(ours, theirs);
  });
});

describe('PR5b-M2: nested block seqs render inline, matching eemeli', () => {
  const cases: string[] = [
    '- - 1\n  - 2\n',
    '- - - 1\n',
    '- - 1\n  - 2\n  - - 3\n    - 4\n',
    '- - a: 1\n    b: 2\n  - c: 3\n',
    'a:\n  - - 1\n    - 2\n',
  ];
  for (const src of cases) {
    it(`stringifies ${JSON.stringify(src.trim())} byte-identically`, () => {
      const ours = stringify(parseDocument(src));
      const theirs = yaml.parseDocument(src).toString();
      assert.equal(ours, theirs);
      assert.equal(ours, src);
      // Output must reparse to the same value
      assert.deepEqual(parseDocument(ours).toJS(), yaml.parseDocument(src).toJS());
    });
  }
});

describe('PR5b-M1: bool source preservation, matching eemeli', () => {
  it('preserves canonical bool spellings instead of the option string', () => {
    for (const src of ['a: True\n', 'a: TRUE\n', 'a: true\n', 'a: False\n', 'a: FALSE\n', 'a: false\n']) {
      const ours = stringify(parseDocument(src), { trueStr: 'yes', falseStr: 'no' });
      const theirs = yaml.parseDocument(src).toString({ trueStr: 'yes', falseStr: 'no' });
      assert.equal(ours, theirs);
      assert.equal(ours, src);
    }
  });
  it('non-canonical programmatic bools (no source) use the option string', () => {
    const doc = parseDocument('a: x\n');
    doc.set('b', true);
    assert.equal(doc.toString({ trueStr: 'yes', falseStr: 'no' }).includes('b: yes'), true);
  });
  it('default options leave bool output unchanged', () => {
    const doc = parseDocument('a: True\n');
    assert.equal(doc.toString(), yaml.parseDocument('a: True\n').toString());
  });
});
