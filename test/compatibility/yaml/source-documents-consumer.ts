import type { DocumentContext } from '../../../src/source/doc/document-context.d.ts'
import type { SchemaContext } from '../../../src/source/schema/schema-context.d.ts'
import { Document } from '../../../src/source/doc/Document.ts'
import { Scalar } from '../../../src/source/nodes/Scalar.ts'
import { Parser } from '../../../src/source/parser.ts'
import { Composer } from '../../../src/source/compose/composer.ts'
import { Schema } from '../../../src/source/schema/Schema.ts'

const nativeDocument = new Document(new Scalar('value'))
const documentContract: DocumentContext = nativeDocument
const nativeSchema: SchemaContext = new Schema({ schema: 'core' })
const parsedDocument = [
  ...new Composer().compose(new Parser().parse('value: [1, 2]'), true, 14)
][0]!

nativeDocument.setIn(['nested', 'value'], 1)
const clone = nativeDocument.clone()
clone.toJS({ mapAsMap: true, maxAliasCount: 10 })
parsedDocument.contents?.toJS(parsedDocument)
nativeSchema.clone()
void documentContract
