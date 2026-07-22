import { z } from "zod";

/** The complete library-id space across every suite and every historical doc. */
export const LIBRARY_IDS = ["JSON", "js-yaml", "js-yaml-tuned", "yaml", "lightning-yaml"] as const;
const LibraryIdSchema = z.enum(LIBRARY_IDS);

/** Identity + provenance for one library, as it appears in a `libraries[]` catalog. */
export const LibraryMetaSchema = z.object({
  id: LibraryIdSchema,
  label: z.string(),
  baseline: z.boolean().optional(),
  self: z.boolean().optional(),
  version: z.string().optional(),
});

/** Provenance/scalar fields identical across all four suites. */
const ProvenanceBase = z.object({
  scope: z.string(),
  schema_version: z.number().int().positive().optional(),
  // coerce: a bare all-digit git SHA/date otherwise parses as a number in YAML.
  generated: z.coerce.string(),
  generated_at: z.string().optional(),
  source: z.coerce.string(),
});

/** A per-workload row: a name plus a partial library-keyed map of that stat. */
function workloadSchema<T extends z.ZodType>(stat: T) {
  return z.object({
    workload: z.string(),
    values: z.partialRecord(LibraryIdSchema, stat),
  });
}

const SpeedStatSchema = z.object({
  avg: z.number().nonnegative(),
  min: z.number().nonnegative(),
  p75: z.number().nonnegative(),
  p99: z.number().nonnegative(),
  max: z.number().nonnegative(),
});

const MemoryStatSchema = z.object({
  peak_rss: z.number().nonnegative(),
  heap_delta: z.number(), // per-run heap delta; legitimately negative when a run frees more than it keeps.
});

const BundleSizeValueSchema = z
  .object({
    min: z.number().nonnegative().optional(),
    gzip: z.number().nonnegative().optional(),
    brotli: z.number().nonnegative().optional(),
    error: z.string().optional(), // reserved for a bundler failure; never observed in real data yet.
  })
  // A cell must carry at least one size or an error — an empty `{}` measures nothing.
  .refine((v) => v.min != null || v.gzip != null || v.brotli != null || v.error != null, {
    message: "value must carry a size (min/gzip/brotli) or an error",
  });

export const RuntimeEnvSchema = z.object({ clk: z.string(), cpu: z.string(), runtime: z.string() });

export const SpeedDocSchema = ProvenanceBase.extend({
  suite: z.literal("speed"),
  tool: z.string(),
  unit: z.string(),
  lower_is_better: z.boolean(),
  env: RuntimeEnvSchema,
  libraries: z.array(LibraryMetaSchema).min(1),
  operations: z.object({
    parse: z.array(workloadSchema(SpeedStatSchema)),
    stringify: z.array(workloadSchema(SpeedStatSchema)),
  }),
});

export const MemoryDocSchema = ProvenanceBase.extend({
  suite: z.literal("memory"),
  // Optional: the stream (and the committed seed copies) hold documents from
  // before the memory emitter recorded provenance; new emissions always write it.
  env: RuntimeEnvSchema.optional(),
  units: z.object({ peak_rss: z.string(), heap_delta: z.string() }),
  lower_is_better: z.boolean(),
  iterations: z.number().nonnegative(),
  libraries: z.array(LibraryMetaSchema).min(1),
  operations: z.object({
    parse: z.array(workloadSchema(MemoryStatSchema)),
    stringify: z.array(workloadSchema(MemoryStatSchema)),
  }),
});

/**
 * A conformance result IS a LibraryMeta plus its scores — the site's interface
 * declares them as separate shapes, but the real docs inline id/label/self/version
 * onto each row, so making the reuse explicit keeps them from drifting apart.
 * `negative_*` ride only on the self row; `version` only on competitors.
 */
export const ConformanceResultSchema = LibraryMetaSchema.extend({
  passed: z.number().nonnegative(),
  total: z.number().nonnegative(),
  score: z.number().min(0).max(100), // a pass-rate percent
  negative_passed: z.number().nonnegative().optional(),
  negative_total: z.number().nonnegative().optional(),
})
  .refine((r) => r.passed <= r.total, { message: "passed must not exceed total", path: ["passed"] })
  .refine((r) => r.negative_passed == null || r.negative_total == null || r.negative_passed <= r.negative_total, {
    message: "negative_passed must not exceed negative_total",
    path: ["negative_passed"],
  });

export const ConformanceDocSchema = ProvenanceBase.extend({
  suite: z.literal("conformance"),
  suite_total: z.number().nonnegative(),
  unit: z.string(),
  higher_is_better: z.boolean(),
  results: z.array(ConformanceResultSchema).min(1),
});

const BundleSizeResultSchema = z.object({
  bundler: z.string(),
  rust: z.boolean(),
  values: z.partialRecord(LibraryIdSchema, BundleSizeValueSchema),
});

export const BundleSizeDocSchema = ProvenanceBase.extend({
  suite: z.literal("bundle-size"),
  tool: z.string(),
  units: z.object({ min: z.string(), gzip: z.string(), brotli: z.string() }),
  lower_is_better: z.boolean(),
  env: z.object({ bundlers: z.record(z.string(), z.string()) }),
  libraries: z.array(LibraryMetaSchema).min(1),
  results: z.array(BundleSizeResultSchema).min(1),
});

export type SuiteName = "speed" | "memory" | "conformance" | "bundle-size";

/** Schema per suite — key the doc's own `suite` field into this to validate it. */
export const SUITE_SCHEMAS = {
  speed: SpeedDocSchema,
  memory: MemoryDocSchema,
  conformance: ConformanceDocSchema,
  "bundle-size": BundleSizeDocSchema,
} satisfies Record<SuiteName, z.ZodType>;

export type SpeedDoc = z.infer<typeof SpeedDocSchema>;
export type MemoryDoc = z.infer<typeof MemoryDocSchema>;
export type ConformanceDoc = z.infer<typeof ConformanceDocSchema>;
export type BundleSizeDoc = z.infer<typeof BundleSizeDocSchema>;
