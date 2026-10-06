#!/usr/bin/env bash
# Live probe: 8 agents in one message, each given the next candidate name. Usage: run.sh <label> <runs_root>
# Seeds <config dir>/names-probe-seeded.json first (delete it and names-probe-written.json after). Leaves markers.jsonl, out.json, debug.log in <runs_root>/<batch>-<time>/.
set -uo pipefail
B=${1:?label}; ROOT=${2:?runs root}; shift 2
P=$(cd "$(dirname "$0")" && pwd); CFG=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
printf '{"seeded":true}\n' > "$CFG/names-probe-seeded.json"
D=$ROOT/$B-$(date +%H%M%S); mkdir -p "$D"; cd "$D" || exit 1
claude -p "Dispatch eight general-purpose agents in ONE message, all with run_in_background true, each told to reply with just the word ok. Do not set a name on any of them. Wait until all eight have finished, then say done." \
  --model haiku --setting-sources project,local --plugin-dir "$P/probe" \
  --settings '{"pluginConfigs":{"names-probe":{"options":{"list":["Ripley","Mary Shelley"],"path":"/tmp/x.json","plain":"a, b"}}}}' \
  --output-format json --debug-file "$D/debug.log" "$@" > "$D/out.json" 2> "$D/err.log" < /dev/null
echo "exit=$? dir=$D"
head -5 "$D/err.log"
if [ -f "$D/markers.jsonl" ]; then cat "$D/markers.jsonl"; else echo "NO MARKERS"; fi
