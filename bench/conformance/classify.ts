/**
 * Best-effort classifier that scans a failing case's raw `in.yaml` text for
 * YAML constructs, to group OUR failures by likely root cause. This is a
 * heuristic over raw text, not a real parse — quoted scalars that happen to
 * contain a lookalike sequence (e.g. a string containing "&") can produce a
 * false-positive match. That's an acceptable trade-off for a triage tool: it
 * exists to point at the highest-impact feature to implement next, not to be
 * a certified oracle.
 *
 * Buckets are checked in a fixed priority order — most-fundamental/"root"
 * construct first — mirroring PROGRESS.md's feature backlog order (block
 * scalars -> anchors/aliases -> tags -> merge keys -> directives/doc
 * markers -> …), so `primary` lines up with "what to implement next for the
 * most impact" even when a case matches multiple buckets at once.
 */

export type Bucket =
  | "block-scalar"
  | "anchor-alias"
  | "tag"
  | "merge-key"
  | "directive"
  | "doc-markers"
  | "complex-key"
  | "flow-only"
  | "plain-scalar-typing"
  | "other";

/** Priority order for picking the single "primary" bucket of a case. */
export const BUCKET_PRIORITY: Bucket[] = [
  "block-scalar",
  "anchor-alias",
  "tag",
  "merge-key",
  "directive",
  "doc-markers",
  "complex-key",
  "flow-only",
  "plain-scalar-typing",
  "other",
];

// A block scalar header: `|` or `>` at the start of a line or right after
// whitespace (so it's in "value position" — after "key: ", "- ", or as the
// sole content of a line), followed only by optional chomping (`+`/`-`)
// and/or an explicit indent digit, then an optional comment, then
// end-of-line. Anchoring the end to `$` is what keeps this from matching a
// mid-line comparison like "a > b" (which has more than a comment after it).
const RE_BLOCK_SCALAR = /(^|[ \t])[|>][+-]?[0-9]?[ \t]*(#[^\n]*)?$/m;

// `&anchor` / `*alias`, as a token start (line start, or after whitespace /
// a flow indicator / a mapping colon) so we don't match "&"/"*" mid-word.
const RE_ANCHOR_ALIAS = /(^|[ \t,[{(:])[&*][^\s,[\]{}]+/m;

// `!!tag`, `!local`, `!<verbatim>`, or a bare non-specific `!`, as a token
// start. Deliberately excludes `<<` merge keys and `%TAG` directives (their
// own buckets below).
const RE_TAG = /(^|[ \t,[{(:])!(?:![^\s,[\]{}]*|<[^>]+>|[^\s,[\]{}!][^\s,[\]{}]*)?(?=[\s,[\]{}]|$)/m;

const RE_MERGE_KEY = /<<[ \t]*:/;

const RE_DIRECTIVE = /^%[A-Za-z]/m;

const RE_DOC_MARKERS = /^(?:---|\.\.\.)(?=[ \t]|$)/m;

const RE_COMPLEX_KEY = /^[ \t]*\?(?=[ \t]|$)/m;

export interface Classification {
  /** The single bucket picked for grouping (highest-priority match). */
  primary: Bucket;
  /** Every bucket whose pattern matched — for the secondary frequency table. */
  matched: Bucket[];
}

export function classifyFailure(yaml: string): Classification {
  const matched: Bucket[] = [];

  if (RE_BLOCK_SCALAR.test(yaml)) matched.push("block-scalar");
  if (RE_ANCHOR_ALIAS.test(yaml)) matched.push("anchor-alias");
  if (RE_TAG.test(yaml)) matched.push("tag");
  if (RE_MERGE_KEY.test(yaml)) matched.push("merge-key");
  if (RE_DIRECTIVE.test(yaml)) matched.push("directive");
  if (RE_DOC_MARKERS.test(yaml)) matched.push("doc-markers");
  if (RE_COMPLEX_KEY.test(yaml)) matched.push("complex-key");

  // Fallback: nothing "exotic" (block scalar / anchor / tag / merge / directive
  // / doc markers / complex key) matched. Split the remainder by whether flow
  // collection syntax (`{`/`[`) appears anywhere — if so the likely root cause
  // is a flow-parsing edge case; otherwise it's a plain/quoted scalar or block
  // structure edge case (whitespace, indentation, core-schema typing, …).
  if (matched.length === 0) {
    if (/[[{]/.test(yaml)) matched.push("flow-only");
    else matched.push("plain-scalar-typing");
  }

  const primary = BUCKET_PRIORITY.find((b) => matched.includes(b)) ?? "other";
  return { primary, matched };
}
