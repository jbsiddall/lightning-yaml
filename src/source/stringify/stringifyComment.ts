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
/**
 * Stringifies a comment.
 *
 * Empty comment lines are left empty,
 * lines consisting of a single space are replaced by `#`,
 * and all other lines are prefixed with a `#`.
 */
export const stringifyComment = (str: string) =>
  str.replace(/^(?!$)(?: $)?/gm, '#')

export function indentComment(comment: string, indent: string) {
  if (/^\n+$/.test(comment)) return comment.substring(1)
  return indent ? comment.replace(/^(?! *$)/gm, indent) : comment
}

export const lineComment = (str: string, indent: string, comment: string) =>
  str.endsWith('\n')
    ? indentComment(comment, indent)
    : comment.includes('\n')
      ? '\n' + indentComment(comment, indent)
      : (str.endsWith(' ') ? '' : ' ') + comment
