/**
 * Differential tests for the yaml-compat POC API surface.
 *
 * Tests visit controls, Document methods, createNode, type guards,
 * Scalar.range, and CUT option loud-throws against real yaml v2.9.0.
 *
 * Run:  node --import tsx --test poc/yaml-compat/test/api.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as yaml from 'yaml';
import {
  parse, parseDocument, parseAllDocuments,
  Scalar, YAMLMap, YAMLSeq, Pair, Alias,
  isScalar, isMap, isSeq, isPair, isAlias, isNode, isCollection, isDocument,
  visit, visitAsync, createNode,
} from '../src/index.ts';

// ---- visit control-flow differential ---------------------------------------

describe('visit SKIP/BREAK/REMOVE differential', () => {
  it('REMOVE deletes a Pair from a Map', () => {
    const src = 'a: 1\nb: 2\nc: 3';
    const ours = parseDocument(src);
    const theirs = yaml.parseDocument(src);

    const visitOurs: string[] = [];
    visit(ours, {
      Pair(_key, pair) {
        const k = (pair.key as Scalar).value as string;
        visitOurs.push(k);
        if (k === 'b') return visit.REMOVE;
      },
    });

    const visitTheirs: string[] = [];
    yaml.visit(theirs, {
      Pair(_key, pair) {
        const k = (pair.key as yaml.Scalar).value as string;
        visitTheirs.push(k);
        if (k === 'b') return yaml.visit.REMOVE;
      },
    });

    assert.deepStrictEqual(visitOurs, visitTheirs);
    assert.equal(ours.toString(), theirs.toString());
  });

  it('BREAK stops traversal', () => {
    const src = 'a: 1\nb: 2\nc: 3';
    const ours = parseDocument(src);
    const theirs = yaml.parseDocument(src);

    const visitOurs: string[] = [];
    visit(ours, {
      Pair(_key, pair) {
        const k = (pair.key as Scalar).value as string;
        visitOurs.push(k);
        if (k === 'b') return visit.BREAK;
      },
    });

    const visitTheirs: string[] = [];
    yaml.visit(theirs, {
      Pair(_key, pair) {
        const k = (pair.key as yaml.Scalar).value as string;
        visitTheirs.push(k);
        if (k === 'b') return yaml.visit.BREAK;
      },
    });

    assert.deepStrictEqual(visitOurs, visitTheirs);
  });

  it('SKIP prevents child traversal', () => {
    const src = 'a:\n  x: 1\n  y: 2\nb: 3';
    const ours = parseDocument(src);
    const theirs = yaml.parseDocument(src);

    const visitOurs: string[] = [];
    visit(ours, {
      Map(key) {
        visitOurs.push('map@' + key);
        if (key === null) return visit.SKIP;
      },
      Pair(_key, pair) {
        visitOurs.push('pair:' + (pair.key as Scalar).value);
      },
    });

    const visitTheirs: string[] = [];
    yaml.visit(theirs, {
      Map(key) {
        visitTheirs.push('map@' + key);
        if (key === null) return yaml.visit.SKIP;
      },
      Pair(_key, pair) {
        visitTheirs.push('pair:' + (pair.key as yaml.Scalar).value);
      },
    });

    assert.deepStrictEqual(visitOurs, visitTheirs);
  });

  it('function visitor receives key, node, path', () => {
    const src = 'a: 1';
    const ours = parseDocument(src);
    const theirs = yaml.parseDocument(src);

    const oursKeys: unknown[] = [];
    visit(ours, (key) => { oursKeys.push(key); });

    const theirsKeys: unknown[] = [];
    yaml.visit(theirs, (key) => { theirsKeys.push(key); });

    assert.deepStrictEqual(oursKeys, theirsKeys);
  });

  it('visit on plain JS value calls visitor with (null, value, [])', () => {
    let called = false;
    visit({ a: 1 }, (key, node) => {
      called = true;
      assert.equal(key, null);
      assert.deepStrictEqual(node, { a: 1 });
    });
    assert.ok(called);
  });
});

// ---- visitAsync loud throw -------------------------------------------------

describe('visitAsync', () => {
  it('throws "Not implemented in POC"', () => {
    assert.throws(
      () => visitAsync(parseDocument('a: 1'), {}),
      { message: 'Not implemented in POC: visitAsync' },
    );
  });
});

// ---- Type guard edge cases -------------------------------------------------

describe('type guard edge cases', () => {
  it('isScalar', () => {
    assert.equal(isScalar(null), false);
    assert.equal(isScalar(undefined), false);
    assert.equal(isScalar(42), false);
    assert.equal(isScalar(new Scalar(1)), true);
    assert.equal(yaml.isScalar(null), false);
    assert.equal(yaml.isScalar(42), false);
    assert.equal(yaml.isScalar(new yaml.Scalar(1)), true);
  });

  it('isMap', () => {
    assert.equal(isMap(null), false);
    assert.equal(isMap({}), false);
    assert.equal(isMap(new YAMLMap()), true);
  });

  it('isSeq', () => {
    assert.equal(isSeq(null), false);
    assert.equal(isSeq([]), false);
    assert.equal(isSeq(new YAMLSeq()), true);
  });

  it('isPair', () => {
    assert.equal(isPair(null), false);
    assert.equal(isPair({}), false);
    assert.equal(isPair(new Pair(null, null)), true);
  });

  it('isAlias', () => {
    assert.equal(isAlias(null), false);
    assert.equal(isAlias(new Alias('x')), true);
  });

  it('isNode', () => {
    assert.equal(isNode(null), false);
    assert.equal(isNode({}), false);
    assert.equal(isNode(new Scalar(1)), true);
    assert.equal(isNode(new YAMLMap()), true);
    assert.equal(isNode(new YAMLSeq()), true);
    assert.equal(isNode(new Alias('x')), true);
  });

  it('isCollection', () => {
    assert.equal(isCollection(null), false);
    assert.equal(isCollection(new YAMLMap()), true);
    assert.equal(isCollection(new YAMLSeq()), true);
    assert.equal(isCollection(new Scalar(1)), false);
  });

  it('isDocument', () => {
    assert.equal(isDocument(null), false);
    assert.equal(isDocument(undefined), false);
    assert.equal(isDocument({}), false);
    assert.equal(isDocument(new Scalar(1)), false);
    assert.equal(isDocument(parseDocument('a: 1')), true);
    assert.equal(yaml.isDocument(null), false);
    assert.equal(yaml.isDocument({}), false);
    assert.equal(yaml.isDocument(yaml.parseDocument('a: 1')), true);
  });
});

// ---- Scalar.range on all nodes ---------------------------------------------

describe('Scalar.range', () => {
  it('parsed scalar has non-null range', () => {
    const doc = parseDocument('a: 1');
    const map = doc.contents as YAMLMap;
    const pair = map.items[0]!;
    assert.ok(pair.key?.range, 'key scalar range should be set');
    assert.ok(pair.value?.range, 'value scalar range should be set');
    assert.equal(pair.key!.range!.length, 3);
    assert.equal(pair.value!.range!.length, 3);
  });

  it('range matches eemeli [start, valueEnd, nodeEnd]', () => {
    const src = 'a: 1';
    const ours = parseDocument(src);
    const theirs = yaml.parseDocument(src);

    const ourPair = (ours.contents as YAMLMap).items[0]!;
    const theirPair = (theirs.contents as yaml.YAMLMap).items[0]!;

    assert.deepStrictEqual(ourPair.key!.range, (theirPair.key as any).range);
    assert.deepStrictEqual(ourPair.value!.range, (theirPair.value as any).range);
  });

  it('value nodeEnd extends to end of line (trailing newline)', () => {
    const cases = [
      'key: value\n',
      'a: 1\nb: 2\n',
      'k: "quoted"\n',
      'k: v # comment\n',
      'a: [1, 2, 3]\n',
      'a: {x: 1}\n',
      "a: 'single'\n",
      'a: |\n  hello\n',
    ];
    for (const src of cases) {
      const ours = parseDocument(src);
      const theirs = yaml.parseDocument(src);
      const ourPair = (ours.contents as YAMLMap).items[0]!;
      const theirPair = (theirs.contents as yaml.YAMLMap).items[0]!;
      assert.deepStrictEqual(
        ourPair.value!.range,
        (theirPair.value as any).range,
        `value range mismatch for ${JSON.stringify(src)}`,
      );
    }
  });

  it('block scalar has range', () => {
    const doc = parseDocument('a: |\n  hello');
    const pair = (doc.contents as YAMLMap).items[0]!;
    assert.ok(pair.value?.range);
  });

  it('single-quoted scalar has range', () => {
    const doc = parseDocument("a: 'hello'");
    const pair = (doc.contents as YAMLMap).items[0]!;
    assert.ok(pair.key?.range);
    assert.ok(pair.value?.range);
  });
});

// ---- Document methods differential -----------------------------------------

describe('Document methods differential', () => {
  it('get / getIn with keepScalar', () => {
    const src = 'a: 1\nb:\n  c: 2';
    const ours = parseDocument(src);
    const theirs = yaml.parseDocument(src);

    assert.equal(ours.get('a'), theirs.get('a'));
    assert.equal(ours.getIn(['b', 'c']), theirs.getIn(['b', 'c']));

    const oursKeep = ours.get('a', true);
    const theirsKeep = theirs.get('a', true);
    assert.equal(isScalar(oursKeep), yaml.isScalar(theirsKeep));
    assert.equal((oursKeep as Scalar).value, (theirsKeep as yaml.Scalar).value);
  });

  it('has / hasIn', () => {
    const src = 'a: 1\nb:\n  c: 2';
    const ours = parseDocument(src);
    const theirs = yaml.parseDocument(src);

    assert.equal(ours.has('a'), theirs.has('a'));
    assert.equal(ours.has('z'), theirs.has('z'));
    assert.equal(ours.hasIn(['b', 'c']), theirs.hasIn(['b', 'c']));
    assert.equal(ours.hasIn(['b', 'z']), theirs.hasIn(['b', 'z']));
  });

  it('set / setIn', () => {
    const src = 'a: 1\nb:\n  c: 2';
    const ours = parseDocument(src);
    const theirs = yaml.parseDocument(src);

    ours.set('a', 42);
    theirs.set('a', 42);
    assert.equal(ours.get('a'), theirs.get('a'));

    ours.setIn(['b', 'c'], 99);
    theirs.setIn(['b', 'c'], 99);
    assert.equal(ours.getIn(['b', 'c']), theirs.getIn(['b', 'c']));
  });

  it('delete / deleteIn', () => {
    const src = 'a: 1\nb: 2\nc:\n  d: 3';
    const ours = parseDocument(src);
    const theirs = yaml.parseDocument(src);

    assert.equal(ours.delete('b'), theirs.delete('b'));
    assert.equal(ours.has('b'), theirs.has('b'));

    assert.equal(ours.deleteIn(['c', 'd']), theirs.deleteIn(['c', 'd']));
    assert.equal(ours.hasIn(['c', 'd']), theirs.hasIn(['c', 'd']));
  });

  it('add Pair to map', () => {
    const src = 'a: 1';
    const ours = parseDocument(src);
    const theirs = yaml.parseDocument(src);

    ours.add(new Pair(new Scalar('b'), new Scalar(2)));
    theirs.add(new yaml.Pair(new yaml.Scalar('b'), new yaml.Scalar(2)));

    assert.equal(ours.get('b'), theirs.get('b'));
  });

  it('add plain string to map becomes key with null value', () => {
    const ours = parseDocument('a: 1\n');
    const theirs = yaml.parseDocument('a: 1\n');
    ours.add('new');
    theirs.add('new');
    assert.equal(ours.toString(), theirs.toString());
  });

  it('add plain number to seq', () => {
    const ours = parseDocument('- 1\n- 2\n');
    const theirs = yaml.parseDocument('- 1\n- 2\n');
    ours.add(3);
    theirs.add(3);
    assert.equal(ours.toString(), theirs.toString());
  });

  it('add Pair with plain string key/value', () => {
    const ours = parseDocument('a: 1\n');
    const theirs = yaml.parseDocument('a: 1\n');
    ours.add(new Pair('k', 'v'));
    theirs.add(new yaml.Pair('k', 'v'));
    assert.equal(ours.toString(), theirs.toString());
  });

  it('addIn to nested seq', () => {
    const src = 'list:\n  - x\n  - y';
    const ours = parseDocument(src);
    const theirs = yaml.parseDocument(src);

    ours.addIn(['list'], new Scalar('z'));
    theirs.addIn(['list'], new yaml.Scalar('z'));

    assert.equal(ours.getIn(['list', 2]), theirs.getIn(['list', 2]));
  });

  it('addIn plain value to nested seq', () => {
    const ours = parseDocument('list:\n  - 1\n  - 2\n');
    const theirs = yaml.parseDocument('list:\n  - 1\n  - 2\n');
    ours.addIn(['list'], 3);
    theirs.addIn(['list'], 3);
    assert.equal(ours.toString(), theirs.toString());
  });

  it('clone produces independent copy', () => {
    const doc = parseDocument('a: 1\nb: 2');
    const cloned = doc.clone();

    assert.notEqual(cloned, doc);
    assert.equal(cloned.get('a'), doc.get('a'));

    cloned.set('a', 99);
    assert.equal(cloned.get('a'), 99);
    assert.equal(doc.get('a'), 1);
  });

  it('toJSON returns plain JS', () => {
    const doc = parseDocument('a: 1\nb:\n  - 2\n  - 3');
    const js = doc.toJSON();
    assert.deepStrictEqual(js, { a: 1, b: [2, 3] });
  });

  it('createNode converts JS to AST', () => {
    const doc = parseDocument('');
    const node = doc.createNode({ a: 1, b: [2, 3] });
    assert.ok(isMap(node));
    const map = node as YAMLMap;
    assert.equal(map.items.length, 2);
    assert.equal((map.items[0]!.key as Scalar).value, 'a');
    assert.equal((map.items[0]!.value as Scalar).value, 1);
  });

  it('standalone createNode convenience', () => {
    const node = createNode(42);
    assert.ok(isScalar(node));
    assert.equal((node as Scalar).value, 42);
  });
});

// ---- CUT options loud throw ------------------------------------------------

describe('CUT options throw loud', () => {
  it('parse throws for mapAsMap', () => {
    assert.throws(
      () => parse('a: 1', { mapAsMap: true } as any),
      /Not implemented in POC.*mapAsMap/,
    );
  });

  it('parse throws for intAsBigInt', () => {
    assert.throws(
      () => parse('a: 1', { intAsBigInt: true } as any),
      /Not implemented in POC.*intAsBigInt/,
    );
  });

  it('parse throws for reviver', () => {
    assert.throws(
      () => parse('a: 1', { reviver: () => {} } as any),
      /Not implemented in POC.*reviver/,
    );
  });

  it('parseDocument throws for stringKeys', () => {
    assert.throws(
      () => parseDocument('a: 1', { stringKeys: true } as any),
      /Not implemented in POC.*stringKeys/,
    );
  });

  it('parseAllDocuments throws for prettyErrors', () => {
    assert.throws(
      () => parseAllDocuments('a: 1', { prettyErrors: true } as any),
      /Not implemented in POC.*prettyErrors/,
    );
  });

  it('!!binary throws loud in toJS', () => {
    const doc = parseDocument('data: !!binary aGVsbG8=');
    assert.throws(
      () => doc.toJS(),
      /Not implemented in POC.*!!binary/,
    );
  });
});

// ---- C0 control escape fidelity -------------------------------------------

describe('C0 control escape fidelity', () => {
  it('escapes round-trip to same value as eemeli', () => {
    const controls = '\x00\x07\x08\x09\x0a\x0b\x0c\x0d\x1b';
    const doc = parseDocument('a: "\\0\\a\\b\\t\\n\\v\\f\\r\\e"');
    const ours = doc.toString();
    const theirs = yaml.stringify({ a: controls });
    assert.deepStrictEqual(parse(ours), parse(theirs));
  });
});

// ---- parseAllDocuments differential ----------------------------------------

describe('parseAllDocuments', () => {
  it('parses multiple documents', () => {
    const src = 'a: 1\n---\nb: 2\n---\nc: 3';
    const ours = parseAllDocuments(src);
    const theirs = yaml.parseAllDocuments(src);

    assert.equal(ours.length, theirs.length);
    for (let i = 0; i < ours.length; i++) {
      assert.deepStrictEqual(ours[i]!.toJS(), theirs[i]!.toJS());
    }
  });
});

// ---- Round-2 fixes: F1–F5 regression ----------------------------------------

describe('F1: set/setIn wraps plain JS objects and arrays', () => {
  it('set() with object value', () => {
    const d = parseDocument('a: 1\n'); const e = yaml.parseDocument('a: 1\n');
    d.set('b', { c: 2 }); e.set('b', { c: 2 });
    assert.equal(d.toString(), e.toString());
  });
  it('set() with array value', () => {
    const d = parseDocument('a: 1\n'); const e = yaml.parseDocument('a: 1\n');
    d.set('b', [1]); e.set('b', [1]);
    assert.equal(d.toString(), e.toString());
  });
  it('setIn() with object value replacing scalar', () => {
    const d = parseDocument('a: 1\n'); const e = yaml.parseDocument('a: 1\n');
    d.setIn(['a'], { b: 2 }); e.setIn(['a'], { b: 2 });
    assert.equal(d.toString(), e.toString());
  });
  it('setIn() with array value replacing scalar', () => {
    const d = parseDocument('a: 1\n'); const e = yaml.parseDocument('a: 1\n');
    d.setIn(['a'], [1, 2]); e.setIn(['a'], [1, 2]);
    assert.equal(d.toString(), e.toString());
  });
});

describe('F2: addIn() multi-segment path creation', () => {
  it('creates intermediate maps for new keys', () => {
    const d = parseDocument('a: 1\n'); const e = yaml.parseDocument('a: 1\n');
    d.addIn(['b', 'c'], 2); e.addIn(['b', 'c'], 2);
    assert.equal(d.toString(), e.toString());
  });
  it('adds into existing flow map', () => {
    const d = parseDocument('a: {x: 1}\n'); const e = yaml.parseDocument('a: {x: 1}\n');
    d.addIn(['a', 'y'], 2); e.addIn(['a', 'y'], 2);
    assert.equal(d.toString(), e.toString());
  });
});

describe('F3: setIn/addIn/deleteIn through scalar throws', () => {
  it('setIn through scalar throws', () => {
    const d = parseDocument('a: 1\n');
    assert.throws(() => d.setIn(['a', 'b'], 2), /Expected YAML collection at a/);
  });
  it('addIn through scalar (seq item) throws', () => {
    const d = parseDocument('a:\n  - 1\n');
    assert.throws(() => d.addIn(['a', 0], 9), /Expected YAML collection at 0/);
  });
  it('deleteIn through scalar throws', () => {
    const d = parseDocument('a: 1\n');
    assert.throws(() => d.deleteIn(['a', 'b']), /Expected YAML collection at a/);
  });
  it('error message matches eemeli exactly', () => {
    const d = parseDocument('a: 1\n'); const e = yaml.parseDocument('a: 1\n');
    let oursErr = '', theirsErr = '';
    try { d.setIn(['a', 'b'], 2); } catch (err: any) { oursErr = err.message; }
    try { e.setIn(['a', 'b'], 2); } catch (err: any) { theirsErr = err.message; }
    assert.equal(oursErr, theirsErr);
  });
});

describe('F4: Document.range semantics', () => {
  const cases: [string, [number, number, number]][] = [
    ['k: v', [0, 4, 4]],
    ['k: v\n', [0, 5, 5]],
    ['k: v\n\n', [0, 5, 6]],
    ['k: v\n\n\n', [0, 5, 7]],
    ['k: v\n# trailing comment\n', [0, 5, 24]],
    ['k: v\n\n# comment after\n', [0, 5, 22]],
    ['\n\nk: v\n', [2, 7, 7]],
    ['k: v\n ', [0, 5, 6]],
    ['# lead comment\nk: v\n', [15, 20, 20]],
    ['', [0, 0, 0]],
    ['k: v # trailing\n', [0, 16, 16]],
  ];
  for (const [src, expected] of cases) {
    it(`range for ${JSON.stringify(src)}`, () => {
      const d = parseDocument(src);
      assert.deepStrictEqual(d.range, expected);
    });
  }
  it('byte-matches eemeli for all shapes', () => {
    for (const [src] of cases) {
      const d = parseDocument(src);
      const e = yaml.parseDocument(src);
      assert.deepStrictEqual(d.range, (e as any).range, `mismatch for ${JSON.stringify(src)}`);
    }
  });
});

describe('F5: top-level flow document contents range', () => {
  it('flow map nodeEnd extends to end of line', () => {
    const d = parseDocument('{f: 1}\n');
    const e = yaml.parseDocument('{f: 1}\n');
    assert.deepStrictEqual(d.contents!.range, (e.contents as any).range);
  });
  it('multi-line flow map', () => {
    const src = '{\n  a: 1,\n  b: 2\n}\n';
    const d = parseDocument(src);
    const e = yaml.parseDocument(src);
    assert.deepStrictEqual(d.contents!.range, (e.contents as any).range);
  });
  it('nested flow range stays correct', () => {
    const src = 'a: {f: 1}\n';
    const d = parseDocument(src);
    const e = yaml.parseDocument(src);
    const ourPair = (d.contents as YAMLMap).items[0]!;
    const theirPair = (e.contents as yaml.YAMLMap).items[0]!;
    assert.deepStrictEqual(ourPair.value!.range, (theirPair.value as any).range);
  });
});

// ---- Document.range differential (single-doc + multi-doc) ------------------

describe('Document.range matches eemeli', () => {
  const singleCases: string[] = [
    '---\nk: v\n',
    '--- k: v\n',
    '---  \nk: v\n',
    'k: v\n',
    '---\n# c\nk: v\n',
    '---\n\nk: v\n',
    '%YAML 1.2\n---\nk: v\n',
    '# leading\n---\nk: v\n',
    '---\nk: v\n\n',
    'k: v\n...\n',
    'k: v\n... \n',
    'k: v\n...\n\n',
    'k: v\n...\nk2: v2\n',
    '',
    '# only comment\n',
    '---\n',
    '---\n...\n',
    '---\nk: v\n...\n',
    '\n\nk: v\n',
    '# lead comment\nk: v\n',
    'k: v\n# trailing comment\n',
    'k: v # same-line\n',
    'a: &x 1\nb: *x\n',
    // no-content --- with inline comment (round-4 MAJOR-1)
    '--- # c\n',
    '---  # c\n',
    '--- # c\n\n',
    '--- # c\n\n# later\n',
    '---\t# c\n',
    '--- # c\n...\n',
    // only-... document (round-4 MAJOR-2)
    '...\n',
    '... \n',
    '...\n\n',
    '... # c\n',
    '...\n# after\n',
    // directives without --- marker (round-4 MINOR-5)
    '%YAML 1.2\nk: v\n',
    '%TAG !y! tag:x\nk: v\n',
  ];

  for (const src of singleCases) {
    it(`parseDocument ${JSON.stringify(src)}`, () => {
      const ours = parseDocument(src);
      const theirs = yaml.parseDocument(src);
      const ourRange = ours.range!;
      assert.deepStrictEqual(Array.from(ourRange), Array.from((theirs as any).range as [number, number, number]), `range mismatch for ${JSON.stringify(src)}`);
    });
  }

  // Error-code parity vs eemeli — limited to the round-4 error rows we reproduce;
  // legacy round-3 rows (e.g. '--- k: v\n', post-... content) have intentional gaps.
  const errorRows: string[] = [
    '%YAML 1.2\nk: v\n',
    '%TAG !y! tag:x\nk: v\n',
  ];
  for (const src of errorRows) {
    it(`error code matches eemeli ${JSON.stringify(src)}`, () => {
      const ours = parseDocument(src);
      const theirs = yaml.parseDocument(src);
      const ourCodes = ours.errors.map((e) => (e as any).code).filter((c: unknown) => c !== undefined);
      const theirCodes = ((theirs as any).errors as any[]).map((e) => e.code).filter((c: unknown) => c !== undefined);
      assert.deepStrictEqual(ourCodes, theirCodes, `error codes mismatch for ${JSON.stringify(src)}`);
    });
  }

  const multiCases: string[] = [
    '---\na: 1\n---\nb: 2\n...\n',
    '---\na: 1\n---\nb: 2\n',
    'a: 1\n---\nb: 2\n',
    'k: v\n---\n---\nx: 1\n',
    // round-4 multi-doc no-content edges
    '...\n---\nk: v\n',
    'k: v\n...\n...\n',
    '---\n...\n---\nx: 1\n',
  ];

  for (const src of multiCases) {
    it(`parseAllDocuments ${JSON.stringify(src)}`, () => {
      const ours = [...parseAllDocuments(src)];
      const theirs = [...yaml.parseAllDocuments(src)];
      assert.equal(ours.length, theirs.length, 'doc count mismatch');
      for (let i = 0; i < ours.length; i++) {
        const ourRange = ours[i].range!;
        assert.deepStrictEqual(
          Array.from(ourRange),
          Array.from((theirs[i] as any).range as [number, number, number]),
          `doc[${i}] range mismatch for ${JSON.stringify(src)}`,
        );
      }
    });
  }
});
