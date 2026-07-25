---
"lightning-yaml": minor
---

`stringify` now fails loudly on values YAML can't represent, instead of quietly writing the wrong thing

Serializing a `Map`, `Set`, `Date`, `RegExp`, `Promise` — anything whose contents don't live in ordinary properties — used to emit an empty mapping and throw the data away, with no error:

```js
stringify({ users: new Map([["ada", 1]]) });
// before: "users: {}\n"   ← entries silently gone
// now:    throws: stringify: cannot serialize a Map — parse already reads !!omap
//         back into a Map — stringify just doesn't emit one yet
```

This throw is now unconditional — it no longer matters whether the value happens to carry an extra own property of its own (`Object.assign(new Map(...), { note: "x" })`, a `Map` subclass with a field, …); before, that was enough to slip past the guard and silently serialize just the stray property instead of the real payload, which is the exact same data loss with none of the `{}` tell.

`Map`/`Set` are a narrower case than the rest of this list: YAML *can* represent them (`!!omap`/`!!set`), and lightning-yaml's own `parse` already reads those tags back into a `Map`/`Set`. Emitting one back out just isn't built yet (tracked in #101), so for now `stringify(parse("!!set {a, b}"))` throws instead of round-tripping. `Date`/`RegExp`/function/symbol are refused on principle — YAML 1.2 core has no type for any of them at all, so there's no round-trip to eventually build.

Functions and symbols used to be written out as bare text (`a: function foo() {}`), which isn't the value you passed in and often isn't valid YAML to read back either. They throw now too.

**`BigInt` also throws now — and that one deserves an explanation.**

Before, it was written out *quoted*, which is the worst of the available options — not an error, but the quotes make it a string, so you got text back instead of a number:

```js
stringify({ id: 9007199254740993n });
// before: "id: '9007199254740993'\n"   ← quoted, so it read back as a string
// now:    throws
```

The obvious fix is to drop the quotes, and that really would be valid YAML. The spec says integers represent *"arbitrary sized finite mathematical integers"* ([§10.2.1.3](https://yaml.org/spec/1.2.2/#10213-integer)) — YAML has no 64-bit ceiling, and a bare `9007199254740993` is exactly the canonical form it prescribes.

The catch is the trip back. YAML has only one integer type, and nothing in the file marks a value as "big": a plain `10` already resolves to the same `!!int` as writing `!!int 10` ([§10.3.2](https://yaml.org/spec/1.2.2/#1032-tag-resolution)), and there's no standard `!bigint` tag to reach for. So a reader has to choose one JavaScript type for *every* integer it meets, and ours chooses `number`. Write that value out unquoted and read it back and you get `9007199254740992` — off by one, silently. That's the exact condition the spec attaches to this: a processor may use a general number type for integers *"as long as they round-trip properly."*

The two libraries we track split on it:

- **js-yaml** refuses a `BigInt` outright — under every schema it ships (failsafe, JSON, core, YAML 1.1) and by default. (`skipInvalid: true` drops the key rather than writing it.)
- **`yaml`** writes it as a plain integer, then reads it back as a rounded `number` — unless you pass `intAsBigInt: true`, which switches *every* integer in the document to `BigInt`, not just the ones that need it.

`JSON.stringify`, the benchmark this library measures itself against, throws too.

So refusing it is the honest position while our reader still returns `number`: better a clear error than a value that quietly comes back different. It's also the reversible half of the choice — starting to write `BigInt` later is a feature, whereas taking it away would be a break. That's tracked as the read side and the write side together, so the round trip works when it arrives.

Everything `stringify` accepted before still works unchanged: strings, numbers, booleans, `null`, arrays, plain objects (including empty `{}` and `[]`), class instances with ordinary properties, and `Uint8Array` (as `!!binary`).

Through the `lightning-yaml/js-yaml` drop-in, a `dump` failure now arrives as a `YAMLException`, like js-yaml's own, and `dump(value, { skipInvalid: false })` — js-yaml's default — is accepted instead of throwing.
