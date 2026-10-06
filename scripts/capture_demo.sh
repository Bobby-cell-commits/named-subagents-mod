#!/usr/bin/env bash
# Record the README demo: drive a real Claude Code session in a private tmux server and save the
# screen (with colour) twice a second. scripts/render_tree_gif.py turns the frames into assets/demo.gif.
# Usage: capture_demo.sh <scratch_project_dir> <frames_dir>
# Scene 1 fans out agents on the built-in names; scene 2 defines a set with /names, switches to it
# and fans out again. /names writes the user's names file, so the script refuses to start when one
# exists and removes its own (and the .bak) on the way out.
set -uo pipefail
DIR=$1; OUT=$2
MOD=$(cd "$(dirname "$0")/.." && pwd)
FILE="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/named-subagents.json"
[ -e "$FILE" ] || [ -e "$FILE.bak" ] && { echo "refusing: $FILE (or its .bak) exists; the demo would overwrite it" >&2; exit 1; }
P1=${P1:-"Fan out 4 parallel agents, no tools, ~120 words each: map how DNS resolution works; explain why event sourcing is chosen over CRUD; find the likely root cause of a login test that is flaky only on CI; review a retry loop that has no backoff."}
P2=${P2:-"Fan out 3 parallel agents, no tools, ~120 words each: explain how a B-tree stays balanced; plan the tests for a rate limiter; find where a cache could serve stale data."}
T="tmux -L nsdemo -f /dev/null"
cleanup() { $T kill-server 2>/dev/null; rm -f "$FILE" "$FILE.bak"; }
trap cleanup EXIT
mkdir -p "$DIR" "$OUT"; $T kill-server 2>/dev/null
$T new-session -d -s d -x "${COLS:-112}" -y "${ROWS:-34}" -c "$DIR"; $T set -s focus-events on
$T send-keys -t d "claude --model haiku --setting-sources project,local --plugin-dir $MOD" Enter
sleep 8
if $T capture-pane -p -t d | grep -qi "trust this folder"; then $T send-keys -t d Down; sleep 0.5; $T send-keys -t d Enter; sleep 6; fi
# Typed into a shell, the prompts below would run as commands: go on only with Claude Code on screen.
$T capture-pane -p -t d | grep -q "Claude Code v" || { echo "Claude Code did not start; nothing was typed" >&2; exit 1; }
n=0
shot() { n=$((n + 1)); $T capture-pane -e -p -t d > "$OUT/$(printf 'f%03d' "$n")-$1.ans"; }
watch() { for _ in $(seq 1 "$2"); do sleep 0.5; shot "$1"; done; }   # $2 half-seconds
say() { $T send-keys -t d -l "$2"; sleep 1; shot "$1-typed"; $T send-keys -t d Enter; }
say s1 "$P1";                                watch s1 "${S1:-70}"
say set "/names set pirates Kidd Bonny Teach Rackham"; watch set 4
say use "/names use pirates";                watch use 4
say s2 "$P2";                                watch s2 "${S2:-60}"
