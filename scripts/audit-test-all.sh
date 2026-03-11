#!/bin/bash
# Run dependency audit and test for every ComfyUI workflow via the GT-Workflows API.
# Server URLs are read from each workflow's params.comfyui_config.serverUrl.
# Workflows without a serverUrl (or with a non-comfyui parser) are skipped.
#
# Usage:   ./scripts/audit-test-all.sh <user> <pass> <api_url>
# Example: ./scripts/audit-test-all.sh admin secret http://localhost:3011
#
# Exit code: 0 if every audit is OK and every test PASSES, 1 otherwise.
# Dependencies: curl, jq

set -uo pipefail

# ── Helpers ────────────────────────────────────────────────────────────────────

die()       { echo "Error: $*" >&2; exit 1; }
urlencode() { jq -rn --arg s "$1" '$s | @uri'; }

# ── Args ───────────────────────────────────────────────────────────────────────

[ $# -ge 3 ] || die "Usage: $0 <user> <pass> <api_url>"

USER="$1"
PASS="$2"
API_URL="${3%/}"

command -v curl >/dev/null 2>&1 || die "curl is required"
command -v jq   >/dev/null 2>&1 || die "jq is required"

# Audit timeout: server allows up to 180 s; give 20 s extra for overhead.
AUDIT_TIMEOUT=200
# Test timeout: server retries up to 450 s; give 60 s extra.
TEST_TIMEOUT=510

# ── Fetch workflow list ────────────────────────────────────────────────────────

echo "Fetching workflow list from ${API_URL} ..."

list_json=$(curl -sf --max-time 30 \
  -u "$USER:$PASS" \
  "$API_URL/api/workflows/list" 2>/dev/null) \
  || die "Failed to fetch workflow list (check URL, credentials, and server status)"

echo "$list_json" | jq -e '.workflows' >/dev/null 2>&1 \
  || die "Unexpected response from API (not a valid workflows list)"

mapfile -t names < <(echo "$list_json" | jq -r '.workflows[].name // empty')
total=${#names[@]}

if [ "$total" -eq 0 ]; then
  echo "No workflows found."
  exit 0
fi

echo "Found ${total} workflow(s)."
echo

# ── Counters ───────────────────────────────────────────────────────────────────

audit_ok=0;   audit_nok=0;   audit_skip=0
test_ok=0;    test_nok=0;    test_skip=0

# ── Per-workflow loop ──────────────────────────────────────────────────────────

for name in "${names[@]}"; do
  encoded=$(urlencode "$name")

  # Extract server URLs: comfyui_config.serverUrl may be a string or an array
  mapfile -t server_urls < <(echo "$list_json" | jq -r --arg n "$name" '
    .workflows[] | select(.name == $n)
    | .params.comfyui_config.serverUrl
    | if type == "array" then .[] else . end
    | select(. != null and . != "")
  ' 2>/dev/null || true)

  echo "── ${name}"

  if [ ${#server_urls[@]} -eq 0 ]; then
    echo "   SKIP (no comfyui_config.serverUrl configured)"
    audit_skip=$((audit_skip + 1))
    test_skip=$((test_skip + 1))
    echo
    continue
  fi

  for server_url in "${server_urls[@]}"; do
    server_url="${server_url%/}"
    echo "   server: ${server_url}"

    # ── Audit ────────────────────────────────────────────────────────────────

    printf "   audit ... "

    audit_json=""
    audit_json=$(curl -s --max-time "$AUDIT_TIMEOUT" \
      -u "$USER:$PASS" \
      -X POST -H "Content-Type: application/json" \
      -d "{\"serverUrl\":\"${server_url}\"}" \
      "$API_URL/api/workflows/$encoded/audit" 2>/dev/null) || true

    if [ -z "$audit_json" ]; then
      echo "SKIP (no response from server)"
      audit_skip=$((audit_skip + 1))
    elif echo "$audit_json" | jq -e '.error' >/dev/null 2>&1; then
      err=$(echo "$audit_json" | jq -r '.error // "unknown error"')
      echo "SKIP (${err})"
      audit_skip=$((audit_skip + 1))
    else
      status=$(echo "$audit_json" | jq -r '.status // "nok"')
      if [ "$status" = "ok" ]; then
        echo "OK"
        audit_ok=$((audit_ok + 1))
      else
        details=$(echo "$audit_json" | jq -r '
          [
            (if .nodeError then "nodeError: \(.nodeError)" else empty end),
            (.nodes[]?  | select(.available == false) | "missing node: \(.name)"),
            (.models    | to_entries[]? | .value[]?
                        | select(.available == false) | "missing model: \(.name)"),
            (.files[]?  | select(.available == false) | "missing file: \(.name)")
          ] | join("; ")
        ' 2>/dev/null || true)
        echo "NOK${details:+ — ${details}}"
        audit_nok=$((audit_nok + 1))
      fi
    fi

    # ── Test (SSE stream) ─────────────────────────────────────────────────────

    printf "   test  ... "

    tmp=$(mktemp)
    curl_rc=0
    curl -sN --max-time "$TEST_TIMEOUT" \
      -u "$USER:$PASS" \
      -X POST -H "Content-Type: application/json" \
      -d "{\"serverUrl\":\"${server_url}\"}" \
      "$API_URL/api/workflows/$encoded/test" >"$tmp" 2>&1 || curl_rc=$?

    if [ "$curl_rc" -ne 0 ] && [ "$curl_rc" -ne 23 ]; then
      # curl exit 23 = write error (stream ended by server), not a failure
      echo "SKIP (curl error ${curl_rc})"
      test_skip=$((test_skip + 1))
    elif grep -q "^event: completed" "$tmp" 2>/dev/null; then
      echo "PASSED"
      test_ok=$((test_ok + 1))
    elif grep -q "^event: error" "$tmp" 2>/dev/null; then
      raw=$(grep -A1 "^event: error" "$tmp" | grep "^data:" | head -1 \
            | sed 's/^data: //' || true)
      msg=$(echo "$raw" | jq -r '.message // empty' 2>/dev/null || true)
      echo "FAILED${msg:+ — ${msg}}"
      test_nok=$((test_nok + 1))
    else
      echo "FAILED (no completion event received)"
      test_nok=$((test_nok + 1))
    fi

    rm -f "$tmp"

  done

  echo

done

# ── Summary ────────────────────────────────────────────────────────────────────

echo "══════════════════════════════════════════"
printf " Workflows              : %d\n"               "$total"
printf " Audit   OK / NOK / SKIP : %d / %d / %d\n"   "$audit_ok" "$audit_nok" "$audit_skip"
printf " Test    OK / NOK / SKIP : %d / %d / %d\n"   "$test_ok"  "$test_nok"  "$test_skip"
echo "══════════════════════════════════════════"

failures=$((audit_nok + test_nok))
[ "$failures" -eq 0 ] || exit 1
