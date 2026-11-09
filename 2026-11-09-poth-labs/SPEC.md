# Poth Labs clone — build spec

Original: https://pothlabs.com (YC S26). AI-native customer research: uses a company's existing data to generate hypotheses about user behavior (churn, failed activation, checkout abandonment), validates them through adaptive AI interviews/surveys, and files answers back on the account. This is an independent learning clone.

## Core flows
1. **Import data**: upload CSV of accounts/usage events + paste/upload support tickets or call notes (plain text). Sample seed data button.
2. **Generate hypotheses**: for a research question ("Why are accounts churning?"), LLM reads the data summary and produces 3–5 ranked hypotheses, each with evidence (cited row/ticket ids) and a confidence score (0–1).
3. **Adaptive interview**: public link `/i/[token]` for a respondent. Chat UI; the LLM interviewer asks one question at a time, targeted at the currently most uncertain hypotheses, with follow-ups ("why?") based on previous answers. Ends after N turns (default 5) or when the interviewer decides it has enough.
4. **Update hypotheses**: after each interview completes, LLM scores each hypothesis (supports / contradicts / neutral + quote) and confidence is updated; the answer summary is stored on the account.
5. **Dashboard**: hypotheses ranked by confidence with evidence counts, quotes, per-account view showing data evidence + interview answers.

## Stack
Next.js (App Router) + TypeScript, Tailwind optional (plain CSS fine). Libraries:
- `ai` (Vercel AI SDK) + `@ai-sdk/anthropic` — `generateObject`/`generateText` for hypotheses, interviewer turns, scoring.
- `zod` — schemas for structured outputs.
- `better-sqlite3` — local SQLite file (gitignored).
- `papaparse` — CSV parsing.
- `vitest` — tests for the pure logic (confidence update, mock LLM).

## Data model (SQLite)
- `projects(id, name, question, created_at)`
- `accounts(id, project_id, external_id, name, attrs_json)`
- `evidence(id, project_id, account_id, kind['usage'|'ticket'|'call'], text)`
- `hypotheses(id, project_id, statement, confidence REAL, rationale, evidence_ids_json)`
- `interviews(id, project_id, account_id, token, status['pending'|'active'|'done'], created_at)`
- `messages(id, interview_id, role['assistant'|'user'], content, created_at)`
- `findings(id, hypothesis_id, interview_id, stance['supports'|'contradicts'|'neutral'], quote)`

## Screens / endpoints
- `/` project list + create (name, research question) + "Load sample data".
- `/p/[id]` project: tabs Data (upload CSV/tickets), Hypotheses (generate button, ranked list), Interviews (create per-account links, status), Accounts.
- `/i/[token]` respondent chat.
- API: `POST /api/projects`, `POST /api/projects/[id]/import`, `POST /api/projects/[id]/hypotheses`, `POST /api/projects/[id]/interviews`, `POST /api/interview/[token]/message`, `POST /api/interview/[token]/finish`, `GET /api/projects/[id]`.

## LLM pipeline
- Hypothesis prompt: data summary (account count, aggregate usage stats, sampled tickets with ids) + question → zod `{hypotheses:[{statement,rationale,evidenceIds,confidence}]}`.
- Interviewer prompt: system = research question + current hypotheses with confidence + conversation so far; output next question (one, open-ended, non-leading) or `DONE`.
- Scoring prompt: transcript + hypotheses → zod `{findings:[{hypothesisId,stance,quote}]}`; confidence update: supports +0.1, contradicts −0.15, clamped 0.02–0.98 (pure function, unit tested).
- Default model `claude-sonnet-5-5` via `ANTHROPIC_MODEL` env override.

## Env vars
`ANTHROPIC_API_KEY` (optional), `ANTHROPIC_MODEL` (default claude-sonnet-5-5), `DATABASE_PATH` (default ./data/poth.db), `MOCK_LLM=1` forces mock. **Mock mode is automatic when no API key**: deterministic fake hypotheses derived from data keywords, scripted interviewer questions, keyword-based scoring.

## Skip
Auth, billing, real integrations (Zendesk/Salesforce/etc.), voice interviews, email delivery of links.

## Acceptance checks
1. `npm install && npm run build` succeeds; `npm test` passes.
2. App boots with no API key; "Load sample data" creates a project with accounts/tickets.
3. Generate hypotheses returns ≥3 ranked hypotheses with evidence ids (mock mode).
4. Interview via API/UI: create link, post ≥3 respondent messages, receive adaptive questions, finish → findings stored and hypothesis confidences change.
5. Dashboard shows updated ranking and quotes.
