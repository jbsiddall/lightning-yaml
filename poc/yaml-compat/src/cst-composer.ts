/**
 * Composer — takes CST tokens and produces Document objects.
 *
 * Reconstructs source from tokens, parses with the existing fast-path
 * parser (which handles all YAML correctly), then attaches srcToken
 * references by offset matching.
 */

import { Parser as ASTParser } from './parser.ts';
import { Document } from './document.ts';
import { stringify } from './cst-stringify.ts';
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

    // Reconstruct full source from all tokens
    const fullSource = allTokens.map(t => stringify(t)).join('');

    if (fullSource.length === 0 && allTokens.length === 0 && !forceDoc) return;

    const opts: ParseOptions = {
      strict: this.options.strict ?? true,
      version: this.options.version ?? '1.2',
      uniqueKeys: this.options.uniqueKeys ?? true,
      merge: this.options.merge ?? false,
      customTags: this.options.customTags ?? [],
    };

    // Use the AST parser to get all documents
    const parser = new ASTParser(fullSource, opts);
    const parsedDocs = parser.parseAllDocuments();

    if (parsedDocs.length === 0 && forceDoc) {
      const doc = new Document(null, opts);
      if (endOffset != null) doc.range = [0, endOffset, endOffset];
      yield doc;
      return;
    }

    // Build a CST token index for srcToken attachment
    const tokenIndex = this.options.keepSourceTokens
      ? this.buildTokenIndex(allTokens)
      : null;

    for (const parsed of parsedDocs) {
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
    }
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
