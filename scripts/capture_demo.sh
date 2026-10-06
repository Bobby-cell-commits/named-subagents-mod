#!/usr/bin/env bash
# Record the README demo: drive a real Claude Code session in a private tmux server and save the
# screen (with colour) twice a second. scripts/render_tree_gif.py turns the frames into assets/demo.gif.
# Usage: capture_demo.sh <scratch_project_dir> <frames_dir>
# The scratch project gets seven one-line design notes for the agents to read and the fullscreen
# layout (.claude/settings.local.json), where the agents pane docks beside the transcript; at 150
# columns it opens by itself (an unasked pane needs 144).
# Scene 1 fans out agents on the built-in names; scene 2 defines a set with /names, switches to it
# and fans out again. /names writes the user's names file, so the script refuses to start when one
# exists and removes its own (and the .bak) on the way out.
set -uo pipefail
DIR=$1; OUT=$2
MOD=$(cd "$(dirname "$0")/.." && pwd)
FILE="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/named-subagents.json"
[ -e "$FILE" ] || [ -e "$FILE.bak" ] && { echo "refusing: $FILE (or its .bak) exists; the demo would overwrite it" >&2; exit 1; }
P1=${P1:-"Fan out 4 parallel background agents in one message. Read only: each uses only the Read tool on one file in this folder, then sums up the design in two sentences. retry.txt, cache.txt, parser.txt, queue.txt. Do not use Bash."}
P2=${P2:-"Fan out 3 more the same way: index.txt, limiter.txt, auth.txt."}
T="tmux -L nsdemo -f /dev/null"
cleanup() { $T kill-server 2>/dev/null; rm -f "$FILE" "$FILE.bak"; }
trap cleanup EXIT
mkdir -p "$DIR/.claude" "$OUT"; $T kill-server 2>/dev/null
[ -e "$DIR/.claude/settings.local.json" ] || echo '{ "tui": "fullscreen" }' > "$DIR/.claude/settings.local.json"
note() { [ -e "$DIR/$1" ] || echo "$2" > "$DIR/$1"; }
note retry.txt   "Retry design: exponential backoff with jitter, capped at 30s, at most 5 attempts, idempotency keys on writes."
note cache.txt   "Cache design: a write-through LRU with a 5 minute TTL, keyed by tenant and query hash, invalidated on write."
note parser.txt  "Parser design: a hand-written recursive descent parser, one token of lookahead, error recovery at statement ends."
note queue.txt   "Queue design: at-least-once delivery, a 30s visibility timeout, a dead-letter queue after 5 receives."
note index.txt   "Index design: a B-tree on (tenant, created_at), a partial index for open rows, rebuilt online."
note limiter.txt "Limiter design: a token bucket per API key, 100 tokens, refilled at 10 a second, kept in Redis."
note auth.txt    "Auth design: short-lived access tokens, rotating refresh tokens, revocation by token family."
$T new-session -d -s d -x "${COLS:-150}" -y "${ROWS:-36}" -c "$DIR"; $T set -s focus-events on
$T send-keys -t d "claude --model haiku --setting-sources project,local --plugin-dir $MOD" Enter
sleep 8
if $T capture-pane -p -t d | grep -qi "trust this folder"; then $T send-keys -t d Down; sleep 0.5; $T send-keys -t d Enter; sleep 6; fi
# Typed into a shell, the prompts below would run as commands: go on only with Claude Code on screen.
$T capture-pane -p -t d | grep -q "Claude Code v" || { echo "Claude Code did not start; nothing was typed" >&2; exit 1; }
n=0
shot() { n=$((n + 1)); $T capture-pane -e -p -t d > "$OUT/$(printf 'f%03d' "$n")-$1.ans"; }
watch() { for _ in $(seq 1 "$2"); do sleep 0.5; shot "$1"; done; }   # $2 half-seconds
# Until the task tree has had agents and has none left, then $3 more half-seconds; at most $2.
watch_done() {
  local seen=0 quiet=0
  for _ in $(seq 1 "$2"); do
    sleep 0.5; shot "$1"
    if $T capture-pane -p -t d | grep -q '◯'; then seen=1; quiet=0
    elif [ "$seen" = 1 ]; then quiet=$((quiet + 1)); [ "$quiet" -ge "$3" ] && break; fi
  done
}
say() { $T send-keys -t d -l "$2"; sleep 1; shot "$1-typed"; $T send-keys -t d Enter; }
say s1 "$P1";                                watch_done s1 "${S1:-120}" 5
say set "/names set pirates Kidd Bonny Teach Rackham"; watch set 3
say use "/names use pirates";                watch use 3
say s2 "$P2";                                watch_done s2 "${S2:-120}" 8
