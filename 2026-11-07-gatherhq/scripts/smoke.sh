#!/usr/bin/env bash
# Smoke test for acceptance checks A3-A9. Usage: BASE=http://localhost:3000 scripts/smoke.sh
# Requires: curl, jq. Run the server with MOCK_LLM=1.
BASE="${BASE:-http://localhost:3000}"
FAILS=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1 -- $2"; FAILS=$((FAILS+1)); }
J=(-H 'content-type: application/json')

# A3
R=$(curl -s -X POST "$BASE/api/studies" "${J[@]}" -d '{"title":"Smoke Study","goal":"Understand how marketing teams pick research tools","audience":"Heads of marketing at B2B SaaS"}')
SID=$(echo "$R" | jq -r '.id // empty'); NQ=$(echo "$R" | jq '.questions | length' 2>/dev/null)
if [ -n "$SID" ] && [ "${NQ:-0}" -ge 5 ] && [ "$NQ" -le 8 ]; then pass "A3 create study ($NQ questions, id=$SID)"; else fail A3 "$R"; fi

# A4
R=$(curl -s -X POST "$BASE/api/studies/$SID/interviews" "${J[@]}" -d '{}')
TOKEN=$(echo "$R" | jq -r '.token // empty')
PAGE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/interview/$TOKEN")
G=$(curl -s -X POST "$BASE/api/interviews/$TOKEN/messages" "${J[@]}" -d '{}' | jq -r '.message // empty')
DONE=false; POSTS=0
for i in $(seq 1 30); do
  D=$(curl -s -X POST "$BASE/api/interviews/$TOKEN/messages" "${J[@]}" -d '{"content":"We mostly use spreadsheets and ad hoc customer calls because budgets are tight and speed matters a lot."}')
  POSTS=$((POSTS+1)); DONE=$(echo "$D" | jq -r '.done'); [ "$DONE" = "true" ] && break
done
STATUS=$(curl -s "$BASE/api/interviews/$TOKEN/messages" | jq -r '.status')
if [ "$PAGE" = 200 ] && [ -n "$G" ] && [ "$POSTS" -ge 3 ] && [ "$DONE" = true ] && [ "$STATUS" = complete ]; then pass "A4 interview ($POSTS posts, page=$PAGE, status=$STATUS)"; else fail A4 "page=$PAGE greeting=[$G] posts=$POSTS done=$DONE status=$STATUS"; fi

# A5
R=$(curl -s -X POST "$BASE/api/studies/$SID/synthetic" "${J[@]}" -d '{"n":2}')
OK=$(echo "$R" | jq '[.created[] | select(.messages >= 6)] | length' 2>/dev/null)
ST=$(curl -s "$BASE/api/studies/$SID" | jq '[.interviews[] | select(.synthetic==1 and .status=="complete")] | length')
if [ "$OK" = 2 ] && [ "$ST" = 2 ]; then pass "A5 synthetic panel (2 complete, >=6 messages each)"; else fail A5 "$R"; fi

# A6
R=$(curl -s -X POST "$BASE/api/studies/$SID/synthesize" "${J[@]}" -d '{}')
TH=$(curl -s "$BASE/api/studies/$SID" | jq '.model.model.themes | length' 2>/dev/null)
SEG=$(curl -s "$BASE/api/studies/$SID" | jq '.model.model.segments | length' 2>/dev/null)
if [ "${TH:-0}" -ge 1 ] && [ "${SEG:-0}" -ge 1 ]; then pass "A6 synthesize ($TH themes, $SEG segments)"; else fail A6 "$R"; fi

# A7
R=$(curl -s -X POST "$BASE/api/studies/$SID/ask" "${J[@]}" -d '{"question":"What stops buyers from adopting a research tool?"}')
CID=$(echo "$R" | jq -r '.citations[0].interview_id // empty')
VALID=$(curl -s "$BASE/api/studies/$SID" | jq --arg c "$CID" '[.interviews[] | select(.id==$c)] | length')
if [ -n "$CID" ] && [ "$VALID" = 1 ]; then pass "A7 ask (citation -> real interview $CID)"; else fail A7 "$R"; fi

# A8
R=$(curl -s -X POST "$BASE/api/studies/$SID/simulate" "${J[@]}" -d '{"stimulus":"We are raising the price by 20% and adding annual billing only."}')
N=$(echo "$R" | jq '.reactions | length' 2>/dev/null); INTS=$(echo "$R" | jq '[.reactions[] | select((.sentiment|type)=="number" and .sentiment==(.sentiment|floor) and .sentiment>=-2 and .sentiment<=2)] | length' 2>/dev/null)
if [ "${N:-0}" -ge 3 ] && [ "$INTS" = "$N" ]; then pass "A8 simulate ($N reactions)"; else fail A8 "$R"; fi

# A9
H=$(curl -s -D - "$BASE/api/studies/$SID/report")
if echo "$H" | grep -qi 'text/markdown' && echo "$H" | grep -q 'Smoke Study'; then pass "A9 report markdown contains title"; else fail A9 "$(echo "$H" | head -5)"; fi

echo "----"; [ $FAILS -eq 0 ] && echo "ALL PASS" || echo "$FAILS FAILED"
exit $FAILS
