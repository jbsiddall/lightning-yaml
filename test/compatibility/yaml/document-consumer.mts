import yaml, { Composer, Document, Scalar, Schema, YAMLParseError, YAMLError, isDocument, parseDocument, type DocumentOptions, type ErrorCode, type LinePos, type Node, type ParseOptions, type Tags } from 'lightning-yaml/yaml'

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
try {
  yaml.parse('value: [1,')
} catch (error) {
  if (error instanceof YAMLParseError) {
    const code: ErrorCode = error.code
    const pos: [number, number] = error.pos
    const linePos: [LinePos] | [LinePos, LinePos] | undefined = error.linePos
    const sourceError: YAMLError = error
    void code
    void pos
    void linePos
    void sourceError
  }
}
const constructedError = new YAMLParseError([2, 3], 'MISSING_CHAR', 'message')
void constructedError.pos
void node

// @ts-expect-error Source options must be an object with supported option types.
parseDocument('x', { keepSourceTokens: 'yes' })
