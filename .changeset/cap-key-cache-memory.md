---
"lightning-yaml": minor
---

Parsing a document with a very large number of distinct mapping keys (for example a lookup table keyed by UUID, hostname, or timestamp) now uses bounded peak memory. The parser interns mapping keys internally to speed up repeated-key documents; that cache is now capped by cumulative key size (4 MB by default), matching a bound already in place for string values. Parsed output is unchanged either way — this only affects memory use on pathological inputs.

The cap is also tunable per call, for callers who want to trade memory for cross-record key sharing (or vice versa):

```ts
parse(text, { optimizations: { keyCacheMaxKb: 8192 } });
```
