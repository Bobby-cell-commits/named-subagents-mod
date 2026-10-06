#!/usr/bin/env bash
# Which userConfig field shapes does `claude plugin validate` accept? One scratch plugin per shape.
# Usage: config-types.sh <scratch_dir>   (an empty directory; left in place)
set -uo pipefail
S=${1:?scratch dir}; mkdir -p "$S"
try() { # <label> <field json>
  local d="$S/$1"; mkdir -p "$d/.claude-plugin" "$d/hooks"
  printf '{ "name": "cfg-%s", "version": "0.0.1", "description": "probe", "userConfig": { "x": %s } }\n' "$1" "$2" > "$d/.claude-plugin/plugin.json"
  printf '{ "modules": ["./m.ts"] }\n' > "$d/hooks/hooks.json"
  printf "import type { Register } from 'claude-code';\nexport const register: Register = () => {};\n" > "$d/hooks/m.ts"
  echo "== $1: $2"
  claude plugin validate "$d" 2>&1 | grep -v '^$' | grep -v 'Validating\|m.ts' | head -6
}
try string-list   '{"type":"string","multiple":true,"title":"T","description":"d"}'
try array         '{"type":"array","title":"T","description":"d"}'
try array-items   '{"type":"array","items":{"type":"string"},"title":"T","description":"d"}'
try strings       '{"type":"string[]","title":"T","description":"d"}'
try file          '{"type":"file","title":"T","description":"d"}'
try directory     '{"type":"directory","title":"T","description":"d"}'
try number        '{"type":"number","title":"T","description":"d","default":1}'
try bogus         '{"type":"bogus","title":"T","description":"d"}'
try string-plain  '{"type":"string","title":"T","description":"d","default":""}'
