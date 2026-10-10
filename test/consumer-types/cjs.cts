import yaml = require('lightning-yaml');
import yamlCompat = require('lightning-yaml/yaml');
import jsYaml = require('lightning-yaml/js-yaml');

const parsed: unknown = yaml.parse('a: 1', { strict: false });
const docs: unknown[] = yaml.parseAll('---\na: 1');
const out: string = yaml.stringify(parsed);
const loaded: unknown = jsYaml.load('a: 1', { json: true });
const all: unknown[] | undefined = jsYaml.loadAll('---\na: 1', doc => { void doc; });
const compatResult: unknown = yamlCompat.parse('a: 1', null, {});
const error: yaml.YAMLParseError = new yaml.YAMLParseError('message');

// @ts-expect-error core options reject unsupported keys
yaml.parse('a: 1', { schema: 'core' });
// @ts-expect-error callback requires a document argument
jsYaml.loadAll('---\na: 1', 4);
// @ts-expect-error core stringify's only argument is the value
yaml.stringify(parsed, { indent: 4 });

void [docs, out, loaded, all, compatResult, error];
