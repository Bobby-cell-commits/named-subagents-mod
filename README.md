# named-subagents-mod

[![CI](https://github.com/Bobby-cell-commits/named-subagents-mod/actions/workflows/ci.yml/badge.svg)](https://github.com/Bobby-cell-commits/named-subagents-mod/actions/workflows/ci.yml)

Fan out several subagents in Claude Code and the task tree shows each one by its type. This mod gives
every subagent its own themed name instead (`Turing`, `Magellan`, `Holmes`), drawn from a 395-name
registry and never shared by two live agents.

It is a Claude Code mod (function hooks), so it needs **Claude Code 2.1.287 or later** and nothing
else: no Python, no Node at runtime. It replaces the retired
[named-subagents](https://github.com/Bobby-cell-commits/named-subagents) Python plugin (last release
0.7.2).

Names only: the agent is **not** told its name (the engine does not put a mod-set `name` into the
subagent's context), so there is no SubagentStart queue, ledger or file lock, and no burst-start
pairing to get wrong.

## Install
Type this at the prompt of a terminal session:
```
/plugin install named-subagents-mod --marketplace Bobby-cell-commits/named-subagents-mod
```
Answer `y` to add the marketplace, pick a scope (user = every session), and set the two options or
keep their defaults. The mod is active from then on; no reload is needed.

From a shell instead:
```bash
claude plugin marketplace add Bobby-cell-commits/named-subagents-mod
claude plugin install named-subagents-mod@named-subagents-mod --scope user
```

## What it does
- `tool.call{Agent}`: if the call has no `name`, draws one and calls `next({ ...e, name })`. The
  description is left as is. A model-supplied `name` passes through untouched.
  - **Pool:** the `theme` option pins one; `auto` matches `subagent_type` first (generic roles like
    `general-purpose` go by description keywords first), then the default pool.
  - **Uniqueness:** skips every name in `$.agent.list()` and every in-flight draw. An exhausted pool
    spills to the default pool, then to any free name, then to `Name-2`, `Name-3`, …
- `agent.spawn`: after the spawn, checks the name reached it and that `$.agent.list()` shows it on the
  new agent id. Anything else raises a toast and a status line (`named-subagents: drew X but …`).
  Neither hook can block a dispatch: both carry a `.catch` that continues the call.

## Options (`userConfig`)
| Field | Default | Meaning |
|---|---|---|
| `theme` | `auto` | `auto`, or a category key (`code`, `explore`, `debug`, …) to always use that pool |
| `enabled` | `true` | `false` turns naming off without uninstalling |

## Layout
- `hooks/names.ts`: the hooks module. `hooks/draw.ts`: pure draw logic. `hooks/pool.ts`: **generated**.
- `registry.json`: the name pool (14 categories, 395 names), the source of `hooks/pool.ts`.
- `scripts/gen_pool.mjs`: regenerates `hooks/pool.ts` from `registry.json`; `--check` exits 1 when it
  is stale.
- `spec/`: draw-logic tests (plain node). `tests/`: hook tests (the engine's test kit).
- `probes/`: the live proof and the TUI capture driver.

## Checks
```bash
node scripts/gen_pool.mjs --check   # pool matches the registry
node --test spec/*.spec.ts          # draw logic, plain node 22.18+ (18 tests)
claude plugin test .                # hooks against the engine's test kit (7 tests)
claude plugin validate .
```
CI runs the two node checks; the two `claude` checks need a local Claude Code.

## Develop
`claude --plugin-dir .` loads the checkout for one session. To run every session from a checkout,
add the folder as a marketplace (edits apply after `/reload-plugins`):
```bash
claude plugin marketplace add /path/to/named-subagents-mod
claude plugin install named-subagents-mod@named-subagents-mod --scope user
```
Headless proof and TUI evidence: `probes/mods-names-proof/`.

## Known limits
- The name shows in the task tree and in `$.agent.list()`; the transcript's launch list and finish
  notices quote the description only.
- The name is display-only: a subagent cannot say its own name, and nothing records which name ran
  which task after the session ends.
- Overlapping draws (two dispatches in flight at once) are covered by the kit test only. In live runs
  the engine started same-message dispatches 0.5–2 s apart.
- With the retired 0.7.2 Python plugin also enabled, the mod's name wins, but the Python hooks still
  run (see `probes/mods-names-proof/README.md`). Uninstall the Python plugin.
- Mods API is early access; tested on Claude Code 2.1.291 only.

## License
MIT. See [LICENSE](LICENSE).
