/**
 * Composer — takes CST tokens and produces Document objects.
 *
 * Uses the original source string (stamped on document tokens by the CST
 * parser as `_source`) to feed the AST parser per-document slices. This
 * avoids the lossy stringify→reparse round-trip.
 */

import { Parser as ASTParser } from './parser.ts';
import { Document } from './document.ts';
import type { Token } from './cst.ts';
import type { Node } from './nodes.ts';
import type { ParseOptions, CustomTag } from './options.ts';

export interface ComposerOptions {
  strict?: boolean;
  version?: '1.1' | '1.2';
  customTags?: CustomTag[];
  uniqueKeys?: boolean;
  merge?: boolean;
  keepSourceTokens?: boolean;
}

export class Composer {
  private options: ComposerOptions;

  constructor(options?: ComposerOptions) {
    this.options = options ?? {};
  }

  *compose(tokens: Iterable<Token>, forceDoc = false, endOffset?: number): Generator<Document> {
    const allTokens: Token[] = [];
    for (const t of tokens) allTokens.push(t);

    if (allTokens.length === 0 && !forceDoc) return;

    const opts: ParseOptions = {
      strict: this.options.strict ?? true,
      version: this.options.version ?? '1.2',
      uniqueKeys: this.options.uniqueKeys ?? true,
      merge: this.options.merge ?? false,
      customTags: this.options.customTags ?? [],
    };

    // Separate document tokens from pre-document tokens
    const docTokens: Token[] = [];
    const preDocTokens: Token[] = [];
    for (const t of allTokens) {
      if (t.type === 'document') {
        docTokens.push(t);
      } else {
        preDocTokens.push(t);
      }
    }

    // If no document tokens, either force an empty doc or return
    if (docTokens.length === 0) {
      if (forceDoc) {
        // Pre-doc tokens (directives, comments) form the source for a synthetic doc
        const src = this.tokensToSource(preDocTokens);
        if (src.length > 0) {
          const parser = new ASTParser(src, opts);
          const parsedDocs = parser.parseAllDocuments();
          if (parsedDocs.length > 0) {
            for (const parsed of parsedDocs) {
              const doc = new Document(parsed.contents, opts);
              doc.errors = parsed.errors;
              doc.warnings = parsed.warnings;
              doc.directives = parsed.directives;
              doc.commentBefore = parsed.commentBefore;
              doc.comment = parsed.comment;
              doc.range = parsed.range;
              yield doc;
            }
          } else {
            const doc = new Document(null, opts);
            if (endOffset != null) doc.range = [0, endOffset, endOffset];
            yield doc;
          }
        } else {
          const doc = new Document(null, opts);
          if (endOffset != null) doc.range = [0, endOffset, endOffset];
          yield doc;
        }
      }
      return;
    }

    // Build a CST token index for srcToken attachment
    const tokenIndex = this.options.keepSourceTokens
      ? this.buildTokenIndex(allTokens)
      : null;

    // Process each document token using its original source
    for (let i = 0; i < docTokens.length; i++) {
      const dt = docTokens[i] as Token & { type: 'document'; _source?: string };
      const source = dt._source;

      // Compute the document's range in the original source
      const docStart = this.docTokenStart(dt);
      const docEnd = this.docTokenEnd(dt, source?.length ?? endOffset ?? 0, i === docTokens.length - 1);

      if (source) {
        const docSource = source.slice(docStart, docEnd);
        const parser = new ASTParser(docSource, opts);
        const parsed = parser.parseDocument();

        const doc = new Document(parsed.contents, opts);
        doc.errors = parsed.errors;
        doc.warnings = parsed.warnings;
        doc.directives = parsed.directives;
        doc.commentBefore = parsed.commentBefore;
        doc.comment = parsed.comment;
        doc.range = parsed.range;

        if (tokenIndex) {
          this.attachSrcTokens(doc.contents, tokenIndex);
        }

        yield doc;
      } else {
        // Fallback: no source available, produce empty doc
        const doc = new Document(null, opts);
        if (endOffset != null) doc.range = [0, endOffset, endOffset];
        yield doc;
      }
    }
  }

  /** Compute the start offset of a document token in the original source. */
  private docTokenStart(dt: any): number {
    if (dt.start && dt.start.length > 0) {
      return dt.start[0].offset;
    }
    return dt.offset;
  }

  /** Compute the end offset of a document token in the original source. */
  private docTokenEnd(dt: any, sourceLen: number, isLast: boolean): number {
    if (dt.end && dt.end.length > 0) {
      const lastEnd = dt.end[dt.end.length - 1];
      return lastEnd.offset + (lastEnd.source?.length ?? 0);
    }
    if (dt.value) {
      return this.tokenEnd(dt.value);
    }
    return isLast ? sourceLen : dt.offset;
  }

  /** Compute the end offset of a token. */
  private tokenEnd(token: any): number {
    if (!token) return 0;
    if (token.type === 'block-map' || token.type === 'block-seq') {
      const items = token.items;
      if (items.length === 0) return token.offset;
      const lastItem = items[items.length - 1];
      let end = token.offset;
      if (lastItem.value) end = Math.max(end, this.tokenEnd(lastItem.value));
      else if (lastItem.sep && lastItem.sep.length > 0) {
        const ls = lastItem.sep[lastItem.sep.length - 1];
        end = Math.max(end, ls.offset + (ls.source?.length ?? 0));
      } else if (lastItem.key) end = Math.max(end, this.tokenEnd(lastItem.key));
      // Check end tokens on the scalar
      if (lastItem.value && lastItem.value.end) {
        for (const et of lastItem.value.end) {
          end = Math.max(end, et.offset + (et.source?.length ?? 0));
        }
      }
      return end;
    }
    if (token.type === 'flow-collection') {
      if (token.end && token.end.length > 0) {
        const last = token.end[token.end.length - 1];
        return last.offset + (last.source?.length ?? 0);
      }
      return token.offset + (token.source?.length ?? 0);
    }
    if (token.type === 'block-scalar') {
      return token.offset + (token.props?.[0]?.source?.length ?? 0) + (token.source?.length ?? 0);
    }
    // Scalar types
    let end = token.offset + (token.source?.length ?? 0);
    if (token.end) {
      for (const et of token.end) {
        end = Math.max(end, et.offset + (et.source?.length ?? 0));
      }
    }
    return end;
  }

  /** Fallback: reconstruct source from non-document tokens (for pre-doc-only streams). */
  private tokensToSource(tokens: Token[]): string {
    let out = '';
    for (const t of tokens) {
      if ('source' in t) out += (t as any).source;
    }
    return out;
  }

  private buildTokenIndex(tokens: Token[]): Map<number, Token> {
    const map = new Map<number, Token>();
    this.indexTokens(tokens, map);
    return map;
  }

  private indexTokens(tokens: Token[], map: Map<number, Token>): void {
    for (const t of tokens) {
      if (t.type === 'document') {
        if (t.value) {
          map.set(t.value.offset, t.value);
          this.indexChildren(t.value, map);
        }
        for (const st of t.start) map.set(st.offset, st);
        if (t.end) for (const st of t.end) map.set(st.offset, st);
      } else if ('offset' in t) {
        map.set(t.offset, t);
      }
    }
  }

  private indexChildren(token: Token, map: Map<number, Token>): void {
    // Index children first, then overwrite with collection token at same offset
    // This ensures collection tokens take precedence over their first child
    switch (token.type) {
      case 'block-map':
        for (const item of token.items) {
          for (const st of item.start) if (!map.has(st.offset)) map.set(st.offset, st);
          if (item.key) { if (!map.has(item.key.offset)) map.set(item.key.offset, item.key); this.indexChildren(item.key, map); }
          if (item.sep) for (const st of item.sep) if (!map.has(st.offset)) map.set(st.offset, st);
          if (item.value) { if (!map.has(item.value.offset)) map.set(item.value.offset, item.value); this.indexChildren(item.value, map); }
        }
        map.set(token.offset, token); // Collection wins at same offset
        break;
      case 'block-seq':
        for (const item of token.items) {
          for (const st of item.start) if (!map.has(st.offset)) map.set(st.offset, st);
          if (item.value) { if (!map.has(item.value.offset)) map.set(item.value.offset, item.value); this.indexChildren(item.value, map); }
        }
        map.set(token.offset, token);
        break;
      case 'flow-collection':
        for (const item of token.items) {
          for (const st of item.start) if (!map.has(st.offset)) map.set(st.offset, st);
          if (item.key) { if (!map.has(item.key.offset)) map.set(item.key.offset, item.key); this.indexChildren(item.key, map); }
          if (item.sep) for (const st of item.sep) if (!map.has(st.offset)) map.set(st.offset, st);
          if (item.value) { if (!map.has(item.value.offset)) map.set(item.value.offset, item.value); this.indexChildren(item.value, map); }
        }
        for (const st of token.end) if (!map.has(st.offset)) map.set(st.offset, st);
        map.set(token.offset, token);
        if (!map.has(token.start.offset)) map.set(token.start.offset, token.start);
        break;
      case 'block-scalar':
        map.set(token.offset, token);
        break;
      default:
        if ('offset' in token) if (!map.has(token.offset)) map.set(token.offset, token);
        break;
    }
  }

  private attachSrcTokens(node: Node | null, map: Map<number, Token>): void {
    if (!node) return;

    if (node.range) {
      const cst = map.get(node.range[0]);
      if (cst) (node as any).srcToken = cst;
    }

    if (node.type === 'MAP' || node.type === 'SEQ') {
      const items = (node as any).items;
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item.type === 'PAIR') {
            if (item.key) this.attachSrcTokens(item.key, map);
            if (item.value) this.attachSrcTokens(item.value, map);
          } else {
            this.attachSrcTokens(item, map);
          }
        }
      }
    }
  }

  streamInfo(): { comment: string; directives: any; errors: any[]; warnings: any[] } {
    return { comment: '', directives: {}, errors: [], warnings: [] };
  }

  *next(token: Token): Generator<Document> {
    yield* this.compose([token]);
  }

  *end(_forceDoc?: boolean, _endOffset?: number): Generator<Document> {}
}
