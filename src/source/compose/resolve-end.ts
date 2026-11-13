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

import type { SourceToken } from '../cst.ts'
import type { ComposeErrorHandler } from '../scalar-types.d.ts'

export function resolveEnd(
  end: SourceToken[] | undefined,
  offset: number,
  reqSpace: boolean,
  onError: ComposeErrorHandler
) {
  let comment = ''
  if (end) {
    let hasSpace = false
    let sep = ''
    for (const token of end) {
      const { source, type } = token
      switch (type) {
        case 'space':
          hasSpace = true
          break
        case 'comment': {
          if (reqSpace && !hasSpace)
            onError(
              token,
              'MISSING_CHAR',
              'Comments must be separated from other tokens by white space characters'
            )
          const cb = source.substring(1) || ' '
          if (!comment) comment = cb
          else comment += sep + cb
          sep = ''
          break
        }
        case 'newline':
          if (comment) sep += source
          hasSpace = true
          break
        default:
          onError(token, 'UNEXPECTED_TOKEN', `Unexpected ${type} at node end`)
      }
      offset += source.length
    }
  }
  return { comment, offset }
}
