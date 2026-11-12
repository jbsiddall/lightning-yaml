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
import type { Node } from '../nodes/Node.ts'
import type { NodeType } from '../nodes/Node.ts'
import type { NODE_TYPE } from '../nodes/identity.ts'
import type { SchemaContext } from '../schema/schema-context.d.ts'
import type { CreateNodeOptions, ToJSOptions, ToStringOptions } from '../nodes/node-options.d.ts'
export interface DocumentContext { readonly [NODE_TYPE]: symbol; commentBefore: string | null; comment: string | null; contents: Node | null; directives: { tagString(tag: string): string } | undefined; options: { logLevel: 'silent' | 'error' | 'warn' | 'debug' }; schema: SchemaContext; createNode<T = unknown>(value: T, options?: CreateNodeOptions): NodeType<T>; createNode<T = unknown>(value: T, replacer: unknown[] | ((key: unknown, value: unknown) => unknown) | CreateNodeOptions | null, options?: CreateNodeOptions): NodeType<T>; toJS(options?: ToJSOptions & { [ignored: string]: unknown }): any; toJSON(key?: string | null, onAnchor?: ToJSOptions['onAnchor']): any; toString(options?: ToStringOptions): string }
export type Document<T = Node, Strict extends boolean = boolean> = DocumentContext
export type Replacer = unknown[] | ((key: unknown, value: unknown) => unknown)
