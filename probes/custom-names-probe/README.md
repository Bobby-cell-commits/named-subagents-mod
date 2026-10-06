# custom-names-probe

Three probes that fixed the design of custom names, and the live proof of the result. Claude Code
**2.1.291**, 2026-10-06, model haiku, all runs `--setting-sources project,local`.

## The probes
| Question | Answer | Evidence |
|---|---|---|
| Which characters does the Agent tool accept in `name`? | `/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/`, quoted by the tool's own refusal. `Mary Shelley`, `O'Brien`, `Zoë`, `名前`, `Rocket🚀`, `a/b` each came back as an `InputValidationError` **result** (not a throw): the dispatch did not run and the model had to send it again. A second agent named `Ripley` was accepted while the first had likely finished, so the engine's view of duplicates is not settled by this run. | `evidence/probe-names-fs-options.markers.jsonl` (`tool.call.Agent` rows) |
| May a mod read and write under the config directory without a prompt? | Yes: `$.fs.read`, `stat`, `write` on `~/.claude/<file>` all worked headless with no prompt. `~` is not expanded (the path is taken relative to the working directory), so the mod builds the path from `HOME` or `CLAUDE_CONFIG_DIR`. A missing file rejects with `… failed: ENOENT`; `exists` answers false. `$.store` works too. | same file (`fs`, `store` rows) |
| Does the options screen take a list? | `userConfig` types are `string`, `number`, `boolean`, `directory`, `file`. A string field with `"multiple": true` validates and reaches the mod as an array when set in settings. `/plugin configure` draws it as one text line, but **`/config` does not list it at all**; a plain string field shows in both. So *Your names* is a plain comma-separated string. | `config-types.sh` output (not kept); `evidence/plugin-configure-list-field.txt`; `options` row of the markers file |

## The proof (the mod at this commit)
| Check | Result | Evidence |
|---|---|---|
| Project names file `{ "only": true, "names": [Ripley, Deckard, Neo, Trinity] }`, 3 same-type agents in one message | Trinity, Ripley, Deckard; spawn name == list name; unchanged at each turn's end | `evidence/proof-only.markers.jsonl` |
| Project file with names the tool would refuse (`名前`, `Mary Shelley`, `a/b`, `Zoë`) and an unknown key | aB, Zoe, MaryShelley; no dispatch refused; one toast and one status line for the whole message, naming `名前` | `evidence/proof-badnames.markers.jsonl`; the toast is in the debug log (not kept) |
| User file written by `/names set pirates Kidd Bonny`, `/names use Pirates`, `/names set Pirates Roberts Teach` (one set, whatever the case) | Roberts, Teach, then Bootes (the two-name set ran out; the third draw came from the default pool) | `evidence/proof-userfile.markers.jsonl` |
| Options `names: "Ripley, Mary Shelley"`, `only_custom: true` (passed as `--settings` `pluginConfigs`) | MaryShelley, Ripley, then Ripley-2 | `evidence/proof-installscreen.markers.jsonl` |
| The options screens | `/plugin configure named-subagents-mod` and `/config` both show *Your names* as a text field and *Use only my names* as a toggle. Typed, not saved. | `evidence/plugin-configure-names.txt`, `evidence/config-menu-rows.txt` |

| `/names add Neo` on a user file with an unknown key; `/names reset` twice | The file was left alone and the unknown key named; the first reset kept the file as `.bak`, the second said there was nothing to reset and left the `.bak` as it was | terminal output (not kept) |

| Hostile project file: escape sequences (`ESC ] 0 ; … BEL`, `ESC [ 31 m`) in a key, in two names and in `use`, beside two good names | Only the good names are drawn (Ripley, Neo, then Ripley-2); the two names holding escape sequences are skipped; no escape byte in the toast, the status line or `/names` output (they show `?` instead). A 300 KB project file is not read, and `/names` says so. | `evidence/proof-hostile.markers.jsonl` |
| Project file `{ "names": [Ripley, Deckard] }` beside the 395 built-in names, 3 same-type agents, two runs | Ripley, Deckard, Iktomi; then Ripley, Guido, Deckard. Added names get about half of the draws while one is free; before that rule, two names in a pool of 35 named about one agent in eighteen. | `evidence/proof-favour-1.markers.jsonl`, `evidence/proof-favour-2.markers.jsonl` |

An independent review of the first version found 11 defects (none let an invalid name reach the Agent
tool; four let `/names` drop data from a hand-edited file). Each has a regression test that was seen
failing before its fix; the runs above are from the fixed code.

Not tested: saving from the options screen in a real install (the value was passed through `--settings`
instead); the options screen as `/plugin install` shows it for a first install; Windows paths.

## Re-run
```bash
bash probes/custom-names-probe/config-types.sh <scratch_dir>
bash probes/custom-names-probe/run.sh names <runs_root>     # writes two scratch files in the config directory
bash probes/custom-names-probe/proof.sh only <runs_root> '{ "only": true, "names": ["Ripley", "Deckard", "Neo", "Trinity"] }'
```
