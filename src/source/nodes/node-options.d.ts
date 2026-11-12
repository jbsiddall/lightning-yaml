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
import type { Reviver } from '../doc/applyReviver.ts'
import type { LogLevelId } from '../log.ts'
import type { LineCounter } from '../../line-counter.ts'
import type { ParsedNode } from './Node.ts'
import type { Pair } from './Pair.ts'
import type { Scalar } from './Scalar.ts'
import type { CollectionTag, ScalarTag } from '../schema/schema-context.d.ts'
export interface ParseOptions { intAsBigInt?: boolean; keepSourceTokens?: boolean; lineCounter?: LineCounter; prettyErrors?: boolean; strict?: boolean; stringKeys?: boolean; uniqueKeys?: boolean | ((a: ParsedNode, b: ParsedNode) => boolean) }
export interface DocumentOptions { logLevel?: LogLevelId; version?: '1.1' | '1.2' | 'next' }
export interface CreateNodeOptions { aliasDuplicateObjects?: boolean; anchorPrefix?: string; flow?: boolean; keepUndefined?: boolean | null; onTagObj?: (tagObj: ScalarTag | CollectionTag) => void; tag?: string }
export interface ToJSOptions { mapAsMap?: boolean; maxAliasCount?: number; onAnchor?: (value: unknown, count: number) => void; reviver?: Reviver }
export interface ToStringOptions { blockQuote?: boolean | 'folded' | 'literal'; collectionStyle?: 'any' | 'block' | 'flow'; commentString?: (comment: string) => string; defaultKeyType?: Scalar.Type | null; defaultStringType?: Scalar.Type; directives?: boolean | null; doubleQuotedAsJSON?: boolean; doubleQuotedMinMultiLineLength?: number; falseStr?: string; flowCollectionPadding?: boolean; indent?: number; indentSeq?: boolean; lineWidth?: number; minContentWidth?: number; nullStr?: string; simpleKeys?: boolean; singleQuote?: boolean | null; trailingComma?: boolean; trueStr?: string; verifyAliasOrder?: boolean }
