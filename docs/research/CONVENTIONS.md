# docs/research — conventions

How research notes in this folder are written and named. Read this before creating or editing one.
It describes principles and a flexible structure, not a rigid template — different investigations need
different shapes.

## What this folder is

A flat, blog-style collection of **dated, standalone research notes**. Each note covers one
question, hypothesis, or investigation — a performance idea, a memory experiment, a correctness study,
a survey of how other libraries solve something. A reader should be able to open any single file and
understand it on its own.

## Filename and layout

- **Flat.** Everything lives directly in `docs/research/` — no subfolders.
- **Name:** `YYYY-MM-DD-<goal-describing-slug>.md`, where the date is when the work was done. Lead the
  slug with the domain so the topic is obvious from the filename alone — a reader should be able to
  tell whether a note is about performance, memory, correctness, or a comparison with other libraries
  without opening it. Examples: `2026-07-14-stringify-speedup-via-key-caching.md`,
  `2026-07-14-memory-value-interning.md`, `2026-07-12-wasm-route-evaluation.md`.
- **Two non-dated files** are special: this `CONVENTIONS.md` (the guide) and `README.md` (the folder
  index).

## What every note must deliver

The reader should come away understanding *what* was investigated, *how*, *what the result was*, and
*how confident* we are — able to follow the full chain of reasoning to the conclusion. Put the bottom
line near the top: a **verdict**, a rough **benefit/impact estimate**, and whether the work was a
quick **fail-fast probe** or a **thorough experiment**. Keep every number and nuance; this is a
scientific record, not marketing copy.

## Recommended structure (adapt as the work demands)

A typical note, top to bottom. Drop or merge sections that don't fit the investigation.

1. **Title** — plain-English and goal-describing.
2. **Abstract** (2–4 lines) — the **Verdict**, the estimated benefit (which axis, which audience), and
   the rigor (fail-fast vs thorough).
3. **Background** — the theory: why we expected this to help.
4. **Method / experiment** — what we did, the fixtures, how it was measured; state fail-fast vs
   thorough, and note if measurements were taken under concurrent load.
5. **Results** — the numbers.
6. **Interpretation & recommendation** — what the numbers mean, the recommendation, and the estimated
   benefit with a confidence level and the audience it applies to.
7. **Provenance & sources** — a **footer at the very bottom** (like a bibliography): repo commit +
   branch, runtime/versions, machine, and the data used. Citations and version details go here, not
   at the top of the file.

## Verdict vocabulary

Use one of these in the abstract; do not invent ad-hoc words, and do not use "yay"/"nay":

- **Worth pursuing** — the evidence supports it; recommend implementing or a deeper follow-up.
- **Not worth pursuing** — a measured non-win or dead end (still a valuable note).
- **Inconclusive** — a fail-fast probe that didn't settle it; say what a deeper test would need.
- **Reference / ceiling** — an informational bound or fact, not a change to make now.

## Tone and wording

- **Readable prose.** Clear, complete sentences a senior developer can skim and then dig into. Keep
  the rigor and the numbers, but avoid dense, telegraphic shorthand that has to be decoded word by
  word.
- **Compare performance against built-in `JSON.parse` / `JSON.stringify`**, not against other YAML
  libraries — matching JSON is the bar this project cares about.
- **Avoid words with unnecessary negative connotation** in what will become public docs — for example
  write "borrow", "adopt", or "transferable", not "steal".
- **Report honestly.** Per the repo's non-negotiable benchmark-integrity rule, never tune, cherry-pick,
  or phrase to flatter the library. A well-documented negative result is as valuable as a positive one.

## Referencing source code

Keep `file:line` locations out of the main prose — they clutter the read and go stale. In the body,
refer to code by **function or concept name** ("the block-scalar parser", "the key-quote cache"),
which stays readable without line numbers. Make the exact locations available separately so that
reproducing the work or diving into the code stays easy:

- If a **few lines of code are genuinely load-bearing** to the argument, quote them inline in the
  report — the reader should not have to open the file to follow the point.
- Otherwise, collect the exact locations in a short **"Code references" list near the bottom** (a
  bibliography: concept or function name → `src/index.ts:3900`), and refer to them by name in the
  body. A longer excerpt belongs in an **appendix** at the end, not in the middle of the argument.

The main read should flow in plain language; the precise coordinates sit one glance away at the
bottom for anyone who needs them.

## Provenance footer — include what the note relies on

The repo commit and branch, the Node/V8 version, the machine, the fixtures or data, and whether numbers
were taken under concurrent load. Remember that ratios are the durable signal and absolute
milliseconds are machine-specific.
