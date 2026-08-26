/**
 * CST token types — mirrors yaml/dist/parse/cst surface.
 * Token types, helpers, and constants.
 */

// ---- Token interfaces ------------------------------------------------------

export interface SourceToken {
  type: 'byte-order-mark' | 'doc-mode' | 'doc-start' | 'space' | 'comment' |
        'newline' | 'directive-line' | 'anchor' | 'tag' | 'seq-item-ind' |
        'explicit-key-ind' | 'map-value-ind' | 'flow-map-start' | 'flow-map-end' |
        'flow-seq-start' | 'flow-seq-end' | 'flow-error-end' | 'comma' |
        'block-scalar-header';
  offset: number;
  indent: number;
  source: string;
}

export interface ErrorToken {
  type: 'error';
  offset: number;
  source: string;
  message: string;
}

export interface Directive {
  type: 'directive';
  offset: number;
  source: string;
}

export interface Document {
  type: 'document';
  offset: number;
  start: SourceToken[];
  value?: Token;
  end?: SourceToken[];
  /** @internal Original source string — used by Composer to avoid stringify→reparse. */
  _source?: string;
}

export interface DocumentEnd {
  type: 'doc-end';
  offset: number;
  source: string;
  end?: SourceToken[];
}

export interface FlowScalar {
  type: 'alias' | 'scalar' | 'single-quoted-scalar' | 'double-quoted-scalar';
  offset: number;
  indent: number;
  source: string;
  end?: SourceToken[];
}

export interface BlockScalar {
  type: 'block-scalar';
  offset: number;
  indent: number;
  props: Token[];
  source: string;
}

export interface BlockMap {
  type: 'block-map';
  offset: number;
  indent: number;
  items: Array<{
    start: SourceToken[];
    explicitKey?: true;
    key?: never;
    sep?: never;
    value?: never;
  } | {
    start: SourceToken[];
    explicitKey?: true;
    key: Token | null;
    sep: SourceToken[];
    value?: Token;
  }>;
}

export interface BlockSequence {
  type: 'block-seq';
  offset: number;
  indent: number;
  items: Array<{
    start: SourceToken[];
    key?: never;
    sep?: never;
    value?: Token;
  }>;
}

export type CollectionItem = {
  start: SourceToken[];
  key?: Token | null;
  sep?: SourceToken[];
  value?: Token;
};

export interface FlowCollection {
  type: 'flow-collection';
  offset: number;
  indent: number;
  start: SourceToken;
  items: CollectionItem[];
  end: SourceToken[];
}

export type Token = SourceToken | ErrorToken | Directive | Document |
  DocumentEnd | FlowScalar | BlockScalar | BlockMap | BlockSequence |
  FlowCollection;

export type TokenType = SourceToken['type'] | DocumentEnd['type'] | FlowScalar['type'];

// ---- Constants (control characters) ----------------------------------------

export const BOM = '﻿';
export const DOCUMENT = '';
export const FLOW_END = '';
export const SCALAR = '';

// ---- Helpers ---------------------------------------------------------------

export const isCollection = (token: Token | null | undefined): token is BlockMap | BlockSequence | FlowCollection =>
  token != null && (token.type === 'block-map' || token.type === 'block-seq' || token.type === 'flow-collection');

export const isScalar = (token: Token | null | undefined): token is FlowScalar | BlockScalar =>
  token != null && (token.type === 'scalar' || token.type === 'single-quoted-scalar' ||
    token.type === 'double-quoted-scalar' || token.type === 'block-scalar' || token.type === 'alias');

export function prettyToken(token: string): string {
  if (token === BOM) return '<BOM>';
  if (token === DOCUMENT) return '<DOC>';
  if (token === FLOW_END) return '<FLOW_END>';
  if (token === SCALAR) return '<SCALAR>';
  if (token === '\n') return '<newline>';
  if (token === '\r') return '<CR>';
  if (token === '\t') return '<tab>';
  if (token === ' ') return '<space>';
  return JSON.stringify(token);
}

export function tokenType(source: string): TokenType | null {
  switch (source) {
    case BOM: return 'byte-order-mark';
    case DOCUMENT: return 'doc-mode';
    case '---': return 'doc-start';
    case '...': return 'doc-end';
    case '\n': return 'newline';
    case ' ': return 'space';
    case '\t': return 'space';
    case '-': return 'seq-item-ind';
    case '?': return 'explicit-key-ind';
    case ':': return 'map-value-ind';
    case '{': return 'flow-map-start';
    case '}': return 'flow-map-end';
    case '[': return 'flow-seq-start';
    case ']': return 'flow-seq-end';
    case ',': return 'comma';
    default:
      if (source.startsWith('#')) return 'comment';
      if (source.startsWith('%')) return 'directive-line';
      if (source.startsWith('&')) return 'anchor';
      if (source.startsWith('!')) return 'tag';
      if (source.startsWith("'")) return 'single-quoted-scalar';
      if (source.startsWith('"')) return 'double-quoted-scalar';
      if (source.startsWith('*')) return 'alias';
      if (/^[|>]/.test(source)) return 'block-scalar-header';
      return 'scalar';
  }
}

// Re-export stringify
export { stringify } from './cst-stringify.ts';
