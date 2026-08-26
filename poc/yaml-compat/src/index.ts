/**
 * Public API for the yaml-compat POC parser.
 *
 * Exports:
 *   parse(src, opts?) → JS value
 *   parseDocument(src, opts?) → Document
 *   parseAllDocuments(src, opts?) → Document[]
 *   Node classes: Scalar, YAMLMap, YAMLSeq, Pair, Alias
 *   Guards: isNode, isScalar, isMap, isSeq, isPair, isAlias, isCollection
 *   visit, LineCounter
 *   Document
 */

import { Parser, LineCounter } from './parser.ts';
import { Document } from './document.ts';
import {
  Scalar, YAMLMap, YAMLSeq, Pair, Alias,
  SCALAR_PLAIN, SCALAR_SINGLE, SCALAR_DOUBLE, SCALAR_FOLDED, SCALAR_LITERAL,
  isNode, isScalar, isMap, isSeq, isPair, isAlias, isCollection,
  type Node, type Range,
} from './nodes.ts';
import { visit } from './visit.ts';
import { YAMLParseError, YAMLWarning } from './errors.ts';
import { validateOptions, type ParseOptions, type CustomTag } from './options.ts';

// ---- Public API functions --------------------------------------------------

/**
 * Parse YAML source into a plain JS value.
 * Like JSON.parse but for YAML.
 */
function parse(src: string, opts?: ParseOptions): unknown {
  const options = validateOptions(opts);
  const parser = new Parser(src, options);
  const parsed = parser.parseDocument();

  if (parsed.errors.length > 0) {
    throw parsed.errors[0];
  }

  const doc = new Document(parsed.contents, options);
  doc.errors = parsed.errors;
  doc.warnings = parsed.warnings;
  return doc.toJS({ merge: options.merge });
}

/**
 * Parse YAML source into a Document with full AST, comments, ranges.
 * Never throws on parse errors — errors collected on doc.errors.
 */
function parseDocument(src: string, opts?: ParseOptions): Document {
  const options = validateOptions(opts);
  const parser = new Parser(src, options);
  const parsed = parser.parseDocument();

  const doc = new Document(parsed.contents, options);
  doc.errors = parsed.errors;
  doc.warnings = parsed.warnings;
  doc.directives = parsed.directives;
  doc.commentBefore = parsed.commentBefore;
  doc.comment = parsed.comment;
  doc.range = parsed.range;

  return doc;
}

/**
 * Parse a multi-document YAML stream into an array of Documents.
 */
function parseAllDocuments(src: string, opts?: ParseOptions): Document[] {
  const options = validateOptions(opts);
  const parser = new Parser(src, options);
  const parsedDocs = parser.parseAllDocuments();

  return parsedDocs.map((parsed) => {
    const doc = new Document(parsed.contents, options);
    doc.errors = parsed.errors;
    doc.warnings = parsed.warnings;
    doc.directives = parsed.directives;
    doc.commentBefore = parsed.commentBefore;
    doc.comment = parsed.comment;
    doc.range = parsed.range;
    return doc;
  });
}

// ---- Exports ---------------------------------------------------------------

export {
  // Public API
  parse,
  parseDocument,
  parseAllDocuments,

  // Node classes
  Scalar,
  YAMLMap,
  YAMLSeq,
  Pair,
  Alias,

  // Scalar type constants
  SCALAR_PLAIN,
  SCALAR_SINGLE,
  SCALAR_DOUBLE,
  SCALAR_FOLDED,
  SCALAR_LITERAL,

  // Type guards
  isNode,
  isScalar,
  isMap,
  isSeq,
  isPair,
  isAlias,
  isCollection,

  // Visitor
  visit,

  // Line counter
  LineCounter,

  // Document
  Document,

  // Errors
  YAMLParseError,
  YAMLWarning,
};

// Re-export types
export type { Node, Range, ParseOptions, CustomTag };
