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
Run /code-review as a FRESH sub-agent, never a fork: a forked reviewer inherits the
author's context and rationalises the change, so a clean one is what keeps the review
unbiased. See .claude/commands/code-review.md.
-->

- [ ] Ran `/code-review` as a fresh sub-agent (**not** a fork) and addressed every
      issue it raised.
- [ ] Any pushback on its feedback was fed back into `/code-review` and it was re-run
      until it returned **✅ Satisfied** — the loop ends on the reviewer being
      satisfied, not on the author insisting.

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
