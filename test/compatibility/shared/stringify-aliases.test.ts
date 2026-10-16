import { test } from "@fast-check/vitest";
import fc from "fast-check";
import * as jsYamlReference from "js-yaml";
import * as yamlReference from "yaml";
import { describe, expect } from "vitest";
import { dump, load } from "../../../src/js-yaml-compat.ts";
import { parse, stringify } from "../../../src/yaml-compat.ts";
import { compareGraph } from "./graph.js";

type Payload = {
  number: number;
  flag: boolean;
  text: string;
  numbers: number[];
};

type Leaf = Payload & { nil: null };
type MapRoot = {
  diamond: object | unknown[];
  leaf: Leaf;
  leafAgain: Leaf;
  sequence: unknown[];
  sequenceAgain: unknown[];
  equalLeafA: Leaf;
  equalLeafB: Leaf;
  equalSequenceA: unknown[];
  equalSequenceB: unknown[];
};
type SequenceRoot = [
  object | unknown[], Leaf, Leaf, unknown[], unknown[], Leaf, Leaf, unknown[], unknown[],
];
type RootKind = "map" | "sequence";

const payloadArb: fc.Arbitrary<Payload> = fc.record({
  number: fc.integer({ min: -100, max: 100 }),
  flag: fc.boolean(),
  text: fc.array(fc.constantFrom("a", "Z", "0", " ", "-", "_", ":"), {
    maxLength: 12,
  }).map((chars) => `value_${chars.join("")}`),
  numbers: fc.array(fc.integer({ min: -10, max: 10 }), { maxLength: 3 }),
});
const depthArb = fc.integer({ min: 1, max: 3 });

function makeLeaf(payload: Payload): Leaf {
  return { ...payload, numbers: [...payload.numbers], nil: null };
}

function makeAcyclic(payload: Payload, depth: number, kind: RootKind) {
  const leaf = makeLeaf(payload);
  const sequence = [payload.number, payload.text, payload.flag, null];
  let diamond: object | unknown[] = leaf;
  for (let level = 0; level < depth; level++) {
    diamond = level % 2 === 0
      ? { left: diamond, right: diamond }
      : [diamond, diamond];
  }
  const equalLeafA = makeLeaf(payload);
  const equalLeafB = makeLeaf(payload);
  const equalSequenceA = [...sequence];
  const equalSequenceB = [...sequence];
  const root: MapRoot | SequenceRoot = kind === "map"
    ? {
        diamond,
        leaf,
        leafAgain: leaf,
        sequence,
        sequenceAgain: sequence,
        equalLeafA,
        equalLeafB,
        equalSequenceA,
        equalSequenceB,
      }
    : [diamond, leaf, leaf, sequence, sequence, equalLeafA, equalLeafB, equalSequenceA, equalSequenceB];
  return { root, depth, kind };
}

function acyclicSlots(root: unknown, kind: RootKind) {
  if (kind === "map") return root as MapRoot;
  const values = root as SequenceRoot;
  return {
    diamond: values[0],
    leaf: values[1],
    leafAgain: values[2],
    sequence: values[3],
    sequenceAgain: values[4],
    equalLeafA: values[5],
    equalLeafB: values[6],
    equalSequenceA: values[7],
    equalSequenceB: values[8],
  };
}

function assertGraphEqual(expected: unknown, actual: unknown, label: string) {
  const result = compareGraph(expected, actual);
  expect(result.equal, `${label}: ${result.path ?? "$"} ${result.reason ?? ""}`).toBe(true);
}

function assertAcyclic(
  actualValue: unknown,
  expectedValue: unknown,
  payload: Payload,
  depth: number,
  kind: RootKind,
  label: string,
) {
  assertGraphEqual(expectedValue, actualValue, label);
  const actual = acyclicSlots(actualValue, kind);
  expect(Array.isArray(actualValue)).toBe(kind === "sequence");
  if (kind === "map") expect(Object.getPrototypeOf(actualValue)).toBe(Object.prototype);
  expect(actual.leaf.number).toBe(payload.number);
  expect(typeof actual.leaf.number).toBe("number");
  expect(actual.leaf.flag).toBe(payload.flag);
  expect(typeof actual.leaf.flag).toBe("boolean");
  expect(actual.leaf.text).toBe(payload.text);
  expect(typeof actual.leaf.text).toBe("string");
  expect(actual.leaf.nil).toBeNull();
  expect(actual.leaf.numbers).toEqual(payload.numbers);
  expect(Object.getPrototypeOf(actual.leaf)).toBe(Object.prototype);
  expect(Array.isArray(actual.sequence)).toBe(true);
  expect(Object.getPrototypeOf(actual.sequence)).toBe(Array.prototype);
  expect(actual.leafAgain).toBe(actual.leaf);
  expect(actual.sequenceAgain).toBe(actual.sequence);
  expect(actual.equalLeafA).not.toBe(actual.equalLeafB);
  expect(actual.equalLeafA).not.toBe(actual.leaf);
  expect(actual.equalLeafB).not.toBe(actual.leaf);
  expect(actual.equalLeafA).toEqual(actual.leaf);
  expect(actual.equalLeafB).toEqual(actual.leaf);
  expect(actual.equalSequenceA).not.toBe(actual.equalSequenceB);
  expect(actual.equalSequenceA).not.toBe(actual.sequence);
  expect(actual.equalSequenceB).not.toBe(actual.sequence);
  expect(actual.equalSequenceA).toEqual(actual.sequence);
  expect(actual.equalSequenceB).toEqual(actual.sequence);

  let node: any = actual.diamond;
  for (let level = depth - 1; level >= 0; level--) {
    if (level % 2 === 0) {
      expect(Array.isArray(node)).toBe(false);
      expect(node.left).toBe(node.right);
      node = node.left;
    } else {
      expect(Array.isArray(node)).toBe(true);
      expect(Object.getPrototypeOf(node)).toBe(Array.prototype);
      expect(node[0]).toBe(node[1]);
      node = node[0];
    }
  }
  expect(node).toBe(actual.leaf);
}

function acyclicRefs(value: unknown, depth: number, kind: RootKind): object[] {
  const slots = acyclicSlots(value, kind);
  const refs = [value as object, slots.diamond as object];
  let node: any = slots.diamond;
  for (let level = depth - 1; level >= 0; level--) {
    refs.push(node);
    node = level % 2 === 0 ? node.left : node[0];
  }
  refs.push(
    slots.leaf,
    slots.leaf.numbers,
    slots.sequence,
    slots.equalLeafA,
    slots.equalLeafA.numbers,
    slots.equalLeafB,
    slots.equalLeafB.numbers,
    slots.equalSequenceA,
    slots.equalSequenceB,
  );
  return refs;
}

function assertSameReferences(before: object[], after: object[]) {
  expect(after).toHaveLength(before.length);
  after.forEach((node, index) => expect(node).toBe(before[index]));
}

type CycleKind = "self-map" | "self-sequence" | "mutual";
function makeCyclic(payload: Payload, kind: CycleKind) {
  let cycle: any;
  if (kind === "self-map") {
    cycle = { ...makeLeaf(payload), self: null };
    cycle.self = cycle;
  } else if (kind === "self-sequence") {
    cycle = [payload.number, payload.flag, payload.text, null, [...payload.numbers]];
    cycle.push(cycle);
  } else {
    const map: any = { ...makeLeaf(payload), next: null };
    const sequence: unknown[] = [map];
    map.next = sequence;
    cycle = map;
  }
  const root = {
    cycle,
    equalLeafA: makeLeaf(payload),
    equalLeafB: makeLeaf(payload),
    equalSequenceA: [payload.number, payload.text, payload.flag, null],
    equalSequenceB: [payload.number, payload.text, payload.flag, null],
  };
  return { root, kind };
}

function assertCyclic(
  actualValue: unknown,
  expectedValue: unknown,
  payload: Payload,
  kind: CycleKind,
  label: string,
) {
  assertGraphEqual(expectedValue, actualValue, label);
  const actual = actualValue as ReturnType<typeof makeCyclic>["root"];
  expect(Object.getPrototypeOf(actual)).toBe(Object.prototype);
  expect(actual.equalLeafA).not.toBe(actual.equalLeafB);
  expect(actual.equalLeafA).toEqual(actual.equalLeafB);
  expect(actual.equalSequenceA).not.toBe(actual.equalSequenceB);
  expect(actual.equalSequenceA).toEqual(actual.equalSequenceB);
  if (kind === "self-map") {
    expect(Object.getPrototypeOf(actual.cycle)).toBe(Object.prototype);
    expect(actual.cycle.number).toBe(payload.number);
    expect(typeof actual.cycle.number).toBe("number");
    expect(actual.cycle.flag).toBe(payload.flag);
    expect(typeof actual.cycle.flag).toBe("boolean");
    expect(actual.cycle.text).toBe(payload.text);
    expect(typeof actual.cycle.text).toBe("string");
    expect(actual.cycle.nil).toBeNull();
    expect(actual.cycle.self).toBe(actual.cycle);
  } else if (kind === "self-sequence") {
    expect(Array.isArray(actual.cycle)).toBe(true);
    expect(Object.getPrototypeOf(actual.cycle)).toBe(Array.prototype);
    expect(actual.cycle[0]).toBe(payload.number);
    expect(typeof actual.cycle[0]).toBe("number");
    expect(actual.cycle[1]).toBe(payload.flag);
    expect(typeof actual.cycle[1]).toBe("boolean");
    expect(actual.cycle[2]).toBe(payload.text);
    expect(typeof actual.cycle[2]).toBe("string");
    expect(actual.cycle[3]).toBeNull();
    expect(actual.cycle[4]).toEqual(payload.numbers);
    expect(Array.isArray(actual.cycle[4])).toBe(true);
    expect(actual.cycle[5]).toBe(actual.cycle);
  } else {
    expect(Object.getPrototypeOf(actual.cycle)).toBe(Object.prototype);
    expect(actual.cycle.number).toBe(payload.number);
    expect(typeof actual.cycle.number).toBe("number");
    expect(actual.cycle.flag).toBe(payload.flag);
    expect(typeof actual.cycle.flag).toBe("boolean");
    expect(actual.cycle.text).toBe(payload.text);
    expect(typeof actual.cycle.text).toBe("string");
    expect(actual.cycle.nil).toBeNull();
    expect(Array.isArray(actual.cycle.next)).toBe(true);
    expect(Object.getPrototypeOf(actual.cycle.next)).toBe(Array.prototype);
    expect(actual.cycle.next[0]).toBe(actual.cycle);
  }
}

function cyclicRefs(value: unknown): object[] {
  const root = value as ReturnType<typeof makeCyclic>["root"];
  const refs = [
    root,
    root.cycle,
    root.equalLeafA,
    root.equalLeafA.numbers,
    root.equalLeafB,
    root.equalLeafB.numbers,
    root.equalSequenceA,
    root.equalSequenceB,
  ];
  if (Array.isArray(root.cycle)) refs.push(root.cycle[4] as object);
  else {
    refs.push(root.cycle.numbers);
    if (root.cycle.next) refs.push(root.cycle.next);
  }
  return refs;
}

const codecs = [
  {
    name: "js-yaml",
    write: (value: unknown) => jsYamlReference.dump(value),
    readers: [
      { name: "js-yaml.load", read: (text: string) => jsYamlReference.load(text) },
      { name: "compat.load", read: (text: string) => load(text) },
    ],
  },
  {
    name: "compat.dump",
    write: (value: unknown) => dump(value),
    readers: [
      { name: "js-yaml.load", read: (text: string) => jsYamlReference.load(text) },
      { name: "compat.load", read: (text: string) => load(text) },
    ],
  },
  {
    name: "yaml",
    write: (value: unknown) => yamlReference.stringify(value),
    readers: [
      { name: "yaml.parse", read: (text: string) => yamlReference.parse(text) },
      { name: "compat.parse", read: (text: string) => parse(text) },
    ],
  },
  {
    name: "compat.stringify",
    write: (value: unknown) => stringify(value),
    readers: [
      { name: "yaml.parse", read: (text: string) => yamlReference.parse(text) },
      { name: "compat.parse", read: (text: string) => parse(text) },
    ],
  },
];

describe("generated stringify alias graphs", () => {
  test.prop([payloadArb, depthArb], { numRuns: 100, seed: 70117 })(
    "writers preserve acyclic sharing for both root shapes",
    (payload, depth) => {
      for (const kind of ["map", "sequence"] as const) {
        for (const codec of codecs) {
          const input = makeAcyclic(payload, depth, kind);
          const model = makeAcyclic(payload, depth, kind);
          const before = acyclicRefs(input.root, depth, kind);
          const text = codec.write(input.root);
          assertAcyclic(input.root, model.root, payload, depth, kind, `${codec.name} ${kind} input after write`);
          assertSameReferences(before, acyclicRefs(input.root, depth, kind));
          for (const reader of codec.readers) {
            assertAcyclic(reader.read(text), model.root, payload, depth, kind, `${codec.name} -> ${reader.name} ${kind}`);
          }
        }
      }
    },
  );

  test.prop([payloadArb], { numRuns: 100, seed: 70118 })(
    "writers preserve self and mutual cycles",
    (payload) => {
      for (const kind of ["self-map", "self-sequence", "mutual"] as const) {
        for (const codec of codecs) {
          const input = makeCyclic(payload, kind);
          const model = makeCyclic(payload, kind);
          const before = cyclicRefs(input.root);
          const text = codec.write(input.root);
          assertCyclic(input.root, model.root, payload, kind, `${codec.name} ${kind} input after write`);
          assertSameReferences(before, cyclicRefs(input.root));
          for (const reader of codec.readers) {
            assertCyclic(reader.read(text), model.root, payload, kind, `${codec.name} -> ${reader.name} ${kind}`);
          }
        }
      }
    },
  );

  test("assertions reject lost aliases, merged copies, and input mutation", () => {
    const payload = { number: 7, flag: true, text: "value_control", numbers: [1, -2] };
    const model = makeAcyclic(payload, 2, "map");
    const valid = makeAcyclic(payload, 2, "map");
    const text = yamlReference.stringify(valid.root);
    const read = () => parse(text) as MapRoot;
    assertAcyclic(read(), model.root, payload, 2, "map", "control valid graph");

    const lostAlias = read();
    lostAlias.leafAgain = makeLeaf(payload);
    expect(() => assertAcyclic(lostAlias, model.root, payload, 2, "map", "control lost alias")).toThrow();

    const mergedCopies = read();
    mergedCopies.equalLeafB = mergedCopies.equalLeafA;
    expect(() => assertAcyclic(mergedCopies, model.root, payload, 2, "map", "control merged copies")).toThrow();

    const mutatedInput = makeAcyclic(payload, 2, "map");
    const originalRefs = acyclicRefs(mutatedInput.root, 2, "map");
    (mutatedInput.root as MapRoot).equalLeafA.numbers = [
      ...(mutatedInput.root as MapRoot).equalLeafA.numbers,
    ];
    assertAcyclic(mutatedInput.root, model.root, payload, 2, "map", "control topology-preserving container replacement");
    expect(() => assertSameReferences(originalRefs, acyclicRefs(mutatedInput.root, 2, "map"))).toThrow();
  });
});
