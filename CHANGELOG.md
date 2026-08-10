# lightning-yaml

## 0.2.0

### Minor Changes

- [#39](https://github.com/jbsiddall/lightning-yaml/pull/39) [`d65b86b`](https://github.com/jbsiddall/lightning-yaml/commit/d65b86b531be74f926457d0b401c5c0976718b18) Thanks [@jbsiddall](https://github.com/jbsiddall)! - Accept a zero-indented ("compact") block sequence as an explicit mapping key (`?\n- a\n- b`). Per YAML 1.2.2 §8.2.2 (Block Mappings), an explicit key (`c-l-block-map-explicit-key`) and its value nest content through the same `s-l+block-indented(n)` production, so a same-column compact sequence is valid on the KEY side exactly as it already was on the value side; previously the deferred key resolved to null and left the `- a` line unconsumed, surfacing as a misleading "multiple documents" error on otherwise-valid input. The tab-before-a-new-collection restriction now also applies to second and later explicit keys, not just the first.

  (Why this needs fixing when the yaml-test-suite already passes: this exact deferred-key shape isn't one of the suite's scored cases — our score is unchanged at 364/373 — so it was caught by differential testing against the `yaml` oracle, which exercises spec-legal inputs the suite doesn't score.)

- [#142](https://github.com/jbsiddall/lightning-yaml/pull/142) [`2141fbe`](https://github.com/jbsiddall/lightning-yaml/commit/2141fbe3d92f6d0e6d87dd27bd72049d8d23c8b7) Thanks [@jbsiddall](https://github.com/jbsiddall)! - Parsing a document with a very large number of distinct mapping keys (for example a lookup table keyed by UUID, hostname, or timestamp) now uses bounded peak memory. The parser interns mapping keys internally to speed up repeated-key documents; that cache is now capped by cumulative key size (4 MB by default), matching a bound already in place for string values. Parsed output is unchanged either way — this only affects memory use on pathological inputs.

  The cap is also tunable per call, for callers who want to trade memory for cross-record key sharing (or vice versa):

  ```ts
  parse(text, { optimizations: { keyCacheMaxKb: 8192 } });
  ```

- [#117](https://github.com/jbsiddall/lightning-yaml/pull/117) [`bbf96e5`](https://github.com/jbsiddall/lightning-yaml/commit/bbf96e5ab3b2d864b9ff9f141672f7cfc7b0ae9c) Thanks [@jbsiddall](https://github.com/jbsiddall)! - Compat shims now fail loud on options they don't support yet

  The `./yaml` and `./js-yaml` drop-in entries used to accept every option and
  silently ignore the ones they couldn't honour — so a call that relied on an
  option quietly produced the wrong output. They now validate the option bag and
  throw a clear error that names the unsupported option instead.

  ```js
  import { dump } from "lightning-yaml/js-yaml";

  // before: silently ignored `sortKeys`, emitted unsorted YAML
  // now: throws, naming the unsupported option
  dump(value, { sortKeys: true });
  ```

  Options that are genuine no-ops today keep working unchanged — the `parse` reviver, `filename`, and
  `schema` / `version` at their YAML-1.2-core defaults, plus any boolean flag left at the value
  lightning-yaml already produces (for example `mapAsMap: false` or `sortKeys: false`). Anything that
  would actually change the output — a different schema, a custom `indent`, `sortKeys: true` — throws
  until its support lands, so you find out at the call site instead of downstream.

  The shims also read the options _argument position_ the way each real library does. `parse` and
  `stringify` now honour a real third-argument options object — `stringify(value, replacer, options)` —
  instead of silently dropping it, and `stringify` rejects an unsupported indent shorthand
  (`stringify(value, 2)`) rather than quietly ignoring it. A falsy conditional options argument still
  means "no options": `stringify(value, cond && replacer)` with `cond` false emits default output, matching
  real `yaml`.

- [#157](https://github.com/jbsiddall/lightning-yaml/pull/157) [`e65525c`](https://github.com/jbsiddall/lightning-yaml/commit/e65525ce4b760527d99f69082c4068e235420cac) Thanks [@jbsiddall](https://github.com/jbsiddall)! - `parse` and `parseAll` are now lenient by default: a tab used to indent a block sequence or mapping is accepted instead of rejected. [YAML 1.2.2 §6.1](https://yaml.org/spec/1.2.2/#61-indentation-spaces) forbids it, but real-world YAML sometimes has it, so lightning-yaml now tolerates it out of the box:

  ```ts
  const withTab = "a:\n\tb: 1\n"; // a tab indenting "b"

  parse(withTab); // { a: { b: 1 } } — before this change, threw
  parse(withTab, { strict: true }); // throws, same as the previous default
  ```

  Pass the new top-level `strict: true` option to restore full YAML 1.2.2 rejection of that input. Valid documents parse identically either way — leniency only ever turns a rejection into an acceptance, never changes how well-formed YAML is read.

  The `optimizations.skipStrictValidation` option (never released as a default-off opt-in) is removed in favor of this top-level `strict` option — the inverse of the old flag, and no longer tucked under `optimizations` since it's a correctness/behavior choice, not a performance tradeoff. If you were passing `{ optimizations: { skipStrictValidation: true } }`, drop it — that's the new default. If you relied on rejecting tab-indented input, pass `{ strict: true }` instead.

- [#142](https://github.com/jbsiddall/lightning-yaml/pull/142) [`2141fbe`](https://github.com/jbsiddall/lightning-yaml/commit/2141fbe3d92f6d0e6d87dd27bd72049d8d23c8b7) Thanks [@jbsiddall](https://github.com/jbsiddall)! - Reject two malformed `%YAML`/`%TAG` directives that were previously accepted silently.

  Repeating a `%TAG` directive for the same handle in one document is now an error, per [YAML 1.2.2 §6.8.2](https://yaml.org/spec/1.2.2/#682-tag-directives):

  ```yaml
  %TAG ! !foo
  %TAG ! !foo
  ---
  bar
  ```

  A `%YAML` directive declaring a higher major version than 1 is now rejected too, per [§6.8.1](https://yaml.org/spec/1.2.2/#681-yaml-directives):

  ```yaml
  %YAML 2.0
  ---
  foo: bar
  ```

  A higher _minor_ version (`%YAML 1.3`) still parses, as the spec only calls for the major version mismatch to be rejected.

- [#37](https://github.com/jbsiddall/lightning-yaml/pull/37) [`9063f58`](https://github.com/jbsiddall/lightning-yaml/commit/9063f5831b66e43cddd0be4f498bd2bfd0199cac) Thanks [@jbsiddall](https://github.com/jbsiddall)! - Reject space-then-tab sequences used as block indentation, per [YAML 1.2.2 §6.1](https://yaml.org/spec/1.2.2/#61-indentation-spaces), when parsing with `{ strict: true }`; such input is accepted unconditionally otherwise.

  Full spec rejection of this costs ~4-8% of block-YAML parse time (more on deep, many-entry input), which is why it's opt-in via `strict` rather than the default — see the separate changeset introducing that option for the full lenient-by-default story. Valid input parses identically in both modes: `strict` only ever turns an acceptance into a rejection, never changes how a well-formed document is interpreted.

## 0.1.1

### Patch Changes

- [#70](https://github.com/jbsiddall/lightning-yaml/pull/70) [`1c70048`](https://github.com/jbsiddall/lightning-yaml/commit/1c700482a00797df8afe002341479914808907b2) Thanks [@jbsiddall](https://github.com/jbsiddall)! - Verify the automated release and npm publish pipeline end-to-end via OIDC Trusted Publishing. No functional changes to the parser or public API.
