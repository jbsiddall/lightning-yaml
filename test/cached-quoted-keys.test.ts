import { describe, expect, it } from "vitest";
import { parse, parseAll, YAMLParseError } from "../src/index.ts";
import { parse as parseCore } from "../src/core.ts";

const backslashAndBackspace = String.raw`[{"a\\b": 1}, {"a\b": 2}]`;

describe("cached double-quoted flow keys", () => {
  it("decodes an escape after a matching literal-backslash key", () => {
    expect(parse(backslashAndBackspace)).toEqual([{ "a\\b": 1 }, { "a\b": 2 }]);
    expect(parseCore(backslashAndBackspace)).toEqual([{ "a\\b": 1 }, { "a\b": 2 }]);
    expect(parseAll(backslashAndBackspace)).toEqual([[{ "a\\b": 1 }, { "a\b": 2 }]]);
  });

  it("decodes newline and Unicode escapes after similar literal keys", () => {
    expect(parse(String.raw`[{"a\\n": 1}, {"a\n": 2}]`)).toEqual([
      { "a\\n": 1 }, { "a\n": 2 },
    ]);
    expect(parse(String.raw`[{"a\\u0062": 1}, {"a\u0062": 2}]`)).toEqual([
      { "a\\u0062": 1 }, { ab: 2 },
    ]);
  });

  it.each([false, true])("rejects an invalid escape after a matching cached key (strict=%s)", (strict) => {
    const options = strict ? { strict: true } : undefined;
    expect(() => parse(String.raw`[{"a\\q": 1}, {"a\q": 2}]`, options)).toThrow(YAMLParseError);
  });

  it.each([false, true])("rejects an embedded quote after a matching cached key (strict=%s)", (strict) => {
    const options = strict ? { strict: true } : undefined;
    expect(() => parse(String.raw`[{'a"b': 1}, {"a"b": 2}]`, options)).toThrow(YAMLParseError);
  });

  it.each(["\n", "\r\n"])("uses the same result for cached and standalone implicit keys (%j)", (breakText) => {
    const quotedBreak = '"a' + breakText + 'b"';
    const cached = "[{" + JSON.stringify("a" + breakText + "b") + ": 1}, {" + quotedBreak + ": 2}]";
    const standalone = "{" + quotedBreak + ": 2}";
    const outcome = (source: string, secondRecord = false) => {
      try {
        const value = parse(source);
        return { value: secondRecord ? (value as unknown[])[1] : value };
      } catch (error) {
        if (!(error instanceof YAMLParseError)) throw error;
        return { rejected: true };
      }
    };

    const cachedOutcome = outcome(cached, true);
    const standaloneOutcome = outcome(standalone);
    expect(cachedOutcome).toEqual(standaloneOutcome);
  });

  it("keeps ordinary key forms and block-key feedback stable", () => {
    expect(parse('[{"same": 1}, {"same": 2}, {"": 3}, {"": 4}]')).toEqual([
      { same: 1 }, { same: 2 }, { "": 3 }, { "": 4 },
    ]);
    expect(parse(String.raw`[{'a\b': 1}, {'a\b': 2}, {'a''b': 3}, {'a''b': 4}]`)).toEqual([
      { "a\\b": 1 }, { "a\\b": 2 }, { "a'b": 3 }, { "a'b": 4 },
    ]);
    expect(parse(String.raw`[{"a\\b": 1}, {'a\b': 2}]`)).toEqual([
      { "a\\b": 1 }, { "a\\b": 2 },
    ]);
    expect(parse(String.raw`- stable: 0
  "a\\b": 1
- stable: 0
  "a\b": 2`)).toEqual([
      { stable: 0, "a\\b": 1 }, { stable: 0, "a\b": 2 },
    ]);
  });
});
