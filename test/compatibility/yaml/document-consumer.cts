import yaml = require('lightning-yaml/yaml')

const document = yaml.parseDocument('answer: 42', { version: '1.2', keepSourceTokens: true })
const customTags: import('lightning-yaml/yaml').Tags = []
const native = new yaml.Document(new yaml.Scalar('value'), { schema: 'core' })
const composed = [...new yaml.Composer().compose(new yaml.Parser().parse('value'), true, 5)][0]!
const node: import('lightning-yaml/yaml').Node | null = document.contents
if (yaml.isDocument(document)) document.clone().toJS()
native.toJS()
composed.toJS()
new yaml.Schema({ schema: 'core' }).clone()
new yaml.Schema({ schema: 'core', customTags })
try {
  yaml.parse('value: [1,')
} catch (error) {
  if (error instanceof yaml.YAMLParseError) {
    const code: import('lightning-yaml/yaml').ErrorCode = error.code
    const pos: [number, number] = error.pos
    const linePos: [import('lightning-yaml/yaml').LinePos] | [import('lightning-yaml/yaml').LinePos, import('lightning-yaml/yaml').LinePos] | undefined = error.linePos
    const sourceError: import('lightning-yaml/yaml').YAMLError = error
    void code
    void pos
    void linePos
    void sourceError
  }
}
const constructedError = new yaml.YAMLParseError([2, 3], 'MISSING_CHAR', 'message')
void constructedError.pos
void node

// @ts-expect-error Source options must be an object with supported option types.
yaml.parseDocument('x', { keepSourceTokens: 'yes' })
