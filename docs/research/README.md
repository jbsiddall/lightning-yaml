# Research notes

A flat, blog-style collection of dated research notes for `lightning-yaml` — parser strategy,
performance, memory, correctness, and comparisons with other libraries. Each file is a standalone
`YYYY-MM-DD-<topic>.md` note; browse the folder by date and topic.

See [`CONVENTIONS.md`](CONVENTIONS.md) for how these notes are written and named.

**Start here — the round overviews:**

- [**2026-07-12 — implementation-strategy dossier**](2026-07-12-research-dossier-overview.md): the
  original parser-strategy research — how to build a pure-JS YAML parser that approaches
  `JSON.parse`/`JSON.stringify`, with the WASM/native route evaluated and rejected.
- [**2026-07-14 — performance research (round 2)**](2026-07-14-json-performance-research-overview.md):
  chasing `JSON.parse` / `JSON.stringify` on the JSON-shaped common case — stringify, parse, memory,
  JIT tiering, and techniques borrowed from other parsers.
