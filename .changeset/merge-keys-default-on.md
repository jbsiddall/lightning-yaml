---
"lightning-yaml": minor
---

`parse` and `parseAll` now resolve `<<` merge keys by default, splicing a referenced mapping's keys into the current one instead of keeping `<<` as a literal key:

```ts
const source = `
defaults: &d
  adapter: postgres
  host: localhost
development:
  <<: *d
  database: dev_db
`;

parse(source).development;
// before: { "<<": { adapter: "postgres", host: "localhost" }, database: "dev_db" }
// now:    { adapter: "postgres", host: "localhost", database: "dev_db" }
```

A mapping's own keys always win over a merged one, whether written before or after the `<<` line, and a merge source must be a mapping (or a list of mappings) — anything else throws, including a merge chain deep enough to look like a resource-exhaustion attack. This is a deliberate change from both `js-yaml` and `yaml`, which each require an explicit opt-in and leave `<<` unmerged otherwise ([`tag:yaml.org,2002:merge`](https://yaml.org/type/merge.html) is a YAML 1.1 construct outside the 1.2 core schema this library otherwise targets, but real-world YAML depends on it often enough to be worth defaulting on). Pass `{ merge: false }` to get the old, literal-key reading back.

The `lightning-yaml/yaml` and `lightning-yaml/js-yaml` drop-in replacements are unaffected by default — they keep merging off, matching the real libraries they stand in for. `lightning-yaml/yaml` accepts `{ merge: true }` to opt in, same as real `yaml`; `lightning-yaml/js-yaml` has no merge option, matching the fact that real js-yaml's only opt-in is a full 1.1-schema switch this library doesn't otherwise support.
