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
Answer `y` to add the marketplace, pick a scope (user = every session), and set the options or keep
their defaults. The options screen is where you can type your own names straight away (see
[Your own names](#your-own-names)). The mod is active from then on; no reload is needed.

From a shell instead:
```bash
claude plugin marketplace add Bobby-cell-commits/named-subagents-mod
claude plugin install named-subagents-mod@named-subagents-mod --scope user
```

## Your own names
Three ways in, all feeding the same pool. Use whichever is nearest to hand.

**1. The options screen** (at install, or later with `/plugin configure named-subagents-mod` or
`/config`). Type names into *Your names*, separated by commas: `Ripley, Deckard, Mary Shelley`. They join
every built-in pool and get about half of the draws while one of them is free, so even two names show up
often. Turn on *Use only my names* to leave the built-in names out.

**2. The `/names` command**, in any session. It keeps your names in one file and applies to the next
agent dispatched:
```
/names                             what is set, and where the files are
/names add Ripley "Mary Shelley"   more names, for every built-in pool
/names remove Sisyphus             never draw this name
/names rename Turing Alan          call one name something else
/names set pirates Kidd Bonny      define a set (a pool of your own); same name again replaces it
/names unset pirates               drop a set
/names use pirates | auto          draw every agent from one pool, or go back to picking by task
/names only on | off               leave out the built-in names
/names import <file>               merge a names file, a JSON list, or one name per line
/names reset                       clear your file (a .bak copy is kept)
```
`import` joins what it reads with what you have: lists are added to, and a set of the same name gets the
new names as well.

**3. A names file**, for whole sets, dotfiles and sharing: `~/.claude/named-subagents.json` (under
`CLAUDE_CONFIG_DIR` when that is set). A project can carry its own at `.claude/named-subagents.json`,
layered on top of yours. Every key is optional:
```json
{
  "only": false,
  "use": "pirates",
  "names": ["Ripley", "Deckard"],
  "remove": ["Sisyphus"],
  "rename": { "Turing": "Alan" },
  "sets": {
    "pirates": { "names": ["Blackbeard", "Bonny", "Kidd"], "for": ["Explore"], "keywords": ["search", "find"] },
    "code": { "names": ["Neo", "Trinity"], "replace": true }
  }
}
```
| Key | Meaning |
|---|---|
| `names` | Extra names. They join every built-in pool, not the sets you define, and get about half of the draws while one of them is free (so do names a set adds to a built-in pool). |
| `rename` | Old name to new name. |
| `remove` | Names never drawn. Applied after `rename`, so a renamed name is hidden by its new name. |
| `sets` | A set is a pool of your own. `for` lists the agent types that draw from it and wins unless one pool is pinned (`use`, or the *Name pool* option); `keywords` match the task description. A set named like a built-in pool (`code`, `explore`, …) adds to that pool, or with `"replace": true` takes its place. `"pirates": ["Kidd", "Bonny"]` is short for a set with just names. |
| `use` | One pool for every agent, whatever its type. Wins over the *Name pool* option; `auto` or absent leaves the choice to that option, which picks by type and task unless you pinned a pool there. |
| `only` | `true` leaves out everything before this file, the built-in names included. |

Order: built-in names, your file, the project's file, then the options screen's names.
`examples/pirates.json` is a set to try, from a checkout of this repository: `/names import examples/pirates.json`.

**The name rule.** Claude Code accepts an agent name made of letters, digits, `_` and `-`, starting with
a letter or digit, up to 64 characters, and refuses the whole dispatch for anything else. So names are
cleaned on the way in: `Mary Shelley` becomes `MaryShelley`, `Zoë` becomes `Zoe`, `O'Brien` becomes
`OBrien`. A name with nothing usable in it (`名前`, an emoji) is skipped and reported.

**Limits.** A names file is read as untrusted input, since a project's arrives with the repository. A
file over 256 KB is not read. A list holds up to 2,000 names, a file up to 100 sets, and a set up to 200
`for` or `keywords` entries; what is over is left out and reported. Anything quoted from a file in a
warning or in `/names` output has its control characters replaced, so a file cannot send escape sequences
to your terminal. A name holding a control character is skipped.

**When a file is wrong.** A file that is not valid JSON, a name that cannot be used, or an unknown key
raises a toast and a status line once per change of the file; everything else in the file still applies,
and agents are always named. `/names` lists the problems, and will not edit a file it cannot read in
full, because rewriting it would drop the unread part; `/names reset` starts clean and keeps a `.bak`.

## What it does
- `tool.call{Agent}`: if the call has no `name`, draws one and calls `next({ ...e, name })`. The
  description is left as is. A model-supplied `name` passes through untouched.
  - **Pool:** the `theme` option pins one; `auto` matches `subagent_type` first (generic roles like
    `general-purpose` go by description keywords first), then the default pool. The pool is the
    built-in one with your names layered on; both names files are checked on every dispatch.
  - **Uniqueness:** skips every name in `$.agent.list()` and every in-flight draw. An exhausted pool
    spills to the default pool, then to any free name, then to `Name-2`, `Name-3`, …
- `agent.spawn`: after the spawn, checks the name reached it and that `$.agent.list()` shows it on the
  new agent id. Anything else raises a toast and a status line (`named-subagents: drew X but …`).
  Neither hook can block a dispatch: both carry a `.catch` that continues the call.

## Options (`userConfig`)
| Field | Default | Meaning |
|---|---|---|
| `theme` | `auto` | `auto`, or a category key (`code`, `explore`, `debug`, …) to always use that pool |
| `enabled` | `true` | `false` turns naming off without uninstalling (and `/names` with it) |
| `names` | empty | Your names, separated by commas; they join every built-in pool |
| `only_custom` | `false` | `true` leaves the built-in names out |

## Layout
- `hooks/names.ts`: the hooks module. `hooks/draw.ts`: pure draw logic. `hooks/custom.ts`: pure
  custom-names logic (the name rule, the names file, layering, `/names` edits). `hooks/pool.ts`:
  **generated**.
- `registry.json`: the name pool (14 categories, 395 names), the source of `hooks/pool.ts`.
- `scripts/gen_pool.mjs`: regenerates `hooks/pool.ts` from `registry.json`; `--check` exits 1 when it
  is stale.
- `spec/`: draw and custom-names logic tests (plain node). `tests/`: hook tests (the engine's test kit).
- `examples/`: a names file to import. `probes/`: the live proofs and the TUI capture driver.

## Checks
```bash
node scripts/gen_pool.mjs --check   # pool matches the registry
node --test spec/*.spec.ts          # draw and custom-names logic, plain node 22.18+ (60 tests)
claude plugin test .                # hooks against the engine's test kit (34 tests)
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
Headless proof and TUI evidence: `probes/mods-names-proof/` (naming) and `probes/custom-names-probe/`
(custom names).

## Known limits
- The name shows in the task tree and in `$.agent.list()`; the transcript's launch list and finish
  notices quote the description only.
- The name is display-only: a subagent cannot say its own name, and nothing records which name ran
  which task after the session ends.
- A set smaller than the number of live agents runs out: the next draw comes from the default pool,
  then from any free name, then gets a number (`Ripley-2`).
- `/names` edits your file only, and only while the whole file reads cleanly: one unknown key or bad
  entry and it asks you to fix the file by hand first. A project's names file is edited by hand. A
  project file can rename or hide names for anyone who opens that project (names only, within the
  name rule).
- Overlapping draws (two dispatches in flight at once) are covered by the kit test only. In live runs
  the engine started same-message dispatches 0.5–2 s apart.
- With the retired 0.7.2 Python plugin also enabled, the mod's name wins, but the Python hooks still
  run (see `probes/mods-names-proof/README.md`). Uninstall the Python plugin.
- Mods API is early access; tested on Claude Code 2.1.291 only.

## License
MIT. See [LICENSE](LICENSE).
