import fc from "fast-check";
import * as yamlReference from "yaml";
import { describe, expect, it } from "vitest";
import * as yamlCompat from "../../../src/yaml-compat.ts";

const LineCounter = yamlCompat.LineCounter;

type Position = { line: number; col: number };

function expectedPosition(starts: number[], offset: number): Position {
  let firstAtOrAfter = 0;
  while (firstAtOrAfter < starts.length && starts[firstAtOrAfter]! < offset) firstAtOrAfter++;
  if (firstAtOrAfter < starts.length && starts[firstAtOrAfter] === offset) {
    return { line: firstAtOrAfter + 1, col: 1 };
  }
  if (firstAtOrAfter === 0) return { line: 0, col: offset };
  return { line: firstAtOrAfter, col: offset - starts[firstAtOrAfter - 1]! + 1 };
}

describe("yaml compatibility LineCounter export", () => {
  it("exports the named constructor and includes the same constructor in its default namespace", () => {
    expect(typeof LineCounter).toBe("function");
    expect(yamlCompat.default.LineCounter).toBe(LineCounter);
  });

  it("looks up empty, pre-first, exact, interior and after-last offsets", () => {
    const empty = new LineCounter();
    expect(empty.lineStarts).toEqual([]);
    expect([empty.linePos(-2), empty.linePos(0), empty.linePos(2)]).toEqual([
      { line: 0, col: -2 }, { line: 0, col: 0 }, { line: 0, col: 2 },
    ]);

    const counter = new LineCounter();
    counter.lineStarts = [0, 3, 8];
    expect([0, 2, 3, 6, 8, 11].map(counter.linePos)).toEqual([
      { line: 1, col: 1 }, { line: 1, col: 3 }, { line: 2, col: 1 },
      { line: 2, col: 4 }, { line: 3, col: 1 }, { line: 3, col: 4 },
    ]);
  });

  it("returns pre-first positions for negative and nonzero-first starts", () => {
    const counter = new LineCounter();
    counter.lineStarts = [5];
    expect(counter.linePos(0)).toEqual({ line: 0, col: 0 });
    expect(counter.linePos(4)).toEqual({ line: 0, col: 4 });
    expect(counter.linePos(-3)).toEqual({ line: 0, col: -3 });
    expect(counter.linePos(5)).toEqual({ line: 1, col: 1 });
  });

  it("uses the first matching duplicate and appends starts without sorting", () => {
    const duplicateStarts = new LineCounter();
    duplicateStarts.lineStarts = [0, 3, 3, 8];
    expect(duplicateStarts.linePos(3)).toEqual({ line: 2, col: 1 });

    const appended = new LineCounter();
    expect(appended.addNewLine(5)).toBe(1);
    expect(appended.addNewLine(2)).toBe(2);
    expect(appended.lineStarts).toEqual([5, 2]);
  });

  it("uses a writable replacement array and keeps instances independent", () => {
    const first = new LineCounter();
    const second = new LineCounter();
    first.addNewLine(4);
    first.lineStarts = [10, 20];
    expect(first.linePos(12)).toEqual({ line: 1, col: 3 });
    expect(second.lineStarts).toEqual([]);
    expect(second.linePos(12)).toEqual({ line: 0, col: 12 });
  });

  it("keeps extracted callbacks bound to their instance", () => {
    const counter = new LineCounter();
    const addNewLine = counter.addNewLine;
    const linePos = counter.linePos;
    expect(addNewLine(0)).toBe(1);
    expect(addNewLine(4)).toBe(2);
    expect(linePos(5)).toEqual({ line: 2, col: 2 });
    expect(counter.lineStarts).toEqual([0, 4]);
  });

  it("indexes supplied UTF-16 offsets across emoji and CRLF", () => {
    const source = "a\r\nb😀\r\nc";
    const secondLineStart = source.indexOf("b");
    const thirdLineStart = source.indexOf("c");
    expect([secondLineStart, thirdLineStart]).toEqual([3, 8]);
    const counter = new LineCounter();
    expect(counter.addNewLine(0)).toBe(1);
    expect(counter.addNewLine(secondLineStart)).toBe(2);
    expect(counter.addNewLine(thirdLineStart)).toBe(3);
    expect(counter.linePos(source.indexOf("😀") + 1)).toEqual({ line: 2, col: 3 });
    expect(counter.linePos(thirdLineStart)).toEqual({ line: 3, col: 1 });
  });

  it("matches an independent lookup and yaml@2.9.0 on bounded sorted starts", () => {
    const startsArb = fc.array(fc.integer({ min: 0, max: 100 }), { maxLength: 20 }).map((xs) => xs.sort((a, b) => a - b));
    fc.assert(fc.property(startsArb, fc.integer({ min: -100, max: 200 }), (starts, offset) => {
      const counter = new LineCounter();
      const reference = new yamlReference.LineCounter();
      counter.lineStarts = starts;
      reference.lineStarts = starts;
      expect(counter.linePos(offset)).toEqual(expectedPosition(starts, offset));
      expect(counter.linePos(offset)).toEqual(reference.linePos(offset));
    }), { numRuns: 300, seed: 20261020 });
  });

  it("continues to reject LineCounter as a parse option", () => {
    expect(() => yamlCompat.parse("a: 1", { lineCounter: new LineCounter() })).toThrow(/lineCounter/);
  });
});
