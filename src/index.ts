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
 * Implementation status: the flow-level parser (JSON subset + YAML flow) is
 * landing incrementally (milestones M1, M2, …). Block structure (M3+) and the
 * rich surface — anchors, tags, `!!binary`, merge keys — are not here yet and
 * throw a controlled parse error rather than mis-parsing.
 *
 * Design invariants enforced throughout (V8 rules, see doc 12):
 *   - scan the flat JS string with `charCodeAt` (never `str[i]`) and hop long
 *     runs with `indexOf` (memchr/SIMD class); never decode to bytes;
 *   - materialize each scalar with exactly one `slice` from integer offsets;
 *   - accumulate small integers as Smis (`v*10 + d`), no intermediate string;
 *   - many small monomorphic functions, cold paths (errors, escapes) out of line;
 *   - module-level scalar state (non-reentrant, reset on entry) — no god-object
 *     with a polymorphic `result` field;
 *   - security from day one: `__proto__` never pollutes a prototype, and a hard
 *     recursion-depth cap turns deep-nesting attacks into a controlled throw.
 */

// ---------------------------------------------------------------------------
// Character codes (named for the ones that recur; keyword letters are inlined
// as hex at their single use site with a comment).
// ---------------------------------------------------------------------------

const TAB = 9;
const LF = 10;
const CR = 13;
const SPACE = 32;
const DQUOTE = 34; // "
const PLUS = 43; // +
const COMMA = 44; // ,
const MINUS = 45; // -
const DOT = 46; // .
const ZERO = 48; // 0
const NINE = 57; // 9
const COLON = 58; // :
const UPPER_E = 69; // E
const LBRACKET = 91; // [
const BACKSLASH = 92; // \
const RBRACKET = 93; // ]
const UNDERSCORE = 95; // _
const LOWER_E = 101; // e
const LBRACE = 123; // {
const RBRACE = 125; // }
const BOM = 0xfeff;

/**
 * Hard recursion cap. Pure recursive descent would otherwise throw a native
 * `RangeError` on deeply nested input (an attack, not a use case) where
 * `JSON.parse` degrades to an iterative fallback. We turn it into a controlled
 * parse error well before the engine stack limit. js-yaml ships the same guard.
 */
const MAX_DEPTH = 1000;

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
  keyCache = new Map();

  // Skip a leading BOM without copying the input.
  if (len > 0 && src.charCodeAt(0) === BOM) pos = 1;

  skipFlowWs();
  if (pos >= len) return null; // empty document → null (YAML), unlike JSON

  const value = parseFlowValue();

  skipFlowWs();
  if (pos < len) fail("unexpected trailing content after document");
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
// Whitespace
// ---------------------------------------------------------------------------

/**
 * Skip inter-token whitespace in flow context: spaces, tabs, and line breaks
 * (flow collections may span lines). A local cursor keeps the loop off the
 * module global until it writes back once.
 */
function skipFlowWs(): void {
  let p = pos;
  while (p < len) {
    const c = src.charCodeAt(p);
    if (c === SPACE || c === TAB || c === LF || c === CR) {
      p++;
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
    case 0x74: // t → true
    case 0x66: // f → false
    case 0x6e: // n → null
      return parseKeyword();
    case MINUS:
      return parseNumber();
    default:
      if (c >= ZERO && c <= NINE) return parseNumber();
      fail("unexpected character");
  }
}

// ---------------------------------------------------------------------------
// Flow sequence  [ a, b, c ]
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
    arr.push(parseFlowValue());
    skipFlowWs();
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

// ---------------------------------------------------------------------------
// Flow mapping  { "k": v, ... }
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
    const key = parseFlowKey();
    skipFlowWs();
    if (src.charCodeAt(pos) !== COLON) fail("expected ':' in flow mapping");
    pos++;
    skipFlowWs();
    const value = parseFlowValue();
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

/** A flow mapping key. JSON keys are double-quoted; interned into the cache. */
function parseFlowKey(): string {
  if (src.charCodeAt(pos) === DQUOTE) return internKey(parseDoubleQuoted());
  fail("expected a string key in flow mapping");
}

/** Return the cached copy of `s` if seen this parse, else record and return it. */
function internKey(s: string): string {
  const hit = keyCache.get(s);
  if (hit !== undefined) return hit;
  keyCache.set(s, s);
  return s;
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
 * line-folding land in M2.
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
        case 0x62: // b
          result += "\b";
          i++;
          break;
        case 0x66: // f
          result += "\f";
          i++;
          break;
        case 0x6e: // n
          result += "\n";
          i++;
          break;
        case 0x72: // r
          result += "\r";
          i++;
          break;
        case 0x74: // t
          result += "\t";
          i++;
          break;
        case 0x75: // u
          result += String.fromCharCode(hex4(i + 1));
          i += 5;
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

function hex4(i: number): number {
  if (i + 3 >= len) fail("truncated \\u escape");
  return (
    (hexVal(src.charCodeAt(i)) << 12) |
    (hexVal(src.charCodeAt(i + 1)) << 8) |
    (hexVal(src.charCodeAt(i + 2)) << 4) |
    hexVal(src.charCodeAt(i + 3))
  );
}

function hexVal(c: number): number {
  if (c >= ZERO && c <= NINE) return c - ZERO;
  if (c >= 0x61 && c <= 0x66) return c - 0x57; // a-f
  if (c >= 0x41 && c <= 0x46) return c - 0x37; // A-F
  fail("invalid hex digit in \\u escape");
}

// ---------------------------------------------------------------------------
// Numbers — Smi accumulation for small integers, single slice for floats/bignum.
// ---------------------------------------------------------------------------

function parseNumber(): number {
  const start = pos;
  let p = pos;
  let c = src.charCodeAt(p);
  const neg = c === MINUS;
  if (neg) {
    p++;
    c = src.charCodeAt(p);
  }
  // Integer digits accumulate exactly in a double up to 15 significant digits
  // (< 2^53); int32-range results are Smis — zero allocation, zero string.
  let v = 0;
  let nd = 0;
  while (c >= ZERO && c <= NINE) {
    v = v * 10 + (c - ZERO);
    nd++;
    p++;
    c = src.charCodeAt(p);
  }
  if (c === DOT || c === LOWER_E || c === UPPER_E) {
    // Fraction / exponent → validate the shape, then let Number() convert once.
    // Number() is the converter, never the validator (it accepts "Infinity"
    // etc., which must stay strings), so we scan the grammar ourselves first.
    if (c === DOT) {
      p++;
      c = src.charCodeAt(p);
      while (c >= ZERO && c <= NINE) {
        p++;
        c = src.charCodeAt(p);
      }
    }
    if (c === LOWER_E || c === UPPER_E) {
      p++;
      c = src.charCodeAt(p);
      if (c === PLUS || c === MINUS) {
        p++;
        c = src.charCodeAt(p);
      }
      let ed = 0;
      while (c >= ZERO && c <= NINE) {
        p++;
        c = src.charCodeAt(p);
        ed++;
      }
      if (ed === 0) fail("missing exponent digits in number");
    }
    pos = p;
    return +src.slice(start, p);
  }
  if (nd === 0) fail("invalid number");
  pos = p;
  if (nd <= 15) return neg ? -v : v;
  return +src.slice(start, p); // > 15 digits: let Number() round like JSON.parse
}

// ---------------------------------------------------------------------------
// Keywords — true / false / null (the only unquoted non-number JSON tokens).
// M2 folds these into plain-scalar typing (resolvePlain).
// ---------------------------------------------------------------------------

function parseKeyword(): unknown {
  const c = src.charCodeAt(pos);
  if (c === 0x74) {
    // true
    if (
      src.charCodeAt(pos + 1) === 0x72 &&
      src.charCodeAt(pos + 2) === 0x75 &&
      src.charCodeAt(pos + 3) === 0x65
    ) {
      pos += 4;
      return true;
    }
  } else if (c === 0x66) {
    // false
    if (
      src.charCodeAt(pos + 1) === 0x61 &&
      src.charCodeAt(pos + 2) === 0x6c &&
      src.charCodeAt(pos + 3) === 0x73 &&
      src.charCodeAt(pos + 4) === 0x65
    ) {
      pos += 5;
      return false;
    }
  } else {
    // null
    if (
      src.charCodeAt(pos + 1) === 0x75 &&
      src.charCodeAt(pos + 2) === 0x6c &&
      src.charCodeAt(pos + 3) === 0x6c
    ) {
      pos += 4;
      return null;
    }
  }
  fail("invalid token");
}
