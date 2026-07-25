---
"lightning-yaml": minor
---

`stringify` now fails loudly on values YAML can't represent, instead of quietly writing the wrong thing

Serializing a `Map`, `Set`, `Date`, `RegExp`, `Promise` — anything whose contents don't live in ordinary properties — used to emit an empty mapping and throw the data away, with no error:

```js
stringify({ users: new Map([["ada", 1]]) });
// before: "users: {}\n"   ← entries silently gone
// now:    throws: stringify: cannot serialize a Map — YAML 1.2 has no representation for it
```

Functions and symbols used to be written out as bare text (`a: function foo() {}`), which isn't the value you passed in and often isn't valid YAML to read back either. They throw now too.

`BigInt` goes the other way — it's now written as an ordinary integer. YAML integers have no size limit ([§10.3.2](https://yaml.org/spec/1.2.2/#1032-tag-resolution)), so this is exact, where before it came back as a *string*:

```js
stringify({ id: 9007199254740993n });
// before: "id: '9007199254740993'\n"   ← quoted, so it read back as text
// now:    "id: 9007199254740993\n"
```

Everything `stringify` accepted before still works unchanged: strings, numbers, booleans, `null`, arrays, plain objects (including empty `{}` and `[]`), class instances with ordinary properties, and `Uint8Array` (as `!!binary`).

Through the `lightning-yaml/js-yaml` drop-in, a `dump` failure now arrives as a `YAMLException`, like js-yaml's own, and `dump(value, { skipInvalid: false })` — js-yaml's default — is accepted instead of throwing.
