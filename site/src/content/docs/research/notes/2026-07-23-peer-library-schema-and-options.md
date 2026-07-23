---
title: "Peer YAML libraries: how schema and options change typing, compliance, and cost (js-yaml 5.2.1, yaml 2.9.0)"
description: "A source-level survey of the schema, version, and configuration options in js-yaml and yaml — how each knob changes data interpretation, spec compliance, in-memory shape, and parse/dump cost — and what that means for fair benchmarking."
---

> Produced by a research session (Claude Code) against the installed peer libraries. Behavioural
> claims were verified by running the installed builds; the perf figures were measured on the session
> container (Node v22.22.2) — absolute milliseconds are machine-specific, ratios are the durable
> signal. Both libraries are treated as neutral peers; where the YAML 1.2.2 spec is invoked, the spec
> adjudicates, not any implementation.

## Abstract

**Verdict: reference note** — a survey of the two peer JS YAML libraries' configuration surfaces, not
an optimization to adopt or reject. Two practical questions motivate it:

1. **Are we benchmarking the peer libraries fairly?** If an option materially changes parse/dump cost,
   then the config we hand each library decides the numbers — so we need to know which knobs move the
   needle and pick, for each library, the configuration a real performance-aware user would run on the
   same data (held to the same rules for every library).
2. **What does "matches the peer library" actually prove about compliance?** Both libraries' *typing*
   is schema-dependent, and their defaults differ from each other and from the YAML 1.2.2 spec in
   specific, enumerable ways. Knowing exactly where each default is spec-faithful and where it is not
   tells us when agreement with a peer is evidence of correctness and when it is a coincidence of
   configuration.

**Headline findings:**

- **Both libraries default to a YAML-1.2-*core* interpretation, not 1.1.** <!-- js-yaml:5.2.1 yaml:2.9.0 -->
  `js-yaml@5.2.1` loads with `CORE_SCHEMA` by default (a change from the 1.1-flavoured default of
  js-yaml 4.x), and `yaml@2.9.0` parses as `schema: 'core'`, `version: '1.2'` by default. Under both
  defaults `yes` is the string `"yes"`, `2001-12-15T02:59:43Z` is a string, and a bare `<<` does **not**
  merge.
- **The `schema` option is the same idea in both libraries: a registry of tags** that decides how each
  plain scalar is typed and which explicit tags (`!!binary`, `!!omap`, `!!set`, `!!timestamp`, `!!merge`)
  resolve. `failsafe` → everything is a string; `json`/`core` → JSON/1.2-core scalar typing; `yaml-1.1`
  (js-yaml `YAML11_SCHEMA`) → the legacy 1.1 type set plus the binary/timestamp/omap/set/merge tags.
- **`js-yaml@5.2.1` is a bundled rewrite whose API differs from the widely-documented 4.x line** — no
  `DEFAULT_SCHEMA` export, several removed/renamed options, and the `json` load option now controls
  *only* duplicate-key handling. Ecosystem knowledge of "js-yaml" that predates v5 needs re-checking
  against the installed build; this note does that.
- **Schema choice moves *typing* a lot but *parse speed* only modestly; it moves *dump* speed more.**
  (Measured section below.) The bigger perf levers are the non-schema guards that are **on by default**
  in `yaml` — duplicate-key detection and pretty-error line tracking — which a benchmark should account
  for consciously rather than by accident.

## Why option choice is a benchmark-integrity question

The repo's benchmark-integrity rule is to hold every library to the same rules and never tune the
methodology to flatter one. That rule and the goal of "show each library at its best" are the *same*
goal once stated precisely: run each library in the configuration its own users would choose for that
class of data, producing equivalent output, and document it. Giving a peer library a needlessly heavy
schema it wouldn't use for JSON-shaped data would understate it just as much as disabling a guard a
typical user keeps on would overstate it. So the fair procedure is:

- pick, per data class, the lightest configuration that still produces the correct/equivalent value;
- keep that choice equal across libraries wherever they share a knob (e.g. an alias cap);
- and write down the choice so a reader can see it.

The sections below give the facts needed to apply that procedure, then measure how much each knob
actually costs.

## What a "schema" is in both libraries

In both libraries a *schema* is a set of **tags**. A tag pairs a YAML type (`tag:yaml.org,2002:int`,
`…:bool`, `…:binary`, …) with (a) an *implicit resolver* — a test that decides whether an untagged
plain scalar like `010` or `yes` is that type — and (b) constructors that turn the source text into an
in-memory value and back. Choosing a schema chooses which resolvers run, and therefore how the same
untagged document is typed. It is not a "strictness dial" in the abstract; it is a concrete tag list.

The built-in schemas nest the same way in both libraries: `failsafe` (strings + the two collection
types) ⊂ `json`/`core` (adds scalar typing) ⊂ the 1.1 set (adds the legacy scalar grammar and the
`binary`/`timestamp`/`omap`/`pairs`/`set`/`merge` tags).

## js-yaml 5.2.1

> **Read this first.** The installed `js-yaml` is **5.2.1**, a Rollup-bundled rewrite shipping a single
> `dist/js-yaml.mjs`. <!-- js-yaml:5.2.1 --> Several things the ecosystem "knows" from js-yaml 3/4 are
> no longer true: the default load schema changed, `DEFAULT_SCHEMA`/`safeLoad`/`safeDump` are gone, and
> a number of dump options were removed or renamed. Every claim here was checked against this build.

### Schemas and how a plain scalar types

js-yaml 5 exports four schemas — `FAILSAFE_SCHEMA`, `JSON_SCHEMA`, `CORE_SCHEMA`, `YAML11_SCHEMA` — built
by list-composition (each is `failsafe` plus more tags). There is **no `DEFAULT_SCHEMA` export**.

The same document types differently under each (all rows verified against the installed build):

| input | FAILSAFE | JSON | **CORE** (default load) | YAML11 |
|---|---|---|---|---|
| `123` | `"123"` | `123` | `123` | `123` |
| `true` | `"true"` | `true` | `true` | `true` |
| `~` | `"~"` | `"~"` | `null` | `null` |
| `010` | `"010"` | `"010"` | `10` (decimal) | `8` (octal) |
| `0o17` | `"0o17"` | `"0o17"` | `15` | `"0o17"` (string) |
| `0b101` | `"0b101"` | `"0b101"` | `"0b101"` (string) | `5` |
| `2001-12-15T02:59:43Z` | string | string | string | `Date` |
| `1:2:3` | string | string | string | `3723` (sexagesimal) |
| `yes` / `no` / `on` / `off` | string | string | string | `true`/`false`/`true`/`false` |
| `.inf` / `.nan` | string | string | `Infinity` / `NaN` | `Infinity` / `NaN` |
| `1_000` | string | string | `"1_000"` (string) | `1000` |

Two rows are easy to get wrong: `010` is decimal `10` under CORE (1.2) but octal `8` under 1.1, and
`0o17` is `15` under CORE but stays a *string* under 1.1 (the `0o` notation postdates the 1.1 grammar).
FAILSAFE turns every plain scalar into a string — the two collection tags and `!!str` are all it has.

### Defaults: strict in, permissive out

| operation | default schema | consequence |
|---|---|---|
| `load` / `loadAll` | **`CORE_SCHEMA`** (≈ YAML 1.2 core) | `yes` → `"yes"`, timestamps → strings, `<<` → literal key |
| `dump` | a **`YAML11_SCHEMA`-derived** schema | can serialize `Date`/`Uint8Array`/`Set`, emits `!!binary`/`!!set`, and defensively quotes 1.1 words like `'yes'` |

This asymmetry is deliberate: the load default is conservative (1.2-core typing) while the dump default
is maximally representable and re-read-safe under any schema. A practical corollary: a value dumped with
the default schema and re-loaded with the default schema does **not** always round-trip to an
equal-typed value unless the two schemas are aligned. The v4 → v5 change of the *load* default (from a
1.1-flavoured schema to CORE) is the single most behaviour-visible difference from older js-yaml.

### Merge keys

The `!!merge` tag lives **only in `YAML11_SCHEMA`**; `CORE_SCHEMA` omits it by design. So under the
default load a `<<` key is an ordinary string key and is not merged:

```yaml
base: &b { a: 1, b: 2 }
merged: { <<: *b, b: 99 }
```

- default / CORE load → `merged` is `{ "<<": {a:1,b:2}, b: 99 }` (literal `<<`, no merge)
- `YAML11_SCHEMA` (or `CORE_SCHEMA.withTags(mergeTag)`) → `merged` is `{ a: 1, b: 99 }`

Precedence when merge is active: an explicit key always wins over a merged one regardless of source
order, and among multiple merge sources (`<<: [*a, *b]`) the earliest alias wins. A `maxTotalMergeKeys`
guard (default `10000`, `-1` disables) caps total keys processed through merge in one call — an
anti-merge-bomb limit.

### In-memory representation

| YAML | js-yaml value | notes |
|---|---|---|
| mapping | plain `Object` (`Object.prototype`) | non-string keys are `String()`-coerced (`1: x` → `{"1":"x"}`); complex keys (`? [1,2] :`) **throw** unless the opt-in `realMapTag` (→ `Map`) is used; `__proto__` is set prototype-pollution-safely |
| sequence | `Array` | |
| `!!binary` | **`Uint8Array`** | not a Node `Buffer`; YAML11 only |
| `!!timestamp` | `Date` | YAML11 only |
| `!!omap` | `Array` of single-key objects | |
| `!!set` | `Set` | |
| `!!pairs` | `Array` of `[k,v]` pairs (duplicates allowed) | |
| large int | `number` (lossy) | no BigInt option; `12345678901234567890` → `12345678901234567000` |

**Duplicate mapping keys** default to a **throw** (`duplicated mapping key`). The `json: true` load
option switches this to last-wins — and, notably in v5, that duplicate-key behaviour is the option's
*only* effect. Despite the name, `json: true` does **not** select `JSON_SCHEMA`; typing is chosen
separately via `schema:`.

### Load options (v5)

| option | default | effect |
|---|---|---|
| `schema` | `CORE_SCHEMA` | tag set → scalar typing and which explicit tags resolve |
| `json` | `false` | `true` = duplicate keys override (last-wins) instead of throwing; **only** affects dup-keys |
| `filename` | `""` | label in error messages |
| `maxDepth` | `100` | max collection nesting before throwing (does not count aliases) |
| `maxTotalMergeKeys` | `10000` | cap on keys processed via `<<`; `-1` disables |
| `maxAliases` | `-1` (unlimited) | cap on alias nodes per document; `0` rejects all aliases |

The v4 load options `onWarning`, `listener`, and `version` are **gone** in v5 (silently ignored if
passed).

### Dump options (v5)

Semantic knobs (change what is representable or the output's meaning):

| option | default | effect |
|---|---|---|
| `schema` | YAML11-derived | which JS values are representable and which plain scalars get compat-quoted; under a `CORE`/`JSON` dump schema, `Date`/`Uint8Array`/`Set` **throw** |
| `skipInvalid` | `false` | drop unrepresentable entries instead of throwing |
| `noRefs` | `false` | `false` = shared objects become `&ref`/`*ref` anchors and cycles are handled; `true` = inline duplicates and **stack-overflow on cyclic input** |
| `transform` | — | AST hook to mutate documents before rendering (the v5 replacement for `replacer`) |

Formatting knobs (no change to meaning): `indent`, `flowLevel`, `sortKeys`, `lineWidth`, `forceQuotes`,
`quoteStyle` (was `quotingType`), `seqNoIndent` (was `noArrayIndent`), the `flow*` padding/skip family
(was `condenseFlow`), and a few others.

**Compat-quoting replaces v4's `noCompatMode`.** There is no boolean toggle any more: the presenter
quotes a plain string exactly when, under the *dump schema's* resolvers, it would re-read as a
non-string. So `dump('yes')` is `'yes'` under the default (YAML11-derived) schema, but bare `yes` under
`CORE_SCHEMA`/`JSON_SCHEMA`. To stop 1.1-style defensive quoting you dump with a lighter schema; that is
exactly what makes a lighter dump schema both faster and cleaner-looking on JSON-shaped data.

### Where js-yaml's defaults diverge from YAML 1.2.2

The implicit (untagged) CORE number typing in this build looks 1.2-core-aligned (`010`→`10`, `0o17`→`15`).
The divergence that does surface is on **explicit** tags under CORE: `!!int 0b101` → `5` and signed
`!!int -0x1F` → `-31`, even though 1.2 core defines neither binary nor signed-radix `!!int`. Under
YAML11, the 1.1 boolean set meeting an object-keyed map is a well-known footgun: `{ y: 1 }` types the
key `y` as `true`, which the object map stringifies, yielding `{ "true": 1 }`.

## yaml (eemeli/yaml) 2.9.0

`yaml` is this repo's differential oracle and is generally the most spec-faithful JS implementation. Its
typing is chosen by two interacting options — `schema` and `version` — plus a `merge` flag.

### How schema and version wire together

`Document.setSchema(version, options)` maps the version to a base schema, then lets explicit options
win:

- `version: '1.1'` → base schema `yaml-1.1`, `resolveKnownTags: false`
- `version: '1.2'` (default) or `'next'` → base schema `core`, `resolveKnownTags: true`

The **default document config** is `schema: 'core'`, `version: '1.2'`, `merge: false`,
`mapAsMap: false`, `maxAliasCount: 100`, `uniqueKeys: true`, `strict: true`, `prettyErrors: true`,
`intAsBigInt: false`, `keepSourceTokens: false`.

### Schemas and typing

Accepted `schema` names: `'failsafe'`, `'core'`, `'json'`, `'yaml-1.1'`.

| schema | implicit plain-scalar typing |
|---|---|
| **failsafe** | everything is a string |
| **json** | JSON scalar grammar; **any unquoted scalar that matches no JSON rule is a hard parse error** (`Unresolved plain scalar`) — realistically only for JSON-shaped input |
| **core** (default) | `null`/`bool`/decimal+`0o`+`0x` int/float/`.inf`/`.nan`; timestamps stay strings unless explicitly `!!timestamp`-tagged |
| **yaml-1.1** | 1.1 scalar grammar (`yes/on` booleans, leading-zero octal, `0b` binary, `_` separators, sexagesimal) **plus** the `binary`/`merge`/`omap`/`pairs`/`set`/`timestamp` tags baked in; timestamps resolve implicitly → `Date` |

`version: '1.1'` and `schema: 'yaml-1.1'` are equivalent for typing (verified identical). The
differences are that `version` also sets the document's `%YAML` metadata and the `resolveKnownTags`
flag, and that a `%YAML` directive in the source overrides `version` but not `schema`. `version: 'next'`
is accepted and currently behaves like 1.2/core — it exists so a directive naming a future version
doesn't error.

### Merge keys

`merge` defaults to off under 1.2 and is effectively on under 1.1, and the mechanism is **asymmetric**:
the merge tag is a hard member of the 1.1 tag array and absent from core, and the option only ever
*adds* it. So `merge: true` turns `<<` on under core/1.2, but `merge: false` does **not** turn it off
under `version: '1.1'`/`schema: 'yaml-1.1'`. Resolution semantics match js-yaml's: existing host keys
win over merged-in keys, and within a `<<` sequence earlier entries override later ones. Merge sources
must be maps or map aliases or it throws.

### In-memory representation

| YAML | `yaml` value (default) | option |
|---|---|---|
| mapping | plain `Object` | `mapAsMap: true` → `Map` (preserves non-string keys) |
| `!!binary` | **Node `Buffer`** (a `Uint8Array` subclass) | in a browser, a plain `Uint8Array`; the repo's oracle overrides this to `Uint8Array` for portability |
| `!!omap` | `Map` | |
| `!!set` | `Set` | |
| `!!pairs` | array of `[k,v]` | |
| `!!timestamp` | `Date` | |
| large int | `Number` | `intAsBigInt: true` → `bigint` (exact) |

A structural note distinguishing `yaml` from js-yaml: `parse()` is `parseDocument().toJS()`. The
`Document` is a lossless node tree (`YAMLMap`/`YAMLSeq`/`Scalar`/`Alias`/`Pair`, with ranges, comments,
anchors) in which aliases and merges are **not** expanded; `toJS()` is the eager step that resolves
aliases, applies merges, enforces `maxAliasCount`, and materializes plain JS. That two-stage design is
inherent overhead versus a straight-to-JS parser, and is the fair thing to note when comparing raw
`parse` throughput.

### Duplicate keys, strictness, error tolerance

- **`uniqueKeys`** (default `true`): duplicate keys are a parse error; `false` = last-wins. The check is
  an O(n²) per-key scan, so it is a real cost on large mappings.
- **`strict`** (default `true`): toggles a set of unambiguous-but-spec-required errors — e.g. a comment
  glued to a scalar with no separating space (`a: "x"#c`) errors under `strict:true` and is accepted
  under `strict:false`. It does not relax genuine structural errors.
- **Error tolerance:** the lexer/parser are designed not to throw; `parseDocument`/`parseAllDocuments`
  collect problems on `doc.errors`/`doc.warnings`, and only the convenience `parse()` rethrows the first
  error. Unresolvable tags become a warning and fall back to the string value.
- **`prettyErrors`** (default `true`): builds a `LineCounter` fed every newline so errors carry
  line/col — pure overhead on clean input relative to `prettyErrors:false`.

### Where yaml's default diverges from YAML 1.2.2

`yaml`'s default config **accepts an implicit flow-collection key** — `{[1, 2]: v}` parses with zero
errors and zero warnings — which the 1.2.2 spec rejects (yaml-test-suite SBG9/X38W). lightning-yaml
rejects it deliberately (see the README deviations registry), so *agreeing* with `yaml` on such a
construct is not on its own evidence of correctness — the spec adjudicates. This is precisely why the
oracle is a differential *aid*, not the definition of correct.

### Parse / stringify options (selected)

Parse-side: `intAsBigInt`, `keepSourceTokens`, `strict`, `stringKeys` (all keys parsed as strings;
non-scalar keys error), `uniqueKeys`, `version`; and `toJS`-side `mapAsMap`, `maxAliasCount`, `reviver`,
`onAnchor`. Schema-side: `customTags`, `merge`, `resolveKnownTags` (allow *explicit* 1.1 tags under
core/json — the reason `!!omap`/`!!binary` still resolve under the default core schema), `sortMapEntries`,
`compat`.

Stringify-side splits into node-creation options (`aliasDuplicateObjects` — reuse anchors for shared
objects; turning it off duplicates data and can loop on cycles) and formatting options (`indent`,
`lineWidth`, `singleQuote`, `blockQuote`, `collectionStyle`, `flowCollectionPadding`, …). A few
formatting knobs are silently **semantic**: `trueStr: 'yes'` under the core schema emits `b: yes`, which
re-parses under core as the *string* `"yes"` — a lossy round-trip — whereas `nullStr: '~'` is safe.

## Side-by-side: the same document, both libraries

Under each library's **default** config (js-yaml `CORE_SCHEMA` load; yaml `core`/`1.2`), the two agree
closely on JSON-shaped and 1.2-core data:

| input | js-yaml default | yaml default | agree? |
|---|---|---|---|
| `123`, `1.5`, `true`, `null` | number/number/bool/null | number/number/bool/null | yes |
| `yes` | `"yes"` | `"yes"` | yes |
| `0o17` | `15` | `15` | yes |
| `2001-12-15T02:59:43Z` | string | string | yes |
| `<< ` merge | literal key (no merge) | literal key (no merge) | yes |
| `{ [1,2]: v }` | throws (complex key) | **accepts** (spec-divergent) | no |
| duplicate keys | **throws** | **errors** (`uniqueKeys`) | yes (both reject) |

Switch either library into its 1.1 mode (js-yaml `YAML11_SCHEMA`, yaml `version:'1.1'`) and they again
track each other: `yes`→bool, `010`→octal, timestamps→`Date`, `<<`→merge, `!!binary` present. The
material default difference between the two is only at the edges the spec itself contests
(`{[1,2]: v}`) and in the in-memory *type* of `!!binary` (js-yaml `Uint8Array` vs yaml `Buffer`).

## Does option choice move CPU and memory?

Measured on the session container (Node v22.22.2, 4-vCPU Linux VM, machine quiet), each
`(library, op, config)` in its own fresh `node` process so nothing co-runs. CPU figures are the
**minimum** of 11 timed reps after warm-up (the min is the stable figure; medians drift run-to-run);
memory is the retained heap-delta of the returned value (forced-GC `heapUsed` delta). Ratios are the
durable signal. As a reference point on the 1.8 MB JSON-shaped fixture: `JSON.parse` ≈ 5.5 ms,
`JSON.stringify` ≈ 10.2 ms; js-yaml `load` ≈ 100 ms (~18× `JSON.parse`); yaml `parse` ≈ 1050 ms
(~190× `JSON.parse`). **Every config knob below moves things by a few percent to tens of percent —
small next to the library-to-library gap.** That is the central fairness finding: schema choice does
not decide who wins.

### Schema barely moves parse — with one exception

js-yaml `load`, min ms, ratio vs its default (CORE):

| schema | plain (1.8 MB) | rich (timestamps + `yes/no`) |
|---|--:|--:|
| default (= CORE) | 102 (1.00) | 27.4 (1.00) |
| FAILSAFE | 95 (0.93) | 25.8 (0.94) |
| JSON | 101 (0.99) | 26.0 (0.95) |
| YAML11 | 102 (0.99) | **34.1 (1.25)** |
| `json: true` | 97 (0.94) | 25.4 (0.93) |

On JSON-shaped data the spread is ≈ ±6 % — the harness's "schema barely moves parse" note is accurate.
The one real exception is **`YAML11_SCHEMA` on timestamp/`yes-no`-heavy data (~1.25–1.4× slower)**: it
runs the extra 1.1 resolvers (timestamp regexes, the long boolean list) and builds `Date`/boolean values
where CORE keeps strings. yaml's `parse` shows a smaller schema effect on *both* shapes (≈ ±5–8 %, its
`yaml-1.1` only ~5 % over core even on rich data) because it builds a full node tree regardless of
schema, so resolver work is a small slice of a large fixed cost. yaml's `json` schema is not a speed
lever at all — it **throws** `Unresolved plain scalar` on any unquoted plain string, so it can't parse
ordinary block YAML.

### Schema moves js-yaml *dump* ~1.35× — and one "3× faster" row is a mirage

js-yaml `dump` of the plain value, min ms:

| config | min ms | vs default |
|---|--:|--:|
| default (= 1.1-derived schema) | 150.6 | 1.00 |
| `{schema: CORE_SCHEMA}` | 110.9 | **0.74 (default is 1.36× slower)** |
| `{schema: JSON_SCHEMA}` | 114.0 | 0.76 |
| `{noRefs: true}` | 142.8 | 0.95 |
| `{sortKeys: true}` | 162.1 | 1.08 |
| `{schema: FAILSAFE_SCHEMA, skipInvalid}` | 53.3 | 0.35 — **disqualified, see below** |

This is the note's one clear config-driven bar-mover. js-yaml v5's **dump default is a 1.1-derived
schema**, so every scalar is checked against the larger 1.1 type set; `CORE` (or `JSON`) has fewer
representers and is ~1.35× faster while round-tripping identically on 1.2 data. Two rows deserve care:

- **`noRefs: true` is only ~5 % on dump, not a step change**, and it is a *serialization* option with no
  parse equivalent — it merely skips the pass that detects shared object references. Our JSON-shaped data
  has no shared refs, so the default already emits no anchors and there is almost nothing to skip. On data
  that *does* share objects it is *more* work (it re-walks the duplicated subtrees) and it stack-overflows
  on cyclic input.
- **The `FAILSAFE` "3× faster" dump is not a real win.** FAILSAFE has no number/boolean representer, so
  it only completes with `skipInvalid`, which **silently drops every number and boolean field** — it emits
  a smaller, non-equivalent document. It must never be used as a comparison row.

yaml `stringify` has no schema lever (its default already is core, so `schema:'core'` is a no-op); its
only option that moves cost is `sortMapEntries: true` at +17 % (and it reorders output).

### The bigger levers are non-schema guards, and they are on by default in yaml

Retained heap (heap-delta of the returned value) and CPU, vs each library's default:

| library | option | effect |
|---|---|---|
| yaml | `mapAsMap: true` | **heap ×2.6**, CPU +8 % — a JS `Map` per node instead of a plain object; the single biggest mover measured |
| yaml | `intAsBigInt: true` | heap +17 %, CPU +2–5 % |
| yaml | `prettyErrors: false` | **~5 % faster parse, free** — the default installs a `LineCounter` fed on every newline even when there are no errors; turning it off only removes error line/col reporting |
| yaml | `keepSourceTokens: true` | ~3 % CPU; **no** retained-heap cost through `parse()` (the token-bearing `Document` is discarded) |
| yaml | `uniqueKeys: false` | within noise on this input (the check is cheap here) |
| js-yaml | `json: true` | within noise on parse (the dup-key check is not a measurable cost here) |

Interestingly, switching either library to **FAILSAFE increases retained heap ~1.33×** (strings are
retained instead of being parsed into compact numbers), so the "everything is a string" schema is
cheaper on CPU but *heavier* in memory.

### Alias and merge limits are a safety knob, not a fairness lever

On an alias/merge-heavy fixture, **both libraries refuse the document by default** — yaml throws
`Excessive alias count` (`maxAliasCount: 100`) and js-yaml under YAML11 throws
`merge keys exceeded maxTotalMergeKeys (10000)`. Parsing such input at all requires raising a limit on
*each* library. The wall-clock gap between the two on this fixture is ~70× (yaml ~800–1040 ms vs js-yaml
~14–18 ms), dwarfing any option effect — so an alias-heavy fixture must raise the guard equally for every
candidate, and the guard itself is about safety, not speed.

## Implications for our benchmark harness

The harness (`bench/candidates.ts`) already applies the "lightest correct config per data class"
procedure, and these findings support it:

- **js-yaml** is loaded with its **default `CORE_SCHEMA`** on JSON-shaped fixtures and only switched to
  `YAML11_SCHEMA` on the rich fixtures (which use `!!binary`, a 1.1 tag CORE cannot read). That matches
  what a real js-yaml user does — keep the fast default, reach for 1.1 only when the data needs it — and
  it is the same principle applied to every library. The separate `js-yaml (tuned)` dump row (CORE dump
  schema on JSON-shaped data) is the honest counterpart on the stringify side: it shows the speed a
  js-yaml user gets by dumping JSON-shaped data with a schema that doesn't defensively quote or scan for
  1.1 types.
- **yaml** is parsed with `maxAliasCount: -1` (to read the trusted anchor-heavy rich fixtures) and
  otherwise at defaults — which means its default-on guards (`uniqueKeys`, `prettyErrors`) are included
  in its numbers. That is a defensible "what a typical user gets" choice; the measured cost of those
  guards (perf section above) is the input for deciding whether to also report a guards-off row, the way
  the js-yaml tuned row is reported. The key requirement is symmetry: any guard we relax for one library
  we relax for the equivalent guard in another, and we write the choice down.

The one thing to keep watching is that **js-yaml's default load schema is CORE**, so js-yaml must be
handed `YAML11_SCHEMA` for any fixture containing merge keys or 1.1 scalars, or it will silently produce
a different value (literal `<<`, `"yes"` strings) — a correctness divergence, not just a speed one. The
current fixtures avoid that trap because only the rich category needs 1.1, and it already gets YAML11.

## Implications for compliance comparison

- **Agreement is only evidence where the peer agrees with the spec.** Both libraries' defaults diverge
  from 1.2.2 in known places — `yaml` accepts `{[1,2]: v}`; js-yaml under CORE accepts binary/signed
  radix for *explicit* `!!int`. Matching a peer on those inputs is not a compliance win, and differing
  from it is not a bug. The yaml-test-suite (the spec operationalized) is the adjudicator.
- **To compare "most compliant configuration" fairly, name the config.** js-yaml's most 1.2-faithful
  reading is its default `CORE_SCHEMA` (or `JSON_SCHEMA` for strict JSON-only input); yaml's is its
  default `core`/`1.2`. Both are 1.2-core by default, which is the right basis for a 1.2 conformance
  comparison — neither should be evaluated under its 1.1 schema when the question is 1.2 compliance.
- **In-memory contracts differ even when typing agrees.** `!!binary` is a `Uint8Array` in js-yaml and a
  Node `Buffer` in yaml; large integers are lossy `number` in js-yaml but exact `bigint` in yaml with
  `intAsBigInt`. A conformance check that compares parsed values must normalize these (as the repo's
  oracle already does for `!!binary`) or it will report spurious mismatches.

## Code references

- js-yaml 5.2.1 — schema composition and the four exported schemas; scalar resolvers (core/json/1.1);
  merge precedence and `maxTotalMergeKeys`; the `json`-option dup-key path; dump defaults and
  compat-quoting. (Bundled `dist/js-yaml.mjs`; cite by concept — the build has no `lib/` tree.) Full
  detail in the session scratch reference `RESULT_JSYAML.md`.
- yaml 2.9.0 — `Document.setSchema` (version→schema wiring); `schema/tags.js` (schema-name map, merge-tag
  add logic); `schema/yaml-1.1/binary.js` (Buffer default); `compose/util-map-includes.js` (`uniqueKeys`
  O(n²)); `public-api.js` (`prettyErrors`→LineCounter, `parse()` throw semantics); `nodes/toJS.js`
  (bigint keep/down-convert). Full detail in the session scratch reference `RESULT_YAML.md`.

## Provenance & sources

- Libraries inspected: `js-yaml@5.2.1` and `yaml@2.9.0` as installed in this repo. <!-- js-yaml:5.2.1 yaml:2.9.0 ly:d3557e0 -->
- Repo: `lightning-yaml`, branch `claude/jscml-yaml-schema-research-tsycz0`, at commit `d3557e0`.
- Runtime: Node v22.22.2 on the session container (a 4-vCPU cloud VM). Behavioural claims were verified
  by running the installed builds directly; perf figures are median-of-repeats — absolute milliseconds
  are machine-specific, ratios are the durable signal.
- Official option references: js-yaml README (bundled at `node_modules/js-yaml/dist/README.md`) and the
  `yaml` documentation at <https://eemeli.org/yaml/>. The YAML 1.2.2 specification:
  <https://yaml.org/spec/1.2.2/>. Duplicate-key last-wins rationale for lightning-yaml is recorded in the
  README "Decisions and deviations" section and the adversarial-torture-tests research note.
