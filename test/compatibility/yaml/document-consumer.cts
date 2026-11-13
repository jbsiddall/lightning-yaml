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
void node

// @ts-expect-error Source options must be an object with supported option types.
yaml.parseDocument('x', { keepSourceTokens: 'yes' })
