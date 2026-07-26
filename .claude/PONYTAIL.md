# Ponytail (vendored)

The `skills/ponytail*` and `hooks/ponytail-*` files in this `.claude/` directory
are vendored from [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)
(MIT — see `PONYTAIL-LICENSE`), copied in rather than installed as a Claude Code
plugin.

## Why vendored instead of installed

Installing it as an actual plugin (`/plugin marketplace add` +
`/plugin install`) wasn't working reliably in this repo. Project-level skills
and hooks don't need a plugin install step at all — anything under
`.claude/skills/` and a `hooks` block in `.claude/settings.json` is picked up
automatically for anyone working in this repo.

## What's wired up

- `.claude/skills/` — all six skills (`ponytail`, `-review`, `-audit`, `-debt`,
  `-gain`, `-help`), byte-for-byte from upstream.
- `.claude/hooks/` — the same lifecycle hook scripts upstream ships
  (`ponytail-activate.js`, `ponytail-subagent.js`, `ponytail-mode-tracker.js`,
  plus their shared helpers and the statusline scripts), wired via
  `.claude/settings.json`'s `SessionStart` / `SubagentStart` /
  `UserPromptSubmit` hooks instead of a plugin manifest. `${CLAUDE_PROJECT_DIR}`
  stands in for the plugin-only `${CLAUDE_PLUGIN_ROOT}`.
- `.claude/hooks/package.json` (`{"type": "commonjs"}`) exists only because
  this package's own `package.json` sets `"type": "module"` — without it,
  Node would try to load the hook scripts' `require()` calls as ESM and fail.

This reproduces the real plugin's behavior: ponytail activates every session,
the level (`lite`/`full`/`ultra`) persists across `/clear`/`/compact`/new
sessions via the same `~/.config/ponytail/config.json` /
`PONYTAIL_DEFAULT_MODE` resolution, and the ruleset propagates into
Task-spawned subagents. Requires `node` on PATH, same as the real plugin.

## The one real gap

**No auto-update.** This is a point-in-time copy, not a live plugin
install — new ponytail releases won't reach this repo on their own. Re-sync
by re-copying `skills/ponytail*` and `hooks/ponytail-*.js` (plus the two
statusline scripts) from upstream.
