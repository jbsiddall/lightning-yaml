/**
 * Public API for the yaml-compat POC parser.
 *
 * High-level: parse, parseDocument, parseAllDocuments
 * Low-level (CST pipeline): Parser, Composer, LineCounter, CST namespace
 */

import { Parser as ASTParser, LineCounter } from './parser.ts';
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
import { CSTParser } from './cst-parser.ts';
import { Composer } from './cst-composer.ts';
import * as CST from './cst.ts';
import { stringify } from './stringify.ts';

// ---- Public API functions --------------------------------------------------

function parse(src: string, opts?: ParseOptions): unknown {
  const options = validateOptions(opts as Record<string, unknown> | undefined);
  const parser = new ASTParser(src, options);
  const parsed = parser.parseDocument();

  if (parsed.errors.length > 0) {
    throw parsed.errors[0];
  }

  const doc = new Document(parsed.contents, options);
  doc.errors = parsed.errors;
  doc.warnings = parsed.warnings;
  return doc.toJS({ merge: options.merge });
}

function parseDocument(src: string, opts?: ParseOptions): Document {
  const options = validateOptions(opts as Record<string, unknown> | undefined);
  const parser = new ASTParser(src, options);
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

function parseAllDocuments(src: string, opts?: ParseOptions): Document[] {
  const options = validateOptions(opts as Record<string, unknown> | undefined);
  const parser = new ASTParser(src, options);
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
  // High-level API
  parse,
  parseDocument,
  parseAllDocuments,

  // Low-level CST pipeline (eemeli-compatible)
  CSTParser as Parser,
  Composer,
  LineCounter,
  CST,

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

  // AST Visitor
  visit,

  // Document
  Document,

  // Errors
  YAMLParseError,
  YAMLWarning,

  // AST-level stringify
  stringify,
};

// CST utility re-exports
export { createScalarToken, resolveAsScalar, setScalarValue } from './cst-scalar.ts';
export { stringify as stringifyCST } from './cst-stringify.ts';
export type { Visitor as CSTVisitor, VisitPath } from './cst-visit.ts';
export { visit as visitCST } from './cst-visit.ts';

// Re-export types
export type { Node, Range, ParseOptions, CustomTag };
