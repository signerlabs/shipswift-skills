#!/usr/bin/env bash
# integration-test.sh — full end-to-end verification of shipswift-mcp-proxy
# against the real upstream server. Brings up the proxy, runs all 6 cases,
# reports pass/fail, and tears down.
#
# Usage: bash ~/.mimocode/lib/test/integration-test.sh [PORT]
set -uo pipefail

PORT="${1:-${SHIPSWIFT_PROXY_PORT:-7657}}"
PROXY_SCRIPT="${SHIPSWIFT_PROXY_SCRIPT:-$HOME/.mimocode/lib/shipswift-mcp-proxy.js}"
LOG_FILE="${SHIPSWIFT_PROXY_LOG:-/tmp/shipswift-proxy-test.log}"

cleanup() {
  if [ -n "${PROXY_PID:-}" ] && kill -0 "$PROXY_PID" 2>/dev/null; then
    kill "$PROXY_PID" 2>/dev/null || true
    wait "$PROXY_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "Launching proxy on port $PORT → https://api.shipswift.app/mcp"
node "$PROXY_SCRIPT" --port "$PORT" > "$LOG_FILE" 2>&1 &
PROXY_PID=$!
sleep 1.5

# Verify proxy is up
HEALTH=$(curl -s "http://127.0.0.1:$PORT/health" || true)
if [ -z "$HEALTH" ]; then
  echo "FAIL: proxy didn't start. Log:"
  cat "$LOG_FILE"
  exit 1
fi
echo "Proxy up: $HEALTH"

# Initialize session
SID="itest-$(uuidgen)"
curl -sS -X POST "http://127.0.0.1:$PORT/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"itest","version":"1.0"}}}' \
  > /dev/null
curl -sS -X POST "http://127.0.0.1:$PORT/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  > /dev/null

# Helper: post a JSON-RPC and assert on the result
run_case() {
  local label="$1"
  local payload="$2"
  local jq_assertion="$3"

  local response
  response=$(curl -sS -X POST "http://127.0.0.1:$PORT/mcp" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -H "Mcp-Session-Id: $SID" \
    -d "$payload")

  # Use python for parsing because jq isn't guaranteed on this machine
  if echo "$response" | python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
$jq_assertion
"; then
    echo "  PASS  $label"
    return 0
  else
    echo "  FAIL  $label"
    echo "    response (first 400 chars): $(echo "$response" | head -c 400)"
    return 1
  fi
}

PASS=0
FAIL=0
TOTAL=0

check() {
  TOTAL=$((TOTAL+1))
  if "$@"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
}

echo ""
echo "=== Integration test cases ==="

# Case 1: Empty args to build-feature (THE BUG)
check run_case "empty args to build-feature returns successful prompt" \
  '{"jsonrpc":"2.0","id":2,"method":"prompts/get","params":{"name":"build-feature","arguments":{}}}' \
  "
assert 'error' not in d, f'unexpected error: {d.get(\"error\")}'
assert d['result']['description'].startswith('Build '), f'wrong description: {d[\"result\"][\"description\"]}'
assert 'SwiftUI' in d['result']['description'], 'default platform not applied'
"

# Case 2: Only feature → platform defaults to SwiftUI
check run_case "feature-only args defaults platform to SwiftUI" \
  '{"jsonrpc":"2.0","id":3,"method":"prompts/get","params":{"name":"build-feature","arguments":{"feature":"login with Apple"}}}' \
  "
assert 'error' not in d
assert d['result']['description'] == 'Build \"login with Apple\" using ShipSwift recipes (SwiftUI)', d['result']['description']
"

# Case 3: Both args → pass through unchanged
check run_case "explicit args preserved (UIKit, not defaulted to SwiftUI)" \
  '{"jsonrpc":"2.0","id":4,"method":"prompts/get","params":{"name":"build-feature","arguments":{"feature":"settings","platform":"UIKit"}}}' \
  "
assert 'error' not in d
assert 'UIKit' in d['result']['description']
assert 'SwiftUI' not in d['result']['description']
"

# Case 4: Empty args to explore-recipes → defaults projectType
check run_case "empty args to explore-recipes defaults projectType" \
  '{"jsonrpc":"2.0","id":5,"method":"prompts/get","params":{"name":"explore-recipes","arguments":{}}}' \
  "
assert 'error' not in d
assert 'iOS app' in d['result']['description']
"

# Case 5: prompts/list still works (was the noisy -32601 path; now -32601 stays because it's a real missing method)
# Note: we only fix prompts/get, not prompts/list. This test just confirms list still works for the proxy
check run_case "prompts/list still returns the catalog" \
  '{"jsonrpc":"2.0","id":6,"method":"prompts/list"}' \
  "
assert 'error' not in d
names = [p['name'] for p in d['result']['prompts']]
assert 'build-feature' in names, names
assert 'explore-recipes' in names, names
"

# Case 6: Unknown prompt → pass through (server will reject, which is correct behavior)
check run_case "unknown prompt name passes through to upstream" \
  '{"jsonrpc":"2.0","id":7,"method":"prompts/get","params":{"name":"bogus-prompt","arguments":{}}}' \
  "
# Upstream returns an error for unknown prompt — that's the correct behavior
assert 'error' in d or d.get('result') is None
"

echo ""
echo "=== Summary ==="
echo "Passed: $PASS / $TOTAL"
if [ "$FAIL" -gt 0 ]; then
  echo "Failed: $FAIL"
  exit 2
fi
echo "All cases passed ✓"