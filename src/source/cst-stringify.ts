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

import type { CollectionItem, Token } from './cst.ts'

/**
 * Stringify a CST document, token, or collection item
 *
 * Fair warning: This applies no validation whatsoever, and
 * simply concatenates the sources in their logical order.
 */
export const stringify = (cst: Token | CollectionItem): string =>
  'type' in cst ? stringifyToken(cst) : stringifyItem(cst)

function stringifyToken(token: Token): string {
  switch (token.type) {
    case 'block-scalar': {
      let res = ''
      for (const tok of token.props) res += stringifyToken(tok)
      return res + token.source
    }
    case 'block-map':
    case 'block-seq': {
      let res = ''
      for (const item of token.items) res += stringifyItem(item)
      return res
    }
    case 'flow-collection': {
      let res = token.start.source
      for (const item of token.items) res += stringifyItem(item)
      for (const st of token.end) res += st.source
      return res
    }
    case 'document': {
      let res = stringifyItem(token)
      if (token.end) for (const st of token.end) res += st.source
      return res
    }
    default: {
      let res = token.source
      if ('end' in token && token.end)
        for (const st of token.end) res += st.source
      return res
    }
  }
}

function stringifyItem({ start, key, sep, value }: CollectionItem): string {
  let res = ''
  for (const st of start) res += st.source
  if (key) res += stringifyToken(key)
  if (sep) for (const st of sep) res += st.source
  if (value) res += stringifyToken(value)
  return res
}
