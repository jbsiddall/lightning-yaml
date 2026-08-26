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

    const aliasCounts = new Map<Node, number>();

    return nodeToJS(this.contents, anchorMap, aliasCounts, maxAliasCount, merge, mapAsMap);
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

  /** Minimal toString — renders the document back to YAML. */
  toString(): string {
    if (this.errors.length > 0) {
      throw new Error('Document has errors: ' + this.errors.map(e => e.message).join('; '));
    }
    const lines: string[] = [];
    if (this.directives.yaml.explicit) {
      lines.push(`%YAML ${this.directives.yaml.version}`);
    }
    if (this.directives.docStart) {
      lines.push('---');
    }
    if (this.contents) {
      lines.push(nodeToString(this.contents, 0));
    }
    if (this.directives.docEnd) {
      lines.push('...');
    }
    return lines.join('\n') + '\n';
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
  aliasCounts: Map<Node, number>,
  maxAliasCount: number,
  merge: boolean,
  mapAsMap: boolean,
): unknown {
  if (!node) return null;

  if (isScalar(node)) {
    return node.value;
  }

  if (isAlias(node)) {
    const target = anchors.get(node.source);
    if (!target) return undefined;
    return nodeToJS(target, anchors, aliasCounts, maxAliasCount, merge, mapAsMap);
  }

  if (isSeq(node)) {
    const arr: unknown[] = [];
    for (const item of node.items) {
      arr.push(nodeToJS(item, anchors, aliasCounts, maxAliasCount, merge, mapAsMap));
    }
    return arr;
  }

  if (isMap(node)) {
    const obj: Record<string, unknown> = {};
    for (const pair of node.items) {
      // Merge key handling
      if (merge && isScalar(pair.key) && pair.key.value === '<<') {
        const mergeValue = nodeToJS(pair.value, anchors, aliasCounts, maxAliasCount, merge, mapAsMap);
        if (mergeValue && typeof mergeValue === 'object' && !Array.isArray(mergeValue)) {
          // Merge the object's keys into obj (only if not already set)
          for (const [k, v] of Object.entries(mergeValue)) {
            if (!(k in obj)) obj[k] = v;
          }
        } else if (Array.isArray(mergeValue)) {
          // Merge key with array of maps
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

      const key = isScalar(pair.key) ? String(pair.key.value) : String(nodeToJS(pair.key, anchors, aliasCounts, maxAliasCount, merge, mapAsMap));
      const value = nodeToJS(pair.value, anchors, aliasCounts, maxAliasCount, merge, mapAsMap);
      obj[key] = value;
    }

    if (mapAsMap) {
      return new Map(Object.entries(obj));
    }
    return obj;
  }

  return null;
}

// ---- Simple toString (minimal rendering) -----------------------------------

function nodeToString(node: Node, indent: number): string {
  const pad = '  '.repeat(indent);

  if (isScalar(node)) {
    return scalarToString(node);
  }

  if (isAlias(node)) {
    return `*${node.source}`;
  }

  if (isSeq(node)) {
    if (node.items.length === 0) return '[]';
    const lines: string[] = [];
    for (const item of node.items) {
      if (isMap(item) || isSeq(item)) {
        lines.push(`${pad}- ${nodeToString(item, indent + 1).trimStart()}`);
      } else {
        lines.push(`${pad}- ${nodeToString(item, indent + 1)}`);
      }
    }
    return lines.join('\n');
  }

  if (isMap(node)) {
    if (node.items.length === 0) return '{}';
    const lines: string[] = [];
    for (const pair of node.items) {
      const keyStr = pair.key ? nodeToString(pair.key, 0) : 'null';
      if (pair.value === null) {
        lines.push(`${pad}${keyStr}:`);
      } else if (isMap(pair.value) || isSeq(pair.value)) {
        const valStr = nodeToString(pair.value, indent + 1);
        if (valStr.includes('\n')) {
          lines.push(`${pad}${keyStr}:\n${valStr}`);
        } else {
          lines.push(`${pad}${keyStr}: ${valStr}`);
        }
      } else {
        lines.push(`${pad}${keyStr}: ${nodeToString(pair.value, 0)}`);
      }
    }
    return lines.join('\n');
  }

  return 'null';
}

function scalarToString(node: Scalar): string {
  const v = node.value;
  if (v === null) return 'null';
  if (v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (v === Infinity) return '.inf';
    if (v === -Infinity) return '-.inf';
    if (Number.isNaN(v)) return '.nan';
    return String(v);
  }
  const s = String(v);
  // Check if the string needs quoting
  if (s === '' || s === 'null' || s === 'true' || s === 'false' ||
      s === '~' || /^[0-9]/.test(s) || s.includes(':') || s.includes('#') ||
      s.includes('\n') || s.includes('{') || s.includes('}') ||
      s.includes('[') || s.includes(']') || s.includes(',') ||
      s.includes('&') || s.includes('*') || s.includes('!') ||
      s.includes('|') || s.includes('>') || s.includes("'") ||
      s.includes('"') || s.includes('%') || s.includes('@') ||
      s.includes('`') || /^\s|\s$/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}
