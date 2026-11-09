import { CST } from 'lightning-yaml/yaml'
import * as yaml from 'lightning-yaml/yaml'

const tokens: CST.Token[] = [...new yaml.Parser().parse('value: text')]
const path: CST.VisitPath = [['value', 0]]
const source: CST.SourceToken = { type: 'space', offset: 0, indent: 0, source: ' ' }
const item: CST.CollectionItem = { start: [source], value: CST.createScalarToken('text', { indent: 0 }) }
const visitor: CST.Visitor = (_item, _path) => CST.visit.SKIP
CST.visit(tokens[0]! as CST.Document, visitor)
CST.visit.itemAtPath(tokens[0]! as CST.Document, path)
CST.stringify(item)

// @ts-expect-error CST creation requires a numeric indentation level.
CST.createScalarToken('bad', { indent: 'two' })
