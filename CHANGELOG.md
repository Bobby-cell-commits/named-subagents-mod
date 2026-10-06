# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/); versions follow SemVer.

## [0.3.0] — 2026-10-06

One install now gives the names and a pane that lists the agents under them.

### Added
- **The agents pane**, from [agentpane](https://github.com/xuanji86/claude-agentpane) 1.1.4 by Anji Xu
  (MIT; notice in `LICENSE-agentpane`): the session's subagents beside the conversation, what each is
  doing, its tokens and clock, its conversation a press away, a timeline, a receipt for each batch,
  finish toasts, Stop, and a tab above the prompt once it folds. `/agentpane` opens or closes it.
  On top of 1.1.4:
  - **Names:** an agent is listed under its name, in a column of its own; beside a name a row is the
    task alone (`Turing  map the hooks`), and the type shows in the conversation's header unless it is
    `general-purpose`. An agent with no name reads `Type(description)`.
  - **Roster:** one row an agent, in columns: mark, name, task, what it is doing now or how it ended,
    tool count, tokens, clock. The right-hand columns go as the pane narrows (tokens under 88 columns,
    tool count under 72); under 56 a running agent says what it is doing on a line beneath. The summary
    above the prompt uses the same columns and keeps finished agents while it has rows.
  - **Done, not idle:** a background agent between turns (the engine's `idle`) reads as done; a
    teammate between turns reads `waiting`.
  - **Model once:** a model every listed agent shares is said once, in the header.
  - **Paths:** a tool call's paths under the session's directory are drawn relative.
  - **Timeline:** a lane is labelled by the agent's name alone.
  - **Wording:** the receipt reads `4 done in 18s`; a finish toast reads `✓ Turing done · 9s · map the hooks`.
- Six options for the pane beside naming's four: `autoOpen`, `foldAfter`, `motion`, `toasts`,
  `keepFinished`, `statusLine`.
- `tests/together.test.tsx`: an agent the mod names is listed in the pane under that name; both
  commands register; with naming off the pane lists by type; the two halves share the status line;
  `/agentpane` failing to register is said and leaves the pane counting.
- `probes/pane-fold/`: what the engine allows of one plugin (one hooks module, an event hooked once,
  `$` kept inside a file), and the live captures.
- A demo GIF at the top of the README (`assets/demo.gif`): names in the task tree, then `/names set` and
  `/names use` and a second fan-out drawing from that set. `scripts/capture_demo.sh` records it and
  `scripts/render_tree_gif.py` draws it. Recorded on 0.2.0, before the pane.

### Changed
- `hooks/hooks.json` names `./index.ts`, which registers naming and then the pane. `session.start` and
  `agent.spawn` are hooked once, in `hooks/pane.tsx`, for both: `/names` is registered there, and
  naming's check of a spawned agent's name runs there, ahead of the pane's own work.
- The status line is shared: a clean spawn clears naming's alarm and not the pane's running count,
  and with both to say the count leads and the alarm follows it.
- "naming failed; this agent runs unnamed" is raised only when the name did not reach the call. A
  failure beneath naming's hook (the Agent tool, another hook) after the name was set no longer
  raises it.
- The pane's once-a-second list read starts before `/agentpane` is registered, and a failed
  registration raises a toast; in agentpane 1.1.4 it stopped the pane without a word.
- The pane's state is kept under this mod's name (`named-subagents-mod.agents`, …), declared in
  `types/index.d.ts`.

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
