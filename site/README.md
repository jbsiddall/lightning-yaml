# Lightning YAML — documentation site

The **Astro + Starlight** project behind Lightning YAML's docs and homepage
(<https://lightning-yaml.dev>). Static output, no SSR. It's a self-contained
nested project (its own `package.json`), rebuilt and deployed on merge to
`main`, pulling the latest benchmark numbers from the `benchmark-data` branch.

## Commands

Run from the repo root:

```bash
pnpm --dir site install
pnpm --dir site dev      # local dev (also runs starlight-typedoc)
pnpm --dir site build    # → site/dist/ (what CI ships)
```

## How it fits together

- **API reference** — generated at build time from the parser's TSDoc by
  `starlight-typedoc` (entry points in `astro.config.mjs`). Output lands in
  `src/content/docs/api/` (gitignored). Never hand-write it or point it at a
  facade — add TSDoc to the source and it appears here (see the source-of-truth
  precedence rule in the root `CLAUDE.md`).
- **Benchmark data** — the page renders committed sample YAML in
  `src/data/benchmarks/`; CI overlays the real numbers from the `benchmark-data`
  orphan branch before building.
- **Deploy** — Vercel via `.github/workflows/deploy.yml` (prod on `main`,
  preview on PRs); required secrets/variables are documented in that workflow.
