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

import type { ScalarType } from '../scalar-types.d.ts'
export interface StringifyContext {
  implicitKey: boolean; indent: string; inFlow: boolean; indentAtStart: number
  indentStep: string; forceBlockIndent: boolean; actualString: boolean
  options: { blockQuote?: boolean | 'literal' | 'folded'; commentString: (comment: string) => string
    doubleQuotedAsJSON: boolean; doubleQuotedMinMultiLineLength: number
    lineWidth: number; minContentWidth: number; singleQuote: boolean
    defaultKeyType?: ScalarType; defaultStringType?: ScalarType }
  doc: { schema: { compat?: Array<Tag>; tags: Array<Tag> } }
}
interface Tag { default?: boolean; tag: string; test?: RegExp }
