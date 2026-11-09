#!/usr/bin/env bash
# Smoke test for ClaimCheck. Expects the app running (MOCK_LLM=1 npm run start).
# Usage: BASE=http://localhost:3000 bash scripts/smoke.sh
BASE="${BASE:-http://localhost:3000}"
FAILS=0

pass() { echo "PASS $1${2:+ - $2}"; }
fail() { echo "FAIL $1${2:+ - $2}"; FAILS=$((FAILS+1)); }
# js '<expr over d>' reads JSON from stdin; prints result of expr
js() { node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{try{const d=JSON.parse(s);const r=($1);console.log(r)}catch(e){console.log('ERR '+e.message)}})"; }
check() { # id, condition-output, description
  if [ "$2" = "true" ]; then pass "$1" "$3"; else fail "$1" "$3 (got: $2)"; fi
}
post() { curl -s -X POST -H 'content-type: application/json' -d "$2" "$BASE$1"; }

# A3
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")
health=$(curl -s "$BASE/api/health")
ok=$(echo "$health" | js 'd.ok===true && d.mock===true')
if [ "$code" = "200" ] && [ "$ok" = "true" ]; then pass A3 "GET / 200, health $health"; else fail A3 "code=$code health=$health"; fi

# A4
C=$(post /api/contracts '{"sample":true}')
CID=$(echo "$C" | js 'd.id')
DET=$(curl -s "$BASE/api/contracts/$CID")
r=$(echo "$DET" | js '(()=>{const t=d.terms.terms;const n=t.filter(x=>["fee_schedule","case_rate","per_diem","carve_out"].includes(x.kind)).length;const sl=t.filter(x=>x.kind==="stop_loss");return n>=9&&sl.length===1&&sl[0].threshold===100000&&sl[0].percent===70&&t.filter(x=>x.kind==="escalator").length===1&&t.filter(x=>x.kind==="default_rule").length===1})()')
check A4 "$r" "contract created ($CID) with expected term structure"
SL=$(echo "$DET" | js 'd.terms.terms.find(x=>x.kind==="stop_loss").id')

# A5
CL=$(post "/api/contracts/$CID/claims" '{"sample":true}')
r=$(echo "$CL" | js '(()=>{const x=d.rows.find(r=>r.code==="470"&&r.billed_charges===160000);return d.total===14&&d.underpaid>=6&&d.overpaid===1&&d.no_rate_found===0&&x.expected_amount===66500&&x.variance===24500&&x.clause_ref==="'"$SL"'"})()')
check A5 "$r" "total=14, underpaid>=6, overpaid=1, DRG470 expected 66500 via $SL"
echo "     summary: $(echo "$CL" | js 'JSON.stringify({total:d.total,underpaid:d.underpaid,overpaid:d.overpaid,ok:d.ok,no_rate_found:d.no_rate_found,total_underpaid_amount:d.total_underpaid_amount})')"

# A6
r=$(echo "$CL" | js '(()=>{const oks=d.rows.filter(r=>r.flag==="ok");return oks.length>=5&&oks.every(r=>Math.abs(r.variance)<=25)})()')
check A6 "$r" "correctly paid claims are flag=ok with |variance|<=25"

# A7
ROW=$(echo "$CL" | js 'd.rows.find(r=>r.code==="470"&&r.billed_charges===160000).id')
AP=$(post "/api/claims/$ROW/appeal" '{}')
CLAUSE40=$(echo "$DET" | js 'd.terms.terms.find(x=>x.kind==="stop_loss").source_clause.slice(0,40)')
r=$(echo "$AP" | CLAUSE40="$CLAUSE40" js '(()=>{const l=d.letter;return l.includes("C1001")&&l.includes("66,500")&&l.includes("42,000")&&l.includes(process.env.CLAUSE40)})()')
check A7 "$r" "appeal letter has claim id, 66,500, 42,000, stop-loss clause"

# A8
ASK=$(post "/api/contracts/$CID/ask" '{"messages":[{"role":"user","content":"What is the stop-loss threshold?"}]}')
if echo "$ASK" | grep -Eq '100,?000' && echo "$ASK" | grep -q '70'; then pass A8 "ask mentions 100,000 and 70"; else fail A8 "$ASK"; fi

# A9
WI=$(post "/api/contracts/$CID/whatif" '{"term_id":"drg-470","rate":30000}')
r=$(echo "$WI" | js 'd.delta>0 && d.changed_claims>=1')
check A9 "$r" "whatif DRG470 -> 30000: $(echo "$WI" | js 'JSON.stringify({before:d.before_total,after:d.after_total,delta:d.delta,changed:d.changed_claims})')"

# A10
curl -s -X PATCH -H 'content-type: application/json' -d '{"status":"appealed"}' "$BASE/api/claims/$ROW" >/dev/null
r=$(curl -s "$BASE/api/claims/$ROW" | js 'd.status==="appealed"')
check A10 "$r" "PATCH status=appealed persisted"

# A11
a=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")
b=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/contracts/$CID")
c=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/claims/$ROW")
if [ "$a$b$c" = "200200200" ]; then pass A11 "/, /contracts/$CID, /claims/$ROW all 200"; else fail A11 "$a $b $c"; fi

echo "----"
if [ "$FAILS" -eq 0 ]; then echo "ALL SMOKE CHECKS PASSED"; else echo "$FAILS CHECK(S) FAILED"; exit 1; fi
