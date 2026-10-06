#!/usr/bin/env bash
# Live proof of custom names: 3 same-type agents in one message, in a project whose names file is <file json>.
# Usage: proof.sh <label> <runs_root> '<names file json>' [extra claude args...]
# Leaves markers.jsonl (from the mods-names-proof witness), out.json, debug.log in <runs_root>/<label>-<time>/.
set -uo pipefail
LABEL=${1:?label}; ROOT=${2:?runs root}; JSON=${3:?names file json}; shift 3
P=$(cd "$(dirname "$0")" && pwd); MOD=$(cd "$P/../.." && pwd)
D=$ROOT/$LABEL-$(date +%H%M%S); mkdir -p "$D/.claude"; cd "$D" || exit 1
printf '%s\n' "$JSON" > .claude/named-subagents.json
claude -p "Dispatch three general-purpose agents in ONE message, all with run_in_background true, each told to reply with just the word ok. Wait until all three have finished, then quote each agent's full reply verbatim, one per line." \
  --model haiku --setting-sources project,local --plugin-dir "$MOD" --plugin-dir "$P/../mods-names-proof/witness" \
  --output-format json --debug-file "$D/debug.log" "$@" > "$D/out.json" 2> "$D/err.log" < /dev/null
echo "exit=$? dir=$D"
head -5 "$D/err.log"
if [ -f "$D/markers.jsonl" ]; then cat "$D/markers.jsonl"; else echo "NO MARKERS"; fi
