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
import { warn } from '../log.ts'
import { addMergeToJSMap, isMergeKey } from '../schema/yaml-1.1/merge.ts'
import { createStringifyContext } from '../stringify/stringify.ts'
import { isNode } from './identity.ts'
import type { Pair } from './Pair.ts'
import type { ToJSContext } from './toJS.ts'
import { toJS } from './toJS.ts'
import type { MapLike } from './YAMLMap.ts'

export function addPairToJSMap(
  ctx: ToJSContext | undefined,
  map: MapLike,
  { key, value }: Pair
): MapLike {
  if (isNode(key) && key.addToJSMap) key.addToJSMap(ctx, map, value)
  else if (isMergeKey(ctx, key)) addMergeToJSMap(ctx, map, value)
  else {
    const jsKey = toJS(key, '', ctx)
    if (map instanceof Map) {
      map.set(jsKey, toJS(value, jsKey, ctx))
    } else if (map instanceof Set) {
      map.add(jsKey)
    } else {
      const stringKey = stringifyKey(key, jsKey, ctx)
      const jsValue = toJS(value, stringKey, ctx)
      if (stringKey in map)
        Object.defineProperty(map, stringKey, {
          value: jsValue,
          writable: true,
          enumerable: true,
          configurable: true
        })
      else map[stringKey] = jsValue
    }
  }
  return map
}

function stringifyKey(
  key: unknown,
  jsKey: unknown,
  ctx: ToJSContext | undefined
) {
  if (jsKey === null) return ''
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  if (typeof jsKey !== 'object') return String(jsKey)
  if (isNode(key) && ctx?.doc) {
    const strCtx = createStringifyContext(ctx.doc, {})
    strCtx.anchors = new Set()
    for (const node of ctx.anchors.keys())
      strCtx.anchors.add(node.anchor as 'string')
    strCtx.inFlow = true
    strCtx.inStringifyKey = true
    const strKey = key.toString(strCtx)
    if (!ctx.mapKeyWarned) {
      let jsonStr = JSON.stringify(strKey)
      if (jsonStr.length > 40) jsonStr = jsonStr.substring(0, 36) + '..."'
      warn(
        ctx.doc.options.logLevel,
        `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`
      )
      ctx.mapKeyWarned = true
    }
    return strKey
  }
  return JSON.stringify(jsKey)
}
