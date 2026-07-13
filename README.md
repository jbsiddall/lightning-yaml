# `benchmark-data` — Lightning YAML benchmark results

This is an **orphan branch**. It shares no history with `main` and holds **only
benchmark data** (YAML). Keeping it orphan means the high-frequency data commits
produced by CI never pollute the site's code history on `main`.

Do **not** put site code here. Site code lives on `main`; this branch is data only.

## Layout — one file per benchmark suite

Each self-contained benchmark suite owns exactly one file. A suite "takes
ownership" of its file and its schema:

| file               | suite       | measures                                             |
| ------------------ | ----------- | ---------------------------------------------------- |
| `speed.yaml`       | speed       | per-iteration wall time, parse + stringify (mitata)  |
| `memory.yaml`      | memory      | peak RSS + V8 heap delta, isolated child processes   |
| `conformance.yaml` | conformance | yaml-test-suite pass rate                            |

New suites get their **own new file** (e.g. a future `bundle-size.yaml`) — they
do not squeeze into an existing one.

## Format — append-only, multi-document YAML

Every file is a stream of YAML documents separated by `---`. **Each document is
one full run**: a snapshot of every workload/library at a point in time, stamped
with `generated` and `source`.

A CI job records a new run by **appending** a document — it never reads, edits,
or rewrites what is already there:

```bash
# a CI benchmark job, at the end of its run:
{
  echo '---'
  ./emit-speed-run-as-yaml.sh     # prints one document (no leading '---')
} >> speed.yaml
git commit -am "bench(speed): run for $GITHUB_SHA"
```

Because it is pure append, runs accumulate as history, there is no
read-modify-write, and concurrent jobs don't collide on the same lines.

## How the site consumes it

The Astro site reads a file with the `yaml` package's `parseAllDocuments`, giving
an array of runs. **The newest document is rendered by default**; older documents
are available for trend/history charts.

```js
import YAML from 'yaml'
const runs = YAML.parseAllDocuments(text).map((d) => d.toJS())
const latest = runs.at(-1)   // newest run wins
```

## Units (canonical, so charts need no conversion)

- **speed** — `ns/iter` (nanoseconds per iteration), lower is better.
- **memory** — `peak_rss` in `MB`, `heap_delta` in `KB` (may be negative); lower is better.
- **conformance** — `score` is a percent pass rate; higher is better.

## Seed data

The first document in each file was seeded from the committed benchmark tables in
`README.md` on `main` (`source: README.md@<commit>`). CI replaces this as the
source of truth by appending real runs over time.
