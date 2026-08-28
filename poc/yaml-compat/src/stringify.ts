/**
 * AST-level stringify — renders Document / Node / plain JS values to YAML text.
 *
 * Matches eemeli/yaml v2 output: flow spaces (`[ 1, 2 ]`), 2-space block indent,
 * comment placement, block scalar headers, trailing newline.
 *
 * Architecture: segmented buffer (string[] + join) with a key-render cache.
 */

import {
  Scalar, YAMLMap, YAMLSeq, Pair, Alias,
  SCALAR_PLAIN, SCALAR_SINGLE, SCALAR_DOUBLE, SCALAR_FOLDED, SCALAR_LITERAL,
  isScalar, isMap, isSeq, isAlias, isPair, isNode,
  type Node,
} from './nodes.ts';
import { Document } from './document.ts';

// ---- Options ---------------------------------------------------------------

export interface StringifyOptions {
  indent?: number;
  lineWidth?: number;
  singleQuote?: boolean;
  flowLevel?: number;
  defaultStringType?: 'PLAIN' | 'QUOTE_SINGLE' | 'QUOTE_DOUBLE' | 'BLOCK_FOLDED' | 'BLOCK_LITERAL';
  defaultKeyType?: 'PLAIN' | 'QUOTE_SINGLE' | 'QUOTE_DOUBLE';
  nullStr?: string;
  trueStr?: string;
  falseStr?: string;
  indentSeq?: boolean;
  minContentWidth?: number;
  directives?: boolean;
  version?: string;
}

const KNOWN_OPTIONS = new Set([
  'indent', 'lineWidth', 'singleQuote', 'flowLevel',
  'defaultStringType', 'defaultKeyType',
  'nullStr', 'trueStr', 'falseStr',
  'indentSeq', 'minContentWidth', 'directives', 'version',
]);

// ---- Context ---------------------------------------------------------------

interface Ctx {
  indent: number;
  lineWidth: number;
  singleQuote: boolean;
  flowLevel: number;
  defaultStringType: string;
  defaultKeyType: string;
  nullStr: string;
  trueStr: string;
  falseStr: string;
  indentSeq: boolean;
  minContentWidth: number;
  showDirectives: boolean;
  version: string;
  keyCache: Map<string, string>;
  out: string[];
  prefixRendered: boolean;
  pendingAnchorAfterComment: string | null;
}

function makeCtx(opts?: StringifyOptions): Ctx {
  if (opts) {
    for (const k of Object.keys(opts)) {
      if (!KNOWN_OPTIONS.has(k)) throw new Error(`Not implemented in POC: ${k}`);
    }
    // M2: throw on options accepted but not implemented (loud-throw doctrine)
    if (opts.lineWidth !== undefined && opts.lineWidth !== 80) {
      throw new Error('Not implemented in POC: lineWidth');
    }
    if (opts.flowLevel !== undefined && opts.flowLevel !== -1) {
      throw new Error('Not implemented in POC: flowLevel');
    }
    if (opts.defaultStringType !== undefined && opts.defaultStringType !== 'PLAIN') {
      throw new Error('Not implemented in POC: defaultStringType');
    }
    if (opts.directives === true) {
      throw new Error('Not implemented in POC: directives');
    }
  }
  const indent = opts?.indent ?? 2;
  return {
    indent,
    lineWidth: opts?.lineWidth ?? 80,
    singleQuote: opts?.singleQuote ?? false,
    flowLevel: opts?.flowLevel ?? -1,
    defaultStringType: opts?.defaultStringType ?? 'PLAIN',
    defaultKeyType: opts?.defaultKeyType ?? 'PLAIN',
    nullStr: opts?.nullStr ?? 'null',
    trueStr: opts?.trueStr ?? 'true',
    falseStr: opts?.falseStr ?? 'false',
    indentSeq: opts?.indentSeq ?? true,
    minContentWidth: opts?.minContentWidth ?? 20,
    showDirectives: opts?.directives ?? false,
    version: opts?.version ?? '1.2',
    keyCache: new Map(),
    out: [],
    prefixRendered: false,
    pendingAnchorAfterComment: null,
  };
}

function pad(col: number): string {
  return ' '.repeat(col);
}

function depth(col: number, ctx: Ctx): number {
  return col / ctx.indent;
}

function shouldFlow(col: number, ctx: Ctx): boolean {
  return ctx.flowLevel >= 0 && depth(col, ctx) >= ctx.flowLevel;
}

// ---- Entry point -----------------------------------------------------------

export function stringify(value: unknown, options?: StringifyOptions): string {
  const ctx = makeCtx(options);

  if (value instanceof Document) {
    stringifyDocument(value, ctx);
  } else if (isNode(value)) {
    renderNode(value, ctx, 0, false);
    ctx.out.push('\n');
  } else {
    const node = valueToNode(value);
    renderNode(node, ctx, 0, false);
    ctx.out.push('\n');
  }

  return ctx.out.join('');
}

// ---- Document rendering ----------------------------------------------------

function stringifyDocument(doc: Document, ctx: Ctx): void {
  const dir = doc.directives;

  if (ctx.showDirectives || dir.yaml.explicit) {
    ctx.out.push(`%YAML ${dir.yaml.version}\n`);
  }
  for (const [handle, prefix] of Object.entries(dir.tags)) {
    if (handle === '!!' && prefix === 'tag:yaml.org,2002:') continue;
    ctx.out.push(`%TAG ${handle} ${prefix}\n`);
  }

  if (doc.commentBefore) {
    emitCommentText(doc.commentBefore, ctx);
  }

  if (dir.docStart) {
    ctx.out.push('---\n');
  }

  if (doc.contents) {
    renderNode(doc.contents, ctx, 0, false);
    ctx.out.push('\n');
  } else if (!dir.docStart && !dir.docEnd) {
    // M4: empty document with no markers → "null\n" like eemeli
    ctx.out.push('null\n');
  }

  if (doc.comment) {
    if (doc.contents) ctx.out.push('\n');
    emitCommentText(doc.comment, ctx);
  }

  if (dir.docEnd) {
    // m4: blank line between bare --- and ... markers when no content
    if (dir.docStart && !doc.contents) ctx.out.push('\n');
    ctx.out.push('...\n');
  }

  const last = ctx.out[ctx.out.length - 1];
  if (last !== undefined && !last.endsWith('\n')) {
    ctx.out.push('\n');
  }
}

// ---- Comment helpers -------------------------------------------------------

function emitCommentText(text: string, ctx: Ctx): void {
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.length > 0) {
      // m5: guard against comment text without leading space
      ctx.out.push(line.startsWith(' ') ? `#${line}\n` : `# ${line}\n`);
    } else {
      ctx.out.push('\n');
    }
  }
}

// ---- Node dispatch ---------------------------------------------------------

function renderNode(node: Node, ctx: Ctx, col: number, inFlow: boolean): void {
  if (isScalar(node)) {
    renderScalar(node, ctx, col);
  } else if (isMap(node)) {
    renderMap(node, ctx, col, inFlow);
  } else if (isSeq(node)) {
    renderSeq(node, ctx, col, inFlow);
  } else if (isAlias(node)) {
    renderAlias(node, ctx);
  }
}

// ---- Anchor / tag prefix ---------------------------------------------------

function anchorTagPrefix(node: Node): string {
  let s = '';
  if (node.tag) s += `${node.tag} `;
  if (node.anchor) s += `&${node.anchor} `;
  return s;
}

// ---- Scalar ----------------------------------------------------------------

function renderScalar(node: Scalar, ctx: Ctx, col: number): void {
  const prefix = anchorTagPrefix(node);
  if (prefix) ctx.out.push(prefix);

  const v = node.value;

  if (v === null || v === undefined) { ctx.out.push(ctx.nullStr); return; }
  if (boolPreserved(node)) { ctx.out.push(node.source!); return; }
  if (typeof v === 'boolean') { ctx.out.push(v ? ctx.trueStr : ctx.falseStr); return; }
  if (typeof v === 'number') {
    if (v === Infinity) { ctx.out.push('.inf'); return; }
    if (v === -Infinity) { ctx.out.push('-.inf'); return; }
    if (Number.isNaN(v)) { ctx.out.push('.nan'); return; }
    ctx.out.push(String(v));
    return;
  }
  if (typeof v === 'bigint') { ctx.out.push(String(v)); return; }

  const s = String(v);

  if (node.type === SCALAR_LITERAL || node.type === SCALAR_FOLDED) {
    renderBlockScalar(s, node.type === SCALAR_LITERAL ? '|' : '>', ctx, col);
    return;
  }
  if (node.type === SCALAR_SINGLE) { ctx.out.push(renderSingleQuoted(s)); return; }
  if (node.type === SCALAR_DOUBLE) { ctx.out.push(renderDoubleQuoted(s)); return; }

  // M3: multiline strings → block scalar (|) like eemeli
  // R3-M1: reject \r and C0 controls (except \t) — YAML §8.1.1.2 normalizes
  // line breaks in block scalars, and controls like \0/\x1b are not printable.
  if (s.includes('\n') && !/[\x00-\x08\x0b-\x1f]/.test(s)) {
    renderBlockScalar(s, '|', ctx, col);
    return;
  }

  if (isPlainSafe(s, ctx)) { ctx.out.push(s); return; }

  if (ctx.singleQuote) ctx.out.push(renderSingleQuoted(s));
  else ctx.out.push(renderDoubleQuoted(s));
}

function isPlainSafe(s: string, ctx: Ctx): boolean {
  if (s === '') return false;
  if (s === ctx.nullStr || s === ctx.trueStr || s === ctx.falseStr) return false;
  if (s === '~') return false;
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return false;
  if (/^0[0-7]+$/.test(s)) return false;
  if (/^0x[0-9a-fA-F]+$/.test(s)) return false;
  if (s === '.inf' || s === '-.inf' || s === '.nan' || s === '.Inf' || s === '.NAN') return false;
  if (/^\s|\s$/.test(s)) return false;
  if (s.includes('\n') || s.includes('\r')) return false;
  if (/[\x00-\x08\x0b-\x1f]/.test(s)) return false;
  if (/^[{}\[\],&*!|>'"%@`]/.test(s)) return false;
  if (s.includes(': ') || s.includes(' #')) return false;
  if (s.includes('\t')) return false;
  if (s.endsWith(':')) return false;
  if (s.startsWith('- ') || s.startsWith('? ')) return false;
  if (/^\d/.test(s) && s.includes(':')) return false;
  if (s === '?' || s === '-' || s === ':') return false;
  if (s.startsWith(',') || s.startsWith('[') || s.startsWith('{')) return false;
  return true;
}

function renderSingleQuoted(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function renderDoubleQuoted(s: string): string {
  // YAML double-quoted escape table matching eemeli
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    switch (c) {
      case 0x00: out += '\\0'; break;
      case 0x07: out += '\\a'; break;
      case 0x08: out += '\\b'; break;
      case 0x09: out += '\\t'; break;
      case 0x0a: out += '\\n'; break;
      case 0x0b: out += '\\v'; break;
      case 0x0c: out += '\\f'; break;
      case 0x0d: out += '\\r'; break;
      case 0x1b: out += '\\e'; break;
      case 0x22: out += '\\"'; break;
      case 0x5c: out += '\\\\'; break;
      default:
        if (c < 0x20) out += '\\x' + c.toString(16).padStart(2, '0');
        else out += s[i];
    }
  }
  return out + '"';
}

function renderBlockScalar(text: string, indicator: '|' | '>', ctx: Ctx, col: number): void {
  const lines = text.split('\n');
  const hasTrailingNewline = text.endsWith('\n');
  if (hasTrailingNewline && lines[lines.length - 1] === '') lines.pop();

  // Chomping: strip if no trailing newline, keep if last content line is blank/whitespace-only
  // R3-M2: whitespace-only lines count as blank for chomping purposes (YAML §8.1)
  let chomp = '';
  if (!hasTrailingNewline) chomp = '-';
  else {
    const lastLine = lines[lines.length - 1];
    if (lastLine !== undefined && lastLine.trim() === '') chomp = '+';
  }

  // Indent indicator: check first NON-EMPTY line for leading space
  // R3-M2: skip indent indicator for whitespace-only content (eemeli doesn't add one)
  const firstNonEmpty = lines.find(l => l.length > 0);
  let indentIndicator = '';
  if (firstNonEmpty && firstNonEmpty[0] === ' ' && firstNonEmpty.trim().length > 0) {
    indentIndicator = String(ctx.indent);
  }

  ctx.out.push(`${indicator}${chomp}${indentIndicator}`);

  if (lines.length === 0) { ctx.out.push('\n'); return; }

  const blockPad = ' '.repeat(col);

  if (indicator === '|') {
    for (let i = 0; i < lines.length; i++) {
      ctx.out.push('\n');
      if (lines[i].length > 0) {
        ctx.out.push(blockPad + lines[i]);
      } else if (i === 0) {
        // eemeli indents only the first blank line in a block scalar body
        ctx.out.push(blockPad);
      }
    }
  } else {
    let i = 0;
    while (i < lines.length) {
      ctx.out.push('\n');
      if (lines[i].length === 0) {
        if (i === 0) ctx.out.push(blockPad);
        i++;
        continue;
      }
      ctx.out.push(blockPad);
      const parts: string[] = [];
      while (i < lines.length && lines[i].length > 0) { parts.push(lines[i]); i++; }
      ctx.out.push(parts.join(' '));
    }
  }
}

// eemeli (schema/core/bool.js) preserves a bool scalar's parsed source iff it
// is a canonical bool spelling AND the source's boolean value equals the node's
// value; only otherwise does it fall back to trueStr/falseStr. Mirrored here.
const BOOL_SOURCE = /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/;
function boolSourceValue(source: string): boolean {
  return source[0] === 't' || source[0] === 'T';
}
function boolPreserved(node: Scalar): node is Scalar & { value: boolean } {
  const v = node.value;
  return typeof v === 'boolean' && node.source !== null && BOOL_SOURCE.test(node.source) && v === boolSourceValue(node.source);
}

// ---- Map -------------------------------------------------------------------

function renderMap(node: YAMLMap, ctx: Ctx, col: number, inFlow: boolean): void {
  const useFlow = inFlow || node.flow || shouldFlow(col, ctx);
  const prefix = anchorTagPrefix(node);

  if (useFlow) {
    if (prefix) ctx.out.push(prefix);
    renderFlowMap(node, ctx, col);
    return;
  }

  if (node.items.length === 0) {
    if (prefix && !ctx.prefixRendered) ctx.out.push(prefix + ' ');
    ctx.out.push('{}');
    return;
  }

  // When prefix (anchor/tag) exists and first pair has commentBefore,
  // defer prefix so it renders after the comment (matching eemeli's order)
  const firstPair = node.items[0]!;
  const firstKeyCB = firstPair?.key && isNode(firstPair.key) ? firstPair.key.commentBefore : null;
  if (prefix && !ctx.prefixRendered && firstKeyCB) {
    ctx.pendingAnchorAfterComment = prefix.trimEnd();
    ctx.prefixRendered = true;
  }

  if (prefix && !ctx.prefixRendered) {
    ctx.out.push(prefix.trimEnd());
    ctx.out.push('\n');
  }
  ctx.prefixRendered = false;

  for (let i = 0; i < node.items.length; i++) {
    const pair = node.items[i]!;
    if (i > 0) ctx.out.push('\n');
    renderBlockPair(pair, ctx, col);
  }
}

function renderBlockPair(pair: Pair, ctx: Ctx, col: number): void {
  const p = pad(col);

  // Key's commentBefore / spaceBefore appear before the pair line
  if (pair.key && isNode(pair.key)) {
    if (pair.key.spaceBefore) ctx.out.push('\n');
    if (pair.key.commentBefore) {
      ctx.out.push(p);
      emitCommentText(pair.key.commentBefore, ctx);
    }
  }

  // Deferred anchor from parent map (rendered after comment, before key)
  if (ctx.pendingAnchorAfterComment) {
    ctx.out.push(p);
    ctx.out.push(ctx.pendingAnchorAfterComment);
    ctx.out.push('\n');
    ctx.pendingAnchorAfterComment = null;
  }

  ctx.out.push(p);
  ctx.out.push(renderNodeToString(pair.key, ctx, col));
  ctx.out.push(':');

  if (pair.key && isNode(pair.key) && pair.key.comment) {
    ctx.out.push(` #${pair.key.comment}`);
  }

  if (pair.value === null || pair.value === undefined) return;

  const value = pair.value;
  const vsb = isNode(value) ? value.spaceBefore : false;
  const vcb = isNode(value) ? value.commentBefore : null;
  const vcol = col + ctx.indent;
  const valueIsBlock = isBlockCollection(value, vcol, ctx);

  if (valueIsBlock) {
    // Block collection: newline after ':', collection handles its own indent
    // ponytail: ignore vsb on block collection values — our parser sets spaceBefore
    // on every block collection value regardless of blank lines; add when parser fixed
    const valuePrefix = anchorTagPrefix(value);
    const firstItemCB = getFirstItemCommentBefore(value);
    // When first item has commentBefore, defer anchor to renderMap (after comment, before key)
    if (valuePrefix && !firstItemCB) {
      ctx.out.push(' ' + valuePrefix.trimEnd());
      ctx.prefixRendered = true;
    }
    ctx.out.push('\n');
    if (vcb) {
      ctx.out.push(pad(vcol));
      emitCommentText(vcb, ctx);
    }
    renderNode(value, ctx, vcol, false);
  } else if (vcb) {
    // Inline value with commentBefore: comment then value on next line
    ctx.out.push('\n');
    ctx.out.push(pad(vcol));
    emitCommentText(vcb, ctx);
    ctx.out.push(pad(vcol));
    renderNode(value, ctx, vcol, false);
  } else {
    // Plain inline value — ignore spaceBefore (parser artifact for inline scalars)
    ctx.out.push(' ');
    renderNode(value, ctx, vcol, false);
  }

  emitValueComment(value, p, ctx);
}

// Emit a value's trailing comment. Block scalars get their own line (inline
// would corrupt the value); other values carry an inline ` #c`.
function emitValueComment(value: Node, p: string, ctx: Ctx): void {
  if (isNode(value) && value.comment) {
    if (isScalar(value) && (value.type === SCALAR_LITERAL || value.type === SCALAR_FOLDED)) {
      ctx.out.push('\n');
      ctx.out.push(p);
      const c = value.comment;
      ctx.out.push(c.startsWith(' ') ? `#${c}` : `# ${c}`);
    } else {
      ctx.out.push(` #${value.comment}`);
    }
  }
}

function getFirstItemCommentBefore(node: Node | null): string | null {
  if (!node) return null;
  if (isMap(node) && node.items.length > 0) {
    const key = node.items[0]!.key;
    return (key && isNode(key)) ? key.commentBefore : null;
  }
  if (isSeq(node) && node.items.length > 0) {
    const item = node.items[0];
    return (item && isNode(item)) ? item.commentBefore : null;
  }
  return null;
}

function isBlockCollection(node: Node | null, col: number, ctx: Ctx): boolean {
  if (!node) return false;
  if (isMap(node) && !node.flow && !shouldFlow(col, ctx) && node.items.length > 0) return true;
  if (isSeq(node) && !node.flow && !shouldFlow(col, ctx) && node.items.length > 0) return true;
  return false;
}

function renderNodeToString(node: Node | null, ctx: Ctx, col: number): string {
  if (node === null) return ctx.nullStr;
  if (isScalar(node)) {
    const v = node.value;
    if (v === null || v === undefined) return ctx.nullStr;
    if (boolPreserved(node)) return node.source!;
    if (typeof v === 'boolean') return v ? ctx.trueStr : ctx.falseStr;
    if (typeof v === 'number') return String(v);
    const s = String(v);
    if (node.type === SCALAR_SINGLE) return renderSingleQuoted(s);
    if (node.type === SCALAR_DOUBLE) return renderDoubleQuoted(s);
    if (isPlainSafe(s, ctx)) {
      let cached = ctx.keyCache.get(s);
      if (!cached) { cached = s; ctx.keyCache.set(s, cached); }
      return cached;
    }
    return ctx.singleQuote ? renderSingleQuoted(s) : renderDoubleQuoted(s);
  }
  const saved = ctx.out;
  ctx.out = [];
  renderNode(node, ctx, col, false);
  const result = ctx.out.join('');
  ctx.out = saved;
  return result;
}

function renderFlowMap(node: YAMLMap, ctx: Ctx, col: number): void {
  if (node.items.length === 0) { ctx.out.push('{}'); return; }
  ctx.out.push('{ ');
  for (let i = 0; i < node.items.length; i++) {
    if (i > 0) ctx.out.push(', ');
    const pair = node.items[i]!;
    ctx.out.push(renderNodeToString(pair.key, ctx, col + 1));
    ctx.out.push(': ');
    if (pair.value === null) ctx.out.push(ctx.nullStr);
    else renderNode(pair.value, ctx, col + 1, true);
  }
  ctx.out.push(' }');
}

// ---- Seq -------------------------------------------------------------------

function renderSeq(node: YAMLSeq, ctx: Ctx, col: number, inFlow: boolean): void {
  const useFlow = inFlow || node.flow || shouldFlow(col, ctx);
  const prefix = anchorTagPrefix(node);

  if (useFlow) {
    if (prefix && !ctx.prefixRendered) ctx.out.push(prefix);
    ctx.prefixRendered = false;
    renderFlowSeq(node, ctx, col);
    return;
  }

  if (node.items.length === 0) {
    if (prefix && !ctx.prefixRendered) ctx.out.push(prefix + ' ');
    ctx.prefixRendered = false;
    ctx.out.push('[]');
    return;
  }

  if (prefix && !ctx.prefixRendered) {
    ctx.out.push(prefix.trimEnd());
    ctx.out.push('\n');
  }
  ctx.prefixRendered = false;

  for (let i = 0; i < node.items.length; i++) {
    const item = node.items[i]!;
    if (i > 0) ctx.out.push('\n');

    const p = pad(col);

    // ponytail: ignore spaceBefore on seq items — parser sets it on every item
    // after the first regardless of blank lines; add when parser fixed
    if (isNode(item) && item.commentBefore) {
      ctx.out.push(p);
      emitCommentText(item.commentBefore, ctx);
    }

    ctx.out.push(`${p}- `);

    renderSeqItemContent(item, ctx, col);

    if (isNode(item) && item.comment) {
      ctx.out.push(` #${item.comment}`);
    }
  }
}

// Renders a seq item whose "- " dash opener sits at column `dcol`. The item
// body continues on the same line; nested block collections recurse inline so
// dashes accumulate left-to-right (e.g. "- - - 1"), with sibling items aligned
// at the parent dash column.
function renderSeqItemContent(item: Node, ctx: Ctx, dcol: number): void {
  const ccol = dcol + 2;

  if (isMap(item) && !item.flow && !shouldFlow(ccol, ctx) && item.items.length > 0) {
    renderSeqMapItem(item, ctx, ccol);
  } else if (isSeq(item) && !item.flow && !shouldFlow(ccol, ctx) && item.items.length > 0) {
    for (let j = 0; j < item.items.length; j++) {
      if (j > 0) ctx.out.push('\n' + pad(ccol));
      ctx.out.push('- ');
      renderSeqItemContent(item.items[j]!, ctx, ccol);
    }
  } else {
    renderNode(item, ctx, ccol, false);
  }
}

// Renders a map as a seq item: first pair's key is inline after "- ", the rest
// of the pairs align at column `kcol` with the first inline key.
function renderSeqMapItem(item: YAMLMap, ctx: Ctx, kcol: number): void {
  const firstPair = item.items[0]!;
  if (firstPair.key && isNode(firstPair.key) && firstPair.key.commentBefore) {
    emitCommentText(firstPair.key.commentBefore, ctx);
  }
  ctx.out.push(renderNodeToString(firstPair.key, ctx, kcol));
  ctx.out.push(':');
  if (firstPair.key && isNode(firstPair.key) && firstPair.key.comment) {
    ctx.out.push(` #${firstPair.key.comment}`);
  }
  const vcol = kcol + ctx.indent;
  if (firstPair.value === null) {
    // nothing
  } else if (isBlockCollection(firstPair.value, vcol, ctx)) {
    ctx.out.push('\n');
    renderNode(firstPair.value, ctx, vcol, false);
  } else {
    ctx.out.push(' ');
    renderNode(firstPair.value, ctx, vcol, false);
    emitValueComment(firstPair.value, pad(vcol), ctx);
  }
  // Remaining pairs aligned with the first inline key
  for (let j = 1; j < item.items.length; j++) {
    ctx.out.push('\n');
    renderBlockPair(item.items[j]!, ctx, kcol);
  }
}

function renderFlowSeq(node: YAMLSeq, ctx: Ctx, col: number): void {
  if (node.items.length === 0) { ctx.out.push('[]'); return; }
  ctx.out.push('[ ');
  for (let i = 0; i < node.items.length; i++) {
    if (i > 0) ctx.out.push(', ');
    renderNode(node.items[i]!, ctx, col + 1, true);
  }
  ctx.out.push(' ]');
}

// ---- Alias -----------------------------------------------------------------

function renderAlias(node: Alias, ctx: Ctx): void {
  const prefix = anchorTagPrefix(node);
  if (prefix) ctx.out.push(prefix);
  ctx.out.push(`*${node.source}`);
}

// ---- valueToNode: convert plain JS values to AST nodes --------------------

function valueToNode(value: unknown): Node {
  if (value === null || value === undefined) return new Scalar(null, SCALAR_PLAIN);
  if (typeof value === 'boolean') return new Scalar(value, SCALAR_PLAIN);
  if (typeof value === 'number' || typeof value === 'bigint') return new Scalar(value, SCALAR_PLAIN);
  if (typeof value === 'string') return new Scalar(value, SCALAR_PLAIN);
  if (Array.isArray(value)) {
    const seq = new YAMLSeq();
    for (const item of value) seq.items.push(valueToNode(item) as Scalar | YAMLMap | YAMLSeq | Alias);
    return seq;
  }
  if (value instanceof Map) {
    const map = new YAMLMap();
    for (const [k, v] of value) {
      map.items.push(new Pair(
        valueToNode(k) as Scalar | YAMLMap | YAMLSeq | Alias,
        valueToNode(v) as Scalar | YAMLMap | YAMLSeq | Alias | null,
      ));
    }
    return map;
  }
  if (typeof value === 'object') {
    const map = new YAMLMap();
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      map.items.push(new Pair(
        new Scalar(k, SCALAR_PLAIN),
        valueToNode(v) as Scalar | YAMLMap | YAMLSeq | Alias | null,
      ));
    }
    return map;
  }
  return new Scalar(String(value), SCALAR_PLAIN);
}
