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

A `BigInt` used to be written out *quoted*, so it read back as text rather than a number. It now throws as well:

```js
stringify({ id: 9007199254740993n });
// before: "id: '9007199254740993'\n"   ← quoted, so it read back as a string
// now:    throws
```

Writing it unquoted would be legal YAML — integers have no size limit ([§10.2.1.3](https://yaml.org/spec/1.2.2/#10213-integer)) — but `parse` currently reads every integer back as a JavaScript number, so anything past 2^53 would return silently rounded. Rather than emit a value we can't read back, `stringify` refuses for now; writing `BigInt` will land together with the option to read integers back as `BigInt`.

Everything `stringify` accepted before still works unchanged: strings, numbers, booleans, `null`, arrays, plain objects (including empty `{}` and `[]`), class instances with ordinary properties, and `Uint8Array` (as `!!binary`).

Through the `lightning-yaml/js-yaml` drop-in, a `dump` failure now arrives as a `YAMLException`, like js-yaml's own, and `dump(value, { skipInvalid: false })` — js-yaml's default — is accepted instead of throwing.
