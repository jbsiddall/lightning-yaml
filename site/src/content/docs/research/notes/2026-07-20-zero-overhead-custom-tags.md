---
title: "Zero-overhead custom tags: extending the type system without taxing the JSON path"
description: "A design for letting users register custom YAML tags (e.g. !!timestamp, !user) for both parse and dump while keeping the default hot path byte-for-byte unchanged."
---

**Verdict — worth pursuing for explicit tags; situational for implicit auto-detection.** We can let users register custom types for both directions (`!!timestamp 2020-01-01T00:00:00Z` → a `Date`, a `User` instance → `!user {…}`) with **zero measurable cost for the majority who never register one**, because the parser already routes every non-JSON type through cold, out-of-line paths. The one place a custom type can touch the hot path — *implicit* typing of bare, untagged scalars — is genuinely optional and can stay default-off. This is a design analysis grounded in the current code, not a measured experiment; the numbers claim ("no default-path regression") is the implementation's proof obligation, not something demonstrated here.

## Background — why this is tractable

lightning-yaml already round-trips three types that JSON has no notion of: a `!!binary` scalar becomes a `Uint8Array`, `!!set` becomes a `Set`, and `!!omap` becomes an insertion-ordered `Map`. Each of those is, in effect, a *built-in custom type* — and crucially, each is handled entirely off the hot path. Untagged plain scalars (the overwhelming majority of nodes in JSON-shaped and config YAML, which is the workload this library optimizes for) are typed by the plain-scalar resolver's first-character `switch` and never so much as glance at the tag machinery. Adding user-defined types is therefore not a new mechanism but a generalization of an existing, proven one: make the tag registry extensible instead of hard-coded.

The guiding principle is the repo's own "pay on first use" rule — a feature that a given parse or dump doesn't exercise should cost that call nothing. The whole design below hangs on a single idea: the custom-type registry is **absent (`null`) by default**, and every site that could consult it is guarded by one predicted-false branch.

## The three surfaces

Custom-type support is not one feature but three, and they have very different performance profiles. It is worth keeping them separate, because the first two are effectively free and the third is the only one that carries a caveat.

### 1. Explicit tags on parse — free for everyone

When the parser meets a plain scalar with no tag, it types it through the plain-scalar resolver and is done; it never reaches tag code. Only an actual `!`/`!!` on a node routes into the scalar-tag and collection-tag appliers. Those two functions are already `switch` statements over the known core tags, and both already **fall through to a passthrough default** for any tag they don't recognize — today an unknown tag simply keeps its raw string (for a scalar) or its built shape (for a collection).

A custom registry slots directly into that existing default arm:

```ts
// scalar-tag applier, unknown-tag default (today: `return raw`)
if (customTags !== null) {
  const handler = customTags.scalar.get(tag);
  if (handler) return handler.resolve(raw);
}
return raw; // unchanged fallback: unknown tag ⇒ raw text
```

For a parse that registers no custom tags, `customTags` is `null`: one branch, on a path that only runs for already-tagged nodes. For the untagged-scalar hot path there is no change at all — not even a branch. This is the surface that covers the common ask (`!!timestamp`, a domain type like `!user`) and it is genuinely zero-overhead for non-users.

### 2. Dump — free for the JSON-shaped majority

The dumper fast-pathes primitives, arrays, and plain objects, and already carries a cold "exotic object" branch for the non-JSON types (`Uint8Array`, and the `Map`/`Set` shapes). A custom dumper matches a value by **constructor identity** — a `Map<constructor, dumper>` lookup keyed on `value.constructor` — consulted only inside that already-cold exotic-object branch and only when a registry is present. Plain objects, arrays, strings, numbers, booleans and `null` — the entire JSON-shaped surface that this library measures itself against `JSON.stringify` on — never enter it.

Matching by constructor (not by a user predicate run against every value) is what keeps this honest: a `Date`, or a `User` class instance, is recognized in O(1) without touching the plain-object path. `Date → !!timestamp` and `User → !user` are exactly this shape.

The one non-invisible consequence is an **API addition**: the public `stringify` currently takes a value and nothing else, so it needs an optional second options parameter. That is additive and backward-compatible — every existing call keeps its exact behavior — but it is a real surface-area change, unlike surface 1, which reuses the parse options object that already exists.

### 3. Implicit auto-detection on parse — the only real cost, and it's opt-in

This is the surface that can touch the hot path: making a *bare, untagged* `2020-01-01T00:00:00Z` resolve to a `Date` with no tag present means every plain scalar must be offered to the custom resolvers. Two design choices contain it:

- **Default off, gated on a present registry.** The check lives at the *string fall-through* of the plain-scalar resolver — the point reached only after core typing (number/bool/null) has already failed — so numbers, booleans and nulls never pay, and a parse that hasn't opted in pays a single branch.
- **First-character bucketing when enabled.** Index the implicit resolvers by the first character they can match, so a scalar whose first character no custom type claims exits in about one lookup. This is precisely the `implicitScalarByFirstChar` structure js-yaml adopted in v5 <!-- js-yaml:5.2.1 ly:1821952 --> and that lightning-yaml already applies, in hard-coded form, to core typing.

Even with both, an *enabled* implicit path adds work to every string scalar, so it should be reserved for callers who explicitly want it. Callers who only want explicit `!!timestamp` leave it off and pay nothing. There is also a spec dimension: timestamp is **not** part of the YAML 1.2 core schema, and lightning-yaml deliberately does not resolve it implicitly. Explicit `!!timestamp` is therefore spec-clean; implicit auto-typing is an extension *beyond* core and should be documented and flagged as such rather than turned on by default.

## Suggested shape

A single registry, passed through the options both directions, everything else optional:

```ts
interface CustomTag<T> {
  tag: string;                         // "tag:yaml.org,2002:timestamp" or a local "!user"
  kind: "scalar" | "map" | "seq";
  resolve(content): T;                 // parse: build the value (cold tag path)
  identify?: Function;                 // dump: constructor to match (e.g. Date, User)
  stringify?(value: T): string;        // dump: emit the content
  implicit?: { firstChars: string; test(raw: string): boolean };  // opt-in only (surface 3)
}

parse(text,      { customTags: [...] })
stringify(value, { customTags: [...] })
```

The registry compiles once per call into two lookups — a `Map<tagName, handler>` for parse and a `Map<constructor, handler>` for dump — plus, only if any `implicit` is present, a first-character bucket map. All three are built only when `customTags` is supplied; otherwise the internal registry is `null` and every guard short-circuits.

## Performance analysis

The claim is not "custom types are cheap" — it is "**the default path is unchanged.**" That distinction is what makes the feature safe to add to a library whose entire point is JSON-parity throughput and memory:

- **Untagged-scalar parse** (the hot path): unchanged. The registry is consulted only after a tag is seen (surfaces 1) or, for surface 3, at the string fall-through behind a `!== null` guard.
- **Plain-object / array / primitive dump** (the hot path): unchanged. The constructor lookup lives in the exotic-object branch that JSON-shaped values never reach.
- **Registered-but-unused-on-this-node**: one `Map` lookup per tagged node (parse) or per exotic-object node (dump) — already-cold sites.

The implementation's job is to demonstrate the first two bullets empirically: a `bench:self` run must show the default parse and dump numbers holding, and the feature's own paths must be exercised only by fixtures that use them.

## Risks and open questions

- **Unknown-tag default must not change.** Today an unrecognized tag passes through (raw string / unreshaped collection). Introducing a registry must not turn a *missing* custom handler into an error; the passthrough remains the default when nothing matches.
- **Dump matching by constructor, not predicate.** A predicate run against every value would tax the hot path; constructor-keyed matching is the constraint that keeps dump free. Values the user wants tagged must therefore be distinguishable by constructor (a class instance or a boxed type), not an arbitrary plain object.
- **Collision with core tags.** A custom registration for a core tag (`!!int`, `!!binary`, …) should either be rejected or clearly defined as an override; leaving it ambiguous invites silent surprises.
- **Conformance.** The yaml-test-suite pass rate must not move — custom tags are additive and off by default, so a green suite with the registry absent is the baseline to hold.

## Verification plan (for whoever implements)

1. Round-trip tests for at least one scalar custom type (`Date ⇄ !!timestamp`) and one collection custom type (a class ⇄ `!user {…}`), parse and dump.
2. A `bench:self` run with **no** registry showing the default speed/memory unchanged (the core claim).
3. The conformance suite unchanged with the registry absent.
4. If surface 3 is built: a benchmark of the implicit path *enabled* vs *disabled*, so the opt-in cost is stated honestly rather than hidden.

## Code references

Concept → location (as of the commit in the footer):

- Plain-scalar hot path (first-char `switch`; where surface 3 would gate): `resolvePlain` — `src/index.ts:2096`
- Explicit scalar-tag applier (surface 1 plug-in; passthrough default): `applyScalarTag` — `src/index.ts:1039`
- Explicit collection-tag applier: `applyCollectionTag` — `src/index.ts:1074`
- Core tag-name constants: `src/index.ts:877`
- Parse options (existing extension point): `ParseOptions` — `src/index.ts:539`; `parse` — `src/index.ts:568`
- Dumper entry (needs an options parameter): `stringify` — `src/index.ts:646`
- Per-node dump dispatch + exotic-object branch (surface 2 plug-in): `writeDocumentValue` — `src/index.ts:4906`; `writeScalar` — `src/index.ts:4757`

## Provenance & sources

- Repo: `jbsiddall/lightning-yaml`, branch `claude/js-yaml-parse-optimization-lgp1uf`, based on `main` at `1821952`.
- This is a **design note**, not a measured experiment — it carries no benchmark numbers; the performance claims are the implementation's proof obligation (see the verification plan).
- js-yaml first-character index reference: js-yaml 5.2.1 (`implicitScalarByFirstChar`), documented in `2026-07-12-js-yaml-internals.md` (Update section).
- The "pay on first use" principle is the repo's own, drawn from the same js-yaml internals note.
