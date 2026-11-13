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


import type { Scalar } from '../nodes/Scalar.ts'

export function stringifyNumber({
  format,
  minFractionDigits,
  tag,
  value
}: Scalar): string {
  if (typeof value === 'bigint') return String(value)
  const num = typeof value === 'number' ? value : Number(value)
  if (!isFinite(num)) return isNaN(num) ? '.nan' : num < 0 ? '-.inf' : '.inf'
  let n = Object.is(value, -0) ? '-0' : JSON.stringify(value)
  if (
    !format &&
    minFractionDigits &&
    (!tag || tag === 'tag:yaml.org,2002:float') &&
    /^-?\d/.test(n) &&
    !n.includes('e')
  ) {
    let i = n.indexOf('.')
    if (i < 0) {
      i = n.length
      n += '.'
    }
    let d = minFractionDigits - (n.length - i - 1)
    while (d-- > 0) n += '0'
  }
  return n
}
