# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/); versions follow SemVer.

## [Unreleased]

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
