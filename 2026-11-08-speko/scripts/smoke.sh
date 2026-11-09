#!/usr/bin/env bash
# Boots uvicorn in mock mode on a temp DB and curls the main endpoints.
set -euo pipefail
cd "$(dirname "$0")/.."
PY=${PYTHON:-.venv/bin/python}
PORT=${SMOKE_PORT:-8765}
DB=$(mktemp -d)/smoke.db
export DATABASE_URL="$DB" MOCK_MODE=1
unset ANTHROPIC_API_KEY OPENAI_API_KEY || true
$PY -m uvicorn app.main:app --port "$PORT" --log-level warning &
PID=$!
trap 'kill $PID 2>/dev/null || true; wait $PID 2>/dev/null || true' EXIT
B=http://127.0.0.1:$PORT
for i in $(seq 1 60); do curl -sf "$B/api/health" >/dev/null && break; sleep 0.5; done
fail() { echo "SMOKE FAIL: $*"; exit 1; }
j() { $PY -c "import sys,json; d=json.load(sys.stdin); print($1)"; }

[ "$(curl -s -o /dev/null -w '%{http_code}' $B/)" = 200 ] || fail "GET /"
curl -s $B/ | grep -q "Speko-lite" || fail "dashboard html"
echo "ok GET /"
curl -sf $B/api/providers | j "len(d['providers'])" | grep -qx 9 || fail providers
echo "ok providers"
curl -sf -X POST $B/api/benchmarks/run -H 'content-type: application/json' -d '{}' | j "d['rows_inserted']" | grep -qx 45 || fail bench-run
curl -sf "$B/api/benchmarks?stage=stt&language=hi" | j "d['results'][0]['provider']" | grep -qx mock-stt-beta || fail leaderboard
echo "ok benchmarks"
R() { curl -sf -X POST $B/api/route -H 'content-type: application/json' -d "{\"stage\":\"stt\",\"language\":\"$1\",\"priority\":\"$2\"}" | j "d['selected']"; }
[ "$(R en quality)" = mock-stt-alpha ] || fail route-en
[ "$(R hi quality)" = mock-stt-beta ] || fail route-hi
[ "$(R en cost)" = mock-stt-gamma ] || fail route-cost
echo "ok route"
T() { curl -sf -X POST $B/api/turn -F text="please book a table" -F language=en -F priority=quality; }
T | j "len(d['trace'])" | grep -qx 3 || fail turn
T | j "d['audio_base64'][:4]" | grep -qx UklG || fail "wav header"
echo "ok turn"
curl -sf -X POST $B/api/admin/fault -H 'content-type: application/json' -d '{"provider":"mock-stt-alpha","mode":"fail"}' >/dev/null
T | j "d['trace'][0]['attempts'][0]['ok'], d['trace'][0]['provider']" | grep -q "^False mock-stt-" || fail failover
T >/dev/null; T >/dev/null
T | j "'mock-stt-alpha' in [a['provider'] for a in d['trace'][0]['attempts']]" | grep -qx False || fail breaker
curl -sf $B/api/health | j "[p['circuit_open'] for p in d['providers'] if p['provider']=='mock-stt-alpha'][0]" | grep -qx True || fail breaker-state
echo "ok failover + breaker"
curl -sf -X POST $B/api/admin/fault -H 'content-type: application/json' -d '{"provider":"mock-stt-alpha","mode":"ok"}' >/dev/null
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/route -H 'content-type: application/json' -d '{"stage":"stt","language":"xx"}')" = 422 ] || fail validation
curl -sf "$B/api/turns?limit=3" | j "len(d['turns'])" | grep -qx 3 || fail turns
echo "SMOKE PASS"
