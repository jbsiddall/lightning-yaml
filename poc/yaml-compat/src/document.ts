/**
 * Document class — wraps a parsed AST root with metadata, errors, directives.
 * Mirrors eemeli/yaml v2 Document API for the POC scope.
 */

import {
  Scalar, YAMLMap, YAMLSeq, Pair, Alias,
  isScalar, isMap, isSeq, isPair, isAlias,
  type Node, type Range,
} from './nodes.ts';
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
  toJS(opts?: { mapAsMap?: boolean; maxAliasCount?: number; merge?: boolean }): unknown {
    const merge = opts?.merge ?? this.options.merge ?? false;
    const maxAliasCount = opts?.maxAliasCount ?? 100;
    const mapAsMap = opts?.mapAsMap ?? false;

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

