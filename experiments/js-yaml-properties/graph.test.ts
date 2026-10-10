import { describe, expect, it } from "vitest";
import { compareGraph, decodeGraph, encodeGraph } from "./graph.js";

describe("property graph model", () => {
  it("preserves cycles and aliases", () => {
    const child = { value: 1 };
    const input: { a: object; b: object; self?: unknown } = {
      a: child,
      b: child,
    };
    input.self = input;
    const output = decodeGraph(encodeGraph(input)) as typeof input;
    expect(output.self).toBe(output);
    expect(output.a).toBe(output.b);
    expect(compareGraph(input, output).equal).toBe(true);
  });

  it("distinguishes shared objects from duplicates in either direction", () => {
    const shared = {};
    expect(compareGraph({ a: shared, b: shared }, { a: {}, b: {} }).equal).toBe(
      false,
    );
    expect(compareGraph({ a: {}, b: {} }, { a: shared, b: shared }).equal).toBe(
      false,
    );
    expect(
      compareGraph({ a: shared, b: {} }, { a: shared, b: shared }).equal,
    ).toBe(false);
  });

  it("compares special numbers and preserves missing array elements", () => {
    expect(compareGraph(NaN, NaN).equal).toBe(true);
    expect(compareGraph(-0, 0).equal).toBe(false);
    expect(compareGraph([,], [undefined]).equal).toBe(false);
    expect(compareGraph([,], decodeGraph(encodeGraph([,]))).equal).toBe(true);
    const boundary: unknown[] = [];
    Object.defineProperty(boundary, "4294967295", {
      value: "ordinary property",
      enumerable: true,
    });
    expect(
      compareGraph(boundary, decodeGraph(encodeGraph(boundary))).equal,
    ).toBe(true);
  });

  it("round trips built in brands, bytes, dates, and ordered collections", () => {
    const input = {
      date: new Date(NaN),
      bytes: new Uint16Array([1, 256]),
      view: new DataView(new Uint8Array([4, 5]).buffer),
      buffer: new Uint8Array([7, 8]).buffer,
      regexp: Object.assign(/ab/gi, { lastIndex: 3 }),
      map: new Map([
        ["first", 1],
        ["second", 2],
      ]),
      set: new Set([3, 2]),
    };
    const output = decodeGraph(encodeGraph(input));
    expect(compareGraph(input, output).equal).toBe(true);
    const lastIndex = { marker: true };
    const specialRegex = /x/;
    Reflect.set(specialRegex, "lastIndex", lastIndex);
    const specialCopy = decodeGraph(
      encodeGraph({ specialRegex, lastIndex }),
    ) as { specialRegex: RegExp; lastIndex: object };
    expect(specialCopy.specialRegex.lastIndex).toBe(specialCopy.lastIndex);
    specialRegex.lastIndex = NaN;
    expect(
      compareGraph(specialRegex, decodeGraph(encodeGraph(specialRegex))).equal,
    ).toBe(true);
  });

  it("compares and preserves enumerable properties on built ins", () => {
    const values: object[] = [
      new Date(10),
      /x/g,
      new Map(),
      new Set(),
      new DataView(new ArrayBuffer(2)),
      new ArrayBuffer(2),
      new Uint8Array(2),
    ];
    for (const value of values) Object.assign(value, { tag: { nested: true } });
    for (const value of values) {
      const result = decodeGraph(encodeGraph(value));
      expect(compareGraph(value, result)).toEqual({ equal: true });
    }
    expect(
      compareGraph(Object.assign(new Map(), { tag: 1 }), new Map()).equal,
    ).toBe(false);
  });

  it("preserves backing buffer identity, bytes, offsets, and view lengths", () => {
    const buffer = new ArrayBuffer(6);
    new Uint8Array(buffer).set([1, 2, 3, 4, 5, 6]);
    const graph = {
      a: new Uint8Array(buffer, 1, 2),
      b: new DataView(buffer, 3, 2),
      buffer,
    };
    const copy = decodeGraph(encodeGraph(graph)) as typeof graph;
    expect(copy.a.buffer).toBe(copy.buffer);
    expect(copy.b.buffer).toBe(copy.buffer);
    expect(copy.a.byteOffset).toBe(1);
    expect(copy.a.length).toBe(2);
    expect([...new Uint8Array(copy.buffer)]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(compareGraph(graph, copy).equal).toBe(true);
  });

  it("rejects typed array subclasses during encoding", () => {
    class CustomArray extends Uint8Array {}
    expect(() => encodeGraph(new CustomArray([2]))).toThrow(
      /typed array brand/,
    );
  });

  it("creates dangerous keys as own data properties without prototype mutation", () => {
    const source = Object.create(null) as Record<string, unknown>;
    for (const key of ["__proto__", "constructor", "prototype"])
      Object.defineProperty(source, key, { value: key, enumerable: true });
    const result = decodeGraph(encodeGraph(source)) as Record<string, unknown>;
    expect(Object.getPrototypeOf(result)).toBe(null);
    for (const key of ["__proto__", "constructor", "prototype"])
      expect(Object.hasOwn(result, key)).toBe(true);
  });

  it("rejects values that cannot be reconstructed", () => {
    expect(() => encodeGraph(() => 1)).toThrow(TypeError);
    expect(() => encodeGraph(Symbol("x"))).toThrow(TypeError);
    const accessor = Object.defineProperty({}, "x", {
      get() {
        throw new Error("ran getter");
      },
      enumerable: true,
    });
    expect(() => encodeGraph(accessor)).toThrow(/accessor property/);
    expect(() =>
      decodeGraph('{"version":1,"root":{"p":"number","v":"bogus"},"nodes":[]}'),
    ).toThrow(/Invalid graph encoding/);
    expect(() =>
      decodeGraph('{"version":1,"root":{"r":4},"nodes":[]}'),
    ).toThrow(/Invalid graph encoding/);
    expect(() =>
      decodeGraph(
        '{"version":1,"root":{"r":0},"nodes":[{"kind":"array","data":"2"}]}',
      ),
    ).toThrow(/Invalid graph encoding/);
    expect(() =>
      decodeGraph(
        '{"version":1,"root":{"r":0},"nodes":[{"kind":"array","data":0,"props":[["3",1]]}]}',
      ),
    ).toThrow(/Invalid graph encoding/);
    expect(() =>
      decodeGraph(
        '{"version":1,"root":{"r":0},"nodes":[{"kind":"date","data":8640000000000001}]}',
      ),
    ).toThrow(/Invalid graph encoding/);
    expect(() =>
      decodeGraph(
        '{"version":1,"root":{"r":0},"nodes":[{"kind":"date","data":1.5}]}',
      ),
    ).toThrow(/Invalid graph encoding/);
  });
});
