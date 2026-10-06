# pane-fold: naming and the agents pane in one plugin

Run 2026-10-06 on Claude Code 2.1.292, while the pane was being brought into this mod (0.3.0). Two
questions: what does the engine allow of one plugin that holds two sets of hooks, and does the result
show the same names as Claude Code's own task tree in a live session.

## What the engine allows (`twomods/`)
`twomods/` is the scratch plugin in its final, working shape. The three shapes tried before it were
each refused by `claude plugin validate` and by the loader, with these words:

| Tried | Answer |
|---|---|
| `hooks.json` naming two modules: `["./a.ts", "./b.tsx"]` | `modules: hooks.json 'modules' names one hooks module per plugin; a second entry is refused` |
| One module importing both files, each hooking `session.start` | `on("session.start") is registered twice without a matcher; the first is at …/a.ts:2` |
| A hook in one file passing `$` to a function in another | `$ is passed to "startA", imported from "./a.ts": $ is followed only into a function declared in this same file, never across an import` |

What works, and what this mod now does:
- `hooks.json` names one module (`index.ts`), which imports each file's `register` and calls both
  with `on` and `options`. `on` may cross a file; `$` may not.
- An event is hooked once without a matcher. `tool.call{tool=Agent}` in one file and an unmatched
  `tool.call` in the other are two registrations and both load.
- Registrations nest in the order they are made, the first outermost: `a`'s hook sets a name on the
  Agent call and `b`'s hook, registered after it, sees that name (`b saw name=FromA order=a-in,b-in`).
- Where both files need the same unmatched event, one file holds the hook and calls a function the
  other exports, handing it closures (`(path, text) => $.fs.write(path, text)`) in place of `$`.
- A helper that takes `$` is declared at the top of its file. One declared inside `register` is
  refused: `$ is passed to "sayOf", which is not a function declared at the top of this file`.

To run it (the test file is named so the mod's own `claude plugin test .` does not pick it up):
```bash
cp twomods/hooks/probe.check.ts twomods/hooks/probe.test.ts
claude plugin validate twomods && claude plugin test twomods
rm twomods/hooks/probe.test.ts
```

## Live (`run.sh`, `evidence/`)
`run.sh <workdir> <outdir> <cols> <rows>` starts Claude Code in a private tmux server with only this
checkout loaded (`--setting-sources project,local --plugin-dir`), asks for three background agents
that each read one file, and saves the screen twice a second. The docked run's workdir holds
`.claude/settings.local.json` with `{ "tui": "fullscreen" }`; the other run has none.

| File | What it shows |
|---|---|
| `evidence/docked-170col-running.txt` | Fullscreen, 170 columns: the pane docked, three agents as DaVinci, Hokusai, Mucha; the same three names in Claude Code's tree under the prompt |
| `evidence/docked-170col-done.txt` | The same run finished: `3 done`, the timeline and the batch receipt |
| `evidence/docked-170col-folded-tab.txt` | Ten seconds later: the pane folded to the `◂ Agents ✓ 3` tab |
| `evidence/above-prompt-170col-running.txt` | Main screen, 170 columns: the summary above the prompt, Monet, Vermeer, Mucha; the same names in the tree |
| `evidence/above-prompt-170col-done.txt` | That run finished, the receipt inside the box |
| `evidence/pane-off-170col-running.txt` | 2026-10-07, the `pane` option off (`EXTRA="--settings <file>"`), fullscreen, 170 columns: no pane, no count, no toast; Matisse, Rothko, Eames in the tree |

Across both recordings, every frame that shows the pane and the tree together (16 docked, 14 above
the prompt) has each of the tree's names in the pane under the same name. In three frames of each
the tree has fewer rows: it drops an agent when it finishes and the pane keeps it.

With the pane switched off (71 frames, same prompt): the tree names all three agents and no frame holds
the pane, its timeline, the count under the prompt, a finish toast or the tab. The same day's run with it
on: 21 frames show the pane and the tree together, each tree name in the pane under the same name.

A session keeps a command its plugin no longer registers (2026-10-07, a scratch plugin that registers
`/probecmd` only while a flag file exists: flag removed, `/reload-plugins`, and `/probecmd` was still in
the typeahead). So after the `pane` option is turned off mid-session `/roster` is still offered, and the
mod answers it with "The agents pane is switched off". Not tried live: the flip itself in `/config` (it
would have written the option into the user's own settings); `/reload-plugins` did not pick up a changed
`--settings` file.

The frames are plain text (`tmux capture-pane -p`), with the shell line removed and the scratch
folder's path written `~/scratch`.
Not shown: colour, the spinner's motion, a conversation opened in the pane.
