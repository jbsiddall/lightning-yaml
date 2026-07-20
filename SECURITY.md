# Security Policy

`lightning-yaml` parses **untrusted input by design** — config files, user
uploads, API payloads. That makes parser-level bugs (denial of service,
prototype-pollution bypass, or any path to code execution from parsed content)
genuine security issues, and we want to hear about them privately before they're
public.

## Supported versions

While the library is pre-1.0, only the **latest released version** receives
security fixes. Once 1.0 ships this section will list supported ranges.

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.** A public
report is an instant zero-day for everyone running the library.

Instead, use one of these private channels:

1. **GitHub Private Vulnerability Reporting** (preferred) — on the repository's
   **Security** tab, choose **Report a vulnerability**. This opens a private
   advisory visible only to the maintainers.
2. **Email** — j.b.siddall@gmail.com with `[lightning-yaml security]` in the
   subject.

Please include, where you can:

- the exact YAML (or API call) that triggers the issue,
- what you expected versus what happened (a crash, a hang, pollution of a
  prototype, unexpected memory/CPU use, etc.), and
- the `lightning-yaml` version and JS runtime (Node/Deno/Bun/browser) you saw it
  on.

A minimal reproducing input is the single most useful thing you can send.

## What to expect

- We aim to **acknowledge** a report within a few days.
- We'll confirm the issue, agree a disclosure timeline with you, and credit you
  in the advisory unless you'd rather stay anonymous.
- Fixes ship in a normal patch release; the advisory is published once a fix is
  available.

## Scope — known, by-design behavior

Some things look alarming but are intentional and **not** vulnerabilities:

- **Aliases resolve to shared references.** A document that reuses an anchor
  produces one in-memory object referenced many times (a DAG), and a
  self-referencing anchor produces a genuine cycle. This is by design and is what
  prevents "billion laughs" expansion. If your code **deep-clones, deep-freezes,
  or recursively walks** untrusted parsed output, guard against repeated
  references and cycles on your side.
- **Nesting is bounded.** Extremely deep input throws a catchable
  `YAMLParseError` (maximum nesting depth) rather than crashing — that's the
  intended defense, not a bug.
- **`__proto__` is stored as an own property**, matching `JSON.parse`, and never
  pollutes `Object.prototype`.

If you believe any of the above is exploitable in a way we haven't considered,
please do report it — the list above is our current understanding, not a
guarantee.
