# Contributing to lightning-yaml

Thanks for pitching in. Bug reports, failing YAML inputs, and PRs are all
welcome — see the *Contributing & feedback* section of the [README](README.md)
for the kinds of things that help most.

## Development

```bash
pnpm install
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest consistency suite (ours vs. the yaml oracle)
pnpm test:unit      # the parser's own node:test suite
pnpm test:stringify # dumper round-trip suite
```

Keep those green. If you touch the parser, also run `pnpm test:suite`
(the yaml-test-suite conformance run — the pass rate must not drop) and
`pnpm bench:self` (no perf regression).

## Versioning — add a changeset

We use [Changesets](https://github.com/changesets/changesets) to manage the
version number and changelog, so nobody edits `package.json`'s `version` by
hand and every release is traceable to the changes that caused it.

**If your PR changes the published library (anything under `src/`), include a
changeset.** From the repo root:

```bash
pnpm changeset
```

Answer the prompts: pick the bump level, then write a one-line summary. That
summary becomes the changelog entry, so write it for an adopter reading the
release notes ("Fixed `!!binary` rejecting …", not "fix bug"). The command
writes a small markdown file under `.changeset/` — commit it with your PR.

Choosing the bump level (we're pre-1.0, so `^0.x` ranges treat any **minor** as
potentially breaking — lean on that):

| Level     | Use for                                                        |
| --------- | -------------------------------------------------------------- |
| **patch** | bug fixes, performance, internal changes — no API change       |
| **minor** | new features, **and** any breaking change while we're at 0.x   |
| **major** | reserved for the 1.0.0 release — leave this to the maintainer  |

A PR touching `src/` that genuinely ships nothing to users (say, a comment-only
edit) can opt out explicitly:

```bash
pnpm changeset add --empty
```

CI checks for this: a PR that changes `src/` with no changeset fails the
`changeset-check` job, with a message telling you which command to run. PRs that
don't touch `src/` (docs, benchmarks, harness, tests) don't need one.

## How a release happens

You don't publish anything — maintainers do, and it's automated:

1. Merged PRs leave their changesets on `main`.
2. A **"Release: version packages"** PR is opened/updated automatically
   ([`.github/workflows/release.yml`](.github/workflows/release.yml)). It
   consumes the pending changesets, bumps `package.json`, and updates
   `CHANGELOG.md`.
3. Merging that PR publishes the new version to npm
   ([`.github/workflows/publish.yml`](.github/workflows/publish.yml)).
