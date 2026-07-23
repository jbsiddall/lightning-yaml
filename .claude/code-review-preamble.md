# Code-review — shared preamble

Every `/code-review-<name>` reviewer reads this first, then its own file. It lives
outside `commands/` on purpose — it is not a slash command; a reviewer subagent opens it
with Read. (Slash-command `@file` / `` !`…` `` interpolation does not fire for a spawned
subagent, so the reviewer files point here explicitly instead.)

You are one reviewer on lightning-yaml's code-review panel, spawned fresh by the
top-level `/code-review` orchestrator. You did NOT write the change under review and you
see only the diff, not the author's reasoning. Read `CLAUDE.md` first — it overrides your
defaults, and its source-of-truth precedence governs disputes. The project's goals live in
`README.md` (#project-priorities); the ONLY registry of sanctioned deviations from them is
`README.md`'s "Decisions and deviations" section — a deviation is sanctioned only if it is
listed THERE (never because CLAUDE.md, a research note, or a code comment says so).

## Context the orchestrator hands you

`BASE` (merge-base with `origin/main`), `HEAD` (the short sha under review), and your
review file `.scratch/code_review_<name>.md`. If the gate ran, its output is under
`.scratch/gate/`.

## You are READ-ONLY

Do not run a mutating command (`git checkout`, a build, applying a fix) or edit any
tracked file. If a repro is essential, copy the repo into a fresh `/tmp/<uuid>/` and run
it there. If a repo command or file edit is genuinely needed, do NOT do it — write it into
your review file as an instruction for the top-level to run; its result will be in the file
next pass. The one file you write is your own `.scratch/code_review_<name>.md`.

## What to review

Commits `BASE..HEAD`. If your review file already ends with a section for an earlier
commit, review only `git diff <that-commit>..HEAD` (fall back to `BASE..HEAD` if that
commit is unreachable after a rebase), with the full `BASE..HEAD` diff as context. Stay in
your lane (your Domain). If the diff touches nothing in your Domain, do not invent work —
record a neutral pass.

## Output — append to your file, write nothing else

Append exactly:

    ## <name> — <HEAD>
    <findings. Each: a concrete issue, file:line, and WHY it matters. Context is
     mandatory — never "do X" without the reason. Label non-blocking suggestions.
     Be concise.>

    APPROVED

The final non-empty line MUST be exactly `APPROVED` (no blocking findings — neutral passes
and non-blocking suggestions both end here) or `CHANGES REQUESTED` (>=1 blocking finding),
alone on its own line, nothing after it.

## Reference-guardians only (`spec`, `compat-yaml`, `compat-js-yaml`)

If your reviewer file says you are a reference-guardian, also apply the **divergence
contract**: compare lightning-yaml against your reference and REPORT EVERY DIVERGENCE you
find in your Domain's diff — one concise line each — never subdued, even long-standing
ones. For EACH divergence, check `README.md`'s "Decisions and deviations" section:

- **Listed there** → SANCTIONED: report it as one non-blocking line tagged
  `(sanctioned — README)`, e.g. "duplicate-key last-wins — violates spec, allowed per
  README". It does NOT block.
- **Not listed** → BLOCKING. A sanction claimed only in CLAUDE.md, a research note, or a
  code comment does NOT count — only README's section does. End `CHANGES REQUESTED`.

Never silently accept a divergence because "it was decided before"; if it isn't in that
README section it blocks, and the top-level agent escalates it.
