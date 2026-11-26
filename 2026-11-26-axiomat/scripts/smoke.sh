#!/usr/bin/env bash
# Boots the server in mock mode and runs the API acceptance checks with curl.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8000}"
PY="${PYTHON:-.venv/bin/python}"
export PROVEN_MOCK=1
"$PY" -m uvicorn app.main:app --port "$PORT" >/tmp/proven-smoke.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do curl -sf "localhost:$PORT/api/health" >/dev/null && break; sleep 0.25; done
J() { curl -sf -X POST "localhost:$PORT$1" -H 'content-type: application/json' -d "$2"; }
chk() { "$PY" -c "import sys,json; d=json.load(sys.stdin); $1" || { echo "FAIL: $2"; exit 1; }; echo "ok: $2"; }
curl -sf "localhost:$PORT/api/health" | chk "assert d['mock'] is True" "health mock"
J /api/ask '{"question":"What was revenue by month in 2026?"}' | chk \
  "assert d['status']=='proven' and sum(c['passed'] for c in d['checks'])==7 and len(d['rows'])>=1 and 'succeeded' in d['restatement'] and 'refunded' in d['restatement']" "revenue proven"
J /api/ask '{"question":"How many customers do we have including trials?"}' | chk \
  "assert d['status']=='proven' and len(d['attempts'])>=2 and any(c['name']=='required_predicates_present' and not c['passed'] for c in d['attempts'][0]['checks'])" "retry loop"
J /api/ask '{"question":"What is our NPS?"}' | chk \
  "assert d['status']=='unproven' and d['rows']==[] and d['reason']" "NPS unproven"
J /api/verify '{"sql":"SELECT SUM(invoices.total) FROM invoices JOIN invoice_lines ON invoices.invoice_id = invoice_lines.invoice_id","metric":"revenue"}' | chk \
  "assert d['passed'] is False and 'forbidden' in json.dumps(d)" "verify rejects double count"
echo "ALL SMOKE CHECKS PASSED"
