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


import { MAP, SCALAR, SEQ } from '../nodes/identity.ts'
import type { Pair } from '../nodes/Pair.ts'
import type { SchemaOptions, ToStringOptions } from '../options.ts'
import { map } from './common/map.ts'
import { seq } from './common/seq.ts'
import { string } from './common/string.ts'
import { assertSupportedCustomTagAliases, coreKnownTags, getTags } from './tags.ts'
import type { CollectionTag, ScalarTag } from './types.ts'

const sortMapEntriesByKey = (a: Pair<any>, b: Pair<any>) =>
  a.key < b.key ? -1 : a.key > b.key ? 1 : 0

function supportedCustomTags(
  customTags: SchemaOptions['customTags']
): SchemaOptions['customTags'] {
  if (Array.isArray(customTags)) return assertSupportedCustomTagAliases(customTags)
  if (typeof customTags === 'function')
    return tags => assertSupportedCustomTagAliases(customTags(tags))
  return customTags
}

export class Schema {
  compat: Array<CollectionTag | ScalarTag> | null
  knownTags: Record<string, CollectionTag | ScalarTag>
  name: string
  sortMapEntries: ((a: Pair, b: Pair) => number) | null
  tags: Array<CollectionTag | ScalarTag>
  toStringOptions: Readonly<ToStringOptions> | null

  // Used by createNode() and composeScalar()
  declare readonly [MAP]: CollectionTag
  declare readonly [SCALAR]: ScalarTag
  declare readonly [SEQ]: CollectionTag

  constructor({
    compat,
    customTags,
    merge,
    resolveKnownTags,
    schema,
    sortMapEntries,
    toStringDefaults
  }: SchemaOptions) {
    if (schema !== undefined && schema !== 'core')
      throw new Error('lightning-yaml source documents support the core schema only')
    if (merge !== undefined || compat !== undefined)
      throw new Error('merge keys and compatibility schemas are not supported by source documents')
    if (resolveKnownTags !== undefined && resolveKnownTags !== true)
      throw new Error('source documents always resolve the supported explicit core tags')
    this.compat = Array.isArray(compat)
      ? getTags(compat, 'compat')
      : compat
        ? getTags(null, compat)
        : null
    this.name = (typeof schema === 'string' && schema) || 'core'
    this.knownTags = {
      'tag:yaml.org,2002:binary': coreKnownTags['tag:yaml.org,2002:binary']
    }
    this.tags = getTags(supportedCustomTags(customTags), this.name, merge)
    if (this.tags.some(tag =>
      tag.tag === 'tag:yaml.org,2002:timestamp' ||
      tag.tag === 'tag:yaml.org,2002:merge'
    ))
      throw new Error('timestamp and merge tags are not supported by source documents')
    this.toStringOptions = toStringDefaults ?? null

    Object.defineProperty(this, MAP, { value: map })
    Object.defineProperty(this, SCALAR, { value: string })
    Object.defineProperty(this, SEQ, { value: seq })

    // Used by createMap()
    this.sortMapEntries =
      typeof sortMapEntries === 'function'
        ? sortMapEntries
        : sortMapEntries === true
          ? sortMapEntriesByKey
          : null
  }

  clone(): Schema {
    const copy: Schema = Object.create(
      Schema.prototype,
      Object.getOwnPropertyDescriptors(this)
    )
    copy.tags = this.tags.slice()
    return copy
  }
}
