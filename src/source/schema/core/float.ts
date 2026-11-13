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


import { Scalar } from '../../nodes/Scalar.ts'
import { stringifyNumber } from '../../stringify/stringifyNumber.ts'
import type { ScalarTag } from '../types.ts'

export const floatNaN: ScalarTag = {
  identify: value => typeof value === 'number',
  default: true,
  tag: 'tag:yaml.org,2002:float',
  test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
  resolve: str =>
    str.slice(-3).toLowerCase() === 'nan'
      ? NaN
      : str[0] === '-'
        ? Number.NEGATIVE_INFINITY
        : Number.POSITIVE_INFINITY,
  stringify: stringifyNumber
}

export const floatExp: ScalarTag = {
  identify: value => typeof value === 'number',
  default: true,
  tag: 'tag:yaml.org,2002:float',
  format: 'EXP',
  test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
  resolve: str => parseFloat(str),
  stringify(node) {
    const num = Number(node.value)
    return isFinite(num) ? num.toExponential() : stringifyNumber(node)
  }
}

export const float: ScalarTag = {
  identify: value => typeof value === 'number',
  default: true,
  tag: 'tag:yaml.org,2002:float',
  test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
  resolve(str) {
    const node = new Scalar(parseFloat(str))
    const dot = str.indexOf('.')
    if (dot !== -1 && str[str.length - 1] === '0')
      node.minFractionDigits = str.length - dot - 1
    return node
  },
  stringify: stringifyNumber
}
