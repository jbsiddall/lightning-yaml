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
import type { CreateNodeContext } from '../doc/createNode.ts'
import { createNode } from '../doc/createNode.ts'
import type { CollectionItem } from '../cst.ts'
import type { Schema } from '../schema/schema-context.d.ts'
import type { StringifyContext } from '../stringify/stringify.ts'
import { stringifyPair } from '../stringify/stringifyPair.ts'
import { addPairToJSMap } from './addPairToJSMap.ts'
import { isNode, NODE_TYPE, PAIR } from './identity.ts'
import type { Node } from './Node.ts'
import type { ToJSContext } from './toJS.ts'

export function createPair(
  key: unknown,
  value: unknown,
  ctx: CreateNodeContext
): Pair<Node, Node> {
  const k = createNode(key, undefined, ctx)
  const v = createNode(value, undefined, ctx)
  return new Pair(k, v)
}

export class Pair<K = unknown, V = unknown> {
  declare readonly [NODE_TYPE]: symbol

  /** Always Node or null when parsed, but can be set to anything. */
  key: K

  /** Always Node or null when parsed, but can be set to anything. */
  value: V | null

  /** The CST token that was composed into this pair.  */
  declare srcToken?: CollectionItem

  constructor(key: K, value: V | null = null) {
    Object.defineProperty(this, NODE_TYPE, { value: PAIR })
    this.key = key
    this.value = value
  }

  clone(schema?: Schema): Pair<K, V> {
    let { key, value } = this
    if (isNode(key)) key = key.clone(schema) as unknown as K
    if (isNode(value)) value = value.clone(schema) as unknown as V
    return new Pair(key, value)
  }

  toJSON(_?: unknown, ctx?: ToJSContext): ReturnType<typeof addPairToJSMap> {
    const pair = ctx?.mapAsMap ? new Map() : {}
    return addPairToJSMap(ctx, pair, this)
  }

  toString(
    ctx?: StringifyContext,
    onComment?: () => void,
    onChompKeep?: () => void
  ): string {
    return ctx?.doc
      ? stringifyPair(this, ctx, onComment, onChompKeep)
      : JSON.stringify(this)
  }
}
