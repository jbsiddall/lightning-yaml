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
import { isCollection, isScalar } from '../nodes/identity.ts'
import type { Node } from '../nodes/Node.ts'
import type { Scalar } from '../nodes/Scalar.ts'
import type { YAMLMap } from '../nodes/YAMLMap.ts'
import type { YAMLSeq } from '../nodes/YAMLSeq.ts'
import { visit } from '../visit.ts'
import type { CreateNodeContext } from './createNode.ts'
import type { Document } from './document-context.d.ts'

export function anchorIsValid(anchor: string): true {
  if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
    const sa = JSON.stringify(anchor)
    const msg = `Anchor must not contain whitespace or control characters: ${sa}`
    throw new Error(msg)
  }
  return true
}

export function anchorNames(root: Document<Node, boolean> | Node) {
  const anchors = new Set<string>()
  visit(root, {
    Value(_key: unknown, node: Scalar | YAMLMap | YAMLSeq) {
      if (node.anchor) anchors.add(node.anchor)
    }
  })
  return anchors
}

export function findNewAnchor(prefix: string, exclude: Set<string>) {
  for (let i = 1; true; ++i) {
    const name = `${prefix}${i}`
    if (!exclude.has(name)) return name
  }
}

export function createNodeAnchors(
  doc: Document<Node, boolean>,
  prefix: string
) {
  const aliasObjects: unknown[] = []
  const sourceObjects: CreateNodeContext['sourceObjects'] = new Map()
  let prevAnchors: Set<string> | null = null

  return {
    onAnchor: (source: unknown) => {
      aliasObjects.push(source)
      prevAnchors ??= anchorNames(doc)
      const anchor = findNewAnchor(prefix, prevAnchors)
      prevAnchors.add(anchor)
      return anchor
    },

    /**
     * With circular references, the source node is only resolved after all
     * of its child nodes are. This is why anchors are set only after all of
     * the nodes have been created.
     */
    setAnchors: () => {
      for (const source of aliasObjects) {
        const ref = sourceObjects.get(source)
        if (
          typeof ref === 'object' &&
          ref.anchor &&
          (isScalar(ref.node) || isCollection(ref.node))
        ) {
          ref.node.anchor = ref.anchor
        } else {
          const error = new Error(
            'Failed to resolve repeated object (this should not happen)'
          ) as Error & { source: unknown }
          error.source = source
          throw error
        }
      }
    },

    sourceObjects
  }
}
