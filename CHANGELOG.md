# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/); versions follow SemVer.

## [Unreleased]

## [0.2.0] — 2026-10-06

Your own names: add some, change the built-in ones, or bring a whole set.

### Added
- **Options screen:** *Your names* (comma-separated) and *Use only my names*, set at install, with
  `/plugin configure named-subagents-mod`, or in `/config`.
- **`/names` command:** `add`, `remove`, `rename`, `set`, `unset`, `use`, `only`, `import`, `reset`, and a
  bare `/names` that shows what is set and where. It writes `~/.claude/named-subagents.json`.
- **Names file:** `~/.claude/named-subagents.json`, and a project's `.claude/named-subagents.json`
  layered on top. Keys: `names`, `remove`, `rename`, `sets` (with `for`, `keywords`, `replace`), `use`,
  `only`. Both files are checked on every dispatch, so an edit applies to the next agent.
- Names are cleaned to what the Agent tool accepts (`Mary Shelley` becomes `MaryShelley`); a name that
  cannot be used is skipped and reported. A wrong file raises a toast and a status line once per change
  and never leaves an agent unnamed.
- Names you add to a pool that keeps its built-in names get about half of the draws while one is free.
  Without that, two added names among thirty-odd named about one agent in eighteen.
- A names file is treated as untrusted input: a size limit checked before the read (256 KB), caps on
  names, sets and routes, and control characters replaced in every warning and in `/names` output.
- `examples/pirates.json`, `probes/custom-names-probe/` (the three probes behind the design, and the
  live proof).

### Changed
- A drawn name is checked against the Agent tool's rule before it is set; one that fails is not set
  and is reported, because the tool refuses the whole dispatch for such a name.
- A set from a names file that lists an agent type in `for` wins for that type before description
  keywords are read (built-in pools keep the old order).

## [0.1.0] — 2026-10-06

First standalone release. The mod moved out of
[named-subagents](https://github.com/Bobby-cell-commits/named-subagents) (`mod/` at `0bbd5c3`), which
is retired; its last Python release is 0.7.2.

### Added
- `registry.json` at the repo root: the 395-name pool, carried over from the Python package
  (`named_subagents/registry.json`), unchanged.
- `.claude-plugin/marketplace.json` names the marketplace `named-subagents-mod`, so the repository
  installs with `/plugin install named-subagents-mod --marketplace Bobby-cell-commits/named-subagents-mod`.
- CI for the node checks (pool is current, draw-logic tests).
- `probes/`: the live proof (`mods-names-proof`) and the TUI capture driver.

### Changed
- `scripts/gen_pool.mjs` reads `registry.json` from the repo root.
- Paths in comments, the probe and the README follow the mod living at the repo root.

### Behaviour
- Unchanged from `mod/` at `0bbd5c3`: `tool.call{Agent}` sets a drawn name when the model gave none;
  `agent.spawn` verifies it and raises a toast and a status line on a mismatch.
