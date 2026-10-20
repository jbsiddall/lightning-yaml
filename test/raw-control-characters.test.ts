import { describe, expect, it } from "vitest";
import { parse, parseAll, YAMLParseError } from "../src/index.ts";
import { parse as parseCore, parseAll as parseAllCore } from "../src/core.ts";
import { load, loadAll, YAMLException } from "../src/js-yaml-compat.ts";
import { parse as parseYaml, parseAllDocuments, parseDocument } from "../src/yaml-compat.ts";

const forbidden = [
  ...Array.from({ length: 9 }, (_, code) => code),
  0x0b, 0x0c,
  ...Array.from({ length: 18 }, (_, index) => index + 0x0e),
];
const forbiddenCases = forbidden.map((code) => [`U+${code.toString(16).padStart(4, "0")}`, code] as const);
const raw = (code: number) => String.fromCharCode(code);
const hexEscape = (code: number) => `\\x${code.toString(16).padStart(2, "0")}`;

describe("raw forbidden C0 characters", () => {
  it.each(forbiddenCases)("rejects raw %s through native parse and parseAll", (_label, code) => {
    const source = `"a${raw(code)}b"`;
    for (const options of [undefined, { strict: true }]) {
      expect(() => parse(source, options)).toThrow(YAMLParseError);
      expect(() => parseAll(source, options)).toThrow(YAMLParseError);
    }
  });

  it.each(forbiddenCases)("rejects %s in representative parser contexts", (_label, code) => {
    const control = raw(code);
    const sources = [
      `"a${control}b"`, `'a${control}b'`,
      `a: "a${control}b"`, `"a${control}b": value`,
      `[a${control}b]`, `{a${control}b: value}`,
      `a${control}b: value`, `a: a${control}b`,
      `a: |\n  a${control}b\n`, `a: >\n  a${control}b\n`,
      `# comment${control}\n`, `---\n# comment${control}\n`,
      `a: {b: [c${control}d]}`, `a: value\n---\nb: ${control}`,
      control, `a: value${control}`,
    ];
    for (const source of sources) expect(() => parse(source)).toThrow(YAMLParseError);
    expect(() => parseAll(`---\na: value\n---\nb: ${control}`)).toThrow(YAMLParseError);
  });

  it.each(forbiddenCases)("rejects %s when it matches a cached escaped flow key", (_label, code) => {
    const character = raw(code);
    const source = `[{${JSON.stringify(`a${character}`)}: 1}, {"a${character}": 2}]`;
    expect(() => parse(source)).toThrow(YAMLParseError);
    expect(() => parse(`{"a${character}": 2}`)).toThrow(YAMLParseError);
  });

  it("rejects in direct core routes and cannot be bypassed by parser options", () => {
    for (const source of [`"a${raw(0)}b"`, `"a${raw(8)}b"`]) {
      expect(() => parseCore(source)).toThrow(YAMLParseError);
      expect(() => parseAllCore(source)).toThrow(YAMLParseError);
      expect(() => parse(source, { optimizations: { internStrings: true, keyCacheMaxKb: 64 } })).toThrow(YAMLParseError);
    }
  });

  it("reports the first raw offset using existing LF and CRLF marks, including a BOM", () => {
    expect(() => parse(`ok: 1\nvalue: ${raw(0)}x`)).toThrow(/line 2, column 8/);
    expect(() => parse(`ok: 1\r\nvalue: ${raw(0)}x`)).toThrow(/line 2, column 8/);
    expect(() => parse(`\uFEFFok: 1\n${raw(8)}x`)).toThrow(/line 2, column 1/);
    expect(() => parse(`\uFEFF"a${raw(8)}b"`)).toThrow(/line 1, column 4/);
  });

  it("wraps errors in js-yaml and records filename and source marks", () => {
    const source = `ok: 1\r\nvalue: ${raw(0)}x`;
    for (const action of [
      () => load(source, { filename: "settings.yml" }),
      () => loadAll(source, { filename: "settings.yml" }),
    ]) {
      try {
        action();
        throw new Error("expected raw control rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(YAMLException);
        expect(String(error)).toContain("line 2, column 8");
        expect((error as YAMLException).mark.name).toBe("settings.yml");
        expect((error as YAMLException).mark.line).toBe(1);
        expect((error as YAMLException).mark.column).toBe(7);
      }
    }
  });

  it("returns document errors from yaml wrappers and skips callbacks on invalid input", () => {
    let iteratorCalls = 0;
    expect(() => loadAll(`a: ${raw(0)}`, () => { iteratorCalls++; })).toThrow(YAMLException);
    expect(iteratorCalls).toBe(0);

    let reviverCalls = 0;
    expect(() => parseYaml(`a: ${raw(8)}`, () => { reviverCalls++; })).toThrow(YAMLParseError);
    expect(reviverCalls).toBe(0);
    expect(parseDocument(`a: ${raw(0)}`).errors).toHaveLength(1);
    expect(parseAllDocuments(`a: ${raw(0)}`).flatMap((document) => document.errors)).toHaveLength(1);
  });

  it("recovers after an exception and permits supported callback reentrancy", () => {
    expect(() => parse(`a: ${raw(0)}`)).toThrow(YAMLParseError);
    expect(parse("a: 1")).toEqual({ a: 1 });
    expect(() => parse(`a: ${raw(0)}`, { strict: true })).toThrow(YAMLParseError);
    expect(parse("a: 1")).toEqual({ a: 1 });

    const iteratorValues: unknown[] = [];
    loadAll("---\na: 1\n---\na: 2", (_value) => iteratorValues.push(parse("nested: true")));
    expect(iteratorValues).toEqual([{ nested: true }, { nested: true }]);
    expect(parseYaml("a: 1", (_key, value) => {
      if (_key === "a") expect(parse("nested: true")).toEqual({ nested: true });
      return value;
    })).toEqual({ a: 1 });
  });
});

describe("allowed controls and separators", () => {
  it("accepts escaped C0 values and keys, including cached canonical forms", () => {
    const shortEscapes = ["\\0", "\\a", "\\b", "\\v", "\\f", "\\e"];
    const values = [0, 7, 8, 11, 12, 27];
    shortEscapes.forEach((escape, index) => {
      expect(parse(`"a${escape}b"`)).toBe(`a${raw(values[index])}b`);
    });
    for (const code of forbidden) {
      expect(parse(`"a${hexEscape(code)}b"`)).toBe(`a${raw(code)}b`);
    }
    expect(parse(`[{${JSON.stringify(`a${raw(0)}`)}: 1}, {"a\\x00": 2}]`)).toEqual([
      { [`a${raw(0)}`]: 1 }, { [`a${raw(0)}`]: 2 },
    ]);
  });

  it("allows TAB, quoted DEL/C1, legal line breaks, and empty/comment-only streams", () => {
    expect(parse(`"a\tb"`)).toBe("a\tb");
    expect(parse(`'a\tb'`)).toBe("a\tb");
    expect(() => parse("a:\n\tb: 1", { strict: true })).toThrow(YAMLParseError);
    for (const code of [0x7f, ...Array.from({ length: 32 }, (_, index) => index + 0x80)]) {
      const character = raw(code);
      expect(parse(`"${character}"`)).toBe(character);
      expect(parse(`'${character}'`)).toBe(character);
      expect(parse(`[{${JSON.stringify(character)}: 1}, {${JSON.stringify(character)}: 2}]`)).toEqual([
        { [character]: 1 }, { [character]: 2 },
      ]);
    }
    expect(parseAll("---\na: 1\r\n---\rb: 2")).toEqual([{ a: 1 }, { b: 2 }]);
    expect(parseAll("")).toEqual([]);
    expect(parseAll("# comment only\n")).toEqual([]);
    expect(parse("# comment only\n")).toBeNull();
  });
});
