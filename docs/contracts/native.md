# Native API contract

This page describes the current `lightning-yaml` root entry (`lightning-yaml`, including its CommonJS and browser builds). It records observed source behavior for callers and the contract-design status; it is a behavior inventory, not a complete set of Dafny preconditions/postconditions or event-trace clauses.

## Exports and calls

The root entry has named runtime exports `parse`, `parseAll`, `stringify`, `YAMLParseError`, and `NotImplementedError`. It has no default export. `ParseOptions` and `ParseOptimizations` are TypeScript-only exports. The package also publishes `lightning-yaml/yaml`, `lightning-yaml/js-yaml`, and `lightning-yaml/package.json`; the browser IIFE at the CDN path exposes the root namespace as `YAML`. Existing [`test/built-package.test.mjs`](../../test/built-package.test.mjs) exercises built ESM entries, the root CommonJS entry, the browser IIFE, and basic behavior. [`test/compat.unit.ts`](../../test/compat.unit.ts#L47) checks named/default source export shapes and alias identity; package metadata declares the ESM/CJS subpath targets.

| Operation | Current behavior |
| --- | --- |
| `parse(text, options?)` | Returns the one parsed document. Empty input is `null`. A second document throws `YAMLParseError`. |
| `parseAll(text, options?)` | Returns all documents in order. Empty stream is `[]`; an explicit empty document is `null`. A failure throws instead of returning a partial list. |
| `stringify(value)` | Returns YAML text ending in LF on success. Shared/cyclic plain objects and arrays use anchors; bytes use `!!binary`. It has no options argument. |

`strict` changes only when exactly `true`. `optimizations.internStrings` uses JavaScript truthiness. `optimizations.keyCacheMaxKb` defaults to 4096 when nullish and otherwise is multiplied by 1024 without a public range/type check. The implementation reads `optimizations.internStrings`, then `strict`, then reads `optimizations` and `keyCacheMaxKb`; getters and numeric coercion therefore have observable order and may throw. Unknown root option keys are ignored. These optimization settings do not define a different intended YAML value; the current quoted-key cache defect described below remains open.

The parser preserves alias identity, including cycles. Duplicate map keys are last-wins and `<<` is an ordinary key, as listed in the README's decisions and deviations. The writer traverses own enumerable string keys on objects and indexed array elements. It does not serialize Map/Set intrinsic entries; ordinary instances generally follow the empty-object path. Accessors and proxies can affect parsing options and writer enumeration/property reads; writer getters may be read once while counting references and again while emitting.

Core scalar resolution follows YAML 1.2 core: plain `null`/`~` forms and booleans are typed; `yes`, `no`, `on`, and `off` remain strings. Explicit `!!binary` yields `Uint8Array`, `!!set` yields `Set`, `!!omap` yields `Map`, and `!!pairs` yields arrays of pairs. These special values, host numeric conversion, and the full syntax relation remain part of the pending parser proof; the output types are current runtime behavior, not proof claims.

## Errors and cleanup

Malformed input throws `YAMLParseError`. The message reports 1-based line and column for non-EOF failures, counting UTF-16 code units and treating CR as an ordinary column unit; EOF reports `unexpected end of input` without a precise offset. `YAMLParseError` is also used for writer failures. `NotImplementedError` remains exported for compatibility and currently names a stub call in its message.

Each parse call resets the shared parser and calls `EndStream` from `finally`, including failure paths. The writer resets before each call and clears working collections after successful completion; a thrown write does not have a `finally` cleanup. These are implementation observations rather than isolation or memory-retention guarantees. Reentrant getters can call the same singleton while an operation is active.

## Formal-contract status

The checked ledger in [`public-surface-contract-manifest.json`](../../scripts/public-surface-contract-manifest.json) distinguishes behavior summaries from verified behavior and lists the remaining formal-contract gaps. Six scanner methods have local proofs and are dependencies only. Root parsing, output semantics, host JavaScript correspondence, and end-to-end caller guarantees remain open; inventory presence and regression tests are not proofs.

The `SurfaceOptions` tranche is integrated: five generated methods have conditional proofs over supplied host classifications (six verification obligations, with ten behavior-changing body mutations rejected). The source-derived checker finds all 26 option-tranche constructs. These results do not prove JavaScript host classification, property/getter behavior, or any complete public operation. The manifest continues to report no verified public operations.

Known open items include the quoted-key cache defect (issue #234) and host numeric conversion obligations. They are recorded as current defects or pending obligations, not approved YAML deviations. The manifest checker compares source exports, option fields/rules, default aliases, package exports, and behavioral rows against this ledger. Function/class identity, `name`/`length`, prototype, and property descriptors follow the actual JavaScript build; the existing built-package tests cover representative export resolution, not every descriptor.
