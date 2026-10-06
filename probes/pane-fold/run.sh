#!/usr/bin/env bash
# run.sh <workdir> <outdir> <cols> <rows>: drive Claude Code with only the worktree's mod loaded and save the screen twice a second.
set -uo pipefail
DIR=$1; OUT=$2; COLS=$3; ROWS=$4
MOD=$(cd "$(dirname "$0")/../.." && pwd)
T="tmux -L nsfold -f /dev/null"
trap '$T kill-server 2>/dev/null' EXIT
$T kill-server 2>/dev/null
$T new-session -d -s d -x "$COLS" -y "$ROWS" -c "$DIR"; $T set -s focus-events on
$T send-keys -t d "claude --model haiku --setting-sources project,local --plugin-dir $MOD" Enter
sleep 9
if $T capture-pane -p -t d | grep -qi "trust this folder"; then $T send-keys -t d Down; sleep 0.5; $T send-keys -t d Enter; sleep 7; fi
$T capture-pane -p -t d | grep -q "Claude Code v" || { echo "Claude Code did not start; nothing was typed" >&2; $T capture-pane -p -t d | tail -20 >&2; exit 1; }
n=0
shot() { n=$((n + 1)); $T capture-pane -p -t d > "$OUT/$(printf 'f%03d' "$n")-$1.txt"; }
watch() { for _ in $(seq 1 "$2"); do sleep 0.5; shot "$1"; done; }
P="Fan out 3 parallel background agents in one message. Read only: each uses only the Read tool, reads one file in this folder, then writes a 150-word essay on the design it describes. Agent 1: retry.txt. Agent 2: cache.txt. Agent 3: parser.txt. Do not use Bash."
$T send-keys -t d -l "$P"; sleep 1; shot typed; $T send-keys -t d Enter
watch run "${RUN:-80}"
