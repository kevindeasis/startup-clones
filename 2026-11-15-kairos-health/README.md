# ChairFill - a learning clone of Kairos Health (AI front desk for dental practices)

> **Independent learning clone built for education. It is not affiliated with, endorsed by, or derived from the code of Kairos Health.** It is built only from the company's public descriptions. All patients, payers, providers and the practice ("Maple Street Dental") in this repo are fictional.

## What the original company does

[Kairos Health](https://kairoshealthai.com) (YC F26, [YC page](https://www.ycombinator.com/companies/kairos-health)) sells an "AI front desk that fills every chair for dental practices". It plugs into the practice-management system (Open Dental, Dentrix, Eaglesoft, ...), answers every inbound patient call 24/7 (scheduling, rescheduling, intake, insurance questions), verifies insurance benefits in seconds, and runs outbound recall: it finds patients overdue for care and calls or texts them to book straight into open slots. It also reports analytics on calls, bookings and follow-ups.

## What this clone does

Single practice, self-hosted, no auth. SQLite plays the role of the practice-management system. The "phone call" is a chat transcript.

1. **Inbound AI receptionist** (`/`): chat panel styled as a call. It greets, identifies the patient (name + DOB, or registers a new patient), finds the reason, checks real availability, offers at most 3 slots, confirms, books, and reads back date/time/provider/chair. It also reschedules, cancels, answers FAQs (hours, address, parking, insurers, what to bring), verifies insurance, and takes messages for staff. Every tool call is listed under each reply. A conversation ends with an outcome: `booked | rescheduled | cancelled | insurance_verified | faq | message_taken | abandoned`. Optional browser-only voice toggle (Web Speech API, silently disabled if unsupported).
2. **Outbound recall** (`/recall`): "Run recall" finds overdue patients (last completed hygiene/exam older than `RECALL_MONTHS` and nothing scheduled) and writes a personalised SMS-style text with 2 proposed slots in the next 14 days and an opt-out line. Each outreach has a "Simulate reply" box handled by the same agent (channel `recall`), which books, or marks the outreach `declined` / `snoozed`. Counters: overdue, sent, replies, booked from recall.
3. **Insurance verification** (`/insurance` and the `verify_insurance` tool): looks up a fictional payer directory (Delta Mutual, Aetnor, BlueCrest, Medicaid-Demo) and returns eligibility, plan, network status, annual and remaining maximum, coverage %, copay notes and flags (`inactive_member`, `out_of_network`, `low_remaining_max` (< $200), `waiting_period`, `member_not_found`). Results are stored on the patient's plan row with `verified_at`.
4. **Schedule dashboard** (`/schedule?date=YYYY-MM-DD`): 4 chairs x 30-minute slots across practice hours, patient initials, type, provider colour, AI-made bookings tagged, chair utilisation for the day and week, prev/next arrows. Double-booking a chair or provider is blocked in Python and again by SQLite triggers.
5. **Calls and analytics** (`/calls`, `/messages`): conversation list with transcript and tool-call drawer, 30-day counters, and a staff inbox of messages taken with a done checkbox.

### What it skips

Auth, billing, multi-location, real telephony (Twilio/LiveKit), real PMS integrations, real payer clearinghouses, HIPAA controls, real SMS sending, treatment-plan follow-ups.

Small additions beyond the spec: `POST /api/conversations/{id}/end` ("Hang up", marks `abandoned`), `GET /api/recall/outreach`, an `insurance_checks` log table (so staff-form verifications are counted), a `state_json` column on `conversations` (mock state machine), and `declined` / `snoozed` as recall conversation outcomes. The seed has 30 named demo patients plus 100 "background" patients so the schedule looks busy (about 60% of chair time on the next 10 business days).

## Architecture

```
app/
  main.py        FastAPI app: pages (Jinja2) + JSON API, lifespan creates/seeds the DB
  config.py      env vars (read on each call), mock/live switch
  db.py          sqlite3 helpers, reset (drop + recreate + seed)
  schema.sql     tables + BEFORE INSERT/UPDATE triggers that block chair/provider overlap
  seed.py        fictional practice, providers, chairs, patients, history, future schedule, insurance
  scheduling.py  hours, open slots, create/reschedule/cancel with conflict checks, grid, utilisation
  insurance.py   mock payer directory lookup, flags, stores result on insurance_plans
  tools.py       Anthropic tool definitions (strict) + SQLite-backed executors
  llm.py         live path: Anthropic SDK manual tool-use loop (max 8 iterations)
  agent.py       conversation persistence, system prompt, picks mock vs live, outreach text
  mock_agent.py  deterministic scripted receptionist driving the SAME tools
  recall.py      overdue detection, run recall, simulated replies, counters
  stats.py       30-day analytics
templates/  base, index, schedule, recall, insurance, calls, messages (Jinja2)
static/     style.css, app.js (vanilla, no build step)
tests/      pytest + FastAPI TestClient
```

**Request flow (inbound message):** browser `POST /api/conversations/{id}/messages` -> `agent.run_turn` loads the conversation row (messages, tool log, state) -> if the conversation mode is `mock`, `mock_agent.respond` advances its state machine and calls tools; if `live`, `llm.run_tool_loop` calls `client.messages.create(...)` repeatedly, executing every `tool_use` block through `tools.execute_tool` and returning all results of one assistant turn in one user message, until `end_turn` or 8 iterations -> tools read/write SQLite (`scheduling.py`, `insurance.py`) -> the full message list (including tool blocks), the tool log and the outcome are saved -> response `{reply, tool_calls, outcome}`.

**Recall flow:** `POST /api/recall/run` -> `recall.overdue_patients` -> per patient, find 2 open hygiene slots, write the text (template in mock mode, one Claude call in live mode with a template fallback), create a `recall` conversation + `recall_outreach` row (`sent`) -> `POST /api/recall/{id}/reply` runs a turn on that conversation; the outreach status becomes `booked`, `declined`, `snoozed` or `replied`.

## Open-source tools used

| Tool | Link | Role |
|------|------|------|
| FastAPI | https://fastapi.tiangolo.com | web framework, JSON API, request validation |
| Uvicorn | https://www.uvicorn.org | ASGI server |
| Pydantic v2 | https://docs.pydantic.dev | request models |
| Jinja2 | https://jinja.palletsprojects.com | server-rendered pages |
| python-multipart | https://github.com/Kludex/python-multipart | form parsing dependency for FastAPI |
| python-dotenv | https://github.com/theskumar/python-dotenv | loads `.env` |
| Anthropic Python SDK | https://github.com/anthropics/anthropic-sdk-python | live LLM calls and tool use |
| SQLite (stdlib `sqlite3`) | https://www.sqlite.org | the "practice management system" and all state |
| pytest + httpx | https://docs.pytest.org / https://www.python-httpx.org | tests (FastAPI `TestClient`) |
| Web Speech API | https://developer.mozilla.org/docs/Web/API/Web_Speech_API | optional browser-only voice |

## Setup and run

Requires Python 3.11+.

```bash
cd 2026-11-15-kairos-health
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env            # optional; works with no key (mock mode)
.venv/bin/pytest                # run the tests
.venv/bin/uvicorn app.main:app --port 8000
```

Open http://localhost:8000. On first start the database (`./chairfill.db`) is created and seeded. "Reset demo data" in the header (or `POST /api/demo/reset`) drops and re-seeds it; dates are generated relative to today.

Demo script: on `/`, say "I need a cleaning", then "Maria Gonzalez, 1984-03-12", "the first one", "yes please"; check `/schedule` for the AI-tagged booking. On `/recall` click "Run recall" and reply "yes, the first one works" to one outreach. Other demo patients: Tom Becker 1968-01-30 (inactive insurance), Oscar Fernandes 1994-05-17 (out of network), Priyanka Shah 1982-12-01 (low remaining maximum), Grace Okonkwo 1997-08-14 (waiting period), Sofia Marino 1988-06-06 (has a future appointment to reschedule/cancel).

## Environment variables

| Variable | Default | Meaning |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | empty | enables live mode when set (and `MOCK_LLM` is not truthy) |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | model for live mode |
| `MOCK_LLM` | empty | `1` forces mock mode even if a key is set |
| `DATABASE_PATH` | `./chairfill.db` | SQLite file |
| `RECALL_MONTHS` | `6` | overdue threshold in months |
| `PORT` | `8000` | documentation only; pass `--port` to uvicorn |

## Mock mode vs live mode

- **Mock** (`MOCK_LLM=1` or no `ANTHROPIC_API_KEY`): `app/mock_agent.py` is a keyword/regex state machine (`greet -> identity -> register -> reason -> offer slots -> confirm -> booked`, plus reschedule, cancel, insurance, FAQ, take-message). It calls the same tools and really updates SQLite. Recall outreach text is templated. The UI shows a "MOCK MODE" badge, and each conversation stores `mode`.
- **Live** (key set): `app/llm.py` runs a manual tool-use loop with the Anthropic SDK: `client.messages.create(model, max_tokens=2048, system, tools, messages)`, default `tool_choice`, `strict: true` tools with `additionalProperties: false`, all tool results of a turn in one user message, up to 8 iterations. The system prompt carries the practice profile, current date/time, the channel and the hard rules (identify before changes, at most 3 slots, confirm before booking, no clinical advice, no cost promises, take a message when stuck, short spoken replies). The whole message list including tool blocks is stored so multi-turn works across HTTP requests. A conversation keeps the mode it was created in. Because there was no API key in the build environment, the live path is covered only by a unit test with a fake client, and has not been run against the real API.

## Known limitations

- The mock receptionist is regex-based: it handles the scripted flows well but not free-form phrasing. Name extraction is heuristic.
- No concurrency control beyond SQLite triggers; no auth; one practice; times are naive local time.
- Rescheduling keeps the original provider/chair when free, otherwise picks the first free combination, which can differ from the one offered.
- Recall proposes slots at send time; they may be taken later (the agent then offers alternatives).
- No seeded call history, so `/calls` starts empty until you use the app.
- Voice depends on browser support (Chromium-style `webkitSpeechRecognition`) and was not tested in a browser here.
- Outcomes can be overwritten by later turns of the same conversation (the latest `end_call` wins).

## Next 3 things to build

1. A real PMS adapter interface (read patients/appointments from Open Dental's API) with the SQLite store as a fake implementation.
2. Real telephony: Twilio or LiveKit media streams with streaming speech-to-text/text-to-speech instead of the browser Web Speech API, plus actual SMS sending and opt-out handling for recall.
3. Evaluation harness: scripted caller personas replayed against the live agent, scoring booking correctness, slot-offer limits and refusal of clinical advice; plus treatment-plan follow-ups as a second outbound campaign.
