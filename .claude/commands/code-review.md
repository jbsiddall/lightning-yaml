---
description: "Code review — run when a PR looks ready for the user to review; spawns the code-review-* reviewer subagents in parallel (their prompts live in their own files), runs the gate concurrently, and loops until every reviewer approves the current commit."
argument-hint: "[optional: a single reviewer name to run, or a focus area]"
---

You are the **top-level assistant** driving code review for `lightning-yaml`. You do **not**
review the change yourself — you orchestrate a panel of independent reviewer subagents, act
on what they find, and re-run them until they all sign off on the current commit.

Run this **when you judge the PR is ready for the user to review** — the panel catches what
a careful reviewer would, so the user's own time goes to a change that's already been
vetted, not to issues a reviewer subagent could have caught. The panel is expensive, so run
it **once per PR at that ready point — not after every commit**. **Re-run it every time the PR
is updated and again reaches that ready-for-review point**, looping (Step 3) until every
reviewer approves the latest commit before you hand the PR back.

## How it's wired

- **You run at the top level, not as a subagent** — a subagent can't spawn its own
  subagents, so fanning the panel out has to happen here.
- **Each reviewer's full prompt lives in its own file** — `.claude/commands/code-review-<name>.md`,
  with the shared rules in `.claude/code-review-preamble.md`. You spawn each reviewer with a
  **tiny** prompt that just points at its file, so you never re-emit the big prompts (that's
  the token saving). A spawned subagent can't run slash-command interpolation, so each
  reviewer file tells the subagent to read the preamble itself.
- **All reviewers run in parallel** — spawn every in-scope one in a SINGLE message. This is
  critical for speed; never serialize them.
- **Reviewers are read-only.** The heavy/mutating work — the gate, applying fixes — is
  yours.

## The panel

| Reviewer file (`.claude/commands/`) | Model | Domain — re-run only if a touched file matches |
| --- | --- | --- |
| `code-review-consistency`    | Sonnet · max | `src/**`, `test/**`, `bench/**` |
| `code-review-comments`       | Sonnet · max | any git-tracked source file (not gitignored), except `bench/yaml-test-suite/**` and `test/corpus/**` |
| `code-review-complexity`     | Sonnet · max | `src/**`, `bench/**`, `test/**`, or any new file/script |
| `code-review-spec`           | Sonnet · max | `src/**` |
| `code-review-compat-yaml`    | Sonnet · max | `src/yaml-compat.ts`, `src/core.ts`, `src/index.ts` |
| `code-review-compat-js-yaml` | Sonnet · max | `src/js-yaml-compat.ts`, `src/core.ts`, `src/index.ts` |
| `code-review-performance`    | Sonnet · max | `src/**` |
| `code-review-newcomer`       | Sonnet · max | `README.md`, `site/**`, `src/index.ts`, `src/*-compat.ts`, `CHANGELOG.md`, `.changeset/**`, or user-visible behavior |

## Step 1 — set up

```bash
git fetch origin main --quiet 2>/dev/null || true
BASE=$(git merge-base HEAD origin/main 2>/dev/null || echo main)
HEAD_SHA=$(git rev-parse --short=12 HEAD)
git diff --name-only "$BASE"...HEAD    # intersect with each reviewer's Domain for scope-gating
```

Review files live under the already-gitignored `.scratch/`, one per reviewer per commit:
`.scratch/code_review_<name>_<HEAD_SHA>.md` (the sha in the filename keeps reviews across
commits from overwriting each other). Only spawn a reviewer whose Domain intersects the touched
files (or that has no file for the current `HEAD_SHA` yet); an untouched-domain reviewer keeps
its prior approval. On a re-review, pass the reviewer its previously-reviewed sha as `PREV` so
it diffs only `PREV..HEAD`.

## Step 2 — launch the gate AND the panel together (one message)

Reviewers are read-only, so the gate can run in the SAME tree alongside them — don't make
the panel wait on it. In one message:

- **Spawn every in-scope reviewer in parallel** (Task tool, fresh non-fork subagent, model
  per the table). Each prompt is tiny:
  > Read `.claude/commands/code-review-<name>.md` and follow it exactly. BASE=`<sha>`,
  > HEAD=`<sha>` (add PREV=`<sha>` on a re-review). Write your review to
  > `.scratch/code_review_<name>_<HEAD>.md`. Gate output (if any) is under `.scratch/gate/`;
  > any repro goes in `.scratch/code-review-<name>-playground/`. Work strictly read-only.
- **Cap this round at ~5 minutes.** Spawn the reviewers as background tasks and record each
  one's task ID against **this `HEAD_SHA`**. Set a ~5-minute timer for the round; when it fires,
  `TaskStop` any of THIS round's reviewers still running and harvest their partial review files
  (the append-as-you-go review log means a stopped reviewer still leaves its findings behind).
  Never touch a different round's reviewers — a later commit's reviewers carry a different
  `HEAD_SHA` and their own timer.
- **Start the gate** (only if the diff touches `src/` or `bench/`) as parallel Bash calls,
  after generating fixtures/suite once so they don't race:

  ```bash
  mkdir -p .scratch/gate && pnpm gen:fixtures && pnpm gen:suite      # once, sequential (~4s)
  # then, in parallel Bash tool calls, each  … 2>&1 | tee .scratch/gate/<name>.txt :
  #   pnpm typecheck · pnpm test · pnpm test:unit · pnpm test:stringify · pnpm test:suite · pnpm test:compat
  ```

  The fast checks are ~40s wall-clock in parallel (bounded by `pnpm test`), which overlaps
  the reviewers rather than blocking them. **Benchmark separately** — it needs a quiet
  machine, so never alongside the checks above, and `bench:self` runs well over a minute:
  **leave perf to the CI benchmark job** (the `performance` reviewer then reads CI's numbers
  or marks its verdict pending-CI). The gate is YOUR empirical check — a red gate is blocking
  at adjudication regardless of what the reviewers say, and a failing test never stops the
  reviewers from surfacing their own issues. If the diff touches neither `src/` nor `bench/`,
  skip the gate — the guardians fast-path to a neutral approval.

## Step 3 — fix as reviews arrive, adjudicate, loop

**Don't idle until the whole panel is back.** Reviewers finish at different times, so the moment
a reviewer's file lands with a finding that needs work, **dispatch a fix subagent for it** —
don't wait for the others. A fix subagent is
**Sonnet 5**; escalate to **Opus** only for a *substantial* fix (a real code change or multi-file
reasoning, not a one-line doc or comment tweak). Fix subagents WRITE to the tree, so honor
CLAUDE.md's single-writer rule: run **one tree-writing fixer at a time** (queue a later reviewer's
fixes behind the current one) or isolate concurrent fixers in their own `git worktree`s. Reviewers
stay read-only off a committed hash, so they never race a fixer — but the gate runs in the shared
tree too, so if it's still going when you start a fixer, let it finish first (or run the fixer in a
worktree) so the fix can't corrupt the gate run.

Read each `.scratch/code_review_<name>_<HEAD_SHA>.md` and take its verdict — the final
`APPROVED` / `CHANGES REQUESTED` line. Two special cases: a reviewer with **no file** for the
current `HEAD_SHA` is stale → re-run it if its Domain was touched, passing its
previously-reviewed sha as `PREV`; a file with findings but **no verdict line** was stopped at
the round cap → act on the findings it logged and re-run it if you still need its verdict (it
does not count as `APPROVED`). Run any in-file **instruction to the top-level** a reviewer left
(a fix to apply, a command to run) so its result is available next pass. Combine with the gate
result (a red gate blocks).

**Precedence when champions conflict** (higher wins; a lower reviewer's finding that
contradicts a higher one is not blocking — mirrors CLAUDE.md's source-of-truth order):

1. `spec` — YAML 1.2.2 correctness.
2. CLAUDE.md policy — `comments` and `newcomer` (docs honesty, integrity & audience-voice).
3. `compat-yaml` / `compat-js-yaml` — drop-in parity (their asks yield to `spec`).
4. `performance` — no speed/memory regression.
5. `consistency` — structure/naming/reuse (yields to policy — so `comments` beats
   `consistency` on comment density).
6. `complexity` — maintainability/risk; advisory unless egregious.

**README-registry rule for guardian divergences:**

- A divergence tagged `(sanctioned — README)` is non-blocking. If a guardian still refuses to
  approve over a divergence that *is* in README's Decisions section, you may **override** it —
  README is authoritative on what's allowed.
- A divergence marked blocking because it is **not** in README's Decisions section: don't
  proceed alone. Either (a) it's an accidental bug → fix it; or (b) it's a deliberate choice →
  **stop and ask the user** (`AskUserQuestion`) whether to fix it or add it to README's
  Decisions section. Don't add a deviation to README yourself, and don't merge past it.

**How to handle each finding — decide before you fix:**

- **Pre-existing, not introduced by this PR** — the same problem reproduces on `BASE` (it
  predates your diff). Don't grow this PR's scope to fix it: **file a GitHub issue** (or fold it
  into an existing one, linking that instead of opening a duplicate) and list it — one line, with
  the issue link — under **Flagged but not fixed in this PR** in the PR description. The one
  exception is an *unsanctioned guardian divergence*, which still follows the README-registry
  escalation above (ask the user).
- **A `spec` / `compat` finding** (`spec`, `compat-yaml`, `compat-js-yaml` — a divergence from the
  YAML 1.2.2 spec or from the `yaml` / `js-yaml` drop-in): **write a failing test first.** Look
  for an existing case that already covers it in the repo's own tests (`test/**` — a `*.unit.ts`
  case, or the `test:compat` suite); if none, add one that reproduces the bug and **confirm it
  FAILS**, then fix until it passes. A fix without a red-first test isn't proven, so don't skip
  that step. (`performance`, `comments`, `complexity`, `consistency`, `newcomer` findings rarely
  reduce to a unit test — skip the test step and just fix them.)

Then: fix every remaining `CHANGES REQUESTED` (test-first where the rule above applies); for each
non-blocking suggestion under an `APPROVED`, apply it or **list it under _Flagged but not fixed in
this PR_** with a one-line reason you didn't (never silently drop it). Push fixes (new HEAD),
re-run only the reviewers whose Domain the new commits touched, and repeat until every reviewer's
latest section is at the current `HEAD_SHA` and ends `APPROVED`. Don't edit a reviewer's file to
change its findings.

## Step 4 — record the sign-off

Tick the PR description's **Code review** checkbox and set the reviewed-commit hash to the
current `HEAD_SHA`. A later push makes it `!= HEAD` — the signal to re-run (when the PR is
again ready for review) and update it.

Then fill in the description's **Flagged but not fixed in this PR** list: one line each for
everything the panel raised that this PR is deliberately *not* fixing — a pre-existing problem
you filed as its own issue (link it) and any non-blocking suggestion you consciously deferred
(with the one-line why). Leave it as `None` if there's nothing. This is the human reviewer's
at-a-glance record of what we're knowingly letting through, so keep it honest and complete.

## Boundaries

✅ Run when the PR is review-ready · spawn all in-scope reviewers in parallel with tiny
file-pointer prompts · run the gate concurrently (parallel calls; bench deferred to CI) and
own its pass/fail · start fixing the moment each reviewer returns (fix subagents on Sonnet 5,
Opus for a substantial fix) rather than waiting for the whole panel · write a failing test
before fixing any `spec`/`compat` finding · file a GitHub issue for a pre-existing problem
instead of fixing it here · list every let-through item (filed issue or deferred suggestion) in
the PR description · resolve champion conflicts by the precedence order · gate guardian
divergences on README's Decisions section, escalating unsanctioned ones to the user · loop
until every reviewer approves the current HEAD.
🚫 Don't serialize the reviewers · don't review the change yourself in place of the panel ·
don't let a reviewer mutate the tree (they're read-only — isolate in
`.scratch/code-review-<name>-playground/` or defer
to you) · don't sit idle until the whole panel is back before starting fixes · don't fix a
`spec`/`compat` finding without a red-first test · don't expand this PR's scope to fix a
pre-existing problem (file it instead) · don't silently drop or silently defer a flagged
finding · don't soften a reviewer's prompt or edit its file to change a verdict · don't treat
CLAUDE.md/comments/notes as sanctioning a deviation (only README's Decisions section does) ·
don't add a deviation to README without the user's decision · don't commit the
`.scratch/code_review_*.md` files.
