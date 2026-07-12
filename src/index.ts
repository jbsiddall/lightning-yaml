/**
 * lightning-yaml — a single-pass, allocation-minimal, pure-JS YAML parser
 * engineered for V8 (see docs/research/07-design-a-pure-js.md).
 *
 * The public surface mirrors `JSON.parse`:
 *   - `parse(text)`     text → JS value
 *   - `parseAll(text)`  text → array of document values (multi-doc; single-doc
 *                       for now — `---`/`...` splitting arrives with M5)
 *   - `stringify(value)` — the dumper is a later milestone; still a stub.
 *
 * Implementation status: the flow layer (JSON subset + YAML flow — plain scalars
 * with 1.2 core-schema typing, single quotes, comments, single-pair maps) is
 * implemented. Block structure (M3+) and the rich surface — anchors, tags,
 * `!!binary`, merge keys — are not here yet and throw a controlled parse error
 * rather than mis-parsing.
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
const SQUOTE = 39; // '
const PLUS = 43; // +
const COMMA = 44; // ,
const MINUS = 45; // -
const DOT = 46; // .
const ZERO = 48; // 0
const NINE = 57; // 9
const COLON = 58; // :
const QUESTION = 63; // ?
const UPPER_E = 69; // E
const LBRACKET = 91; // [
const BACKSLASH = 92; // \
const RBRACKET = 93; // ]
const UNDERSCORE = 95; // _
const LOWER_E = 101; // e
const LBRACE = 123; // {
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
 * Reset each parse so it can't grow unboundedly across calls.
 */
let keyCache: Map<string, string> = new Map();

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

/** Parse a single YAML document into a JS value. */
export function parse(text: string): unknown {
  src = text;
  len = text.length;
  pos = 0;
  depth = 0;
  nextBackslash = -1;
  lineStart = 0;
  keyCache = new Map();

  // Skip a leading BOM without copying the input.
  if (len > 0 && src.charCodeAt(0) === BOM) {
    pos = 1;
    lineStart = 1; // so the first line's content column is measured from here
  }

  skipBlankLines(); // land on the first content char, or EOF
  if (pos >= len) return null; // empty document → null (YAML), unlike JSON

  // Document markers (`---` start, `...` end) and multi-document streams are a
  // later milestone (M5). Reject them clearly rather than mis-reading a marker
  // as a plain scalar (`--- 5` must not parse to the string "--- 5").
  if (isDocMarkerAt(pos)) {
    throw new NotImplementedError("parse (document markers '---' / '...' and multi-document streams)");
  }

  const value = parseBlockNode(-1);

  if (pos < len) {
    if (isDocMarkerAt(pos)) {
      throw new NotImplementedError("parse (document markers '---' / '...' and multi-document streams)");
    }
    fail("unexpected trailing content after document");
  }
  return value;
}

/**
 * Parse a multi-document stream into an array of values. Multi-document
 * (`---`/`...`) splitting arrives with M5; for now this is a single document.
 */
export function parseAll(text: string): unknown[] {
  return [parse(text)];
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
 */
function plainKey(start: number, end: number): string {
  return internKey(keyToString(resolvePlain(start, end)));
}

/** A flow mapping key: double-quoted, single-quoted, or a plain scalar. */
function parseFlowKey(): string {
  const c = src.charCodeAt(pos);
  if (c === DQUOTE) return internKey(parseDoubleQuoted());
  if (c === SQUOTE) return internKey(parseSingleQuoted());
  const start = pos;
  const end = scanFlowPlainEnd();
  if (end === start) fail("expected a mapping key");
  return plainKey(start, end);
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
 * Parse one block node at the current position (its column is `pos - lineStart`).
 * Dispatches sequence / mapping / scalar, and — for a flow or plain scalar that
 * turns out to be a mapping key (followed by `: `) — an implicit-key mapping.
 * `parentCol` is the indentation of the construct that introduced this node
 * (used only to bound multi-line plain-scalar continuations). Always advances to
 * the start of the next content line before returning.
 */
function parseBlockNode(parentCol: number): unknown {
  const col = pos - lineStart;
  const c = src.charCodeAt(pos);

  if (c === MINUS && isSpaceOrEolAt(pos + 1)) {
    return parseBlockSeq(col);
  }

  // Block scalars are a later milestone (M4). A plain scalar can never begin
  // with `|`/`>`, so this is unambiguous — reject rather than silently fold the
  // header into a bogus plain scalar.
  if (c === 0x7c || c === 0x3e) {
    throw new NotImplementedError("parse (block scalars | and >)");
  }

  // Explicit block mapping keys (`? key` / `: value`) are a later milestone.
  // Reject the `? ` indicator rather than mis-reading it as a plain scalar.
  if (c === QUESTION && isSpaceOrEolAt(pos + 1)) {
    throw new NotImplementedError("parse (explicit block mapping keys '?' / ':')");
  }

  if (c === LBRACKET || c === LBRACE || c === DQUOTE || c === SQUOTE) {
    // A flow collection or quoted scalar — either the node itself, or a mapping
    // key if a `: ` separator follows on the same line.
    const node = c === DQUOTE ? parseDoubleQuoted() : c === SQUOTE ? parseSingleQuoted() : parseFlowValue();
    const save = pos;
    skipInlineSpaces();
    if (src.charCodeAt(pos) === COLON && isSpaceOrEolAt(pos + 1)) {
      return parseBlockMap(col, keyToString(node));
    }
    pos = save;
    nextLine();
    return node;
  }

  // Plain scalar: the scan stops at a `: ` separator iff this line is a mapping.
  const start = pos;
  const end = scanBlockPlainEnd();
  if (plainStoppedAtColon) {
    return parseBlockMap(col, plainKey(start, end));
  }
  return resolveBlockPlain(start, end, parentCol);
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
  if (pos >= len || pos - lineStart <= parentCol) {
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
    if (pos >= len || pos - lineStart <= parentCol) break;
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
  let key = firstKey;
  for (;;) {
    // pos is at the ':' separator for `key`.
    pos++; // past ':'
    storeKey(obj, key, parseBlockValue(col));
    if (pos >= len) break;
    const nc = pos - lineStart;
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
  if (c === DQUOTE || c === SQUOTE || c === LBRACKET || c === LBRACE) {
    const node = c === DQUOTE ? parseDoubleQuoted() : c === SQUOTE ? parseSingleQuoted() : parseFlowValue();
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
    if (pos < len) {
      const nc = pos - lineStart;
      if (nc > parentCol) return parseBlockNode(parentCol);
      // Special YAML rule: a block SEQUENCE may be indented at the SAME column as
      // its parent mapping key (the ubiquitous `key:\n- a\n- b` form), whereas a
      // block mapping value must be indented deeper.
      if (nc === parentCol && src.charCodeAt(pos) === MINUS && isSpaceOrEolAt(pos + 1)) {
        return parseBlockSeq(nc);
      }
    }
    return null; // empty value (dedent or EOF)
  }
  return parseBlockNode(parentCol); // inline / compact node at the current column
}
