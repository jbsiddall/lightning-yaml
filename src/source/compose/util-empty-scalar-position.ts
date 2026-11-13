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


import type { Token } from '../cst.ts'

export function emptyScalarPosition(
  offset: number,
  before: Token[] | undefined,
  pos: number | null
) {
  if (before) {
    pos ??= before.length
    for (let i = pos - 1; i >= 0; --i) {
      let st = before[i]
      switch (st.type) {
        case 'space':
        case 'comment':
        case 'newline':
          offset -= st.source.length
          continue
      }

      // Technically, an empty scalar is immediately after the last non-empty
      // node, but it's more useful to place it after any whitespace.
      st = before[++i]
      while (st?.type === 'space') {
        offset += st.source.length
        st = before[++i]
      }
      break
    }
  }
  return offset
}
