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
import type { CreateNodeContext } from '../doc/createNode.ts'
import type { Node } from '../nodes/Node.ts'
import type { Pair } from '../nodes/Pair.ts'
import type { Scalar } from '../nodes/Scalar.ts'
import type { YAMLMap } from '../nodes/YAMLMap.ts'
import type { YAMLSeq } from '../nodes/YAMLSeq.ts'
import type { ParseOptions, ToStringOptions } from '../nodes/node-options.d.ts'
import type { StringifyContext } from '../stringify/stringify.ts'
import { MAP, SCALAR, SEQ } from '../nodes/identity.ts'
interface TagBase { createNode?: (schema: SchemaContext, value: unknown, ctx: CreateNodeContext) => Node; default?: boolean | 'key'; format?: string; identify?: (value: unknown) => boolean; tag: string }
export interface ScalarTag extends TagBase { collection?: never; nodeClass?: never; resolve(value: string, onError: (message: string) => void, options: ParseOptions): unknown; stringify?: (item: Scalar, ctx: StringifyContext, onComment?: () => void, onChompKeep?: () => void) => string; test?: RegExp }
export interface CollectionTag extends TagBase { collection: 'map' | 'seq'; nodeClass?: { new (schema?: SchemaContext): Node; from?: (schema: SchemaContext, obj: unknown, ctx: CreateNodeContext) => Node }; resolve?: (value: YAMLMap.Parsed | YAMLSeq.Parsed, onError: (message: string) => void, options: ParseOptions) => unknown; stringify?: never; test?: never }
export interface SchemaContext { compat: Array<CollectionTag | ScalarTag> | null; knownTags: Record<string, CollectionTag | ScalarTag>; name: string; sortMapEntries: ((a: Pair, b: Pair) => number) | null; tags: Array<CollectionTag | ScalarTag>; toStringOptions: Readonly<ToStringOptions> | null; clone(): SchemaContext; readonly [MAP]: CollectionTag; readonly [SCALAR]: ScalarTag; readonly [SEQ]: CollectionTag }
export type Schema = SchemaContext
