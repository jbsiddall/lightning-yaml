import yaml = require('lightning-yaml/yaml')

const token: import('lightning-yaml/yaml').CSTToken = yaml.CST.createScalarToken('42', { indent: 0 })
const path: import('lightning-yaml/yaml').CST.VisitPath = [['value', 0]]
const visitor: import('lightning-yaml/yaml').CST.Visitor = (_item, _path) => yaml.CST.visit.SKIP
const doc = [...new yaml.Parser().parse('a: 1')][0] as import('lightning-yaml/yaml').CST.Document
yaml.CST.visit(doc, visitor)
yaml.CST.stringify(token)
yaml.CST.visit.itemAtPath(doc, path)

// @ts-expect-error Indentation must be numeric in both declaration conditions.
yaml.CST.createScalarToken('bad', { indent: 'two' })
