/**
 * lightning-yaml — a single-pass, allocation-minimal, pure-JS YAML 1.2.2 parser
 * engineered for V8 (see site/src/content/docs/research/notes/2026-07-12-design-a-pure-js-parser.md).
 *
 * The public surface mirrors `JSON.parse`:
 *   - `parse(text)`     text → JS value (a single document; throws if a second
 *                       document follows, like js-yaml's `load`)
 *   - `parseAll(text)`  text → array of document values — a real multi-document
 *                       stream, split on `---`/`...` markers
 *   - `stringify(value)` value → YAML text (M6): block-style maps/sequences,
 *                       1.2-core-safe scalar quoting, `Uint8Array` → `!!binary`,
 *                       and anchors/aliases for shared references and cycles —
 *                       see the "Stringify (dump)" section near the end of this
 *                       file for the design.
 *
 * Implementation status: the flow layer (JSON subset + YAML flow), block
 * structure (M3+), literal/folded block scalars (`|`/`>`, M4), document
 * markers (`---`/`...`), `%YAML`/`%TAG` directives, multi-document streams,
 * anchors/aliases (`&`/`*`, M5 — including self-referential/cyclic anchors and
 * structural sharing), tags (`!!binary` and friends), and `stringify` (M6) are
 * implemented.
 *
 * Design invariants enforced throughout (V8 rules, see doc 12):
 *   - scan the flat JS string with `charCodeAt` (never `str[i]`) and hop long
 *     runs with `indexOf` (memchr/SIMD class); never decode to bytes;
 *   - materialize each scalar with exactly one `slice` from integer offsets;
 *   - accumulate small integers as Smis (`v*10 + d`), no intermediate string;
 *   - many small monomorphic functions, cold paths (errors, escapes) out of line;
 *   - char classification via a Uint8Array(256) flag table (V8's json scan flags);
 *   - module-level scalar state (non-reentrant, reset on entry) — no god-object
 *     with a polymorphic `result` field;
 *   - security from day one: `__proto__` never pollutes a prototype, and a hard
 *     recursion-depth cap turns deep-nesting attacks into a controlled throw.
 *
 * Scalar typing follows YAML 1.2 **core schema** (the repo oracle, `yaml`): so
 * `null|Null|NULL|~` and empty → null; `true|True|TRUE|false|False|FALSE` → bool
 * (exact case; `yes/no/on/off` stay strings); decimal/`0o`/`0x` ints, floats,
 * and `.inf`/`.nan` are numbers; timestamps are NOT resolved (`2026-08-02` is a
 * string). Quoted scalars are never typed. This deliberately diverges from
 * js-yaml's 1.1-flavoured defaults (binary `0b`, `_` separators, sexagesimals,
 * timestamp→Date); those divergences are covered by differential tests.
 */

// ---------------------------------------------------------------------------
// Character codes (named for the ones that recur; keyword/escape letters are
// inlined as hex at their single use site with a comment).
// ---------------------------------------------------------------------------

const TAB = 9;
const LF = 10;
const CR = 13;
const SPACE = 32;
const EXCLAIM = 33; // ! (tag indicator)
const DQUOTE = 34; // "
const HASH = 35; // #
const PERCENT = 37; // %
const AMP = 38; // & (anchor indicator)
const SQUOTE = 39; // '
const STAR = 42; // * (alias indicator)
const PLUS = 43; // +
const COMMA = 44; // ,
const MINUS = 45; // -
const DOT = 46; // .
const ZERO = 48; // 0
const NINE = 57; // 9
const COLON = 58; // :
const LT = 60; // < (verbatim tag opener)
const GT = 62; // > (folded block scalar indicator / verbatim tag closer)
const QUESTION = 63; // ?
const AT = 64; // @ (reserved indicator — invalid as a plain-scalar first char)
const UPPER_E = 69; // E
const LBRACKET = 91; // [
const BACKSLASH = 92; // \
const RBRACKET = 93; // ]
const UNDERSCORE = 95; // _
const LOWER_E = 101; // e
const BACKTICK = 96; // ` (reserved indicator — invalid as a plain-scalar first char)
const LBRACE = 123; // {
const PIPE = 124; // | (literal block scalar indicator)
const RBRACE = 125; // }
const TILDE = 126; // ~
const BOM = 0xfeff;

/**
 * Backing flag for the `skipStrictValidation` parse optimization — an umbrella
 * opt-out for STRICT-COMPLIANCE validations: spec checks that only REJECT
 * malformed input and never shape how a VALID document is interpreted. Today it
 * gates the space-then-tab block-collection indentation guards (spec 6.1:
 * `rejectBlockCollectionTabIndent` + the per-entry `checkNoTabIndent(col-1)` in
 * the block seq/map loops); future strict-only checks join it under this one flag.
 *
 * CONTRACT — anything gated on this flag may ONLY ever turn a rejection into
 * acceptance. It must NEVER change the value or structure a valid parse yields:
 * flipping the flag leaves every well-formed document byte-identical (only throws
 * are dropped), trading strictness for speed/memory and incidentally tolerating
 * some malformed input. A check that would alter a VALID parse does not belong here.
 *
 * Default `false` (fully strict). `parse`/`parseAll` set it per call from
 * `options.optimizations.skipStrictValidation` and restore it in `finally`.
 */
let SKIP_STRICT_VALIDATION = false;

/**
 * Hard recursion cap. Pure recursive descent would otherwise throw a native
 * `RangeError` on deeply nested input (an attack, not a use case) where
 * `JSON.parse` degrades to an iterative fallback. We turn it into a controlled
 * parse error well before the engine stack limit. js-yaml ships the same guard.
 */
const MAX_DEPTH = 1000;

// ---------------------------------------------------------------------------
// Character-class flag table — the analog of V8's `character_json_scan_flags`
// (json-parser.cc). One 256-entry Uint8Array, branchless bit tests. All YAML
// flow indicators are ASCII, so codes ≥ 256 read out of bounds as `undefined`
// and `(undefined & BIT) === 0` is the correct "not special" answer.
// ---------------------------------------------------------------------------

const F_FLOW_INDICATOR = 1; // , [ ] { }
const F_PLAIN_STOP = 2; // may terminate a flow plain scalar: , [ ] { } : # LF CR

const CH = new Uint8Array(256);
CH[COMMA] |= F_FLOW_INDICATOR | F_PLAIN_STOP;
CH[LBRACKET] |= F_FLOW_INDICATOR | F_PLAIN_STOP;
CH[RBRACKET] |= F_FLOW_INDICATOR | F_PLAIN_STOP;
CH[LBRACE] |= F_FLOW_INDICATOR | F_PLAIN_STOP;
CH[RBRACE] |= F_FLOW_INDICATOR | F_PLAIN_STOP;
CH[COLON] |= F_PLAIN_STOP;
CH[HASH] |= F_PLAIN_STOP;
CH[LF] |= F_PLAIN_STOP;
CH[CR] |= F_PLAIN_STOP;

/** Sentinel returned by the number recognizers for "this span isn't a number". */
const NOT_NUMERIC: unique symbol = Symbol("not-numeric");

/**
 * Sentinel returned by `parseNextDocument` when the stream has no (more)
 * documents at the current position (genuine end of stream, not merely an
 * empty document — those resolve to `null`, a real value).
 */
const NO_DOCUMENT: unique symbol = Symbol("no-document");

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown by parts of the public API that aren't implemented yet. A dedicated
 * class lets the benchmark harness tell "not built yet" apart from a genuine
 * bug and skip the candidate rather than crash.
 */
export class NotImplementedError extends Error {
  constructor(fn: string) {
    super(
      `lightning-yaml ${fn}() is not implemented yet — this is the stub the ` +
        `benchmark + test harness is built against. See src/index.ts.`,
    );
    this.name = "NotImplementedError";
  }
}

/**
 * Thrown by {@link parse} / {@link parseAll} when the input is not well-formed
 * YAML (or violates a parse constraint). The message includes the 1-based line
 * and column of the problem, rendered as `… (line L, column C)`.
 *
 * @example
 * ```ts
 * try {
 *   parse("items: [1, 2");
 * } catch (err) {
 *   if (err instanceof YAMLParseError) console.error(err.message);
 * }
 * ```
 */
export class YAMLParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YAMLParseError";
  }
}

// ---------------------------------------------------------------------------
// Parser state (module-level, monomorphic scalars; reset per parse). The parser
// is non-reentrant by design — the v1 API is fully sync with no user callbacks.
// ---------------------------------------------------------------------------

let src = "";
let pos = 0;
let len = 0;
let depth = 0;

/**
 * Byte offset of the current line's start. A block node's indentation column is
 * simply `pos - lineStart`, which is what makes compact forms (`- key: val`)
 * fall out for free: the inline map after the `- ` is just a node whose column
 * is deeper than the dash's. Reset per parse; maintained by the line helpers.
 */
let lineStart = 0;

/**
 * Set by `scanBlockPlainEnd`: whether the plain scan stopped at a `:` separator
 * (→ the span was a mapping key) rather than at end-of-line. Read immediately
 * after the scan; this is the implicit-key test that avoids js-yaml's
 * speculative double-composition (doc 07 §4).
 */
let plainStoppedAtColon = false;

/**
 * Set by `advanceCountingBreaks`: whether the just-scanned plain-scalar line was
 * terminated by a `#` comment (trailing on the content line, or a comment-only
 * line before the next content). A comment ends a plain scalar — it may not fold
 * across one — so the folding loops stop when this is set, and any content that
 * follows at continuation indent is then rejected by the ordinary indentation
 * checks (yaml-test-suite BF9H / BS4K / 8XDJ / EB22).
 */
let plainStoppedAtComment = false;

/**
 * Set by the quoted-scalar parsers: whether the scalar just parsed physically
 * spanned more than one line (a real folded line break, NOT an escaped `\n`).
 * A block implicit key must be a single line, so the block key branches reject a
 * multi-line quoted scalar used as a key (yaml-test-suite 7LBH / D49Q / JKF3);
 * flow keys, which may span lines, never consult it.
 */
let quotedMultiline = false;

/**
 * Set by `scanFlowPlainEnd` (via `foldFlowPlain`): the folded text of a flow
 * plain scalar that physically spanned more than one source line, or `null`
 * when the scalar fit on one line (the overwhelming, hot case — no allocation).
 * A multi-line flow plain scalar always folds to a plain *string* (an internal
 * break→space or blank→newline can never coincide with a null/bool/number
 * token), so callers return it verbatim instead of re-slicing `[start,end)` or
 * routing it back through implicit typing. Read immediately after each
 * `scanFlowPlainEnd`; reset to `null` at the start of every scan.
 */
let flowFolded: string | null = null;

/**
 * Set by `skipFlowWs`: whether THAT call crossed at least one line break. Read
 * immediately after the single `skipFlowWs` that sits between a flow key and its
 * `:` to enforce the "implicit key must be on one line" rule — a flow-sequence
 * single pair (`[ key\n : v ]`) or flow-mapping implicit entry whose `:` landed
 * on a later line than the key is invalid (yaml-test-suite DK4H/ZXT5), whereas
 * an EXPLICIT `? key` may span lines freely (so its caller skips the check).
 * Per-call semantics: reset to false at every `skipFlowWs` entry.
 */
let flowWsCrossedLine = false;

/**
 * Set (never cleared) by `skipFlowWs`/`foldFlowPlain` whenever a line break is
 * crossed inside a flow collection, and reset ONLY by the block-node dispatch
 * right before it parses a flow collection that might be a block mapping key —
 * so, read straight after, it means "this flow collection physically spanned
 * more than one line" and therefore cannot serve as a single-line block
 * implicit key (yaml-test-suite C2SP), the flow analogue of `quotedMultiline`.
 */
let flowSpanned = false;

/**
 * The column a flow collection's continuation lines must exceed, or `-1` when
 * no floor applies (the document root, where col 0 is legal). Set to the
 * enclosing block node's `parentCol` by the block dispatch right before it
 * parses a `[`/`{` flow collection, and restored afterward; `skipFlowWs` reads
 * it to reject deficient indentation (yaml-test-suite 9C9N/VJP3). Flow never
 * nests a block construct, so a single slot (save/restore around the one entry
 * point) suffices — nested flow collections share the same block floor.
 */
let flowIndentFloor = -1;

/**
 * Memoized position of the next backslash at or after the last query point (or
 * `len` once none remain). Without this, checking each double-quoted string for
 * escapes via `indexOf('\\')` rescans to end-of-document every time on
 * backslash-free input — O(n²) over a document of many strings. We recompute
 * only when the cursor passes the memo, so a backslash-free document pays a
 * single `indexOf` total. Reset per parse.
 */
let nextBackslash = -1;

/**
 * Memoized position of the next line break (`\n`) at or after the last query
 * point (or `len` once none remain) — the newline analogue of `nextBackslash`,
 * for the same reason: a quoted-scalar fast path that checked each string for an
 * interior line break via a fresh `indexOf('\n')` would rescan a minified
 * (newline-free) document to its end on every string — O(n²). We recompute only
 * when the cursor passes the memo, so newline-free input pays a single `indexOf`
 * total, and line-broken input pays one short scan per line. Reset per parse.
 */
let nextNewline = -1;

/**
 * Per-parse key-intern cache. Repeated mapping keys collapse to one
 * `===`-identical string, so V8 amortizes internalization and transition walks
 * stay cheap across homogeneous records (doc 07 §5; the FastKeyMatch analog).
 * Reset each parse so it can't grow unboundedly across calls. Shared across
 * every document in a stream (doc 07 §4: reset per *stream*, not per document
 * — only directives/anchors are per-document state).
 */
let keyCache: Map<string, string> = new Map();

/**
 * Per-parse VALUE-intern cache — the value-side analogue of `keyCache`. `null`
 * means the feature is OFF (the default), so `internValue` is a single null
 * check with no probe and no allocation and the parse path stays byte-for-byte
 * today's. It is allocated only when a caller opts in via
 * `parse(text, { optimizations: { internStrings: true } })` (see `ParseOptions`),
 * and released (nulled) at the end of every `parse`/`parseAll` call so a large
 * cache can't outlive the call. When on, equal string scalar values collapse to
 * one shared instance — a memory win on repetitive record data at a parse-CPU
 * cost, which is exactly why it is opt-in (see
 * `site/src/content/docs/research/notes/2026-07-14-memory-value-interning.md`). Bounded by
 * `MAX_VALUE_CACHE` so an all-unique-values document can't grow it unbounded.
 */
let valueCache: Map<string, string> | null = null;

/**
 * Entry cap for `valueCache`. Past this many distinct interned values we stop
 * inserting and return the fresh (uncached) string — still correct, just not
 * deduplicated (mirrors the dumper's `MAX_DUMP_KEY_CACHE`). Set far above the
 * dumper's key cap because scalar *values* are far more numerous and diverse
 * than the handful of distinct map keys, so real repetitive record data must
 * fit comfortably under it while a pathological all-unique document still can't
 * grow the map without bound.
 */
const MAX_VALUE_CACHE = 1_000_000;

/**
 * FastKeyMatch feedback slot (M7, doc 07 §5 L107–108). Holds the canonical,
 * encounter-ordered key list of the most-recently-completed mapping. When the
 * NEXT mapping opens (the common case: the next homogeneous record in a
 * sequence), its loop byte-compares each upcoming source key against this list
 * and, on a full match, reuses the identical interned string with **no slice,
 * no hash, no `keyCache` probe** — collapsing `internKey`'s per-key
 * slice→hash→discard-on-hit churn to a byte scan + pointer reuse.
 *
 * A pure fast path IN FRONT of `keyCache` (which stays load-bearing — the
 * intern Map still canonicalizes on any miss). The byte-compare is
 * self-validating: it only succeeds when the source bytes exactly spell the
 * canonical key and a proper terminator follows, so a stale/wrong list (a
 * non-sibling map that happened to finish last, or cross-record shape drift)
 * can only waste a compare, never mis-parse. Reset per stream; never leaks into
 * the leaf parsers (`parseDoubleQuoted`/`resolvePlain`/`internKey`) — the
 * machinery lives entirely inside `parseFlowMap`/`parseBlockMap`.
 */
let lastRecordKeys: string[] | null = null;

/**
 * `%TAG <handle> <prefix>` is per-document state (doc 07 §4) — never
 * inherited across documents in a stream. Created lazily (pay-on-first-use,
 * like `anchorMap`) and stored only so a later milestone can resolve
 * `!handle!suffix` tags against it; nothing reads it yet, but storing it must
 * not require tags to be implemented (design recipe). Reset at the start of
 * every document's `parseDirectives` call, not just per-stream. (`%YAML
 * <version>` is validated the same way but not retained — we stay 1.2-core
 * throughout this milestone and nothing yet branches on the declared version.)
 */
let tagHandles: Map<string, string> | null = null;

/**
 * `&name` → node registry (M5). Lazily created — stays `null` until the first
 * `&` is actually seen (pay-on-first-use, doc 07 §5: "js-yaml allocates
 * per-doc anchor/tag maps always" is exactly the allocation this avoids on
 * anchor-free input, the overwhelming case). An anchor is per-DOCUMENT state,
 * not per-stream (yaml-test-suite-style behaviour, verified against the
 * oracle: an alias cannot resolve an anchor defined in an earlier `---`
 * document) — reset in `parseDirectives`, which already runs once at the
 * start of every document for the identical reason `tagHandles` resets there.
 * Redefining a name (a later `&a` shadowing an earlier one) is legal — a plain
 * `Map.set` overwrite, no special-casing needed; only subsequent aliases see
 * the new value, matching the oracle.
 */
let anchorMap: Map<string, unknown> | null = null;

/**
 * The name of an in-flight `&anchor` property, waiting for the node it
 * decorates to be identified — set by `parseAnchoredBlockNode`/
 * `parseAnchoredFlowValue` right after the name is scanned, and consumed by
 * whichever "leaf" materializes next: a container (`parseFlowSeq`/
 * `parseFlowMap`/`parseBlockSeq`/`parseBlockMap`) registers it to itself
 * IMMEDIATELY on allocation, before parsing any children — this is what makes
 * a self-referential anchor (`&a [*a]`, `&a {self: *a}`) resolve to the SAME
 * (still-being-built) object rather than failing as "undefined alias" (doc 07
 * §5). A scalar/quoted/block-scalar leaf has no children to protect, so it is
 * registered via `registerPendingAnchor` at the point its value is known,
 * which is equally correct and simpler. `registerPendingAnchor` is a no-op
 * (single `!== null` compare) whenever nothing is pending — predicted-false on
 * every anchor-free node, so this costs nothing on JSON-shaped input.
 *
 * A single global slot is NOT enough on its own: in block context an anchor
 * can be waiting for a MAPPING that is only discovered after its first KEY —
 * which may ITSELF carry a nested, unrelated anchor (`top: &node1\n  &k1
 * key1: v` — `k1` decorates the key scalar "key1", `node1` decorates the
 * enclosing map, discovered only once `key1` is already fully resolved).
 * `parseAnchoredBlockNode`/`parseAnchoredFlowValue` therefore save the
 * PREVIOUS value of this slot before overwriting it and restore it afterward
 * (a stack, implemented via the JS call stack rather than an explicit array)
 * so an inner anchor's consume-and-clear can never clobber an outer one that
 * is still waiting.
 */
let pendingAnchorName: string | null = null;

/**
 * Set by `parseAnchoredBlockNode` immediately before recursing into the node
 * that follows a property on the SAME source line (never for a DEFERRED
 * property, alone on its own line — see below); consumed (then cleared) by
 * the very next `parseBlockNode` call only, so it never leaks into deeper
 * recursion. Two, empirically-calibrated (against the oracle) uses:
 *
 *  1. A block SEQUENCE may not start inline right after a property (`&a - x`
 *     errors, oracle: "Missing newline after block sequence props"), but a
 *     block MAPPING may (`&a key: v` is fine) — a narrower, ORTHOGONAL
 *     restriction from `ROOT_AFTER_INLINE_MARKER` (which forbids both forms
 *     after a `---` marker), so it travels as its own flag rather than a
 *     `parentCol` sentinel: `parentCol` must stay the REAL enclosing column
 *     here, because (unlike the marker, which only ever sits at the fixed
 *     document root) an anchor can occur at ANY nesting depth, and
 *     multi-line plain-scalar folding / block indentation comparisons
 *     downstream read `parentCol` as a real number — substituting a
 *     sentinel there would corrupt them.
 *  2. Whether a plain/quoted scalar that turns out to be a block mapping's
 *     FIRST KEY may claim a still-pending anchor for ITSELF, or must leave it
 *     for the MAP being opened (claimed by `parseBlockMap`'s own
 *     self-registration instead). Proven by two oracle probes that produce
 *     DIFFERENT owners for the seemingly-identical text "&x k: v": SAME-LINE
 *     (`&a a: b`, yaml-test-suite ZH7C) → the anchor decorates the KEY scalar
 *     "a"; DEFERRED (`cfg: &a2\n  region: v`) → the anchor decorates the
 *     MAP `{region: v, ...}` as a whole (confirmed by aliasing each case and
 *     observing which value comes back — a `toEqual` diff alone can't tell
 *     the two apart). So the key-branches only call `registerPendingAnchor`
 *     on the candidate key when this flag is set.
 */
let afterInlineProperty = false;

/**
 * Whether the node about to be dispatched is a MAPPING value written inline on
 * the same line as its `key:` — where a block collection may NOT start (`a: b:
 * c` and `key: - a` are both errors: "nested mappings are not allowed in compact
 * mappings" / "sequence on same line as mapping key"). A scalar or flow
 * collection is fine; only a block map (`x: y`) or block sequence (`- x`)
 * starting right there is rejected. Set by `parseBlockValue` for a map value's
 * inline node, consumed (cleared) by the very next `parseBlockNode` dispatch —
 * scoped exactly like `afterInlineProperty`, so it never leaks into recursion.
 * A SEQUENCE entry's inline value is exempt: `- key: v` compact mappings are
 * legal, so `parseBlockSeq` never sets it (yaml-test-suite ZCZ6/ZL4Z/5U3A).
 */
let inlineMapValue = false;

/**
 * The column of a node's LEADING PROPERTY (`&name`), when it differs from the
 * column `parseBlockNode` would otherwise compute for the node that follows it
 * on the same line — `-1` means "no override, compute normally." A block
 * mapping's/sequence's column is the position sibling entries must align to;
 * for an anchored map (`&a a: b` at column 0, key text "a" itself landing at
 * column 3 after `"&a "`), that column is the PROPERTY's, not the resolved
 * key's — otherwise a sibling key back at column 0 (`c: &d d`) reads as a
 * dedent and wrongly ends the mapping after just one entry (a real bug this
 * feature's own test suite caught: `&a a: b\nc: &d d\n` must parse as ONE
 * two-key map, not one key followed by a bogus "second document"). Set by
 * `parseAnchoredBlockNode` right before its SAME-LINE recursive call, and
 * consumed (cleared) by the very next `parseBlockNode` call only — the
 * DEFERRED case needs no override, since a node starting fresh on its own
 * line already has the right column with nothing consumed ahead of it.
 */
let colOverride = -1;

/**
 * Whether `parseNextDocument` may currently start a document with NO marker
 * at all (a "bare" document). Per grammar, `l-bare-document` is legal only as
 * the very first document in the stream, or immediately after an explicit
 * `...` terminator — never merely because the previous document's content
 * happened to end (e.g. `--- [1, 2]\nnope\n` must be rejected: a flow value
 * ends the document but `nope` is neither preceded by `...` nor the stream's
 * first document, matching the oracle here). Reset to `true` per stream (the
 * first document may always be bare); updated at the end of every
 * `parseNextDocument` call based on whether that document ended in `...`.
 */
let bareDocAllowed = true;

/**
 * Compute a 1-based (line, column) for the current `pos` — only ever called on
 * the throw path, so the O(n) scan never touches the hot path (js-yaml's one
 * good lazy-error idea, without copying the whole input into the error).
 */
function fail(message: string): never {
  if (pos >= len) {
    throw new YAMLParseError(`${message}: unexpected end of input`);
  }
  let line = 1;
  let col = 1;
  for (let i = 0; i < pos; i++) {
    if (src.charCodeAt(i) === LF) {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  throw new YAMLParseError(`${message} (line ${line}, column ${col})`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reset all per-stream parser state and position `pos` past a leading BOM, if
 * any. Shared by `parse`/`parseAll` — the two differ only in how many
 * documents they read off the same document loop (`parseNextDocument`).
 */
function resetForStream(text: string): void {
  src = text;
  len = text.length;
  pos = 0;
  depth = 0;
  nextBackslash = -1;
  nextNewline = -1;
  lineStart = 0;
  keyCache = new Map();
  lastRecordKeys = null;
  tagHandles = null;
  anchorMap = null;
  pendingAnchorName = null;
  afterInlineProperty = false;
  inlineMapValue = false;
  colOverride = -1;
  bareDocAllowed = true;
  flowIndentFloor = -1;

  // Skip a leading BOM without copying the input.
  if (len > 0 && src.charCodeAt(0) === BOM) {
    pos = 1;
    lineStart = 1; // so the first line's content column is measured from here
  }
}

/**
 * Opt-in parse-time performance tradeoffs.
 *
 * IMPORTANT DESIGN RULE: only optimizations that carry a real COST as well as a
 * benefit belong under `optimizations`. They are OFF by default so the caller
 * consciously opts in and accepts the tradeoff. Optimizations that are ~free
 * wins are ALWAYS enabled and never appear here (e.g. the existing key cache and
 * block-scalar accumulation).
 */
export interface ParseOptimizations {
  /**
   * Intern repeated string scalar VALUES so equal values share one heap string
   * (map keys are always interned regardless). Trades ~+16% parse CPU for up to
   * ~-28% retained heap on data with many repeated string values; ~no benefit on
   * unique-value data. Correctness-invisible either way (interned strings are
   * `===`-equal and immutable). Default: `false`.
   */
  internStrings?: boolean;

  /**
   * Umbrella opt-out for strict-compliance validations that only REJECT malformed
   * input (today: the space-then-tab block-collection indentation guards, spec
   * 6.1; more may be added behind this one flag). Skipping them is ~4-8% faster on
   * medium/large block-YAML (more on deep, many-entry input) and does less work.
   * It NEVER changes how a valid document is interpreted — VALID input parses
   * identically either way; only rejection of malformed input is relaxed, so a
   * parse with this ON tolerates some spec-invalid YAML the default REJECTS.
   * Default: `false` (spec-strict).
   */
  skipStrictValidation?: boolean;
}

/** Options for {@link parse} / {@link parseAll}. Every field is optional; an omitted or `undefined` value leaves the parse behaviour byte-for-byte the default. */
export interface ParseOptions {
  /** Opt-in performance tradeoffs — see {@link ParseOptimizations}. */
  optimizations?: ParseOptimizations;
}

/**
 * Parse a single YAML document into a JavaScript value.
 *
 * Reads exactly one document — like `JSON.parse` and js-yaml's `load`. If
 * `text` contains more than one `---`-separated document (or any trailing
 * content after the first), `parse` throws rather than silently returning the
 * first; use {@link parseAll} for multi-document streams. Plain scalars are
 * typed per the YAML 1.2 core schema (`1` is a number, `true` a boolean,
 * `null`/`~`/empty a `null`); an empty document is `null`.
 *
 * @param text - The YAML source text.
 * @param options - Optional {@link ParseOptions}; omitting it (the default)
 * leaves parsing byte-for-byte unchanged.
 * @returns The document's value: an object, array, string, number, boolean,
 * or `null`.
 * @throws {@link YAMLParseError} if `text` is not well-formed YAML, or contains
 * more than one document.
 *
 * @example
 * ```ts
 * parse("dish: pancakes\nserves: 4")
 * // { dish: "pancakes", serves: 4 }
 * ```
 */
export function parse(text: string, options?: ParseOptions): unknown {
  resetForStream(text);
  valueCache = options?.optimizations?.internStrings ? new Map() : null;
  SKIP_STRICT_VALIDATION = options?.optimizations?.skipStrictValidation === true;
  try {
    const value = parseNextDocument();
    if (value === NO_DOCUMENT) return null; // empty stream → null (YAML), unlike JSON

    // Single-document contract (like js-yaml's `load`): a second document —
    // another marker, more directives, or any other trailing content — is an
    // error here; use `parseAll` for multi-document streams.
    if (pos < len) {
      fail("expected a single document in the stream, but found more (use parseAll for multi-document streams)");
    }
    return value;
  } finally {
    valueCache = null; // don't let the intern cache outlive the call
    SKIP_STRICT_VALIDATION = false; // restore the spec-compliant default
  }
}

/**
 * Parse a multi-document stream into an array of values, one entry per
 * document.
 *
 * Documents are separated by `---` (start) and/or `...` (end) markers; a
 * stream with no markers at all is a single (possibly bare) document, same as
 * {@link parse}. A source with no documents returns an empty array.
 *
 * @param text - The YAML source text, potentially containing multiple documents.
 * @param options - Optional {@link ParseOptions}; omitting it (the default)
 * leaves parsing byte-for-byte unchanged.
 * @returns One value per document, in document order.
 * @throws {@link YAMLParseError} if any document in the stream is not
 * well-formed YAML.
 *
 * @example
 * ```ts
 * parseAll("---\ndish: pancakes\n---\ndish: omelette\n")
 * // [{ dish: "pancakes" }, { dish: "omelette" }]
 * ```
 */
export function parseAll(text: string, options?: ParseOptions): unknown[] {
  resetForStream(text);
  valueCache = options?.optimizations?.internStrings ? new Map() : null;
  SKIP_STRICT_VALIDATION = options?.optimizations?.skipStrictValidation === true;
  try {
    const docs: unknown[] = [];
    for (;;) {
      const value = parseNextDocument();
      if (value === NO_DOCUMENT) break;
      docs.push(value);
    }
    return docs;
  } finally {
    valueCache = null; // don't let the intern cache outlive the call
    SKIP_STRICT_VALIDATION = false; // restore the spec-compliant default
  }
}

/**
 * Serialize a JavaScript value into a YAML document string (always ending in a
 * trailing newline).
 *
 * Emits block-style collections; strings, numbers, booleans and `null` become
 * scalars, and a `Uint8Array` becomes a `!!binary` scalar. Values that share a
 * reference — or form a cycle — are emitted once with an anchor (`&`) and
 * referenced by alias (`*`) rather than duplicated, so `parse(stringify(x))`
 * reconstructs the same shared-reference graph rather than a deep copy.
 *
 * @param value - The value to serialize.
 * @returns The YAML document text.
 *
 * @example
 * ```ts
 * stringify({ dish: "pancakes", ingredients: ["flour", "milk", "eggs"] })
 * // "dish: pancakes\ningredients:\n  - flour\n  - milk\n  - eggs\n"
 * ```
 */
// Implementation design (scalar quoting, `Uint8Array` → `!!binary`,
// anchors/aliases for shared references and cycles, block-style collections)
// lives in the "Stringify (dump)" section near the end of this file.
export function stringify(value: unknown): string {
  return dumpValue(value);
}

// ---------------------------------------------------------------------------
// Whitespace + comments (flow context)
// ---------------------------------------------------------------------------

/**
 * Whether position `i` is a flow separator — whitespace, a flow indicator
 * (`,[]{}`), or end of input. A `:` acts as a mapping separator (and `?` as an
 * explicit-key indicator) only when the character that follows it is such a
 * separator; otherwise the `:`/`?` is an ordinary plain-scalar character.
 */
function flowSeparatorAt(i: number): boolean {
  if (i >= len) return true;
  const c = src.charCodeAt(i);
  return c === SPACE || c === TAB || c === LF || c === CR || (CH[c] & F_FLOW_INDICATOR) !== 0;
}

/**
 * Skip inter-token whitespace in flow context: spaces, tabs, line breaks (flow
 * collections may span lines) and `#` comments (to end of line).
 *
 * Split into a tiny always-inlinable guard + an out-of-line `skipFlowWsSlow`
 * (M7, doc 07 §5): the loop is ~10% of flow self-time yet on tightly-packed
 * input (JSON has NO inter-token whitespace) almost every call is a no-op that
 * still paid loop setup + a module-global write. The guard peeks one char and,
 * unless it is actual whitespace/`#`/a `-`/`.` (the only first chars whose slow
 * body does anything but "clear the flag and leave `pos`"), clears the crossed-
 * line flag and returns — byte-identical to running the full loop. `-`/`.` are
 * routed to the slow body because a col-0 `---`/`...` there is an unterminated-
 * collection error the slow body must still raise (yaml-test-suite N782).
 */
function skipFlowWs(): void {
  const c0 = src.charCodeAt(pos);
  if (c0 !== SPACE && c0 !== TAB && c0 !== LF && c0 !== CR && c0 !== HASH && c0 !== MINUS && c0 !== DOT) {
    flowWsCrossedLine = false;
    return;
  }
  skipFlowWsSlow();
}

/** The full flow-whitespace loop; see `skipFlowWs` for why it is out-of-line. */
function skipFlowWsSlow(): void {
  flowWsCrossedLine = false;
  let p = pos;
  let lineHead = -1; // col-0 offset of the most recent line crossed (-1 = none)
  let badTab = false; // a tab within this crossed line's mandatory indentation
  while (p < len) {
    const c = src.charCodeAt(p);
    if (c === SPACE || c === TAB || c === LF || c === CR) {
      if (c === LF || c === CR) {
        flowWsCrossedLine = true;
        flowSpanned = true;
        lineHead = p + 1; // CRLF updates this twice; the LF's value wins
        badTab = false; // reset per line — a tab on a BLANK line is not indentation
      } else if (c === TAB && lineHead >= 0 && flowIndentFloor >= 0 && p - lineHead <= flowIndentFloor) {
        // A tab inside a flow continuation line's mandatory indentation cannot
        // count as indentation (yaml-test-suite Y79Y/003); flagged now, reported
        // once real content confirms this wasn't a blank line.
        badTab = true;
      }
      p++;
      continue;
    }
    if (c === HASH) {
      // A '#' begins a comment only at the start of a line or when preceded by
      // whitespace/a line break. A '#' that directly follows a token or flow
      // indicator (`,#x`, `]#x`, `"a"#x`) is NOT a comment and is invalid in
      // flow context — matching js-yaml/`yaml` (yaml-test-suite CVW2/9JBA).
      if (p > 0) {
        const prev = src.charCodeAt(p - 1);
        if (prev !== SPACE && prev !== TAB && prev !== LF && prev !== CR) {
          pos = p;
          fail("a comment must be separated from other tokens by whitespace");
        }
      }
      const nl = src.indexOf("\n", p);
      if (nl !== -1) {
        flowWsCrossedLine = true;
        flowSpanned = true;
      }
      p = nl === -1 ? len : nl + 1;
      lineHead = p;
      continue;
    }
    // A `---`/`...` document marker at column 0 can never appear inside an open
    // flow collection — the collection is unterminated (yaml-test-suite N782).
    if ((c === MINUS || c === DOT) && (p === 0 || src.charCodeAt(p - 1) === LF || src.charCodeAt(p - 1) === CR) && looksLikeDocMarkerAt(p)) {
      pos = p;
      fail("a document marker is not allowed inside a flow collection");
    }
    // A flow collection nested in a block context must keep its continuation
    // lines indented deeper than the enclosing block node; content at or below
    // that column — or reached over a tab used as indentation (`badTab`) — is
    // "deficient indentation" (yaml-test-suite 9C9N/VJP3/Y79Y-003). The floor is
    // -1 (disabled) at the document root, where col 0 is legal.
    if (lineHead >= 0 && flowIndentFloor >= 0 && (badTab || p - lineHead <= flowIndentFloor)) {
      pos = p;
      fail("insufficient indentation for a multi-line flow collection");
    }
    break;
  }
  pos = p;
}

// ---------------------------------------------------------------------------
// Anchors (`&name`) and aliases (`*name`) — M5. Node properties are a seam for
// F4 (tags): a `!tag` may precede OR follow an anchor (both orders are legal
// YAML — spec `c-ns-properties`), but tags aren't implemented yet, so no `!`
// handling is added here; a future `parseNodeProperties`-style merge just
// needs to also try a leading/trailing `!tag` around the `&name` scan below,
// in both the flow and block property-dispatch functions. For now a bare `!`
// falls through to whatever `parseFlowValue`/`parseBlockNode` already did with
// it pre-F4 (plain-scalar text — no special casing, per the design recipe).
// ---------------------------------------------------------------------------

/**
 * Scan an anchor/alias name starting at `pos` (just past the `&`/`*`
 * indicator) and return it, advancing `pos` to its end. Terminates at
 * whitespace, a line break, or a flow indicator (`,[]{}` — reusing the same
 * `F_FLOW_INDICATOR` bit the flow scanners already use); notably NOT at a
 * `:` — anchor/alias names may contain colons (calibrated against the oracle:
 * `&an:chor`, `&a:` are both valid names, the colon simply isn't special to
 * this grammar production the way it is to a plain scalar). Empty (nothing
 * before the first terminator) is a parse error, matching the oracle ("Anchor
 * cannot be an empty string").
 */
function scanAnchorOrAliasName(): string {
  const start = pos;
  while (pos < len) {
    const c = src.charCodeAt(pos);
    if (c === SPACE || c === TAB || c === LF || c === CR) break;
    if ((CH[c] & F_FLOW_INDICATOR) !== 0) break;
    pos++;
  }
  if (pos === start) fail("expected an anchor or alias name");
  return src.slice(start, pos);
}

/** Store `value` under `name` in the (lazily-created) anchor registry. */
function registerAnchor(name: string, value: unknown): void {
  if (anchorMap === null) anchorMap = new Map();
  anchorMap.set(name, value);
}

/**
 * If an anchor is currently waiting for the next node (see `pendingAnchorName`'s
 * doc comment), register `value` under it and clear the slot; otherwise a
 * no-op. Called at every point a node's final identity becomes known: container
 * allocation (before children, for cyclic structural sharing) and scalar/quoted/
 * block-scalar/key resolution. Single `!== null` check — free on anchor-free input.
 */
function registerPendingAnchor<T>(value: T): T {
  if (pendingAnchorName !== null) {
    registerAnchor(pendingAnchorName, value);
    pendingAnchorName = null;
  }
  return value;
}

/**
 * `*name` — resolve an alias to the SAME reference its anchor registered
 * (structural sharing, O(1) `Map.get`; never a deep copy). An alias to an
 * unknown/undefined anchor is a hard error (STRICTNESS: js-yaml v5 and the
 * oracle both reject this; a real negative-suite win over leniency).
 */
function parseAlias(): unknown {
  pos++; // past '*'
  const name = scanAnchorOrAliasName();
  if (anchorMap === null || !anchorMap.has(name)) fail(`unresolved alias '*${name}' (no matching anchor)`);
  return anchorMap.get(name);
}

/**
 * `&name <node>` in flow context. Flow has no "is this a container" ambiguity
 * (a `{`/`[` unambiguously self-registers before any nested content, including
 * a nested anchor, is parsed — see `registerPendingAnchor`'s doc comment), so
 * the save/restore below is a defensive no-op in practice for flow, but costs
 * nothing and keeps this symmetric with the block version, which genuinely
 * needs it.
 *
 * A tag may follow the anchor (`&a !!str x` — the other legal order is `!!str
 * &a x`, handled by `parseTaggedFlowValue` below); at most one of each is
 * legal (STRICTNESS, calibrated against the oracle: "A node can have at most
 * one anchor/tag").
 */
function parseAnchoredFlowValue(): unknown {
  pos++; // past '&'
  const name = scanAnchorOrAliasName();
  skipFlowWs(); // names may be followed by a line break inside a flow collection
  let c = src.charCodeAt(pos);
  if (c === AMP) fail("a node may carry at most one anchor");
  let tag: string | null = null;
  if (c === EXCLAIM) {
    tag = scanTag();
    checkTagSeparator(true);
    skipFlowWs();
    c = src.charCodeAt(pos);
    if (c === EXCLAIM) fail("a node may carry at most one tag");
    if (c === AMP) fail("a node may carry at most one anchor");
  }
  if (c === STAR) fail("an alias node cannot carry an anchor property");
  const outerPending = pendingAnchorName;
  pendingAnchorName = name;
  const node = tag !== null ? parseTaggedFlowContent(tag) : parseFlowValue();
  if (pendingAnchorName === name) registerAnchor(name, node); // scalar leaf: not yet consumed
  pendingAnchorName = outerPending;
  return node;
}

// ---------------------------------------------------------------------------
// Tags (`!!str`, `!local`, `!handle!suffix`, `!<verbatim>`, non-specific `!`)
// — F4. Shared by both the flow and block node-properties seams (each has its
// own entry point below, near its own dispatch — doc 07 §6's "flow and block
// have their own entry functions" discipline). `!` is always a COLD,
// out-of-line dispatch: the hot per-node cost is exactly one predicted-false
// `charCodeAt` compare in each dispatch switch (`parseFlowValue`,
// `parseBlockNode`, `parseFlowKey`, `parseBlockMapKey`) — everything below
// this point only runs when a `!` is actually seen.
//
// Implicit (core-schema) typing and explicit tags are mutually exclusive: a
// plain scalar's implicit type-guessing (`resolvePlain`) only ever runs when
// NO tag is present. Once a tag appears — known or not — resolution is the
// TAG's job alone; an unrecognized tag's fallback is the raw scalar text
// (never re-attempts implicit typing), calibrated against the oracle (`yaml`):
// `!foo 123` → "123" (a STRING, not the number 123) even though "123" alone
// would type as a number.
// ---------------------------------------------------------------------------

const CORE_TAG_PREFIX = "tag:yaml.org,2002:";
const TAG_STR = "tag:yaml.org,2002:str";
const TAG_INT = "tag:yaml.org,2002:int";
const TAG_FLOAT = "tag:yaml.org,2002:float";
const TAG_BOOL = "tag:yaml.org,2002:bool";
const TAG_NULL = "tag:yaml.org,2002:null";
const TAG_MAP = "tag:yaml.org,2002:map";
const TAG_SEQ = "tag:yaml.org,2002:seq";
const TAG_BINARY = "tag:yaml.org,2002:binary";
const TAG_SET = "tag:yaml.org,2002:set";
const TAG_OMAP = "tag:yaml.org,2002:omap";
const TAG_PAIRS = "tag:yaml.org,2002:pairs";
/** Sentinel canonical form for the bare, non-specific `!` tag (never collides with a real tag/prefix string). */
const NON_SPECIFIC_TAG = "!";

/** `c` may start a tag-handle "word" (`ns-word-char`: alnum or `-`). */
function isTagWordChar(c: number): boolean {
  return (c >= ZERO && c <= NINE) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === MINUS;
}

/**
 * Whether `c` may appear (unescaped) inside a tag suffix (`ns-tag-char`):
 * excludes whitespace, line breaks, flow indicators (`,[]{}` — reusing
 * `F_FLOW_INDICATOR`, exactly like anchor names), a literal `!`, and C0
 * controls. Codes ≥ 256 fall through to "not special" (`CH[c]` reads
 * `undefined` out of bounds) and are accepted, same latitude plain scalars get.
 */
function isTagSuffixChar(c: number): boolean {
  if (c === SPACE || c === TAB || c === LF || c === CR) return false;
  if (c < 0x20) return false;
  if (c === EXCLAIM) return false;
  return (CH[c] & F_FLOW_INDICATOR) === 0;
}

function scanTagSuffixRaw(): string {
  const start = pos;
  while (pos < len && isTagSuffixChar(src.charCodeAt(pos))) pos++;
  return src.slice(start, pos);
}

/**
 * Decode `%XX` escapes in a scanned tag suffix (`ns-uri-char`'s percent
 * escaping — e.g. `!e!tag%21` → suffix `tag!`, yaml-test-suite 6CK3/Z9M4).
 * Byte-for-charcode (not full UTF-8 reassembly): every escape in the suite's
 * corpus is ASCII, and this is a cold, rarely-hit path — documented scope
 * limit rather than a full URI-percent-decoder. A malformed `%` (not followed
 * by exactly two hex digits) is a hard error (calibrated against the oracle:
 * `!e!fo%2 bar` → "Tags and anchors must be separated from the next token by
 * white space", i.e. the truncated escape poisons the whole suffix scan).
 */
function decodeTagPercent(s: string): string {
  if (s.indexOf("%") === -1) return s;
  let out = "";
  let seg = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === PERCENT) {
      if (i + 2 >= s.length) fail("malformed '%' escape in a tag");
      const hi = hexDigit(s.charCodeAt(i + 1));
      const lo = hexDigit(s.charCodeAt(i + 2));
      if (hi < 0 || lo < 0) fail("malformed '%' escape in a tag");
      out += s.slice(seg, i) + String.fromCharCode(hi * 16 + lo);
      i += 2;
      seg = i + 1;
    }
  }
  return out + s.slice(seg);
}

/**
 * Scan a tag (`pos` at `!`) and return its CANONICAL string: a full
 * `tag:...`/custom-prefix URI, a local `!suffix`, or the `NON_SPECIFIC_TAG`
 * sentinel for a bare `!`. Handles all four surface forms (calibrated against
 * the oracle throughout — see the task's calibration script):
 *  - `!<...>` verbatim: content between the angle brackets, taken as-is (must
 *    be non-empty — an empty `!<>` is a malformed-tag error, matching js-yaml
 *    though not the lenient oracle; STRICTNESS).
 *  - `!!suffix` secondary handle: `tagHandles.get("!!") ?? CORE_TAG_PREFIX` +
 *    suffix (a `%TAG !! ...` directive CAN rebind `!!` away from the core
 *    schema — yaml-test-suite P76L: `!!int` under a redefined `!!` becomes an
 *    unrecognized application tag, NOT the core int tag).
 *  - `!handle!suffix` named handle: the handle MUST have a `%TAG` directive in
 *    THIS document (`tagHandles` is reset per-document, never per-stream) or
 *    it's a hard error (STRICTNESS: "undefined tag handle").
 *  - `!suffix` primary handle: default prefix `"!"` (so `!local` → `"!local"`)
 *    unless redefined by `%TAG !`; an entirely empty suffix (bare `!`) is the
 *    non-specific tag.
 * Does NOT check the post-tag separator — callers do that via
 * `checkTagSeparator` immediately after, since the valid terminator set
 * differs between flow and block context.
 */
function scanTag(): string {
  pos++; // past the leading '!'
  const c = pos < len ? src.charCodeAt(pos) : -1;
  if (c === LT) {
    pos++; // past '<'
    const vStart = pos;
    const gt = src.indexOf(">", pos);
    if (gt === -1) fail("unterminated verbatim tag: missing '>'");
    if (gt === vStart) fail("a verbatim tag ('!<...>') must not be empty");
    pos = gt + 1;
    return src.slice(vStart, gt);
  }
  if (c === EXCLAIM) {
    pos++; // past the second '!'
    const suffix = scanTagSuffixRaw();
    const prefix = tagHandles !== null && tagHandles.has("!!") ? tagHandles.get("!!")! : CORE_TAG_PREFIX;
    return prefix + decodeTagPercent(suffix);
  }
  // Try a named handle `!word!suffix` — a non-consuming-on-failure lookahead:
  // scan the narrow word-char run, then check for the handle-closing '!'.
  const wordStart = pos;
  while (pos < len && isTagWordChar(src.charCodeAt(pos))) pos++;
  if (pos > wordStart && pos < len && src.charCodeAt(pos) === EXCLAIM) {
    const handle = src.slice(wordStart - 1, pos + 1); // "!word!"
    pos++; // past the closing '!'
    const suffix = scanTagSuffixRaw();
    const prefix = tagHandles !== null ? tagHandles.get(handle) : undefined;
    if (prefix === undefined) fail(`undefined tag handle '${handle}' (no matching %TAG directive in this document)`);
    return prefix + decodeTagPercent(suffix);
  }
  // Primary handle '!': the suffix charset is broader than the word-char set
  // used for the named-handle lookahead, so rescan from right after the '!'.
  pos = wordStart;
  const suffix = scanTagSuffixRaw();
  if (suffix.length === 0) return NON_SPECIFIC_TAG;
  const prefix = tagHandles !== null && tagHandles.has("!") ? tagHandles.get("!")! : "!";
  return prefix + decodeTagPercent(suffix);
}

/**
 * A tag must be separated from whatever follows by whitespace, a line break,
 * or EOF — UNLESS we're in flow context, where a flow indicator (`,]}`, etc.)
 * is ALSO a legal terminator (it ends the — then empty — tagged node, e.g.
 * `[ !!str, next ]` → `["", "next"]`). In block context the same flow
 * indicator is NOT a valid terminator (yaml-test-suite U99R: `- !!str, xxx`
 * errors; LHL4: `!invalid{}tag` errors at the unescaped `{`) — calibrated
 * against the oracle's "Tags and anchors must be separated from the next
 * token by white space".
 */
function checkTagSeparator(inFlow: boolean): void {
  const c = pos < len ? src.charCodeAt(pos) : -1;
  if (c === -1 || c === SPACE || c === TAB || c === LF || c === CR) return;
  if (inFlow && (CH[c] & F_FLOW_INDICATOR) !== 0) return;
  fail("a tag must be separated from the following content by whitespace");
}

/**
 * Force a scalar span typed by an explicit tag. `raw` is the node's resolved
 * (escape-decoded / chomped) content — NEVER re-typed via `resolvePlain`,
 * since an explicit tag replaces implicit typing entirely.
 *  - `!!str`, the non-specific `!`, and any unrecognized (local/custom/named)
 *    tag: keep the raw string, matching the oracle (`!foo 123` → "123").
 *  - `!!int`/`!!float`/`!!bool`/`!!null`: STRICT core-schema validation —
 *    content that doesn't satisfy the tag is a hard error (STRICTNESS,
 *    matching js-yaml — the oracle is lenient here by design, warning and
 *    keeping the raw string instead; deliberate, documented divergence).
 *  - `!!binary`: base64-decode to a `Uint8Array` (see `decodeBinary`).
 *  - `!!map`/`!!seq`/`!!set`/`!!omap`/`!!pairs`: these require a collection
 *    node, so a scalar never satisfies them — a kind-mismatch error
 *    (STRICTNESS; the oracle warns-and-passes-through, js-yaml throws — we
 *    follow js-yaml).
 */
function applyScalarTag(tag: string, raw: string): unknown {
  switch (tag) {
    case TAG_STR:
    case NON_SPECIFIC_TAG:
      return raw;
    case TAG_INT:
      return forceInt(raw);
    case TAG_FLOAT:
      return forceFloat(raw);
    case TAG_BOOL:
      return forceBool(raw);
    case TAG_NULL:
      return forceNull(raw);
    case TAG_BINARY:
      return decodeBinary(raw);
    case TAG_MAP:
    case TAG_SEQ:
    case TAG_SET:
    case TAG_OMAP:
    case TAG_PAIRS:
      fail(`the !!${tag.slice(CORE_TAG_PREFIX.length)} tag requires a mapping/sequence node, not a scalar`);
  }
  return raw; // unrecognized (local/custom/named) tag: no typing, keep raw text
}

/**
 * Apply an explicit tag to an already-built collection (`kind` says whether
 * the syntax that produced `value` was a mapping or a sequence — the tag must
 * agree, or it's a kind-mismatch error, STRICTNESS as in `applyScalarTag`).
 * `!!set`/`!!omap`/`!!pairs` additionally RESHAPE the value (a set's/omap's
 * underlying syntax is an ordinary mapping/sequence node — see `buildSet`/
 * `buildOmap`/`validatePairs`), calibrated against the oracle's actual
 * `.toJS()` shapes (a real `Set`, a real insertion-ordered `Map`, and a plain
 * array of one-key objects, respectively — NOT invented representations).
 */
function applyCollectionTag(tag: string, value: unknown, kind: "map" | "seq"): unknown {
  switch (tag) {
    case TAG_MAP:
      if (kind !== "map") fail("the !!map tag requires a mapping node");
      return value;
    case TAG_SEQ:
      if (kind !== "seq") fail("the !!seq tag requires a sequence node");
      return value;
    case TAG_SET:
      if (kind !== "map") fail("the !!set tag requires a mapping node");
      return buildSet(value as Record<string, unknown>);
    case TAG_OMAP:
      if (kind !== "seq") fail("the !!omap tag requires a sequence node");
      return buildOmap(value as unknown[]);
    case TAG_PAIRS:
      if (kind !== "seq") fail("the !!pairs tag requires a sequence node");
      validatePairs(value as unknown[]);
      return value;
    case TAG_STR:
    case TAG_INT:
    case TAG_FLOAT:
    case TAG_BOOL:
    case TAG_NULL:
    case TAG_BINARY:
      fail(`the !!${tag.slice(CORE_TAG_PREFIX.length)} tag requires a scalar node, not a ${kind === "map" ? "mapping" : "sequence"}`);
  }
  return value; // unrecognized/non-specific tag: no reshaping, passthrough
}

/** `!!int`: strict core-schema integer only (no decimal point/exponent — `3.5` is a hard error). */
function forceInt(raw: string): number {
  const r = tryNumberGeneric(raw);
  if (r === NOT_NUMERIC || r.isFloat) fail(`!!int: '${raw}' is not a valid core-schema integer`);
  return r.value;
}

/**
 * `!!float`: any core-schema NUMBER (int- or float-shaped) is accepted — JS
 * has one numeric type, so `!!float 3` and `!!float 3.0` are indistinguishable
 * results; this matches js-yaml's practical behaviour and deliberately
 * diverges from the oracle's pickier float-only regex (which leaves `!!float
 * 3` unresolved), per this feature's mandated strictness stance.
 */
function forceFloat(raw: string): number {
  const r = tryNumberGeneric(raw);
  if (r === NOT_NUMERIC) fail(`!!float: '${raw}' is not a valid core-schema number`);
  return r.value;
}

/** `!!bool`: only the exact 1.2 core-schema boolean words (no YAML-1.1 `yes`/`no`/`on`/`off`). */
function forceBool(raw: string): boolean {
  switch (raw) {
    case "true":
    case "True":
    case "TRUE":
      return true;
    case "false":
    case "False":
    case "FALSE":
      return false;
  }
  fail(`!!bool: '${raw}' is not a valid core-schema boolean`);
}

/** `!!null`: empty content or one of the core-schema null words. */
function forceNull(raw: string): null {
  if (raw.length === 0) return null;
  switch (raw) {
    case "~":
    case "null":
    case "Null":
    case "NULL":
      return null;
  }
  fail(`!!null: '${raw}' is not a valid core-schema null`);
}

/**
 * Generic (non-`src`-offset) sibling of `tryNumber`/`tryFlowNumber`: those two
 * read the module-level `src` by integer offset, but a tag's `raw` content may
 * already be a materialized, independent string (quoted-escape-decoded, or a
 * folded/chomped block scalar) with no corresponding `src` span — so this
 * duplicates the same core-schema number grammar (hex/octal ints,
 * decimal/float/exponent, `.inf`/`.nan`) over an arbitrary string. Cold path
 * (`!!int`/`!!float` only) — the duplication trades a little code for zero
 * risk to the hot per-scalar number path.
 */
function tryNumberGeneric(s: string): { isFloat: boolean; value: number } | typeof NOT_NUMERIC {
  const end = s.length;
  let p = 0;
  let c = end > 0 ? s.charCodeAt(0) : -1;
  const neg = c === MINUS;
  const signed = neg || c === PLUS;
  if (signed) {
    p = 1;
    if (p >= end) return NOT_NUMERIC;
    c = s.charCodeAt(p);
  }
  if (!signed && c === ZERO && p + 1 < end) {
    const n2 = s.charCodeAt(p + 1);
    if (n2 === 0x78) {
      const v = hexValueGeneric(s, p + 2, end);
      return v === NOT_NUMERIC ? NOT_NUMERIC : { isFloat: false, value: v };
    }
    if (n2 === 0x6f) {
      const v = octalValueGeneric(s, p + 2, end);
      return v === NOT_NUMERIC ? NOT_NUMERIC : { isFloat: false, value: v };
    }
  }
  if (c === DOT && end - p === 4) {
    const a = s.charCodeAt(p + 1);
    const b = s.charCodeAt(p + 2);
    const d = s.charCodeAt(p + 3);
    if (isInfWord(a, b, d)) return { isFloat: true, value: neg ? -Infinity : Infinity };
    if (!signed && isNanWord(a, b, d)) return { isFloat: true, value: NaN };
  }
  let v = 0;
  let nd = 0;
  while (p < end) {
    const d = s.charCodeAt(p) - ZERO;
    if (d < 0 || d > 9) break;
    v = v * 10 + d;
    nd++;
    p++;
  }
  let isFloat = false;
  if (p < end && s.charCodeAt(p) === DOT) {
    isFloat = true;
    p++;
    while (p < end) {
      const d = s.charCodeAt(p) - ZERO;
      if (d < 0 || d > 9) break;
      nd++;
      p++;
    }
  }
  if (nd === 0) return NOT_NUMERIC;
  if (p < end) {
    const e = s.charCodeAt(p);
    if (e === LOWER_E || e === UPPER_E) {
      isFloat = true;
      p++;
      if (p < end) {
        const sgn = s.charCodeAt(p);
        if (sgn === PLUS || sgn === MINUS) p++;
      }
      const expStart = p;
      while (p < end) {
        const d = s.charCodeAt(p) - ZERO;
        if (d < 0 || d > 9) break;
        p++;
      }
      if (p === expStart) return NOT_NUMERIC;
    }
  }
  if (p !== end) return NOT_NUMERIC;
  if (!isFloat && nd <= 15) return { isFloat: false, value: neg ? -v : v };
  return { isFloat, value: +s };
}

function hexValueGeneric(s: string, p: number, end: number): number | typeof NOT_NUMERIC {
  if (p >= end) return NOT_NUMERIC;
  let v = 0;
  while (p < end) {
    const d = hexDigit(s.charCodeAt(p));
    if (d < 0) return NOT_NUMERIC;
    v = v * 16 + d;
    p++;
  }
  return v;
}

function octalValueGeneric(s: string, p: number, end: number): number | typeof NOT_NUMERIC {
  if (p >= end) return NOT_NUMERIC;
  let v = 0;
  while (p < end) {
    const c = s.charCodeAt(p);
    if (c < ZERO || c > 0x37) return NOT_NUMERIC;
    v = v * 8 + (c - ZERO);
    p++;
  }
  return v;
}

/** Base64 alphabet → 6-bit value, -1 for "not a base64 character". */
const BASE64_INV = new Int16Array(256).fill(-1);
{
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < alphabet.length; i++) BASE64_INV[alphabet.charCodeAt(i)] = i;
}

/**
 * `!!binary`: base64-decode `raw` to a `Uint8Array` — MUST be a plain
 * `Uint8Array` (not a Node `Buffer`), matching `bench/oracle.ts`'s contract
 * exactly (a `Buffer`'s different constructor fails `deepStrictEqual`). All
 * whitespace is stripped first (block/multi-line base64 wraps at a fixed
 * column — yaml-test-suite 565N).
 *
 * STRICTNESS: unlike the oracle (which delegates to Node's very lenient
 * `Buffer.from(str, "base64")` — silently drops invalid characters, stops at
 * a mid-string `=`, never throws), we STRICTLY validate: length a multiple of
 * 4 after whitespace-stripping, only base64-alphabet characters, and `=`
 * padding only as the last 1-2 characters. This is a deliberate, documented
 * divergence from the (permissive-by-default) oracle, matching this
 * feature's mandated strictness stance — real base64 (including everything
 * our own fixture generator and the yaml-test-suite corpus produce) is always
 * well-formed and decodes identically either way.
 */
function decodeBinary(raw: string): Uint8Array {
  const clean = stripBase64Whitespace(raw);
  const n = clean.length;
  if (n === 0) return new Uint8Array(0);
  if (n % 4 !== 0) fail("malformed !!binary content: base64 length must be a multiple of 4 after stripping whitespace");
  let padding = 0;
  if (clean.charCodeAt(n - 1) === 0x3d /* = */) {
    padding = 1;
    if (clean.charCodeAt(n - 2) === 0x3d) padding = 2;
  }
  for (let i = 0; i < n - padding; i++) {
    const code = clean.charCodeAt(i);
    if (code >= 256 || BASE64_INV[code] === -1) fail("malformed !!binary content: invalid base64 character");
  }
  const outLen = (n / 4) * 3 - padding;
  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < n; i += 4) {
    const c0 = BASE64_INV[clean.charCodeAt(i)];
    const c1 = BASE64_INV[clean.charCodeAt(i + 1)];
    const c2ch = clean.charCodeAt(i + 2);
    const c3ch = clean.charCodeAt(i + 3);
    const c2 = c2ch === 0x3d ? 0 : BASE64_INV[c2ch];
    const c3 = c3ch === 0x3d ? 0 : BASE64_INV[c3ch];
    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    const isLastGroup = i + 4 === n;
    out[o++] = (triple >> 16) & 0xff;
    if (!(isLastGroup && padding >= 2)) out[o++] = (triple >> 8) & 0xff;
    if (!(isLastGroup && padding >= 1)) out[o++] = triple & 0xff;
  }
  return out;
}

/** Strip ASCII whitespace from a base64 blob without a regex (charCode loop, one join). */
function stripBase64Whitespace(raw: string): string {
  let hasWs = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c === SPACE || c === TAB || c === LF || c === CR) {
      hasWs = true;
      break;
    }
  }
  if (!hasWs) return raw;
  let out = "";
  let seg = 0;
  for (let i = 0; i <= raw.length; i++) {
    const c = i < raw.length ? raw.charCodeAt(i) : -1;
    if (c === SPACE || c === TAB || c === LF || c === CR || c === -1) {
      if (i > seg) out += raw.slice(seg, i);
      seg = i + 1;
    }
  }
  return out;
}

/** `!!set`: the underlying node is a mapping whose values must all be null (STRICTNESS, matching the oracle). */
function buildSet(map: Record<string, unknown>): Set<string> {
  const set = new Set<string>();
  for (const k of Object.keys(map)) {
    if (map[k] !== null) fail("!!set: every key must have a null value");
    set.add(k);
  }
  return set;
}

/** `!!omap`: the underlying node is a sequence of single-key mappings, in order (matches the oracle's real `Map`). */
function buildOmap(seq: unknown[]): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const entry of seq) {
    const keys = singlePairKeys(entry);
    map.set(keys[0], (entry as Record<string, unknown>)[keys[0]]);
  }
  return map;
}

/** `!!pairs`: same shape requirement as `!!omap` (sequence of single-key mappings), but no reshaping — passthrough. */
function validatePairs(seq: unknown[]): void {
  for (const entry of seq) singlePairKeys(entry);
}

/** Shared `!!omap`/`!!pairs` validation: `entry` must be a plain object with exactly one own key. */
function singlePairKeys(entry: unknown): string[] {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    fail("each entry must be a single-key mapping ('- key: value')");
  }
  const keys = Object.keys(entry as Record<string, unknown>);
  if (keys.length !== 1) fail("each entry must have exactly one key (one sequence indicator per pair)");
  return keys;
}

// ---------------------------------------------------------------------------
// Tags in FLOW context — the `!` dispatch entry points.
// ---------------------------------------------------------------------------

/**
 * `!tag <node>` in flow context (`pos` at `!`). An anchor may follow the tag
 * (`!!str &a x` — the other order is `parseAnchoredFlowValue` above); at most
 * one of each.
 */
function parseTaggedFlowValue(): unknown {
  const tag = scanTag();
  checkTagSeparator(true);
  skipFlowWs();
  let c = src.charCodeAt(pos);
  if (c === EXCLAIM) fail("a node may carry at most one tag");
  let anchorName: string | null = null;
  if (c === AMP) {
    pos++;
    anchorName = scanAnchorOrAliasName();
    skipFlowWs();
    c = src.charCodeAt(pos);
    if (c === AMP) fail("a node may carry at most one anchor");
    if (c === EXCLAIM) fail("a node may carry at most one tag");
  }
  if (c === STAR) fail("an alias node cannot carry a tag/anchor property");
  const touched = anchorName !== null;
  const outerPending = pendingAnchorName;
  if (touched) pendingAnchorName = anchorName;
  const node = parseTaggedFlowContent(tag);
  if (touched) {
    if (pendingAnchorName === anchorName) registerAnchor(anchorName!, node);
    pendingAnchorName = outerPending;
  }
  return node;
}

/**
 * The node a flow tag decorates, once any node-properties scanning is done —
 * shared by `parseTaggedFlowValue` (tag-first) and `parseAnchoredFlowValue`
 * (anchor-first, tag-after). Collections apply the tag as kind-validation
 * (`applyCollectionTag`); quoted/plain scalars apply it as forced typing over
 * their RAW content (`applyScalarTag`) — never through `resolvePlain`/
 * `tryFlowNumber`, since the tag overrides implicit typing entirely. An empty
 * flow terminator right here (`,`/`]`/`}`/EOF) is a tagged EMPTY scalar
 * (`[ !!str, next ]` → `["", "next"]`, calibrated against the oracle).
 */
function parseTaggedFlowContent(tag: string): unknown {
  const c = src.charCodeAt(pos);
  if (c === LBRACE) return applyCollectionTag(tag, parseFlowMap(), "map");
  if (c === LBRACKET) return applyCollectionTag(tag, parseFlowSeq(), "seq");
  if (c === DQUOTE) return applyScalarTag(tag, parseDoubleQuoted());
  if (c === SQUOTE) return applyScalarTag(tag, parseSingleQuoted());
  if (c === STAR) fail("an alias node cannot carry a tag property");
  if (flowSeparatorAt(pos)) return applyScalarTag(tag, "");
  const start = pos;
  const end = scanFlowPlainEnd();
  return applyScalarTag(tag, flowFolded !== null ? flowFolded : src.slice(start, end));
}

// ---------------------------------------------------------------------------
// Flow value dispatch — one switch on the current char, never a trial chain.
// ---------------------------------------------------------------------------

function parseFlowValue(): unknown {
  const c = src.charCodeAt(pos);
  switch (c) {
    case LBRACE:
      return parseFlowMap();
    case LBRACKET:
      return parseFlowSeq();
    case DQUOTE:
      return parseDoubleQuoted();
    case SQUOTE:
      return parseSingleQuoted();
    case AMP:
      return parseAnchoredFlowValue();
    case EXCLAIM:
      return parseTaggedFlowValue();
    case STAR:
      return parseAlias();
  }
  // Number fast path: number-starters parse in a single forward scan. On success
  // this skips the plain-scan + resolve double pass entirely (the hot case on
  // JSON-shaped data). A number-starter that fails the number grammar can only be
  // a plain string — null/bool never start with a digit/sign/dot — so we slice it
  // directly instead of routing back through typing.
  if ((c >= ZERO && c <= NINE) || c === MINUS || c === PLUS || c === DOT) {
    const num = tryFlowNumber();
    if (num !== NOT_NUMERIC) return num;
    // A '-' that opens a flow scalar but is immediately followed by a flow
    // separator is a block-sequence indicator, which is forbidden inside a flow
    // collection (`[-]`, `[-, -]` — yaml-test-suite YJV2/G5U8).
    if (c === MINUS && flowSeparatorAt(pos + 1)) fail("a block sequence '-' indicator is not allowed in a flow collection");
    const start = pos;
    const end = scanFlowPlainEnd();
    return flowFolded !== null ? flowFolded : src.slice(start, end);
  }
  return parseFlowPlain();
}

// ---------------------------------------------------------------------------
// Flow sequence  [ a, b, c ]  (entries may be single-pair maps: [ a: b ])
// ---------------------------------------------------------------------------

function parseFlowSeq(): unknown[] {
  if (++depth > MAX_DEPTH) fail("maximum nesting depth exceeded");
  pos++; // past '['
  const arr: unknown[] = []; // built with push → stays PACKED
  registerPendingAnchor(arr); // before children, so `&a [*a]` self-references correctly
  for (;;) {
    skipFlowWs();
    let c = src.charCodeAt(pos);
    if (c === RBRACKET) {
      pos++;
      break;
    }
    if (c === COLON && flowSeparatorAt(pos + 1)) {
      // A leading *boundary* `:` is an empty-key single-pair entry ([:] → [{"": null}]).
      // A `:` followed by non-separator (`:ff`) is an ordinary plain scalar (falls through).
      arr.push(makeSinglePair("")); // leaves pos whitespace-skipped
    } else if (c === QUESTION && flowSeparatorAt(pos + 1)) {
      // Explicit-key single-pair entry ([? a: b] → [{a: b}]).
      arr.push(parseFlowExplicitEntry());
    } else {
      const node = parseFlowValue();
      skipFlowWs();
      if (src.charCodeAt(pos) === COLON) {
        // `node: value` inside a sequence → an implicit single-pair mapping entry.
        // Its implicit key must be on one line: a `:` that landed on a later line
        // than the key (`[ key\n : v ]`) is invalid (yaml-test-suite DK4H/ZXT5).
        if (flowWsCrossedLine) fail("an implicit key in a flow sequence must be on a single line");
        arr.push(makeSinglePair(keyToString(node))); // leaves pos whitespace-skipped
      } else {
        // Common path: the skipFlowWs above already positioned us at ',' or ']'.
        arr.push(node);
      }
    }
    c = src.charCodeAt(pos);
    if (c === COMMA) {
      pos++;
      continue;
    }
    if (c === RBRACKET) {
      pos++;
      break;
    }
    fail("expected ',' or ']' in flow sequence");
  }
  depth--;
  return arr;
}

/**
 * Build a single-pair mapping from a sequence entry. Call with `pos` at the `:`;
 * consumes it, reads the value (empty → null), and returns `{ key: value }`.
 */
function makeSinglePair(key: string): Record<string, unknown> {
  pos++; // past ':'
  skipFlowWs();
  const c = src.charCodeAt(pos);
  const value = c === COMMA || c === RBRACKET || c === RBRACE ? null : parseFlowValue();
  const pair: Record<string, unknown> = {};
  storeKey(pair, key, value);
  skipFlowWs(); // leave pos at the following ',' / ']' for the caller
  return pair;
}

/** An explicit-key sequence entry: `? key` optionally followed by `: value`. */
function parseFlowExplicitEntry(): Record<string, unknown> {
  pos++; // past '?'
  skipFlowWs();
  const c = src.charCodeAt(pos);
  const key = c === COLON || c === COMMA || c === RBRACKET || c === RBRACE ? "" : keyToString(parseFlowValue());
  skipFlowWs();
  if (src.charCodeAt(pos) === COLON) return makeSinglePair(key); // consumes ':' + value
  const pair: Record<string, unknown> = {};
  storeKey(pair, key, null); // `? key` with no value
  return pair;
}

// ---------------------------------------------------------------------------
// Flow mapping  { k: v, ... }  (keys plain/quoted; values may be empty → null)
// ---------------------------------------------------------------------------

function parseFlowMap(): Record<string, unknown> {
  if (++depth > MAX_DEPTH) fail("maximum nesting depth exceeded");
  pos++; // past '{'
  const obj: Record<string, unknown> = {};
  registerPendingAnchor(obj); // before children, so `&a {self: *a}` self-references correctly
  // FastKeyMatch (M7): `expected` is the previous sibling map's canonical key
  // list; `produced` accumulates THIS map's keys for the next sibling, reusing
  // `expected`'s array verbatim while the shapes stay identical (zero alloc on
  // homogeneous records) and only materialising a fresh copy on divergence.
  const expected = lastRecordKeys;
  let produced: string[] | null = expected;
  let matched = true; // produced[0..kc) === expected[0..kc) so far
  let kc = 0; // keys produced so far
  for (;;) {
    skipFlowWs();
    let c = src.charCodeAt(pos);
    if (c === RBRACE) {
      pos++;
      break;
    }
    let key: string;
    if (c === QUESTION && flowSeparatorAt(pos + 1)) {
      // Explicit `? key` (cold): the key is a full node up to ':'/','/'}'.
      pos++;
      skipFlowWs();
      c = src.charCodeAt(pos);
      key = c === COLON || c === COMMA || c === RBRACE ? "" : keyToString(parseFlowValue());
    } else {
      const ek = matched && expected !== null && kc < expected.length && pendingAnchorName === null ? expected[kc] : null;
      key = ek !== null && fastMatchFlowKey(c, ek) ? ek : parseFlowKey();
    }
    // Record `key` into `produced` (see the entry comment): stay on the shared
    // `expected` array while it still matches, else fork a private copy.
    if (matched && expected !== null && kc < expected.length && expected[kc] === key) {
      // identical so far — keep sharing `expected`
    } else {
      if (matched) {
        produced = expected === null ? [] : expected.slice(0, kc);
        matched = false;
      }
      produced!.push(key);
    }
    kc++;
    skipFlowWs();
    let value: unknown = null;
    if (src.charCodeAt(pos) === COLON) {
      pos++;
      skipFlowWs();
      c = src.charCodeAt(pos);
      if (c !== COMMA && c !== RBRACE) value = parseFlowValue();
    }
    storeKey(obj, key, value);
    skipFlowWs();
    c = src.charCodeAt(pos);
    if (c === COMMA) {
      pos++;
      continue;
    }
    if (c === RBRACE) {
      pos++;
      break;
    }
    fail("expected ',' or '}' in flow mapping");
  }
  lastRecordKeys = publishRecordKeys(expected, produced, matched, kc);
  depth--;
  return obj;
}

/**
 * Assign a mapping pair. `__proto__` is guarded so it becomes an own data
 * property (matching `JSON.parse`) instead of poisoning the prototype chain —
 * the check is a single `charCodeAt` compare for the 99.9% of keys that don't
 * start with `_`, only escalating to a string compare + `defineProperty` for
 * the rare candidate. Duplicate keys are last-wins (JSON.parse semantics).
 */
function storeKey(obj: Record<string, unknown>, key: string, value: unknown): void {
  if (key.charCodeAt(0) === UNDERSCORE && key === "__proto__") {
    Object.defineProperty(obj, "__proto__", {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } else {
    obj[key] = value;
  }
}

/**
 * Coerce a resolved node into a mapping key string (JS object-key semantics,
 * matching the oracle): strings pass through; a null key becomes the empty
 * string (`null: 1` → {"": 1}); numbers/bools stringify canonically.
 */
function keyToString(node: unknown): string {
  if (typeof node === "string") return node;
  if (node === null) return "";
  if (typeof node === "object") return stringifyKeyNode(node);
  return String(node);
}

// ---------------------------------------------------------------------------
// Complex (collection) mapping keys — cold, rare: only an EXPLICIT `? key`
// can ever resolve to a non-scalar (a sequence or mapping), which is the
// entire point of the explicit form (an implicit key can't be). A collection
// can't be a JS object property directly, so it's rendered into a string —
// matching the oracle's `.toJS()` behavior for a non-scalar map key, which
// serializes the key's own YAML AST in flow style with padding (`yaml`
// package's `addPairToJSMap.ts`: `key.toString({ inFlow: true, ... })`), e.g.
// `[a, b]` -> `"[ a, b ]"`, `{a: 1}` -> `"{ a: 1 }"`, `[]` -> `"[]"`. This is
// NOT the general `stringify` (the public dumper) — it only
// ever has to render what a key node can be: nested scalars/arrays/objects
// (and, rarely, a `!!set`/`!!omap` used as a key), never anchors/tags/comments.
// ---------------------------------------------------------------------------

function stringifyKeyNode(node: object): string {
  if (Array.isArray(node)) return stringifyKeyItems(node.length, (i) => stringifyKeyValue(node[i]), "[", "]");
  if (node instanceof Set) {
    const items = [...node.values()];
    return stringifyKeyItems(items.length, (i) => stringifyKeyValue(items[i]), "[", "]");
  }
  if (node instanceof Map) {
    const entries = [...node.entries()];
    return stringifyKeyItems(entries.length, (i) => `${stringifyKeyScalar(keyToString(entries[i]![0]))}: ${stringifyKeyValue(entries[i]![1])}`, "{", "}");
  }
  if (node instanceof Uint8Array) return stringifyKeyNode(Array.from(node)); // best-effort, rare (a binary key)
  const keys = Object.keys(node as Record<string, unknown>);
  return stringifyKeyItems(keys.length, (i) => `${stringifyKeyScalar(keys[i]!)}: ${stringifyKeyValue((node as Record<string, unknown>)[keys[i]!])}`, "{", "}");
}

/** Shared flow-padding join for `stringifyKeyNode`'s array/object branches: `"[]"`/`"{}"` empty, else `"X item, item Y"`. */
function stringifyKeyItems(count: number, render: (i: number) => string, open: string, close: string): string {
  if (count === 0) return open + close;
  let out = open + " ";
  for (let i = 0; i < count; i++) {
    if (i > 0) out += ", ";
    out += render(i);
  }
  return out + " " + close;
}

function stringifyKeyValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return stringifyKeyScalar(value);
  if (typeof value === "object") return stringifyKeyNode(value);
  return String(value);
}

/** A scalar as it appears NESTED inside a complex key's rendering: quoted only if plain would misread it. */
function stringifyKeyScalar(s: string): string {
  return keyScalarNeedsQuote(s) ? JSON.stringify(s) : s;
}

// A leading char that would change a plain scalar's meaning if unquoted
// (indicator characters — spec c-indicator) — cold, so a regex is fine.
const RE_KEY_SCALAR_LEADING_INDICATOR = /^[-?:,[\]{}#&*!|>'"%@`]/;
// A `: `/`:$`/` #` inside the text would be read as a mapping separator or
// comment if left unquoted.
const RE_KEY_SCALAR_STRUCTURAL = /: |:$| #|\n/;
// Text that would resolve to null/bool/number if written bare — must be
// quoted to stay a string (mirrors `resolvePlain`'s dispatch, cold+simplified).
const RE_KEY_SCALAR_RETYPES = /^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE|[-+]?(?:0x[0-9a-fA-F]+|0o[0-7]+|\d+)|[-+]?(?:\.\d+|\d+\.\d*)(?:[eE][-+]?\d+)?|[-+]?\d+[eE][-+]?\d+|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;

function keyScalarNeedsQuote(s: string): boolean {
  if (s.length === 0) return true;
  return RE_KEY_SCALAR_LEADING_INDICATOR.test(s) || RE_KEY_SCALAR_STRUCTURAL.test(s) || RE_KEY_SCALAR_RETYPES.test(s);
}

/**
 * Intern a plain-scalar key span. A plain key is scalar-typed exactly like a
 * plain value and then canonicalized to a string (so `00`, `0x10`, `True`, `~`
 * become `"0"`, `"16"`, `"true"`, `""` — matching the oracle). Quoted keys are
 * NOT typed (a quoted scalar is always a string), so they take a different path.
 *
 * `registerPendingAnchor` runs on the RAW resolved value, before `keyToString`
 * — an anchored key (`&a 5: x`) must register the number 5, not the string
 * "5", so a later alias used as a plain VALUE elsewhere still resolves to a
 * number (only USE as a key applies `keyToString`, same as any other node).
 */
function plainKey(start: number, end: number): string {
  return internKey(keyToString(registerPendingAnchor(resolvePlain(start, end))));
}

/** A flow mapping key: an anchor/alias, tag, double-quoted, single-quoted, or a plain scalar. */
function parseFlowKey(): string {
  const c = src.charCodeAt(pos);
  if (c === AMP) return parseFlowKeyAnchored();
  if (c === EXCLAIM) return parseFlowKeyTagged();
  if (c === STAR) return internKey(keyToString(parseAlias()));
  if (c === DQUOTE) return internKey(parseDoubleQuoted());
  if (c === SQUOTE) return internKey(parseSingleQuoted());
  const start = pos;
  const end = scanFlowPlainEnd();
  if (flowFolded !== null) return internKey(flowFolded);
  if (end === start) fail("expected a mapping key");
  return plainKey(start, end);
}

/**
 * `&name <key>` as a flow mapping key (`{ &e e: f }`). Bypasses `parseFlowKey`'s
 * ordinary dispatch (which returns an already-canonicalized string) because the
 * anchor must register the RAW node, matching `plainKey`'s reasoning above; the
 * quoted-scalar sub-cases call the leaf parsers directly (never through
 * `parseFlowValue`) for the same reason `parseBlockNode`'s equivalent branch
 * does, so `registerPendingAnchor` is applied explicitly here rather than
 * inherited "for free" from a container's own self-registration. A tag may
 * follow the anchor (`{ &e !!str e: f }`); at most one of each.
 */
function parseFlowKeyAnchored(): string {
  pos++; // past '&'
  const name = scanAnchorOrAliasName();
  skipFlowWs();
  let c = src.charCodeAt(pos);
  if (c === AMP) fail("a node may carry at most one anchor");
  let tag: string | null = null;
  if (c === EXCLAIM) {
    tag = scanTag();
    checkTagSeparator(true);
    skipFlowWs();
    c = src.charCodeAt(pos);
    if (c === EXCLAIM) fail("a node may carry at most one tag");
    if (c === AMP) fail("a node may carry at most one anchor");
  }
  if (c === STAR) fail("an alias node cannot carry an anchor property");
  const outerPending = pendingAnchorName;
  pendingAnchorName = name;
  let key: string;
  if (tag !== null) {
    const raw = parseTaggedFlowKeyRaw(tag, c);
    if (pendingAnchorName === name) registerAnchor(name, raw);
    key = internKey(keyToString(raw));
  } else if (c === DQUOTE) key = internKey(keyToString(registerPendingAnchor(parseDoubleQuoted())));
  else if (c === SQUOTE) key = internKey(keyToString(registerPendingAnchor(parseSingleQuoted())));
  else {
    const start = pos;
    const end = scanFlowPlainEnd();
    if (flowFolded !== null) key = internKey(keyToString(registerPendingAnchor(flowFolded)));
    else {
      if (end === start) fail("expected a mapping key");
      key = plainKey(start, end); // plainKey itself calls registerPendingAnchor
    }
  }
  pendingAnchorName = outerPending;
  return key;
}

/**
 * `!tag <key>` as a flow mapping key (`{ !!str e: f }`). An anchor may follow
 * the tag (the other order is `parseFlowKeyAnchored` above).
 */
function parseFlowKeyTagged(): string {
  const tag = scanTag();
  checkTagSeparator(true);
  skipFlowWs();
  let c = src.charCodeAt(pos);
  if (c === EXCLAIM) fail("a node may carry at most one tag");
  let anchorName: string | null = null;
  if (c === AMP) {
    pos++;
    anchorName = scanAnchorOrAliasName();
    skipFlowWs();
    c = src.charCodeAt(pos);
    if (c === AMP) fail("a node may carry at most one anchor");
    if (c === EXCLAIM) fail("a node may carry at most one tag");
  }
  if (c === STAR) fail("an alias node cannot carry a tag/anchor property");
  const touched = anchorName !== null;
  const outerPending = pendingAnchorName;
  if (touched) pendingAnchorName = anchorName;
  const raw = parseTaggedFlowKeyRaw(tag, c);
  if (touched) {
    if (pendingAnchorName === anchorName) registerAnchor(anchorName!, raw);
    pendingAnchorName = outerPending;
  }
  return internKey(keyToString(raw));
}

/** The RAW (pre-`keyToString`) tag-applied value of a flow key, given the already-peeked current char `c`. */
function parseTaggedFlowKeyRaw(tag: string, c: number): unknown {
  if (c === DQUOTE) return applyScalarTag(tag, parseDoubleQuoted());
  if (c === SQUOTE) return applyScalarTag(tag, parseSingleQuoted());
  if (c === LBRACE) return applyCollectionTag(tag, parseFlowMap(), "map");
  if (c === LBRACKET) return applyCollectionTag(tag, parseFlowSeq(), "seq");
  const start = pos;
  const end = scanFlowPlainEnd();
  return applyScalarTag(tag, flowFolded !== null ? flowFolded : src.slice(start, end));
}

/** Return the cached copy of `s` if seen this parse, else record and return it. */
function internKey(s: string): string {
  const hit = keyCache.get(s);
  if (hit !== undefined) return hit;
  keyCache.set(s, s);
  return s;
}

/**
 * Value-intern hook at the string-scalar materialisation sites (see `valueCache`
 * for the off=`null` / on=dedup design and `MAX_VALUE_CACHE` for the cap). Past
 * the cap it stops inserting and returns `s` uncached — still correct.
 */
function internValue(s: string): string {
  const vc = valueCache;
  if (vc === null) return s;
  const hit = vc.get(s);
  if (hit !== undefined) return hit;
  if (vc.size < MAX_VALUE_CACHE) vc.set(s, s);
  return s;
}

/**
 * FastKeyMatch (M7) — flow context. Try to recognise the upcoming flow mapping
 * key as the previous sibling's canonical key `ek` WITHOUT slicing/hashing.
 * Only the hot shape is fast-pathed: a double-quoted JSON key `"…"`. `c` is the
 * already-read char at `pos`. On a full byte match + closing quote it advances
 * `pos` past the close quote and returns `true` (caller reuses `ek`); on ANY
 * mismatch it returns `false` and leaves `pos` untouched for the slow
 * `parseFlowKey`. The byte-for-byte compare against the *canonical* string
 * inherently excludes escapes and folds (a `\`/newline in the source can't
 * equal the decoded key), so the closing-quote check guarantees the slow path
 * would have produced exactly `ek` — and skipping `parseDoubleQuoted` is safe
 * for the `nextBackslash`/`nextNewline` memos precisely because the matched
 * span is provably escape- and break-free.
 */
function fastMatchFlowKey(c: number, ek: string): boolean {
  if (c !== DQUOTE) return false;
  const n = ek.length;
  const q = pos + 1;
  let i = 0;
  while (i < n && src.charCodeAt(q + i) === ek.charCodeAt(i)) i++;
  if (i !== n || src.charCodeAt(q + n) !== DQUOTE) return false;
  pos = q + n + 1;
  return true;
}

/**
 * FastKeyMatch (M7) — block context. Try to recognise the upcoming block
 * mapping key as the previous sibling's canonical key `ek` without slicing,
 * typing, or hashing. Only a bare plain key is fast-pathed; a key that opens a
 * flow collection, a quote, or an anchor/alias/tag is canonicalised differently
 * (flow padding, escape decoding, `!!`-typing) and must fall through to
 * `parseBlockMapKey`. On a full byte match followed by a `:` + space/EOL
 * terminator it leaves `pos` AT the `:` (parseBlockMapKey's contract) and
 * returns `true`; otherwise `pos` is untouched. Self-validating like the flow
 * variant: a byte-equal plain span with a `: ` terminator resolves through
 * `resolvePlain` to exactly `ek` (numbers/bools/`~` that RE-type would differ
 * in source bytes and so never match here).
 */
function fastMatchBlockKey(ek: string): boolean {
  const n = ek.length;
  if (n === 0) return false;
  const c0 = src.charCodeAt(pos);
  if (c0 === LBRACKET || c0 === LBRACE || c0 === DQUOTE || c0 === SQUOTE || c0 === AMP || c0 === STAR || c0 === EXCLAIM) return false;
  let i = 0;
  while (i < n && src.charCodeAt(pos + i) === ek.charCodeAt(i)) i++;
  if (i !== n) return false;
  if (src.charCodeAt(pos + n) !== COLON || !isSpaceOrEolAt(pos + n + 1)) return false;
  pos += n; // leave pos at the ':' separator
  return true;
}

/**
 * Compute the key list a just-finished mapping publishes to `lastRecordKeys`
 * for its next sibling (see `lastRecordKeys`). `matched` means every key so far
 * equalled the previous sibling's, so `produced` is still the shared `expected`
 * array: reuse it verbatim when the shapes are identical (`kc === length`, the
 * homogeneous-record hot path — zero allocation), otherwise this map is a
 * strict prefix and needs its own trimmed copy. On divergence (`!matched`)
 * `produced` is already this map's private array.
 */
function publishRecordKeys(expected: string[] | null, produced: string[] | null, matched: boolean, kc: number): string[] | null {
  if (!matched) return produced;
  if (kc === 0) return null; // empty map, or a first sibling with no keys
  if (expected !== null && kc === expected.length) return expected; // identical shape → reuse
  return expected!.slice(0, kc); // matched a strict prefix of a longer sibling
}

// ---------------------------------------------------------------------------
// Plain scalars (flow context) — scan the span, then type it once.
// ---------------------------------------------------------------------------

/**
 * Scan ONE line of a flow-context plain scalar starting at `from`, returning the
 * position of its stop character (a flow indicator `,[]{}`, a line break, a `:`
 * separator, a ` #` comment, or end of input) WITHOUT trimming or advancing
 * `pos`. Shared by the first-line scan and each `foldFlowPlain` continuation.
 */
function scanFlowPlainLine(from: number): number {
  let p = from;
  // Hot loop: one flag-table lookup per char. Codes ≥ 256 read out of bounds as
  // `undefined`, and `(undefined & BIT) === 0` correctly says "not a stop char",
  // so non-ASCII needs no guard. Only stop-candidates pay the detailed check.
  while (p < len) {
    const c = src.charCodeAt(p);
    if ((CH[c] & F_PLAIN_STOP) !== 0) {
      if (c === COLON) {
        // A ':' ends the scalar only when followed by a separator.
        const nc = p + 1 < len ? src.charCodeAt(p + 1) : -1;
        if (nc === -1 || nc === SPACE || nc === TAB || nc === LF || nc === CR || (CH[nc] & F_FLOW_INDICATOR) !== 0) break;
      } else if (c === HASH) {
        if (p > from) {
          const prev = src.charCodeAt(p - 1);
          if (prev === SPACE || prev === TAB) break; // ` #` starts a comment
        }
      } else {
        break; // , [ ] { } LF CR always terminate
      }
    }
    p++;
  }
  return p;
}

/** Trim trailing spaces/tabs from the span [`from`, `end`), returning the new end. */
function trimTrailingWs(from: number, end: number): number {
  let e = end;
  while (e > from) {
    const w = src.charCodeAt(e - 1);
    if (w !== SPACE && w !== TAB) break;
    e--;
  }
  return e;
}

/**
 * Scan a flow-context plain scalar and return the exclusive end of its trimmed
 * FIRST line's content; advances `pos` to the terminator. When the scalar folds
 * across line breaks, the fully-folded text is stashed in `flowFolded` (see
 * `foldFlowPlain`) and callers use that instead of re-slicing. Resets
 * `flowFolded` up front, so a single-line scalar (the hot path) leaves it null.
 */
function scanFlowPlainEnd(): number {
  flowFolded = null;
  const start = pos;
  const p = scanFlowPlainLine(start);
  const e = trimTrailingWs(start, p);
  // Stopped at a line break → the scalar MAY fold onto following lines.
  if (p < len && (src.charCodeAt(p) === LF || src.charCodeAt(p) === CR)) {
    return foldFlowPlain(start, e, p);
  }
  pos = p;
  return e;
}

/**
 * Fold a multi-line flow plain scalar (cold). Given the first line's content
 * [`start`, `firstEnd`) and the position of the line break after it, walk the
 * following lines: a single break folds to a space, each additional (blank-line)
 * break to a newline, and per-line leading/trailing whitespace is stripped —
 * the flow analogue of `foldBlockPlainRemainder`, kept entirely inside the flow
 * scanner. Folding stops when the next content line begins with a flow
 * terminator (`,`/`]`/`}`), a comment, a `:` separator, EOF, or a col-0 document
 * marker (left for `skipFlowWs` to reject); in that "no more content" case the
 * scalar was single-line and `pos` is left at the original break, exactly as the
 * non-folding path would leave it. Returns the trimmed end of the last content
 * segment and, when at least one continuation folded, sets `flowFolded`.
 */
function foldFlowPlain(start: number, firstEnd: number, breakPos: number): number {
  let result = "";
  let folded = false;
  let lastEnd = firstEnd;
  let p = breakPos; // sits on a LF/CR
  for (;;) {
    // Consume the break run (blank lines + indentation), counting real breaks.
    let breaks = 0;
    let q = p;
    for (;;) {
      if (q >= len) break;
      const c = src.charCodeAt(q);
      if (c === LF) {
        q++;
        breaks++;
      } else if (c === CR) {
        q++;
        if (q < len && src.charCodeAt(q) === LF) q++;
        breaks++;
      } else if (c === SPACE || c === TAB) {
        q++;
      } else break;
    }
    // Decide whether the scalar continues on this line or ended on the prior one.
    let cont = q < len;
    if (cont) {
      const cc = src.charCodeAt(q);
      if (cc === COMMA || cc === RBRACKET || cc === RBRACE || cc === HASH) cont = false;
      else if (cc === COLON) {
        const nc = q + 1 < len ? src.charCodeAt(q + 1) : -1;
        if (nc === -1 || nc === SPACE || nc === TAB || nc === LF || nc === CR || (CH[nc] & F_FLOW_INDICATOR) !== 0) cont = false;
      } else if (cc === MINUS || cc === DOT) {
        // A col-0 `---`/`...` ends the (unterminated) flow scalar; `skipFlowWs`
        // reports the doc-marker-in-flow error once the caller resumes.
        const pc = src.charCodeAt(q - 1);
        if ((pc === LF || pc === CR) && looksLikeDocMarkerAt(q)) cont = false;
      }
    }
    if (!cont) {
      pos = p; // leave at the break, matching the single-line path
      break;
    }
    if (!folded) {
      result = src.slice(start, firstEnd);
      folded = true;
      flowSpanned = true;
    }
    result += breaks > 1 ? "\n".repeat(breaks - 1) : " ";
    const segStop = scanFlowPlainLine(q);
    const segEnd = trimTrailingWs(q, segStop);
    result += src.slice(q, segEnd);
    lastEnd = segEnd;
    if (segStop < len && (src.charCodeAt(segStop) === LF || src.charCodeAt(segStop) === CR)) {
      p = segStop; // another continuation may follow
      continue;
    }
    pos = segStop; // stopped at a real terminator on this line
    flowFolded = result;
    return segEnd;
  }
  if (folded) {
    flowFolded = result;
    return lastEnd;
  }
  return firstEnd;
}

function parseFlowPlain(): unknown {
  const start = pos;
  const end = scanFlowPlainEnd();
  if (flowFolded !== null) return flowFolded;
  if (end === start) fail("expected a value");
  return resolvePlain(start, end);
}

/**
 * Type a plain scalar span [start, end) per YAML 1.2 core schema, returning the
 * JS value. First-char dispatch, zero regex, zero intermediate strings: a
 * non-string scalar never allocates a string, a genuine string is one slice.
 */
function resolvePlain(start: number, end: number): unknown {
  if (start >= end) return null;
  const c0 = src.charCodeAt(start);
  // Number-starters first (dense in real data): digit, sign, or leading dot.
  if ((c0 >= ZERO && c0 <= NINE) || c0 === MINUS || c0 === PLUS || c0 === DOT) {
    const num = tryNumber(start, end);
    if (num !== NOT_NUMERIC) return num;
    return internValue(src.slice(start, end));
  }
  const L = end - start;
  switch (c0) {
    case TILDE:
      if (L === 1) return null;
      break;
    case 0x6e: // n → null
      if (L === 4 && src.charCodeAt(start + 1) === 0x75 && src.charCodeAt(start + 2) === 0x6c && src.charCodeAt(start + 3) === 0x6c) {
        return null;
      }
      break;
    case 0x4e: {
      // N → NULL | Null
      if (L === 4) {
        const b = src.charCodeAt(start + 1);
        const c = src.charCodeAt(start + 2);
        const d = src.charCodeAt(start + 3);
        if ((b === 0x55 && c === 0x4c && d === 0x4c) || (b === 0x75 && c === 0x6c && d === 0x6c)) return null;
      }
      break;
    }
    case 0x74: // t → true
      if (L === 4 && src.charCodeAt(start + 1) === 0x72 && src.charCodeAt(start + 2) === 0x75 && src.charCodeAt(start + 3) === 0x65) {
        return true;
      }
      break;
    case 0x54: {
      // T → TRUE | True
      if (L === 4) {
        const b = src.charCodeAt(start + 1);
        const c = src.charCodeAt(start + 2);
        const d = src.charCodeAt(start + 3);
        if ((b === 0x52 && c === 0x55 && d === 0x45) || (b === 0x72 && c === 0x75 && d === 0x65)) return true;
      }
      break;
    }
    case 0x66: // f → false
      if (
        L === 5 &&
        src.charCodeAt(start + 1) === 0x61 &&
        src.charCodeAt(start + 2) === 0x6c &&
        src.charCodeAt(start + 3) === 0x73 &&
        src.charCodeAt(start + 4) === 0x65
      ) {
        return false;
      }
      break;
    case 0x46: {
      // F → FALSE | False
      if (L === 5) {
        const b = src.charCodeAt(start + 1);
        const c = src.charCodeAt(start + 2);
        const d = src.charCodeAt(start + 3);
        const e = src.charCodeAt(start + 4);
        if ((b === 0x41 && c === 0x4c && d === 0x53 && e === 0x45) || (b === 0x61 && c === 0x6c && d === 0x73 && e === 0x65)) {
          return false;
        }
      }
      break;
    }
  }
  return internValue(src.slice(start, end));
}

// ---------------------------------------------------------------------------
// Numbers — 1.2 core schema (decimal/0o/0x ints, floats, .inf/.nan). Validates
// the whole span; returns NOT_NUMERIC so a non-number plain scalar stays a
// string. Small decimal integers accumulate as Smis (no string, no allocation).
// ---------------------------------------------------------------------------

/** Hex digit value, or -1 if `c` is not a hex digit. */
function hexDigit(c: number): number {
  if (c >= ZERO && c <= NINE) return c - ZERO;
  if (c >= 0x61 && c <= 0x66) return c - 0x57; // a-f
  if (c >= 0x41 && c <= 0x46) return c - 0x37; // A-F
  return -1;
}

/**
 * Whether position `p` is a valid end for a number in flow context. A bare
 * space/tab is only an end if what *follows* it is a delimiter/comment/colon
 * (else `123 456` would wrongly read as the number 123); a `:` ends the number
 * (making it a single-pair key) only when it is itself a separator colon.
 */
function numberBoundary(p: number): boolean {
  if (p >= len) return true;
  const c = src.charCodeAt(p);
  if (c === COMMA || c === RBRACKET || c === RBRACE || c === LF || c === CR) return true;
  if (c === SPACE || c === TAB) {
    let q = p + 1;
    while (q < len) {
      const w = src.charCodeAt(q);
      if (w === SPACE || w === TAB) {
        q++;
        continue;
      }
      break;
    }
    if (q >= len) return true;
    const nc = src.charCodeAt(q);
    return nc === COMMA || nc === RBRACKET || nc === RBRACE || nc === LF || nc === CR || nc === HASH || nc === COLON;
  }
  if (c === COLON) {
    const nc = p + 1 < len ? src.charCodeAt(p + 1) : -1;
    return nc === -1 || nc === SPACE || nc === TAB || nc === LF || nc === CR || (CH[nc] & F_FLOW_INDICATOR) !== 0;
  }
  return false;
}

/**
 * Flow number fast path: parse a number starting at `pos`, verifying it ends at
 * a flow boundary. On success advances `pos` and returns the value; on failure
 * returns NOT_NUMERIC with `pos` unchanged (the caller then treats the span as a
 * plain string). Small decimal integers accumulate as Smis — no string, no
 * allocation — the single-pass equivalent of the M1 number path.
 */
function tryFlowNumber(): number | typeof NOT_NUMERIC {
  const start = pos;
  let p = start;
  let c = src.charCodeAt(p);
  const neg = c === MINUS;
  const signed = neg || c === PLUS;
  if (signed) {
    p++;
    c = src.charCodeAt(p);
  }

  // Hex / octal are unsigned only.
  if (!signed && c === ZERO) {
    const n2 = src.charCodeAt(p + 1);
    if (n2 === 0x78) {
      // 0x…
      let q = p + 2;
      let v = 0;
      let any = false;
      while (q < len) {
        const d = hexDigit(src.charCodeAt(q));
        if (d < 0) break;
        v = v * 16 + d;
        q++;
        any = true;
      }
      if (any && numberBoundary(q)) {
        pos = q;
        return v;
      }
      return NOT_NUMERIC;
    }
    if (n2 === 0x6f) {
      // 0o…
      let q = p + 2;
      let v = 0;
      let any = false;
      while (q < len) {
        const ch = src.charCodeAt(q);
        if (ch < ZERO || ch > 0x37) break;
        v = v * 8 + (ch - ZERO);
        q++;
        any = true;
      }
      if (any && numberBoundary(q)) {
        pos = q;
        return v;
      }
      return NOT_NUMERIC;
    }
  }

  // .inf / .nan
  if (c === DOT) {
    const a = src.charCodeAt(p + 1);
    const b = src.charCodeAt(p + 2);
    const d = src.charCodeAt(p + 3);
    if (isInfWord(a, b, d) && numberBoundary(p + 4)) {
      pos = p + 4;
      return neg ? -Infinity : Infinity;
    }
    if (!signed && isNanWord(a, b, d) && numberBoundary(p + 4)) {
      pos = p + 4;
      return NaN;
    }
  }

  // Decimal integer / float.
  let v = 0;
  let nd = 0;
  while (p < len) {
    const d = src.charCodeAt(p) - ZERO;
    if (d < 0 || d > 9) break;
    v = v * 10 + d;
    nd++;
    p++;
  }
  let isFloat = false;
  if (src.charCodeAt(p) === DOT) {
    isFloat = true;
    p++;
    while (p < len) {
      const d = src.charCodeAt(p) - ZERO;
      if (d < 0 || d > 9) break;
      nd++;
      p++;
    }
  }
  if (nd === 0) return NOT_NUMERIC;
  const ec = src.charCodeAt(p);
  if (ec === LOWER_E || ec === UPPER_E) {
    isFloat = true;
    p++;
    const s = src.charCodeAt(p);
    if (s === PLUS || s === MINUS) p++;
    const expStart = p;
    while (p < len) {
      const d = src.charCodeAt(p) - ZERO;
      if (d < 0 || d > 9) break;
      p++;
    }
    if (p === expStart) return NOT_NUMERIC;
  }
  // Inline the hot terminator case (comma/close/EOL/EOF) to skip the call; only
  // the ambiguous space/colon cases fall through to the full boundary check.
  const bc = p < len ? src.charCodeAt(p) : -1;
  if (bc !== -1 && bc !== COMMA && bc !== RBRACKET && bc !== RBRACE && bc !== LF && bc !== CR && !numberBoundary(p)) {
    return NOT_NUMERIC;
  }
  pos = p;
  if (!isFloat && nd <= 15) return neg ? -v : v;
  return +src.slice(start, p);
}

function tryNumber(start: number, end: number): number | typeof NOT_NUMERIC {
  let p = start;
  let c = src.charCodeAt(p);
  const neg = c === MINUS;
  const signed = neg || c === PLUS;
  if (signed) {
    p++;
    if (p >= end) return NOT_NUMERIC;
    c = src.charCodeAt(p);
  }

  // Hex / octal are unsigned only (1.2 core: `0x…`, `0o…`).
  if (!signed && c === ZERO && p + 1 < end) {
    const n2 = src.charCodeAt(p + 1);
    if (n2 === 0x78) return hexValue(p + 2, end); // 0x
    if (n2 === 0x6f) return octalValue(p + 2, end); // 0o
  }

  // .inf / .nan (nan takes no sign).
  if (c === DOT && end - p === 4) {
    const a = src.charCodeAt(p + 1);
    const b = src.charCodeAt(p + 2);
    const d = src.charCodeAt(p + 3);
    if (isInfWord(a, b, d)) return neg ? -Infinity : Infinity;
    if (!signed && isNanWord(a, b, d)) return NaN;
  }

  // Decimal integer / float.
  let v = 0;
  let nd = 0;
  while (p < end) {
    const d = src.charCodeAt(p) - ZERO;
    if (d < 0 || d > 9) break;
    v = v * 10 + d;
    nd++;
    p++;
  }
  let isFloat = false;
  if (p < end && src.charCodeAt(p) === DOT) {
    isFloat = true;
    p++;
    while (p < end) {
      const d = src.charCodeAt(p) - ZERO;
      if (d < 0 || d > 9) break;
      nd++;
      p++;
    }
  }
  if (nd === 0) return NOT_NUMERIC; // ".", "..", ".e5", lone sign, "0x" with no digits
  if (p < end) {
    const e = src.charCodeAt(p);
    if (e === LOWER_E || e === UPPER_E) {
      isFloat = true;
      p++;
      if (p < end) {
        const s = src.charCodeAt(p);
        if (s === PLUS || s === MINUS) p++;
      }
      const expStart = p;
      while (p < end) {
        const d = src.charCodeAt(p) - ZERO;
        if (d < 0 || d > 9) break;
        p++;
      }
      if (p === expStart) return NOT_NUMERIC; // "1e", "1e+"
    }
  }
  if (p !== end) return NOT_NUMERIC; // trailing junk: "1.2.3", "123abc", "0b1"
  if (!isFloat && nd <= 15) return neg ? -v : v; // exact small decimal integer → Smi
  return +src.slice(start, end); // float or > 15-digit integer → Number() (rounds like JSON.parse)
}

function hexValue(p: number, end: number): number | typeof NOT_NUMERIC {
  if (p >= end) return NOT_NUMERIC;
  let v = 0;
  while (p < end) {
    const c = src.charCodeAt(p);
    let d: number;
    if (c >= ZERO && c <= NINE) d = c - ZERO;
    else if (c >= 0x61 && c <= 0x66) d = c - 0x57; // a-f
    else if (c >= 0x41 && c <= 0x46) d = c - 0x37; // A-F
    else return NOT_NUMERIC;
    v = v * 16 + d;
    p++;
  }
  return v;
}

function octalValue(p: number, end: number): number | typeof NOT_NUMERIC {
  if (p >= end) return NOT_NUMERIC;
  let v = 0;
  while (p < end) {
    const c = src.charCodeAt(p);
    if (c < ZERO || c > 0x37) return NOT_NUMERIC; // not 0-7
    v = v * 8 + (c - ZERO);
    p++;
  }
  return v;
}

function isInfWord(a: number, b: number, d: number): boolean {
  // .inf | .Inf | .INF
  return (a === 0x69 && b === 0x6e && d === 0x66) || (a === 0x49 && b === 0x6e && d === 0x66) || (a === 0x49 && b === 0x4e && d === 0x46);
}

function isNanWord(a: number, b: number, d: number): boolean {
  // .nan | .NaN | .NAN
  return (a === 0x6e && b === 0x61 && d === 0x6e) || (a === 0x4e && b === 0x61 && d === 0x4e) || (a === 0x4e && b === 0x41 && d === 0x4e);
}

// ---------------------------------------------------------------------------
// Double-quoted scalar — indexOf hop fast path, out-of-line escape decode.
// ---------------------------------------------------------------------------

/**
 * Out-parameter for `foldFlowBreak` (module-level to keep the fold allocation-
 * free, matching `plainStoppedAtColon`'s established out-param style): the number
 * of line breaks the last fold consumed. A single break folds to one space; each
 * *additional* break (a blank line) contributes a preserved newline.
 */
let foldedBreaks = 0;

/**
 * YAML flow line folding, shared by the double/single-quoted slow paths. Call
 * with `i` at the first line-break character; consumes the whole break run and
 * the continuation line's leading whitespace, returns the index of the first
 * continuation-content character (or the closing quote), and reports the break
 * count via `foldedBreaks`. Trailing whitespace of the preceding line is trimmed
 * by the caller (which owns the pending-segment start). Leading whitespace on
 * every continuation line — the flow line prefix, spaces AND tabs — is stripped
 * here (never content; escaped whitespace, which IS content, is handled by the
 * caller's escape decoder before this ever runs).
 */
function foldFlowBreak(i: number): number {
  let breaks = 0;
  for (;;) {
    if (src.charCodeAt(i) === CR) {
      i++;
      if (i < len && src.charCodeAt(i) === LF) i++;
    } else {
      i++; // LF
    }
    breaks++;
    // `i` is at a line start. A column-0 `---`/`...` document marker interrupts
    // the scalar — it is NOT foldable content, so the quote is unterminated
    // (yaml-test-suite 5TRB / RXY3). An INDENTED `---` is ordinary content.
    if (looksLikeDocMarkerAt(i)) fail("unterminated quoted string: a document marker interrupts it");
    const ls = i; // col-0 offset of this continuation line
    while (i < len && (src.charCodeAt(i) === SPACE || src.charCodeAt(i) === TAB)) i++;
    if (i >= len) fail("unterminated quoted string");
    const cc = src.charCodeAt(i);
    if (cc !== LF && cc !== CR) {
      // A quoted scalar nested in a block context must keep its continuation
      // lines indented deeper than the enclosing block node (yaml-test-suite
      // QB6E); at the document root (floor -1) col 0 is legal.
      if (flowIndentFloor >= 0 && i - ls <= flowIndentFloor) {
        pos = i;
        fail("insufficient indentation for a multi-line quoted scalar");
      }
      break; // a content line (or the closing quote)
    }
  }
  foldedBreaks = breaks;
  quotedMultiline = true; // a real folded break was consumed → the scalar is multi-line
  return i;
}

function parseDoubleQuoted(): string {
  quotedMultiline = false;
  const start = pos + 1;
  const e = src.indexOf('"', start);
  if (e === -1) fail("unterminated double-quoted string");
  // Advance the backslash memo only when the cursor has passed it (see the
  // `nextBackslash` note): one `indexOf` amortized over a backslash-free run.
  if (nextBackslash < start) {
    const b = src.indexOf("\\", start);
    nextBackslash = b === -1 ? len : b;
  }
  if (nextBackslash > e) {
    // No escape before the closing quote. A line break inside still triggers
    // multi-line flow folding, so check for one (memoized like `nextBackslash`);
    // absent both, the value is a single slice — the ~100% case on JSON-shaped
    // input and why the hop path beats native.
    if (nextNewline < start) {
      const n = src.indexOf("\n", start);
      nextNewline = n === -1 ? len : n;
    }
    if (nextNewline > e) {
      pos = e + 1;
      return internValue(src.slice(start, e));
    }
  }
  return parseDoubleQuotedSlow(start);
}

/**
 * Cold path: the string contains at least one escape, so the first `indexOf('"')`
 * may have landed on an escaped quote. Walk it, copying spans between escapes and
 * decoding each escape. JSON escape set for now; YAML's extra escapes and
 * line-folding land in a later milestone.
 */
function parseDoubleQuotedSlow(start: number): string {
  let result = "";
  let seg = start;
  let i = start;
  for (;;) {
    if (i >= len) fail("unterminated double-quoted string");
    const c = src.charCodeAt(i);
    if (c === DQUOTE) {
      result += src.slice(seg, i);
      pos = i + 1;
      return result;
    }
    if (c === BACKSLASH) {
      if (i > seg) result += src.slice(seg, i);
      i++; // past backslash
      if (i >= len) fail("unterminated escape sequence");
      const ec = src.charCodeAt(i);
      switch (ec) {
        case DQUOTE:
          result += '"';
          i++;
          break;
        case BACKSLASH:
          result += "\\";
          i++;
          break;
        case 0x2f: // /
          result += "/";
          i++;
          break;
        case 0x30: // \0 → NUL
          result += "\0";
          i++;
          break;
        case 0x61: // \a → bell
          result += "\x07";
          i++;
          break;
        case 0x62: // \b
          result += "\b";
          i++;
          break;
        case 0x65: // \e → escape
          result += "\x1b";
          i++;
          break;
        case 0x66: // \f
          result += "\f";
          i++;
          break;
        case 0x6e: // \n
          result += "\n";
          i++;
          break;
        case 0x72: // \r
          result += "\r";
          i++;
          break;
        case 0x74: // \t
          result += "\t";
          i++;
          break;
        case 0x76: // \v → vertical tab
          result += "\v";
          i++;
          break;
        case SPACE: // "\ " → space
          result += " ";
          i++;
          break;
        case TAB: // "\<TAB>" → tab (an escaped whitespace char is literal content)
          result += "\t";
          i++;
          break;
        case 0x4e: // \N → next line (U+0085)
          result += "\x85";
          i++;
          break;
        case 0x5f: // \_ → non-breaking space (U+00A0)
          result += "\xa0";
          i++;
          break;
        case 0x4c: // \L → line separator (U+2028)
          result += "\u2028";
          i++;
          break;
        case 0x50: // \P → paragraph separator (U+2029)
          result += "\u2029";
          i++;
          break;
        case 0x78: // \xNN
          result += String.fromCharCode(readHex(i + 1, 2));
          i += 3;
          break;
        case 0x75: // \uNNNN
          result += String.fromCharCode(readHex(i + 1, 4));
          i += 5;
          break;
        case 0x55: // \UNNNNNNNN (may be astral → surrogate pair)
          result += String.fromCodePoint(readHex(i + 1, 8));
          i += 9;
          break;
        case LF: // escaped line break → line continuation (elide it)
          i++;
          while (i < len && (src.charCodeAt(i) === SPACE || src.charCodeAt(i) === TAB)) i++;
          break;
        case CR:
          i++;
          if (i < len && src.charCodeAt(i) === LF) i++;
          while (i < len && (src.charCodeAt(i) === SPACE || src.charCodeAt(i) === TAB)) i++;
          break;
        default:
          fail("invalid escape sequence in double-quoted string");
      }
      seg = i;
      continue;
    }
    if (c === LF || c === CR) {
      // Multi-line flow folding. Trim trailing whitespace of the current line
      // from the pending segment (escaped whitespace already lives in `result`,
      // so it is protected), fold the break run, and resume at the continuation
      // content (its leading whitespace stripped by `foldFlowBreak`).
      let j = i;
      while (j > seg && (src.charCodeAt(j - 1) === SPACE || src.charCodeAt(j - 1) === TAB)) j--;
      result += src.slice(seg, j);
      i = foldFlowBreak(i);
      result += foldedBreaks === 1 ? " " : "\n".repeat(foldedBreaks - 1);
      seg = i;
      continue;
    }
    i++;
  }
}

/**
 * Read `n` hex digits at `i` and return their value. Multiplication (not a
 * 32-bit shift) keeps the 8-digit `\U` case exact for astral code points.
 */
function readHex(i: number, n: number): number {
  if (i + n > len) fail("truncated \\x/\\u/\\U escape");
  let v = 0;
  for (let k = 0; k < n; k++) v = v * 16 + hexVal(src.charCodeAt(i + k));
  return v;
}

function hexVal(c: number): number {
  if (c >= ZERO && c <= NINE) return c - ZERO;
  if (c >= 0x61 && c <= 0x66) return c - 0x57; // a-f
  if (c >= 0x41 && c <= 0x46) return c - 0x37; // A-F
  fail("invalid hex digit in \\u escape");
}

// ---------------------------------------------------------------------------
// Single-quoted scalar — indexOf hop; `''` is an escaped quote. (Single-line
// for now; multi-line single-quoted folding is a later milestone.)
// ---------------------------------------------------------------------------

function parseSingleQuoted(): string {
  quotedMultiline = false;
  const start = pos + 1;
  const e = src.indexOf("'", start);
  if (e === -1) fail("unterminated single-quoted string");
  if (e + 1 < len && src.charCodeAt(e + 1) === SQUOTE) {
    return parseSingleQuotedSlow(start); // contains a '' escape
  }
  // A line break inside triggers multi-line flow folding — divert to the slow
  // path (memoized newline check, like the double-quoted fast path).
  if (nextNewline < start) {
    const n = src.indexOf("\n", start);
    nextNewline = n === -1 ? len : n;
  }
  if (nextNewline < e) return parseSingleQuotedSlow(start);
  pos = e + 1;
  return internValue(src.slice(start, e));
}

function parseSingleQuotedSlow(start: number): string {
  let result = "";
  let seg = start;
  let i = start;
  for (;;) {
    if (i >= len) fail("unterminated single-quoted string");
    const c = src.charCodeAt(i);
    if (c === SQUOTE) {
      if (i + 1 < len && src.charCodeAt(i + 1) === SQUOTE) {
        result += src.slice(seg, i) + "'"; // '' → '
        i += 2;
        seg = i;
        continue;
      }
      result += src.slice(seg, i);
      pos = i + 1;
      return result;
    }
    if (c === LF || c === CR) {
      // Multi-line flow folding — identical to the double-quoted path (single
      // quotes have no escapes, so all whitespace here is raw source text).
      let j = i;
      while (j > seg && (src.charCodeAt(j - 1) === SPACE || src.charCodeAt(j - 1) === TAB)) j--;
      result += src.slice(seg, j);
      i = foldFlowBreak(i);
      result += foldedBreaks === 1 ? " " : "\n".repeat(foldedBreaks - 1);
      seg = i;
      continue;
    }
    i++;
  }
}

// ===========================================================================
// Block structure (M3) — indentation-driven maps/sequences, implicit keys,
// compact forms. A node's column is `pos - lineStart`; a block collection owns
// every following line whose indent is deeper than it. Flow collections and
// quoted/plain scalars appearing inline reuse the flow leaf parsers above.
// ===========================================================================

function isSpaceOrEolAt(i: number): boolean {
  if (i >= len) return true;
  const c = src.charCodeAt(i);
  return c === SPACE || c === TAB || c === LF || c === CR;
}

/** Whether a `---` or `...` document marker starts at position `i` (line start). */
function isDocMarkerAt(i: number): boolean {
  if (i !== lineStart) return false; // markers live at column 0
  const c = src.charCodeAt(i);
  if (c !== MINUS && c !== DOT) return false;
  return src.charCodeAt(i + 1) === c && src.charCodeAt(i + 2) === c && isSpaceOrEolAt(i + 3);
}

/**
 * Consume a `---` document-start marker at `pos` (caller already confirmed it
 * via `isDocMarkerAt`). Content on the same line (`--- foo`) becomes the
 * document's root node starting right there; a bare marker (`---`, `--- #c`,
 * `---\n`) advances to the following content line instead — the node begins
 * there, or the document is empty if none follows. Cold: once per document.
 *
 * Returns whether the node (if any) begins INLINE on the marker's own line —
 * the caller uses this to choose `ROOT_AFTER_INLINE_MARKER` only in that case
 * (a bare marker's node starts fresh on its own line, where block collections
 * are perfectly ordinary — the restriction is specifically "same line as
 * `---`", not "any document that had a `---`").
 */
function consumeDocStartMarker(): boolean {
  pos += 3;
  skipInlineSpaces();
  const c = pos < len ? src.charCodeAt(pos) : -1;
  if (c === -1 || c === LF || c === CR || c === HASH) {
    nextLine();
    return false;
  }
  return true;
}

/**
 * Consume a `...` document-end marker at `pos` (caller already confirmed it).
 * Only a comment may follow it on the same line (enforced the same way any
 * other line's trailing content is, via `nextLine`/`endLine`). Cold.
 */
function consumeDocEndMarker(): void {
  pos += 3;
  nextLine();
}

/** Skip spaces and tabs on the current line (not line breaks). */
function skipInlineSpaces(): void {
  while (pos < len) {
    const c = src.charCodeAt(pos);
    if (c === SPACE || c === TAB) pos++;
    else break;
  }
}

/**
 * Finish the current line: skip trailing spaces + an optional comment, then
 * consume the line break (updating `lineStart`). Leaves `pos` at the start of
 * the next line, or at `len` at EOF.
 */
function endLine(): void {
  skipInlineSpaces();
  if (pos < len && src.charCodeAt(pos) === HASH) {
    // A '#' begins a comment only at line start or after whitespace. A '#'
    // butting straight up against the preceding token (`"value"#c`, `]#c`) is
    // invalid — matching js-yaml/`yaml` (yaml-test-suite SU5Z/9JBA).
    if (pos > lineStart) {
      const prev = src.charCodeAt(pos - 1);
      if (prev !== SPACE && prev !== TAB) fail("a comment must be separated from other tokens by whitespace");
    }
    const nl = src.indexOf("\n", pos);
    pos = nl === -1 ? len : nl;
  }
  if (pos >= len) return;
  const c = src.charCodeAt(pos);
  if (c === LF) {
    pos++;
    lineStart = pos;
  } else if (c === CR) {
    pos++;
    if (pos < len && src.charCodeAt(pos) === LF) pos++;
    lineStart = pos;
  } else {
    fail("unexpected content at end of line");
  }
}

/**
 * From the start of a line, skip blank and comment-only lines and the leading
 * indentation, landing `pos` on the first content character (or at `len`). Tabs
 * in indentation are rejected. `lineStart` tracks each line's start so the
 * caller reads the content column as `pos - lineStart`.
 */
function skipBlankLines(): void {
  for (;;) {
    if (pos >= len) return;
    // Skip leading whitespace. Tabs are accepted as separation (matching the
    // oracle, which allows e.g. a tab before a top-level flow node); we do not
    // enforce YAML's "no tabs in block indentation" rule, since valid documents
    // never rely on it and the oracle is lenient here.
    while (pos < len) {
      const c = src.charCodeAt(pos);
      if (c === SPACE || c === TAB) pos++;
      else break;
    }
    if (pos >= len) return;
    const c = src.charCodeAt(pos);
    if (c === LF) {
      pos++;
      lineStart = pos;
      continue; // blank line
    }
    if (c === CR) {
      pos++;
      if (pos < len && src.charCodeAt(pos) === LF) pos++;
      lineStart = pos;
      continue; // blank line
    }
    if (c === HASH) {
      const nl = src.indexOf("\n", pos);
      pos = nl === -1 ? len : nl + 1;
      lineStart = pos;
      continue; // comment-only line
    }
    return; // content
  }
}

/** Advance to the first content character of the next content line. */
function nextLine(): void {
  endLine();
  skipBlankLines();
}

/**
 * Scan a block-context plain scalar. Unlike flow, `,[]{}` are ordinary
 * characters here; the scalar ends at a `:` separator (→ mapping key, sets
 * `plainStoppedAtColon`), a ` #` comment, or end of line. Returns the exclusive
 * end of the trimmed content; advances `pos` to the stop character.
 */
function scanBlockPlainEnd(): number {
  const start = pos;
  let p = pos;
  plainStoppedAtColon = false;
  while (p < len) {
    const c = src.charCodeAt(p);
    if (c === LF || c === CR) break;
    if (c === COLON) {
      const nc = p + 1 < len ? src.charCodeAt(p + 1) : -1;
      if (nc === -1 || nc === SPACE || nc === TAB || nc === LF || nc === CR) {
        plainStoppedAtColon = true;
        break;
      }
    } else if (c === HASH && p > start) {
      const prev = src.charCodeAt(p - 1);
      if (prev === SPACE || prev === TAB) break;
    }
    p++;
  }
  pos = p;
  let e = p;
  while (e > start) {
    const w = src.charCodeAt(e - 1);
    if (w !== SPACE && w !== TAB) break;
    e--;
  }
  return e;
}

/**
 * Sentinel `parentCol` passed to `parseBlockNode` for the root node of a
 * document whose `---` marker had content on the same line (`--- foo`). Per
 * spec, a block *collection* (mapping or sequence) cannot start there — only a
 * scalar or flow collection may (yaml-test-suite 9KBC/CXX2/RHX7 confirm this
 * against the oracle: `--- key: val` and `--- - a` both error, while
 * `--- foo`/`--- [a,b]`/`--- {a: b}` are fine). The three dispatch branches
 * below that would otherwise start a collection check for this sentinel and
 * `fail()` instead; it never propagates to recursive calls, since those always
 * pass a real column.
 */
const ROOT_AFTER_INLINE_MARKER = -2;

/**
 * Parse one block node at the current position (its column is `pos - lineStart`).
 * Dispatches sequence / mapping / scalar, and — for a flow or plain scalar that
 * turns out to be a mapping key (followed by `: `) — an implicit-key mapping.
 * `parentCol` is the indentation of the construct that introduced this node
 * (used only to bound multi-line plain-scalar continuations, and to gate the
 * `ROOT_AFTER_INLINE_MARKER` check above). Always advances to the start of the
 * next content line before returning.
 */
function parseBlockNode(parentCol: number, mapValue = false): unknown {
  // Consumed here (not left for the branches below) so a property's influence
  // is scoped to exactly the ONE dispatch that immediately follows it, never
  // leaking into deeper recursion — see `afterInlineProperty`/`colOverride`'s
  // doc comments.
  const inlineProp = afterInlineProperty;
  afterInlineProperty = false;
  // Same scoping as `afterInlineProperty`: capture-and-clear so a block-collection
  // start is forbidden only for THIS dispatch (an inline mapping value), never
  // leaking into the nested nodes this call goes on to parse.
  const noBlockColl = inlineMapValue;
  inlineMapValue = false;
  const col = colOverride >= 0 ? colOverride : pos - lineStart;
  colOverride = -1;
  const c = src.charCodeAt(pos);

  if (c === AMP) return parseAnchoredBlockNode(parentCol, mapValue);
  if (c === EXCLAIM) return parseTaggedBlockNode(parentCol, col, mapValue);

  if (c === MINUS && isSpaceOrEolAt(pos + 1)) {
    if (parentCol === ROOT_AFTER_INLINE_MARKER) fail("a block sequence cannot start on the same line as a '---' document start");
    if (inlineProp) fail("a block sequence cannot start on the same line as a node property (anchor)");
    if (noBlockColl) fail("a block sequence cannot start on the same line as a mapping key");
    return parseBlockSeq(col);
  }

  // Block scalars (M4). A plain scalar can never begin with `|`/`>`, so this is
  // unambiguous. Unlike block collections, an inline `|`/`>` right after a `---`
  // document-start marker (or a node property) on the SAME line is legal
  // (`--- |` / `&a |`) — neither ROOT_AFTER_INLINE_MARKER nor `inlineProp` is
  // checked here, since only block *collections* are restricted.
  if (c === PIPE || c === GT) {
    return registerPendingAnchor(parseBlockScalar(parentCol));
  }

  // Explicit block mapping keys (`? key` / `: value`, spec 8.17). Like `-`
  // above, `?` unambiguously opens a NEW block mapping right here — never a
  // retroactive re-read of an already-parsed scalar the way an IMPLICIT key
  // is (that ambiguity is what the whole rest of this function exists to
  // resolve; `?` has none). Same three restrictions as the seq branch above,
  // for the same reason, calibrated against the oracle: a node property may
  // decorate the KEY itself (`? &a k`, dispatched from INSIDE
  // `parseBlockMapExplicit` below), but never precede `?` — `&a ? k: v` /
  // `!!map ? k: v` both error ("Anchors and tags must be after the ?
  // indicator"), exactly like `&a - x` errors for sequences.
  if (c === QUESTION && isSpaceOrEolAt(pos + 1)) {
    if (parentCol === ROOT_AFTER_INLINE_MARKER) fail("a block mapping cannot start on the same line as a '---' document start");
    if (inlineProp) fail("a block mapping cannot start on the same line as a node property (anchor)");
    if (noBlockColl) fail("a nested block mapping cannot start on the same line as a mapping key");
    return parseBlockMapExplicit(col);
  }

  if (c === LBRACKET || c === LBRACE || c === DQUOTE || c === SQUOTE || c === STAR) {
    // A flow collection, quoted scalar, or alias — either the node itself, or a
    // mapping key if a `: ` separator follows on the same line. `[`/`{` already
    // self-register (or not) via `parseFlowValue`'s own container allocation,
    // regardless of `inlineProp` — flow collections have no line-based
    // same-line/deferred distinction to make. An alias can never carry a
    // property (rejected earlier in `parseAnchoredBlockNode`/
    // `parseAnchoredFlowValue`), so it never needs `registerPendingAnchor`.
    flowSpanned = false; // armed for the flow-collection-as-key check below
    const savedFloor = flowIndentFloor;
    // A flow collection OR a multi-line quoted scalar must keep continuation
    // lines out-indented from the enclosing block node (9C9N/VJP3/QB6E). An
    // alias never spans lines, so it needs no floor.
    if (c === LBRACKET || c === LBRACE || c === DQUOTE || c === SQUOTE) flowIndentFloor = parentCol;
    const node = c === DQUOTE ? parseDoubleQuoted() : c === SQUOTE ? parseSingleQuoted() : c === STAR ? parseAlias() : registerPendingAnchor(parseFlowValue());
    flowIndentFloor = savedFloor;
    const save = pos;
    skipInlineSpaces();
    if (src.charCodeAt(pos) === COLON && isSpaceOrEolAt(pos + 1)) {
      if (parentCol === ROOT_AFTER_INLINE_MARKER) fail("a block mapping cannot start on the same line as a '---' document start");
      if (noBlockColl) fail("a nested block mapping cannot start on the same line as a mapping key");
      // A block implicit key must fit on one line — for a quoted scalar that
      // folded across a real break (yaml-test-suite 7LBH/D49Q/JKF3) OR a flow
      // collection that spanned lines (`[23\n]: 42` — yaml-test-suite C2SP).
      if ((c === DQUOTE || c === SQUOTE) && quotedMultiline) fail("a multi-line quoted scalar cannot be a block mapping key");
      if ((c === LBRACKET || c === LBRACE) && flowSpanned) fail("a multi-line flow collection cannot be a block mapping key");
      // Quoted scalar becomes a mapping key: only a SAME-LINE property may
      // claim it (see `afterInlineProperty`'s doc comment) — a DEFERRED one
      // is left pending for `parseBlockMap`'s own self-registration instead.
      return parseBlockMap(col, keyToString(inlineProp ? registerPendingAnchor(node) : node));
    }
    pos = save;
    nextLine();
    return registerPendingAnchor(node); // plain value: always claims (same-line or deferred)
  }

  // A plain scalar may not BEGIN with a reserved indicator: `%` (directive — in
  // node position a `%directive` line has no valid document footer before it),
  // `@`, or `` ` `` (reserved for future use). A column-0 `%` in directives
  // position is intercepted by `parseDirectives` before ever reaching here, so
  // any `%`/`@`/`` ` `` seen at a node's start is genuinely invalid (yaml-test-
  // suite MUS6/01, plus `foo: %x` / `--- @x`), matching the oracle.
  if (c === PERCENT || c === AT || c === BACKTICK) {
    fail("a plain scalar cannot start with a reserved indicator ('%', '@', or '`')");
  }

  // Plain scalar: the scan stops at a `: ` separator iff this line is a mapping.
  const start = pos;
  const end = scanBlockPlainEnd();
  if (plainStoppedAtColon) {
    if (parentCol === ROOT_AFTER_INLINE_MARKER) fail("a block mapping cannot start on the same line as a '---' document start");
    if (noBlockColl) fail("a nested block mapping cannot start on the same line as a mapping key");
    // Same same-line-vs-deferred rule as the quoted case just above, applied to
    // a plain-scalar key: `plainKey` itself calls `registerPendingAnchor`, so
    // bypass it (resolve without claiming) when the property was deferred.
    const key = inlineProp ? plainKey(start, end) : internKey(keyToString(resolvePlain(start, end)));
    return parseBlockMap(col, key);
  }
  return registerPendingAnchor(resolveBlockPlain(start, end, parentCol));
}

/**
 * `&name <node>` in block context (M5). An anchor may be alone on its line —
 * the node it decorates then begins on a SUBSEQUENT line, exactly like an
 * ordinary mapping/sequence value (`parseDeferredBlockNode` is shared with
 * `parseBlockValue` for this reason: same indentation rules, including the
 * "compact sequence at the parent's own column" special case — calibrated
 * against the oracle via yaml-test-suite SKE5). A block SEQUENCE indicator may
 * NOT start inline on the SAME line as the property, though (`afterInlineProperty`;
 * oracle: "Missing newline after block sequence props") — a block MAPPING may
 * (`&a key: v` is fine), so that restriction is scoped narrowly rather than
 * reusing `ROOT_AFTER_INLINE_MARKER`'s broader one. The SAME flag also decides
 * whether a resulting mapping's first KEY may claim this anchor for itself, as
 * opposed to the MAP claiming it (see `afterInlineProperty`'s doc comment).
 *
 * `pendingAnchorName` is saved/restored around the recursive call so a nested
 * anchor (e.g. on this node's own first mapping key, discovered only once that
 * key is resolved — yaml-test-suite 7BMT: `top: &node1\n  &k1 key1: v`) can
 * never clobber this one, which is still waiting for the eventual container.
 *
 * `colOverride` is set to THIS property's own column before the SAME-LINE
 * recursive call, so a resulting mapping/sequence uses it (not the deeper
 * column its first key/entry lands at after `"&name "` is skipped) — see
 * `colOverride`'s doc comment for the bug this fixes.
 *
 * A tag may follow the anchor (`&a !!str x` — the other legal order, `!!str
 * &a x`, is `parseTaggedBlockNode` below); at most one of each (STRICTNESS).
 * When a tag IS present, this hands off to the shared tagged-content dispatch
 * (`parseTaggedBlockContent`/`parseDeferredTaggedBlockNode`) instead of the
 * plain `parseBlockNode`/`parseDeferredBlockNode`, so the eventual scalar gets
 * the tag's forced typing instead of implicit typing.
 */
function parseAnchoredBlockNode(parentCol: number, mapValue: boolean): unknown {
  const anchorCol = pos - lineStart;
  pos++; // past '&'
  const name = scanAnchorOrAliasName();
  skipInlineSpaces();
  let c = pos < len ? src.charCodeAt(pos) : -1;
  if (c === AMP) fail("a node may carry at most one anchor");
  let tag: string | null = null;
  if (c === EXCLAIM) {
    tag = scanTag();
    checkTagSeparator(false);
    skipInlineSpaces();
    c = pos < len ? src.charCodeAt(pos) : -1;
    if (c === EXCLAIM) fail("a node may carry at most one tag");
    if (c === AMP) fail("a node may carry at most one anchor");
  }
  if (c === STAR) fail("an alias node cannot carry an anchor property");
  const outerPending = pendingAnchorName;
  pendingAnchorName = name;
  let node: unknown;
  if (c === -1 || c === LF || c === CR || c === HASH) {
    // The property occupies the rest of its line; the node (if any) begins on
    // a following line, subject to the ordinary value-continuation rules.
    nextLine();
    // If that node begins with its OWN anchor and then resolves to a scalar or
    // non-mapping collection, both anchors decorate the SAME node — illegal
    // (`top: &a\n  &b val` — yaml-test-suite 4JVG). The one exception is a block
    // MAPPING: there the inner anchor decorates the first KEY while ours
    // decorates the map, two distinct nodes (yaml-test-suite 7BMT), so a plain
    // object is left alone.
    const innerAnchor = pos < len && src.charCodeAt(pos) === AMP;
    const effParentCol = parentCol === ROOT_AFTER_INLINE_MARKER ? -1 : parentCol;
    node = tag !== null ? parseDeferredTaggedBlockNode(effParentCol, tag, mapValue) : parseDeferredBlockNode(effParentCol, mapValue);
    if (innerAnchor && pendingAnchorName === name && !isPlainMapping(node)) fail("a node can have at most one anchor");
  } else if (tag !== null) {
    if (c === MINUS && isSpaceOrEolAt(pos + 1)) {
      if (parentCol === ROOT_AFTER_INLINE_MARKER) fail("a block sequence cannot start on the same line as a '---' document start");
      fail("a block sequence cannot start on the same line as a node property (anchor)");
    }
    if (c === QUESTION && isSpaceOrEolAt(pos + 1)) {
      if (parentCol === ROOT_AFTER_INLINE_MARKER) fail("a block mapping cannot start on the same line as a '---' document start");
      fail("a block mapping cannot start on the same line as a node property (anchor)");
    }
    node = parseTaggedBlockContent(parentCol, anchorCol, tag, true);
  } else {
    afterInlineProperty = true; // consumed by the very next parseBlockNode dispatch
    colOverride = anchorCol;
    node = parseBlockNode(parentCol, mapValue);
  }
  if (pendingAnchorName === name) registerAnchor(name, node); // not yet consumed by a container/key
  pendingAnchorName = outerPending;
  return node;
}

/**
 * `!tag <node>` in block context (`pos` at `!`, `col` already computed by
 * `parseBlockNode`'s prologue — see its doc comment for why it must be passed
 * in rather than recomputed: `colOverride` is already cleared by the time
 * we're dispatched to). An anchor may follow the tag (the other order is
 * `parseAnchoredBlockNode` above). Note there is no `inlineProp` parameter
 * here (unlike `parseBlockNode`): a tag is ALWAYS itself "a node property
 * immediately preceding this dispatch" when this function runs at all, so the
 * "block sequence right after a property" check below is unconditional
 * rather than gated on an inherited flag.
 */
function parseTaggedBlockNode(parentCol: number, col: number, mapValue: boolean): unknown {
  const tag = scanTag();
  checkTagSeparator(false);
  skipInlineSpaces();
  let c = pos < len ? src.charCodeAt(pos) : -1;
  if (c === EXCLAIM) fail("a node may carry at most one tag");
  let anchorName: string | null = null;
  if (c === AMP) {
    pos++;
    anchorName = scanAnchorOrAliasName();
    skipInlineSpaces();
    c = pos < len ? src.charCodeAt(pos) : -1;
    if (c === AMP) fail("a node may carry at most one anchor");
    if (c === EXCLAIM) fail("a node may carry at most one tag");
  }
  if (c === STAR) fail("an alias node cannot carry a tag/anchor property");
  const touched = anchorName !== null;
  const outerPending = pendingAnchorName;
  if (touched) pendingAnchorName = anchorName;
  let node: unknown;
  if (c === -1 || c === LF || c === CR || c === HASH) {
    nextLine();
    const effParentCol = parentCol === ROOT_AFTER_INLINE_MARKER ? -1 : parentCol;
    node = parseDeferredTaggedBlockNode(effParentCol, tag, mapValue);
  } else {
    // Unlike the anchor-only case above, a tag is ALWAYS "a node property
    // immediately followed inline" at this point (we only reach this branch
    // when content follows the tag on the SAME line), so — unlike the
    // `inlineProp`-gated check elsewhere — this check is unconditional: a
    // block sequence may never start inline right after ITS OWN tag, matching
    // the identical rule for anchors (yaml-test-suite SY6V), calibrated
    // against the oracle.
    if (c === MINUS && isSpaceOrEolAt(pos + 1)) {
      if (parentCol === ROOT_AFTER_INLINE_MARKER) fail("a block sequence cannot start on the same line as a '---' document start");
      fail("a block sequence cannot start on the same line as a node property (tag)");
    }
    // Same rule, mapping side: a tag may never precede `?` inline either
    // (calibrated against the oracle: `!!map ? a: b` errors "Anchors and tags
    // must be after the ? indicator") — the tag instead decorates the KEY
    // itself when it comes AFTER `?` (`? !!str a`, `parseBlockMapKeyTagged`).
    if (c === QUESTION && isSpaceOrEolAt(pos + 1)) {
      if (parentCol === ROOT_AFTER_INLINE_MARKER) fail("a block mapping cannot start on the same line as a '---' document start");
      fail("a block mapping cannot start on the same line as a node property (tag)");
    }
    node = parseTaggedBlockContent(parentCol, col, tag, true);
  }
  if (touched) {
    if (pendingAnchorName === anchorName) registerAnchor(anchorName!, node);
    pendingAnchorName = outerPending;
  }
  return node;
}

/**
 * The value/node a DEFERRED tag decorates (the tag was alone on its line) —
 * the tagged sibling of `parseDeferredBlockNode`. An empty result (dedent/EOF
 * with nothing following) is a tagged EMPTY scalar, not `null` — e.g. `a:
 * !!str\nb: 2\n` → `{"a":"","b":2}`, calibrated against the oracle.
 *
 * If the deferred content ITSELF starts with a node property (`&`/`!` — e.g.
 * yaml-test-suite 9KAX: `&a4 !!map\n&a5 !!str key5: value4`, where the outer
 * `!!map` is deferred and the next line opens with its OWN, independent
 * anchor+tag decorating the eventual first KEY), that content is a complete
 * node in its own right with its own anchor/tag machinery — so we delegate to
 * the ordinary (untagged) `parseBlockNode`, which already resolves nested
 * properties/keys/typing correctly, and apply OUR tag by the resulting
 * value's runtime shape (`applyTagByRuntimeKind`) rather than trying to thread
 * "raw" text through an arbitrary chain of nested properties.
 */
function parseDeferredTaggedBlockNode(parentCol: number, tag: string, mapValue: boolean): unknown {
  if (pos >= len) return applyScalarTag(tag, "");
  const nc = pos - lineStart;
  if (nc > parentCol) {
    const c = src.charCodeAt(pos);
    if (c === AMP || c === EXCLAIM) return applyTagByRuntimeKind(tag, parseBlockNode(parentCol, mapValue));
    return parseTaggedBlockContent(parentCol, nc, tag, false);
  }
  // A block sequence at the SAME column is a valid (compact) value only under a
  // mapping key (`key:\n- a`); after a sequence dash it is a SIBLING entry, so
  // this tagged node is an empty scalar and the `-` is left for the parent seq.
  if (mapValue && nc === parentCol && src.charCodeAt(pos) === MINUS && isSpaceOrEolAt(pos + 1)) {
    return applyCollectionTag(tag, parseBlockSeq(nc), "seq");
  }
  return applyScalarTag(tag, "");
}

/**
 * Apply a tag to a value that has ALREADY been fully resolved (typed and/or
 * tagged) by nested, independent node-properties — used only by
 * `parseDeferredTaggedBlockNode`'s nested-property fallback above, a deep,
 * rare corner (properties split across separate deferred lines with more
 * properties of their own). We no longer have the node's raw source text, so
 * a scalar-forcing tag (`!!str`/non-specific) on a non-string result falls
 * back to `String(value)` — exact for plain integers/booleans, a documented,
 * pragmatic approximation rather than the fully general (and much costlier)
 * "thread raw text through arbitrarily-nested properties" machinery.
 */
function applyTagByRuntimeKind(tag: string, value: unknown): unknown {
  if (Array.isArray(value)) return applyCollectionTag(tag, value, "seq");
  if (value !== null && typeof value === "object" && !(value instanceof Uint8Array) && !(value instanceof Map) && !(value instanceof Set)) {
    return applyCollectionTag(tag, value, "map");
  }
  if (typeof value === "string") return applyScalarTag(tag, value);
  if (tag === TAG_STR || tag === NON_SPECIFIC_TAG) return String(value);
  if (tag === CORE_TAG_PREFIX || tag === TAG_MAP || tag === TAG_SEQ) return value; // unrecognized-shape passthrough
  if (tag === TAG_INT || tag === TAG_FLOAT || tag === TAG_BOOL || tag === TAG_NULL || tag === TAG_BINARY || tag === TAG_SET || tag === TAG_OMAP || tag === TAG_PAIRS) {
    fail(`the !!${tag.slice(CORE_TAG_PREFIX.length)} tag cannot apply to an already-resolved nested node`);
  }
  return value; // unrecognized (local/custom) tag: passthrough
}

/**
 * The node content a block tag decorates, once node-properties scanning is
 * done — shared by the same-line dispatch (`parseTaggedBlockNode`/
 * `parseAnchoredBlockNode`, `sameLine = true`) and the deferred dispatch
 * (`parseDeferredTaggedBlockNode`, `sameLine = false`) for the SAME reason
 * `parseBlockNode`'s own dispatch is reused both ways. `col` is the column a
 * resulting mapping/sequence uses (the tag's own column when inline, matching
 * the anchor precedent — see `colOverride`'s doc comment); `parentCol` bounds
 * block scalars and multi-line plain-scalar folding, same as everywhere else.
 * Collections apply the tag as kind-validation; quoted/plain scalars apply it
 * as forced typing over RAW content — never through `resolvePlain`.
 *
 * `sameLine` resolves the SAME ambiguity `afterInlineProperty` resolves for
 * anchors (see its doc comment): when the tagged node turns out to be a
 * mapping KEY, a SAME-LINE tag decorates the KEY itself (`!!str a: 1` →
 * `{"a":1}`, the tag is "used up" on "a"); a DEFERRED tag instead decorates
 * the MAP AS A WHOLE that the key turns out to open (`--- !!set\na: null\nb:
 * null\n` → a `Set`, not a per-key-tagged mapping) — so the key resolves via
 * ordinary implicit typing and `applyCollectionTag` wraps the finished map.
 */
function parseTaggedBlockContent(parentCol: number, col: number, tag: string, sameLine: boolean): unknown {
  const c = src.charCodeAt(pos);
  if (c === MINUS && isSpaceOrEolAt(pos + 1)) {
    return applyCollectionTag(tag, parseBlockSeq(col), "seq");
  }
  // Explicit-key mapping under a tag (`--- !!map\n? a\n: b\n`, yaml-test-suite
  // 35KP): like the seq case just above, this is only ever reached with
  // `sameLine === false` — the same-line callers (`parseTaggedBlockNode`/
  // `parseAnchoredBlockNode`'s tag branch) already `fail()` before a `?` ever
  // gets here, mirroring their identical MINUS check. The tag always decorates
  // the finished MAP as a whole (never "used up" on the key), same as a
  // deferred tag over an implicit-key map.
  if (c === QUESTION && isSpaceOrEolAt(pos + 1)) {
    return applyCollectionTag(tag, parseBlockMapExplicit(col), "map");
  }
  if (c === PIPE || c === GT) {
    return applyScalarTag(tag, parseBlockScalar(parentCol));
  }
  if (c === LBRACKET || c === LBRACE || c === DQUOTE || c === SQUOTE || c === STAR) {
    // A flow collection, quoted scalar, or alias — either the tagged node
    // itself, or (like the untagged `parseBlockNode`'s identical branch) a
    // mapping key if a `: ` separator follows on the same line. The tag is
    // NOT applied until we know which: a SAME-LINE tag decorates the KEY
    // (`registerPendingAnchor` also consumes any co-occurring pending anchor
    // onto the key HERE, before `parseBlockMap`'s own self-registration would
    // otherwise wrongly claim the whole map for it — yaml-test-suite HMQ5); a
    // DEFERRED tag decorates the finished MAP as a whole instead (matching
    // the plain-scalar-key branch below and `afterInlineProperty`'s
    // established anchor precedent).
    if (c === STAR) fail("an alias node cannot carry a tag property");
    let raw: unknown;
    let kind: "map" | "seq" | "scalar";
    if (c === DQUOTE) {
      raw = parseDoubleQuoted();
      kind = "scalar";
    } else if (c === SQUOTE) {
      raw = parseSingleQuoted();
      kind = "scalar";
    } else if (c === LBRACE) {
      raw = parseFlowMap();
      kind = "map";
    } else {
      raw = parseFlowSeq();
      kind = "seq";
    }
    const save = pos;
    skipInlineSpaces();
    if (src.charCodeAt(pos) === COLON && isSpaceOrEolAt(pos + 1)) {
      if (parentCol === ROOT_AFTER_INLINE_MARKER) fail("a block mapping cannot start on the same line as a '---' document start");
      if (sameLine) {
        const keyRaw = kind === "scalar" ? applyScalarTag(tag, raw as string) : applyCollectionTag(tag, raw, kind);
        return parseBlockMap(col, keyToString(registerPendingAnchor(keyRaw)));
      }
      return applyCollectionTag(tag, parseBlockMap(col, internKey(keyToString(raw))), "map");
    }
    pos = save;
    nextLine();
    return kind === "scalar" ? applyScalarTag(tag, raw as string) : applyCollectionTag(tag, raw, kind);
  }
  const start = pos;
  const end = scanBlockPlainEnd();
  if (plainStoppedAtColon) {
    if (parentCol === ROOT_AFTER_INLINE_MARKER) fail("a block mapping cannot start on the same line as a '---' document start");
    if (sameLine) return parseBlockMap(col, keyToString(registerPendingAnchor(applyScalarTag(tag, src.slice(start, end)))));
    return applyCollectionTag(tag, parseBlockMap(col, internKey(keyToString(resolvePlain(start, end)))), "map");
  }
  return applyScalarTag(tag, resolveBlockPlainRaw(start, end, parentCol));
}

/**
 * Resolve a block plain scalar, folding any continuation lines into it (YAML
 * plain multi-line: line breaks become single spaces). Continuation lines are
 * those indented deeper than `parentCol` — the indentation of the key or dash
 * that introduced the scalar, not the scalar's own (possibly inline) column.
 * Advances to the next content line.
 */
function resolveBlockPlain(start: number, end: number, parentCol: number): unknown {
  const breaks = advanceCountingBreaks();
  // A col-0 `---`/`...` always ends the node, even at the document root where
  // `parentCol` (-1, or -2 for ROOT_AFTER_INLINE_MARKER) can never itself be
  // "dedented past" by the `<=` check below — this is the one point doc 07 §4
  // calls out where block-plain scanning must special-case the marker. For any
  // nested scalar (parentCol >= 0) the dedent check alone already catches a
  // col-0 marker, so `isDocMarkerAt` short-circuits away and is never called.
  if (plainStoppedAtComment || pos >= len || pos - lineStart <= parentCol || isDocMarkerAt(pos)) {
    // Single-line plain scalar (the overwhelming case): one span, typed once.
    return resolvePlain(start, end);
  }
  // Multi-line plain scalar (cold): fold the segments (see `foldBlockPlainRemainder`).
  return foldBlockPlainRemainder(src.slice(start, end), breaks, parentCol);
}

/**
 * Tag-aware sibling of `resolveBlockPlain`: an explicit tag overrides implicit
 * typing entirely, so the single-line case returns the RAW span (`src.slice`,
 * no `resolvePlain`) instead — the caller (`parseTaggedBlockContent`) applies
 * the tag's own forced typing. Multi-line folding is identical either way (a
 * multi-line plain scalar is always textual), so the loop itself is shared via
 * `foldBlockPlainRemainder`.
 */
function resolveBlockPlainRaw(start: number, end: number, parentCol: number): string {
  const breaks = advanceCountingBreaks();
  if (plainStoppedAtComment || pos >= len || pos - lineStart <= parentCol || isDocMarkerAt(pos)) {
    return src.slice(start, end);
  }
  return foldBlockPlainRemainder(src.slice(start, end), breaks, parentCol);
}

/**
 * The (cold) multi-line plain-scalar folding loop shared by `resolveBlockPlain`
 * and `resolveBlockPlainRaw`: YAML line-break folding — a single break between
 * content lines becomes a space; each *additional* break (a blank line) is
 * preserved as a newline. `first` is the already-scanned first line's text;
 * `breaks` is the break count already consumed after it.
 */
function foldBlockPlainRemainder(first: string, breaks: number, parentCol: number): string {
  let result = first;
  for (;;) {
    result += breaks > 1 ? "\n".repeat(breaks - 1) : " ";
    const segStart = pos;
    const segEnd = scanBlockPlainEnd();
    result += src.slice(segStart, segEnd);
    if (plainStoppedAtColon) fail("mapping value not allowed in a multi-line plain scalar");
    breaks = advanceCountingBreaks();
    if (plainStoppedAtComment || pos >= len || pos - lineStart <= parentCol || isDocMarkerAt(pos)) break;
  }
  return result;
}

/**
 * Advance from the current line to the next content line, returning the number
 * of line breaks consumed (1 = adjacent lines, N = with N-1 blank lines between).
 * Like `nextLine` but reports the break count so plain-scalar folding can turn a
 * single break into a space and blank lines into newlines. Sets `lineStart`.
 */
function advanceCountingBreaks(): number {
  plainStoppedAtComment = false;
  skipInlineSpaces();
  if (pos < len && src.charCodeAt(pos) === HASH) {
    // A trailing comment on the plain scalar's content line ends the scalar.
    plainStoppedAtComment = true;
    const nl = src.indexOf("\n", pos);
    pos = nl === -1 ? len : nl;
  }
  let breaks = 0;
  for (;;) {
    if (pos >= len) return breaks;
    const c = src.charCodeAt(pos);
    if (c === LF) {
      pos++;
      lineStart = pos;
      breaks++;
    } else if (c === CR) {
      pos++;
      if (pos < len && src.charCodeAt(pos) === LF) pos++;
      lineStart = pos;
      breaks++;
    } else {
      let p = pos;
      while (p < len && (src.charCodeAt(p) === SPACE || src.charCodeAt(p) === TAB)) p++;
      if (p >= len) {
        pos = p;
        return breaks;
      }
      const ch = src.charCodeAt(p);
      if (ch === LF || ch === CR) {
        pos = p;
        continue; // blank line — the loop consumes its break next
      }
      if (ch === HASH) {
        // A comment-only line ends the plain scalar too — it cannot fold past it.
        plainStoppedAtComment = true;
        const nl = src.indexOf("\n", p);
        pos = nl === -1 ? len : nl + 1;
        lineStart = pos;
        continue; // comment-only line
      }
      pos = p; // content
      return breaks;
    }
  }
}

function parseBlockSeq(col: number): unknown[] {
  if (++depth > MAX_DEPTH) fail("maximum nesting depth exceeded");
  const arr: unknown[] = [];
  registerPendingAnchor(arr); // before children, so `&a\n- *a\n` self-references correctly
  for (;;) {
    pos++; // past '-'
    // A tab in the inline separation after '-' that indents a NEW block
    // collection is a tab-in-indentation error (`-\t-`, `- \t-` — yaml-test-
    // suite Y79Y/004-005), the sequence analogue of the '?'/':' tab checks in
    // parseBlockMapExplicit/parseExplicitValue. Peek the separation once for a
    // tab and whether real content follows inline (a deferred value, or an
    // inline scalar like `-\tfoo`, is exempt — only an inline collection).
    let sp = pos;
    let sawTab = false;
    while (sp < len) {
      const w = src.charCodeAt(sp);
      if (w === SPACE) sp++;
      else if (w === TAB) {
        sawTab = true;
        sp++;
      } else break;
    }
    const inlineTab = sawTab && sp < len && src.charCodeAt(sp) !== LF && src.charCodeAt(sp) !== CR && src.charCodeAt(sp) !== HASH;
    const value = parseBlockValue(col, false); // a seq entry's value: same-col `-` is a sibling
    if (inlineTab && isTabRestrictedCollection(value)) fail("a tab cannot indent a block sequence entry that opens a new collection");
    arr.push(value);
    if (pos >= len) break;
    if (pos - lineStart !== col) break;
    if (!(src.charCodeAt(pos) === MINUS && isSpaceOrEolAt(pos + 1))) break;
    // A continuation entry's indentation (cols 0..col-1) must be tab-free, the
    // sequence analogue of the block-mapping continuation guard (`a:\n  - 1\n \t- 2`).
    if (!SKIP_STRICT_VALIDATION) checkNoTabIndent(col - 1);
  }
  depth--;
  return arr;
}

/**
 * `col`'s mapping loop, shared by implicit (`key: value`) and explicit
 * (`? key` / `: value`) entries — never a separate map type (an explicit and
 * an implicit entry may freely mix within one mapping, e.g. yaml-test-suite
 * RR7F/ZWK4). `firstHasValue` distinguishes the two shapes an already-resolved
 * `firstKey` can be in when this is called: every OTHER caller (an implicit
 * key, `pos` sitting at its ':') passes the default `true`; `parseBlockMapExplicit`
 * passes `false` when its `?` entry had no `: value` at all (`? a` with
 * nothing following — the value is simply `null`, no ':' to consume).
 * `firstIsExplicit` selects which VALUE grammar applies once a ':' IS present
 * — see `parseExplicitValue`'s doc comment for why explicit and implicit
 * values are not interchangeable (an inline compact sequence is legal after
 * an explicit ':' but not an implicit one, calibrated against both oracles).
 */
function parseBlockMap(col: number, firstKey: string, firstHasValue = true, firstIsExplicit = false): Record<string, unknown> {
  if (++depth > MAX_DEPTH) fail("maximum nesting depth exceeded");
  const obj: Record<string, unknown> = {};
  registerPendingAnchor(obj); // before children (see parseFlowMap's identical call)
  let key = firstKey;
  let hasValue = firstHasValue;
  let isExplicit = firstIsExplicit;
  // FastKeyMatch (M7) — see parseFlowMap for the shared scheme. `firstKey` was
  // already parsed by the caller (block maps enter with their first key in
  // hand), so it is only RECORDED here, never byte-matched; the loop fast-paths
  // keys 2..N against the previous sibling's `expected` list.
  const expected = lastRecordKeys;
  let produced: string[] | null = expected;
  let matched = true;
  let kc = 0;
  for (;;) {
    // Record `key` (firstKey on the first turn, then each looped key) for the
    // next sibling, staying on the shared `expected` array until it diverges.
    if (matched && expected !== null && kc < expected.length && expected[kc] === key) {
      // identical so far — keep sharing `expected`
    } else {
      if (matched) {
        produced = expected === null ? [] : expected.slice(0, kc);
        matched = false;
      }
      produced!.push(key);
    }
    kc++;
    if (hasValue) {
      // pos is at the ':' separator for `key`.
      pos++; // past ':'
      storeKey(obj, key, isExplicit ? parseExplicitValue(col) : parseBlockValue(col, true)); // a map value: same-col `-` is a compact seq
    } else {
      storeKey(obj, key, null); // explicit key with no ': value' at all
    }
    if (pos >= len) break;
    const nc = pos - lineStart;
    // A col-0 document marker always ends the mapping — including when
    // `col === 0` too (a top-level mapping), where `nc < col` alone would NOT
    // catch it (0 is not < 0) and the loop would otherwise misread `---`/`...`
    // as an attempted next key (doc 07 §4's block-structure terminator check).
    // Guarded by `nc === 0` first so nested mappings (col > 0, the common
    // case) never pay the `isDocMarkerAt` call — they already dedent below.
    if (nc === 0 && isDocMarkerAt(pos)) break;
    if (nc < col) break; // dedent → mapping ends
    if (nc > col) fail("bad indentation in block mapping");
    if (src.charCodeAt(pos) === MINUS && isSpaceOrEolAt(pos + 1)) break; // sibling sequence, not our entry
    // A continuation key is unconditionally part of this block mapping, so its
    // full indentation (cols 0..col-1) must be tab-free — unlike a deferred
    // FIRST node, there is no scalar-fold escape here (`foo:\n  a: 1\n \tb: 2`).
    if (!SKIP_STRICT_VALIDATION) checkNoTabIndent(col - 1);
    if (src.charCodeAt(pos) === QUESTION && isSpaceOrEolAt(pos + 1)) {
      pos++; // past '?'
      key = internKey(keyToString(parseExplicitKey(col)));
      hasValue = explicitValueFollows(col);
      isExplicit = true;
    } else {
      const ek = matched && expected !== null && kc < expected.length && pendingAnchorName === null ? expected[kc] : null;
      key = ek !== null && fastMatchBlockKey(ek) ? ek : parseBlockMapKey();
      hasValue = true;
      isExplicit = false;
    }
  }
  lastRecordKeys = publishRecordKeys(expected, produced, matched, kc);
  depth--;
  return obj;
}

/**
 * Whether an explicit key's `: value` indicator immediately follows at the
 * SAME column as its `?` (spec 8.17's `l-block-map-explicit-value`, `s-
 * indent(n)` — an EXACT match, not merely "indented at least n"; calibrated
 * against both js-yaml and the oracle, which both reject a `:` at any other
 * column as "bad indentation", e.g. `? a\n  : 1\n`). Anything else — dedent,
 * over-indent, a sibling `?`/plain key at the same column, EOF — means this
 * entry's value is simply absent (`null`); the caller's ordinary dedent/
 * indentation checks (shared with implicit entries) take it from there.
 */
function explicitValueFollows(col: number): boolean {
  return pos < len && pos - lineStart === col && src.charCodeAt(pos) === COLON && isSpaceOrEolAt(pos + 1);
}

/**
 * `? key` / `: value` (spec 8.17), entered from `parseBlockNode`'s dispatch
 * with `pos` at `?` and `col` its column. The key (`parseExplicitKey`) and the
 * value (`parseExplicitValue`) are mirror halves of the SAME production
 * (`s-l+block-indented(n)`), so a key is "just a node" — anchors, tags, nested
 * collections, and multi-line plain folding all compose for free, which is the
 * entire reason the explicit form exists (an IMPLICIT key can't be multi-line
 * or a collection; this one can — yaml-test-suite JTV5/L94M/5WE3, including a
 * zero-indented compact sequence key `?\n- a\n- b` — 6PBE). A collection key
 * must still work as a JS object key: `keyToString` (via `stringifyKeyNode`,
 * cold) renders it into the SAME flow-style string the oracle's `.toJS()` uses
 * for a non-scalar map key.
 */
function parseBlockMapExplicit(col: number): Record<string, unknown> {
  pos++; // past '?'
  const key = internKey(keyToString(parseExplicitKey(col)));
  return parseBlockMap(col, key, explicitValueFollows(col), true);
}

/**
 * Whether `value` is a collection (array, plain object, or a `!!set`/`!!omap`
 * `Set`/`Map` — never a scalar; `Uint8Array` from `!!binary` is scalar
 * CONTENT, not a collection). Used only by the tab checks in
 * `parseBlockMapExplicit`/`parseExplicitValue`: real YAML disallows a bare
 * TAB as the separator immediately after `?`/explicit `:` when what follows
 * opens a NEW block collection at the column the tab reaches (that column
 * becomes a structural indentation reference other lines must align to —
 * spec 5.5, "tabs MUST NOT be used in indentation"), but tolerates it for an
 * ordinary scalar, whose own column is structurally meaningless (calibrated
 * against both oracles: `?\tsimple` parses fine; `?\t- x` / `?\tkey: 1` both
 * error on js-yaml AND `yaml` — yaml-test-suite Y79Y/006-009).
 */
function isTabRestrictedCollection(value: unknown): boolean {
  return Array.isArray(value) || (value !== null && typeof value === "object" && !(value instanceof Uint8Array));
}

/**
 * Whether `value` is a plain-object block/flow MAPPING (not an array, `!!set`/
 * `!!omap` Set/Map, `!!binary` Uint8Array, or scalar). Used by the two-anchor
 * check in `parseAnchoredBlockNode`: only a mapping can host an inner anchor on
 * its first KEY (distinct from an anchor on the map itself), so only a mapping
 * is exempt from "a node can have at most one anchor" (yaml-test-suite 4JVG vs 7BMT).
 */
function isPlainMapping(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Set) && !(value instanceof Map) && !(value instanceof Uint8Array);
}

/**
 * Reject a TAB used as block indentation: the current line's mandatory
 * indentation (columns 0..`parentCol`, which must be spaces so the node lands
 * deeper than its parent) may not contain a tab (`a:\n\tb:` — yaml-test-suite
 * 4EJS; also `foo:\n\t- x` / `foo:\n\tbar`). A tab BEYOND that region is
 * ordinary separation and is left alone (`foo:\n \tbar` is fine — the space at
 * column 0 already satisfies the indentation). Cold: only on a deferred block
 * node that is deeper than a real (>= 0) parent column.
 */
function checkNoTabIndent(parentCol: number): void {
  const limit = lineStart + parentCol + 1;
  for (let i = lineStart; i < limit && i < pos; i++) {
    if (src.charCodeAt(i) === TAB) {
      pos = i;
      fail("a tab character cannot be used as indentation");
    }
  }
}

/**
 * Reject a TAB anywhere in a deferred/root node's leading indentation
 * (`[wsStart, contentPos)`) — but only when that indentation positions a BLOCK
 * collection. `checkNoTabIndent` above catches only the mandatory
 * `0..parentCol` prefix (unconditionally, spaces or a plain-scalar fold alike);
 * a tab in the DEEPER columns that carry the child past its parent is illegal
 * (spec 6.1) solely when the child is a block map/seq — the identical bytes are
 * legitimate SEPARATION before a flow collection, quoted scalar, alias, or a
 * plain scalar that simply folds (`foo:\n \tbar` → `{foo: "bar"}` stays legal,
 * where `a:\n \tb: 1` / `a:\n \t- 1` / ` \ta: 1` must error — yaml-test-suite
 * 4EJS family, matching the oracle). Because a bare flow collection VALUE and a
 * flow-collection KEY both surface as the same JS array/object, the value type
 * alone can't tell them apart, so this also gates on the node's FIRST character:
 * a `[`/`{`/`"`/`'`/`*` start is left to fold as separation (the oracle accepts
 * `a:\n \t[1,2]` and even `*ref`-to-a-collection), while `&`/`!` properties are
 * NOT exempt (`a:\n \t&x b: 1` is a tab-indented block map and errors).
 */
function rejectBlockCollectionTabIndent(wsStart: number, contentPos: number, firstChar: number, value: unknown): void {
  if (!isTabRestrictedCollection(value)) return;
  if (firstChar === LBRACKET || firstChar === LBRACE || firstChar === DQUOTE || firstChar === SQUOTE || firstChar === STAR) return;
  for (let i = wsStart; i < contentPos; i++) {
    if (src.charCodeAt(i) === TAB) {
      pos = i;
      fail("a tab character cannot be used as indentation");
    }
  }
}

/**
 * The VALUE after an explicit key's `: ` (spec 8.17) — almost `parseBlockValue`,
 * except INLINE content is never restricted from opening a block sequence.
 * An ordinary IMPLICIT mapping value forbids that (`a: - x` errors on both
 * oracles — its grammar production, `c-l-block-map-implicit-value`, only
 * allows an ordinary node, never the compact-sequence alternative); an
 * explicit value's production is `s-l+block-indented`, the SAME one a
 * sequence entry's value uses, which explicitly permits a compact sequence
 * either inline right after the indicator (`: - one\n  - two`, yaml-test-
 * suite 5WE3/A2M4 — "Explicit compact") or deferred to a following line at
 * the SAME column (`:\n- one\n- two`, calibrated against the oracle — both
 * accept it, matching an ordinary deferred value's already-established
 * precedent, hence `mapValue=true` is passed to `parseDeferredBlockNode` here —
 * exactly as the mirror key side does in `parseExplicitKey`).
 */
function parseExplicitValue(col: number): unknown {
  const tabRightAfterIndicator = src.charCodeAt(pos) === TAB;
  skipInlineSpaces();
  const c = pos < len ? src.charCodeAt(pos) : -1;
  if (c === -1 || c === LF || c === CR || c === HASH) {
    nextLine();
    return parseDeferredBlockNode(col, true);
  }
  const value = parseBlockNode(col, false); // inline: NOT gated by the implicit-value inline-seq restriction
  if (tabRightAfterIndicator && isTabRestrictedCollection(value)) fail("a tab cannot separate ':' from a value that opens a new collection");
  return value;
}

/**
 * The KEY after a `?` indicator (spec 8.17) — the exact mirror of
 * `parseExplicitValue`. `c-l-block-map-explicit-key` shares one production with
 * its value counterpart (`s-l+block-indented(n)`), so a DEFERRED key accepts a
 * same-column ("zero-indented") compact sequence just as the value does
 * (`?\n- a\n- b` — yaml-test-suite 6PBE), hence `mapValue=true` to
 * `parseDeferredBlockNode`. INLINE key content stays `mapValue=false` so a
 * nested inline map is still a legal key (`? a: 1\n  b: 2`, which would set
 * `inlineMapValue` and wrongly reject under `true`); the tab-before-a-new-
 * collection restriction, like the value's, applies to that inline case only.
 * `pos` is already past the `?`.
 */
function parseExplicitKey(col: number): unknown {
  const tabRightAfterIndicator = src.charCodeAt(pos) === TAB;
  skipInlineSpaces();
  const c = pos < len ? src.charCodeAt(pos) : -1;
  if (c === -1 || c === LF || c === CR || c === HASH) {
    nextLine();
    return parseDeferredBlockNode(col, true);
  }
  const keyNode = parseBlockNode(col, false); // inline: NOT gated by inlineMapValue — a nested inline map is a legal key
  if (tabRightAfterIndicator && isTabRestrictedCollection(keyNode)) fail("a tab cannot separate '?' from a key that opens a new collection");
  return keyNode;
}

/** Parse the next key of a block mapping, leaving `pos` at the `:` separator. */
function parseBlockMapKey(): string {
  const c = src.charCodeAt(pos);
  if (c === AMP) return parseBlockMapKeyAnchored();
  if (c === EXCLAIM) return parseBlockMapKeyTagged();
  if (c === STAR) {
    const value = parseAlias();
    skipInlineSpaces();
    if (src.charCodeAt(pos) !== COLON || !isSpaceOrEolAt(pos + 1)) fail("expected ':' after mapping key");
    return internKey(keyToString(value));
  }
  if (c === DQUOTE || c === SQUOTE || c === LBRACKET || c === LBRACE) {
    const node = registerPendingAnchor(c === DQUOTE ? parseDoubleQuoted() : c === SQUOTE ? parseSingleQuoted() : parseFlowValue());
    if ((c === DQUOTE || c === SQUOTE) && quotedMultiline) fail("a multi-line quoted scalar cannot be a block mapping key");
    skipInlineSpaces();
    if (src.charCodeAt(pos) !== COLON || !isSpaceOrEolAt(pos + 1)) fail("expected ':' after mapping key");
    return internKey(keyToString(node));
  }
  const start = pos;
  const end = scanBlockPlainEnd();
  if (!plainStoppedAtColon) fail("expected ':' after mapping key");
  return plainKey(start, end);
}

/**
 * `&name <key>` as the 2nd+ key of an already-open block mapping (e.g. a
 * ZWK4-style `&anchor c: 3` entry). Mirrors `parseFlowKeyAnchored`: registers
 * the RAW key node, not yet canonicalized to a string. A tag may follow the
 * anchor (the other order is `parseBlockMapKeyTagged` below).
 */
function parseBlockMapKeyAnchored(): string {
  pos++; // past '&'
  const name = scanAnchorOrAliasName();
  skipInlineSpaces();
  let c = pos < len ? src.charCodeAt(pos) : -1;
  if (c === AMP) fail("a node may carry at most one anchor");
  let tag: string | null = null;
  if (c === EXCLAIM) {
    tag = scanTag();
    checkTagSeparator(false);
    skipInlineSpaces();
    c = pos < len ? src.charCodeAt(pos) : -1;
    if (c === EXCLAIM) fail("a node may carry at most one tag");
    if (c === AMP) fail("a node may carry at most one anchor");
  }
  if (c === STAR) fail("an alias node cannot carry an anchor property");
  const outerPending = pendingAnchorName;
  pendingAnchorName = name;
  let key: string;
  if (tag !== null) {
    const raw = parseTaggedBlockMapKeyRaw(tag, c);
    if (pendingAnchorName === name) registerAnchor(name, raw);
    key = internKey(keyToString(raw));
  } else {
    key = parseBlockMapKey(); // recurses into the quoted/flow/plain branches above
  }
  pendingAnchorName = outerPending;
  return key;
}

/**
 * `!tag <key>` as a block mapping key (`!!str a: 1`). An anchor may follow the
 * tag (the other order is `parseBlockMapKeyAnchored` above).
 */
function parseBlockMapKeyTagged(): string {
  const tag = scanTag();
  checkTagSeparator(false);
  skipInlineSpaces();
  let c = pos < len ? src.charCodeAt(pos) : -1;
  if (c === EXCLAIM) fail("a node may carry at most one tag");
  let anchorName: string | null = null;
  if (c === AMP) {
    pos++;
    anchorName = scanAnchorOrAliasName();
    skipInlineSpaces();
    c = pos < len ? src.charCodeAt(pos) : -1;
    if (c === AMP) fail("a node may carry at most one anchor");
    if (c === EXCLAIM) fail("a node may carry at most one tag");
  }
  if (c === STAR) fail("an alias node cannot carry a tag/anchor property");
  const touched = anchorName !== null;
  const outerPending = pendingAnchorName;
  if (touched) pendingAnchorName = anchorName;
  const raw = parseTaggedBlockMapKeyRaw(tag, c);
  if (touched) {
    if (pendingAnchorName === anchorName) registerAnchor(anchorName!, raw);
    pendingAnchorName = outerPending;
  }
  return internKey(keyToString(raw));
}

/** The RAW (pre-`keyToString`) tag-applied value of a block mapping key, given the already-peeked current char `c`. */
function parseTaggedBlockMapKeyRaw(tag: string, c: number): unknown {
  if (c === DQUOTE || c === SQUOTE || c === LBRACE || c === LBRACKET) {
    const raw =
      c === DQUOTE
        ? applyScalarTag(tag, parseDoubleQuoted())
        : c === SQUOTE
          ? applyScalarTag(tag, parseSingleQuoted())
          : applyCollectionTag(tag, parseFlowValue(), c === LBRACE ? "map" : "seq");
    skipInlineSpaces();
    if (src.charCodeAt(pos) !== COLON || !isSpaceOrEolAt(pos + 1)) fail("expected ':' after mapping key");
    return raw;
  }
  const start = pos;
  const end = scanBlockPlainEnd();
  if (!plainStoppedAtColon) fail("expected ':' after mapping key");
  return applyScalarTag(tag, src.slice(start, end));
}

/**
 * The value/node that follows a `:` (mapping) or `-` (sequence) when nothing
 * else remains on that line: either a deeper-indented block node on a
 * following line, a block SEQUENCE at the SAME column as `parentCol` (the
 * `key:\n- a\n- b` compact form — legal for sequences only, never mappings),
 * or `null` (dedent/EOF — an empty value). Shared by `parseBlockValue` (after
 * an ordinary `:`/`-`) and `parseAnchoredBlockNode` (after a property alone on
 * its line) — both need identical indentation semantics.
 */
function parseDeferredBlockNode(parentCol: number, mapValue: boolean): unknown {
  if (pos >= len) return null;
  const nc = pos - lineStart;
  if (nc > parentCol) {
    if (parentCol >= 0) checkNoTabIndent(parentCol);
    // Scan only the DEEPER columns for the collection guard: `checkNoTabIndent`
    // already cleared cols 0..parentCol (a root node, parentCol < 0, has none).
    const wsStart = parentCol >= 0 ? lineStart + parentCol + 1 : lineStart;
    const contentPos = pos;
    const firstChar = src.charCodeAt(pos);
    const node = parseBlockNode(parentCol, mapValue);
    if (!SKIP_STRICT_VALIDATION) rejectBlockCollectionTabIndent(wsStart, contentPos, firstChar, node);
    return node;
  }
  // A same-column block sequence is this node's (compact) value only under a
  // mapping key; after a sequence dash it is a SIBLING, so an empty entry here
  // resolves to null and the `-` is left for the parent `parseBlockSeq` loop
  // (yaml-test-suite FH7J and the `-\n- x` shape — `[null, "x"]`, not `[["x"]]`).
  if (mapValue && nc === parentCol && src.charCodeAt(pos) === MINUS && isSpaceOrEolAt(pos + 1)) {
    return parseBlockSeq(nc);
  }
  return null;
}

/**
 * The document's root node (`parentCol` = -1). It never flows through
 * `parseDeferredBlockNode`, so its leading indentation is unchecked — a tab that
 * positions a root-level block collection (` \ta: 1`, `\t- 1`) would otherwise
 * slip through. Apply the same value-gated tab guard here.
 */
function parseRootBlockNode(): unknown {
  const wsStart = lineStart;
  const contentPos = pos;
  const firstChar = src.charCodeAt(pos);
  const node = parseBlockNode(-1);
  if (!SKIP_STRICT_VALIDATION) rejectBlockCollectionTabIndent(wsStart, contentPos, firstChar, node);
  return node;
}

/**
 * Parse the value after a `:` (mapping) or `-` (sequence). An inline value is a
 * block node starting on the same line (this is how compact `- key: v` and
 * `key: [flow]` work); otherwise the value is a deeper-indented block node on the
 * following lines, or null. Always advances to the next content line.
 */
function parseBlockValue(parentCol: number, mapValue: boolean): unknown {
  skipInlineSpaces();
  const c = pos < len ? src.charCodeAt(pos) : -1;
  if (c === -1 || c === LF || c === CR || c === HASH) {
    nextLine();
    return parseDeferredBlockNode(parentCol, mapValue);
  }
  // An inline mapping value may not itself begin a block collection (a scalar or
  // flow collection is fine). A sequence entry's inline value is exempt — compact
  // `- key: v` mappings are legal — so this is gated on `mapValue`.
  if (mapValue) inlineMapValue = true;
  return parseBlockNode(parentCol, mapValue); // inline / compact node at the current column
}

// ===========================================================================
// Block scalars (M4) — literal `|` and folded `>`, with chomping (`-`/`+`/clip)
// and explicit indentation indicators. Deliberately self-contained: unlike
// every other block construct, `#` inside the BODY is ordinary text (not a
// comment — yaml-test-suite DK3J relies on this), so the line-scanning loop
// below never treats `#` as a comment INSIDE the content-indent region; the
// one exception is a `#` found BELOW it (i.e. genuinely outside the scalar),
// which — like a real dedent — ends the scalar (confirmed against the oracle:
// it does not "resume" even if a later line dips back to full indentation).
// `skipBlankLines` (shared with the rest of block structure, `#`-aware) is
// called exactly once, after the scalar ends, to skip any such trailing
// comment/blank lines for the caller — the same cleanup every other
// block-value parser performs before handing control back.
//
// Algorithm (doc 07 §3.5): parse the header, then two passes over the body —
// `detectBlockScalarIndent` (only when no explicit indent digit was given) is
// a non-consuming lookahead that finds the content indentation from the first
// non-blank line; the main loop in `parseBlockScalar` then walks the body for
// real, `indexOf('\n')` per line, a charCode loop for the (short) indentation
// prefix, exactly one `src.slice` per content line, accumulated into `res` via
// `+=` (an append-only ConsString rope, flattened once on return — see the
// dumper's `out` doc comment below for why that's O(n) here, not O(n²)).
// ===========================================================================

/**
 * Whether a `---`/`...` document marker starts at line-start position `p`, for
 * use during `detectBlockScalarIndent`'s lookahead — which walks a LOCAL cursor
 * that intentionally never touches the module-level `lineStart`, so the
 * lineStart-equality gate in `isDocMarkerAt` cannot be reused here (`p` is
 * already known to be a line-start position by construction of the caller's
 * loop, so that gate would just be redundant even if it were usable).
 */
function looksLikeDocMarkerAt(p: number): boolean {
  const c = src.charCodeAt(p);
  if (c !== MINUS && c !== DOT) return false;
  return src.charCodeAt(p + 1) === c && src.charCodeAt(p + 2) === c && isSpaceOrEolAt(p + 3);
}

/**
 * Auto-detect a block scalar's content indentation level (no explicit digit in
 * the header): a non-consuming lookahead from the current `pos` that finds the
 * first line with real (non-whitespace) content and returns ITS indentation,
 * provided it is deeper than `effParentCol` (the enclosing construct's column).
 * Leading all-blank lines are skipped (their indentation doesn't set the
 * level) but tracked: per the spec, it is an error for any of them to be MORE
 * indented than the eventual content line (yaml-test-suite 5LLU/S98Z/W9L4) —
 * checked once the real content line is found, not while merely blank lines are
 * seen (a leading blank's own tab, if any, is deliberately NOT flagged here;
 * that error instead falls out naturally when the main loop below re-walks the
 * same line against the now-known indentation — see its tab check). If no
 * content line is ever found (a wholly empty/blank scalar), the level falls
 * back to the widest blank line seen (or `effParentCol + 1` if none), per spec
 * §8.1.1.1 — just wide enough that every blank line still reads as blank.
 */
function detectBlockScalarIndent(effParentCol: number): number {
  let p = pos;
  let maxBlankIndent = -1;
  for (;;) {
    if (p >= len || looksLikeDocMarkerAt(p)) {
      return maxBlankIndent > effParentCol ? maxBlankIndent : effParentCol + 1;
    }
    let sp = 0;
    let q = p;
    while (q < len && src.charCodeAt(q) === SPACE) {
      sp++;
      q++;
    }
    // Walk through any further run of spaces/tabs to see whether the line is
    // genuinely blank (nothing but whitespace before EOL) — a tab here is just
    // whitespace for this purely-informational lookahead; it is not the point
    // where an actual tab-in-indentation error is raised (see the docstring).
    let r = q;
    while (r < len) {
      const rc = src.charCodeAt(r);
      if (rc === LF || rc === CR) break;
      if (rc !== SPACE && rc !== TAB) break;
      r++;
    }
    const stop = r < len ? src.charCodeAt(r) : -1;
    if (stop === -1 || stop === LF || stop === CR) {
      // Blank line: track its (space-only) indentation, then move to the next.
      if (sp > maxBlankIndent) maxBlankIndent = sp;
      if (stop === LF) p = r + 1;
      else if (stop === CR) p = r + 1 < len && src.charCodeAt(r + 1) === LF ? r + 2 : r + 1;
      else p = len;
      continue;
    }
    // Real content. If it isn't deeper than the parent, the scalar has no
    // content at all (this line belongs to whatever encloses the scalar).
    if (sp <= effParentCol) {
      return maxBlankIndent > effParentCol ? maxBlankIndent : effParentCol + 1;
    }
    if (maxBlankIndent > sp) {
      fail("a block scalar's leading empty lines must not be more indented than its first line of content");
    }
    return sp;
  }
}

/**
 * Hoisted so `parseBlockScalar`'s body loop can reuse one string for the
 * single-break case instead of allocating a fresh `"\n".repeat(1)` on every
 * adjacent-line append — by far the most common line boundary in real content.
 */
const NL = "\n";

/**
 * Parse a literal (`|`) or folded (`>`) block scalar starting at `pos` (the
 * indicator character) and return its string value. `parentCol` is the same
 * "enclosing construct's column" every other block-node caller already threads
 * through (the dash's or key's column — see `parseBlockNode`'s docstring); an
 * explicit indentation indicator is added to it, and auto-detected content must
 * be deeper than it. `ROOT_AFTER_INLINE_MARKER` (`--- |`) is normalized to -1
 * (the ordinary document-root parent column) — inline block scalars after
 * `---` are legal (unlike inline block collections, which that sentinel exists
 * to forbid), so from here on it behaves exactly like the plain doc-root case.
 */
function parseBlockScalar(parentCol: number): string {
  const folded = src.charCodeAt(pos) === GT;
  pos++; // past the indicator

  // --- header: optional indent digit (1-9) and chomp (-/+), either order ---
  let indentIndicator = 0; // 0 = auto-detect
  let chomp = 0; // 0 = clip (default), -1 = strip, +1 = keep
  for (let i = 0; i < 2; i++) {
    const c = pos < len ? src.charCodeAt(pos) : -1;
    if (c >= 0x31 && c <= 0x39 && indentIndicator === 0) {
      // '1'-'9' ('0' is not a valid indicator — rejected below as stray content)
      indentIndicator = c - ZERO;
      pos++;
    } else if (c === MINUS && chomp === 0) {
      chomp = -1;
      pos++;
    } else if (c === PLUS && chomp === 0) {
      chomp = 1;
      pos++;
    } else {
      break;
    }
  }
  // Trailing: separation space, then an optional comment (which — like any
  // YAML comment — must be preceded by whitespace) or end of line; anything
  // else is a malformed header (yaml-test-suite S4GJ/X4QW).
  let sawSpace = false;
  while (pos < len) {
    const c = src.charCodeAt(pos);
    if (c === SPACE || c === TAB) {
      pos++;
      sawSpace = true;
      continue;
    }
    break;
  }
  const afterHeader = pos < len ? src.charCodeAt(pos) : -1;
  if (afterHeader === HASH) {
    if (!sawSpace) fail("a comment after a block scalar header must be preceded by whitespace");
    const nl = src.indexOf("\n", pos);
    pos = nl === -1 ? len : nl;
  } else if (afterHeader !== -1 && afterHeader !== LF && afterHeader !== CR) {
    fail("invalid block scalar header (expected an indentation indicator, chomping indicator, comment, or end of line)");
  }
  if (pos < len) {
    const c = src.charCodeAt(pos);
    if (c === LF) pos++;
    else if (c === CR) {
      pos++;
      if (pos < len && src.charCodeAt(pos) === LF) pos++;
    }
  }
  lineStart = pos;

  const effParentCol = parentCol === ROOT_AFTER_INLINE_MARKER ? -1 : parentCol;
  const contentIndent = indentIndicator > 0 ? effParentCol + indentIndicator : detectBlockScalarIndent(effParentCol);

  // --- body: accumulate content-line text into `res`, a ConsString built via
  // `+=` (O(1) per append, flattened lazily on first read) rather than an
  // array pushed then joined ---
  let res = "";
  let sawContent = false;
  let prevMoreIndented = false;
  let pendingBreaks = 0; // blank lines since the last appended content line (0 = adjacent)

  for (;;) {
    if (pos >= len) break;
    if (isDocMarkerAt(pos)) break; // a document marker always ends the scalar

    // Consume up to `contentIndent` leading spaces (a tab here is always an
    // error — YAML forbids tab indentation — UNLESS it appears at/after the
    // established content indent, where it is just ordinary text; see below).
    let count = 0;
    let p = pos;
    while (count < contentIndent) {
      const c = p < len ? src.charCodeAt(p) : -1;
      if (c === SPACE) {
        count++;
        p++;
        continue;
      }
      if (c === TAB) fail("tab characters are not allowed in block scalar indentation");
      break;
    }

    if (count < contentIndent) {
      const c = p < len ? src.charCodeAt(p) : -1;
      if (c === -1 || c === LF || c === CR) {
        // A blank line, short of the required indent — still part of the
        // scalar (blank lines never need to satisfy the indent requirement).
        pendingBreaks++;
        if (c === LF) pos = p + 1;
        else if (c === CR) pos = p + 1 < len && src.charCodeAt(p + 1) === LF ? p + 2 : p + 1;
        else pos = len;
        lineStart = pos;
        continue;
      }
      // A real, less-indented line — including a comment-only one — ends the
      // scalar (dedent); it never "resumes" even if a later line dips back to
      // the content indent (confirmed against the oracle: a less-indented `#`
      // line followed by more full-indent content is a hard error, not more
      // scalar content). Leave `pos` at this line's own first content
      // character (not its line start) so the caller resumes exactly where
      // every other block construct expects.
      pos = p;
      break;
    }

    // count === contentIndent: `p` is just past the mandatory indent.
    const nl = src.indexOf("\n", p);
    const lineEnd = nl === -1 ? len : nl;
    let textEnd = lineEnd;
    if (textEnd > p && src.charCodeAt(textEnd - 1) === CR) textEnd--;
    const text = src.slice(p, textEnd); // the one slice per content line

    if (text.length === 0) {
      pendingBreaks++; // blank line (nothing beyond the mandatory indent)
    } else {
      // "More-indented": extra whitespace beyond contentIndent survived into
      // `text` verbatim — literal content, and (per spec) folded lines touching
      // it never fold to a space, only ever to literal newlines (doc 07 §3.5).
      const moreIndented = text.charCodeAt(0) === SPACE || text.charCodeAt(0) === TAB;
      if (!sawContent) {
        // No "previous line" to fold/break against — leading blanks (if any)
        // become that many literal newlines, never a space.
        if (pendingBreaks > 0) res += pendingBreaks === 1 ? NL : NL.repeat(pendingBreaks);
        res += text;
      } else if (!folded) {
        // Literal never folds: exactly one newline per line boundary, plus one
        // more per intervening blank line.
        res += pendingBreaks === 0 ? NL : NL.repeat(pendingBreaks + 1);
        res += text;
      } else {
        const moreInvolved = prevMoreIndented || moreIndented;
        if (pendingBreaks === 0 && !moreInvolved) {
          res += " ";
          res += text; // the one case that folds to a space
        } else if (moreInvolved) {
          // A more-indented line on either side of the break: never folds, and
          // the break "connecting" the two lines counts as one of its own — on
          // top of each intervening blank line (doc 07 §3.5's classic gotcha).
          res += pendingBreaks === 0 ? NL : NL.repeat(pendingBreaks + 1);
          res += text;
        } else {
          // Plain content on both sides, separated by 1+ blank lines: each
          // blank line becomes exactly one newline (no extra "connecting" one —
          // it's absorbed into the blank run, unlike the more-indented case).
          res += pendingBreaks === 1 ? NL : NL.repeat(pendingBreaks);
          res += text;
        }
      }
      sawContent = true;
      prevMoreIndented = moreIndented;
      pendingBreaks = 0;
    }
    pos = nl === -1 ? len : nl + 1;
    lineStart = pos;
  }

  // The scalar itself has ended (dedent, doc marker, or EOF); skip any
  // trailing blank/comment lines the same way every other block-value parser
  // leaves them for its caller (`nextLine`/`skipBlankLines` elsewhere) — a
  // no-op if a doc marker or real content is already sitting at `pos` (both
  // are non-blank, non-`#`, so `skipBlankLines` stops on them immediately).
  skipBlankLines();

  if (!sawContent) return chomp === 1 ? "\n".repeat(pendingBreaks) : "";
  if (chomp === -1) return res; // strip: no trailing break at all
  if (chomp === 1) return res + "\n".repeat(pendingBreaks + 1); // keep: every trailing break
  return res + "\n"; // clip (default): exactly one
}

// ===========================================================================
// Document structure (M5) — `%YAML`/`%TAG` directives and the `---`/`...`
// document loop that ties the whole parser together. Directives and markers
// are recognized ONLY here, at the document boundary — never by rescanning
// inside block-structure/scalar code (the one exception, the col-0 marker
// terminator, lives at its point of use above: `parseBlockMap`,
// `resolveBlockPlain`). This keeps the per-node hot path untouched; everything
// below runs at most once per document, never once per node.
// ===========================================================================

/**
 * Unconditionally jump to the start of the next line, ignoring any trailing
 * content on the current one. Directive lines with an unrecognized name keep
 * whatever garbage trails them per spec ("warn and ignore"); known directives
 * (`%YAML`/`%TAG`) validate their own argument shape *before* this runs, so by
 * the time it's called the line is already known-clean. Unlike `endLine`, this
 * never fails on stray content — that would wrongly reject ignored directives.
 */
function finishDirectiveLine(): void {
  const nl = src.indexOf("\n", pos);
  pos = nl === -1 ? len : nl + 1;
  lineStart = pos;
}

/**
 * Read one whitespace-delimited directive argument (a bare word — no quoting,
 * no escapes). Leaves `pos` at the terminating space/line-break/EOF. Caller
 * skips leading separation space first.
 */
function readDirectiveToken(): string {
  const start = pos;
  while (pos < len && !isSpaceOrEolAt(pos)) pos++;
  return src.slice(start, pos);
}

/** Whether `s` is a bare `MAJOR.MINOR` version token (digits only, one dot). */
function isYamlVersionToken(s: string): boolean {
  const n = s.length;
  let i = 0;
  let digits = 0;
  while (i < n && s.charCodeAt(i) >= ZERO && s.charCodeAt(i) <= NINE) {
    i++;
    digits++;
  }
  if (digits === 0 || i >= n || s.charCodeAt(i) !== DOT) return false;
  i++;
  digits = 0;
  while (i < n && s.charCodeAt(i) >= ZERO && s.charCodeAt(i) <= NINE) {
    i++;
    digits++;
  }
  return digits > 0 && i === n;
}

/**
 * `%YAML <version>` — validates the version. We stay YAML 1.2 core throughout
 * (doc 07 §0 scope) and don't branch on the declared *minor* version, per the
 * design recipe: a higher minor (e.g. `1.3`) is accepted, not rejected (the
 * directive's *shape* is validated — yaml-test-suite H7TQ/9MMA expect a
 * malformed or absent version, or trailing garbage after it, to error — not
 * its specific minor value). A higher *major*, however, MUST be rejected per
 * spec §6.8.1 ("should be rejected with an appropriate error message"); we
 * only ever produce YAML 1.x documents, so any other major is unsupported.
 */
function parseYamlDirectiveArgs(): void {
  skipInlineSpaces();
  const tok = readDirectiveToken();
  if (!isYamlVersionToken(tok)) fail("malformed %YAML directive: expected a MAJOR.MINOR version");
  const dot = tok.indexOf(".");
  const major = Number(tok.slice(0, dot));
  if (major !== 1) fail(`unsupported YAML major version: ${major}`);
  skipInlineSpaces();
  const c = pos < len ? src.charCodeAt(pos) : -1;
  if (c !== -1 && c !== LF && c !== CR && c !== HASH) {
    fail("%YAML directive should contain exactly one part");
  }
}

/**
 * `%TAG <handle> <prefix>` — stores the handle → prefix mapping in the
 * per-document `tagHandles` map (created lazily), for a later milestone to
 * resolve `!handle!suffix` tags against. Tags themselves are not implemented
 * yet; storing directives must not require them to be (design recipe). Per
 * spec §6.8.2 (Example 6.17), redefining the same handle within one document
 * is an error, not last-wins — checked before the map is populated.
 */
function parseTagDirectiveArgs(): void {
  skipInlineSpaces();
  const handle = readDirectiveToken();
  skipInlineSpaces();
  const prefix = readDirectiveToken();
  if (handle.length === 0 || handle.charCodeAt(0) !== 0x21 /* ! */ || prefix.length === 0) {
    fail("malformed %TAG directive: expected a handle and a prefix");
  }
  if (tagHandles === null) tagHandles = new Map();
  else if (tagHandles.has(handle)) fail(`duplicate %TAG directive for handle "${handle}"`);
  tagHandles.set(handle, prefix);
}

/**
 * Consume zero or more `%directive` lines at column 0 — the "directives
 * block" that may precede a document. Cold, out-of-line: called once per
 * document boundary (`parseNextDocument`), never from inside block/flow
 * scanning, so a `%` appearing mid-document (e.g. as plain-scalar continuation
 * text) is never misread as a directive (confirmed against the oracle: a
 * dangling `%YAML` with no following marker folds into the scalar instead of
 * erroring — yaml-test-suite XLQ9).
 *
 * Directives are per-document state (doc 07 §4) — `tagHandles` is reset
 * unconditionally on every call, never inherited from a previous document in
 * the same stream (yaml-test-suite QLJ7 relies on exactly this: a `%TAG`
 * before document 1 does not apply to documents 2/3).
 *
 * Returns whether at least one directive was seen: per spec, a non-empty
 * directives block MUST be followed by an explicit `---` — the caller
 * (`parseNextDocument`) enforces that.
 */
function parseDirectives(): boolean {
  tagHandles = null;
  anchorMap = null; // per-document, not per-stream (see anchorMap's doc comment)
  let sawAny = false;
  let sawYaml = false;
  while (pos < len && pos === lineStart && src.charCodeAt(pos) === PERCENT) {
    sawAny = true;
    pos++; // past '%'
    const nameStart = pos;
    while (pos < len && !isSpaceOrEolAt(pos)) pos++;
    const name = src.slice(nameStart, pos);
    if (name === "YAML") {
      if (sawYaml) fail("a document must not contain more than one %YAML directive");
      sawYaml = true;
      parseYamlDirectiveArgs();
    } else if (name === "TAG") {
      parseTagDirectiveArgs();
    } // else: unrecognized directive — ignored per spec ("warn and ignore")
    finishDirectiveLine();
    skipBlankLines(); // blank/comment lines between directives, or before the marker
  }
  return sawAny;
}

/**
 * Parse one document from the current stream position: an optional
 * directives block (which then requires an explicit `---`), an optional
 * `---`/`...` marker, the document's root node (or `null` for an empty
 * document), and a trailing `...` if present. Leaves `pos` positioned for the
 * next call: at a following marker, at genuine trailing content (the caller
 * decides how to report that), or at EOF. Shared by `parse` and `parseAll` so
 * every rule above is enforced identically for single- and multi-document use.
 */
function parseNextDocument(): unknown {
  skipBlankLines();
  if (pos >= len) return NO_DOCUMENT;

  const sawDirectives = parseDirectives();
  // A directives block may only open the stream or follow an explicit `...`
  // document-end marker — the SAME precondition as a bare document (`bareDocAllowed`).
  // A `%directive` immediately after a prior document's content, with no `...`
  // footer between, is an error (yaml-test-suite 9HCY / EB22 — "Need document
  // footer before directives").
  if (sawDirectives && !bareDocAllowed) {
    fail("a directives block must be preceded by an explicit '...' document end marker");
  }
  skipBlankLines();
  if (pos >= len) {
    if (sawDirectives) fail("a directives block must be terminated by an explicit '---' document start");
    return NO_DOCUMENT;
  }

  const marker = isDocMarkerAt(pos);
  const isDash = marker && src.charCodeAt(pos) === MINUS;
  if (sawDirectives && !isDash) {
    fail("a directives block must be terminated by an explicit '---' document start");
  }

  let value: unknown;
  if (isDash) {
    const inline = consumeDocStartMarker();
    // A bare '---' immediately followed by EOF or another marker is an empty
    // document; otherwise the node begins right where the marker left `pos`
    // (same line if there was inline content — collections forbidden there —
    // else the following content line, where they're perfectly ordinary).
    value = pos >= len || isDocMarkerAt(pos) ? null : inline ? parseBlockNode(ROOT_AFTER_INLINE_MARKER) : parseRootBlockNode();
  } else if (marker) {
    // A bare '...' at a document's start position (no preceding content): an
    // empty document. The shared end-marker handling below consumes it.
    value = null;
  } else {
    // No marker at all: a bare document. Only legal at stream start or right
    // after a preceding explicit '...' (`bareDocAllowed`) — otherwise a prior
    // document's content simply ended (e.g. a flow value's closing bracket)
    // and this is unmarked trailing content, not a new document.
    if (!bareDocAllowed) fail("expected a '---' before the next document (a bare document may only follow an explicit '...')");
    value = parseRootBlockNode();
  }

  // A trailing explicit end marker belongs to the document just produced, not
  // to the next call — consume it here so the next document may be bare. Any
  // other ending (EOF, or landing right on a '---') keeps `bareDocAllowed`
  // false: only '...' unlocks a following bare document (grammar: bare
  // documents are the stream's first, or immediately after a doc-suffix).
  if (pos < len && isDocMarkerAt(pos) && src.charCodeAt(pos) === DOT) {
    consumeDocEndMarker();
    bareDocAllowed = true;
  } else {
    bareDocAllowed = false;
  }
  return value;
}

// ===========================================================================
// Stringify (dump) — M6. The inverse of the parser above: a JS value → a YAML
// document that reads back to a deep-equal value through BOTH this file's own
// `parse` and the oracle (`yaml`, see bench/oracle.ts) — that round-trip is
// the entire correctness contract (test/stringify.unit.ts), never exact
// textual output. Correctness-first (M6), then perf-tuned in M7: output is
// accumulated into a single module-level `out` string via sequential `out += …`
// appends (see `out`'s doc comment for why that ConsString rope is O(n) here,
// NOT the dossier's scan-path `+=` hazard) — one terminal flatten, no giant
// array-of-parts + `join`. charCodeAt-classification (no regexes) is kept
// throughout for scalar quoting.
//
// Design, top to bottom:
//  - Scalars: `null`/booleans/numbers get their bare core-schema spelling
//    (`.inf`/`-.inf`/`.nan`/`-0` handled explicitly; every other number is
//    JS's own round-trip-exact `String()`, which already matches the
//    core-schema int/float grammar `tryNumber`/`tryNumberGeneric` parse).
//    Strings are written BARE only when doing so re-parses to the exact same
//    string (`isPlainScalarSafe` — the mirror image of `resolvePlain`'s
//    typing dispatch); otherwise single-quoted (cheap: only `'` needs
//    escaping) unless a control character forces the escape-capable
//    double-quoted style.
//  - `Uint8Array` → `!!binary <base64>`: always safe BARE (the base64
//    alphabet contains no YAML indicator/space/`:`/`#`, and the explicit tag
//    overrides implicit typing regardless of what the text looks like) except
//    the empty (0-byte) case, which needs an empty QUOTED scalar since a bare
//    plain scalar can't be empty.
//  - Shared references and cycles: a reference-counting PRE-SCAN
//    (`dumpScanRefs`) walks the value once, registering each object/array/
//    `Uint8Array` the moment it's first reached (BEFORE recursing into its
//    children — the same register-before-children discipline `parse` uses for
//    anchors, see `registerPendingAnchor`'s doc comment) so a cycle's back-edge
//    is recognized as "already seen" instead of looping forever. Anything
//    reached more than once — genuinely shared, or sitting on a cycle — gets
//    an anchor; everything else gets none. The WRITE pass mirrors this: the
//    first time a flagged node is actually written, it is assigned a fresh
//    `&aN` name and registered immediately (again, before recursing into its
//    children), so a cyclic back-edge reached during that very recursion finds
//    the anchor already there and emits `*aN` instead of re-descending —
//    exactly what keeps the heavily-shared and diamond-DAG stress cases linear
//    rather than exponential.
//  - Collections: block style for every nonempty map/array; `{}`/`[]` (flow)
//    for empties, since block style has no way to spell zero entries. A
//    nested container is NEVER compact-inlined (no `- key: value` first-line
//    packing): it is always DEFERRED to a following line at
//    `indent + INDENT_STEP`. This costs a little vertical space but gives
//    every context (root value, map value, sequence item) the exact same
//    "indent one step deeper" rule, including where an anchor line must sit
//    alone (`key: &aN` / `- &aN`, nothing else on that line) — the same
//    placement `parse`'s `parseAnchoredBlockNode` requires to attribute the
//    anchor to the CONTAINER rather than to whatever scalar happens to follow
//    it on the same line (see that function's doc comment for the same-line-
//    vs-deferred distinction this design sidesteps entirely by always
//    deferring). Object key order is preserved (a plain `Object.keys` walk);
//    keys are quoted by the identical scalar rules as values.
// ===========================================================================

const INDENT_STEP = 2;

/** Cached "N spaces" strings — indentation only ever grows by INDENT_STEP per nesting level, so this amortizes to O(1) amortized per line rather than a fresh `repeat` every time. */
const INDENT_CACHE: string[] = [""];

function indentSpaces(n: number): string {
  for (let i = INDENT_CACHE.length; i <= n; i++) INDENT_CACHE.push(INDENT_CACHE[i - 1] + " ");
  return INDENT_CACHE[n];
}

// ---------------------------------------------------------------------------
// Reference-counting pre-scan + anchor bookkeeping.
// ---------------------------------------------------------------------------

/** Per-`stringify()` call state (reset in `dumpValue`; non-reentrant, matching the parser's own module-level-state discipline — see its state block near the top of this file). */
let dumpRefCounts: Map<object, number> | null = null;
let dumpAnchors: Map<object, string> | null = null;
let dumpAnchorSeq = 0;
let dumpDepth = 0;
/** Per-call cache of a rendered `writeStringScalar(key) + ":"` prefix, keyed by the raw key string — real records repeat the same keys across every row (see `writeCollectionBody`), so a repeat collapses to one Map lookup instead of re-classifying and re-concatenating. Capped defensively (unlike the parser's own per-parse `keyCache`, which has no such cap) so a document of millions of distinct keys can't grow it unbounded; past the cap we just stop memoizing new keys and recompute them, still correct, just uncached. */
let dumpKeyCache: Map<string, string> | null = null;
const MAX_DUMP_KEY_CACHE = 10_000;

/**
 * Set by the pre-scan (`dumpScanRefs`) iff it reached SOME object more than once
 * — i.e. the value contains a genuinely shared node or a cycle, so anchors WILL
 * be needed. The overwhelmingly common case (plain JSON / block-YAML trees, no
 * sharing) leaves this `false`, which lets the write pass take an anchor-free
 * fast path: no `dumpAnchors`/`dumpNeedsAnchor` Map lookups per node, and
 * `dumpRefCounts` is released before the (allocation-heavy) write pass rather
 * than kept live alongside the output. It is NEVER a shortcut around anchor
 * placement: whenever it is `true` the write pass runs the identical full path,
 * assigning anchors at exactly the same points — and any cycle necessarily
 * trips a repeat-visit in the scan, so no cyclic input can slip through the
 * fast path (which would otherwise loop forever).
 */
let dumpHasShared = false;

/**
 * The single, growing output buffer for a `stringify()` call — every `write*`
 * function appends one line's text with `out += …` and the finished string is
 * read out exactly once (in `dumpValue`).
 *
 * WHY `+=` here is correct and fast — and NOT the O(n²) hazard the dossier
 * warns against (05 §"string building"): that warning is about building a
 * string while *also scanning it* (repeated `.charCodeAt`/`.length`/compares
 * against the partial result), which forces V8 to FLATTEN the ConsString rope
 * on every touch — O(n) each, O(n²) overall. We never read `out` mid-build: it
 * is append-only, one shallow left-leaning ConsString node per line, and is
 * flattened exactly once — eagerly, at the end of `dumpValue` (see the forced
 * `charCodeAt` there) so the returned value is a normal flat string, never a
 * rope left pinning ~O(lines) cons nodes alive until some later consumer first
 * touches it. That single terminal flatten is measured O(n) and ~1.8× cheaper
 * than the previous `parts.join("")` over a ~433k-element array, and it drops
 * that whole array (large peak-RSS win). This is the textbook sequential-append
 * rope, not the scan-path anti-pattern.
 */
let out = "";

/** Sink for `dumpValue`'s terminal flatten — module-scoped so V8 can't prove the flattening `charCodeAt` dead and elide it (which would defer the O(n) flatten back out to a later consumer, re-inflating retained memory). */
let dumpFlattenSink = 0;

/**
 * Count how many times each object/array/`Uint8Array` is *reached* while
 * walking `value`, registering a node's count the moment it's first seen —
 * BEFORE recursing into its children. That ordering is what makes a cycle
 * terminate: the second (or later) visit to an already-registered node finds
 * it already in the map and returns immediately without descending again, so
 * a self-referential/cyclic structure is walked exactly once per node instead
 * of infinitely. A final count > 1 means "reached from >= 2 places" — true
 * of both an honestly-shared node and one sitting on a cycle (its own
 * descendant re-reaches it) — either way it needs an anchor; a count of
 * exactly 1 needs none. Depth-guarded like every recursive parser construct
 * (`MAX_DEPTH`), so a pathologically deep (not merely wide) input fails
 * cleanly here rather than blowing the native call stack.
 */
function dumpScanRefs(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  const obj = value as object;
  const seen = dumpRefCounts!.get(obj);
  if (seen !== undefined) {
    dumpRefCounts!.set(obj, seen + 1);
    dumpHasShared = true; // a repeat visit ⇒ real sharing or a cycle ⇒ anchors needed
    return;
  }
  dumpRefCounts!.set(obj, 1);
  if (obj instanceof Uint8Array) return; // leaf content, no children to scan
  if (++dumpDepth > MAX_DEPTH) throw new YAMLParseError("stringify: maximum nesting depth exceeded");
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) dumpScanRefs(obj[i]);
  } else {
    const keys = Object.keys(obj as Record<string, unknown>);
    for (let i = 0; i < keys.length; i++) dumpScanRefs((obj as Record<string, unknown>)[keys[i]]);
  }
  dumpDepth--;
}

/** Whether `obj` was reached more than once during the pre-scan (see `dumpScanRefs`) and therefore needs an anchor. */
function dumpNeedsAnchor(obj: object): boolean {
  return (dumpRefCounts!.get(obj) ?? 0) > 1;
}

/**
 * Assign `obj` a fresh anchor name and register it immediately — callers MUST
 * do this BEFORE recursing into `obj`'s own children (mirroring `parse`'s
 * register-before-children discipline), so that a cyclic back-edge reached
 * during that recursion finds the anchor already assigned and emits an alias
 * instead of writing `obj` all over again.
 */
function dumpAssignAnchor(obj: object): string {
  const name = "a" + ++dumpAnchorSeq;
  dumpAnchors!.set(obj, name);
  return name;
}

// ---------------------------------------------------------------------------
// Scalar quoting — the exact inverse of `resolvePlain`'s typing dispatch: a
// plain (bare) scalar is only ever emitted when it is guaranteed to re-parse
// as the identical string.
// ---------------------------------------------------------------------------

/**
 * Leading characters that would change a plain scalar's meaning if left
 * unquoted (spec c-indicator: `- ? : , [ ] { } # & * ! | > ' " % @ \``` `` —
 * `~` is deliberately excluded here since it is only special on an EXACT `~`
 * match, handled by `looksLikeTypedScalar` instead, not merely as a leading
 * character (`~foo` is an ordinary safe plain scalar).
 */
function isPlainLeadingIndicator(c: number): boolean {
  switch (c) {
    case MINUS:
    case QUESTION:
    case COLON:
    case COMMA:
    case LBRACKET:
    case RBRACKET:
    case LBRACE:
    case RBRACE:
    case HASH:
    case AMP:
    case STAR:
    case EXCLAIM:
    case PIPE:
    case GT:
    case SQUOTE:
    case DQUOTE:
    case PERCENT:
    case AT:
    case BACKTICK:
      return true;
    default:
      return false;
  }
}

/**
 * Whether `s`, written bare, would be re-typed as null/bool/number instead of
 * staying the literal string it is — mirrors `resolvePlain`'s null/bool word
 * dispatch exactly, and reuses `tryNumberGeneric` (the same core-schema
 * int/float/`.inf`/`.nan` grammar `!!int`/`!!float` validate tag content
 * against) rather than re-deriving the number grammar a third time.
 */
function looksLikeTypedScalar(s: string): boolean {
  switch (s) {
    case "~":
    case "null":
    case "Null":
    case "NULL":
    case "true":
    case "True":
    case "TRUE":
    case "false":
    case "False":
    case "FALSE":
      return true;
    default:
      return tryNumberGeneric(s) !== NOT_NUMERIC;
  }
}

/**
 * Whether `s` may be written as a bare plain scalar and re-parse to the exact
 * same string under 1.2 core. Disqualified by: being empty; a leading or
 * trailing space; a leading indicator character; ANY control character
 * anywhere (never legal in a plain scalar, regardless of position — simpler
 * and safer than reasoning about which positions are actually reachable); an
 * interior `": "` (mapping separator) or `" #"` (comment) span; a trailing
 * `:` (ambiguous with a separator once nothing follows); or content that
 * would resolve to null/bool/number rather than staying a string.
 */
function isPlainScalarSafe(s: string): boolean {
  const n = s.length;
  if (n === 0) return false;
  const c0 = s.charCodeAt(0);
  if (c0 === SPACE || isPlainLeadingIndicator(c0)) return false;
  const cLast = s.charCodeAt(n - 1);
  if (cLast === SPACE || cLast === COLON) return false;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return false;
    if (c === COLON && i + 1 < n && s.charCodeAt(i + 1) === SPACE) return false;
    if (c === SPACE && i + 1 < n && s.charCodeAt(i + 1) === HASH) return false;
  }
  return !looksLikeTypedScalar(s);
}

/** Whether `s` needs the escape-capable double-quoted style: single-quoted YAML has no escape mechanism (besides doubling `'`), so a control character can only be represented via `\xNN`/named double-quote escapes. */
function needsDoubleQuoting(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/** `'`-quote `s`, doubling any embedded `'` — single-quoted YAML's only escape, and the only character that needs one here. */
function encodeSingleQuoted(s: string): string {
  const parts: string[] = ["'"];
  let seg = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === SQUOTE) {
      parts.push(s.slice(seg, i), "''");
      seg = i + 1;
    }
  }
  parts.push(s.slice(seg), "'");
  return parts.join("");
}

/** `\xNN` escape (uppercase hex, zero-padded to 2 digits) for a control character with no shorter named escape. */
function hexEscape(c: number): string {
  const hex = c.toString(16).toUpperCase();
  return hex.length < 2 ? "\\x0" + hex : "\\x" + hex;
}

/**
 * `"`-quote `s` with the minimal necessary escape set: `\` and `"` always;
 * control characters via a named escape where double-quoted YAML has one
 * (mirroring the parser's own decode table in `parseDoubleQuotedSlow`, in
 * reverse), else `\xNN`. Everything else — including unicode/astral text,
 * copied through verbatim as its underlying UTF-16 code units — needs no
 * escaping at all in a double-quoted scalar.
 */
function encodeDoubleQuoted(s: string): string {
  const parts: string[] = ['"'];
  let seg = 0;
  const n = s.length;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    let esc: string | null = null;
    switch (c) {
      case BACKSLASH:
        esc = "\\\\";
        break;
      case DQUOTE:
        esc = '\\"';
        break;
      case 0:
        esc = "\\0";
        break;
      case 7:
        esc = "\\a";
        break;
      case 8:
        esc = "\\b";
        break;
      case 9:
        esc = "\\t";
        break;
      case 10:
        esc = "\\n";
        break;
      case 11:
        esc = "\\v";
        break;
      case 12:
        esc = "\\f";
        break;
      case 13:
        esc = "\\r";
        break;
      case 0x1b:
        esc = "\\e";
        break;
      default:
        if (c < 0x20 || c === 0x7f) esc = hexEscape(c);
    }
    if (esc !== null) {
      if (i > seg) parts.push(s.slice(seg, i));
      parts.push(esc);
      seg = i + 1;
    }
  }
  parts.push(s.slice(seg), '"');
  return parts.join("");
}

/**
 * Render a string as a scalar: bare when safe, else the cheapest quoting
 * style that round-trips it exactly. Shared by ordinary string VALUES and by
 * map KEYS — both follow the identical 1.2-core scalar rules, so there is no
 * separate "key" quoting function.
 */
function writeStringScalar(s: string): string {
  if (isPlainScalarSafe(s)) return s;
  return needsDoubleQuoting(s) ? encodeDoubleQuoted(s) : encodeSingleQuoted(s);
}

// ---------------------------------------------------------------------------
// Numbers.
// ---------------------------------------------------------------------------

/**
 * `NaN`/`Infinity`/`-Infinity`/`-0` get their core-schema spelling; every
 * other number uses JS's own `String()`, which — by the ECMA-262 Number-to-
 * String contract — always produces the shortest decimal (or exponential,
 * for very large/small magnitudes) text that reads back to the identical
 * double via `Number()`. That is exactly what `tryNumber`/`tryNumberGeneric`
 * (this file) and the oracle's own core-schema float/int grammar do to parse
 * it back, so no special-casing is needed for big integers, subnormals, or
 * exponential notation — verified empirically against the oracle for every
 * case in `basicScalars` (see the commit message for the probe transcript).
 */
function formatNumber(v: number): string {
  if (Number.isNaN(v)) return ".nan";
  if (v === Infinity) return ".inf";
  if (v === -Infinity) return "-.inf";
  if (Object.is(v, -0)) return "-0";
  return String(v);
}

/**
 * Render any scalar-shaped value (including `null`/`undefined`, though only
 * `null` is in the tested data model — `undefined` is mapped the same way as
 * a defensive fallback rather than crashing on a plausible-but-untested input)
 * as inline text, with no surrounding quoting/anchor decoration — the callers
 * below add that.
 */
function writeScalar(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "string") return writeStringScalar(value);
  return writeStringScalar(String(value)); // not in the tested data model (e.g. bigint/symbol) — best effort
}

// ---------------------------------------------------------------------------
// `Uint8Array` → `!!binary`.
// ---------------------------------------------------------------------------

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard base64 with `=` padding — the exact forward counterpart of `decodeBinary`'s `BASE64_INV` table. */
function encodeBase64(bytes: Uint8Array): string {
  const n = bytes.length;
  if (n === 0) return "";
  const parts: string[] = [];
  let i = 0;
  for (; i + 3 <= n; i += 3) {
    const triple = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    parts.push(
      BASE64_ALPHABET[(triple >> 18) & 0x3f],
      BASE64_ALPHABET[(triple >> 12) & 0x3f],
      BASE64_ALPHABET[(triple >> 6) & 0x3f],
      BASE64_ALPHABET[triple & 0x3f],
    );
  }
  const rem = n - i;
  if (rem === 1) {
    const triple = bytes[i] << 16;
    parts.push(BASE64_ALPHABET[(triple >> 18) & 0x3f], BASE64_ALPHABET[(triple >> 12) & 0x3f], "=", "=");
  } else if (rem === 2) {
    const triple = (bytes[i] << 16) | (bytes[i + 1] << 8);
    parts.push(BASE64_ALPHABET[(triple >> 18) & 0x3f], BASE64_ALPHABET[(triple >> 12) & 0x3f], BASE64_ALPHABET[(triple >> 6) & 0x3f], "=");
  }
  return parts.join("");
}

/**
 * `!!binary <base64>` — the base64 payload is always safe BARE (unquoted):
 * its alphabet (`A-Za-z0-9+/=`) contains no leading-indicator character, no
 * space, and no `:`/`#`, so the plain-scalar SCAN never misreads it — and any
 * coincidental resemblance to null/bool/a number is irrelevant, since the
 * explicit `!!binary` tag overrides implicit typing entirely (`applyScalarTag`
 * decodes the tag's raw text directly, never through `resolvePlain`). Only
 * the empty (0-byte) case needs quoting, since an empty plain scalar isn't
 * legal at all.
 */
function writeBinaryScalar(bytes: Uint8Array): string {
  const b64 = encodeBase64(bytes);
  return b64.length === 0 ? '!!binary ""' : "!!binary " + b64;
}

// ---------------------------------------------------------------------------
// Collections — block style for nonempty maps/arrays, flow `{}`/`[]` for
// empties. A nested container is always DEFERRED to a following, deeper-
// indented line (see the section header for why); see `writeEntryValue` for
// where an anchor gets assigned and its `&aN`/`*aN` text emitted.
// ---------------------------------------------------------------------------

function isEmptyContainer(obj: object, isArr: boolean): boolean {
  return isArr ? (obj as unknown[]).length === 0 : Object.keys(obj as Record<string, unknown>).length === 0;
}

/**
 * Write a nonempty map's/array's entries, one per line, at column `indent`.
 * Assumes the caller has already handled `obj`'s OWN anchor placement (this
 * only ever writes the CONTENTS).
 */
function writeCollectionBody(obj: object, isArr: boolean, indent: number): void {
  if (++dumpDepth > MAX_DEPTH) throw new YAMLParseError("stringify: maximum nesting depth exceeded");
  const ind = indentSpaces(indent);
  if (isArr) {
    const arr = obj as unknown[];
    for (let i = 0; i < arr.length; i++) {
      out += ind + "-";
      writeEntryValue(arr[i], indent);
    }
  } else {
    const rec = obj as Record<string, unknown>;
    const keys = Object.keys(rec);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      let keyColon = dumpKeyCache!.get(k);
      if (keyColon === undefined) {
        keyColon = writeStringScalar(k) + ":";
        if (dumpKeyCache!.size < MAX_DUMP_KEY_CACHE) dumpKeyCache!.set(k, keyColon);
      }
      out += ind + keyColon;
      writeEntryValue(rec[k], indent);
    }
  }
  dumpDepth--;
}

/**
 * Write whatever follows an already-emitted `key:` or `-` token on the
 * current line, ending with the newline(s) that close out this entry:
 *  - a scalar, an alias to an already-anchored node, an empty container, or a
 *    `!!binary` scalar — all inline, on this same line;
 *  - a nonempty map/array — deferred: `\n` (optionally preceded by ` &aN` when
 *    this is the node's first occurrence and it needs an anchor — assigned
 *    and registered HERE, before recursing, so a cyclic back-edge inside that
 *    recursion sees it already registered) followed by its entries at
 *    `indent + INDENT_STEP`.
 * Nested containers are never compact-inlined (see the section header) — this
 * keeps ONE indentation rule for every calling context.
 */
function writeEntryValue(value: unknown, indent: number): void {
  if (value === null || typeof value !== "object") {
    out += " " + writeScalar(value) + "\n";
    return;
  }
  const obj = value as object;
  // Anchor/alias bookkeeping only matters when the pre-scan found sharing; the
  // no-sharing fast path (`dumpHasShared === false`) skips these per-node Map
  // lookups entirely (see `dumpHasShared`). When it IS set, the logic below is
  // exactly the M6 full path — same anchors, assigned at the same points.
  if (dumpHasShared) {
    const already = dumpAnchors!.get(obj);
    if (already !== undefined) {
      out += " *" + already + "\n";
      return;
    }
  }
  if (obj instanceof Uint8Array) {
    const name = dumpHasShared && dumpNeedsAnchor(obj) ? dumpAssignAnchor(obj) : null;
    out += " " + (name !== null ? "&" + name + " " : "") + writeBinaryScalar(obj) + "\n";
    return;
  }
  const isArr = Array.isArray(obj);
  const name = dumpHasShared && dumpNeedsAnchor(obj) ? dumpAssignAnchor(obj) : null;
  if (isEmptyContainer(obj, isArr)) {
    out += " " + (name !== null ? "&" + name + " " : "") + (isArr ? "[]" : "{}") + "\n";
    return;
  }
  if (name !== null) out += " &" + name + "\n";
  else out += "\n";
  writeCollectionBody(obj, isArr, indent + INDENT_STEP);
}

/**
 * The root document value — like `writeEntryValue`, but with no preceding
 * `key:`/`-` token: an inline scalar/empty-container/`!!binary` needs no
 * leading space, and a root container's own `&aN` (when it needs one) stands
 * alone as the very first line with none either.
 */
function writeDocumentValue(value: unknown): void {
  if (value === null || typeof value !== "object") {
    out += writeScalar(value) + "\n";
    return;
  }
  const obj = value as object;
  // See `writeEntryValue`: the root can never be an alias, but it can still be
  // the first occurrence of a shared node, so it needs the same `dumpHasShared`-
  // gated anchor check (skipped on the no-sharing fast path).
  if (obj instanceof Uint8Array) {
    const name = dumpHasShared && dumpNeedsAnchor(obj) ? dumpAssignAnchor(obj) : null;
    out += (name !== null ? "&" + name + " " : "") + writeBinaryScalar(obj) + "\n";
    return;
  }
  const isArr = Array.isArray(obj);
  const name = dumpHasShared && dumpNeedsAnchor(obj) ? dumpAssignAnchor(obj) : null;
  if (isEmptyContainer(obj, isArr)) {
    out += (name !== null ? "&" + name + " " : "") + (isArr ? "[]" : "{}") + "\n";
    return;
  }
  if (name !== null) out += "&" + name + "\n";
  writeCollectionBody(obj, isArr, 0);
}

/**
 * Terminal flatten + per-call cleanup for `dumpValue`. Reads `out` once and
 * forces V8's single O(n) `String::Flatten` eagerly (see `out`'s doc comment
 * for the full rationale: the returned value must be an ordinary flat string,
 * not a rope pinning ~O(lines) cons nodes live until a later consumer first
 * touches it), then releases all per-call dump state so a large dumped graph
 * isn't kept alive past this call.
 */
function dumpFinish(): string {
  const result = out;
  out = ""; // drop the module-level reference so the rope isn't pinned past this call
  // `charCodeAt` triggers the flatten; the module-level sink defeats dead-code
  // elimination of the otherwise-unused read (`|=` both reads and writes it, so
  // neither V8 nor tsc can treat it as dead) — the same O(n) flatten a consumer
  // would pay on first access, made eager so stringify's own cost is honest.
  if (result.length !== 0) dumpFlattenSink |= result.charCodeAt(0);
  dumpRefCounts = null;
  dumpAnchors = null;
  dumpKeyCache = null;
  return result;
}

/**
 * Serialize `value` into a YAML document (the implementation behind the public
 * `stringify` above): ref-count every node (`dumpScanRefs`, which sets
 * `dumpHasShared`), then write it out, emitting `&anchor`/`*alias` at the nodes
 * the scan reached more than once (a shared reference or a cycle). When the scan
 * finds no sharing — the overwhelmingly common tree case — no anchor is ever
 * assigned and the write takes the anchor-free fast path (`dumpHasShared` false).
 */
function dumpValue(value: unknown): string {
  dumpKeyCache = new Map();
  dumpRefCounts = new Map();
  dumpDepth = 0;
  dumpHasShared = false;
  dumpScanRefs(value);
  // No shared node or cycle anywhere ⇒ no anchor will ever be assigned, so the
  // ref-count map has done its whole job and the write pass takes the anchor-free
  // fast path. Release it now (one entry per object — sizable) rather than pinning
  // it live through the heavy output build; this early release keeps peak RSS at
  // the classic dumper's level when the value turns out alias-free.
  if (!dumpHasShared) dumpRefCounts = null;
  dumpAnchors = new Map();
  dumpAnchorSeq = 0;
  out = "";
  dumpDepth = 0;
  writeDocumentValue(value);
  return dumpFinish();
}
