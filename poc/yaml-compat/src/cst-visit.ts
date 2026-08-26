/**
 * CST visit — walk a CST document or collection item depth-first.
 */

import type { BlockMap, BlockSequence, CollectionItem, Document, FlowCollection, Token } from './cst.ts';

export type VisitPath = readonly ['key' | 'value', number][];
export type Visitor = (item: CollectionItem, path: VisitPath) => number | symbol | Visitor | void;

const BREAK = Symbol('break');
const SKIP = Symbol('skip');
const REMOVE = Symbol('remove');

type Coll = BlockMap | BlockSequence | FlowCollection;

function asColl(t: any): Coll | undefined {
  if (t && (t.type === 'block-map' || t.type === 'block-seq' || t.type === 'flow-collection')) return t;
  return undefined;
}

function itemAtPath(cst: Document | CollectionItem, path: VisitPath): CollectionItem | undefined {
  let coll: Coll | undefined;

  const c = cst as any;
  if (c.type === 'document' && c.value) {
    coll = asColl(c.value);
  } else {
    coll = asColl(c);
  }

  let item: CollectionItem | undefined;
  for (const [slot, idx] of path) {
    if (!coll) return undefined;
    const items = coll.items as CollectionItem[];
    if (idx < 0 || idx >= items.length) return undefined;
    item = items[idx];
    const target = slot === 'key' ? item?.key : item?.value;
    coll = asColl(target);
  }
  return item;
}

function parentCollection(cst: Document | CollectionItem, path: VisitPath): Coll {
  if (path.length === 0) {
    const c = cst as any;
    if (c.type === 'document' && c.value) {
      const coll = asColl(c.value);
      if (coll) return coll;
    }
    const coll = asColl(c);
    if (coll) return coll;
    throw new Error('root is not a collection');
  }
  const parentPath = path.slice(0, -1);
  if (parentPath.length === 0) {
    const c = cst as any;
    if (c.type === 'document' && c.value) {
      const coll = asColl(c.value);
      if (coll) return coll;
    }
    const coll = asColl(c);
    if (coll) return coll;
    throw new Error('parent not found');
  }
  const parentItem = itemAtPath(cst, parentPath);
  if (!parentItem) throw new Error('parent not found');
  const lastStep = path[path.length - 1]!;
  const node = lastStep[0] === 'key' ? parentItem.key : parentItem.value;
  const coll = asColl(node);
  if (coll) return coll;
  throw new Error('parent is not a collection');
}

function visitCollection(
  coll: Coll,
  visitor: Visitor,
  path: VisitPath,
): boolean {
  const items = coll.items as CollectionItem[];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;

    const itemPath: VisitPath = [...path, ['value', i] as const];
    const result = visitor(item, itemPath);

    if (result === BREAK) return true;
    if (result === REMOVE) { items.splice(i, 1); i--; continue; }
    if (result === SKIP) continue;

    let childVisitor = visitor;
    if (typeof result === 'function') childVisitor = result;
    else if (typeof result === 'number') { i = result - 1; continue; }

    if (item.key) {
      const kColl = asColl(item.key);
      if (kColl) {
        const keyPath: VisitPath = [...path.slice(0, -1), ['key', path[path.length - 1]![1]]];
        if (visitCollection(kColl, childVisitor, keyPath)) return true;
      }
    }
    if (item.value) {
      const vColl = asColl(item.value);
      if (vColl) {
        if (visitCollection(vColl, childVisitor, itemPath)) return true;
      }
    }
  }
  return false;
}

export function visit(cst: Document | CollectionItem, visitor: Visitor): void {
  const c = cst as any;
  let coll: Coll | undefined;
  if (c.type === 'document' && c.value) {
    coll = asColl(c.value);
  } else {
    coll = asColl(c);
  }
  if (coll) visitCollection(coll, visitor, []);
}

visit.BREAK = BREAK;
visit.SKIP = SKIP;
visit.REMOVE = REMOVE;
visit.itemAtPath = itemAtPath;
visit.parentCollection = parentCollection;
