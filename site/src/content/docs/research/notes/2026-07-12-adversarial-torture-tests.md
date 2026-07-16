---
title: "Adversarial torture tests — parser differentials, breakage & spec corners (2026-07-13)"
---
A later addition to this dossier. Docs 01–12 are the *implementation-strategy*
research (how to build a fast parser); this one is about **correctness under
hostile input**: the constructs known to break or split YAML parsers, whether
they break *ours*, and what we deliberately decided to do differently.

It distills an external research brief (parser-differential security work, the
official yaml-test-suite corners, and real CVEs) into repo-native form, and — the
part that matters — records the **measured verdict for lightning-yaml on every
category**, produced by running each construct through a differential harness
(ours vs. the `yaml` oracle) and a "no unexpected exception" fuzz sweep. The
regression tests that lock these verdicts live in
[`test/adversarial.unit.ts`](https://github.com/jbsiddall/lightning-yaml/blob/main/test/adversarial.unit.ts).

Two properties are tracked separately (never conflated):

- **(a) conformance** — does `parse` match the YAML 1.2 core schema as the `yaml`
  oracle resolves it? A mismatch is a bug *unless* we chose it on purpose.
- **(b) robustness** — on *any* bytes, does the parser only ever raise its declared
  `YAMLParseError`, never an uncaught `TypeError`/`RangeError`/stack overflow?

## Headline results

Measured on this checkout (Node v22.22.2), differential harness + a 31-input
pathological fuzz sweep:

- **Zero uncaught exceptions.** Across every §-taxonomy construct below plus 31
  deliberately malformed inputs (deep nesting, truncated quotes/scalars, NUL
  bytes, lone surrogates, 5000-digit numbers, alias loops, self-referential maps,
  directive/tag soup, mixed CR/LF/NEL), the parser either returns a value or
  throws `YAMLParseError`. Deep nesting hits the `MAX_DEPTH` cap as a controlled
  throw — not a stack overflow.
- **Conformance unchanged at 364/373 (97.6%)** of the yaml-test-suite — ahead of
  js-yaml (94.9%) and the `yaml` oracle (97.1%). All 9 of our failures are cases
  the oracle *also* fails ("spec-corner non-goal"); there are **0** cases where we
  fail and both js-yaml and `yaml` pass.
- **Resource bombs are cheap, not catastrophic.** An exponential "billion laughs"
  alias bomb (10 levels, ~387M logical nodes if expanded) parses in <1 ms because
  aliases resolve to the **same reference** (structural sharing, O(1) `Map.get`),
  building a small shared-reference DAG rather than materializing the expansion.
- **One deliberate deviation from spec** (duplicate keys → last-wins), and **one
  case where the `yaml` oracle — not us — diverges from spec** (implicit flow
  collection keys). Both documented and locked below. (An earlier draft of this doc
  mis-scored the flow-key case as *our* limitation; that was an artifact of treating
  the `yaml` implementation as the definition of correct — see the correction below.)

## Measured verdict per category

Legend: ✅ spec-correct (and oracle agrees) · ✅✱ spec-correct but the `yaml`
oracle diverges · ⚠️ deliberate deviation from spec · 🔒 newly locked by
`test/adversarial.unit.ts` · (covered) already in the suite.

| § | Construct | lightning-yaml | Verdict |
| --- | --- | --- | --- |
| 4.1 | Norway values `NO/off/yes/y/n/~` | strings + null (1.2 core) | ✅ (covered) |
| 4.1 | bool-words as **keys** `{true, yes, on}` | 3 **distinct** string keys | ✅ 🔒 |
| 4.2 | `010` | `10` (decimal; **not** 1.1 octal `8`) | ✅ 🔒 |
| 4.2 | `0o17`→15, `0xFF`→255, `007`→7 | 1.2-core ints | ✅ 🔒 |
| 4.2 | `8_000`, `0b1010`, `22:22:22` (sexagesimal) | **strings** (all 1.1-only) | ✅ 🔒 |
| 4.2 | `-_` (Atheris ValueError case) | string `"-_"` — never throws | ✅ 🔒 |
| 4.2 | `.inf`/`-.inf`/`.nan` | ±Infinity / NaN | ✅ (covered) |
| 4.3 | **duplicate keys** `lang: X` / `lang: Y` | **last-wins** `{lang: Y}` | ⚠️ 🔒 deliberate deviation (spec: keys unique → error; we take JSON.parse last-wins) |
| 4.4–4.9 | **merge key `<<`** | **literal string key** (not merged, not thrown) | ⚠️ 🔒 (merge unimplemented) |
| 4.10 | billion-laughs / quadratic alias bomb | shared-ref DAG, <1 ms | ✅ 🔒 safe by sharing |
| 4.11 | node-property / seq-under-map indentation | per 1.2 | ✅ (covered) |
| 4.12 | **block** complex key `? [a, b]` | `{"[ a, b ]": …}` | ✅ (covered) |
| 4.12 | **explicit** flow collection key `{? [1,2]: v}` | `{"[ 1, 2 ]": …}` | ✅ 🔒 |
| 4.12 | **implicit** flow collection key `{[1,2]: v}` | **controlled `YAMLParseError`** | ✅✱ 🔒 spec ERROR (suite SBG9/X38W) — we reject; the oracle wrongly accepts |
| 4.12 | empty / inverted keys `: v`, `? k` | per 1.2 | ✅ (covered) |
| 4.13 | `%YAML`/`%TAG` per-document reset | re-declared per doc | ✅ (covered) |
| 4.14 | tabs as indentation | rejected | ✅ (covered) |
| 4.15 | block-scalar chomping `|`,`>`,`|-`,`|+`,`|2` | per 1.2 | ✅ (covered) |
| 4.16 | double-quote escapes incl. `\N`,`\_`,`\L`,`\P`,`\0` | per 1.2 | ✅ 🔒 (`\L`/`\P` were untested) |
| 4.17 | `!!binary`, verbose/local tags | `Uint8Array` / preserved | ✅ (covered) |
| 4.18 | literal NEL/LS/PS (U+0085/2028/2029) | **content, not line breaks** (1.2) | ✅ 🔒 |
| 4.19 | empty-anchor alias, forward ref, redefinition | null / throw / last-wins | ✅ 🔒 |

## Spec vs. oracle: the one deviation, and one place the oracle is wrong

The correctness authority here is the **YAML 1.2 spec** (as operationalized by the
spec-derived yaml-test-suite), *not* the `yaml` implementation. That distinction is
load-bearing: on the two constructs below the spec and the `yaml` implementation
disagree, so "matches the oracle" would give the wrong verdict on one of them. Both
are pinned in `test/adversarial.unit.ts`.

### 1. Duplicate keys → last-wins — a deliberate deviation *from spec*

`parse("lang: X\nlang: Y")` → `{ lang: "Y" }`. The YAML 1.2 spec requires mapping
keys to be unique and treats a duplicate as an error (the yaml-test-suite happens
not to cover mapping-key duplication directly — only duplicate *directives*, SF5V —
so the spec text is the authority). The `yaml` implementation is spec-aligned here:
it throws. We **deliberately deviate**, following **`JSON.parse` semantics** — the
library's north star — where `JSON.parse('{"a":1,"a":2}')` is `{a:2}`. This is the
security-relevant differential the brief flags (the CVE-2017-12635 class). It is the
*only* place we knowingly choose behaviour the spec disallows; adopters needing
strict rejection validate upstream. (A future opt-in strict mode could reject; the
default stays JSON.parse-compatible.)

### 2. Implicit flow collection key → error — spec-correct; the *oracle* diverges

Per the grammar, a collection used as a key in flow context must carry the explicit
`?` indicator. So `{? [1,2]: v}` is valid (we accept it → `{"[ 1, 2 ]": "v"}`), but
the **implicit** form `{[1,2]: v}` is a **spec error** — yaml-test-suite **SBG9**
(`{a: [b, c], [d, e]: f}`) and **X38W** both mark a flow collection used as an
implicit key as an error. lightning-yaml matches the spec on **both** sides: it
accepts the explicit form and raises `YAMLParseError` on the implicit one.

The `yaml` implementation **diverges from spec** here — it accepts the implicit form
and materializes a lossy stringified key. This is exactly why it fails suite
negative-cases SBG9/X38W (scoring 89/91 on negatives) while we pass all 91. Under an
implementation-as-oracle model this inverts: an earlier draft of this doc recorded
our correct rejection as a "known limitation where we diverge from spec, the oracle
accepts" — the precise mistake that motivates using the spec as the oracle.

**Other minor spec differences** (none crash, none a design choice): a few
over-lenient acceptances where we take input the spec rejects (e.g. `{k: ? v}`) — an
error-case strictness gap to close as the parser matures; and some are places
we are arguably *more* spec-correct than the `yaml` implementation (e.g. `!!bool yes`
→ we throw, since `yes` is not a core-schema bool; the implementation returns the
string `"yes"`). `!!float 1` → the number `1` is a JS representation limit (no
distinct float type), not a divergence. These are re-triaged against the spec, not
the implementation, as the correctness model shifts.

## Sources worth keeping (new to this repo)

The implementation dossier cites parser internals; these are the **adversarial /
security** references behind the taxonomy above, kept for future torture work:

- **Official yaml-test-suite** — `github.com/yaml/yaml-test-suite`; cross-parser
  matrix at `matrix.yaml.info`. We already vendor + score a pinned snapshot
  (`bench/yaml-test-suite/`, `bench/conformance/`). This is the "known-covered"
  baseline: triage a new case against it before adding a bespoke test.
- **Parser-differential method** — joernchen, "Parser Differentials: When
  Interpretation Becomes a Vulnerability" (OffensiveCon 2025); DarkForge Labs,
  "YAML Merge Tags and Parser Differentials" (2026) — the source of the merge-key
  and complex-key confusion payloads. Method: run one input through many parsers,
  canonicalize to sorted JSON, diff; any disagreement is a finding.
- **CVEs (the reason these corners matter):**
  - CVE-2024-0402 (GitLab) — Ruby Psych vs Go `yaml.v3` disagreeing on the same
    devfile bytes; the headline "two memory-safe parsers, different structure" case.
  - CVE-2019-11253 (Kubernetes) — unbounded alias expansion "billion laughs" DoS.
  - CVE-2026-45304 (Symfony) — recursive collection-alias expansion; shows the
    class is still live. (lightning-yaml is insulated by structural sharing — see
    §4.10 above — but a downstream consumer that *expands* the DAG is not.)
  - CVE-2017-12635 (CouchDB) — cross-format duplicate-key divergence; the precedent
    for our documented last-wins policy.
- **Fuzzing corpora / firehoses** — `google/oss-fuzz` → `projects/libyaml`,
  `k8s.io/kubernetes/test/fuzz/yaml` (roundtrip oracle: unmarshal→marshal→assert),
  `brandonprry/yaml-fuzz`. Oracles to borrow: differential, roundtrip, and
  "no unexpected exception" (Atheris) — the last is what `test/adversarial.unit.ts`
  encodes directly.
- **Implicit-typing footguns** — StrictYAML's "Norway Problem" writeup; the
  1.1↔1.2 boundary is where schema-resolution bugs hide (§4.1–4.2).

## How to re-run / extend

1. **Differential** — parse a candidate with both `parse` (ours) and
   `oracleParse` (`bench/oracle.ts`), canonicalize, diff. Any disagreement →
   triage: ours≠spec is a bug; ours=spec≠oracle is an intentional divergence to
   document; ambiguous is a policy decision to pin with a test.
2. **Fuzz oracle** — feed garbage; assert only `YAMLParseError` ever escapes. New
   pathological seeds go in the `pathological` table in `test/adversarial.unit.ts`.
3. **Conformance** — `pnpm test:suite` scores the vendored yaml-test-suite; the
   rate must not drop. New spec-corner constructs should be checked here first
   (they may already be covered) before a bespoke unit test is added.
