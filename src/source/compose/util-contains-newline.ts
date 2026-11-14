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

export function containsNewline(key: Token | null | undefined) {
  if (!key) return null
  switch (key.type) {
    case 'alias':
    case 'scalar':
    case 'double-quoted-scalar':
    case 'single-quoted-scalar':
      if (key.source.includes('\n')) return true
      if (key.end)
        for (const st of key.end) if (st.type === 'newline') return true
      return false
    case 'flow-collection':
      for (const it of key.items) {
        for (const st of it.start) if (st.type === 'newline') return true
        if (it.sep)
          for (const st of it.sep) if (st.type === 'newline') return true
        if (containsNewline(it.key) || containsNewline(it.value)) return true
      }
      return false
    default:
      return true
  }
}
