#!/usr/bin/env bash
# Starts the server, runs the three refund scenarios in mock mode, checks exit codes 0/1/0, stops the server.
set -u
cd "$(dirname "$0")/.."
PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  if [ -x .venv/bin/python ]; then PY=.venv/bin/python; else PY=python; fi
fi
PORT="${REHEARSAL_PORT:-8787}"
export REHEARSAL_MOCK=1
LOG="$(mktemp)"
"$PY" -m uvicorn rehearsal.server:app --port "$PORT" --log-level warning >"$LOG" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; rm -f "$LOG"' EXIT

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then break; fi
  sleep 0.25
done
if ! curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
  echo "server failed to start"; cat "$LOG"; exit 1
fi
echo "server up on :$PORT (pid $SERVER_PID)"

FAILED=0
check() { # name expected-exit
  "$PY" -m rehearsal.grade "scenarios/$1.yaml" --base "http://127.0.0.1:$PORT" >/tmp/rehearsal_smoke_$1.out 2>&1
  code=$?
  if [ "$code" -eq "$2" ]; then echo "ok   $1 -> exit $code"; else echo "FAIL $1 -> exit $code (expected $2)"; cat /tmp/rehearsal_smoke_$1.out; FAILED=1; fi
  rm -f /tmp/rehearsal_smoke_$1.out
}
check refund_happy_path 0
check refund_flaky_network 1
check refund_flaky_network_idempotent 0

if [ "$FAILED" -eq 0 ]; then echo "ALL SMOKE CHECKS PASSED"; else echo "SMOKE CHECKS FAILED"; exit 1; fi
