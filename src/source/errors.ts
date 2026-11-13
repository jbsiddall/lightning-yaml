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


export type ErrorCode =
  | 'ALIAS_PROPS'
  | 'BAD_ALIAS'
  | 'BAD_DIRECTIVE'
  | 'BAD_DQ_ESCAPE'
  | 'BAD_INDENT'
  | 'BAD_PROP_ORDER'
  | 'BAD_SCALAR_START'
  | 'BLOCK_AS_IMPLICIT_KEY'
  | 'BLOCK_IN_FLOW'
  | 'DUPLICATE_KEY'
  | 'IMPOSSIBLE'
  | 'KEY_OVER_1024_CHARS'
  | 'MISSING_CHAR'
  | 'MULTILINE_IMPLICIT_KEY'
  | 'MULTIPLE_ANCHORS'
  | 'MULTIPLE_DOCS'
  | 'MULTIPLE_TAGS'
  | 'NON_STRING_KEY'
  | 'RESOURCE_EXHAUSTION'
  | 'TAB_AS_INDENT'
  | 'TAG_RESOLVE_FAILED'
  | 'UNEXPECTED_TOKEN'
  | 'BAD_COLLECTION_TYPE'

export type LinePos = { line: number; col: number }

export class YAMLError extends Error {
  name: 'YAMLParseError' | 'YAMLWarning'
  code: ErrorCode
  message: string
  pos: [number, number]
  linePos?: [LinePos] | [LinePos, LinePos]

  constructor(
    name: YAMLError['name'],
    pos: [number, number],
    code: ErrorCode,
    message: string
  ) {
    super()
    this.name = name
    this.code = code
    this.message = message
    this.pos = pos
  }
}

export class YAMLParseError extends YAMLError {
  constructor(pos: [number, number], code: ErrorCode, message: string) {
    super('YAMLParseError', pos, code, message)
  }
}
