import { expect, test } from "vitest";
import { parseArguments } from "./cli.js";

test.each([
  ["--sampls", "20"],
  ["--samples"],
  ["--samples", "--strict"],
  ["--samples", "1.5"],
  ["--samples", "-1"],
  ["--samples", "200001"],
  ["--seed", "2147483648"],
  ["--seed", "not-a-number"],
  ["--strict", "--strict"],
  ["--replay", "file.json", "--extended"],
])("rejects incomplete or ambiguous campaign arguments %j", (...args) => {
  expect(() => parseArguments(args)).toThrow();
});

test("forwards a pnpm separator and zero generated trials explicitly", () => {
  expect(
    parseArguments([
      "--",
      "--samples",
      "0",
      "--seed",
      "-1",
      "--extended",
      "--output",
      "report",
    ]),
  ).toEqual({
    samples: 0,
    seed: -1,
    extended: true,
    strict: false,
    output: "report",
  });
});
