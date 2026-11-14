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
import type { Document } from '../doc/document-context.d.ts'
import { hasAnchor } from './identity.ts'
import type { Node } from './Node.ts'

export interface AnchorData {
  aliasCount: number
  count: number
  res: unknown
}

export interface ToJSContext {
  anchors: Map<Node, AnchorData>
  /** Cached anchor and alias nodes in the order they occur in the document */
  aliasResolveCache?: Node[]
  doc: Document<Node, boolean>
  keep: boolean
  mapAsMap: boolean
  mapKeyWarned: boolean
  maxAliasCount: number
  onCreate?: (res: unknown) => void
}

/**
 * Recursively convert any node or its contents to native JavaScript
 *
 * @param value - The input value
 * @param arg - If `value` defines a `toJSON()` method, use this
 *   as its first argument
 * @param ctx - Conversion context, originally set in Document#toJS(). If
 *   `{ keep: true }` is not set, output should be suitable for JSON
 *   stringification.
 */
export function toJS(value: any, arg: string | null, ctx?: ToJSContext): any {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  if (Array.isArray(value)) return value.map((v, i) => toJS(v, String(i), ctx))
  if (value && typeof value.toJSON === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    if (!ctx || !hasAnchor(value)) return value.toJSON(arg, ctx)
    const data: AnchorData = { aliasCount: 0, count: 1, res: undefined }
    ctx.anchors.set(value, data)
    ctx.onCreate = res => {
      data.res = res
      delete ctx.onCreate
    }
    const res = value.toJSON(arg, ctx)
    if (ctx.onCreate) ctx.onCreate(res)
    return res
  }
  if (typeof value === 'bigint' && !ctx?.keep) return Number(value)
  return value
}
