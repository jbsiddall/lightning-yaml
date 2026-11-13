/*!
Copyright Eemeli Aro <eemeli@gmail.com>

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
*/


import type { Directives } from '../doc/directives.ts'
import { Document } from '../doc/Document.ts'
import type { ParsedNode } from '../nodes/Node.ts'
import type {
  DocumentOptions,
  ParseOptions,
  SchemaOptions
} from '../options.ts'
import type * as CST from '../cst.ts'
import {
  type ComposeContext,
  composeEmptyNode,
  composeNode
} from './compose-node.ts'
import type { ComposeErrorHandler } from './composer.ts'
import { resolveEnd } from './resolve-end.ts'
import { resolveProps } from './resolve-props.ts'

export function composeDoc<
  Contents extends ParsedNode = ParsedNode,
  Strict extends boolean = true
>(
  options: ParseOptions & DocumentOptions & SchemaOptions,
  directives: Directives,
  { offset, start, value, end }: CST.Document,
  onError: ComposeErrorHandler
) {
  const opts = Object.assign({ _directives: directives }, options)
  const doc = new Document(undefined, opts) as Document.Parsed<Contents, Strict>
  const ctx: ComposeContext = {
    atKey: false,
    atRoot: true,
    directives: doc.directives,
    options: doc.options,
    schema: doc.schema
  }
  const props = resolveProps(start, {
    indicator: 'doc-start',
    next: value ?? end?.[0],
    offset,
    onError,
    parentIndent: 0,
    startOnNewline: true
  })
  if (props.found) {
    doc.directives.docStart = true
    if (
      value &&
      (value.type === 'block-map' || value.type === 'block-seq') &&
      !props.hasNewline
    )
      onError(
        props.end,
        'MISSING_CHAR',
        'Block collection cannot start on same line with directives-end marker'
      )
  }
  // @ts-expect-error If Contents is set, let's trust the user
  doc.contents = value
    ? composeNode(ctx, value, props, onError)
    : composeEmptyNode(ctx, props.end, start, null, props, onError)

  const contentEnd = doc.contents.range[2]
  const re = resolveEnd(end, contentEnd, false, onError)
  if (re.comment) doc.comment = re.comment
  doc.range = [offset, contentEnd, re.offset]
  return doc
}
