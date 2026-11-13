---
"lightning-yaml": minor
---

`parse` and `parseAll` are now lenient by default: a tab used to indent a block sequence or mapping is accepted instead of rejected. [YAML 1.2.2 §6.1](https://yaml.org/spec/1.2.2/#61-indentation-spaces) forbids it, but real-world YAML sometimes has it, so lightning-yaml now tolerates it out of the box:

```ts
const withTab = "a:\n\tb: 1\n"; // a tab indenting "b"

parse(withTab); // { a: { b: 1 } } — before this change, threw
parse(withTab, { strict: true }); // throws, same as the previous default
```

Pass the new top-level `strict: true` option to restore full YAML 1.2.2 rejection of that input. Valid documents parse identically either way — leniency only ever turns a rejection into an acceptance, never changes how well-formed YAML is read.

The `optimizations.skipStrictValidation` option (never released as a default-off opt-in) is removed in favor of this top-level `strict` option — the inverse of the old flag, and no longer tucked under `optimizations` since it's a correctness/behavior choice, not a performance tradeoff. If you were passing `{ optimizations: { skipStrictValidation: true } }`, drop it — that's the new default. If you relied on rejecting tab-indented input, pass `{ strict: true }` instead.
