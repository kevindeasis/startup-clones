You are building a working end-to-end clone of Poth Labs (https://pothlabs.com, YC S26) inside the folder /home/user/startup-clones/2026-11-09-poth-labs/ . Follow the SPEC below exactly.

Instructions:
- Build the working end-to-end clone inside that folder exactly per the spec. Aim for a real, runnable app, not a stub. Use the specified open-source libraries (ai, @ai-sdk/anthropic, zod, better-sqlite3, papaparse, vitest, next) instead of reinventing them. Pin to currently published versions (npm latest: ai 7.0.x, @ai-sdk/anthropic 4.0.x, next 16.4.x, better-sqlite3 13.x, zod 4.x, papaparse 5.7, vitest 5.1); if an API differs from what you remember, read the installed package's types/docs.
- Read all API keys from environment variables and ship a .env.example. Never commit real secrets.
- Add a .gitignore appropriate for the stack (node_modules, .env, .next, build output, local databases, data/).
- Verify it: install dependencies, run the build, run tests, and start the app locally to confirm it boots and the main flow works (no API key is present, so mock mode must work end-to-end; exercise the API with curl through all 5 acceptance checks). Fix errors before finishing. Do not claim it works unless you actually ran it. Stop any background server when done.
- Write a thorough README.md in the folder: what the original company does (with link), what this clone does and what it skips, architecture summary, the GitHub tools used, exact setup and run steps, environment variables, known limitations, and the next 3 things to build. State that it is an independent learning clone not affiliated with the company.
- Do not modify anything outside that folder (SPEC.md, BUILD_PROMPT.md, BUILD_LOG.md already exist; leave them). Do not commit or push.
- Report back: what was built, exactly which verification commands were run and their results, anything that does not work, and your total input/output token usage.

===== SPEC.md =====
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


===== NOTE =====
The prompt actually sent to the Sonnet subagent was: "Read the file .../2026-11-09-poth-labs/BUILD_PROMPT.md in full. It is your complete task brief (instructions plus the SPEC). Carry it out exactly, building the app in .../2026-11-09-poth-labs/. Do not modify BUILD_PROMPT.md, SPEC.md. Do not commit or push. Report back per the brief's final bullet." The brief above is the file it read. No fix rounds were needed.
