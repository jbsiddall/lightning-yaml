import { NotImplementedError, YAMLParseError, parse, parseAll, stringify } from 'lightning-yaml';
import type { ParseOptions, ParseOptimizations } from 'lightning-yaml';
import { parse as yamlParse, parseAllDocuments, parseDocument, stringify as yamlStringify } from 'lightning-yaml/yaml';
import type { Reviver } from 'lightning-yaml/yaml';
import { CORE_SCHEMA, YAMLException, dump, load, loadAll } from 'lightning-yaml/js-yaml';
import type { DumpOptions, LoadOptions } from 'lightning-yaml/js-yaml';

const options: ParseOptions = { strict: true, optimizations: { internStrings: true, keyCacheMaxKb: 0.5 } };
const optimizations: ParseOptimizations = { internStrings: false, keyCacheMaxKb: Number.NaN };
const value: unknown = parse('a: 1', options);
const documents: unknown[] = parseAll('---\na: 1', { optimizations });
const text: string = stringify(value);
const reviver: Reviver = function (key, node) { return key === 'a' ? node : node; };
yamlParse('a: 1', reviver, { schema: 'core' });
const allDocuments = parseAllDocuments('a: 1');
const document = parseDocument('a: 1');
yamlStringify(value, null, {});
const loadOptions: LoadOptions = { schema: CORE_SCHEMA, json: true };
const dumpOptions: DumpOptions = { schema: CORE_SCHEMA, sortKeys: false };
const loaded: unknown = load('a: 1', loadOptions);
const all: unknown[] | undefined = loadAll('---\na: 1', item => { void item; }, loadOptions);
const dumped: string = dump(loaded, dumpOptions);
const yamlError: YAMLParseError = new YAMLParseError('message');
const compatError: YAMLException = new YAMLException('message');
const notImplemented: NotImplementedError = new NotImplementedError('message');

// @ts-expect-error unknown option names are rejected
parse('a: 1', { strict: true, misspelled: true });
// @ts-expect-error strict is boolean
parse('a: 1', { strict: 'true' });
// @ts-expect-error parseAllDocuments returns wrappers, not arbitrary strings
const badDocs: string[] = parseAllDocuments('a: 1');
// @ts-expect-error unsupported load option names are rejected
load('a: 1', { maxAliass: 3 });
// @ts-expect-error stringify accepts no callback-shaped overload in the core API
stringify(value, () => value);

void [documents, text, allDocuments, document, dumped, yamlError, compatError, notImplemented, badDocs];
