---
title: "Can V8 regular expressions accelerate YAML parsing?"
description: "End-to-end scanner experiments, a V8 match-allocation audit, and native JSON delegation follow-ups"
optimization:
  name: "RegExp-based token and document scanning (parse)"
  conclusion: "V8 RegExp is excellent on long clean runs, but YAML's short spans and match-boundary overhead erase that advantage; the tested semantics-preserving scanner substitutions all lost to the existing parser or an equivalent specialized cursor."
  verdict: not-worth-it
---
**Verdict: Not worth pursuing for the parser's current hot paths.** This was a
thorough experiment: block-plain, double-quoted, and numeric scanners were
replaced in the real parser; simple and lookaround patterns were measured in
isolation; a restricted whole-file parser and a full JSON lexical recognizer
were also tested. Follow-ups audited RegExp result allocation and tried native
delegation for inline strict-JSON values. None of the semantics-preserving
RegExp substitutions improved an existing end-to-end benchmark. The useful
adjacent result was a guarded `JSON.parse` route for strict JSON documents,
which is a native parser delegation rather than a regular-expression
optimization.

**Estimated benefit:** zero on the current representative YAML benchmarks.
RegExp remains situationally attractive for a future workload dominated by
long, clean spans, but only after an end-to-end profile proves that those spans
are common enough to repay the call and result-handling overhead.

<!-- ly:e65525c -->

**Rigor:** thorough experiment. Parser substitutions and isolation probes were
correctness-checked and benchmarked; the later inline-value work was an
exploratory, workload-specific follow-up rather than an adopted path.

## Why the idea was plausible

V8 does substantially more than interpret a pattern character by character.
Its Irregexp engine first executes RegExp bytecode, then tiers a reused pattern
up to specialized native code. The default tier-up counter is one execution,
and long subjects can tier up eagerly. That makes a character-class search a
credible way to borrow engine-native scanning.

That is not quite the same as “the regex runs in C.” The interpreter is written
in C++, hot patterns become machine code, and the JavaScript call still crosses
through a RegExp builtin and updates `lastIndex`. `RegExp.prototype.exec()` also
returns a result array and materializes participating capture strings. Most
scanner candidates here, however, used capture-free `.test()` with `lastIndex`,
so match-result allocation does not explain their losses. JavaScript has no flag
that forces captures to be string-slice views, and `/d` adds match indices rather
than suppressing capture strings. Those fixed costs still matter when the
average YAML key or scalar is short. Advanced syntax is not automatically faster
either: lookahead and lookbehind exclude V8's experimental non-backtracking
fallback, leaving the ordinary backtracking Irregexp engine responsible for the
pattern.

The engine details come from V8's
[RegExp tier-up](https://v8.dev/blog/regexp-tier-up),
[non-backtracking-engine](https://v8.dev/blog/non-backtracking-regexp), and
[JIT-less V8](https://v8.dev/blog/jitless) notes.

<!-- ly:e65525c -->

## Method

All parser candidates were correctness-checked before timing. The experiments
used the generated plain-block and rich-YAML fixtures, plus strict-JSON record
fixtures. Timings were medians after warmup; the final isolation rerun used a
Dockerized Node process pinned to one CPU. Ratios matter more than absolute
nanoseconds on the virtualized host.

The tested forms were:

- a global candidate search, `/[:#\r\n]/g`, followed by the existing contextual
  checks for `: ` and whitespace-preceded `#`;
- a sticky pattern with negative lookbehind and lookahead encoding those rules
  in the expression itself;
- manual-first hybrids that switched to the candidate search after a short
  prefix;
- sticky recognizers for escape-free double-quoted strings and JSON numbers;
- a global line matcher that materialized a restricted `key: integer` document;
- one anchored, repeating JSON-token expression intended to recognize a whole
  strict-JSON document before parsing it;
- a result-allocation audit comparing `.exec()` with result-free `.test()`,
  using zero, one, and four capture groups.

A later follow-up also compared guarded inline strict-JSON value delegation on
synthetic hit-heavy documents, YAML-valid late failures, randomized differential
inputs, and the candidate values available in repository fixtures and lockfiles.
The experimental implementation was removed after measurement.

## Did capture allocation cause the losses?

V8's `.exec()` path eagerly constructs a result array and asks the string
factory for the whole match and every participating capture. Named groups add
an object, and `/d` adds an indices array after those strings have already been
materialized. `.test()` has a separate result-free fast path: with a reused
global or sticky expression, the caller can read the end position from
`lastIndex` without consuming a match array.

Capture storage is engine-dependent, but it is not allocation-free. In the
tested Node 24 source, V8's substring cutoff is 13 UTF-16 code units. Shorter
substrings are copied; longer ones may use a `SlicedString` view when the
engine's internal slicing mode permits it. The view still needs its own header
and retains its parent string. This is internal V8 machinery, not a JavaScript
flag a library can force.

<!-- ly:e65525c -->

For the 4–128-code-unit spans most relevant to ordinary YAML fields, the
isolation measurements show that avoiding the result object matters, but not
enough to reverse the parser verdict:

| Comparison | Relative time |
|---|---:|
| global `.exec()`, one capture versus none | 14–22% slower |
| global `.exec()`, four captures versus none | 36–45% slower |
| capture-free `.test()` versus capture-free `.exec()` | 33–41% less time |
| sticky `.test()` versus sticky `.exec()` | 13–47% less time |

<!-- ly:e65525c -->

The block candidate search, sticky lookaround probes, hybrids, length sweep,
JSON lexical recognizer, and depth-token scan already used non-capturing patterns
with `.test()`. Only the restricted whole-document line matcher relied on
`.exec()` with two captures, so allocation contributed to that result but cannot
explain the main end-to-end regressions.

<!-- ly:e65525c -->

## Block-plain scanning

The isolation result explains both the appeal and the failure. On real scalar
starts, always entering RegExp was slower. A manual-first hybrid occasionally
won inside the scanner on the larger fixtures, but the win did not survive the
actual parser.

| Fixture | Manual (ns/span) | Candidate RegExp | Lookaround RegExp | Best hybrid |
|---|---:|---:|---:|---:|
| medium records | 16.39 | 45.74 | 55.24 | 22.23 |
| large records | 32.08 | 35.93 | 44.32 | 29.91 |
| medium nested | 37.02 | 47.52 | 60.09 | 34.35 |
| rich medium | 35.11 | 49.68 | 58.01 | 30.22 |

<!-- ly:e65525c -->

The most favorable hybrid was then inserted into `scanBlockPlainEnd`. Medium
records moved from 1.735 ms to 1.952 ms and large records from 17.916 ms to
18.805 ms. Nested and rich inputs were effectively flat. In other words, an
isolated scanner improvement of up to about fourteen percent became a parser
regression of five to thirteen percent where it mattered. The hybrid was
removed.

<!-- ly:e65525c -->

The fully sticky lookaround replacement was less competitive: the four
representative block/rich parses regressed by 3.5–12.8%. It made the grammar
compact, but compact source is not the performance objective.

<!-- ly:e65525c -->

## Long clean runs do favor RegExp

A length sweep over a clean plain-scalar run showed a real crossover around
twelve to sixteen characters. At four characters, the simple RegExp was about
three times slower than the loop. By sixty-four characters it was about five
times faster; at 4,096 characters it was over fifty times faster. The lookaround
pattern improved much less, reaching only about 2.5 times the loop's throughput
at the longest tested run.

<!-- ly:e65525c -->

This does not contradict the end-to-end result. Most keys and values in the
fixtures stop before the native scanner's fixed cost amortizes, and the parser
already uses `indexOf` for genuinely long line and block-scalar hops. A length
threshold cannot know that a scalar is long without first finding its end; the
manual-first hybrid is the practical approximation, and it lost in context.

## Quoted strings and numbers

The existing double-quoted fast path uses `indexOf` plus memoized backslash and
newline positions. Adding a sticky `"[^"\\\r\n]*"` probe before it made the
medium and large JSON record parses 10.3% and 13.1% slower. The RegExp duplicated
work already handled by an engine-native substring search.

<!-- ly:e65525c -->

A sticky JSON-number recognizer before the hand-written accumulator made the
same inputs 6.4% and 9.1% slower. Even if recognition were free, captures or a
slice still have to be converted to a number, while the current integer path
accumulates digits directly into the result.

<!-- ly:e65525c -->

## How far can one whole-document expression go?

For a deliberately tiny grammar—ASCII identifier keys, one space after the
colon, signed decimal integers, and one pair per line—a global line RegExp was
faster than the general YAML parser. On roughly 100 KB and 1 MB documents it
took 55% and 53% of the general parser's time. However, an equivalent specialized
cursor took only 74% and 83% of the RegExp parser's time. The specialization was
the large win; RegExp was not the best implementation of that specialization.

<!-- ly:e65525c -->

One repeating capture cannot build an arbitrary document: JavaScript retains
only the final value of a capture group under repetition. A global matcher can
return every line or token, but JavaScript must still allocate/materialize the
matches and maintain indentation, nesting, anchors, aliases, tags, and mapping
state. Arbitrary YAML nesting and indentation are not regular, so a whole-YAML
RegExp becomes a lexer feeding a parser rather than a replacement for one.

The anchored JSON-token recognizer exposed another hazard. Its first numeric
alternative allowed tokens to be repartitioned during a late failure, causing
extreme backtracking. Adding a numeric boundary fixed that case; the corrected
expression scanned valid fixtures at roughly 400–440 MB/s, but it was still an
extra complete pass before either `JSON.parse` or the YAML parser. More elaborate
lookarounds would also make V8's excessive-backtrack fallback unavailable.

<!-- ly:e65525c -->

## The adjacent win: guarded native JSON parsing

Strict JSON containers are a semantic subset of this parser's YAML contract, so
delegating them directly to `JSON.parse` avoids token-by-token JavaScript work.
The implemented route is intentionally conservative: it applies only with no
options, at a source length of at least 512 UTF-16 code units, after
root/first-token/tail checks, and only when the source contains no backslash. A
result-tree walk retains the parser's nesting limit; every failed or ineligible
attempt falls back to the full parser.

In the retained Node 24 paired run, default parsing was 1.72× faster on medium
records, 1.62× on medium nested data, and 1.85× on large records than the forced
full parser. Across Node 20, 22, and 24, paired validation put the range at
1.58–2.11×. A first-token rejection was within 1.3% of the full parser, while a
JSON-looking YAML document with a near-EOF trailing comma was 1.38–1.54× slower
because it paid for the native attempt and the fallback.

<!-- ly:e65525c -->

The backslash exclusion is a correctness guard, not a heuristic. A differential
audit found that current V8 shape feedback can substitute the wrong escaped
object key on repeated `JSON.parse` calls. The standalone reproducer was correct
on Node 20 and 22 but failed on Node 24, 25, and 26, spanning V8 13.6 through
14.6. The hand-written parser stayed stable. Until the affected engine behavior
is fixed and aged out of supported runtimes, escaped documents remain on that
path.

<!-- ly:e65525c -->

## Follow-up: inline strict-JSON values

A later prototype tried the same native delegation at a narrower boundary: a
direct block-mapping value beginning with `{` or `[`. It found the end of the
physical line, sliced that bounded range, applied cheap first-token, tail, and
backslash checks, then called `JSON.parse`; failures returned to the ordinary
flow parser. Slicing itself was negligible. An early version accidentally used
unbounded backslash and carriage-return searches from every candidate to the end
of the document, creating quadratic behavior; slicing the line before those
searches removed that artifact.

On synthetic documents deliberately filled with successful one-line values,
delegation became valuable around the size expected from line-wrapped output and
grew into a substantial win:

| Approximate value length | Strict object | Strict array |
|---:|---:|---:|
| 32 code units | 0.94× | 0.94× |
| 64 code units | 1.14× | 1.41× |
| 96 code units | 1.26× | 1.58× |
| 128 code units | 1.36× | 1.73× |
| 256 code units | 2.35× | 2.24× |
| 512 code units | 2.44× | 2.73× |

<!-- ly:e65525c -->

The miss path changes the decision. A direct failing `JSON.parse` took roughly
5.7–6.6 µs, while the combined native exception and YAML retry added about
11.2–14.6 µs per failed value in the size sweep. Repeated YAML-valid late
failures made complete documents 7.8–8.2× slower than direct YAML parsing.
Without a per-document circuit breaker, values around 64–128 code units needed
approximately 93–99% successful hits to break even; even 512-code-unit values
needed about 75%. A breaker after the first native failure contains repeated
misses but cannot repay that first exception in a short document.

<!-- ly:e65525c -->

Correctness was not the blocker: 5,000 randomized differential cases produced
4,488 eligible candidates, all with parity between the prototype and the full
parser. The blocker was whether qualifying successes exist in the target data.

<!-- ly:e65525c -->

The available corpus survey used the same direct-mapping, one-physical-line
candidate rule. “Useful” below means a non-empty strict-JSON value at least 48
code units long, the lowest plausible threshold from the synthetic sweep.

| Sample | `{`/`[` candidates | Strict-JSON hits | Useful hits |
|---|---:|---:|---:|
| generated benchmark YAML | 891 | 891, all `[]` | 0 |
| yaml-test-suite samples | 25 | 2, both empty | 0 |
| three repository pnpm lockfiles | 2,262 | 293, all `{}` | 0 |
| GitHub configuration and reference samples | 96 | 87 | 0 |

The final sample had eight non-empty strict values, but every one was an array
of at most 15 code units; none was a non-empty object. Across all four samples,
there was therefore no representative value large enough to exercise the
synthetic win.

<!-- ly:e65525c -->

### What about JSON-like YAML?

The pnpm lockfiles explain why a broader-looking opportunity does not qualify:
of 1,969 non-JSON candidates, 1,392 used unquoted YAML flow-mapping keys, and the
90th-percentile candidate length was 108 code units. Those values are common and
large enough, but they are not input that `JSON.parse` accepts.

<!-- ly:e65525c -->

Regex-normalizing those keys did not provide a safe general bridge. A simple
replacement was 1.44–1.87× faster end to end, but it also rewrote key-shaped
text inside quoted strings. A quote-aware expression ranged from 0.99× at about
80 code units to 1.14× at 512, with replacement itself taking 75–82% of total
time; it still covered only backslash-free inputs whose values already had JSON
semantics. Normalizing bare strings, YAML booleans and nulls, comments, and
nested quoting turns the preprocessing pass back into a parser.

<!-- ly:e65525c -->

A separate, non-RegExp repeated-key shortcut reached 1.25–1.30× on homogeneous
synthetic flow mappings but recorded zero hits on all three real lockfiles. The
real-file timings moved by 2–4% despite that zero hit count, so the movement is
code-layout noise rather than evidence for the cache. A scoped or multi-shape
cache is still a possible independent experiment; it is not evidence for native
JSON delegation.

<!-- ly:e65525c -->

Inline delegation is therefore viable for a measured workload dominated by
successful medium or large embedded strict-JSON values. It is not part of the
shipped whole-document route and cannot improve the repository's current
representative benchmarks because those benchmarks contain no qualifying hit.

## Stringification

RegExp has no corresponding structural advantage while producing output.
`JSON.stringify(value)` already emits valid flow-style YAML for JSON-compatible
trees, so regex-replacing brackets and commas into block layout would add a
second pass and would need to understand strings and nesting to avoid rewriting
punctuation inside quoted content. Once that state exists, it is a serializer.

More importantly, an automatic JSON route would change the current block-style
output and mishandle YAML-only values and graph semantics such as aliases,
cycles, binary data, non-finite numbers, and negative zero. A future explicit
JSON-flow output mode could call `JSON.stringify` directly; a regex conversion
stage would add cost without restoring those semantics.

## Recommendation

Keep the current hand-written token scanners and their `indexOf` fast paths. Do
not add a RegExp pre-lexer or a speculative whole-document RegExp. Revisit only
if a new corpus shows a dominant population of long clean spans, and require an
end-to-end improvement rather than accepting an isolated scanner result.

Retain the guarded native-JSON route as the measured document-level speedup,
while reporting JSON and block/rich YAML separately. The late-failure penalty is
the explicit tradeoff; the options argument remains a convenient way for the
benchmark harness to measure the full parser independently.

Do not ship speculative inline-value delegation on the current evidence.
Reconsider it only for a measured workload with a high successful strict-JSON
hit rate and a bounded first-failure cost. A scoped repeated-flow-key cache is a
separate possible investigation for JSON-like YAML with unquoted keys; the
tested global single-shape cache did not help the available lockfiles.

**Confidence:** high for the tested parser and fixtures, and moderate for the
inline-value rejection because its opportunity survey is limited to the
available corpora. The exact crossover length is engine- and workload-dependent,
but every adoption decision here was made from end-to-end parser measurements
across multiple fixture shapes.

## Code references

- Block plain-scalar scanner and folding: `scanBlockPlainEnd`,
  `foldBlockPlainRemainder` in `src/core.ts`.
- Quoted and numeric paths: `parseDoubleQuoted`, `tryFlowNumber`, and
  `tryBlockNumber` in `src/core.ts`.
- Native strict-JSON route: `tryNativeJson` and `jsonWithinDepth` in
  `src/core.ts`.

## Provenance & sources

- Repo: `lightning-yaml` based on commit `e65525c` on `main`; the native-JSON
  candidate and regression tests were an uncommitted working-tree patch during
  measurement.
- Primary runtime: Docker `node:24-bookworm-slim`, Node 24.18.1 / V8
  13.6.233.17-node.50. Cross-runtime native-route checks also used Node 20.20.2 /
  V8 11.3 and Node 22.16.0 / V8 12.4.
- Machine: 16-vCPU AMD EPYC-Rome KVM host; final microbenchmarks and paired
  native-route measurements were pinned to CPU 0. The inline follow-up ran in
  Docker without another benchmark process; exploratory substitutions were
  fail-fast measurements subject to ordinary virtualized-host noise. Final
  candidate comparisons used repeated medians and correctness parity checks.
- Inputs: generated `medium-records`, `large-records`, `medium-nested`,
  `yaml-plain-medium-records`, `yaml-plain-large-records`,
  `yaml-plain-medium-nested`, and `yaml-rich-medium` fixtures. The inline survey
  additionally inspected generated benchmark YAML, yaml-test-suite samples,
  `pnpm-lock.yaml`, `site/pnpm-lock.yaml`, `bench/bundlesize/pnpm-lock.yaml`, and
  `.github/**/*.yml` plus `test/corpus/currencycloud-reference.yaml`. Its
  prototype and randomized probe were scratch experiments and were not retained
  in production.
- Engine sources: V8's official
  [RegExp tier-up](https://v8.dev/blog/regexp-tier-up),
  [non-backtracking RegExp](https://v8.dev/blog/non-backtracking-regexp), and
  [JIT-less mode](https://v8.dev/blog/jitless) articles.
- RegExp result construction: Node 24's vendored V8
  [`.exec()` result builder](https://github.com/nodejs/node/blob/v24.18.1/deps/v8/src/builtins/builtins-regexp-gen.cc#L198-L337),
  [result-free `.test()` fast path](https://github.com/nodejs/node/blob/v24.18.1/deps/v8/src/builtins/regexp-test.tq#L11-L33), and
  [substring factory](https://github.com/nodejs/node/blob/v24.18.1/deps/v8/src/heap/factory.cc#L1089-L1138).

<!-- ly:e65525c -->
