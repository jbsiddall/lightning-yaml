/**
 * AST node classes for the yaml-compat POC parser.
 *
 * Fixed-shape monomorphic classes: every instance has the same fields in the
 * same order, assigned in the constructor. This maximizes V8 hidden-class
 * sharing and avoids dictionary-mode transitions.
 *
 * Node types: Scalar, YAMLMap, YAMLSeq, Pair, Alias
 * Range: [start, valueEnd, nodeEnd] tuple (eemeli semantics)
 */

// ---- Range type (3-element tuple) ------------------------------------------

export type Range = [number, number, number];

// ---- Node base (not exported as a class — each subclass declares its own
// fields in the same order for V8 hidden-class sharing) ---------------------

export type NodeType =
  | 'PLAIN'
  | 'QUOTE_SINGLE'
  | 'QUOTE_DOUBLE'
  | 'BLOCK_FOLDED'
  | 'BLOCK_LITERAL'
  | 'MAP'
  | 'SEQ'
  | 'PAIR'
  | 'ALIAS'
  | 'DOCUMENT';

// ---- Scalar ----------------------------------------------------------------

export const SCALAR_PLAIN = 'PLAIN' as const;
export const SCALAR_SINGLE = 'QUOTE_SINGLE' as const;
export const SCALAR_DOUBLE = 'QUOTE_DOUBLE' as const;
export const SCALAR_FOLDED = 'BLOCK_FOLDED' as const;
export const SCALAR_LITERAL = 'BLOCK_LITERAL' as const;

export class Scalar {
  type: typeof SCALAR_PLAIN | typeof SCALAR_SINGLE | typeof SCALAR_DOUBLE | typeof SCALAR_FOLDED | typeof SCALAR_LITERAL;
  value: unknown;
  anchor: string | null;
  tag: string | null;
  range: Range | null;
  commentBefore: string | null;
  comment: string | null;
  spaceBefore: boolean;

  constructor(
    value: unknown,
    type: typeof SCALAR_PLAIN | typeof SCALAR_SINGLE | typeof SCALAR_DOUBLE | typeof SCALAR_FOLDED | typeof SCALAR_LITERAL = SCALAR_PLAIN,
  ) {
    this.type = type;
    this.value = value;
    this.anchor = null;
    this.tag = null;
    this.range = null;
    this.commentBefore = null;
    this.comment = null;
    this.spaceBefore = false;
  }
}

// ---- Pair ------------------------------------------------------------------

export class Pair {
  key: Scalar | YAMLMap | YAMLSeq | Alias | null;
  value: Scalar | YAMLMap | YAMLSeq | Alias | null;
  range: Range | null;

  constructor(
    key: Scalar | YAMLMap | YAMLSeq | Alias | null | unknown,
    value: Scalar | YAMLMap | YAMLSeq | Alias | null | unknown,
  ) {
    // Wrap plain JS values in Scalar nodes so that programmatic construction
    // (e.g. `new Pair('k', 'v')`) produces renderable AST nodes.
    this.key = (key === null || key instanceof Scalar || key instanceof YAMLMap || key instanceof YAMLSeq || key instanceof Alias)
      ? key as Scalar | YAMLMap | YAMLSeq | Alias | null
      : new Scalar(key as unknown, SCALAR_PLAIN);
    this.value = (value === null || value instanceof Scalar || value instanceof YAMLMap || value instanceof YAMLSeq || value instanceof Alias)
      ? value as Scalar | YAMLMap | YAMLSeq | Alias | null
      : new Scalar(value as unknown, SCALAR_PLAIN);
    this.range = null;
  }
}

// ---- YAMLMap ---------------------------------------------------------------

export class YAMLMap {
  type: 'MAP';
  items: Pair[];
  anchor: string | null;
  tag: string | null;
  range: Range | null;
  commentBefore: string | null;
  comment: string | null;
  spaceBefore: boolean;
  flow: boolean;

  constructor() {
    this.type = 'MAP';
    this.items = [];
    this.anchor = null;
    this.tag = null;
    this.range = null;
    this.commentBefore = null;
    this.comment = null;
    this.spaceBefore = false;
    this.flow = false;
  }
}

// ---- YAMLSeq ---------------------------------------------------------------

export class YAMLSeq {
  type: 'SEQ';
  items: (Scalar | YAMLMap | YAMLSeq | Alias)[];
  anchor: string | null;
  tag: string | null;
  range: Range | null;
  commentBefore: string | null;
  comment: string | null;
  spaceBefore: boolean;
  flow: boolean;

  constructor() {
    this.type = 'SEQ';
    this.items = [];
    this.anchor = null;
    this.tag = null;
    this.range = null;
    this.commentBefore = null;
    this.comment = null;
    this.spaceBefore = false;
    this.flow = false;
  }
}

// ---- Alias -----------------------------------------------------------------

export class Alias {
  type: 'ALIAS';
  source: string;
  anchor: string | null;
  tag: string | null;
  range: Range | null;
  commentBefore: string | null;
  comment: string | null;
  spaceBefore: boolean;

  constructor(source: string) {
    this.type = 'ALIAS';
    this.source = source;
    this.anchor = null;
    this.tag = null;
    this.range = null;
    this.commentBefore = null;
    this.comment = null;
    this.spaceBefore = false;
  }
}

// ---- Type guards -----------------------------------------------------------

export type Node = Scalar | YAMLMap | YAMLSeq | Alias;

export function isNode(value: unknown): value is Node {
  return (
    value instanceof Scalar ||
    value instanceof YAMLMap ||
    value instanceof YAMLSeq ||
    value instanceof Alias
  );
}

export function isScalar(value: unknown): value is Scalar {
  return value instanceof Scalar;
}

export function isMap(value: unknown): value is YAMLMap {
  return value instanceof YAMLMap;
}

export function isSeq(value: unknown): value is YAMLSeq {
  return value instanceof YAMLSeq;
}

export function isPair(value: unknown): value is Pair {
  return value instanceof Pair;
}

export function isAlias(value: unknown): value is Alias {
  return value instanceof Alias;
}

export function isCollection(value: unknown): value is YAMLMap | YAMLSeq {
  return value instanceof YAMLMap || value instanceof YAMLSeq;
}

export function isDocument(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    'contents' in value &&
    'directives' in value &&
    'errors' in value
  );
}
