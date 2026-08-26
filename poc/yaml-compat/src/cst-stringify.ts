/**
 * CST.stringify — reconstruct source text from a CST token or collection item.
 * Concatenates sources in logical order with no validation.
 */

import type { Token, CollectionItem, SourceToken } from './cst.ts';

function stringifySourceToken(token: SourceToken): string {
  return token.source;
}

function stringifyCollectionItem(item: CollectionItem): string {
  let out = '';
  if (item.start) {
    for (const st of item.start) out += st.source;
  }
  if (item.key !== undefined) {
    if (item.key != null) out += stringifyToken(item.key);
  }
  if (item.sep) {
    for (const st of item.sep) out += st.source;
  }
  if (item.value !== undefined) {
    if (item.value != null) out += stringifyToken(item.value);
  }
  return out;
}

function stringifyToken(token: Token): string {
  switch (token.type) {
    case 'document': {
      let out = '';
      for (const st of token.start) out += st.source;
      if (token.value) out += stringifyToken(token.value);
      if (token.end) {
        for (const st of token.end) out += st.source;
      }
      return out;
    }
    case 'doc-end': {
      let out = token.source;
      if (token.end) {
        for (const st of token.end) out += st.source;
      }
      return out;
    }
    case 'block-map':
    case 'block-seq': {
      let out = '';
      for (const item of token.items) {
        out += stringifyCollectionItem(item as CollectionItem);
      }
      return out;
    }
    case 'flow-collection': {
      let out = token.start.source;
      for (const item of token.items) {
        out += stringifyCollectionItem(item);
      }
      for (const st of token.end) out += st.source;
      return out;
    }
    case 'block-scalar': {
      let out = '';
      for (const p of token.props) out += stringifySourceToken(p as SourceToken);
      out += token.source;
      return out;
    }
    case 'scalar':
    case 'single-quoted-scalar':
    case 'double-quoted-scalar':
    case 'alias': {
      let out = token.source;
      if ('end' in token && token.end) {
        for (const st of token.end) out += st.source;
      }
      return out;
    }
    default:
      // SourceToken, ErrorToken, Directive
      return token.source;
  }
}

/**
 * Stringify a CST document, token, or collection item.
 * Fair warning: This applies no validation whatsoever, and
 * simply concatenates the sources in their logical order.
 */
export function stringify(cst: Token | CollectionItem): string {
  // CollectionItem has start+key+sep+value shape but no .type
  if (!('type' in cst)) {
    return stringifyCollectionItem(cst as CollectionItem);
  }
  return stringifyToken(cst as Token);
}
