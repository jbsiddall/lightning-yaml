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


import { YAMLSeq } from '../nodes/YAMLSeq.ts'
import type { BlockSequence } from '../cst.ts'
import type { CollectionTag } from '../schema/types.ts'
import type { ComposeContext, ComposeNode } from './compose-node.ts'
import type { ComposeErrorHandler } from './composer.ts'
import { resolveProps } from './resolve-props.ts'
import { flowIndentCheck } from './util-flow-indent-check.ts'

export function resolveBlockSeq(
  { composeNode, composeEmptyNode }: ComposeNode,
  ctx: ComposeContext,
  bs: BlockSequence,
  onError: ComposeErrorHandler,
  tag?: CollectionTag
) {
  const NodeClass = tag?.nodeClass ?? YAMLSeq
  const seq = new NodeClass(ctx.schema) as YAMLSeq

  if (ctx.atRoot) ctx.atRoot = false
  if (ctx.atKey) ctx.atKey = false
  let offset = bs.offset
  let commentEnd: number | null = null
  for (const { start, value } of bs.items) {
    const props = resolveProps(start, {
      indicator: 'seq-item-ind',
      next: value,
      offset,
      onError,
      parentIndent: bs.indent,
      startOnNewline: true
    })
    if (!props.found) {
      if (props.anchor || props.tag || value) {
        if (value?.type === 'block-seq')
          onError(
            props.end,
            'BAD_INDENT',
            'All sequence items must start at the same column'
          )
        else
          onError(offset, 'MISSING_CHAR', 'Sequence item without - indicator')
      } else {
        commentEnd = props.end
        if (props.comment) seq.comment = props.comment
        continue
      }
    }
    const node = value
      ? composeNode(ctx, value, props, onError)
      : composeEmptyNode(ctx, props.end, start, null, props, onError)
    if (ctx.schema.compat) flowIndentCheck(bs.indent, value, onError)
    offset = node.range[2]
    seq.items.push(node)
  }
  seq.range = [bs.offset, offset, commentEnd ?? offset]
  return seq as YAMLSeq.Parsed
}
