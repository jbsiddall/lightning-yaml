import type { DocumentContext } from '../../../src/source/doc/document-context.d.ts'
import type { SchemaContext } from '../../../src/source/schema/schema-context.d.ts'
import { Composer, Document, Parser, Scalar, Schema, parseDocument } from '../../../src/yaml-compat.ts'

const nativeDocument = new Document(new Scalar('value'))
const documentContract: DocumentContext = nativeDocument
const nativeSchema = new Schema({ schema: 'core' })
const schemaContract: SchemaContext = nativeSchema
const parsedDocument = parseDocument('value: [1, 2]')
const parsedContract: DocumentContext = parsedDocument
const composed = [...new Composer().compose(new Parser().parse('value: [1, 2]'), true, 14)][0]!

nativeDocument.setIn(['nested', 'value'], 1)
const clone = nativeDocument.clone()
clone.toJS({ mapAsMap: true, maxAliasCount: 10 })
parsedDocument.contents?.toJS(parsedDocument)
parsedDocument.clone()
composed.clone().toJS()
nativeSchema.clone()
void documentContract
void parsedContract
void schemaContract
