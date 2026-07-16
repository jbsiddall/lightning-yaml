# The shape of real-world YAML: what to optimize the hot path for

**Verdict: Reference / ceiling.** This note records a *target-workload profile* — the
statistical shape of the YAML lightning-yaml is actually asked to parse in the wild — so
that future optimization decisions can be weighed against a written, honestly-graded
picture of the common case instead of an unstated hunch. It recommends no code change on
its own; it is the yardstick other perf notes should measure their trade-offs against.
**Audience:** anyone deciding whether an optimization that helps shape A at the expense of
shape B is worth taking. **Rigor:** a synthesis of external literature, use-case structure,
and a cross-check of this repo — **not** an in-parser measurement, and **not** a tabulated
corpus study (none exists; see the confidence grading). Every claim below is labelled
`[MEASURED]`, `[REASONED]`, or `[INFERRED]` so the reader knows how much weight it bears.

## Background

Every parser optimization is a compromise that depends on the shape of the input: a fast
path for one construct is dead weight — or a tax — on documents that never use it. To pick
those trade-offs well, the project needs a clear answer to "what does the YAML we care
about actually look like?" Two gaps motivated this note:

1. **The official yaml-test-suite is not a representative corpus.** It is ~400
   deliberately-constructed, minimal conformance cases, each probing one spec production,
   with error/should-fail cases and visible glyphs for trailing spaces, tabs, and CRs. It
   is exactly right for the conformance run and exactly wrong as a benchmark corpus:
   tiny, adversarially weird, and skewed toward the rare corners of the grammar. Tuning an
   optimizer against it would over-fit the parser to spec edge cases. `[MEASURED]`
2. **The project's own fixtures are synthetic and uniform.** `bench/fixtures/generate.ts`
   emits seeded-PRNG arrays of near-identical records and balanced trees. They isolate
   throughput on a shape well, but they contain none of the messiness of hand-written
   config — no comments, block scalars, custom tags, or multi-document streams — so they
   cannot stand in for "representative real-world YAML" either.

A target profile had, in fact, been stated before — but only in scattered asides across the
dossier ("the owner's stated common case", "the library's target workload", "parse one
config file and exit", "block YAML (real world default)"). **This note is now the canonical
target-workload profile, and it supersedes the earlier "medium size and up / JSON-shaped"
framing** where the two disagree (see Interpretation). The older notes are left in place as
historical record; where they state the target case, this profile governs.

## Method

Three parallel research tracks (web-search fan-out plus source fetching), cross-checked
against this repo:

- **Corpora** — what representative real-world YAML can actually be downloaded, and whether
  the yaml-test-suite qualifies (it does not).
- **Shape** — the statistical distribution of size, nesting, feature usage, typing, and
  encoding across the dominant YAML use-cases (Kubernetes/Helm, CI configs, OpenAPI,
  Ansible, docker-compose, application config).
- **Environment** — whether a runtime-codegen optimization (compiling a specialized parser
  via `new Function`) can be leaned on, given Content-Security-Policy in the field.

The important honesty caveat, carried through below: **no published study tabulates YAML
*feature* frequencies** (block vs flow, anchor density, quoting habits) across a large
representative sample. Hard numbers exist for file/workflow *sizes* and for *conventions*;
feature-frequency claims rest on convergent indirect evidence — chiefly the features that
opinionated "safe subset" parsers delete as unnecessary, ecosystem history, and the
structure of the dominant use-cases. Those are graded `[REASONED]`, not `[MEASURED]`.

## Results — the profile, graded by confidence

### Size — mostly small, with a large generated tail

- Real-world YAML is **bimodal**: a by-count majority of **small hand-written config**
  (hundreds of bytes to a few KB, tens of keys, single-digit nesting) plus a **long tail of
  large machine-generated files** that are big but structurally plain. `[REASONED]` from
  the use-case mix, with the endpoints `[MEASURED]`:
  - GitHub Actions workflows average **≈60 lines**; median **3 workflow files per repo**;
    repos average ~3.5–4 YAML files each. `[MEASURED]`
  - The large tail: OpenAPI specs routinely **2,000–10,000 lines** (extremes ~50,000);
    `pnpm-lock.yaml` in the **1–4 MB** range; Kubernetes caps a single request near
    **1.5 MB**, which bounds one applied manifest/CRD. `[MEASURED]`
- **Consequence for optimization:** small files dominate the *number* of parses, so
  per-call fixed overhead (setup, first-allocation) is felt there; the large tail dominates
  *bytes per parse*, so raw scan throughput is felt there. Both matter, for different
  reasons — this is the crux of reconciling the prior "medium-and-up" framing (below).

### Nesting depth

- **Shallow to moderate.** Ecosystem best practice is to avoid deep nesting (Helm: "flat
  should be favored over nested"); Kubernetes manifests sit at the deeper end of typical
  (~5–6 levels). A practical ceiling for hand-written config is ~6–8 levels; very deep
  documents are a rare slow path. Depth guidance is `[MEASURED]`; the ceiling is `[REASONED]`.

### Feature usage — common vs. rare

Graded `[REASONED]` unless noted; the strongest single signal is that **StrictYAML
deliberately removed flow style, anchors/aliases, tags, implicit typing, and merge keys and
still serves real config needs**, and that **GitHub Actions shipped without anchor support
until 2025** — a very large YAML surface that ran for years with zero anchor usage.

Common (belongs on or near the hot path):

- **Block style** overwhelmingly dominates. Flow (`{}`/`[]`) appears mostly as short inline
  lists (`ports: [80, 443]`). The indentation-driven block-mapping/sequence scanner is *the*
  engine.
- **Plain, mostly-string scalars** dominate. Quoting is the defensive minority (special
  characters, forced strings, dodging implicit-typing traps).
- **Comments** are ubiquitous in hand-written config — cheap `#` handling on every line is
  a hot-path concern.
- **Implicit `key: value` maps with simple string keys** are universal.
- **Literal block scalars `|`** are common in CI (multi-line `run:` scripts — run-commands
  are ~13% of workflow changes `[MEASURED]`) and in ConfigMaps.
- **Multi-document `---` streams** are the one "advanced" construct worth first-class
  handling, because Kubernetes leans on them heavily.

Rare (correct-but-cold slow paths):

- **Anchors & aliases `&`/`*`** and the alias-graph/alias-count safety machinery — rare
  outside generated/DRY CI.
- **Tags** (`!!`-family, custom `!`, `%TAG`/verbatim, `!!binary`) — niche to CloudFormation
  (`!Ref`, `!GetAtt`) and Home Assistant (`!include`, `!secret`); `!!binary` is essentially
  never hand-written.
- **Non-trivial flow collections**, **folded block scalars `>`**, **explicit `? ` keys**,
  and **complex/non-string keys** — all very rare.
- **Merge keys `<<`** — a YAML 1.1 feature. For a 1.2.2-only parser it is not a merge at
  all, just a string key, so it warrants no hot-path cost whatsoever. `[MEASURED]` (spec fact).

### Typing — string-by-default with a small hot set

- Most scalar *values* are strings. The non-string core-schema types that actually recur
  are a small, high-frequency set: **integers** (ports, replicas, counts), **booleans**
  (flags), and **null**. Floats are less common; timestamps are rare and footgun-prone.
  `[REASONED]`
- A 1.2.2-only core schema already dodges the worst of the "Norway problem" — `yes/no/on/off`
  are plain strings, not booleans — so the common value vocabulary is: a plain string, or
  one of `true | false | null | ~ | <int> | <float>`. The scalar type-resolver should be a
  short ordered set of cheap first-char/length checks with **string as the default
  fall-through**. `[MEASURED]` (spec) + `[REASONED]` (frequency).

### Encoding, line endings, indentation

- **2-space indentation** is the dominant convention (Kubernetes, docker-compose, GitHub
  Actions); tabs are illegal for indentation. **ASCII** dominates structural/tokenizing
  bytes (non-ASCII lives in string values); **LF** dominates on the CI/cloud/Linux systems
  that produce most YAML, with CRLF from Windows-authored files. Conventions are
  `[MEASURED]`; the ASCII/LF byte-share is `[REASONED]`. An ASCII+LF fast path with UTF-8
  and CRLF as correct secondary branches fits the data.

## Interpretation & recommendation

### The hot path to optimize for

Aggressively optimize the parse path for a document that is **block-style, small,
comment-rich, 2-space-indented, plain-string-scalar-dominant, ASCII+LF, with simple string
keys and shallow nesting** — plus keep **linear-time, low-constant scanning** so the
large-but-plain generated tail (OpenAPI, lockfiles, big CRDs) stays fast. Concretely, the
functions worth the most attention are the indentation-driven block map/sequence scanner,
the plain-scalar reader, the string-default type resolver, per-line comment skipping, and
the literal-`|` block-scalar reader; a cheap `---` document splitter is worth having for
Kubernetes. This is consistent with what the existing dossier already found by profiling
*other* parsers (the plain-scalar resolver chain and generator lexing are their real
bottlenecks) and with this repo's own jit-tiering audit.

Treat as correct-but-cold, and never let them tax the above: anchors/aliases, tags and
binary decoding, non-trivial flow, folded `>`, explicit/complex keys, merge keys, and
timestamp typing.

**Confidence to attach to this recommendation.** The *sizes and conventions* are measured.
The *feature-frequency* claims are reasoned from use-case dominance and convergent indirect
evidence, not a tabulated corpus — solid triangulation, but not a counted distribution. The
final step, "therefore these are *lightning-yaml's* hot paths," is engineering inference:
well-supported and dossier-consistent, but **not yet profiled on real-world YAML**, because
the fixtures to date are synthetic. Before banking any optimization that trades the common
case against the tail, validate it with a profile run over an actual corpus — the cheapest
representative starting pair is a clone of **APIs.guru/openapi-directory** (CC0; the large,
structured, reference-heavy bucket) plus the **MSR-2024 GitHub Actions workflow dataset**
(CC BY 4.0; ~1.5M small configs), bucketed by size × shape.

### Superseding the prior stated target

The earlier asides framed the common case as "medium size and up" and "JSON-shaped YAML
whose string fields are multi-line prose." **This measured profile supersedes that framing;
it is the canonical target from here on.** The correction is deliberate, not a hedge:

- **Size — superseded from "medium-and-up" to "small config dominates by count, large tail
  dominates by bytes."** Most real YAML is small hand-written config, so the *by-count*
  common case is smaller than "medium and up," and per-call fixed overhead is a legitimate
  concern for that small-file mass (the tiny-document note's finding that *sub-microsecond*
  docs are not the target still stands — "small config" is not the same as "31-byte
  document"). The "medium-and-up" intuition survives only as the *by-bytes* view: the large
  generated tail is where throughput is spent. When the two axes pull against each other,
  optimize the small-file mass for fixed-overhead and the tail for linear-scan throughput —
  do not privilege "medium-and-up" as *the* case.
- **Shape — superseded from "JSON-shaped" to "block-style hand-written config."** The
  JSON-subset lens understates what real YAML contains: comments, literal block scalars, and
  `---` multi-document streams are routine and sit outside a JSON view entirely. The hot-path
  list above treats them as first-class, not as an afterthought bolted onto a JSON parser.

The prior wording is not edited out of the older notes (per the chosen scope: a new note
plus a pointer, not a rewrite of the dossier), but it no longer defines the target — this
note does.

### Related environment constraint: runtime codegen (`new Function`) under CSP

One candidate optimization is compiling a specialized parse/serialize function at runtime
via `new Function`. Two findings bound whether it can be relied on:

- Under Content-Security-Policy, `new Function` is gated by the **exact same
  `'unsafe-eval'`** keyword as `eval` — it is **not** less restricted (W3C CSP3 §4.4.1;
  MDN). When blocked it throws a **synchronous, catchable** error (an `EvalError` in
  browsers) — no user-facing dialog, no uncatchable crash — so a `try/catch` feature-probe
  works and can be cached. Note that a browser CSP additionally emits a one-time console
  violation report that the `try/catch` cannot suppress; probing lazily on first use keeps
  that off pages that never invoke the fast path.
- In practice `new Function` is available in the large majority of deployments: only ~22%
  of sites ship any CSP, and ~77% of those already allow `'unsafe-eval'`. The reliable
  hard-blocks are Manifest V3 browser extensions, Cloudflare Workers / edge isolates, and
  the security-conscious strict-CSP minority. So a codegen fast path is reasonable **as an
  optimization with a correctness-equivalent non-eval fallback**, selected by a cached
  feature-detect — never as a hard dependency.

## Provenance & sources

- **Repo:** `lightning-yaml`, branch `claude/yaml-corpus-benchmarking-s0g837`, at commit
  `6b44fe2`. This note records no measurements taken in this repo; the numbers below are
  external citations. Ratios/relative claims are the durable signal.
- **Nature of the yaml-test-suite:** <https://github.com/yaml/yaml-test-suite>
- **Downloadable corpora:** APIs.guru OpenAPI directory (CC0)
  <https://github.com/APIs-guru/openapi-directory>; MSR-2024 GitHub Actions workflow dataset
  (CC BY 4.0) <https://zenodo.org/records/15221545> (paper
  <https://decan.lexpage.net/files/msr-2024d.pdf>); Artifact Hub / archived Helm charts
  <https://artifacthub.io/>, <https://github.com/helm/charts>;
  <https://github.com/kubernetes/kubernetes>; Ansible Galaxy <https://galaxy.ansible.com/>;
  CloudFormation templates
  <https://github.com/aws-cloudformation/aws-cloudformation-templates>; Home Assistant
  configs <https://github.com/frenck/home-assistant-config>; broad sampling via BigQuery
  `bigquery-public-data.github_repos`.
- **Size / convention measurements:** GitHub Actions complexity study
  <https://arxiv.org/html/2507.18062v1>; GitHub Actions evolution study
  <https://arxiv.org/html/2602.14572v3>; OpenAPI spec bloat
  <https://maliuppal.medium.com/the-swagger-spec-problem-when-yaml-or-json-gets-too-big-full-godzilla-mode-eaad3c3ecf28>;
  pnpm-lock size/design <https://nesbitt.io/2026/01/17/lockfile-format-design-and-tradeoffs.html>;
  Kubernetes ~1.5 MB request cap
  <https://hiddenmanifestationcode.com/kubernetes-manifest-size-limit/>; 2-space indentation
  convention <https://ref.coddy.tech/yaml/yaml-formatting-guidelines>; Helm "flat over
  nested" <https://helm.sh/docs/chart_best_practices/values/>.
- **Feature-frequency signal (indirect):** StrictYAML removed features
  <https://hitchdev.com/strictyaml/features-removed/>; "Dear GitHub: no YAML anchors"
  <https://blog.yossarian.net/2025/09/22/dear-github-no-yaml-anchors>; `noyaml` catalog
  <https://github.com/ghuntley/noyaml/blob/master/index.html>; merge keys are 1.1-only
  <https://ktomk.github.io/writing/yaml-anchor-alias-and-merge-key.html>; the Norway problem
  <https://www.bram.us/2022/01/11/yaml-the-norway-problem/>.
- **CSP / `new Function`:** W3C CSP Level 3 <https://www.w3.org/TR/CSP3/> (§4.4.1); MDN
  `script-src`
  <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src>;
  2025 HTTP Archive Web Almanac, Security chapter
  <https://almanac.httparchive.org/en/2025/security>; Chrome MV3 extension CSP
  <https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy>;
  Cloudflare Workers compatibility flags
  <https://developers.cloudflare.com/workers/configuration/compatibility-flags/>.
- **In-repo cross-references:** the synthetic fixtures (`bench/fixtures/generate.ts`,
  `bench/fixtures/datasets.ts`); prior scattered statements of the target case in
  `2026-07-14-parse-multiline-speedup-lever.md`, `2026-07-14-parse-tiny-document-overhead.md`,
  `2026-07-14-memory-value-interning.md`, `2026-07-12-v8-optimization-guide.md`, and
  `2026-07-12-design-c-hybrid-parser.md`.
