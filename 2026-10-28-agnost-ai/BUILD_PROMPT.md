# Build prompts — 2026-10-28 Agnost AI clone

## Round 1 — initial build prompt (sent to a Sonnet subagent, verbatim)

```markdown
You are building a working clone of the YC startup Agnost AI (conversation analytics for AI agents) as a one-day build-in-public project. Work ONLY inside the folder `/home/claude/startup-clone/2026-10-28-agnost-ai/` (it already contains SPEC.md, BUILD_LOG.md and an empty data/ dir — do not modify SPEC.md or BUILD_LOG.md). The full build spec is reproduced below; follow it exactly.

Instructions:
- Build the working end-to-end clone inside that folder exactly per the spec. Aim for a real, runnable app, not a stub. Use the specified open-source libraries instead of reinventing them.
- Read all API keys from environment variables and ship a `.env.example`. Never commit real secrets. There is NO Anthropic API key in this environment, so the app must run fully in mock mode; the Anthropic code path must still be complete and covered by a monkeypatched unit test.
- Add a `.gitignore` appropriate for the stack (.venv, __pycache__, .env, data/*.db, .pytest_cache, build output).
- Verify it: create a venv in the folder (`python3 -m venv .venv`), install dependencies, run the seed script, run pytest, and start the app locally with uvicorn to confirm it boots and the main flows work (curl the pages and API endpoints listed in the acceptance checks). Fix errors before finishing. Do not claim it works unless you actually ran it. Kill any server you started before you finish.
- Pin dependency versions in requirements.txt to versions you actually installed (`pip freeze` of the direct deps is fine).
- Write a thorough `README.md` in the folder: what the original company does (with link to https://agnost.ai and the Launch HN https://news.ycombinator.com/item?id=48908950), what this clone does and what it skips, architecture summary (a short text diagram of ingest → analyze → cluster → dashboard), the GitHub tools used (table with repo links), exact setup and run steps, environment variables, mock vs real LLM mode, known limitations, and the next 3 things to build. Note clearly that it is an unofficial educational clone, not affiliated with Agnost AI.
- Do not modify anything outside that folder. Do not commit or push. Do not run `git` commands at all.
- Report back in your final message: what was built (file list), exactly which verification commands you ran and their results (copy the key output lines), anything that does not work or deviates from the spec, and your total input/output token usage for this task.

=== SPEC.md (verbatim) ===
# Build spec — Agnost AI clone ("conversation analytics for AI agents")

Date: 2026-10-28
Original company: **Agnost AI (YC S26)** — https://agnost.ai — Launch HN: https://news.ycombinator.com/item?id=48908950 — YC page: https://www.ycombinator.com/companies/agnost-ai

## 1. What the product does

Agnost is "product analytics for chat and voice agents" — a PostHog-for-conversations. Teams send the messages their AI agent exchanges with users (via SDK / REST / OpenTelemetry). Agnost analyzes the transcripts to find signals that logs and evals miss: silent failures (the agent answered "successfully" but the user did not get what they wanted), rage-prompting and repeated rephrasing, corrections, feature requests hidden in chat phrasing, bug reports, suspected hallucinations and churn signals. It clusters conversations into product-specific intents/patterns ("feature requests" and "bugs" are default categories; other clusters are discovered from the data), lets users define their own patterns in plain English, and shows the specific users and conversations behind each pattern. Who pays: teams running chat/voice agents in production (free → $49 → $499/mo tiers on their site).

The clone implements that core loop locally: **ingest → per-conversation LLM analysis → clustering into patterns → dashboard with drill-down → custom patterns in plain English.** It skips voice ingestion, OpenTelemetry, auth/billing, multi-tenant orgs, the "generate a PR to fix it" step, and model fine-tuning.

## 2. Core user flows to implement (all five are required)

1. **Ingest conversations** — `POST /api/v1/conversations` accepts a batch of messages (`conversation_id`, `user_id`, `role` ∈ {user, assistant, tool, system}, `content`, `timestamp` (ISO, optional), `metadata` (dict, optional: plan, org, account, etc.)). Messages are appended to conversations (upsert by `conversation_id`). A tiny Python SDK at `sdk/agnost_clone_sdk.py` wraps this: `client = AgnostClone(base_url); client.track(conversation_id, role, content, user_id=None, metadata=None); client.flush()` (buffers, posts in batches of 50). A seed script `scripts/seed.py` generates ~80 deterministic synthetic conversations for a fictional AI video-editor assistant ("ClipPilot") — including hidden feature requests (e.g. ~15 users asking for auto-subtitles in different phrasings), bugs, rage-prompting, repeated rephrasing, corrections, suspected hallucinated links, churn signals, and plain successful chats — ingests them through the SDK, then runs analysis and clustering.
2. **Analyze conversations** — `POST /api/v1/analyze` (also triggered by the dashboard "Analyze now" button) processes every conversation with ≥1 user message that has no analysis yet (or `?force=true` to redo all). For each conversation the pipeline (a) computes cheap deterministic hints in code — `rephrase_count` (consecutive user messages with Jaccard token similarity ≥ 0.5), `caps_ratio`, `exclamation_count`, `profanity_hit`, `user_message_count`, `ended_on_user_turn` — then (b) asks the LLM for a strict JSON object (schema in §6) with summary, intent phrase, outcome, signals, sentiment and frustration score. (c) Stores it in `conversation_analyses`. Runs conversations concurrently with a small worker pool (asyncio semaphore of 4) so 80 conversations finish in reasonable time with the real API.
3. **Cluster into patterns** — `POST /api/v1/cluster` (also the "Recluster" button) builds patterns from the analyses: text = `intent + ". " + summary`, vectorize with scikit-learn `TfidfVectorizer(ngram_range=(1,2), min_df=1, stop_words="english")`, L2-normalize, cluster with `sklearn.cluster.HDBSCAN(min_cluster_size=3, metric="euclidean")`; if HDBSCAN yields < 2 clusters (small data) fall back to `AgglomerativeClustering(n_clusters=min(8, max(2, n//8)), metric="cosine", linkage="average")`. Noise points (label −1) go to an "Other / long tail" bucket. Then the LLM names each cluster (short name + one-sentence description) given its top TF-IDF terms and 6 sample intents (mock mode: name = top 3 terms). Two **default categories** are computed from signals, not from clustering: `Feature requests` (all `feature_requests[]` items across conversations, deduplicated by normalizing text and grouping near-duplicates via TF-IDF cosine ≥ 0.6) and `Bugs` (same for `bug_reports[]`). Each cluster/category stores member conversation ids and distinct `user_id` count.
4. **Dashboard & drill-down** — server-rendered pages (Jinja2 + Pico.css + Chart.js):
   - `/` Overview: totals (conversations, users, analyzed), signal rates (% with frustration, rephrasing, correction, unresolved outcome, feature request, bug, hallucination, churn), a Chart.js bar chart of conversations per day stacked by outcome, "Analyze now" and "Recluster" buttons, and the top 5 patterns by volume.
   - `/patterns` Patterns: table of discovered clusters + default categories + custom patterns with volume, distinct users, % frustrated, example intents; `/patterns/{id}` shows the member conversations.
   - `/feature-requests` and `/bugs`: grouped lists (canonical text, count, distinct users, sample conversation links).
   - `/conversations` list with filters (`signal=`, `outcome=`, `q=` substring) and `/conversations/{id}` detail: full transcript, highlighted turns that triggered signals (rephrase pairs marked), the extracted analysis JSON, and the patterns it belongs to.
5. **Custom patterns in plain English** — `/patterns/custom` form (`POST`) with `name` + `description` (e.g. "User asks for an integration we do not have"). The LLM classifies each analyzed conversation as match / no-match given its summary + intent + last 6 turns (mock mode: keyword overlap between description and summary/intent ≥ 2 content words). Matches are stored as a pattern of kind `custom`; results show immediately on `/patterns/{id}` and the pattern is re-applied to new conversations on each `/api/v1/analyze` run.

## 3. Stack

Python 3.11+ (3.13 available here).

| Need | Library (verified on PyPI/npm 2026-10-28) | Used for |
|---|---|---|
| Web/API | `fastapi` 0.162 + `uvicorn` | REST API + server-rendered pages |
| Validation | `pydantic` v2 | request/response schemas, LLM JSON schema validation |
| DB | `sqlalchemy` 2.x + SQLite file `data/agnost_clone.db` | all persistence (no migrations tool; `create_all` on startup) |
| Templates | `jinja2` | dashboard pages |
| CSS / charts | `@picocss/pico` 2 + `chart.js` 4 via cdnjs/jsdelivr `<script>`/`<link>` | styling and the overview chart (no build step) |
| LLM | `anthropic` 2.x Python SDK | analysis, cluster naming, custom-pattern classification |
| Clustering | `scikit-learn` 1.9 (TfidfVectorizer, HDBSCAN, AgglomerativeClustering, cosine_similarity) | pattern discovery and near-duplicate grouping |
| HTTP (SDK) | `httpx` | the Python SDK's client |
| Tests | `pytest` + FastAPI `TestClient` | acceptance tests |

No React/Node build. No external services besides the Anthropic API.

## 4. Data model (SQLAlchemy, SQLite)

- `conversations`: `id` (text PK = client conversation_id), `user_id` (text, nullable), `metadata_json` (text), `first_message_at`, `last_message_at`, `message_count` (int), `created_at`.
- `messages`: `id` (int PK), `conversation_id` (FK), `idx` (int order), `role`, `content` (text), `timestamp`, `created_at`.
- `conversation_analyses`: `conversation_id` (PK/FK), `summary`, `intent`, `outcome` (resolved | partial | unresolved | abandoned), `sentiment` (positive | neutral | negative), `frustration_score` (float 0–1), `signals_json` (the full JSON from §6 incl. hints), `feature_requests_json` (list[str]), `bug_reports_json` (list[str]), `model` (text: model id or "mock"), `analyzed_at`. Boolean convenience columns for fast filtering: `has_frustration`, `has_rephrasing`, `has_correction`, `has_feature_request`, `has_bug_report`, `has_hallucination`, `has_churn_signal`, `silent_failure` (outcome ≠ resolved while the assistant's last message looks like a success/completion).
- `patterns`: `id` (int PK), `kind` (cluster | feature_requests | bugs | custom), `name`, `description`, `query_text` (for custom), `top_terms_json`, `conversation_count`, `user_count`, `frustrated_pct`, `created_at`, `updated_at`.
- `pattern_members`: `pattern_id` (FK), `conversation_id` (FK), `score` (float), `group_text` (canonical text for feature/bug groups, nullable). Unique on (pattern_id, conversation_id, group_text).

## 5. Screens and endpoints

API (JSON):
- `POST /api/v1/conversations` body `{ "messages": [ {conversation_id, user_id?, role, content, timestamp?, metadata?} ] }` → `{ingested: n, conversations: m}`
- `POST /api/v1/analyze?force=false` → `{analyzed: n, skipped: k, model: "..."}`
- `POST /api/v1/cluster` → `{patterns: n, clusters: c, feature_groups: f, bug_groups: b}`
- `GET /api/v1/stats` → the overview numbers as JSON
- `GET /api/v1/patterns` and `GET /api/v1/patterns/{id}`
- `GET /api/v1/conversations?signal=&outcome=&q=&limit=&offset=` and `GET /api/v1/conversations/{id}` (with messages and analysis)
- `POST /api/v1/patterns/custom` `{name, description}` → the created pattern with matches
- `GET /api/v1/export/feature-requests.csv`
- `GET /healthz` → `{ok: true, llm: "anthropic"|"mock"}`

Pages (HTML): `/`, `/patterns`, `/patterns/{id}`, `/patterns/custom` (GET form, POST create), `/feature-requests`, `/bugs`, `/conversations`, `/conversations/{id}`. Buttons on `/` call the analyze/cluster endpoints via a few lines of fetch() and reload.

## 6. LLM pipeline design

Provider abstraction `app/llm.py` with `class LLM: async def analyze_conversation(...)`, `async def name_cluster(...)`, `async def classify_custom(...)`. Two implementations selected at startup: `AnthropicLLM` when `ANTHROPIC_API_KEY` is set (and `LLM_PROVIDER` ≠ `mock`), else `MockLLM`. Log one line at startup saying which is active.

**Per-conversation analysis prompt** (system): "You are a product analyst reading a transcript between a user and an AI product's assistant. Extract signals a product team cares about. Be conservative: only flag a signal when the transcript shows it. Return ONLY a JSON object matching the schema." User message contains: the product name (from `PRODUCT_NAME` env, default "the product"), the deterministic hints (rephrase_count, caps_ratio, exclamation_count, profanity_hit, ended_on_user_turn), and the transcript truncated to the last 40 turns / 12k chars. Required JSON schema:

`` `json
{
  "summary": "one or two sentences",
  "intent": "3-8 word noun phrase of what the user wanted, e.g. 'add subtitles to a clip'",
  "outcome": "resolved | partial | unresolved | abandoned",
  "sentiment": "positive | neutral | negative",
  "frustration_score": 0.0,
  "signals": {
    "frustration": false,
    "repeated_rephrasing": false,
    "correction": false,
    "hallucination_suspected": false,
    "churn_signal": false,
    "silent_failure": false
  },
  "feature_requests": ["short canonical phrasing of each distinct feature the user asked for that the assistant said it cannot do"],
  "bug_reports": ["short canonical phrasing of each thing the user says is broken"],
  "evidence": ["<=3 short quotes from the transcript that justify the flags"]
}
`` `

Use `claude-sonnet-4-5` by default (`ANTHROPIC_MODEL` env overrides), `max_tokens=800`, `temperature=0`. Parse with a tolerant JSON extractor (strip code fences, find first `{`…last `}`), validate with a pydantic model, and on failure retry once with the error appended; on second failure store a minimal analysis with `outcome="unresolved"`, `intent="unparsed"` and `model="error"` rather than crashing the batch.

**Cluster naming prompt**: given top 8 TF-IDF terms and 6 sample intents, return `{"name": "<2-5 words>", "description": "<one sentence>"}`.

**Custom pattern classification prompt**: given pattern name + description and a conversation's summary, intent and last 6 turns, return `{"match": true|false, "confidence": 0-1, "reason": "..."}`. Batch 10 conversations per call to limit cost (return a JSON array in the same order).

**MockLLM** must be deterministic and good enough to make the seeded demo meaningful: rules on hints and keywords — e.g. phrases like "can you add", "wish it could", "is there a way to", "do you support" + an assistant reply containing "not able"/"don't support"/"can't" → feature_request with the user's phrase (cleaned) as canonical text; "broken", "error", "crash", "doesn't work", "stuck" → bug_report; `rephrase_count ≥ 1` → repeated_rephrasing; profanity/caps/`!!`/"useless" → frustration (score 0.8); "no, I meant", "that's wrong", "not what I asked" → correction; a URL in an assistant message followed by a user saying it is 404/doesn't exist → hallucination_suspected; "cancel", "switching to", "refund", "unsubscribe" → churn_signal; assistant's last message contains "done"/"here you go"/"completed" but user's final turn is negative or asks again → silent_failure; `intent` = first user message's first 8 words, lowercased, with filler stripped; summary = first user message + outcome.

## 7. Environment variables (`.env.example`)

`` `
ANTHROPIC_API_KEY=            # optional; when empty the app runs in deterministic mock mode
ANTHROPIC_MODEL=claude-sonnet-4-5
LLM_PROVIDER=                 # "anthropic" | "mock"; empty = auto (anthropic if key set)
DATABASE_URL=sqlite:///./data/agnost_clone.db
PRODUCT_NAME=ClipPilot        # name of the product whose agent is being analyzed (used in prompts and seed data)
PORT=8000
`` `

Load with `python-dotenv` if present, otherwise plain `os.environ`.

## 8. What to skip

Auth, billing, orgs/multi-tenancy, voice/audio ingestion, OpenTelemetry receiver, the Slack agent, MCP server, "generate PR to fix", eval generation, model fine-tuning, ClickHouse-scale storage. Keep everything single-tenant, local SQLite.

## 9. Repository layout

`` `
2026-10-28-agnost-ai/
  README.md  SPEC.md  BUILD_PROMPT.md  BUILD_LOG.md
  requirements.txt  .env.example  .gitignore
  app/ main.py  config.py  db.py  models.py  schemas.py  llm.py  heuristics.py  analysis.py  clustering.py  routes_api.py  routes_pages.py
  app/templates/ base.html  overview.html  patterns.html  pattern_detail.html  custom_pattern.html  grouped.html  conversations.html  conversation_detail.html
  sdk/ agnost_clone_sdk.py
  scripts/ seed.py
  tests/ test_pipeline.py  test_heuristics.py
  data/ .gitkeep   (the .db file is gitignored)
`` `

## 10. Acceptance checks (the build must pass all of these; the reviewer will run them)

1. `python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt` completes without errors on Python 3.11–3.13.
2. With **no** `ANTHROPIC_API_KEY` set: `python scripts/seed.py` finishes with exit code 0, prints how many conversations it ingested (≥ 60), analyzed (= ingested) and how many patterns were created (≥ 3 clusters plus the two default categories), using the mock LLM.
3. `uvicorn app.main:app --port 8000` boots; `curl -s localhost:8000/healthz` returns `{"ok": true, "llm": "mock"}`; `GET /` returns 200 and contains the string "Feature requests"; `GET /patterns` returns 200 and lists ≥ 5 patterns; `GET /feature-requests` shows the auto-subtitles group with ≥ 5 distinct users; `GET /conversations/<any id>` returns 200 with the transcript.
4. `POST /api/v1/conversations` with a brand-new 4-message conversation containing a feature request, followed by `POST /api/v1/analyze`, increments the analyzed count by exactly 1 and `GET /api/v1/conversations/<id>` shows `has_feature_request = true`.
5. `POST /api/v1/patterns/custom` with `{"name":"Subtitle asks","description":"User asks for automatic subtitles or captions"}` returns a pattern with ≥ 3 members in mock mode.
6. `pytest -q` passes (at least: heuristics unit tests for rephrase detection; an end-to-end test that ingests 6 conversations → analyze → cluster → GET pages return 200 and expected counts).
7. The Anthropic code path is complete and importable (unit test that monkeypatches the SDK client to return a canned JSON response and asserts the parsed analysis), since no real key is available in the build session.
8. No real secrets in the repo; `.env.example` present; `.gitignore` covers `.venv/`, `__pycache__/`, `.env`, `data/*.db`, `.pytest_cache/`.
```
