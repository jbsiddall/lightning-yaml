/**
 * lightning-yaml — a single-pass, allocation-minimal, pure-JS YAML parser
 * engineered for V8 (see docs/research/07-design-a-pure-js.md).
 *
 * The public surface mirrors `JSON.parse`:
 *   - `parse(text)`     text → JS value (a single document; throws if a second
 *                       document follows, like js-yaml's `load`)
 *   - `parseAll(text)`  text → array of document values — a real multi-document
 *                       stream, split on `---`/`...` markers
 *   - `stringify(value)` — the dumper is a later milestone; still a stub.
 *
 * Implementation status: the flow layer (JSON subset + YAML flow), block
 * structure (M3+), literal/folded block scalars (`|`/`>`, M4), document
 * markers (`---`/`...`), `%YAML`/`%TAG` directives, multi-document streams,
 * and now anchors/aliases (`&`/`*`, M5 — including self-referential/cyclic
 * anchors and structural sharing) are implemented. The remaining rich surface
 * — tags (`!!binary` and friends) and merge keys — is not here yet and throws
 * a controlled parse error (or is read as plain text) rather than mis-parsing.
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
const GT = 62; // > (folded block scalar indicator)
const QUESTION = 63; // ?
const UPPER_E = 69; // E
const LBRACKET = 91; // [
const BACKSLASH = 92; // \
const RBRACKET = 93; // ]
const UNDERSCORE = 95; // _
const LOWER_E = 101; // e
const LBRACE = 123; // {
const PIPE = 124; // | (literal block scalar indicator)
const RBRACE = 125; // }
const TILDE = 126; // ~
const BOM = 0xfeff;

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
 * Thrown by anything not implemented yet (currently `stringify`). A dedicated
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

/** A syntax/semantic error in the input document. */
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
 * Memoized position of the next backslash at or after the last query point (or
 * `len` once none remain). Without this, checking each double-quoted string for
 * escapes via `indexOf('\\')` rescans to end-of-document every time on
 * backslash-free input — O(n²) over a document of many strings. We recompute
 * only when the cursor passes the memo, so a backslash-free document pays a
 * single `indexOf` total. Reset per parse.
 */
let nextBackslash = -1;

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
  lineStart = 0;
  keyCache = new Map();
  tagHandles = null;
  anchorMap = null;
  pendingAnchorName = null;
  afterInlineProperty = false;
  colOverride = -1;
  bareDocAllowed = true;

  // Skip a leading BOM without copying the input.
  if (len > 0 && src.charCodeAt(0) === BOM) {
    pos = 1;
    lineStart = 1; // so the first line's content column is measured from here
  }
}

/** Parse a single YAML document into a JS value. */
export function parse(text: string): unknown {
  resetForStream(text);
  const value = parseNextDocument();
  if (value === NO_DOCUMENT) return null; // empty stream → null (YAML), unlike JSON

  // Single-document contract (like js-yaml's `load`): a second document —
  // another marker, more directives, or any other trailing content — is an
  // error here; use `parseAll` for multi-document streams.
  if (pos < len) {
    fail("expected a single document in the stream, but found more (use parseAll for multi-document streams)");
  }
  return value;
}

/**
 * Parse a multi-document stream into an array of values. Documents are
 * separated by `---` (start) and/or `...` (end) markers; a stream with no
 * markers at all is a single (possibly bare) document, same as `parse`.
 */
export function parseAll(text: string): unknown[] {
  resetForStream(text);
  const docs: unknown[] = [];
  for (;;) {
    const value = parseNextDocument();
    if (value === NO_DOCUMENT) break;
    docs.push(value);
  }
  return docs;
}

/** Serialize a JS value into a YAML document. Not implemented yet (a later milestone). */
export function stringify(_value: unknown): string {
  throw new NotImplementedError("stringify");
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
 * collections may span lines) and `#` comments (to end of line). A local cursor
 * keeps the loop off the module global until it writes back once.
 */
function skipFlowWs(): void {
  let p = pos;
  while (p < len) {
    const c = src.charCodeAt(p);
    if (c === SPACE || c === TAB || c === LF || c === CR) {
      p++;
      continue;
    }
    if (c === HASH) {
      const nl = src.indexOf("\n", p);
      p = nl === -1 ? len : nl + 1;
      continue;
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
 */
function parseAnchoredFlowValue(): unknown {
  pos++; // past '&'
  const name = scanAnchorOrAliasName();
  skipFlowWs(); // names may be followed by a line break inside a flow collection
  if (src.charCodeAt(pos) === STAR) fail("an alias node cannot carry an anchor property");
  const outerPending = pendingAnchorName;
  pendingAnchorName = name;
  const node = parseFlowValue();
  if (pendingAnchorName === name) registerAnchor(name, node); // scalar leaf: not yet consumed
  pendingAnchorName = outerPending;
  return node;
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
    const start = pos;
    const end = scanFlowPlainEnd();
    return src.slice(start, end);
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
      key = parseFlowKey();
    }
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
  return String(node);
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

/** A flow mapping key: an anchor/alias, double-quoted, single-quoted, or a plain scalar. */
function parseFlowKey(): string {
  const c = src.charCodeAt(pos);
  if (c === AMP) return parseFlowKeyAnchored();
  if (c === STAR) return internKey(keyToString(parseAlias()));
  if (c === DQUOTE) return internKey(parseDoubleQuoted());
  if (c === SQUOTE) return internKey(parseSingleQuoted());
  const start = pos;
  const end = scanFlowPlainEnd();
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
 * inherited "for free" from a container's own self-registration.
 */
function parseFlowKeyAnchored(): string {
  pos++; // past '&'
  const name = scanAnchorOrAliasName();
  skipFlowWs();
  if (src.charCodeAt(pos) === STAR) fail("an alias node cannot carry an anchor property");
  const outerPending = pendingAnchorName;
  pendingAnchorName = name;
  const c = src.charCodeAt(pos);
  let key: string;
  if (c === DQUOTE) key = internKey(keyToString(registerPendingAnchor(parseDoubleQuoted())));
  else if (c === SQUOTE) key = internKey(keyToString(registerPendingAnchor(parseSingleQuoted())));
  else {
    const start = pos;
    const end = scanFlowPlainEnd();
    if (end === start) fail("expected a mapping key");
    key = plainKey(start, end); // plainKey itself calls registerPendingAnchor
  }
  pendingAnchorName = outerPending;
  return key;
}

/** Return the cached copy of `s` if seen this parse, else record and return it. */
function internKey(s: string): string {
  const hit = keyCache.get(s);
  if (hit !== undefined) return hit;
  keyCache.set(s, s);
  return s;
}

// ---------------------------------------------------------------------------
// Plain scalars (flow context) — scan the span, then type it once.
// ---------------------------------------------------------------------------

/**
 * Scan a flow-context plain scalar and return the exclusive end of its trimmed
 * content (trailing spaces/tabs excluded); advances `pos` to the terminator.
 * A plain scalar ends at a flow indicator (`,[]{}`), a line break, a `:`
 * followed by a separator, or a ` #` comment. Single-line only for now (flow
 * plain scalars can fold across lines; unused by the fixtures — deferred).
 */
function scanFlowPlainEnd(): number {
  const start = pos;
  let p = pos;
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
        if (p > start) {
          const prev = src.charCodeAt(p - 1);
          if (prev === SPACE || prev === TAB) break; // ` #` starts a comment
        }
      } else {
        break; // , [ ] { } LF CR always terminate
      }
    }
    p++;
  }
  pos = p;
  // Trim trailing spaces/tabs (rare; walked back once instead of tracked per char).
  let e = p;
  while (e > start) {
    const w = src.charCodeAt(e - 1);
    if (w !== SPACE && w !== TAB) break;
    e--;
  }
  return e;
}

function parseFlowPlain(): unknown {
  const start = pos;
  const end = scanFlowPlainEnd();
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
    return src.slice(start, end);
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
  return src.slice(start, end);
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

function parseDoubleQuoted(): string {
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
    // No escape before the closing quote → the value is a single slice. This is
    // the ~100% case on JSON-shaped input and is why the hop path beats native.
    pos = e + 1;
    return src.slice(start, e);
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
  const start = pos + 1;
  const e = src.indexOf("'", start);
  if (e === -1) fail("unterminated single-quoted string");
  if (e + 1 < len && src.charCodeAt(e + 1) === SQUOTE) {
    return parseSingleQuotedSlow(start); // contains a '' escape
  }
  pos = e + 1;
  return src.slice(start, e);
}

function parseSingleQuotedSlow(start: number): string {
  let result = "";
  let seg = start;
  let i = start;
  for (;;) {
    if (i >= len) fail("unterminated single-quoted string");
    if (src.charCodeAt(i) === SQUOTE) {
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
function parseBlockNode(parentCol: number): unknown {
  // Consumed here (not left for the branches below) so a property's influence
  // is scoped to exactly the ONE dispatch that immediately follows it, never
  // leaking into deeper recursion — see `afterInlineProperty`/`colOverride`'s
  // doc comments.
  const inlineProp = afterInlineProperty;
  afterInlineProperty = false;
  const col = colOverride >= 0 ? colOverride : pos - lineStart;
  colOverride = -1;
  const c = src.charCodeAt(pos);

  if (c === AMP) return parseAnchoredBlockNode(parentCol);

  if (c === MINUS && isSpaceOrEolAt(pos + 1)) {
    if (parentCol === ROOT_AFTER_INLINE_MARKER) fail("a block sequence cannot start on the same line as a '---' document start");
    if (inlineProp) fail("a block sequence cannot start on the same line as a node property (anchor)");
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

  // Explicit block mapping keys (`? key` / `: value`) are a later milestone.
  // Reject the `? ` indicator rather than mis-reading it as a plain scalar.
  if (c === QUESTION && isSpaceOrEolAt(pos + 1)) {
    throw new NotImplementedError("parse (explicit block mapping keys '?' / ':')");
  }

  if (c === LBRACKET || c === LBRACE || c === DQUOTE || c === SQUOTE || c === STAR) {
    // A flow collection, quoted scalar, or alias — either the node itself, or a
    // mapping key if a `: ` separator follows on the same line. `[`/`{` already
    // self-register (or not) via `parseFlowValue`'s own container allocation,
    // regardless of `inlineProp` — flow collections have no line-based
    // same-line/deferred distinction to make. An alias can never carry a
    // property (rejected earlier in `parseAnchoredBlockNode`/
    // `parseAnchoredFlowValue`), so it never needs `registerPendingAnchor`.
    const node = c === DQUOTE ? parseDoubleQuoted() : c === SQUOTE ? parseSingleQuoted() : c === STAR ? parseAlias() : registerPendingAnchor(parseFlowValue());
    const save = pos;
    skipInlineSpaces();
    if (src.charCodeAt(pos) === COLON && isSpaceOrEolAt(pos + 1)) {
      if (parentCol === ROOT_AFTER_INLINE_MARKER) fail("a block mapping cannot start on the same line as a '---' document start");
      // Quoted scalar becomes a mapping key: only a SAME-LINE property may
      // claim it (see `afterInlineProperty`'s doc comment) — a DEFERRED one
      // is left pending for `parseBlockMap`'s own self-registration instead.
      return parseBlockMap(col, keyToString(inlineProp ? registerPendingAnchor(node) : node));
    }
    pos = save;
    nextLine();
    return registerPendingAnchor(node); // plain value: always claims (same-line or deferred)
  }

  // Plain scalar: the scan stops at a `: ` separator iff this line is a mapping.
  const start = pos;
  const end = scanBlockPlainEnd();
  if (plainStoppedAtColon) {
    if (parentCol === ROOT_AFTER_INLINE_MARKER) fail("a block mapping cannot start on the same line as a '---' document start");
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
 */
function parseAnchoredBlockNode(parentCol: number): unknown {
  const anchorCol = pos - lineStart;
  pos++; // past '&'
  const name = scanAnchorOrAliasName();
  skipInlineSpaces();
  const c = pos < len ? src.charCodeAt(pos) : -1;
  if (c === STAR) fail("an alias node cannot carry an anchor property");
  const outerPending = pendingAnchorName;
  pendingAnchorName = name;
  let node: unknown;
  if (c === -1 || c === LF || c === CR || c === HASH) {
    // The property occupies the rest of its line; the node (if any) begins on
    // a following line, subject to the ordinary value-continuation rules.
    nextLine();
    const effParentCol = parentCol === ROOT_AFTER_INLINE_MARKER ? -1 : parentCol;
    node = parseDeferredBlockNode(effParentCol);
  } else {
    afterInlineProperty = true; // consumed by the very next parseBlockNode dispatch
    colOverride = anchorCol;
    node = parseBlockNode(parentCol);
  }
  if (pendingAnchorName === name) registerAnchor(name, node); // not yet consumed by a container/key
  pendingAnchorName = outerPending;
  return node;
}

/**
 * Resolve a block plain scalar, folding any continuation lines into it (YAML
 * plain multi-line: line breaks become single spaces). Continuation lines are
 * those indented deeper than `parentCol` — the indentation of the key or dash
 * that introduced the scalar, not the scalar's own (possibly inline) column.
 * Advances to the next content line.
 */
function resolveBlockPlain(start: number, end: number, parentCol: number): unknown {
  let breaks = advanceCountingBreaks();
  // A col-0 `---`/`...` always ends the node, even at the document root where
  // `parentCol` (-1, or -2 for ROOT_AFTER_INLINE_MARKER) can never itself be
  // "dedented past" by the `<=` check below — this is the one point doc 07 §4
  // calls out where block-plain scanning must special-case the marker. For any
  // nested scalar (parentCol >= 0) the dedent check alone already catches a
  // col-0 marker, so `isDocMarkerAt` short-circuits away and is never called.
  if (pos >= len || pos - lineStart <= parentCol || isDocMarkerAt(pos)) {
    // Single-line plain scalar (the overwhelming case): one span, typed once.
    return resolvePlain(start, end);
  }
  // Multi-line plain scalar (cold): fold the segments. YAML line-break folding —
  // a single break between content lines becomes a space; each *additional* break
  // (a blank line) is preserved as a newline. A multi-line plain scalar is always
  // a string (never re-typed as a number/bool).
  let result = src.slice(start, end);
  for (;;) {
    result += breaks > 1 ? "\n".repeat(breaks - 1) : " ";
    const segStart = pos;
    const segEnd = scanBlockPlainEnd();
    result += src.slice(segStart, segEnd);
    if (plainStoppedAtColon) fail("mapping value not allowed in a multi-line plain scalar");
    breaks = advanceCountingBreaks();
    if (pos >= len || pos - lineStart <= parentCol || isDocMarkerAt(pos)) break;
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
  skipInlineSpaces();
  if (pos < len && src.charCodeAt(pos) === HASH) {
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
    arr.push(parseBlockValue(col));
    if (pos >= len) break;
    if (pos - lineStart !== col) break;
    if (!(src.charCodeAt(pos) === MINUS && isSpaceOrEolAt(pos + 1))) break;
  }
  depth--;
  return arr;
}

function parseBlockMap(col: number, firstKey: string): Record<string, unknown> {
  if (++depth > MAX_DEPTH) fail("maximum nesting depth exceeded");
  const obj: Record<string, unknown> = {};
  registerPendingAnchor(obj); // before children (see parseFlowMap's identical call)
  let key = firstKey;
  for (;;) {
    // pos is at the ':' separator for `key`.
    pos++; // past ':'
    storeKey(obj, key, parseBlockValue(col));
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
    key = parseBlockMapKey();
  }
  depth--;
  return obj;
}

/** Parse the next key of a block mapping, leaving `pos` at the `:` separator. */
function parseBlockMapKey(): string {
  const c = src.charCodeAt(pos);
  if (c === AMP) return parseBlockMapKeyAnchored();
  if (c === STAR) {
    const value = parseAlias();
    skipInlineSpaces();
    if (src.charCodeAt(pos) !== COLON || !isSpaceOrEolAt(pos + 1)) fail("expected ':' after mapping key");
    return internKey(keyToString(value));
  }
  if (c === DQUOTE || c === SQUOTE || c === LBRACKET || c === LBRACE) {
    const node = registerPendingAnchor(c === DQUOTE ? parseDoubleQuoted() : c === SQUOTE ? parseSingleQuoted() : parseFlowValue());
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
 * the RAW key node, not yet canonicalized to a string.
 */
function parseBlockMapKeyAnchored(): string {
  pos++; // past '&'
  const name = scanAnchorOrAliasName();
  skipInlineSpaces();
  if (src.charCodeAt(pos) === STAR) fail("an alias node cannot carry an anchor property");
  const outerPending = pendingAnchorName;
  pendingAnchorName = name;
  const key = parseBlockMapKey(); // recurses into the quoted/flow/plain branches above
  pendingAnchorName = outerPending;
  return key;
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
function parseDeferredBlockNode(parentCol: number): unknown {
  if (pos >= len) return null;
  const nc = pos - lineStart;
  if (nc > parentCol) return parseBlockNode(parentCol);
  if (nc === parentCol && src.charCodeAt(pos) === MINUS && isSpaceOrEolAt(pos + 1)) {
    return parseBlockSeq(nc);
  }
  return null;
}

/**
 * Parse the value after a `:` (mapping) or `-` (sequence). An inline value is a
 * block node starting on the same line (this is how compact `- key: v` and
 * `key: [flow]` work); otherwise the value is a deeper-indented block node on the
 * following lines, or null. Always advances to the next content line.
 */
function parseBlockValue(parentCol: number): unknown {
  skipInlineSpaces();
  const c = pos < len ? src.charCodeAt(pos) : -1;
  if (c === -1 || c === LF || c === CR || c === HASH) {
    nextLine();
    return parseDeferredBlockNode(parentCol);
  }
  return parseBlockNode(parentCol); // inline / compact node at the current column
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
// prefix, exactly one `src.slice` per content line into a `parts` array, and a
// final `parts.join("")` — no `+=` rope-building, ever.
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

  // --- body: accumulate content-line text into `parts`, join once at the end ---
  const parts: string[] = [];
  let sawContent = false;
  let prevMoreIndented = false;
  let pendingBreaks = 0; // blank lines since the last pushed content line (0 = adjacent)

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
        if (pendingBreaks > 0) parts.push("\n".repeat(pendingBreaks));
        parts.push(text);
      } else if (!folded) {
        // Literal never folds: exactly one newline per line boundary, plus one
        // more per intervening blank line.
        parts.push("\n".repeat(pendingBreaks + 1), text);
      } else {
        const moreInvolved = prevMoreIndented || moreIndented;
        if (pendingBreaks === 0 && !moreInvolved) {
          parts.push(" ", text); // the one case that folds to a space
        } else if (moreInvolved) {
          // A more-indented line on either side of the break: never folds, and
          // the break "connecting" the two lines counts as one of its own — on
          // top of each intervening blank line (doc 07 §3.5's classic gotcha).
          parts.push("\n".repeat(pendingBreaks + 1), text);
        } else {
          // Plain content on both sides, separated by 1+ blank lines: each
          // blank line becomes exactly one newline (no extra "connecting" one —
          // it's absorbed into the blank run, unlike the more-indented case).
          parts.push("\n".repeat(pendingBreaks), text);
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

  const core = parts.join("");
  if (!sawContent) return chomp === 1 ? "\n".repeat(pendingBreaks) : "";
  if (chomp === -1) return core; // strip: no trailing break at all
  if (chomp === 1) return core + "\n".repeat(pendingBreaks + 1); // keep: every trailing break
  return core + "\n"; // clip (default): exactly one
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
 * (doc 07 §0 scope) and don't yet branch on the declared version, but per the
 * design recipe we do not reject 1.1 (or, pragmatically, any well-formed
 * MAJOR.MINOR): the directive's *shape* is validated (yaml-test-suite
 * H7TQ/9MMA expect a malformed or absent version, or trailing garbage after
 * it, to error), not its specific value.
 */
function parseYamlDirectiveArgs(): void {
  skipInlineSpaces();
  const tok = readDirectiveToken();
  if (!isYamlVersionToken(tok)) fail("malformed %YAML directive: expected a MAJOR.MINOR version");
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
 * yet; storing directives must not require them to be (design recipe).
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
  tagHandles.set(handle, prefix); // last-wins on a redefined handle, like the oracle
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
    value = pos >= len || isDocMarkerAt(pos) ? null : parseBlockNode(inline ? ROOT_AFTER_INLINE_MARKER : -1);
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
    value = parseBlockNode(-1);
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
