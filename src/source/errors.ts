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


import type { LineCounter } from '../line-counter.ts'

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

export class YAMLWarning extends YAMLError {
  constructor(pos: [number, number], code: ErrorCode, message: string) {
    super('YAMLWarning', pos, code, message)
  }
}

export const prettifyError =
  (source: string, lineCounter: LineCounter) =>
  (error: YAMLError) => {
    if (error.pos[0] === -1) return
    error.linePos = error.pos.map(pos => lineCounter.linePos(pos)) as
      | [LinePos]
      | [LinePos, LinePos]
    const { line, col } = error.linePos[0]
    error.message += ` at line ${line}, column ${col}`

    let columnIndex = col - 1
    let lineText = source
      .substring(
        lineCounter.lineStarts[line - 1],
        lineCounter.lineStarts[line]
      )
      .replace(/[\n\r]+$/, '')

    if (columnIndex >= 60 && lineText.length > 80) {
      const trimStart = Math.min(columnIndex - 39, lineText.length - 79)
      lineText = '…' + lineText.substring(trimStart)
      columnIndex -= trimStart - 1
    }
    if (lineText.length > 80) lineText = lineText.substring(0, 79) + '…'

    if (line > 1 && /^ *$/.test(lineText.substring(0, columnIndex))) {
      let previous = source.substring(
        lineCounter.lineStarts[line - 2],
        lineCounter.lineStarts[line - 1]
      )
      if (previous.length > 80) previous = previous.substring(0, 79) + '…\n'
      lineText = previous + lineText
    }

    if (/[^ ]/.test(lineText)) {
      const end = error.linePos[1]
      const count =
        end?.line === line && end.col > col
          ? Math.max(1, Math.min(end.col - col, 80 - columnIndex))
          : 1
      error.message += `:\n\n${lineText}\n${' '.repeat(columnIndex)}${'^'.repeat(count)}\n`
    }
  }
