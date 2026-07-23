<!--
Thanks for contributing! A PR that changes src/ lands on main as a single squash
commit whose message is this PR's title + description — so please make both
describe the whole change.
-->

## What & why

<!-- What does this change, and why? Link any issue it closes. -->

## Correctness gate

Please confirm the relevant checks pass locally (see CONTRIBUTING.md):

- [ ] `pnpm typecheck`
- [ ] `pnpm test` (consistency vs. the oracle)
- [ ] `pnpm test:unit` and `pnpm test:stringify` (for parser/dumper changes)
- [ ] `pnpm test:suite` — yaml-test-suite pass rate did **not** drop (parser changes)
- [ ] `pnpm bench:self` shows no perf regression (hot-path changes)

## Code review

<!--
Run /code-review from the top-level assistant when the PR looks ready for the user to
review (it fans out its own read-only reviewer subagents in parallel; it is NOT itself
run as a subagent). Re-run it each time the PR is updated and again ready, looping until
all reviewers approve that commit. Record the commit they approved below — a later push
makes it != HEAD, the signal to re-run and update the hash. See
.claude/commands/code-review.md.
-->

- [ ] `/code-review` passed — every reviewer approved at commit `_______________` (the
      HEAD it ran on). Pushing new commits invalidates this: when the PR is again ready
      for review, re-run `/code-review` and update the hash until all reviewers approve
      the new HEAD.

## Changeset

- [ ] This PR touches `src/` and includes a changeset (`pnpm changeset`, or
      `pnpm changeset add --empty` if it ships nothing to users), **or** it
      doesn't touch `src/` and needs none.

## Correctness note

<!--
If this changes parse/dump behavior, cite the YAML 1.2.2 spec (or the relevant
yaml-test-suite case). "Another library does it this way" is not on its own a
justification — the spec adjudicates. See CONTRIBUTING.md.
-->
