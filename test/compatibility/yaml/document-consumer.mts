import yaml, { Composer, Document, Scalar, Schema, isDocument, parseDocument, type DocumentOptions, type Node, type ParseOptions, type Tags } from 'lightning-yaml/yaml'

const version: '1.1' | '1.2' = '1.2'
const options: ParseOptions & DocumentOptions = { version, keepSourceTokens: true }
const customTags: Tags = []
const document = parseDocument('answer: 42', options)
const native = new Document(new Scalar('value'), { schema: 'core' })
const composed = [...new Composer().compose(new yaml.Parser().parse('value'), true, 5)][0]!
const node: Node | null = document.contents
if (isDocument(document)) document.clone().toJS()
native.toJS()
composed.toJS()
new Schema({ schema: 'core' }).clone()
new Schema({ schema: 'core', customTags })
yaml.Document === Document
void node

// @ts-expect-error Source options must be an object with supported option types.
parseDocument('x', { keepSourceTokens: 'yes' })
