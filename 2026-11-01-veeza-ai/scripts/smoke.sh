#!/usr/bin/env bash
# Smoke test: checks 2-7 against a running server (start it with MOCK_LLM=1).
# Usage: BASE_URL=http://localhost:3000 bash scripts/smoke.sh
set -u
BASE="${BASE_URL:-http://localhost:3000}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
FAILS=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1  -- $2"; FAILS=$((FAILS+1)); }
jget() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);const v=($1);console.log(v===undefined?'':typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('')}})"; }

node "$ROOT/scripts/make-samples.mjs" "$TMP" >/dev/null

# 2: landing page
code=$(curl -s -o "$TMP/home.html" -w '%{http_code}' "$BASE/")
if [ "$code" = "200" ] && grep -qi "destination" "$TMP/home.html"; then pass "2 landing page 200 + contains 'destination'"; else fail "2 landing" "http=$code"; fi

# 3: create application, list required docs
code=$(curl -s -o "$TMP/app.json" -w '%{http_code}' -X POST "$BASE/api/applications" -H 'content-type: application/json' \
  -d '{"destinationCode":"HR","nationality":"EG","purpose":"tourism","departureDate":"2026-12-10","returnDate":"2026-12-20","travellerCount":1}')
APP=$(jget 'o.id' < "$TMP/app.json")
curl -s "$BASE/api/applications/$APP" > "$TMP/view.json"
NDOCS=$(jget 'o.requiredDocuments.length' < "$TMP/view.json")
if [ "$code" = "201" ] && [ -n "$APP" ] && [ "${NDOCS:-0}" -ge 6 ]; then pass "3 create application (201, id=$APP, $NDOCS required docs)"; else fail "3 create" "http=$code docs=$NDOCS"; fi

# 4: passport upload
code=$(curl -s -o "$TMP/trav.json" -w '%{http_code}' -X POST "$BASE/api/applications/$APP/travellers" -F "file=@$TMP/passport.png;type=image/png")
TID=$(jget 'o.id' < "$TMP/trav.json")
SURNAME=$(jget 'o.passport.surname' < "$TMP/trav.json")
CONF=$(jget 'o.confidence.surname' < "$TMP/trav.json")
INVIEW=$(curl -s "$BASE/api/applications/$APP" | jget 'o.travellers.length')
if [ "$code" = "201" ] && [ -n "$SURNAME" ] && [ -n "$CONF" ] && [ "$INVIEW" = "1" ]; then pass "4 passport extraction (surname=$SURNAME, confidence=$CONF, traveller listed)"; else fail "4 passport" "http=$code surname=$SURNAME conf=$CONF inview=$INVIEW"; fi

# 5: PDF bank statement + readiness
code=$(curl -s -o "$TMP/doc.json" -w '%{http_code}' -X POST "$BASE/api/applications/$APP/documents" \
  -F "type=bank_statement" -F "travellerId=$TID" -F "file=@$TMP/bank_statement.pdf;type=application/pdf")
VERDICT=$(jget 'o.verification.verdict' < "$TMP/doc.json")
curl -s "$BASE/api/applications/$APP/readiness" > "$TMP/ready.json"
SCORE=$(jget 'o.score' < "$TMP/ready.json"); BAND=$(jget 'o.band' < "$TMP/ready.json"); NARR=$(jget 'o.narrative.length' < "$TMP/ready.json")
if [ "$code" = "201" ] && [ -n "$VERDICT" ] && [ -n "$SCORE" ] && [ "$SCORE" -ge 0 ] && [ "$SCORE" -le 100 ] && [ -n "$BAND" ] && [ "${NARR:-0}" -gt 0 ]; then
  pass "5 document verification (verdict=$VERDICT) + readiness (score=$SCORE, band=$BAND)"; else fail "5 document/readiness" "http=$code verdict=$VERDICT score=$SCORE band=$BAND"; fi

# 6: form PDF
curl -s -D "$TMP/h.txt" -o "$TMP/form.pdf" "$BASE/api/applications/$APP/travellers/$TID/form.pdf"
CT=$(grep -i '^content-type' "$TMP/h.txt" | tr -d '\r')
MAGIC=$(head -c 4 "$TMP/form.pdf")
TXT=$(cd "$ROOT" && node scripts/pdftext.mjs "$TMP/form.pdf" 2>/dev/null)
if echo "$CT" | grep -qi 'application/pdf' && [ "$MAGIC" = "%PDF" ] && echo "$TXT" | grep -q "$SURNAME"; then pass "6 form.pdf (application/pdf, %PDF, contains surname $SURNAME)"; else fail "6 form.pdf" "ct=$CT magic=$MAGIC"; fi

# 7: quiz
curl -s -X POST "$BASE/api/quiz" -H 'content-type: application/json' \
  -d '{"answers":{"passport_validity":"gt6","previous_visas":"one","employment":"employed","bank_balance":"enough","bookings":"both","travel_history":"some","insurance":"no"}}' > "$TMP/quiz.json"
QS=$(jget 'o.score' < "$TMP/quiz.json"); QN=$(jget 'o.narrative.length' < "$TMP/quiz.json")
if [ -n "$QS" ] && [ "${QN:-0}" -gt 0 ]; then pass "7 quiz (score=$QS)"; else fail "7 quiz" "score=$QS"; fi

rm -rf "$TMP"
if [ "$FAILS" -eq 0 ]; then echo "ALL PASS"; exit 0; else echo "$FAILS FAILED"; exit 1; fi
