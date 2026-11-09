#!/usr/bin/env bash
# Start Claimsleuth. Loads .env if present.
cd "$(dirname "$0")"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
