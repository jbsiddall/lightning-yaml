import { fuzz } from "@traversable/zod-test/fuzz";
import type fc from "fast-check";
import { z } from "zod";

export function schemaArbitrary<S extends z.ZodType>(
  schema: S,
  options?: fuzz.Options,
): fc.Arbitrary<z.input<S>> {
  return fuzz(schema, options).map((value) => {
    const result = schema.safeParse(value);
    if (!result.success)
      throw new Error("Schema generator produced invalid input", {
        cause: result.error,
      });
    return value as z.input<S>;
  });
}
