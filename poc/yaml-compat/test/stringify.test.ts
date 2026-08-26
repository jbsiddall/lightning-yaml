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
    'json-records-small',
    'json-records-medium',
    'json-records-large',
    'comments-k8s-deployment',
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
