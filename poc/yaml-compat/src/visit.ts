/**
 * AST visitor — depth-first walk with SKIP/BREAK/REMOVE controls.
 * Mirrors eemeli/yaml v2 visit() API.
 */

import {
  Scalar, YAMLMap, YAMLSeq, Pair, Alias,
  isScalar, isMap, isSeq, isPair, isAlias,
  type Node,
} from './nodes.ts';
import type { Document } from './document.ts';

const SKIP = Symbol('skip');
const BREAK = Symbol('break');
const REMOVE = Symbol('remove');

type VisitorKey = number | 'key' | 'value' | null;
type VisitorPath = readonly (Document | Node | Pair)[];
type VisitorReturn = void | symbol | number | Node | Pair;

type VisitorFn<T> = (key: VisitorKey, node: T, path: VisitorPath) => VisitorReturn;

type Visitor = VisitorFn<unknown> | {
  Alias?: VisitorFn<Alias>;
  Collection?: VisitorFn<YAMLMap | YAMLSeq>;
  Map?: VisitorFn<YAMLMap>;
  Node?: VisitorFn<Alias | Scalar | YAMLMap | YAMLSeq>;
  Pair?: VisitorFn<Pair>;
  Scalar?: VisitorFn<Scalar>;
  Seq?: VisitorFn<YAMLSeq>;
  Value?: VisitorFn<Scalar | YAMLMap | YAMLSeq>;
};

function visitNode(
  key: VisitorKey,
  node: Node | Pair,
  path: VisitorPath,
  visitor: Visitor,
): VisitorReturn {
  // Call the visitor
  let result: VisitorReturn = undefined;

  if (typeof visitor === 'function') {
    result = visitor(key, node, path);
  } else {
    // Object visitor — dispatch by node type
    if (isPair(node)) {
      result = visitor.Pair?.(key, node, path);
    } else if (isAlias(node)) {
      result = visitor.Alias?.(key, node, path) ?? visitor.Node?.(key, node, path);
    } else if (isScalar(node)) {
      result = visitor.Scalar?.(key, node, path) ?? visitor.Value?.(key, node, path) ?? visitor.Node?.(key, node, path);
    } else if (isMap(node)) {
      result = visitor.Map?.(key, node, path) ?? visitor.Collection?.(key, node, path) ?? visitor.Value?.(key, node, path) ?? visitor.Node?.(key, node, path);
    } else if (isSeq(node)) {
      result = visitor.Seq?.(key, node, path) ?? visitor.Collection?.(key, node, path) ?? visitor.Value?.(key, node, path) ?? visitor.Node?.(key, node, path);
    }
  }

  if (result === BREAK || result === SKIP || result === REMOVE) return result;
  if (typeof result === 'number') return result;
  if (result !== undefined && typeof result === 'object') return result;

  // Visit children
  if (isPair(node)) {
    if (node.key) {
      const r = visitNode('key', node.key, [...path, node], visitor);
      if (r === BREAK) return BREAK;
      if (r === REMOVE) { node.key = null; }
      else if (r !== undefined && r !== SKIP && typeof r === 'object') {
        node.key = r as Node;
      }
    }
    if (node.value) {
      const r = visitNode('value', node.value, [...path, node], visitor);
      if (r === BREAK) return BREAK;
      if (r === REMOVE) { node.value = null; }
      else if (r !== undefined && r !== SKIP && typeof r === 'object') {
        node.value = r as Node;
      }
    }
  } else if (isMap(node)) {
    for (let i = 0; i < node.items.length; i++) {
      const r = visitNode(i, node.items[i]!, [...path, node], visitor);
      if (r === BREAK) return BREAK;
      if (r === REMOVE) {
        node.items.splice(i, 1);
        i--;
      } else if (typeof r === 'number') {
        i = r - 1;
      }
    }
  } else if (isSeq(node)) {
    for (let i = 0; i < node.items.length; i++) {
      const item = node.items[i]!;
      const r = visitNode(i, item, [...path, node], visitor);
      if (r === BREAK) return BREAK;
      if (r === REMOVE) {
        node.items.splice(i, 1);
        i--;
      } else if (typeof r === 'number') {
        i = r - 1;
      }
    }
  }

  return undefined;
}

export function visit(
  doc: Node | Document | null,
  visitor: Visitor,
): void {
  if (!doc) return;

  // Handle Document wrapper
  let root: Node | null;
  if ('contents' in doc) {
    root = doc.contents;
  } else {
    root = doc;
  }

  if (!root) return;
  visitNode(null, root, [], visitor);
}

visit.SKIP = SKIP;
visit.BREAK = BREAK;
visit.REMOVE = REMOVE;
