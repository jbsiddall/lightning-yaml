# Adversarial torture tests — parser differentials, breakage & spec corners (2026-07-13)

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
[`test/adversarial.unit.ts`](../../test/adversarial.unit.ts).

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
- **Two intentional divergences** from the oracle, documented and locked (below).

## Measured verdict per category

Legend: ✅ spec-correct & oracle-matched · ⚠️ intentional divergence / policy ·
🔒 newly locked by `test/adversarial.unit.ts` · (covered) already in the suite.

| § | Construct | lightning-yaml | Verdict |
| --- | --- | --- | --- |
| 4.1 | Norway values `NO/off/yes/y/n/~` | strings + null (1.2 core) | ✅ (covered) |
| 4.1 | bool-words as **keys** `{true, yes, on}` | 3 **distinct** string keys | ✅ 🔒 |
| 4.2 | `010` | `10` (decimal; **not** 1.1 octal `8`) | ✅ 🔒 |
| 4.2 | `0o17`→15, `0xFF`→255, `007`→7 | 1.2-core ints | ✅ 🔒 |
| 4.2 | `8_000`, `0b1010`, `22:22:22` (sexagesimal) | **strings** (all 1.1-only) | ✅ 🔒 |
| 4.2 | `-_` (Atheris ValueError case) | string `"-_"` — never throws | ✅ 🔒 |
| 4.2 | `.inf`/`-.inf`/`.nan` | ±Infinity / NaN | ✅ (covered) |
| 4.3 | **duplicate keys** `lang: X` / `lang: Y` | **last-wins** `{lang: Y}` | ⚠️ 🔒 diverges (oracle throws) |
| 4.4–4.9 | **merge key `<<`** | **literal string key** (not merged, not thrown) | ⚠️ 🔒 (merge unimplemented) |
| 4.10 | billion-laughs / quadratic alias bomb | shared-ref DAG, <1 ms | ✅ 🔒 safe by sharing |
| 4.11 | node-property / seq-under-map indentation | per 1.2 | ✅ (covered) |
| 4.12 | **block** complex key `? [a, b]` | `{"[ a, b ]": …}` | ✅ (covered) |
| 4.12 | **flow** complex key `{[1,2]: v}` | **controlled `YAMLParseError`** | ⚠️ 🔒 known limitation (oracle accepts, lossily) |
| 4.12 | empty / inverted keys `: v`, `? k` | per 1.2 | ✅ (covered) |
| 4.13 | `%YAML`/`%TAG` per-document reset | re-declared per doc | ✅ (covered) |
| 4.14 | tabs as indentation | rejected | ✅ (covered) |
| 4.15 | block-scalar chomping `|`,`>`,`|-`,`|+`,`|2` | per 1.2 | ✅ (covered) |
| 4.16 | double-quote escapes incl. `\N`,`\_`,`\L`,`\P`,`\0` | per 1.2 | ✅ 🔒 (`\L`/`\P` were untested) |
| 4.17 | `!!binary`, verbose/local tags | `Uint8Array` / preserved | ✅ (covered) |
| 4.18 | literal NEL/LS/PS (U+0085/2028/2029) | **content, not line breaks** (1.2) | ✅ 🔒 |
| 4.19 | empty-anchor alias, forward ref, redefinition | null / throw / last-wins | ✅ 🔒 |

## The two intentional divergences (per the triage rules in the brief's §6)

Both are spec-corner behaviours where we knowingly differ from the `yaml` oracle.
They aren't in the fixture corpus, so the consistency suite never exercised them;
they are now pinned in `test/adversarial.unit.ts` so the choice can't silently flip.

### 1. Duplicate keys → last-wins (not an error)

`parse("lang: X\nlang: Y")` → `{ lang: "Y" }`. The oracle instead throws
("Map keys must be unique"). We follow **`JSON.parse` semantics** — the library's
north star — where `JSON.parse('{"a":1,"a":2}')` is `{a:2}`. This is the exact
security-relevant differential the brief flags (the CVE-2017-12635 class: two
parsers in one pipeline disagreeing on a duplicated key). Adopters who need strict
rejection must validate upstream; we document the last-wins contract rather than
diverge from `JSON.parse`.

### 2. Non-scalar key inside a *flow* mapping → controlled throw

`parse("{[1,2]: v}")` raises `YAMLParseError`. The oracle accepts it and renders a
lossy stringified key (`{"[ 1, 2 ]": "v"}`). We already support the **block** form
(`? [a, b]`) with the identical stringification, so this is a gap, not a design
stance — but a deliberate one for now: the construct is spec-valid yet **absent
from the entire yaml-test-suite**, the only faithful JS representation is a lossy
string (JS objects can't key on a collection), and the current behaviour is a
*clean* throw, never a crash or a mis-parse. Wiring `[`/`{` dispatch into
`parseFlowKey` (reusing the existing `stringifyKeyNode`) would close it if a real
adopter ever needs it; until then the throw is the pinned, documented behaviour.

**Scope note.** "Two intentional divergences" is scoped to the surveyed taxonomy
above — the constructs where a divergence is a deliberate *design* choice. A few
finer divergences exist outside it and are **not** separately enumerated here
because they fall under an already-tracked bucket: the over-lenience gap (we accept
some malformed inputs the oracle rejects — e.g. `{k: ? v}`), noted in `PROGRESS.md`
as the "error-case strictness gap" to close as the parser matures; and minor tag
resolutions (`!!float 1` → the number `1`, indistinguishable from `1.0` in JS;
`!!merge` as a key → an empty-string key, under the merge non-goal). None crash and
none contradict a locked row; they are catalogued here so the "two" figure can't be
misread as a global count.

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
  `brandonprry/yaml-fuzz`. Oracles to steal: differential, roundtrip, and
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
