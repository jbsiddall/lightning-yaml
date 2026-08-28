/**
 * Core YAML parser — single-pass, recursive-descent, integer cursors.
 *
 * Architecture (thesis §2-4):
 * - Scans the flat input string with a numeric cursor
 * - charCodeAt + Uint8Array(256) class tables for branchless dispatch
 * - indexOf for line/quote/comment/doc-marker hops
 * - Deferred string slicing (start/end recorded, slice on commit)
 * - SMI int fast path for plain-scalar integers
 * - First-char-gated scalar typing, string as default fall-through
 * - Fixed-shape monomorphic node classes (all fields in constructor)
 * - O(n) dup-key check via Set (skipped when uniqueKeys:false)
 * - Comments attached to nodes: commentBefore / comment / spaceBefore
 *
 * NO token objects, NO CST. Emits AST nodes directly.
 */

import {
  Scalar, YAMLMap, YAMLSeq, Pair, Alias,
  isMap, isSeq,
  SCALAR_PLAIN, SCALAR_SINGLE, SCALAR_DOUBLE, SCALAR_FOLDED, SCALAR_LITERAL,
  type Node, type Range,
} from './nodes.ts';
import { YAMLParseError, YAMLWarning, offsetToLineCol } from './errors.ts';
import type { ParseOptions, CustomTag } from './options.ts';

// ---- Character class table -------------------------------------------------

const CC_WS = 1;       // space, tab
const CC_NL = 2;       // \n, \r
const CC_DIGIT = 4;
const CC_ALPHA = 8;
const CC_HEX = 16;
const CC_PUNCT = 32;   // flow indicators, :, #, etc.
const CC_INDICATOR = 64; // ,[]{}#&*!|>'"%@`

const CT = new Uint8Array(256);
// Whitespace
CT[0x20] = CC_WS; // space
CT[0x09] = CC_WS; // tab
// Newlines
CT[0x0A] = CC_NL; // \n
CT[0x0D] = CC_NL; // \r
// Digits
for (let i = 0x30; i <= 0x39; i++) CT[i] = CC_DIGIT | CC_HEX;
// Hex letters
for (let i = 0x41; i <= 0x46; i++) CT[i] = CC_ALPHA | CC_HEX; // A-F
for (let i = 0x61; i <= 0x66; i++) CT[i] = CC_ALPHA | CC_HEX; // a-f
// Alpha
for (let i = 0x47; i <= 0x5A; i++) CT[i] = CC_ALPHA; // G-Z
for (let i = 0x67; i <= 0x7A; i++) CT[i] = CC_ALPHA; // g-z
CT[0x5F] = CC_ALPHA; // _
// Flow indicators
CT[0x2C] = CC_INDICATOR; // ,
CT[0x5B] = CC_INDICATOR; // [
CT[0x5D] = CC_INDICATOR; // ]
CT[0x7B] = CC_INDICATOR; // {
CT[0x7D] = CC_INDICATOR; // }
// Other indicators
CT[0x23] = CC_INDICATOR; // #
CT[0x26] = CC_INDICATOR; // &
CT[0x2A] = CC_INDICATOR; // *
CT[0x21] = CC_INDICATOR; // !
CT[0x7C] = CC_INDICATOR; // |
CT[0x3E] = CC_INDICATOR; // >
CT[0x27] = CC_INDICATOR; // '
CT[0x22] = CC_INDICATOR; // "
CT[0x25] = CC_INDICATOR; // %
CT[0x40] = CC_INDICATOR; // @
CT[0x60] = CC_INDICATOR; // `

// ---- Line tracking ---------------------------------------------------------

export class LineCounter {
  lineStarts: number[] = [];

  addNewLine = (offset: number): number => {
    this.lineStarts.push(offset);
    return this.lineStarts.length;
  };

  linePos = (offset: number): { line: number; col: number } => {
    const ls = this.lineStarts;
    if (ls.length === 0) return { line: 0, col: offset };
    let lo = 0, hi = ls.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ls[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, col: offset - ls[lo]! + 1 };
  };
}

// ---- Directives ------------------------------------------------------------

interface Directives {
  yaml: { explicit: boolean; version: string };
  tags: Record<string, string>;
  docStart: boolean;
  docEnd: boolean;
}

function defaultDirectives(): Directives {
  return {
    yaml: { explicit: false, version: '1.2' },
    tags: { '!!': 'tag:yaml.org,2002:' },
    docStart: false,
    docEnd: false,
  };
}

// ---- Parser ----------------------------------------------------------------

export class Parser {
  // Input
  private src: string;
  private len: number;

  // Cursor
  private pos: number;

  // Options
  private version: '1.1' | '1.2';
  private strict: boolean;
  private tabsScanned = false;
  private uniqueKeys: boolean;
  private merge: boolean;
  private customTags: CustomTag[];
  private lineCounter: LineCounter | null;

  // State
  private errors: YAMLParseError[];
  private warnings: YAMLWarning[];
  private anchors: Map<string, Node>;
  private directives: Directives;

  // Comment collection: pending comments before next node
  private pendingCommentBefore: string[];
  // Trailing comment on previous node (will be attached when next node starts)
  private pendingTrailingComment: string | null;
  // Track if we saw a blank line before current position (for spaceBefore)
  private hadBlankLine: boolean;
  // Whether a blank line separates the last pending comment from upcoming content
  private blankAfterLastComment: boolean;

  constructor(src: string, opts?: ParseOptions) {
    this.src = src;
    this.len = src.length;
    this.pos = 0;
    this.version = opts?.version ?? '1.2';
    this.strict = opts?.strict ?? true;
    this.uniqueKeys = opts?.uniqueKeys ?? true;
    this.merge = opts?.merge ?? false;
    this.customTags = opts?.customTags ?? [];
    this.lineCounter = (opts?.lineCounter as LineCounter) ?? null;
    this.errors = [];
    this.warnings = [];
    this.anchors = new Map();
    this.directives = defaultDirectives();
    this.pendingCommentBefore = [];
    this.pendingTrailingComment = null;
    this.hadBlankLine = false;
    this.blankAfterLastComment = false;

    // Track newlines for LineCounter
    if (this.lineCounter) {
      this.lineCounter.addNewLine(0);
      for (let i = 0; i < src.length; i++) {
        if (src.charCodeAt(i) === 0x0A) {
          this.lineCounter.addNewLine(i + 1);
        }
      }
    }
  }

  // ---- Error helpers -------------------------------------------------------

  private error(offset: number, message: string, code?: string): YAMLParseError {
    const lc = this.lineCounter
      ? [this.lineCounter.linePos(offset)]
      : [offsetToLineCol(this.src, offset)];
    const e = new YAMLParseError(offset, message, lc, code);
    this.errors.push(e);
    return e;
  }

  private warn(offset: number, message: string): YAMLWarning {
    const lc = this.lineCounter
      ? [this.lineCounter.linePos(offset)]
      : [offsetToLineCol(this.src, offset)];
    const w = new YAMLWarning(offset, message, lc);
    this.warnings.push(w);
    return w;
  }

  // ---- Character helpers ---------------------------------------------------

  private ch(): number {
    return this.pos < this.len ? this.src.charCodeAt(this.pos) : -1;
  }

  private chAt(p: number): number {
    return p < this.len ? this.src.charCodeAt(p) : -1;
  }

  private atEnd(): boolean {
    return this.pos >= this.len;
  }

  private advance(): void {
    this.pos++;
  }

  private skipWs(): void {
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (c !== 0x20 && c !== 0x09) break;
      this.pos++;
    }
  }

  private skipWsInline(): void {
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (c !== 0x20 && c !== 0x09) break;
      this.pos++;
    }
  }

  private skipLine(): void {
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (c === 0x0A) {
        this.pos++;
        return;
      }
      if (c === 0x0D) {
        this.pos++;
        if (this.pos < this.len && this.src.charCodeAt(this.pos) === 0x0A) this.pos++;
        return;
      }
      this.pos++;
    }
  }

  private skipNewlines(): void {
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (c === 0x0A) {
        this.pos++;
        this.hadBlankLine = true;
      } else if (c === 0x0D) {
        this.pos++;
        if (this.pos < this.len && this.src.charCodeAt(this.pos) === 0x0A) this.pos++;
        this.hadBlankLine = true;
      } else {
        break;
      }
    }
  }

  private isWsOrNl(c: number): boolean {
    return c === 0x20 || c === 0x09 || c === 0x0A || c === 0x0D;
  }

  /**
   * Find end-of-line from a given position (returns the offset PAST the newline).
   * Used to set value range[2] (nodeEnd) to match eemeli's convention where
   * value nodeEnd extends to end of the containing line.
   */
  private endOfLine(from: number): number {
    let p = from;
    while (p < this.len) {
      const c = this.src.charCodeAt(p);
      if (c === 0x0A) return p + 1;
      if (c === 0x0D) {
        return p + 1 < this.len && this.src.charCodeAt(p + 1) === 0x0A ? p + 2 : p + 1;
      }
      p++;
    }
    return this.len;
  }

  /**
   * Find the end of the last content line — walks backward from streamEnd,
   * skipping trailing blank lines and comment-only lines. Returns the offset
   * past the terminating newline of the last content line.
   */
  private contentLineEnd(streamEnd: number): number {
    let p = streamEnd;
    while (p > 0) {
      // Walk backward to start of current line
      let lineEnd = p;
      // Skip trailing whitespace on this line (spaces/tabs before lineEnd)
      let q = p - 1;
      while (q >= 0 && (this.src.charCodeAt(q) === 0x20 || this.src.charCodeAt(q) === 0x09)) q--;
      // Check if we're at a newline boundary
      if (q >= 0 && (this.src.charCodeAt(q) === 0x0A || this.src.charCodeAt(q) === 0x0D)) {
        // This was a blank line — skip it
        p = q;
        if (this.src.charCodeAt(q) === 0x0A && q > 0 && this.src.charCodeAt(q - 1) === 0x0D) p = q - 1;
        continue;
      }
      // Walk back to start of this line
      let lineStart = q;
      while (lineStart > 0 && this.src.charCodeAt(lineStart - 1) !== 0x0A && this.src.charCodeAt(lineStart - 1) !== 0x0D) {
        lineStart--;
      }
      // Check if this line is a comment-only line
      let firstNonWs = lineStart;
      while (firstNonWs <= q && (this.src.charCodeAt(firstNonWs) === 0x20 || this.src.charCodeAt(firstNonWs) === 0x09)) {
        firstNonWs++;
      }
      if (firstNonWs <= q && this.src.charCodeAt(firstNonWs) === 0x23) {
        // Comment-only line — skip it
        p = lineStart > 0 ? lineStart - 1 : 0;
        if (p > 0 && this.src.charCodeAt(p) === 0x0D && p + 1 < streamEnd && this.src.charCodeAt(p + 1) === 0x0A) {
          // Skip \r of \r\n
        }
        continue;
      }
      // This is a content line — return end of this line (past its newline)
      return this.endOfLine(q);
    }
    return 0;
  }

  // ---- Comment collection --------------------------------------------------

  /**
   * Skip whitespace, newlines, and comments. Collects comments into
   * pendingCommentBefore (leading) or pendingTrailingComment (trailing).
   * Returns true if a newline was crossed (for spaceBefore detection).
   */
  private skipWsAndComments(): boolean {
    let crossedNewline = false;
    let consecutiveNewlines = 0;
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (c === 0x20 || c === 0x09) {
        this.pos++;
      } else if (c === 0x0A) {
        this.pos++;
        crossedNewline = true;
        consecutiveNewlines++;
        if (consecutiveNewlines >= 2) this.hadBlankLine = true;
      } else if (c === 0x0D) {
        this.pos++;
        if (this.pos < this.len && this.src.charCodeAt(this.pos) === 0x0A) this.pos++;
        crossedNewline = true;
        consecutiveNewlines++;
        if (consecutiveNewlines >= 2) this.hadBlankLine = true;
      } else if (c === 0x23) { // #
        // If we have pending comments and saw a blank line, mark it
        if (this.pendingCommentBefore.length > 0 && consecutiveNewlines >= 2) {
          this.blankAfterLastComment = true;
        }
        consecutiveNewlines = 0;
        const start = this.pos;
        this.pos++; // skip #
        while (this.pos < this.len) {
          const cc = this.src.charCodeAt(this.pos);
          if (cc === 0x0A || cc === 0x0D) break;
          this.pos++;
        }
        const commentText = this.src.slice(start + 1, this.pos);
        if (crossedNewline || this.pendingCommentBefore.length > 0 || this.pendingTrailingComment === null) {
          this.pendingCommentBefore.push(commentText);
          this.blankAfterLastComment = false; // comment is adjacent to what follows
        } else {
          // Trailing comment on same line (after content)
          this.pendingTrailingComment = commentText;
        }
      } else {
        break;
      }
    }
    // If we have pending comments and saw a blank line after the last one
    if (this.pendingCommentBefore.length > 0 && consecutiveNewlines >= 2) {
      this.blankAfterLastComment = true;
    }
    return crossedNewline;
  }

  /**
   * Skip only inline whitespace + trailing comment on the current line.
   * Does NOT cross newlines.
   */
  private skipInlineComment(): string | null {
    this.skipWs();
    if (this.pos < this.len && this.src.charCodeAt(this.pos) === 0x23) {
      const start = this.pos + 1;
      this.pos++;
      while (this.pos < this.len) {
        const c = this.src.charCodeAt(this.pos);
        if (c === 0x0A || c === 0x0D) break;
        this.pos++;
      }
      return this.src.slice(start, this.pos);
    }
    return null;
  }

  private consumePendingCommentBefore(): string | null {
    if (this.pendingCommentBefore.length === 0) return null;
    let result = this.pendingCommentBefore.join('\n');
    // M1: preserve blank line between comment block and following content
    if (this.blankAfterLastComment) {
      result += '\n';
      this.blankAfterLastComment = false;
      // The blank line after the comment also sets hadBlankLine; clear it so
      // spaceBefore isn't redundantly set (the trailing \n already captures it)
      this.hadBlankLine = false;
    }
    this.pendingCommentBefore = [];
    return result;
  }

  private consumePendingTrailing(): string | null {
    const r = this.pendingTrailingComment;
    this.pendingTrailingComment = null;
    return r;
  }

  // ---- Indent helpers ------------------------------------------------------

  private currentIndent(): number {
    let indent = 0;
    let p = this.pos;
    while (p < this.len && this.src.charCodeAt(p) === 0x20) {
      indent++;
      p++;
    }
    return indent;
  }

  private currentColumn(): number {
    // Count spaces from start of current line
    let p = this.pos;
    while (p > 0) {
      const c = this.src.charCodeAt(p - 1);
      if (c === 0x0A || c === 0x0D) break;
      p--;
    }
    return this.pos - p;
  }

  // ---- Scalar typing -------------------------------------------------------

  private resolvePlainScalar(text: string): unknown {
    if (text === '') return null;

    // Check custom tags first
    for (const ct of this.customTags) {
      if (ct.test && ct.test(text)) {
        return ct.resolve(text);
      }
    }

    const v11 = this.version === '1.1';

    // null
    if (text === 'null' || text === 'Null' || text === 'NULL' || text === '~') return null;
    if (v11 && (text === '' )) return null;

    // boolean
    if (text === 'true' || text === 'True' || text === 'TRUE') return true;
    if (text === 'false' || text === 'False' || text === 'FALSE') return false;
    if (v11) {
      if (text === 'yes' || text === 'Yes' || text === 'YES') return true;
      if (text === 'no' || text === 'No' || text === 'NO') return false;
      if (text === 'on' || text === 'On' || text === 'ON') return true;
      if (text === 'off' || text === 'Off' || text === 'OFF') return false;
    }

    // integer — SMI fast path
    const n = text.length;
    if (n > 0 && n <= 9) {
      let sign = 1;
      let start = 0;
      if (text.charCodeAt(0) === 0x2D) { sign = -1; start = 1; } // -
      else if (text.charCodeAt(0) === 0x2B) { start = 1; } // +
      if (start < n) {
        let allDigits = true;
        let v = 0;
        for (let i = start; i < n; i++) {
          const c = text.charCodeAt(i);
          if (c < 0x30 || c > 0x39) { allDigits = false; break; }
          v = v * 10 + (c - 0x30);
        }
        if (allDigits && start < n) return sign * v;
      }
    }

    // Octal integer (0o prefix, or v1.1 leading 0)
    if (n > 2 && text.charCodeAt(0) === 0x30) {
      const c1 = text.charCodeAt(1);
      if (c1 === 0x6F || c1 === 0x4F) { // 0o or 0O
        let v = 0;
        let valid = true;
        for (let i = 2; i < n; i++) {
          const c = text.charCodeAt(i);
          if (c < 0x30 || c > 0x37) { valid = false; break; }
          v = v * 8 + (c - 0x30);
        }
        if (valid && n > 2) return v;
      }
      if (v11 && n > 1) {
        // YAML 1.1 octal: leading 0 + octal digits
        let v = 0;
        let valid = true;
        let hasDigit = false;
        for (let i = 1; i < n; i++) {
          const c = text.charCodeAt(i);
          if (c >= 0x30 && c <= 0x37) { v = v * 8 + (c - 0x30); hasDigit = true; }
          else { valid = false; break; }
        }
        if (valid && hasDigit) return v;
      }
    }

    // Hex integer (0x prefix)
    if (n > 2 && text.charCodeAt(0) === 0x30 && (text.charCodeAt(1) === 0x78 || text.charCodeAt(1) === 0x58)) {
      let v = 0;
      let valid = true;
      for (let i = 2; i < n; i++) {
        const c = text.charCodeAt(i);
        if (c >= 0x30 && c <= 0x39) v = v * 16 + (c - 0x30);
        else if (c >= 0x41 && c <= 0x46) v = v * 16 + (c - 0x37);
        else if (c >= 0x61 && c <= 0x66) v = v * 16 + (c - 0x57);
        else { valid = false; break; }
      }
      if (valid && n > 2) return v;
    }

    // Float
    if (text === '.inf' || text === '.Inf' || text === '.INF') return Infinity;
    if (text === '-.inf' || text === '-.Inf' || text === '-.INF') return -Infinity;
    if (text === '.nan' || text === '.NaN' || text === '.NAN') return NaN;

    // Try parseFloat
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) {
      const f = parseFloat(text);
      if (Number.isFinite(f)) return f;
    }

    // Default: string
    return text;
  }

  // ---- Scalar parsing ------------------------------------------------------

  private parseDoubleQuoted(start: number): Scalar {
    this.pos++; // skip opening "
    let result = '';
    let chunkStart = this.pos;
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (c === 0x22) { // closing "
        if (chunkStart < this.pos) result += this.src.slice(chunkStart, this.pos);
        this.pos++; // skip closing "
        const node = new Scalar(result, SCALAR_DOUBLE);
        node.range = [start, this.pos, this.pos];
        return node;
      }
      if (c === 0x5C) { // backslash
        if (chunkStart < this.pos) result += this.src.slice(chunkStart, this.pos);
        this.pos++; // skip \
        if (this.pos >= this.len) {
          this.error(this.pos, 'Unexpected end of input in double-quoted string');
          break;
        }
        const esc = this.src.charCodeAt(this.pos);
        switch (esc) {
          case 0x30: result += '\0'; this.pos++; break; // \0
          case 0x61: result += '\x07'; this.pos++; break; // \a
          case 0x62: result += '\b'; this.pos++; break; // \b
          case 0x74: result += '\t'; this.pos++; break; // \t
          case 0x6E: result += '\n'; this.pos++; break; // \n
          case 0x76: result += '\x0B'; this.pos++; break; // \v
          case 0x66: result += '\f'; this.pos++; break; // \f
          case 0x72: result += '\r'; this.pos++; break; // \r
          case 0x65: result += '\x1B'; this.pos++; break; // \e
          case 0x20: result += ' '; this.pos++; break; // \ (space)
          case 0x22: result += '"'; this.pos++; break; // \"
          case 0x2F: result += '/'; this.pos++; break; // \/
          case 0x5C: result += '\\'; this.pos++; break; // \\
          case 0x4E: result += '\x85'; this.pos++; break; // \N (NEL)
          case 0x5F: result += '\xA0'; this.pos++; break; // \_ (NBSP)
          case 0x4C: result += ' '; this.pos++; break; // \L (LS)
          case 0x50: result += ' '; this.pos++; break; // \P (PS)
          case 0x78: { // \xNN
            this.pos++;
            const hex = this.src.slice(this.pos, this.pos + 2);
            result += String.fromCharCode(parseInt(hex, 16));
            this.pos += 2;
            break;
          }
          case 0x75: { // \uNNNN
            this.pos++;
            const hex = this.src.slice(this.pos, this.pos + 4);
            result += String.fromCharCode(parseInt(hex, 16));
            this.pos += 4;
            break;
          }
          case 0x55: { // \UNNNNNNNN
            this.pos++;
            const hex = this.src.slice(this.pos, this.pos + 8);
            result += String.fromCodePoint(parseInt(hex, 16));
            this.pos += 8;
            break;
          }
          case 0x0A: // \\\n (line continuation)
          case 0x0D:
            this.pos++;
            if (esc === 0x0D && this.pos < this.len && this.src.charCodeAt(this.pos) === 0x0A) this.pos++;
            // Skip leading whitespace on continuation line
            while (this.pos < this.len && (this.src.charCodeAt(this.pos) === 0x20 || this.src.charCodeAt(this.pos) === 0x09)) this.pos++;
            break;
          default:
            this.error(this.pos, `Unknown escape character: ${String.fromCharCode(esc)}`);
            result += String.fromCharCode(esc);
            this.pos++;
        }
        chunkStart = this.pos;
      } else if (c === 0x0A || c === 0x0D) {
        // Line folding in double-quoted
        if (chunkStart < this.pos) result += this.src.slice(chunkStart, this.pos);
        if (c === 0x0D) {
          this.pos++;
          if (this.pos < this.len && this.src.charCodeAt(this.pos) === 0x0A) this.pos++;
        } else {
          this.pos++;
        }
        // Skip leading whitespace on continuation line
        let wsCount = 0;
        while (this.pos < this.len && (this.src.charCodeAt(this.pos) === 0x20 || this.src.charCodeAt(this.pos) === 0x09)) {
          wsCount++;
          this.pos++;
        }
        // Check if continuation line is empty (blank line = keep newlines)
        if (wsCount === 0 || this.pos >= this.len ||
            (this.src.charCodeAt(this.pos) !== 0x0A && this.src.charCodeAt(this.pos) !== 0x0D)) {
          if (wsCount === 0) {
            result += '\n';
          } else {
            result += ' ';
          }
        } else {
          // Multiple blank lines: preserve all but the first
          result += '\n';
        }
        chunkStart = this.pos;
      } else {
        this.pos++;
      }
    }
    if (chunkStart < this.pos) result += this.src.slice(chunkStart, this.pos);
    this.error(start, 'Unterminated double-quoted scalar');
    const node = new Scalar(result, SCALAR_DOUBLE);
    node.range = [start, this.pos, this.pos];
    return node;
  }

  private parseSingleQuoted(start: number): Scalar {
    this.pos++; // skip opening '
    let result = '';
    let chunkStart = this.pos;
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (c === 0x27) { // '
        // Check for escaped '' -> '
        if (this.pos + 1 < this.len && this.src.charCodeAt(this.pos + 1) === 0x27) {
          result += this.src.slice(chunkStart, this.pos) + "'";
          this.pos += 2;
          chunkStart = this.pos;
          continue;
        }
        // End of scalar
        result += this.src.slice(chunkStart, this.pos);
        this.pos++; // skip closing '
        const node = new Scalar(result, SCALAR_SINGLE);
        node.range = [start, this.pos, this.pos];
        return node;
      }
      if (c === 0x0A || c === 0x0D) {
        // Line folding in single-quoted
        result += this.src.slice(chunkStart, this.pos);
        if (c === 0x0D) {
          this.pos++;
          if (this.pos < this.len && this.src.charCodeAt(this.pos) === 0x0A) this.pos++;
        } else {
          this.pos++;
        }
        // Skip leading whitespace
        let wsCount = 0;
        while (this.pos < this.len && (this.src.charCodeAt(this.pos) === 0x20 || this.src.charCodeAt(this.pos) === 0x09)) {
          wsCount++;
          this.pos++;
        }
        if (wsCount === 0) {
          result += '\n';
        } else {
          result += ' ';
        }
        chunkStart = this.pos;
      } else {
        this.pos++;
      }
    }
    result += this.src.slice(chunkStart, this.pos);
    this.error(start, 'Unterminated single-quoted scalar');
    const node = new Scalar(result, SCALAR_SINGLE);
    node.range = [start, this.pos, this.pos];
    return node;
  }

  private parseBlockScalar(start: number): Scalar {
    const c = this.src.charCodeAt(this.pos);
    const isLiteral = c === 0x7C; // |
    const type = isLiteral ? SCALAR_LITERAL : SCALAR_FOLDED;
    this.pos++; // skip | or >

    // Chomping and indent indicators
    let chomp: 'clip' | 'strip' | 'keep' = 'clip';
    let indent = -1;
    while (this.pos < this.len) {
      const cc = this.src.charCodeAt(this.pos);
      if (cc === 0x2D) { chomp = 'strip'; this.pos++; }
      else if (cc === 0x2B) { chomp = 'keep'; this.pos++; }
      else if (cc >= 0x31 && cc <= 0x39) { indent = cc - 0x30; this.pos++; }
      else if (cc === 0x20 || cc === 0x09) { this.pos++; }
      else if (cc === 0x23) {
        // Inline comment after indicator
        while (this.pos < this.len && this.src.charCodeAt(this.pos) !== 0x0A && this.src.charCodeAt(this.pos) !== 0x0D) this.pos++;
        break;
      }
      else if (cc === 0x0A || cc === 0x0D) break;
      else break;
    }

    // Skip to end of header line
    while (this.pos < this.len) {
      const cc = this.src.charCodeAt(this.pos);
      if (cc === 0x0A) { this.pos++; break; }
      if (cc === 0x0D) { this.pos++; if (this.pos < this.len && this.src.charCodeAt(this.pos) === 0x0A) this.pos++; break; }
      this.pos++;
    }

    // Determine the indentation of the block content
    const baseIndent = this.currentColumn();
    if (indent < 0) {
      // Auto-detect: find first non-empty line's indent
      let scanPos = this.pos;
      while (scanPos < this.len) {
        const cc = this.src.charCodeAt(scanPos);
        if (cc === 0x0A || cc === 0x0D) {
          scanPos++;
          if (cc === 0x0D && scanPos < this.len && this.src.charCodeAt(scanPos) === 0x0A) scanPos++;
          continue;
        }
        if (cc === 0x20) {
          scanPos++;
          continue;
        }
        // Found first non-space, non-empty line
        let lineIndent = 0;
        let p = scanPos;
        while (p > 0 && this.src.charCodeAt(p - 1) !== 0x0A && this.src.charCodeAt(p - 1) !== 0x0D) {
          p--;
        }
        lineIndent = scanPos - p;
        // Walk back to find the indent of this line
        let li = 0;
        let pp = scanPos;
        while (pp > 0) {
          const pc = this.src.charCodeAt(pp - 1);
          if (pc === 0x0A || pc === 0x0D) break;
          pp--;
        }
        while (pp < scanPos && this.src.charCodeAt(pp) === 0x20) { li++; pp++; }
        indent = li > baseIndent ? li : baseIndent + 1;
        break;
      }
      if (indent < 0) indent = baseIndent + 1; // empty block
    } else {
      indent = baseIndent + indent;
    }

    // Read the block content
    let result = '';
    const lines: string[] = [];
    const trailingBlanks: number[] = [];
    let trailingBlankCount = 0;

    while (this.pos < this.len) {
      // Check indent
      let lineIndent = 0;
      const lineStart = this.pos;
      while (this.pos < this.len && this.src.charCodeAt(this.pos) === 0x20) {
        lineIndent++;
        this.pos++;
      }

      // Empty line
      if (this.pos >= this.len || this.src.charCodeAt(this.pos) === 0x0A || this.src.charCodeAt(this.pos) === 0x0D) {
        trailingBlankCount++;
        // Skip the newline
        if (this.pos < this.len) {
          if (this.src.charCodeAt(this.pos) === 0x0D) {
            this.pos++;
            if (this.pos < this.len && this.src.charCodeAt(this.pos) === 0x0A) this.pos++;
          } else {
            this.pos++;
          }
        }
        continue;
      }

      // If indent is less than expected, end of block
      if (lineIndent < indent) {
        this.pos = lineStart; // back up
        break;
      }

      // Flush trailing blank lines as content
      for (let b = 0; b < trailingBlankCount; b++) {
        lines.push('');
      }
      trailingBlankCount = 0;

      // Read the line content (skip the indent spaces)
      const contentStart = this.pos;
      while (this.pos < this.len) {
        const cc = this.src.charCodeAt(this.pos);
        if (cc === 0x0A || cc === 0x0D) break;
        this.pos++;
      }
      lines.push(this.src.slice(contentStart, this.pos));

      // Skip newline
      if (this.pos < this.len) {
        if (this.src.charCodeAt(this.pos) === 0x0D) {
          this.pos++;
          if (this.pos < this.len && this.src.charCodeAt(this.pos) === 0x0A) this.pos++;
        } else {
          this.pos++;
        }
      }
    }

    // Build the result
    if (isLiteral) {
      result = lines.join('\n');
    } else {
      // Folded: join adjacent non-empty lines with space, empty lines with newline
      const parts: string[] = [];
      let i = 0;
      while (i < lines.length) {
        if (lines[i] === '') {
          parts.push('');
          i++;
        } else {
          let line = lines[i]!;
          i++;
          while (i < lines.length && lines[i] !== '') {
            line += ' ' + lines[i]!.trimStart();
            i++;
          }
          parts.push(line);
        }
      }
      result = parts.join('\n');
    }

    // Apply chomping
    switch (chomp) {
      case 'clip':
        result = result + '\n';
        break;
      case 'strip':
        // No trailing newline
        break;
      case 'keep':
        result = result + '\n'.repeat(trailingBlankCount + 1);
        break;
    }

    const node = new Scalar(result, type);
    node.range = [start, this.pos, this.pos];
    return node;
  }

  /**
   * Parse a plain (unquoted) scalar.
   * @param minIndent minimum indent for continuation lines
   * @param inFlow true if inside a flow collection (flow indicators terminate)
   */
  private parsePlainScalar(minIndent = 0, inFlow = false): Scalar {
    const start = this.pos;
    let text = '';
    let chunkStart = this.pos;

    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);

      // End conditions for plain scalar:
      // - : followed by whitespace or newline (map value indicator)
      // - # preceded by whitespace (comment)
      // - newline (possible end or folding)
      // - flow indicators in flow context

      if (c === 0x3A) { // :
        const next = this.pos + 1 < this.len ? this.src.charCodeAt(this.pos + 1) : -1;
        // `:` is a key/sep indicator when followed by whitespace, a flow
        // terminator/opener, or EOF. In flow context `a,`/`a]`/`a}`/`a[`(etc.)
        // following `:` marks an (empty) value indicator too (eemeli §7.3):
        if (next === -1 || this.isWsOrNl(next) ||
            (inFlow && (next === 0x2C || next === 0x5B || next === 0x5D ||
                        next === 0x7B || next === 0x7D))) {
          break; // key: value separator
        }
        this.pos++;
      } else if (c === 0x23) { // #
        // Must be preceded by whitespace
        if (this.pos > chunkStart || this.pos > start) {
          const prev = this.pos > 0 ? this.src.charCodeAt(this.pos - 1) : -1;
          if (prev === 0x20 || prev === 0x09 || prev === 0x0A || prev === 0x0D) {
            break;
          }
        }
        this.pos++;
      } else if (c === 0x0A || c === 0x0D) {
        // Newline — check for line folding or end
        if (chunkStart < this.pos) text += this.src.slice(chunkStart, this.pos);

        // Save position and skip the newline
        const nlPos = this.pos;
        if (c === 0x0D) {
          this.pos++;
          if (this.pos < this.len && this.src.charCodeAt(this.pos) === 0x0A) this.pos++;
        } else {
          this.pos++;
        }

        // Skip trailing whitespace and comments on blank lines
        let allBlank = true;
        let scanPos = this.pos;
        while (scanPos < this.len) {
          const sc = this.src.charCodeAt(scanPos);
          if (sc === 0x20 || sc === 0x09) { scanPos++; continue; }
          if (sc === 0x23) {
            // Comment line — skip it
            while (scanPos < this.len && this.src.charCodeAt(scanPos) !== 0x0A && this.src.charCodeAt(scanPos) !== 0x0D) scanPos++;
            if (scanPos < this.len) {
              if (this.src.charCodeAt(scanPos) === 0x0D) {
                scanPos++;
                if (scanPos < this.len && this.src.charCodeAt(scanPos) === 0x0A) scanPos++;
              } else {
                scanPos++;
              }
            }
            continue;
          }
          if (sc === 0x0A || sc === 0x0D) {
            scanPos++;
            if (sc === 0x0D && scanPos < this.len && this.src.charCodeAt(scanPos) === 0x0A) scanPos++;
            continue;
          }
          allBlank = false;
          break;
        }

        // Check if next non-blank line is a continuation
        const nextC = scanPos < this.len ? this.src.charCodeAt(scanPos) : -1;

        // Calculate indent of the continuation line
        let contIndent = 0;
        let p = scanPos;
        while (p > 0 && this.src.charCodeAt(p - 1) !== 0x0A && this.src.charCodeAt(p - 1) !== 0x0D) p--;
        while (p < scanPos && this.src.charCodeAt(p) === 0x20) { contIndent++; p++; }

        if (nextC === -1 || nextC === 0x2D || nextC === 0x3F || // - or ? (block indicators)
            (nextC === 0x3A && (scanPos + 1 >= this.len || this.isWsOrNl(this.src.charCodeAt(scanPos + 1))))) {
          // Not a continuation — back up and end scalar
          this.pos = nlPos;
          chunkStart = nlPos; // prevent double-add at end
          break;
        }

        // Check indent — continuation must be at least at minIndent
        // (i.e. more indented than the mapping key, which is at minIndent - 1)
        if (contIndent < minIndent) {
          this.pos = nlPos;
          chunkStart = nlPos;
          break;
        }

        // Flow indicators on the continuation line terminate the scalar (in flow context)
        if (inFlow && (nextC === 0x2C || nextC === 0x5B || nextC === 0x5D || nextC === 0x7B || nextC === 0x7D)) {
          this.pos = nlPos;
          chunkStart = nlPos; // prevent double-add at end
          break;
        }

        // Continue: fold the newline
        if (allBlank) {
          text += '\n';
        } else {
          text += ' ';
        }
        this.pos = scanPos;
        chunkStart = scanPos;
      } else if (inFlow && (c === 0x2C || c === 0x5B || c === 0x5D || c === 0x7B || c === 0x7D)) {
        // Flow indicators terminate plain scalars only in flow context
        break;
      } else {
        this.pos++;
      }
    }

    if (chunkStart < this.pos) text += this.src.slice(chunkStart, this.pos);

    // Trim trailing whitespace from text
    text = text.replace(/\s+$/, '');

    // Adjust valueEnd: back up past source whitespace that was trimmed from text.
    // This ensures range[1] points just past the actual content, not past trailing
    // spaces that precede comments or line endings.
    let valueEnd = this.pos;
    while (valueEnd > start) {
      const c = this.src.charCodeAt(valueEnd - 1);
      if (c !== 0x20 && c !== 0x09) break;
      valueEnd--;
    }

    const value = this.resolvePlainScalar(text);
    const node = new Scalar(value, SCALAR_PLAIN);
    // PR5b-F2: keep the raw source text on bool scalars so stringify can
    //   preserve it (round-trip) rather than always applying trueStr/falseStr.
    node.source = typeof value === 'boolean' ? text : null;
    node.range = [start, valueEnd, valueEnd];
    return node;
  }

  // ---- Anchor/Tag parsing --------------------------------------------------

  private parseAnchor(): string | null {
    if (this.pos >= this.len || this.src.charCodeAt(this.pos) !== 0x26) return null; // &
    this.pos++; // skip &
    const start = this.pos;
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (this.isWsOrNl(c) || c === 0x2C || c === 0x5B || c === 0x5D || c === 0x7B || c === 0x7D) break;
      this.pos++;
    }
    return this.src.slice(start, this.pos);
  }

  private parseTag(): string | null {
    if (this.pos >= this.len || this.src.charCodeAt(this.pos) !== 0x21) return null; // !
    const start = this.pos;
    this.pos++; // skip !
    if (this.pos < this.len && this.src.charCodeAt(this.pos) === 0x21) {
      // !! shorthand
      this.pos++;
      while (this.pos < this.len) {
        const c = this.src.charCodeAt(this.pos);
        if (this.isWsOrNl(c)) break;
        this.pos++;
      }
    } else if (this.pos < this.len && this.src.charCodeAt(this.pos) === 0x3C) {
      // !<...> verbatim tag
      this.pos++; // skip <
      while (this.pos < this.len && this.src.charCodeAt(this.pos) !== 0x3E) this.pos++;
      if (this.pos < this.len) this.pos++; // skip >
    } else {
      while (this.pos < this.len) {
        const c = this.src.charCodeAt(this.pos);
        if (this.isWsOrNl(c)) break;
        this.pos++;
      }
    }
    return this.src.slice(start, this.pos);
  }

  // ---- Alias parsing -------------------------------------------------------

  private parseAlias(): Alias {
    const start = this.pos;
    this.pos++; // skip *
    const nameStart = this.pos;
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (this.isWsOrNl(c) || c === 0x2C || c === 0x5B || c === 0x5D || c === 0x7B || c === 0x7D) break;
      this.pos++;
    }
    const name = this.src.slice(nameStart, this.pos);
    const alias = new Alias(name);
    alias.range = [start, this.pos, this.pos];
    return alias;
  }

  // ---- Flow collections ----------------------------------------------------

  /**
   * Guard against a collection loop that fails to advance the cursor (which
   * would otherwise spin forever, growing the node until OOM). Force one char
   * of progress and record a parse error so the caller can't hang.
   */
  private guardProgress(prev: number): void {
    if (this.pos === prev && this.pos < this.len) {
      this.error(this.pos, 'Failed to progress while parsing a collection');
      this.pos++;
    }
  }

  /**
   * A flow-sequence entry can be a single `key: value` pair (e.g. `[a: 1]`
   * parses to a one-pair map). parseFlowValue stops before the `:`; peek for
   * a key-separator on this line and, if present, re-read the entry as a map.
   */
  private flowValuePresent(): boolean {
    // Called after `key:` + inline ws. In flow context newlines are whitespace,
    // so a value may start on a later line; only a terminator/EOF means empty.
    const c = this.ch();
    if (c === 0x2C || c === 0x5D || c === 0x7D) return false; // , ] }
    if (c !== 0x0A && c !== 0x0D && c !== 0x23) return true;
    // Peek past newlines/comments for the next real token (don't advance pos).
    let p = this.pos;
    while (p < this.len) {
      const cc = this.src.charCodeAt(p);
      if (cc === 0x20 || cc === 0x09 || cc === 0x0A || cc === 0x0D) { p++; continue; }
      if (cc === 0x23) {
        while (p < this.len) {
          const z = this.src.charCodeAt(p);
          if (z === 0x0A || z === 0x0D) break;
          p++;
        }
        continue;
      }
      break;
    }
    if (p >= this.len) return false;
    const pc = this.src.charCodeAt(p);
    return !(pc === 0x2C || pc === 0x5D || pc === 0x7D);
  }

  private isFlowKeySep(p: number): boolean {
    // True when a `:` just before p forms a flow key/value separator: the char
    // after it is ws/newline, EOF, or a flow indicator.
    if (p >= this.len) return true;
    const c = this.src.charCodeAt(p);
    return this.isWsOrNl(c) || c === 0x2C || c === 0x5B || c === 0x5D || c === 0x7B || c === 0x7D;
  }

  private parseFlowSeqItem(): Node {
    const first = this.parseFlowValue();
    const saved = this.pos;
    this.skipWsInline();
    if (this.pos < this.len && this.src.charCodeAt(this.pos) === 0x3A &&
        this.isFlowKeySep(this.pos + 1)) {
      // `key:` — consume the value and wrap into a single-pair flow map
      this.pos++; // skip :
      this.skipWsInline();
      let value: Node | null = null;
      if (this.flowValuePresent()) {
        value = this.parseFlowValue();
      }
      const map = new YAMLMap();
      map.flow = true;
      map.items.push(new Pair(first, value));
      map.range = [first.range?.[0] ?? this.pos, this.pos, this.pos];
      return map;
    }
    this.pos = saved;
    return first;
  }

  private parseFlowSequence(start: number): YAMLSeq {
    const seq = new YAMLSeq();
    seq.flow = true;
    this.pos++; // skip [

    this.skipWsAndComments();

    while (this.pos < this.len && this.src.charCodeAt(this.pos) !== 0x5D) { // ]
      const loopStart = this.pos;
      // Apply pending comments
      const cb = this.consumePendingCommentBefore();

      const item = this.parseFlowSeqItem();
      if (cb) item.commentBefore = cb;

      seq.items.push(item);

      this.skipWsAndComments();

      if (this.pos < this.len && this.src.charCodeAt(this.pos) === 0x2C) { // ,
        this.pos++;
        this.skipWsAndComments();
      }
      this.guardProgress(loopStart);
    }

    if (this.pos < this.len) {
      this.pos++; // skip ]
    } else {
      this.error(start, 'Unterminated flow sequence');
    }
    seq.range = [start, this.pos, this.pos];
    return seq;
  }

  private parseFlowMapping(start: number): YAMLMap {
    const map = new YAMLMap();
    map.flow = true;
    this.pos++; // skip {

    this.skipWsAndComments();

    const seenKeys = this.uniqueKeys ? new Set<string>() : null;

    while (this.pos < this.len && this.src.charCodeAt(this.pos) !== 0x7D) { // }
      const loopStart = this.pos;
      this.skipWsAndComments();
      const cb = this.consumePendingCommentBefore();

      // Parse key
      let key: Node | null;
      if (this.pos < this.len && this.src.charCodeAt(this.pos) === 0x3F) { // ?
        this.pos++;
        this.skipWsAndComments();
        key = this.parseFlowValue();
      } else {
        key = this.parseFlowKey();
      }

      this.skipWsAndComments();

      // Parse value
      let value: Node | null = null;
      if (this.pos < this.len && this.src.charCodeAt(this.pos) === 0x3A) { // :
        this.pos++;
        this.skipWsAndComments();
        if (this.pos < this.len && this.src.charCodeAt(this.pos) !== 0x2C && this.src.charCodeAt(this.pos) !== 0x7D) {
          value = this.parseFlowValue();
        }
      }

      const pair = new Pair(key, value);
      pair.range = [key?.range?.[0] ?? start, this.pos, this.pos];

      // Dup key check
      if (seenKeys && key instanceof Scalar) {
        const k = String(key.value);
        if (seenKeys.has(k)) {
          this.error(key.range?.[0] ?? this.pos, `Duplicate key: ${k}`);
        }
        seenKeys.add(k);
      }

      if (cb) pair.key && (pair.key.commentBefore = cb);
      map.items.push(pair);

      this.skipWsAndComments();

      if (this.pos < this.len && this.src.charCodeAt(this.pos) === 0x2C) { // ,
        this.pos++;
        this.skipWsAndComments();
      }
      this.guardProgress(loopStart);
    }

    if (this.pos < this.len) {
      this.pos++; // skip }
    } else {
      this.error(start, 'Unterminated flow mapping');
    }
    map.range = [start, this.pos, this.pos];
    return map;
  }

  private parseFlowKey(): Node {
    const c = this.ch();
    if (c === 0x22) return this.parseDoubleQuoted(this.pos);
    if (c === 0x27) return this.parseSingleQuoted(this.pos);
    if (c === 0x5B) return this.parseFlowSequence(this.pos);
    if (c === 0x7B) return this.parseFlowMapping(this.pos);
    if (c === 0x2A) return this.parseAlias();
    // Plain key
    return this.parsePlainScalar(0, true);
  }

  private parseFlowValue(): Node {
    this.skipWsAndComments();

    // Check for anchor/tag
    let anchor: string | null = null;
    let tag: string | null = null;
    const start = this.pos;

    while (true) {
      const c = this.ch();
      if (c === 0x26) { anchor = this.parseAnchor(); this.skipWsAndComments(); }
      else if (c === 0x21) { tag = this.parseTag(); this.skipWsAndComments(); }
      else break;
    }

    if (this.pos >= this.len) {
      this.error(start, 'Unexpected end of input');
      const s = new Scalar(null, SCALAR_PLAIN);
      s.range = [start, this.pos, this.pos];
      if (anchor) s.anchor = anchor;
      if (tag) s.tag = tag;
      return s;
    }

    const c = this.ch();
    // Block-collection indicators (`- `) are not allowed in flow context
    // (§8.1); flag and fall through so the value is still consumed (no hang).
    if (c === 0x2D) {
      const nxt = this.pos + 1 < this.len ? this.src.charCodeAt(this.pos + 1) : -1;
      if (nxt === -1 || this.isWsOrNl(nxt)) {
        this.error(this.pos, 'Block collections are not allowed within flow collections');
      }
    }
    let node: Node;

    if (c === 0x2A) { // *
      node = this.parseAlias();
    } else if (c === 0x22) { // "
      node = this.parseDoubleQuoted(this.pos);
    } else if (c === 0x27) { // '
      node = this.parseSingleQuoted(this.pos);
    } else if (c === 0x5B) { // [
      node = this.parseFlowSequence(this.pos);
    } else if (c === 0x7B) { // {
      node = this.parseFlowMapping(this.pos);
    } else if (c === 0x7C || c === 0x3E) { // | or >
      node = this.parseBlockScalar(this.pos);
    } else {
      node = this.parsePlainScalar(0, true);
    }

    if (anchor) {
      node.anchor = anchor;
      this.anchors.set(anchor, node);
    }
    if (tag) node.tag = tag;

    return node;
  }

  // ---- Block collections ---------------------------------------------------

  private parseBlockNode(minIndent: number): Node | null {
    const start = this.pos;

    // Skip leading whitespace and comments, track blank lines
    const crossedNewline = this.skipWsAndComments();
    if (this.pos >= this.len) return null;

    // Check for doc markers
    const c = this.src.charCodeAt(this.pos);
    if (c === 0x2D && this.pos + 2 < this.len &&
        this.src.charCodeAt(this.pos + 1) === 0x2D &&
        this.src.charCodeAt(this.pos + 2) === 0x2D) {
      return null; // doc start marker
    }
    if (c === 0x2E && this.pos + 2 < this.len &&
        this.src.charCodeAt(this.pos + 1) === 0x2E &&
        this.src.charCodeAt(this.pos + 2) === 0x2E) {
      return null; // doc end marker
    }

    // Check for directives — only before any document content.
    // After ---, % is treated as content (plain scalar) but with an error, matching eemeli.
    if (c === 0x25 && !this.directives.docStart) return null; // % directive
    if (c === 0x25) {
      this.error(this.pos, 'Plain value cannot start with directive indicator character %');
    }

    const cb = this.consumePendingCommentBefore();
    const spaceBefore = this.hadBlankLine;
    this.hadBlankLine = false;

    // Anchor/tag
    let anchor: string | null = null;
    let tag: string | null = null;

    while (true) {
      const cc = this.ch();
      if (cc === 0x26) { anchor = this.parseAnchor(); this.skipWsAndComments(); }
      else if (cc === 0x21) { tag = this.parseTag(); this.skipWsAndComments(); }
      else break;
    }

    if (this.pos >= this.len) {
      const s = new Scalar(null, SCALAR_PLAIN);
      s.anchor = anchor;
      s.tag = tag;
      s.commentBefore = cb;
      s.spaceBefore = spaceBefore;
      s.range = [start, start, start];
      return s;
    }

    const indent = this.currentColumn();
    const fc = this.ch();
    let node: Node;
    let isCollection = false;

    if (fc === 0x2D && (this.pos + 1 >= this.len || this.isWsOrNl(this.src.charCodeAt(this.pos + 1)))) {
      // Block sequence
      isCollection = true;
      node = this.parseBlockSequence(indent);
    } else if (fc === 0x3F && (this.pos + 1 >= this.len || this.isWsOrNl(this.src.charCodeAt(this.pos + 1)))) {
      // Explicit key
      isCollection = true;
      node = this.parseBlockMappingExplicit(indent);
    } else if (fc === 0x5B) { // [
      node = this.parseFlowSequence(this.pos);
    } else if (fc === 0x7B) { // {
      node = this.parseFlowMapping(this.pos);
    } else if (fc === 0x2A) { // *
      node = this.parseAlias();
    } else if (fc === 0x7C || fc === 0x3E) { // | or >
      node = this.parseBlockScalar(this.pos);
    } else if (fc === 0x22) { // "
      // A quoted scalar may start a compact block map (e.g. "- \"qk\": v1"); peek
      // for a key-value separator AFTER the closing quote (a `: ` inside the
      // quoted content is just part of the string).
      if (this.isQuotedMapKeyAfter()) node = this.parseBlockMapping(indent);
      else node = this.parseDoubleQuoted(this.pos);
    } else if (fc === 0x27) { // '
      if (this.isQuotedMapKeyAfter()) node = this.parseBlockMapping(indent);
      else node = this.parseSingleQuoted(this.pos);
    } else {
      // Could be a plain scalar OR a block mapping key
      // Look ahead for : to decide
      if (this.isBlockMapKey()) {
        isCollection = true;
        node = this.parseBlockMapping(indent);
      } else {
        node = this.parsePlainScalar(minIndent);
      }
    }

    if (anchor) {
      node.anchor = anchor;
      this.anchors.set(anchor, node);
    }
    if (tag) node.tag = tag;
    // For collections, pass the comment through to the first key/item;
    // for non-collections, attach directly.
    if (cb) {
      if (isCollection && node instanceof YAMLMap && node.items.length > 0 && node.items[0]!.key) {
        node.items[0]!.key.commentBefore = cb;
      } else if (isCollection && node instanceof YAMLSeq && node.items.length > 0) {
        node.items[0]!.commentBefore = cb;
      } else {
        node.commentBefore = cb;
      }
    }
    if (spaceBefore) node.spaceBefore = spaceBefore;

    // Attach trailing comment
    const tc = this.skipInlineComment();
    if (tc) node.comment = tc;

    return node;
  }

  // Called with this.pos at an opening quote. Scans to the closing quote
  // (honoring escape sequences) and reports whether a `:` key separator follows
  // it — i.e. the quoted scalar is a compact block-map key, not a plain string.
  private isQuotedMapKeyAfter(): boolean {
    const q = this.src.charCodeAt(this.pos);
    if (q !== 0x22 && q !== 0x27) return false;
    let p = this.pos + 1;
    while (p < this.len) {
      const c = this.src.charCodeAt(p);
      if (q === 0x22 && c === 0x5C) { p += 2; continue; }        // \" escape
      if (c === q) {
        if (q === 0x27 && this.src.charCodeAt(p + 1) === 0x27) { p += 2; continue; } // '' literal
        let s = p + 1; // past closing quote
        while (s < this.len && (this.src.charCodeAt(s) === 0x20 || this.src.charCodeAt(s) === 0x09)) s++;
        if (this.src.charCodeAt(s) === 0x3A) {
          const nx = s + 1 < this.len ? this.src.charCodeAt(s + 1) : -1;
          if (nx === 0x20 || nx === 0x09 || nx === 0x0A || nx === 0x0D || nx === -1) return true;
        }
        return false;
      }
      p++;
    }
    return false;
  }

  private isBlockSeqEntry(): boolean {
    const c = this.ch();
    if (c !== 0x2D) return false; // - at current position
    const nx = this.pos + 1 < this.len ? this.src.charCodeAt(this.pos + 1) : -1;
    return nx === -1 || this.isWsOrNl(nx);
  }

  private isBlockMapKey(): boolean {
    // Scan ahead on the current line to see if there's a : (key-value separator)
    let p = this.pos;
    let depth = 0;
    while (p < this.len) {
      const c = this.src.charCodeAt(p);
      if (c === 0x0A || c === 0x0D) return false;
      if (c === 0x5B || c === 0x7B) depth++; // [ {
      else if (c === 0x5D || c === 0x7D) depth--; // ] }
      else if (c === 0x3A && depth === 0) { // :
        const next = p + 1 < this.len ? this.src.charCodeAt(p + 1) : -1;
        if (next === 0x20 || next === 0x09 || next === 0x0A || next === 0x0D || next === -1) {
          return true;
        }
      }
      p++;
    }
    return false;
  }

  private parseBlockMapping(indent: number): YAMLMap {
    const map = new YAMLMap();
    const start = this.pos;
    const seenKeys = this.uniqueKeys ? new Set<string>() : null;

    while (this.pos < this.len) {
      const loopStart = this.pos;
      // Check indent
      const col = this.currentColumn();
      if (col < indent) break;
      if (col > indent) {
        // This shouldn't happen at the mapping level; break
        break;
      }

      // Check for doc markers
      const c = this.src.charCodeAt(this.pos);
      if (c === 0x2D && this.pos + 2 < this.len &&
          this.src.charCodeAt(this.pos + 1) === 0x2D &&
          this.src.charCodeAt(this.pos + 2) === 0x2D) break;
      if (c === 0x2E && this.pos + 2 < this.len &&
          this.src.charCodeAt(this.pos + 1) === 0x2E &&
          this.src.charCodeAt(this.pos + 2) === 0x2E) break;
      if (c === 0x25 && !this.directives.docStart) break; // directive (only before ---)

      // Skip leading comments
      const crossedNewline = this.skipWsAndComments();
      if (this.pos >= this.len) break;

      // Recheck indent after skipping whitespace/comments
      const col2 = this.currentColumn();
      if (col2 < indent) break;
      if (col2 > indent && !crossedNewline) break;
      if (col2 !== indent) break;

      // Check again for doc markers
      const fc = this.src.charCodeAt(this.pos);
      if (fc === 0x2D && this.pos + 2 < this.len &&
          this.src.charCodeAt(this.pos + 1) === 0x2D &&
          this.src.charCodeAt(this.pos + 2) === 0x2D) break;
      if (fc === 0x2E && this.pos + 2 < this.len &&
          this.src.charCodeAt(this.pos + 1) === 0x2E &&
          this.src.charCodeAt(this.pos + 2) === 0x2E) break;

      const cb = this.consumePendingCommentBefore();
      // M1: capture blank line before this key (for spaceBefore)
      const spaceBefore = this.hadBlankLine;
      this.hadBlankLine = false;

      // Parse key
      let key: Node | null;
      const keyStart = this.pos;

      if (fc === 0x3F && (this.pos + 1 >= this.len || this.isWsOrNl(this.src.charCodeAt(this.pos + 1)))) {
        // Explicit key (? key)
        this.pos++; // skip ?
        this.skipWsAndComments();
        key = this.parseBlockNode(indent + 1);
      } else {
        key = this.parseBlockKeyScalar();
      }

      this.skipWsAndComments();

      // Expect :
      let value: Node | null = null;
      if (this.pos < this.len && this.src.charCodeAt(this.pos) === 0x3A) {
        this.pos++; // skip :

        // Skip only inline whitespace (no newlines) to check for same-line value
        this.skipWsInline();

        if (this.pos < this.len) {
          const c = this.src.charCodeAt(this.pos);
          if (c !== 0x0A && c !== 0x0D && c !== 0x23) {
            // Value on same line as key
            value = this.parseBlockNode(indent + 1);
          } else {
            // Value on next line(s) — skip inline comment first
            if (c === 0x23) {
              this.skipInlineComment();
            }
            // Skip newlines and comments to find the value
            this.skipWsAndComments();
            const vcol = this.pos < this.len ? this.currentColumn() : -1;
            if (vcol > indent) {
              value = this.parseBlockNode(indent + 1);
            } else if (vcol === indent && this.isBlockSeqEntry()) {
              // §8.2.1: a block sequence may nest at the SAME indentation as the
              // enclosing map's keys; it is this key's value.
              value = this.parseBlockSequence(indent);
            }
          }
        }
      }

      const pair = new Pair(key, value);
      pair.range = [keyStart, value?.range?.[1] ?? this.pos, this.pos];

      // Dup key check
      if (seenKeys && key instanceof Scalar) {
        const k = String(key.value);
        if (seenKeys.has(k)) {
          this.error(key.range?.[0] ?? this.pos, `Duplicate key: ${k}`);
        }
        seenKeys.add(k);
      }

      if (cb && key) key.commentBefore = cb;
      if (spaceBefore && key) key.spaceBefore = true;

      // Trailing comment on the pair
      const tc = this.skipInlineComment();
      if (tc && value) value.comment = tc;

      // Extend value nodeEnd to end of line (eemeli convention: value range[2]
      // includes trailing newline and any inline comment on the same line)
      if (value) {
        const eol = this.endOfLine(this.pos);
        (value.range as [number, number, number])[2] = eol;
      }

      map.items.push(pair);

      // Skip to next line
      this.skipWsAndComments();
      this.guardProgress(loopStart);
    }

    map.range = [start, this.pos, this.pos];
    return map;
  }

  private parseBlockMappingExplicit(indent: number): YAMLMap {
    // For explicit keys: ? key \n : value
    return this.parseBlockMapping(indent);
  }

  private parseBlockKeyScalar(): Node {
    const c = this.ch();
    if (c === 0x22) return this.parseDoubleQuoted(this.pos);
    if (c === 0x27) return this.parseSingleQuoted(this.pos);
    if (c === 0x5B) return this.parseFlowSequence(this.pos);
    if (c === 0x7B) return this.parseFlowMapping(this.pos);
    if (c === 0x2A) return this.parseAlias();
    if (c === 0x7C || c === 0x3E) return this.parseBlockScalar(this.pos);
    // Plain scalar key
    return this.parsePlainScalar();
  }

  private parseBlockSequence(indent: number): YAMLSeq {
    const seq = new YAMLSeq();
    const start = this.pos;

    while (this.pos < this.len) {
      const loopStart = this.pos;
      // Check indent
      const col = this.currentColumn();
      if (col < indent) break;

      // Check for doc markers
      const c = this.src.charCodeAt(this.pos);
      if (c === 0x2D && this.pos + 2 < this.len &&
          this.src.charCodeAt(this.pos + 1) === 0x2D &&
          this.src.charCodeAt(this.pos + 2) === 0x2D) break;
      if (c === 0x2E && this.pos + 2 < this.len &&
          this.src.charCodeAt(this.pos + 1) === 0x2E &&
          this.src.charCodeAt(this.pos + 2) === 0x2E) break;
      if (c === 0x25 && !this.directives.docStart) break; // directive (only before ---)

      // Skip comments and blank lines
      this.skipWsAndComments();
      if (this.pos >= this.len) break;

      const col2 = this.currentColumn();
      if (col2 < indent) break;

      // Must be - followed by ws/nl
      const fc = this.src.charCodeAt(this.pos);
      if (fc !== 0x2D) break;
      if (this.pos + 1 < this.len && !this.isWsOrNl(this.src.charCodeAt(this.pos + 1)) && this.src.charCodeAt(this.pos + 1) !== -1) break;
      if (col2 !== indent) break;

      const cb = this.consumePendingCommentBefore();

      this.pos++; // skip -
      this.skipWs(); // skip space after -

      // Parse the value
      const value = this.parseBlockNode(indent + 1);
      if (value && cb) value.commentBefore = cb;

      if (value) {
        // Trailing comment
        const tc = this.skipInlineComment();
        if (tc) value.comment = tc;
        // Extend value nodeEnd to end of line (eemeli convention)
        const eol = this.endOfLine(this.pos);
        (value.range as [number, number, number])[2] = eol;
        seq.items.push(value);
      }

      this.skipWsAndComments();
      this.guardProgress(loopStart);
    }

    seq.range = [start, this.pos, this.pos];
    return seq;
  }

  // ---- Directives ----------------------------------------------------------

  private parseDirective(): void {
    this.pos++; // skip %
    const start = this.pos;
    while (this.pos < this.len && this.src.charCodeAt(this.pos) !== 0x20 &&
           this.src.charCodeAt(this.pos) !== 0x0A && this.src.charCodeAt(this.pos) !== 0x0D) {
      this.pos++;
    }
    const name = this.src.slice(start, this.pos);
    this.skipWs();

    // Read value
    const valStart = this.pos;
    while (this.pos < this.len && this.src.charCodeAt(this.pos) !== 0x0A && this.src.charCodeAt(this.pos) !== 0x0D) {
      this.pos++;
    }
    const value = this.src.slice(valStart, this.pos).trim();

    if (name === 'YAML') {
      this.directives.yaml.explicit = true;
      this.directives.yaml.version = value;
      if (value === '1.1' || value === '1.2') {
        this.version = value;
      } else {
        this.error(start, `Unsupported YAML version: ${value}`);
      }
    } else if (name === 'TAG') {
      const parts = value.split(/\s+/);
      if (parts.length === 2) {
        this.directives.tags[parts[0]!] = parts[1]!;
      }
    }
    // Skip to end of line
    this.skipLine();
  }

  // ---- Document parsing ----------------------------------------------------

  parseDocument(): ParsedDocument {
    const docStart = this.pos;
    let sawDocComment = false; // any comment attached to this doc (inline on --- or comment-only lines)
    this.hadBlankLine = false;

    // Detect tabs used in indentation — unconditional: eemeli reports them
    // even with strict:false (strict controls other checks, not this one).
    // ponytail: scanned once per Parser (per source), all tab errors land on
    // the FIRST document of a multi-doc stream; eemeli attributes each to the
    // document containing its offset. Upgrade: bucket errors by position when
    // scanning, if multi-doc tab-error attribution ever matters. Without this
    // guard parseAllDocuments re-scanned the whole source per document
    // (100 KB × 100 docs: 5 ms -> 171 ms regression, caught in review).
    if (!this.tabsScanned) {
      this.tabsScanned = true;
      let lineStart = true;
      for (let i = 0; i < this.len; i++) {
        const c = this.src.charCodeAt(i);
        if (c === 0x09 && lineStart) { // tab in leading whitespace
          const lc = this.lineCounter
            ? this.lineCounter.linePos(i)
            : offsetToLineCol(this.src, i);
          this.errors.push(new YAMLParseError(i, 'Tabs are not allowed as indentation', [lc]));
          // Only report once per line
          lineStart = false;
        } else if (c === 0x0A) {
          lineStart = true;
        } else if (c === 0x0D) {
          lineStart = true;
        } else if (c !== 0x20) {
          lineStart = false;
        }
      }
    }

    // Parse directives
    let directivesParsed = false;
    while (this.pos < this.len) {
      this.skipWsAndComments();
      if (this.pos >= this.len) break;
      if (this.src.charCodeAt(this.pos) === 0x25) { // %
        this.parseDirective();
        directivesParsed = true;
      } else {
        break;
      }
    }

    // Check for --- doc start
    let hasDocStart = false;
    let markerStart = -1;
    let markerContentEnd = -1; // end of bare marker text + trailing ws (before newline)
    let markerLineEnd = -1;    // end of marker line incl inline comment + newline
    this.skipWsAndComments();
    let docCommentBefore: string | null = null;
    if (this.pos + 2 < this.len &&
        this.src.charCodeAt(this.pos) === 0x2D &&
        this.src.charCodeAt(this.pos + 1) === 0x2D &&
        this.src.charCodeAt(this.pos + 2) === 0x2D) {
      // Comments before --- are always doc.commentBefore
      docCommentBefore = this.consumePendingCommentBefore();
      hasDocStart = true;
      markerStart = this.pos;
      this.directives.docStart = true;
      this.pos += 3;
      // Skip inline comment after ---
      const inlineComment = this.skipInlineComment();
      if (inlineComment !== null) sawDocComment = true;
      markerContentEnd = this.pos; // after trailing ws / inline comment, before newline
      if (this.pos < this.len && (this.src.charCodeAt(this.pos) === 0x0A || this.src.charCodeAt(this.pos) === 0x0D)) {
        this.skipLine();
      }
      markerLineEnd = this.pos; // end of marker line incl newline
    }

    // Collect leading comments for the document (after --- if present)
    this.skipWsAndComments();
    // Only consume as doc.commentBefore if separated by a blank line from content;
    // adjacent comments pass through to attach to the first content node (eemeli semantics).
    if (this.blankAfterLastComment || this.pos >= this.len) {
      const afterComment = this.consumePendingCommentBefore();
      if (afterComment) {
        sawDocComment = true;
        docCommentBefore = docCommentBefore
          ? docCommentBefore + '\n' + afterComment
          : afterComment;
      }
    }
    this.blankAfterLastComment = false;

    // Parse the document content
    let contents: Node | null = null;
    if (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (c !== 0x2D || this.pos + 2 >= this.len ||
          this.src.charCodeAt(this.pos + 1) !== 0x2D ||
          this.src.charCodeAt(this.pos + 2) !== 0x2D) {
        if (c !== 0x2E || this.pos + 2 >= this.len ||
            this.src.charCodeAt(this.pos + 1) !== 0x2E ||
            this.src.charCodeAt(this.pos + 2) !== 0x2E) {
          contents = this.parseBlockNode(0);
        }
      }
    }

    // Check for ... doc end
    let hasDocEnd = false;
    let docEndMarkerStart = -1;
    let docEndLineEnd = -1;
    this.skipWsAndComments();
    if (this.pos + 2 < this.len &&
        this.src.charCodeAt(this.pos) === 0x2E &&
        this.src.charCodeAt(this.pos + 1) === 0x2E &&
        this.src.charCodeAt(this.pos + 2) === 0x2E) {
      hasDocEnd = true;
      docEndMarkerStart = this.pos;
      this.directives.docEnd = true;
      this.pos += 3;
      this.skipInlineComment();
      docEndLineEnd = this.endOfLine(this.pos);
    }

    // Collect trailing document comment
    this.skipWsAndComments();
    const docComment = this.consumePendingCommentBefore();
    if (docComment) sawDocComment = true;

    // F5: extend top-level flow content nodeEnd to end of line (eemeli convention)
    if (contents && (isMap(contents) || isSeq(contents)) && (contents as any).flow === true) {
      const eol = this.endOfLine(contents.range![1]);
      (contents.range as [number, number, number])[2] = eol;
    }

    // F4: compute document range as [contentStart, contentLineEnd, streamEnd]
    // contentStart: include --- marker if present, else first content node
    const contentStart = hasDocStart ? markerStart : (contents?.range?.[0] ?? docStart);

    // MINOR-5: directives present but no --- marker -> eemeli reports MISSING_CHAR
    if (directivesParsed && !hasDocStart) {
      this.error(contentStart, 'Missing directives-end/doc-start indicator line', 'MISSING_CHAR');
    }

    // contentLineEnd / streamEnd: no-content marker docs differ from content docs.
    let contentLineEnd: number;
    let streamEnd: number;
    if (contents) {
      // content-bearing: walk back from before ... or from where parsing stopped
      streamEnd = hasDocEnd ? docEndLineEnd : this.pos;
      contentLineEnd = this.contentLineEnd(hasDocEnd ? docEndMarkerStart : this.pos);
    } else if (hasDocEnd && !hasDocStart) {
      // only-... document: `...` is just an end marker, no content to cover
      contentLineEnd = docStart;
      streamEnd = docEndLineEnd;
    } else if (hasDocStart) {
      // No-content --- doc. With a comment (inline on --- or comment-only lines)
      // eemeli extends over trailing blanks/comments; a bare marker ends at its text.
      if (sawDocComment) {
        contentLineEnd = hasDocEnd ? markerLineEnd : this.pos;
        streamEnd = hasDocEnd ? docEndLineEnd : this.pos;
      } else {
        contentLineEnd = markerContentEnd;
        streamEnd = hasDocEnd ? docEndLineEnd : markerContentEnd;
      }
    } else {
      // No content, no marker — comment-only or empty doc
      contentLineEnd = this.pos;
      streamEnd = this.pos;
    }

    const doc: ParsedDocument = {
      contents,
      errors: this.errors,
      warnings: this.warnings,
      directives: { ...this.directives },
      commentBefore: docCommentBefore,
      comment: docComment,
      range: [contentStart, contentLineEnd, streamEnd],
      hasDocStart,
      hasDocEnd,
    };

    return doc;
  }

  parseAllDocuments(): ParsedDocument[] {
    const docs: ParsedDocument[] = [];

    while (this.pos < this.len) {
      // Reset per-document state
      this.anchors = new Map();
      this.directives = defaultDirectives();
      this.pendingCommentBefore = [];
      this.pendingTrailingComment = null;
      this.hadBlankLine = false;
      this.blankAfterLastComment = false;

      // Skip blank lines between documents
      this.skipWsAndComments();
      if (this.pos >= this.len) break;

      const doc = this.parseDocument();
      docs.push(doc);

      // Merge errors (they accumulate across documents)
      // Actually, reset errors per doc? No — the errors are already on the doc.
      // For subsequent docs, we need fresh error arrays.
      this.errors = [];
      this.warnings = [];
    }

    return docs;
  }
}

// ---- Parsed document type --------------------------------------------------

export interface ParsedDocument {
  contents: Node | null;
  errors: YAMLParseError[];
  warnings: YAMLWarning[];
  directives: Directives;
  commentBefore: string | null;
  comment: string | null;
  range: Range;
  hasDocStart: boolean;
  hasDocEnd: boolean;
}
