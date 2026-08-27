/**
 * Document class — wraps a parsed AST root with metadata, errors, directives.
 * Mirrors eemeli/yaml v2 Document API for the POC scope.
 */

import {
  Scalar, YAMLMap, YAMLSeq, Pair, Alias,
  isScalar, isMap, isSeq, isPair, isAlias, isNode,
  SCALAR_PLAIN,
  type Node, type Range,
} from './nodes.ts';

/** Wrap a plain JS value in a Scalar; pass through Node/null unchanged. */
function wrapNode(v: unknown): Scalar | YAMLMap | YAMLSeq | Alias | null {
  if (v === null || v === undefined) return new Scalar(null, SCALAR_PLAIN);
  if (isNode(v)) return v as Scalar | YAMLMap | YAMLSeq | Alias;
  return new Scalar(v, SCALAR_PLAIN);
}
import type { YAMLParseError, YAMLWarning } from './errors.ts';
import type { ParseOptions, CustomTag } from './options.ts';
import { stringify as astStringify } from './stringify.ts';
import type { StringifyOptions } from './stringify.ts';

export interface Directives {
  yaml: { explicit?: boolean; version: string };
  tags: Record<string, string>;
  docStart: boolean | null;
  docEnd: boolean;
}

export class Document {
  contents: Node | null;
  errors: YAMLParseError[];
  warnings: YAMLWarning[];
  directives: Directives;
  commentBefore: string | null;
  comment: string | null;
  range: Range | undefined;
  options: ParseOptions;

  constructor(
    contents: Node | null = null,
    options: ParseOptions = {},
  ) {
    this.contents = contents;
    this.errors = [];
    this.warnings = [];
    this.directives = {
      yaml: { version: options.version ?? '1.2' },
      tags: { '!!': 'tag:yaml.org,2002:' },
      docStart: null,
      docEnd: false,
    };
    this.commentBefore = null;
    this.comment = null;
    this.range = undefined;
    this.options = options;
  }

  /** Convert the AST to plain JS values. */
  toJS(opts?: { mapAsMap?: boolean; maxAliasCount?: number; merge?: boolean; intAsBigInt?: boolean }): unknown {
    if (opts?.mapAsMap) throw new Error('Not implemented in POC: mapAsMap');
    if (opts?.intAsBigInt) throw new Error('Not implemented in POC: intAsBigInt');
    const merge = opts?.merge ?? this.options.merge ?? false;
    const maxAliasCount = opts?.maxAliasCount ?? 100;
    const mapAsMap = false;

    const anchorMap = new Map<string, Node>();
    collectAnchors(this.contents, anchorMap);

    return nodeToJS(this.contents, anchorMap, { total: 0 }, maxAliasCount, merge, mapAsMap, new Map());
  }

  /** Get a value at a top-level key. */
  get(key: unknown, keepScalar?: boolean): unknown {
    if (isMap(this.contents)) {
      for (const pair of this.contents.items) {
        if (isScalar(pair.key) && pair.key.value === key) {
          if (keepScalar) return pair.value;
          if (isScalar(pair.value)) return pair.value.value;
          return pair.value;
        }
      }
    }
    return undefined;
  }

  /** Deep path access — returns Node when keepSource=true, value otherwise. */
  getIn(path: Iterable<unknown>, keepScalar?: boolean): unknown {
    let node: Node | null = this.contents;
    for (const key of path) {
      if (node === null) return undefined;
      if (isAlias(node)) {
        // Resolve alias
        const anchorName = node.source;
        // Look up in the doc's anchors... this is a simplified version
        return undefined;
      }
      if (isMap(node)) {
        let found = false;
        for (const pair of node.items) {
          if (isScalar(pair.key) && pair.key.value === key) {
            node = pair.value;
            found = true;
            break;
          }
        }
        if (!found) return undefined;
      } else if (isSeq(node)) {
        const idx = typeof key === 'number' ? key : parseInt(String(key), 10);
        if (isNaN(idx) || idx < 0 || idx >= node.items.length) return undefined;
        node = node.items[idx] ?? null;
      } else {
        return undefined;
      }
    }
    if (keepScalar) return node;
    if (isScalar(node)) return node.value;
    return node;
  }

  /** Set a top-level key in the document's map. */
  set(key: unknown, value: unknown): void {
    if (!isMap(this.contents)) {
      this.contents = new YAMLMap();
    }
    const map = this.contents;
    const valueNode = isNode(value) ? value as Node : new Scalar(value);
    for (const pair of map.items) {
      if (isScalar(pair.key) && pair.key.value === key) {
        pair.value = valueNode;
        return;
      }
    }
    map.items.push(new Pair(new Scalar(key), valueNode));
  }

  /** Set a value at a deep path. */
  setIn(path: Iterable<unknown>, value: unknown): void {
    const keys = Array.from(path);
    if (keys.length === 0) {
      this.contents = isNode(value) ? value as Node : new Scalar(value);
      return;
    }
    if (!this.contents) {
      this.contents = new YAMLMap();
    }
    let node: Node = this.contents;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i]!;
      if (isMap(node)) {
        let found = false;
        for (const pair of node.items) {
          if (isScalar(pair.key) && pair.key.value === k) {
            if (pair.value === null) {
              const next = new YAMLMap();
              pair.value = next;
              node = next;
            } else {
              node = pair.value;
            }
            found = true;
            break;
          }
        }
        if (!found) {
          const next = new YAMLMap();
          (node as YAMLMap).items.push(new Pair(new Scalar(k), next));
          node = next;
        }
      } else if (isSeq(node)) {
        const idx = typeof k === 'number' ? k : parseInt(String(k), 10);
        if (idx >= 0 && idx < node.items.length && node.items[idx]) {
          node = node.items[idx] as Node;
        } else {
          const next = new YAMLMap();
          while (node.items.length <= idx) node.items.push(new Scalar(null));
          node.items[idx] = next;
          node = next;
        }
      } else {
        return; // can't navigate through scalar
      }
    }
    const lastKey = keys[keys.length - 1]!;
    const valueNode = isNode(value) ? value as Node : new Scalar(value);
    if (isMap(node)) {
      for (const pair of node.items) {
        if (isScalar(pair.key) && pair.key.value === lastKey) {
          pair.value = valueNode;
          return;
        }
      }
      node.items.push(new Pair(new Scalar(lastKey), valueNode));
    } else if (isSeq(node)) {
      const idx = typeof lastKey === 'number' ? lastKey : parseInt(String(lastKey), 10);
      while (node.items.length <= idx) node.items.push(new Scalar(null));
      node.items[idx] = valueNode as Scalar | YAMLMap | YAMLSeq | Alias;
    }
  }

  /** Check if a top-level key exists. */
  has(key: unknown): boolean {
    if (!isMap(this.contents)) return false;
    return this.contents.items.some(p => isScalar(p.key) && p.key.value === key);
  }

  /** Check if a deep path exists. */
  hasIn(path: Iterable<unknown>): boolean {
    let node: Node | null = this.contents;
    for (const key of path) {
      if (node === null) return false;
      if (isMap(node)) {
        let found = false;
        for (const pair of node.items) {
          if (isScalar(pair.key) && pair.key.value === key) {
            node = pair.value;
            found = true;
            break;
          }
        }
        if (!found) return false;
      } else if (isSeq(node)) {
        const idx = typeof key === 'number' ? key : parseInt(String(key), 10);
        if (isNaN(idx) || idx < 0 || idx >= node.items.length) return false;
        node = node.items[idx] ?? null;
      } else {
        return false;
      }
    }
    return true;
  }

  /** Delete a top-level key. Returns true if deleted. */
  delete(key: unknown): boolean {
    if (!isMap(this.contents)) return false;
    const items = this.contents.items;
    for (let i = 0; i < items.length; i++) {
      const pair = items[i]!;
      if (isScalar(pair.key) && pair.key.value === key) {
        items.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  /** Delete at a deep path. Returns true if deleted. */
  deleteIn(path: Iterable<unknown>): boolean {
    const keys = Array.from(path);
    if (keys.length === 0) {
      this.contents = null;
      return true;
    }
    let node: Node | null = this.contents;
    for (let i = 0; i < keys.length - 1; i++) {
      if (node === null) return false;
      if (isMap(node)) {
        let found = false;
        for (const pair of node.items) {
          if (isScalar(pair.key) && pair.key.value === keys[i]) {
            node = pair.value;
            found = true;
            break;
          }
        }
        if (!found) return false;
      } else if (isSeq(node)) {
        const idx = typeof keys[i] === 'number' ? keys[i] as number : parseInt(String(keys[i]), 10);
        if (isNaN(idx) || idx < 0 || idx >= node.items.length) return false;
        node = node.items[idx] ?? null;
      } else {
        return false;
      }
    }
    const lastKey = keys[keys.length - 1]!;
    if (isMap(node)) {
      const items = node.items;
      for (let i = 0; i < items.length; i++) {
        const pair = items[i]!;
        if (isScalar(pair.key) && pair.key.value === lastKey) {
          items.splice(i, 1);
          return true;
        }
      }
    } else if (isSeq(node)) {
      const idx = typeof lastKey === 'number' ? lastKey : parseInt(String(lastKey), 10);
      if (idx >= 0 && idx < node.items.length) {
        node.items.splice(idx, 1);
        return true;
      }
    }
    return false;
  }

  /** Add a Pair to the top-level map, or an item to the top-level seq. */
  add(pair: Pair | Node | unknown): void {
    if (isMap(this.contents)) {
      if (isPair(pair)) {
        this.contents.items.push(pair as Pair);
      } else {
        // eemeli: plain value becomes a key with null value
        const key = isNode(pair) ? pair as Scalar | YAMLMap | YAMLSeq | Alias : new Scalar(pair, SCALAR_PLAIN);
        this.contents.items.push(new Pair(key, new Scalar(null)));
      }
    } else if (isSeq(this.contents)) {
      this.contents.items.push(wrapNode(pair) as Scalar | YAMLMap | YAMLSeq | Alias);
    }
  }

  /** Add to collection at path. */
  addIn(path: Iterable<unknown>, pair: Pair | Node | unknown): void {
    const keys = Array.from(path);
    let node: Node | null = this.contents;
    for (const key of keys) {
      if (node === null) return;
      if (isMap(node)) {
        for (const p of node.items) {
          if (isScalar(p.key) && p.key.value === key) {
            node = p.value;
            break;
          }
        }
      } else if (isSeq(node)) {
        const idx = typeof key === 'number' ? key : parseInt(String(key), 10);
        node = node.items[idx] ?? null;
      }
    }
    if (isMap(node)) {
      if (isPair(pair)) {
        node.items.push(pair as Pair);
      } else {
        const key = isNode(pair) ? pair as Scalar | YAMLMap | YAMLSeq | Alias : new Scalar(pair, SCALAR_PLAIN);
        node.items.push(new Pair(key, new Scalar(null)));
      }
    } else if (isSeq(node)) {
      node.items.push(wrapNode(pair) as Scalar | YAMLMap | YAMLSeq | Alias);
    }
  }

  /** Deep clone the document. */
  clone(): Document {
    const cloned = new Document(null, { ...this.options });
    cloned.contents = this.contents ? cloneNode(this.contents) : null;
    cloned.errors = [...this.errors];
    cloned.warnings = [...this.warnings];
    cloned.directives = JSON.parse(JSON.stringify(this.directives));
    cloned.commentBefore = this.commentBefore;
    cloned.comment = this.comment;
    cloned.range = this.range ? [...this.range] as Range : undefined;
    return cloned;
  }

  /** Alias for toJS with options. */
  toJSON(opts?: { mapAsMap?: boolean; maxAliasCount?: number }): unknown {
    return this.toJS(opts);
  }

  /** Convert a JS value to AST nodes. */
  createNode(value: unknown): Node {
    return valueToNode(value);
  }

  /** Render the document back to YAML, preserving comments and directives. */
  toString(opts?: StringifyOptions): string {
    return astStringify(this, opts);
  }
}

// ---- Anchor collection -----------------------------------------------------

function collectAnchors(node: Node | null, map: Map<string, Node>): void {
  if (!node) return;
  if (node.anchor) {
    map.set(node.anchor, node);
  }
  if (isMap(node)) {
    for (const pair of node.items) {
      collectAnchors(pair.key, map);
      collectAnchors(pair.value, map);
    }
  } else if (isSeq(node)) {
    for (const item of node.items) {
      collectAnchors(item, map);
    }
  }
}

// ---- toJS ------------------------------------------------------------------

function nodeToJS(
  node: Node | null,
  anchors: Map<string, Node>,
  aliasCount: { total: number },
  maxAliasCount: number,
  merge: boolean,
  mapAsMap: boolean,
  resolved: Map<Node, unknown>,
): unknown {
  if (!node) return null;

  if (isScalar(node)) {
    // !!binary is not implemented — throw loud per DEFER doctrine
    if (node.tag === '!!binary') {
      throw new Error('Not implemented in POC: !!binary');
    }
    return node.value;
  }

  if (isAlias(node)) {
    const target = anchors.get(node.source);
    if (!target) throw new ReferenceError(`Unresolved alias (the anchor must be set before the alias): ${node.source}`);
    // Enforce maxAliasCount (-1 = unlimited)
    if (maxAliasCount >= 0) {
      aliasCount.total++;
      if (aliasCount.total > maxAliasCount) {
        throw new ReferenceError('Excessive alias count indicates a resource exhaustion attack');
      }
    }
    // Cycle detection: if target is already being resolved, return the partial object
    if (resolved.has(target)) return resolved.get(target);
    return nodeToJS(target, anchors, aliasCount, maxAliasCount, merge, mapAsMap, resolved);
  }

  if (isSeq(node)) {
    const arr: unknown[] = [];
    resolved.set(node, arr);
    for (const item of node.items) {
      arr.push(nodeToJS(item, anchors, aliasCount, maxAliasCount, merge, mapAsMap, resolved));
    }
    return arr;
  }

  if (isMap(node)) {
    // Check for !!binary on maps (unlikely but be safe)
    if (node.tag === '!!binary') {
      throw new Error('Not implemented in POC: !!binary');
    }
    const obj: Record<string, unknown> = {};
    resolved.set(node, obj);
    for (const pair of node.items) {
      // Merge key handling
      if (merge && isScalar(pair.key) && pair.key.value === '<<') {
        const mergeValue = nodeToJS(pair.value, anchors, aliasCount, maxAliasCount, merge, mapAsMap, resolved);
        if (mergeValue && typeof mergeValue === 'object' && !Array.isArray(mergeValue)) {
          for (const [k, v] of Object.entries(mergeValue)) {
            if (!(k in obj)) obj[k] = v;
          }
        } else if (Array.isArray(mergeValue)) {
          for (const m of mergeValue) {
            if (m && typeof m === 'object' && !Array.isArray(m)) {
              for (const [k, v] of Object.entries(m)) {
                if (!(k in obj)) obj[k] = v;
              }
            }
          }
        }
        continue;
      }

      const key = isScalar(pair.key) ? String(pair.key.value) : String(nodeToJS(pair.key, anchors, aliasCount, maxAliasCount, merge, mapAsMap, resolved));
      const value = nodeToJS(pair.value, anchors, aliasCount, maxAliasCount, merge, mapAsMap, resolved);
      obj[key] = value;
    }

    if (mapAsMap) {
      return new Map(Object.entries(obj));
    }
    return obj;
  }

  return null;
}

// ---- cloneNode -------------------------------------------------------------

function cloneNode(node: Node): Node {
  if (isScalar(node)) {
    const s = new Scalar(node.value, node.type);
    s.anchor = node.anchor;
    s.tag = node.tag;
    s.range = node.range ? [...node.range] as Range : null;
    s.commentBefore = node.commentBefore;
    s.comment = node.comment;
    s.spaceBefore = node.spaceBefore;
    return s;
  }
  if (isPair(node)) {
    const p = new Pair(
      node.key ? cloneNode(node.key) as Scalar | YAMLMap | YAMLSeq | Alias | null : null,
      node.value ? cloneNode(node.value) as Scalar | YAMLMap | YAMLSeq | Alias | null : null,
    );
    p.range = node.range ? [...node.range] as Range : null;
    return p as unknown as Node;
  }
  if (isMap(node)) {
    const m = new YAMLMap();
    m.anchor = node.anchor;
    m.tag = node.tag;
    m.range = node.range ? [...node.range] as Range : null;
    m.commentBefore = node.commentBefore;
    m.comment = node.comment;
    m.spaceBefore = node.spaceBefore;
    m.flow = node.flow;
    for (const pair of node.items) {
      m.items.push(cloneNode(pair as unknown as Node) as unknown as Pair);
    }
    return m;
  }
  if (isSeq(node)) {
    const s = new YAMLSeq();
    s.anchor = node.anchor;
    s.tag = node.tag;
    s.range = node.range ? [...node.range] as Range : null;
    s.commentBefore = node.commentBefore;
    s.comment = node.comment;
    s.spaceBefore = node.spaceBefore;
    s.flow = node.flow;
    for (const item of node.items) {
      if (item) s.items.push(cloneNode(item) as Scalar | YAMLMap | YAMLSeq | Alias);
      else s.items.push(new Scalar(null));
    }
    return s;
  }
  if (node instanceof Alias) {
    const a = new Alias(node.source);
    a.anchor = node.anchor;
    a.tag = node.tag;
    a.range = node.range ? [...node.range] as Range : null;
    a.commentBefore = node.commentBefore;
    a.comment = node.comment;
    a.spaceBefore = node.spaceBefore;
    return a;
  }
  return node;
}

// ---- valueToNode -----------------------------------------------------------

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

