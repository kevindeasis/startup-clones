# Agnost AI clone: conversation analytics for AI agents

> **Unofficial educational clone. Not affiliated with, endorsed by, or derived from the code of Agnost AI.**
> Built in one day as a build-in-public exercise from public descriptions of the product.

## What the original does

[Agnost AI](https://agnost.ai) (YC S26, [Launch HN](https://news.ycombinator.com/item?id=48908950)) is "product analytics for chat and voice agents", roughly PostHog for conversations. Teams send the messages their AI agent exchanges with users (SDK, REST, OpenTelemetry). Agnost analyzes the transcripts for signals that logs and evals miss: silent failures (the agent said "done" but the user did not get what they wanted), rage-prompting and rephrasing, corrections, hidden feature requests and bug reports, suspected hallucinations and churn signals. It clusters conversations into product-specific patterns, lets teams define their own patterns in plain English, and shows the users and conversations behind each pattern.

## What this clone does

The core loop, locally, single tenant, on SQLite:

**ingest -> per-conversation LLM analysis -> clustering into patterns -> dashboard with drill-down -> custom patterns in plain English**

1. **Ingest**: `POST /api/v1/conversations` (batch upsert by `conversation_id`), plus a tiny Python SDK (`sdk/agnost_clone_sdk.py`, buffers and posts batches of 50).
2. **Analyze**: deterministic hints in code (rephrase count via Jaccard >= 0.5, caps ratio, exclamations, profanity, ended-on-user-turn), then an LLM (or the offline mock) returns strict JSON: summary, intent, outcome, sentiment, frustration, six signals, feature requests, bug reports. Concurrency 4. Parse failures retry once, then store an `unparsed`/`error` record instead of crashing the batch.
3. **Cluster**: TF-IDF (1-2 grams) -> L2 normalise -> `sklearn.cluster.HDBSCAN(min_cluster_size=3)`, falling back to cosine agglomerative clustering on small data. Noise goes to "Other / long tail". The LLM names clusters. Two default categories, **Feature requests** and **Bugs**, are built from extracted signals and de-duplicated by TF-IDF cosine >= 0.6.
4. **Dashboard** (Jinja2 + Pico.css + Chart.js, no build step): overview with signal rates and a stacked outcome-per-day chart, patterns, feature requests, bugs, conversation list with filters (`signal=`, `outcome=`, `q=`) and a transcript view that highlights the turns that triggered signals (rephrase pairs marked).
5. **Custom patterns**: describe a pattern in English (`/patterns/custom`); every analyzed conversation is classified (batches of 10 per LLM call), and the pattern is re-applied to new conversations on each analyze run.

**Skipped** (per the spec): voice/audio ingestion, OpenTelemetry receiver, auth, billing, orgs/multi-tenancy, Slack agent, MCP server, "generate a PR to fix it", eval generation, fine-tuning, ClickHouse-scale storage.

## Architecture

```
 your agent / seed script
        |  SDK.track()/flush()  or  POST /api/v1/conversations
        v
 +-----------+   append messages    +-----------------------------+
 |  INGEST   | -------------------> | SQLite: conversations,      |
 | routes_api|                      | messages                    |
 +-----------+                      +--------------+--------------+
                                                   | POST /api/v1/analyze (pool of 4)
                                                   v
                          heuristics.py (rephrase/caps/!/profanity hints)
                                   + LLM (Anthropic | Mock) -> strict JSON
                                                   |
                                                   v
                              conversation_analyses (signals, flags)
                                                   | POST /api/v1/cluster
                                                   v
        TF-IDF -> HDBSCAN (fallback: agglomerative) -> LLM names clusters
        signals -> Feature requests / Bugs groups (cosine >= 0.6)
        custom patterns (plain English) -> LLM classify, re-applied on analyze
                                                   |
                                                   v
                      patterns + pattern_members -> Jinja2 dashboard
                      / /patterns /feature-requests /bugs /conversations
```

Code map: `app/main.py` (app + startup), `config.py`, `db.py`, `models.py`, `schemas.py`, `llm.py` (AnthropicLLM / MockLLM), `heuristics.py`, `analysis.py` (pipeline + stats + custom patterns), `clustering.py`, `routes_api.py`, `routes_pages.py`, `templates/`, `sdk/agnost_clone_sdk.py`, `scripts/seed.py`, `tests/`.

## Open-source tools used

| Tool | Repo | Used for |
|---|---|---|
| FastAPI | https://github.com/fastapi/fastapi | REST API and server-rendered pages |
| Uvicorn | https://github.com/encode/uvicorn | ASGI server |
| Pydantic | https://github.com/pydantic/pydantic | request schemas, LLM JSON validation |
| SQLAlchemy | https://github.com/sqlalchemy/sqlalchemy | ORM and SQLite persistence |
| Jinja2 | https://github.com/pallets/jinja | dashboard templates |
| Pico CSS | https://github.com/picocss/pico | styling (CDN) |
| Chart.js | https://github.com/chartjs/Chart.js | overview chart (CDN) |
| anthropic-sdk-python | https://github.com/anthropics/anthropic-sdk-python | Claude API client |
| scikit-learn | https://github.com/scikit-learn/scikit-learn | TF-IDF, HDBSCAN, agglomerative clustering, cosine similarity |
| HTTPX | https://github.com/encode/httpx | SDK HTTP client, FastAPI TestClient |
| python-dotenv | https://github.com/theskumar/python-dotenv | `.env` loading |
| python-multipart | https://github.com/Kludex/python-multipart | HTML form parsing |
| pytest | https://github.com/pytest-dev/pytest | tests |

## Setup and run

Python 3.11+ (developed on 3.13).

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # optional; works with no key (mock mode)

python scripts/seed.py        # resets the local DB, ingests ~82 ClipPilot conversations, analyzes, clusters
uvicorn app.main:app --port 8000
# open http://localhost:8000
pytest -q
```

Seed against an already-running server instead (does not reset anything): `python scripts/seed.py --url http://localhost:8000`.

Try the API:

```bash
curl -s localhost:8000/healthz
curl -s -X POST localhost:8000/api/v1/analyze
curl -s -X POST localhost:8000/api/v1/patterns/custom -H 'content-type: application/json' \
  -d '{"name":"Subtitle asks","description":"User asks for automatic subtitles or captions"}'
curl -s localhost:8000/api/v1/export/feature-requests.csv
```

Using the SDK from your own code:

```python
from sdk.agnost_clone_sdk import AgnostClone
c = AgnostClone("http://localhost:8000")
c.track("conv-1", "user", "Can you add subtitles?", user_id="u1", metadata={"plan": "pro"})
c.track("conv-1", "assistant", "Sorry, I can't do that yet.")
c.flush()
```

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | empty | When set, the real Claude pipeline is used. Empty = mock mode. Never commit it. |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Model id for analysis, naming, classification |
| `LLM_PROVIDER` | empty | `anthropic` or `mock`; empty = auto (anthropic if a key is set). `mock` forces mock even with a key. |
| `DATABASE_URL` | `sqlite:///./data/agnost_clone.db` | SQLAlchemy URL (tables are created on startup) |
| `PRODUCT_NAME` | `ClipPilot` (example file) / "the product" (code default) | Product name used in prompts and seed data |
| `PORT` | `8000` | Documented for convenience; pass `--port` to uvicorn |

## Mock vs real LLM mode

A startup line says which is active, and `GET /healthz` returns `{"ok": true, "llm": "mock"|"anthropic"}`.

- **Mock** (default without a key): deterministic keyword rules over the transcript and the hints (feature-request phrases followed by an assistant refusal, bug words, corrections, churn words, URL + "404" for suspected hallucination, "done" followed by a negative user turn for silent failure). Cluster names are the top TF-IDF terms; custom patterns match on content-word overlap (>= 2 words, with a small synonym table such as captions = subtitles). Good enough to make the seeded demo meaningful; it is not a language model.
- **Anthropic**: `temperature=0`, `max_tokens=800`, tolerant JSON extraction (strips code fences, takes first `{` to last `}`), pydantic validation, one retry with the error appended, then a minimal `unparsed` / model `error` record. Custom pattern classification is batched 10 conversations per call.

Important: **this build session had no Anthropic key**, so the real API path has only been exercised against a monkeypatched SDK client in `tests/test_pipeline.py` (canned fenced JSON, retry, error fallback, cluster naming, batched classification). It has not been run against the live API. Expect to tweak prompts on real data.

## Known limitations

- Real-LLM path untested against the live API (see above). Some newer models reject a `temperature` parameter; remove it in `AnthropicLLM._complete` if you hit that.
- Mock rules are English-only and tuned to the seed data; the mock's canonical feature/bug text uses a small ClipPilot concept table (subtitles, 4K, TikTok, dark mode, green screen, export/preview/upload bugs).
- Seed script resets the local database (in-process mode).
- Re-ingesting messages into an already analyzed conversation deletes its analysis (it will be re-analyzed on the next run) but does not remove stale pattern memberships until the next recluster.
- Reclustering rebuilds discovered clusters and default categories; custom patterns are kept. Pattern ids change on recluster.
- No auth, no pagination UI beyond `limit`/`offset`, SQLite only, sync DB calls inside async handlers (fine for one user).
- Rephrase detection is token-overlap only (Jaccard >= 0.5), so loose paraphrases are missed by the hint; the LLM may still catch them.
- Charts/CSS load from jsDelivr, so the dashboard styling needs internet access.

## Next 3 things to build

1. Embedding-based clustering and near-duplicate grouping (sentence embeddings instead of TF-IDF) so paraphrases such as "captions" and "subtitles" group without a synonym table.
2. Time-series trends per pattern with alerts (for example "bug X doubled this week") and per-pattern drill-down to users and accounts using the ingest metadata (plan, org).
3. An OpenTelemetry / OpenInference span receiver and voice transcript ingestion, so existing agent traces flow in without the SDK.
