/**
 * @packageDocumentation
 *
 * lightning-yaml — the native public API. A YAML 1.2.2 parser and serializer
 * whose surface mirrors the built-in `JSON`:
 *
 *   - `parse(text)`      — YAML text → JS value (a single document; throws if a
 *                          second document follows, like `JSON.parse`)
 *   - `stringify(value)` — JS value → YAML text
 *   - `parseAll(text)`   — YAML text → array of document values (a real
 *                          multi-document stream, split on `---`/`...` markers)
 *
 * The parser/serializer engine lives in `./core.ts`; this module is the thin
 * public entry adopters import as `lightning-yaml`, re-exporting that surface
 * unchanged.
 */

export {
  parse,
  stringify,
  parseAll,
  YAMLParseError,
  NotImplementedError,
} from "./core.ts";

export type { ParseOptions, ParseOptimizations } from "./core.ts";
