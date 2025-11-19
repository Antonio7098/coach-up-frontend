#!/usr/bin/env bash
set -euo pipefail

# Simple triage smoke tester for coach-min UI API.
# - Discovers recent assistant→user pairs for a session and posts triage requests.
# - Prints results (updated, decisions, jobId) and pulls matching events.
#
# Usage:
#   bash scripts/triage_smoke.sh <SESSION_ID> [--pairs N] [--base URL]
#
# Examples:
#   bash scripts/triage_smoke.sh d127f277-9511-43e7-8ccf-6e8221dcd0cf
#   bash scripts/triage_smoke.sh d127f277-... --pairs 3 --base http://127.0.0.1:3000
#
# Notes:
# - Requires `jq` installed.
# - No auth headers needed for local UI API (requireAuth is relaxed for /api).

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for this script. Please install jq and try again." >&2
  exit 1
fi

SESSION_ID="${1:-}"; shift || true
if [[ -z "$SESSION_ID" ]]; then
  echo "Usage: bash scripts/triage_smoke.sh <SESSION_ID> [--pairs N] [--base URL]" >&2
  exit 1
fi

PAIRS=3
UI_BASE="http://127.0.0.1:3000"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pairs)
      PAIRS="${2:-3}"; shift 2 || true ;;
    --base)
      UI_BASE="${2:-http://127.0.0.1:3000}"; shift 2 || true ;;
    *)
      echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

request() {
  local method="$1" ; shift
  local url="$1" ; shift
  if [[ "$method" == "GET" ]]; then
    curl -sS --fail-with-body -X GET "$url"
  else
    curl -sS --fail-with-body -H 'Content-Type: application/json' -X "$method" "$url" "$@"
  fi
}

triage_ids() {
  local session_id="$1" ; shift
  local json_ids="$1" ; shift
  local out
  out=$(request POST "${UI_BASE}/api/v1/triage?sessionId=${session_id}" -d "${json_ids}")
  echo "$out" | jq -C . || true
  local job_id
  job_id=$(echo "$out" | jq -r '.jobId // empty')
  if [[ -n "$job_id" ]]; then
    echo "--- events (jobId=$job_id) ---"
    request GET "${UI_BASE}/api/v1/events?sessionId=${session_id}&limit=100" \
      | jq -C ".events | map(select(.payload.jobId==\"$job_id\"))" || true
  fi
}

# Fetch recent interactions (id, role, text, createdAt)
fetch_interactions() {
  local session_id="$1"
  request GET "${UI_BASE}/api/v1/interactions?sessionId=${session_id}&limit=40" \
    | jq -c '.interactions // []'
}

# Build assistant→user adjacent pairs from the interaction list (ordered ascending by createdAt)
build_pairs() {
  local interactions_json="$1"
  echo "$interactions_json" \
    | jq -c 'reverse | . as $rev | [range(0; ($rev|length - 1))
            | {a: $rev[.], b: $rev[.+1]}
            | select((.a.role=="assistant") and (.b.role=="user"))
            | {assistant_id: .a.messageId, user_id: .b.messageId, a_text: .a.text, b_text: .b.text}]'
}

main() {
  echo "== Triage smoke: sessionId=$SESSION_ID base=$UI_BASE pairs=$PAIRS =="
  local interactions
  interactions=$(fetch_interactions "$SESSION_ID")
  local pairs
  pairs=$(build_pairs "$interactions")
  local total
  total=$(echo "$pairs" | jq 'length')
  if [[ "$total" -eq 0 ]]; then
    echo "No assistant→user pairs found in recent interactions." >&2
    exit 0
  fi

  # Take up to PAIRS most recent pairs
  local slice
  slice=$(echo "$pairs" | jq ". | .[:$PAIRS]")

  echo "Found $total pairs; testing up to $PAIRS of them..."
  echo "$slice" | jq -C '. | to_entries | map({i: .key, assistant_id: .value.assistant_id, user_id: .value.user_id, a_text: (.value.a_text|tostring|.[:60]), b_text: (.value.b_text|tostring|.[:60])})'

  # Iterate pairs and triage
  local i=0
  while true; do
    local pair
    pair=$(echo "$slice" | jq -c ".[$i] // empty")
    if [[ -z "$pair" ]]; then break; fi
    local aid uid
    aid=$(echo "$pair" | jq -r '.assistant_id')
    uid=$(echo "$pair" | jq -r '.user_id')
    echo
    echo "--- Triage pair #$((i+1)) ---"
    echo "assistant_id=$aid"
    echo "user_id=$uid"
    triage_ids "$SESSION_ID" "{\"messageIds\":[\"$aid\",\"$uid\"]}"
    i=$((i+1))
  done

  echo
  echo "== Done =="
}

main "$@"
