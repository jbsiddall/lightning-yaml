/**
 * CST-emitting YAML parser — produces tokens structurally compatible
 * with the `yaml` npm package (eemeli/yaml v2) CST parser.
 *
 * Generator-based: parse() yields tokens lazily.
 * Line-by-line scanning for block structures, recursive descent for flows.
 */

import type {
  Token, SourceToken, FlowScalar, BlockScalar, BlockMap, BlockSequence,
  FlowCollection, Document, DocumentEnd, Directive, CollectionItem,
} from './cst.ts';

// Character codes
const CH_SPACE = 0x20;
const CH_TAB = 0x09;
const CH_NL = 0x0A;
const CH_CR = 0x0D;
const CH_HASH = 0x23;
const CH_DASH = 0x2D;
const CH_DOT = 0x2E;
const CH_COLON = 0x3A;
const CH_QMARK = 0x3F;
const CH_AMP = 0x26;
const CH_STAR = 0x2A;
const CH_BANG = 0x21;
const CH_PIPE = 0x7C;
const CH_GT = 0x3E;
const CH_SQUOTE = 0x27;
const CH_DQUOTE = 0x22;
const CH_LBRACKET = 0x5B;
const CH_RBRACKET = 0x5D;
const CH_LBRACE = 0x7B;
const CH_RBRACE = 0x7D;
const CH_COMMA = 0x2C;
const CH_PERCENT = 0x25;
const CH_BOM_HI = 0xFEFF; // first char of UTF-8 BOM when decoded

export class CSTParser {
  private src = '';
  private len = 0;
  private pos = 0;
  private onNewLine?: (offset: number) => void;

  constructor(onNewLine?: (offset: number) => void) {
    this.onNewLine = onNewLine;
  }

  *parse(source: string, incomplete?: boolean): Generator<Token, void> {
    this.src = source;
    this.len = source.length;
    this.pos = 0;

    if (this.len === 0) return;

    // BOM check
    if (this.src.charCodeAt(0) === CH_BOM_HI || this.src[0] === '﻿') {
      yield {
        type: 'byte-order-mark',
        offset: 0,
        indent: 0,
        source: '﻿',
      } as SourceToken;
      this.pos = 1;
    }

    this.onNewLine?.(this.pos);

    // Yield pre-document tokens (directives, comments, blank lines before first ---)
    // Then yield document tokens
    yield* this.parseStream(incomplete ?? false);
  }

  private *parseStream(incomplete: boolean): Generator<Token, void> {
    while (this.pos < this.len) {
      // Collect pre-document source tokens: directives, comments, newlines, spaces
      const preTokens = this.collectPreDocTokens();
      if (preTokens.length > 0 && !this.hasDocStart(preTokens)) {
        // Check if there's actual content following (not just EOF or more pre-doc)
        if (this.pos >= this.len) {
          // Yield remaining tokens individually
          yield* preTokens;
          return;
        }
        // Check if next thing is a doc marker or content
        if (this.atDocStart() || this.atDocEnd()) {
          yield* preTokens;
          continue;
        }
        // Check if this is directive territory
        if (this.src.charCodeAt(this.pos) === CH_PERCENT) {
          yield* preTokens;
          continue;
        }
        // It's content — wrap in a document
        yield* this.parseDocumentWithStart(preTokens, incomplete);
        continue;
      }

      if (this.pos >= this.len) {
        yield* preTokens;
        return;
      }

      // We're at document content or --- marker
      yield* this.parseDocumentWithStart(preTokens, incomplete);
    }
  }

  private collectPreDocTokens(): SourceToken[] {
    const tokens: SourceToken[] = [];
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);

      // Directive line
      if (c === CH_PERCENT) {
        tokens.push(this.readDirectiveLine());
        continue;
      }

      // Comment line (with leading spaces)
      if (c === CH_HASH || (c === CH_SPACE && this.isCommentLine())) {
        // Leading spaces
        if (c === CH_SPACE) {
          tokens.push(this.readSpaces());
        }
        if (this.pos < this.len && this.src.charCodeAt(this.pos) === CH_HASH) {
          tokens.push(this.readComment());
        }
        continue;
      }

      // Newline
      if (c === CH_NL || c === CH_CR) {
        tokens.push(this.readNewline());
        continue;
      }

      // Spaces (before nothing or before content)
      if (c === CH_SPACE || c === CH_TAB) {
        const sp = this.readSpaces();
        // If followed by newline or comment, keep collecting
        if (this.pos < this.len) {
          const next = this.src.charCodeAt(this.pos);
          if (next === CH_NL || next === CH_CR || next === CH_HASH) {
            tokens.push(sp);
            continue;
          }
        }
        // If at end, push and break
        if (this.pos >= this.len) {
          tokens.push(sp);
          break;
        }
        // Otherwise this space precedes content — put it back conceptually
        // by rewinding and letting doc parser handle it
        this.pos -= sp.source.length;
        break;
      }

      // Doc start/end markers are NOT pre-doc tokens (they belong to the document)
      break;
    }
    return tokens;
  }

  private hasDocStart(tokens: SourceToken[]): boolean {
    return tokens.some(t => t.type === 'doc-start');
  }

  private atDocStart(): boolean {
    return this.pos + 2 < this.len &&
      this.src.charCodeAt(this.pos) === CH_DASH &&
      this.src.charCodeAt(this.pos + 1) === CH_DASH &&
      this.src.charCodeAt(this.pos + 2) === CH_DASH &&
      (this.pos + 3 >= this.len || this.isWsOrNl(this.src.charCodeAt(this.pos + 3)));
  }

  private atDocEnd(): boolean {
    return this.pos + 2 < this.len &&
      this.src.charCodeAt(this.pos) === CH_DOT &&
      this.src.charCodeAt(this.pos + 1) === CH_DOT &&
      this.src.charCodeAt(this.pos + 2) === CH_DOT &&
      (this.pos + 3 >= this.len || this.isWsOrNl(this.src.charCodeAt(this.pos + 3)));
  }

  private isCommentLine(): boolean {
    let p = this.pos;
    while (p < this.len && this.src.charCodeAt(p) === CH_SPACE) p++;
    return p < this.len && this.src.charCodeAt(p) === CH_HASH;
  }

  private *parseDocumentWithStart(startTokens: SourceToken[], incomplete: boolean): Generator<Token, void> {
    const doc: Document = {
      type: 'document',
      offset: this.pos,
      start: [],
      value: undefined,
      end: undefined,
    };

    // Separate start tokens: directives/comments/newlines go to doc.start
    // The --- marker and anything after goes to doc.start too
    let hasContent = false;
    let sawDocStart = false;

    // Add pre-collected tokens to doc.start
    for (const t of startTokens) {
      if (t.type === 'directive-line') {
        doc.start.push(t);
      } else {
        doc.start.push(t);
      }
    }

    // Check for ---
    if (this.atDocStart()) {
      sawDocStart = true;
      const markerOffset = this.pos;
      this.pos += 3;
      const docStartToken: SourceToken = {
        type: 'doc-start',
        offset: markerOffset,
        indent: 0,
        source: '---',
      };
      doc.start.push(docStartToken);

      // Collect any inline content after --- (spaces, comment, newline)
      this.collectDocStartTrailing(doc.start);
    }

    // Determine document content offset
    // Skip leading newlines/spaces/comments that belong to doc.start
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (c === CH_NL || c === CH_CR) {
        doc.start.push(this.readNewline());
      } else if (c === CH_SPACE || c === CH_TAB) {
        const sp = this.readSpaces();
        if (this.pos < this.len && this.src.charCodeAt(this.pos) === CH_HASH) {
          doc.start.push(sp);
          doc.start.push(this.readComment());
        } else if (this.pos < this.len && (this.src.charCodeAt(this.pos) === CH_NL || this.src.charCodeAt(this.pos) === CH_CR)) {
          doc.start.push(sp);
        } else {
          // This space is part of content indent — rewind
          this.pos -= sp.source.length;
          break;
        }
      } else if (c === CH_HASH) {
        doc.start.push(this.readComment());
      } else {
        break;
      }
    }

    doc.offset = this.pos;

    // Check for doc-end marker immediately
    if (this.atDocEnd()) {
      // Empty document
      doc.end = doc.end || [];
      const endMarkerOffset = this.pos;
      this.pos += 3;
      doc.end.push({
        type: 'doc-end',
        offset: endMarkerOffset,
        indent: 0,
        source: '...',
      } as any);
      this.collectDocEndTrailing(doc.end);
      yield doc;
      return;
    }

    // Parse document value (block content)
    if (this.pos < this.len && !this.atDocStart()) {
      const value = this.parseBlockValue(0);
      if (value) {
        doc.value = value;
      }
    }

    // Parse end tokens
    const endTokens: SourceToken[] = [];
    this.collectDocEndTokens(endTokens, incomplete);

    if (endTokens.length > 0) {
      doc.end = endTokens;
    }

    yield doc;
  }

  private collectDocStartTrailing(start: SourceToken[]): void {
    // Read spaces after ---
    if (this.pos < this.len && (this.src.charCodeAt(this.pos) === CH_SPACE || this.src.charCodeAt(this.pos) === CH_TAB)) {
      start.push(this.readSpaces());
    }
    // Read inline comment after ---
    if (this.pos < this.len && this.src.charCodeAt(this.pos) === CH_HASH) {
      start.push(this.readComment());
    }
    // Read newline after ---
    if (this.pos < this.len && (this.src.charCodeAt(this.pos) === CH_NL || this.src.charCodeAt(this.pos) === CH_CR)) {
      start.push(this.readNewline());
    }
  }

  private collectDocEndTrailing(end: (SourceToken | DocumentEnd)[]): void {
    // Read spaces, comment, newline after ...
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (c === CH_SPACE || c === CH_TAB) {
        end.push(this.readSpaces());
      } else if (c === CH_HASH) {
        end.push(this.readComment());
      } else if (c === CH_NL || c === CH_CR) {
        end.push(this.readNewline());
      } else {
        break;
      }
    }
  }

  private collectDocEndTokens(end: (SourceToken | DocumentEnd)[], incomplete: boolean): void {
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);

      if (c === CH_NL || c === CH_CR) {
        end.push(this.readNewline());
        continue;
      }
      if (c === CH_SPACE || c === CH_TAB) {
        const sp = this.readSpaces();
        if (this.pos < this.len && this.src.charCodeAt(this.pos) === CH_HASH) {
          end.push(sp);
          end.push(this.readComment());
          continue;
        }
        if (this.pos >= this.len || this.src.charCodeAt(this.pos) === CH_NL || this.src.charCodeAt(this.pos) === CH_CR) {
          end.push(sp);
          continue;
        }
        // Rewind — this is content for next doc
        this.pos -= sp.source.length;
        break;
      }
      if (c === CH_HASH) {
        end.push(this.readComment());
        continue;
      }
      if (this.atDocEnd()) {
        const endOffset = this.pos;
        this.pos += 3;
        end.push({
          type: 'doc-end',
          offset: endOffset,
          indent: 0,
          source: '...',
        } as any);
        this.collectDocEndTrailing(end);
        continue;
      }
      break;
    }
  }

  // ---- Block value parsing --------------------------------------------------

  private parseBlockValue(minIndent: number): Token | undefined {
    if (this.pos >= this.len) return undefined;

    const c = this.src.charCodeAt(this.pos);

    // Flow collection
    if (c === CH_LBRACKET) return this.parseFlowSequence(this.pos);
    if (c === CH_LBRACE) return this.parseFlowMapping(this.pos);

    // Block scalar
    if (c === CH_PIPE || c === CH_GT) return this.parseBlockScalar(this.pos);

    // Quoted scalars
    if (c === CH_SQUOTE) return this.parseSingleQuotedScalar(this.pos);
    if (c === CH_DQUOTE) return this.parseDoubleQuotedScalar(this.pos);

    // Alias
    if (c === CH_STAR) return this.parseAliasToken(this.pos);

    // Block sequence item
    if (c === CH_DASH && (this.pos + 1 >= this.len || this.isWsOrNl(this.src.charCodeAt(this.pos + 1)))) {
      return this.parseBlockSeq(this.columnOf(this.pos));
    }

    // Explicit key
    if (c === CH_QMARK && (this.pos + 1 >= this.len || this.isWsOrNl(this.src.charCodeAt(this.pos + 1)))) {
      return this.parseBlockMap(this.columnOf(this.pos));
    }

    // Check if this is a mapping (look ahead for :)
    if (this.isMappingLine()) {
      return this.parseBlockMap(this.columnOf(this.pos));
    }

    // Plain scalar
    return this.parsePlainScalarToken(this.pos, minIndent, false);
  }

  // ---- Block sequence -------------------------------------------------------

  private parseBlockSeq(indent: number): BlockSequence {
    const seq: BlockSequence = {
      type: 'block-seq',
      offset: this.pos,
      indent,
      items: [],
    };

    while (this.pos < this.len) {
      // Consume leading spaces to reach the indent column
      let leadingSpace: SourceToken | null = null;
      if (this.pos < this.len && (this.src.charCodeAt(this.pos) === CH_SPACE || this.src.charCodeAt(this.pos) === CH_TAB)) {
        leadingSpace = this.readSpaces();
      }

      const col = this.columnOf(this.pos);
      if (col < indent) break;
      if (col > indent) break;

      const c = this.src.charCodeAt(this.pos);
      if (c !== CH_DASH) break;
      if (this.pos + 1 < this.len && !this.isWsOrNl(this.src.charCodeAt(this.pos + 1))) break;

      // Check for doc markers
      if (this.atDocStart() || this.atDocEnd()) break;

      const item: CollectionItem = { start: [] };
      if (leadingSpace) item.start.push(leadingSpace);

      // seq-item-ind
      const dashOffset = this.pos;
      this.pos++; // skip -
      item.start.push({
        type: 'seq-item-ind',
        offset: dashOffset,
        indent: col,
        source: '-',
      });

      // Space after -
      if (this.pos < this.len && (this.src.charCodeAt(this.pos) === CH_SPACE || this.src.charCodeAt(this.pos) === CH_TAB)) {
        item.start.push(this.readSpaces());
      }

      // Parse value
      if (this.pos < this.len) {
        const vc = this.src.charCodeAt(this.pos);
        if (vc !== CH_NL && vc !== CH_CR && vc !== CH_HASH) {
          // Check for nested content
          const valCol = this.columnOf(this.pos);
          if (valCol > indent || (vc === CH_DASH && this.pos + 1 < this.len && this.isWsOrNl(this.src.charCodeAt(this.pos + 1))) ||
              vc === CH_LBRACKET || vc === CH_LBRACE || vc === CH_PIPE || vc === CH_GT ||
              vc === CH_SQUOTE || vc === CH_DQUOTE || vc === CH_STAR ||
              (vc === CH_QMARK && this.pos + 1 < this.len && this.isWsOrNl(this.src.charCodeAt(this.pos + 1)))) {
            item.value = this.parseBlockValue(indent + 1);
          } else if (this.isMappingLine()) {
            item.value = this.parseBlockMap(valCol);
          } else {
            item.value = this.parsePlainScalarToken(this.pos, indent + 1, false);
          }
        } else if (vc === CH_NL || vc === CH_CR) {
          // Value on next line
          const nl = this.readNewline();
          // Look at next line's indent
          if (this.pos < this.len) {
            const nextCol = this.columnOf(this.pos);
            if (nextCol > indent && !this.atDocStart() && !this.atDocEnd()) {
              // Skip blank lines/comments before value
              const startTokens: SourceToken[] = [nl];
              this.skipBlockStartTokens(startTokens);
              if (startTokens.length > 1) {
                // We have leading comments/blanks
                if (!item.value) {
                  item.value = this.parseBlockValue(indent + 1);
                  if (item.value) {
                    // Prepend the start tokens
                    this.prependStartTokens(item.value, startTokens);
                  }
                }
              } else {
                item.value = this.parseBlockValue(indent + 1);
                if (item.value) {
                  this.prependStartTokens(item.value, [nl]);
                }
              }
            }
          }
        }
      }

      seq.items.push(item as any);
    }

    return seq;
  }

  // ---- Block map ------------------------------------------------------------

  private parseBlockMap(indent: number): BlockMap {
    const map: BlockMap = {
      type: 'block-map',
      offset: this.pos,
      indent,
      items: [],
    };

    while (this.pos < this.len) {
      // Consume leading spaces to reach the indent column
      let leadingSpace: SourceToken | null = null;
      if (this.pos < this.len && (this.src.charCodeAt(this.pos) === CH_SPACE || this.src.charCodeAt(this.pos) === CH_TAB)) {
        leadingSpace = this.readSpaces();
      }

      const col = this.columnOf(this.pos);
      if (col < indent) break;
      if (col > indent) break;

      // Check for doc markers
      if (this.atDocStart() || this.atDocEnd()) break;

      const c = this.src.charCodeAt(this.pos);

      // Comment line at block-map indent — end the map (comment belongs to parent)
      if (c === CH_HASH) break;

      const item: { start: SourceToken[]; explicitKey?: true; key?: Token | null; sep?: SourceToken[]; value?: Token } = { start: [] };
      if (leadingSpace) item.start.push(leadingSpace);

      // Explicit key (?)
      if (c === CH_QMARK && (this.pos + 1 >= this.len || this.isWsOrNl(this.src.charCodeAt(this.pos + 1)))) {
        item.explicitKey = true;
        const qOffset = this.pos;
        this.pos++; // skip ?
        item.start.push({
          type: 'explicit-key-ind',
          offset: qOffset,
          indent: col,
          source: '?',
        });
        if (this.pos < this.len && (this.src.charCodeAt(this.pos) === CH_SPACE || this.src.charCodeAt(this.pos) === CH_TAB)) {
          item.start.push(this.readSpaces());
        }

        // Key value
        if (this.pos < this.len && this.src.charCodeAt(this.pos) !== CH_NL && this.src.charCodeAt(this.pos) !== CH_CR) {
          item.key = this.parseBlockValue(indent + 1);
        }

        // Look for : on next line(s)
        this.skipMapSep(item, indent);
        map.items.push(item as any);
        continue;
      }

      // Regular key (scalar or flow)
      const keyStart = this.pos;
      item.key = this.parseMapKey(indent);
      if (!item.key) {
        // Not a mapping — break out
        break;
      }

      // Separator (: and following space)
      this.readMapSep(item as CollectionItem);

      // Value
      if (this.pos < this.len) {
        const vc = this.src.charCodeAt(this.pos);
        if (vc !== CH_NL && vc !== CH_CR && vc !== CH_HASH) {
          const valCol = this.columnOf(this.pos);
          if (valCol > indent) {
            item.value = this.parseBlockValue(indent + 1);
          } else {
            // Value on same line at same indent — shouldn't happen in valid YAML
            item.value = this.parsePlainScalarToken(this.pos, indent + 1, false);
          }
        } else if (vc === CH_NL || vc === CH_CR) {
          // Value might be on next line — consume newline and check
          const nlToken = this.readNewline();
          // Skip blank lines and comments
          const leadingTokens: SourceToken[] = [nlToken];
          while (this.pos < this.len) {
            const nc = this.src.charCodeAt(this.pos);
            if (nc === CH_NL || nc === CH_CR) {
              leadingTokens.push(this.readNewline());
            } else if (nc === CH_SPACE || nc === CH_TAB) {
              const sp = this.readSpaces();
              if (this.pos < this.len && this.src.charCodeAt(this.pos) === CH_HASH) {
                leadingTokens.push(sp);
                leadingTokens.push(this.readComment());
                if (this.pos < this.len && (this.src.charCodeAt(this.pos) === CH_NL || this.src.charCodeAt(this.pos) === CH_CR)) {
                  leadingTokens.push(this.readNewline());
                }
              } else if (this.pos >= this.len || this.src.charCodeAt(this.pos) === CH_NL || this.src.charCodeAt(this.pos) === CH_CR) {
                leadingTokens.push(sp);
              } else {
                // Content found — spaces are leading indent, add to tokens
                leadingTokens.push(sp);
                break;
              }
            } else if (nc === CH_HASH) {
              leadingTokens.push(this.readComment());
              if (this.pos < this.len && (this.src.charCodeAt(this.pos) === CH_NL || this.src.charCodeAt(this.pos) === CH_CR)) {
                leadingTokens.push(this.readNewline());
              }
            } else {
              break;
            }
          }
          // Check if next content is more indented
          if (this.pos < this.len && !this.atDocStart() && !this.atDocEnd()) {
            const nextCol = this.columnOf(this.pos);
            if (nextCol > indent) {
              // Add leading tokens (newline, spaces) to sep for round-trip
              if (item.sep) {
                item.sep.push(...leadingTokens);
              }
              item.value = this.parseBlockValue(indent + 1);
            }
          }
        }
      }

      map.items.push(item as any);
    }

    return map;
  }

  private parseMapKey(indent: number): Token | undefined {
    const c = this.src.charCodeAt(this.pos);
    if (c === CH_LBRACKET) return this.parseFlowSequence(this.pos);
    if (c === CH_LBRACE) return this.parseFlowMapping(this.pos);
    if (c === CH_SQUOTE) return this.parseSingleQuotedScalar(this.pos);
    if (c === CH_DQUOTE) return this.parseDoubleQuotedScalar(this.pos);
    if (c === CH_STAR) return this.parseAliasToken(this.pos);
    if (c === CH_PIPE || c === CH_GT) return this.parseBlockScalar(this.pos);

    // Anchor or tag before key
    if (c === CH_AMP || c === CH_BANG) {
      // For CST, anchors/tags on keys become part of the key scalar's source
      // Actually in eemeli CST, they're separate start tokens on the item
      // But for simplicity, we include them in the plain scalar source
      return this.parsePlainScalarToken(this.pos, indent, false);
    }

    return this.parsePlainScalarToken(this.pos, indent, false);
  }

  private readMapSep(item: CollectionItem): void {
    if (this.pos >= this.len) return;
    if (this.src.charCodeAt(this.pos) !== CH_COLON) return;

    item.sep = item.sep || [];
    const colonOffset = this.pos;
    this.pos++; // skip :
    item.sep.push({
      type: 'map-value-ind',
      offset: colonOffset,
      indent: 0,
      source: ':',
    });

    // Space after :
    if (this.pos < this.len && (this.src.charCodeAt(this.pos) === CH_SPACE || this.src.charCodeAt(this.pos) === CH_TAB)) {
      item.sep.push(this.readSpaces());
    }
  }

  private skipMapSep(item: CollectionItem, indent: number): void {
    // For explicit keys, find the : separator which may be on a later line
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (c === CH_NL || c === CH_CR) {
        // Skip newline
        if (!item.sep) item.sep = [];
        item.sep.push(this.readNewline());
        continue;
      }
      if (c === CH_SPACE || c === CH_TAB) {
        if (!item.sep) item.sep = [];
        item.sep.push(this.readSpaces());
        continue;
      }
      if (c === CH_COLON) {
        if (!item.sep) item.sep = [];
        const colonOffset = this.pos;
        this.pos++;
        item.sep.push({
          type: 'map-value-ind',
          offset: colonOffset,
          indent: 0,
          source: ':',
        });
        if (this.pos < this.len && (this.src.charCodeAt(this.pos) === CH_SPACE || this.src.charCodeAt(this.pos) === CH_TAB)) {
          item.sep.push(this.readSpaces());
        }
        // Value after :
        if (this.pos < this.len && this.src.charCodeAt(this.pos) !== CH_NL && this.src.charCodeAt(this.pos) !== CH_CR) {
          item.value = this.parseBlockValue(indent + 1);
        }
        return;
      }
      break;
    }
  }

  // ---- Flow collections -----------------------------------------------------

  private parseFlowSequence(offset: number): FlowCollection {
    this.pos++; // skip [
    const fc: FlowCollection = {
      type: 'flow-collection',
      offset,
      indent: this.columnOf(offset),
      start: { type: 'flow-seq-start', offset, indent: 0, source: '[' },
      items: [],
      end: [],
    };

    this.parseFlowItems(fc);
    return fc;
  }

  private parseFlowMapping(offset: number): FlowCollection {
    this.pos++; // skip {
    const fc: FlowCollection = {
      type: 'flow-collection',
      offset,
      indent: this.columnOf(offset),
      start: { type: 'flow-map-start', offset, indent: 0, source: '{' },
      items: [],
      end: [],
    };

    this.parseFlowItems(fc);
    return fc;
  }

  private parseFlowItems(fc: FlowCollection): void {
    const isSeq = fc.start.type === 'flow-seq-start';
    const endChar = isSeq ? CH_RBRACKET : CH_RBRACE;
    const endType = isSeq ? 'flow-seq-end' : 'flow-map-end';

    let currentItem: CollectionItem | null = null;
    let state = 0; // 0=need key, 1=need sep, 2=need value

    while (this.pos < this.len) {
      const wsTokens = this.collectFlowWs();

      if (this.pos >= this.len) {
        // Attach trailing ws to current item or end
        if (currentItem && wsTokens.length > 0) {
          currentItem.start.push(...wsTokens);
        }
        break;
      }
      const c = this.src.charCodeAt(this.pos);

      if (c === endChar) {
        if (currentItem) {
          if (wsTokens.length > 0) currentItem.start.push(...wsTokens);
          fc.items.push(currentItem);
          currentItem = null;
        } else if (wsTokens.length > 0) {
          // ws before closing bracket — add to end
          fc.end.push(...wsTokens);
        }
        this.pos++;
        fc.end.push({ type: endType as any, offset: this.pos - 1, indent: 0, source: String.fromCharCode(c) });
        return;
      }

      if (c === CH_COMMA) {
        if (currentItem) {
          fc.items.push(currentItem);
          currentItem = null;
        }
        this.pos++;
        currentItem = { start: [{ type: 'comma', offset: this.pos - 1, indent: 0, source: ',' }, ...wsTokens] };
        state = 0;
        continue;
      }

      if (!isSeq && c === CH_COLON && state === 1) {
        if (!currentItem) currentItem = { start: [] };
        // ws before : goes to sep
        currentItem.sep = currentItem.sep || [];
        currentItem.sep.push(...wsTokens);
        currentItem.sep.push({ type: 'map-value-ind', offset: this.pos, indent: 0, source: ':' });
        this.pos++;
        state = 2;
        continue;
      }

      // ws tokens: after colon (state=2) they go to sep; otherwise to start
      if (!currentItem) {
        currentItem = { start: wsTokens };
      } else if (!isSeq && state === 2) {
        currentItem.sep = currentItem.sep || [];
        currentItem.sep.push(...wsTokens);
      } else {
        currentItem.start.push(...wsTokens);
      }

      // Parse a flow value
      const value = this.parseFlowValue();
      if (!value) break;

      if (isSeq) {
        currentItem.value = value;
        fc.items.push(currentItem);
        currentItem = null;
      } else {
        if (state === 0) {
          currentItem.key = value;
          state = 1;
          // Peek ahead
          const peekWs = this.collectFlowWs();
          if (this.pos < this.len) {
            const nc = this.src.charCodeAt(this.pos);
            if (nc === CH_COMMA || nc === CH_RBRACE) {
              // Key without value — peekWs go to next item
              fc.items.push(currentItem);
              currentItem = peekWs.length > 0 ? { start: peekWs } : null;
              state = 0;
            } else if (nc === CH_COLON) {
              // peekWs go to sep (will be handled in next iteration)
              // Put them back by saving for the colon handler
              // Simplest: add to currentItem.start (they'll be between key and :)
              currentItem.start.push(...peekWs);
            } else {
              currentItem.start.push(...peekWs);
            }
          }
        } else if (state === 2) {
          currentItem.value = value;
          fc.items.push(currentItem);
          currentItem = null;
          state = 0;
        }
      }
    }

    if (currentItem) fc.items.push(currentItem);
  }

  private collectFlowWs(): SourceToken[] {
    const tokens: SourceToken[] = [];
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (c === CH_SPACE || c === CH_TAB) {
        tokens.push(this.readSpaces());
      } else if (c === CH_NL || c === CH_CR) {
        tokens.push(this.readNewline());
      } else if (c === CH_HASH) {
        tokens.push(this.readComment());
      } else {
        break;
      }
    }
    return tokens;
  }

  private parseFlowValue(): Token | undefined {
    if (this.pos >= this.len) return undefined;

    const c = this.src.charCodeAt(this.pos);

    if (c === CH_LBRACKET) return this.parseFlowSequence(this.pos);
    if (c === CH_LBRACE) return this.parseFlowMapping(this.pos);
    if (c === CH_SQUOTE) return this.parseSingleQuotedScalar(this.pos);
    if (c === CH_DQUOTE) return this.parseDoubleQuotedScalar(this.pos);
    if (c === CH_STAR) return this.parseAliasToken(this.pos);
    if (c === CH_PIPE || c === CH_GT) return this.parseBlockScalar(this.pos);

    // Explicit key indicator
    if (c === CH_QMARK && (this.pos + 1 >= this.len || this.isWsOrNl(this.src.charCodeAt(this.pos + 1)))) {
      this.pos++;
      this.skipFlowWsInline();
      return this.parseFlowValue();
    }

    // Anchor or tag — include in plain scalar source for now
    return this.parsePlainScalarToken(this.pos, 0, true);
  }

  private skipFlowWs(_fc?: FlowCollection): void {
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (c === CH_SPACE || c === CH_TAB) {
        this.pos++;
      } else if (c === CH_NL) {
        this.pos++;
        this.onNewLine?.(this.pos);
      } else if (c === CH_CR) {
        this.pos++;
        if (this.pos < this.len && this.src.charCodeAt(this.pos) === CH_NL) this.pos++;
        this.onNewLine?.(this.pos);
      } else if (c === CH_HASH) {
        while (this.pos < this.len && this.src.charCodeAt(this.pos) !== CH_NL && this.src.charCodeAt(this.pos) !== CH_CR) {
          this.pos++;
        }
      } else {
        break;
      }
    }
  }

  private skipFlowWsInline(): void {
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (c === CH_SPACE || c === CH_TAB) this.pos++;
      else break;
    }
  }

  // ---- Scalars --------------------------------------------------------------

  private parsePlainScalarToken(offset: number, minIndent: number, inFlow: boolean): FlowScalar {
    const start = this.pos;
    let end = this.pos;

    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);

      // Colon followed by ws/nl/eof — map value indicator
      if (c === CH_COLON) {
        const next = this.pos + 1 < this.len ? this.src.charCodeAt(this.pos + 1) : -1;
        if (next === CH_SPACE || next === CH_TAB || next === CH_NL || next === CH_CR || next === -1) {
          break;
        }
        this.pos++;
        continue;
      }

      // Hash preceded by ws — comment
      if (c === CH_HASH && this.pos > start) {
        const prev = this.src.charCodeAt(this.pos - 1);
        if (prev === CH_SPACE || prev === CH_TAB || prev === CH_NL || prev === CH_CR) {
          break;
        }
        this.pos++;
        continue;
      }

      // Newline
      if (c === CH_NL || c === CH_CR) {
        if (inFlow) break;
        // Check if next line continues the scalar
        const nlEnd = this.skipNewlineChars(this.pos);
        const nextCol = this.columnOf(nlEnd);
        if (nextCol < minIndent) break;
        if (nextCol <= this.columnOf(start) && !inFlow) {
          // Check for block indicators on next line
          const nc = nlEnd < this.len ? this.src.charCodeAt(nlEnd) : -1;
          if (nc === CH_DASH || nc === CH_QMARK || nc === CH_COLON) {
            const afterNc = nlEnd + 1 < this.len ? this.src.charCodeAt(nlEnd + 1) : -1;
            if (afterNc === CH_SPACE || afterNc === CH_TAB || afterNc === CH_NL || afterNc === CH_CR || afterNc === -1) {
              break;
            }
          }
        }
        // Check for doc markers
        if (this.atDocStartAt(nlEnd) || this.atDocEndAt(nlEnd)) break;

        this.pos = nlEnd;
        continue;
      }

      // Flow indicators
      if (inFlow && (c === CH_COMMA || c === CH_LBRACKET || c === CH_RBRACKET || c === CH_LBRACE || c === CH_RBRACE)) {
        break;
      }

      this.pos++;
    }

    const source = this.src.slice(start, this.pos);
    const indent = this.columnOf(start);
    const scalar: FlowScalar = {
      type: 'scalar',
      offset: start,
      indent,
      source,
    };

    // Trailing end tokens (spaces, comment, newline after scalar on same line)
    const endTokens = this.readScalarEnd();
    if (endTokens.length > 0) {
      scalar.end = endTokens;
    }

    return scalar;
  }

  private parseSingleQuotedScalar(offset: number): FlowScalar {
    this.pos++; // skip opening '
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (c === CH_SQUOTE) {
        this.pos++;
        // Check for escaped ''
        if (this.pos < this.len && this.src.charCodeAt(this.pos) === CH_SQUOTE) {
          this.pos++;
          continue;
        }
        break;
      }
      if (c === CH_NL || c === CH_CR) {
        this.pos++;
        if (c === CH_CR && this.pos < this.len && this.src.charCodeAt(this.pos) === CH_NL) this.pos++;
        this.onNewLine?.(this.pos);
        continue;
      }
      this.pos++;
    }

    const source = this.src.slice(offset, this.pos);
    const indent = this.columnOf(offset);
    const scalar: FlowScalar = {
      type: 'single-quoted-scalar',
      offset,
      indent,
      source,
    };

    const endTokens = this.readScalarEnd();
    if (endTokens.length > 0) scalar.end = endTokens;

    return scalar;
  }

  private parseDoubleQuotedScalar(offset: number): FlowScalar {
    this.pos++; // skip opening "
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (c === 0x5C) { // backslash
        this.pos++;
        if (this.pos < this.len) {
          const esc = this.src.charCodeAt(this.pos);
          if (esc === CH_NL || esc === CH_CR) {
            this.pos++;
            if (esc === CH_CR && this.pos < this.len && this.src.charCodeAt(this.pos) === CH_NL) this.pos++;
            this.onNewLine?.(this.pos);
          } else {
            this.pos++;
          }
        }
        continue;
      }
      if (c === CH_DQUOTE) {
        this.pos++;
        break;
      }
      if (c === CH_NL || c === CH_CR) {
        this.pos++;
        if (c === CH_CR && this.pos < this.len && this.src.charCodeAt(this.pos) === CH_NL) this.pos++;
        this.onNewLine?.(this.pos);
        continue;
      }
      this.pos++;
    }

    const source = this.src.slice(offset, this.pos);
    const indent = this.columnOf(offset);
    const scalar: FlowScalar = {
      type: 'double-quoted-scalar',
      offset,
      indent,
      source,
    };

    const endTokens = this.readScalarEnd();
    if (endTokens.length > 0) scalar.end = endTokens;

    return scalar;
  }

  private parseBlockScalar(offset: number): BlockScalar {
    const indent = this.columnOf(offset);
    const props: Token[] = [];

    // Read the header line (|, >, optional chomp/indent indicators, optional comment)
    const headerStart = this.pos;
    this.pos++; // skip | or >

    // Read rest of header line
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (c === CH_NL || c === CH_CR) break;
      this.pos++;
    }

    // Include the newline in the header source for round-trip
    if (this.pos < this.len) {
      if (this.src.charCodeAt(this.pos) === CH_CR) {
        this.pos++;
        if (this.pos < this.len && this.src.charCodeAt(this.pos) === CH_NL) this.pos++;
      } else if (this.src.charCodeAt(this.pos) === CH_NL) {
        this.pos++;
      }
      this.onNewLine?.(this.pos);
    }

    const headerSource = this.src.slice(headerStart, this.pos);
    props.push({
      type: 'block-scalar-header',
      offset: headerStart,
      indent,
      source: headerSource,
    } as SourceToken);

    // Read block scalar body
    const bodyStart = this.pos;
    // Determine content indent from first non-empty line
    let contentIndent = -1;
    while (this.pos < this.len) {
      // Count leading spaces
      let lineIndent = 0;
      const lineStart = this.pos;
      while (this.pos < this.len && this.src.charCodeAt(this.pos) === CH_SPACE) {
        lineIndent++;
        this.pos++;
      }

      // Empty line
      if (this.pos >= this.len || this.src.charCodeAt(this.pos) === CH_NL || this.src.charCodeAt(this.pos) === CH_CR) {
        if (this.pos < this.len) {
          if (this.src.charCodeAt(this.pos) === CH_CR) {
            this.pos++;
            if (this.pos < this.len && this.src.charCodeAt(this.pos) === CH_NL) this.pos++;
          } else {
            this.pos++;
          }
          this.onNewLine?.(this.pos);
        }
        continue;
      }

      // First non-empty line — set content indent
      if (contentIndent < 0) {
        contentIndent = lineIndent;
      }

      // If indent is less than content indent, end of block
      if (lineIndent < contentIndent) {
        this.pos = lineStart;
        break;
      }

      // Read rest of line
      while (this.pos < this.len) {
        const c = this.src.charCodeAt(this.pos);
        if (c === CH_NL || c === CH_CR) break;
        this.pos++;
      }

      // Skip newline
      if (this.pos < this.len) {
        if (this.src.charCodeAt(this.pos) === CH_CR) {
          this.pos++;
          if (this.pos < this.len && this.src.charCodeAt(this.pos) === CH_NL) this.pos++;
        } else {
          this.pos++;
        }
        this.onNewLine?.(this.pos);
      }
    }

    const source = this.src.slice(bodyStart, this.pos);

    return {
      type: 'block-scalar',
      offset,
      indent,
      props,
      source,
    };
  }

  private parseAliasToken(offset: number): FlowScalar {
    this.pos++; // skip *
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (this.isWsOrNl(c) || c === CH_COMMA || c === CH_LBRACKET || c === CH_RBRACKET ||
          c === CH_LBRACE || c === CH_RBRACE || c === CH_COLON) {
        break;
      }
      this.pos++;
    }

    const source = this.src.slice(offset, this.pos);
    const indent = this.columnOf(offset);
    const scalar: FlowScalar = {
      type: 'alias',
      offset,
      indent,
      source,
    };

    const endTokens = this.readScalarEnd();
    if (endTokens.length > 0) scalar.end = endTokens;

    return scalar;
  }

  // ---- Source token readers -------------------------------------------------

  private readNewline(): SourceToken {
    const offset = this.pos;
    if (this.src.charCodeAt(this.pos) === CH_CR) {
      this.pos++;
      if (this.pos < this.len && this.src.charCodeAt(this.pos) === CH_NL) this.pos++;
    } else {
      this.pos++;
    }
    this.onNewLine?.(this.pos);
    return {
      type: 'newline',
      offset,
      indent: 0,
      source: this.src.slice(offset, this.pos),
    };
  }

  private readSpaces(): SourceToken {
    const offset = this.pos;
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (c !== CH_SPACE && c !== CH_TAB) break;
      this.pos++;
    }
    return {
      type: 'space',
      offset,
      indent: 0,
      source: this.src.slice(offset, this.pos),
    };
  }

  private readComment(): SourceToken {
    const offset = this.pos;
    this.pos++; // skip #
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (c === CH_NL || c === CH_CR) break;
      this.pos++;
    }
    return {
      type: 'comment',
      offset,
      indent: this.columnOf(offset),
      source: this.src.slice(offset, this.pos),
    };
  }

  private readDirectiveLine(): SourceToken {
    const offset = this.pos;
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (c === CH_NL || c === CH_CR) break;
      this.pos++;
    }
    // Include the newline in the directive source for round-trip
    if (this.pos < this.len) {
      if (this.src.charCodeAt(this.pos) === CH_CR) {
        this.pos++;
        if (this.pos < this.len && this.src.charCodeAt(this.pos) === CH_NL) this.pos++;
      } else if (this.src.charCodeAt(this.pos) === CH_NL) {
        this.pos++;
      }
      this.onNewLine?.(this.pos);
    }
    return {
      type: 'directive-line',
      offset,
      indent: 0,
      source: this.src.slice(offset, this.pos),
    };
  }

  private readScalarEnd(): SourceToken[] {
    const tokens: SourceToken[] = [];
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (c === CH_SPACE || c === CH_TAB) {
        tokens.push(this.readSpaces());
      } else if (c === CH_HASH) {
        tokens.push(this.readComment());
      } else if (c === CH_NL || c === CH_CR) {
        tokens.push(this.readNewline());
        break; // Stop after first newline
      } else {
        break;
      }
    }
    return tokens;
  }

  // ---- Helpers --------------------------------------------------------------

  private isWsOrNl(c: number): boolean {
    return c === CH_SPACE || c === CH_TAB || c === CH_NL || c === CH_CR;
  }

  private skipNewlineChars(pos: number): number {
    if (pos >= this.len) return pos;
    const c = this.src.charCodeAt(pos);
    if (c === CH_CR) {
      pos++;
      if (pos < this.len && this.src.charCodeAt(pos) === CH_NL) pos++;
    } else if (c === CH_NL) {
      pos++;
    }
    return pos;
  }

  private columnOf(pos: number): number {
    let p = pos;
    while (p > 0) {
      const c = this.src.charCodeAt(p - 1);
      if (c === CH_NL || c === CH_CR) break;
      p--;
    }
    return pos - p;
  }

  private isMappingLine(): boolean {
    let p = this.pos;
    let depth = 0;
    while (p < this.len) {
      const c = this.src.charCodeAt(p);
      if (c === CH_NL || c === CH_CR) return false;
      if (c === CH_LBRACKET || c === CH_LBRACE) depth++;
      else if (c === CH_RBRACKET || c === CH_RBRACE) depth--;
      else if (c === CH_SQUOTE) {
        p++;
        while (p < this.len) {
          if (this.src.charCodeAt(p) === CH_SQUOTE) {
            p++;
            if (p < this.len && this.src.charCodeAt(p) === CH_SQUOTE) { p++; continue; }
            break;
          }
          p++;
        }
        continue;
      } else if (c === CH_DQUOTE) {
        p++;
        while (p < this.len) {
          if (this.src.charCodeAt(p) === 0x5C) { p += 2; continue; }
          if (this.src.charCodeAt(p) === CH_DQUOTE) { p++; break; }
          p++;
        }
        continue;
      } else if (c === CH_COLON && depth === 0) {
        const next = p + 1 < this.len ? this.src.charCodeAt(p + 1) : -1;
        if (next === CH_SPACE || next === CH_TAB || next === CH_NL || next === CH_CR || next === -1) {
          return true;
        }
      }
      p++;
    }
    return false;
  }

  private atDocStartAt(pos: number): boolean {
    return pos + 2 < this.len &&
      this.src.charCodeAt(pos) === CH_DASH &&
      this.src.charCodeAt(pos + 1) === CH_DASH &&
      this.src.charCodeAt(pos + 2) === CH_DASH &&
      (pos + 3 >= this.len || this.isWsOrNl(this.src.charCodeAt(pos + 3)));
  }

  private atDocEndAt(pos: number): boolean {
    return pos + 2 < this.len &&
      this.src.charCodeAt(pos) === CH_DOT &&
      this.src.charCodeAt(pos + 1) === CH_DOT &&
      this.src.charCodeAt(pos + 2) === CH_DOT &&
      (pos + 3 >= this.len || this.isWsOrNl(this.src.charCodeAt(pos + 3)));
  }

  private skipBlockStartTokens(collected: SourceToken[]): void {
    while (this.pos < this.len) {
      const c = this.src.charCodeAt(this.pos);
      if (c === CH_NL || c === CH_CR) {
        collected.push(this.readNewline());
      } else if (c === CH_SPACE || c === CH_TAB) {
        const sp = this.readSpaces();
        if (this.pos < this.len && this.src.charCodeAt(this.pos) === CH_HASH) {
          collected.push(sp);
          collected.push(this.readComment());
        } else if (this.pos >= this.len || this.src.charCodeAt(this.pos) === CH_NL || this.src.charCodeAt(this.pos) === CH_CR) {
          collected.push(sp);
        } else {
          this.pos -= sp.source.length;
          break;
        }
      } else if (c === CH_HASH) {
        collected.push(this.readComment());
      } else {
        break;
      }
    }
  }

  private prependStartTokens(token: Token, tokens: SourceToken[]): void {
    // For scalars, prepend to end array? No — these are leading tokens.
    // In eemeli CST, leading newlines/comments before a block value become part of
    // the parent collection item's start array, not the scalar itself.
    // For simplicity, we don't prepend — the newline is just consumed.
    // This is a deliberate simplification.
  }
}
