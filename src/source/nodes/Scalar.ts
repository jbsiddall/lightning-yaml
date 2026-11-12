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
import type { BlockScalar, FlowScalar } from '../cst.ts'
import { SCALAR } from './identity.ts'
import type { Range } from './Node.ts'
import { NodeBase } from './Node.ts'
import type { ToJSContext } from './toJS.ts'
import { toJS } from './toJS.ts'

export const isScalarValue = (value: unknown) =>
  !value || (typeof value !== 'function' && typeof value !== 'object')

export declare namespace Scalar {
  interface Parsed extends Scalar {
    range: Range
    source: string
    srcToken?: FlowScalar | BlockScalar
  }

  type BLOCK_FOLDED = 'BLOCK_FOLDED'
  type BLOCK_LITERAL = 'BLOCK_LITERAL'
  type PLAIN = 'PLAIN'
  type QUOTE_DOUBLE = 'QUOTE_DOUBLE'
  type QUOTE_SINGLE = 'QUOTE_SINGLE'

  type Type = BLOCK_FOLDED | BLOCK_LITERAL | PLAIN | QUOTE_DOUBLE | QUOTE_SINGLE
}

export class Scalar<T = unknown> extends NodeBase {
  static readonly BLOCK_FOLDED = 'BLOCK_FOLDED'
  static readonly BLOCK_LITERAL = 'BLOCK_LITERAL'
  static readonly PLAIN = 'PLAIN'
  static readonly QUOTE_DOUBLE = 'QUOTE_DOUBLE'
  static readonly QUOTE_SINGLE = 'QUOTE_SINGLE'

  value: T

  /** An optional anchor on this node. Used by alias nodes. */
  declare anchor?: string

  /**
   * By default (undefined), numbers use decimal notation.
   * The YAML 1.2 core schema only supports 'HEX' and 'OCT'.
   * The YAML 1.1 schema also supports 'BIN' and 'TIME'
   */
  declare format?: string

  /**
   * If `value` is a number that is serialized as a decimal string
   * (i.e. not using exponential notation),
   * use this value when stringifying this node.
   */
  declare minFractionDigits?: number

  /** Set during parsing to the source string value */
  declare source?: string

  /** The scalar style used for the node's string representation */
  declare type?: Scalar.Type

  constructor(value: T) {
    super(SCALAR)
    this.value = value
  }

  toJSON(arg?: any, ctx?: ToJSContext): any {
    return ctx?.keep ? this.value : toJS(this.value, arg, ctx)
  }

  toString(): string {
    return String(this.value)
  }
}
