# BUILD_PROMPT.md — verbatim prompts sent to the Sonnet build subagent

## Round 1 — initial build prompt

You are building a working end-to-end clone of the YC F26 startup Audora inside the folder
`/home/user/startup-clones/2026-11-20-audora/` (the folder already exists and contains SPEC.md,
BUILD_LOG.md and BUILD_PROMPT.md — do not modify or delete those three files). Build exactly per the
spec below. Aim for a real, runnable app, not a stub. Use the specified open-source libraries
(Next.js 16, Vercel AI SDK `ai` + `@ai-sdk/anthropic`, zod, @mozilla/readability + jsdom, vitest)
instead of reinventing them.

Rules:
- Read all API keys from environment variables and ship a `.env.example`. Never commit real secrets.
  There is NO `ANTHROPIC_API_KEY` in this environment: everything must work in mock mode, and the live
  path must be written carefully from the installed SDK's type definitions (read
  `node_modules/ai/dist/index.d.ts` and `node_modules/@ai-sdk/anthropic/dist/index.d.ts` for the
  structured-output API — do not guess function names).
- Add a `.gitignore` appropriate for the stack: node_modules, .next, out, build, .env and .env.* (but
  not .env.example), data/, coverage, *.log, *.tsbuildinfo, next-env.d.ts.
- Scaffold with `npm init -y` + explicit `npm install` of pinned current packages (do not use
  `create-next-app` interactively). Node 22 is installed. Outbound HTTPS goes through a proxy that is
  already configured for npm.
- Verify it: install dependencies, run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`,
  then `npm run smoke` (which must start the production server itself on a free port, run the HTTP
  checks from the spec's acceptance section, print `SMOKE PASSED`, and stop the server). Also open
  `/` and a generated story page with Playwright (pre-installed globally: `require('playwright')`
  works from any directory; `chromium.launch()` needs no options) at 1280 px and 390 px width and
  confirm no console errors and no horizontal scroll. Fix errors before finishing. Do not claim
  something works unless you actually ran it. Stop any background server when done.
- Write a thorough `README.md` in the folder: what the original company does (Audora, YC F26,
  https://audora.art — turns a story link/file into an audiobook where the narrator and every character
  have distinct, consistent voices, with playback starting before generation finishes), what this clone
  does and what it skips, architecture summary, the GitHub tools used (with links), exact setup and
  run steps, environment variables, mock vs live mode, known limitations, and the next 3 things to build.
  State clearly that it is an independent learning clone not affiliated with Audora.
- Do not modify anything outside `/home/user/startup-clones/2026-11-20-audora/`. Do not commit or push.
- Report back: what was built (file list), exactly which verification commands were run and their
  results (paste the key output lines), anything that does not work or deviates from the spec, and your
  total input/output token usage.

Here is the full SPEC.md:

---
# SPEC — Audora clone ("FullCast") — 2026-11-20

Independent learning clone of **Audora** (YC F26, https://audora.art): "Audiobooks where every
character has their own voice." Not affiliated with Audora.

## What the product does
Audora turns a story (a pasted link or an uploaded file) into an audiobook in which the narrator
and every character speak with distinct, consistent voices. The system reads the text, works out
who is speaking in each line of dialogue (including lines where the speaker is only implied),
builds a cast, assigns each character a voice, and starts playback before the whole book has been
generated. First preview is free with no account; the initial audience is fanfiction readers and
indie authors whose books never get a professional narration.

The clone, **FullCast**, reproduces the product layer: import → script (who says what) → cast →
progressive playback. Neural TTS is replaced by the browser's free Web Speech API (one distinct
synthetic voice per character, varied by voice/pitch/rate), which is the honest "thin layer" version.

## Core user flows (implement all five)
1. **Import a story** — on `/`, paste raw text, upload a `.txt`/`.md` file, or paste a public URL
   (article extraction with Mozilla Readability). Title is taken from the form, the page `<title>`,
   or the first line. Two bundled public-domain samples (short excerpts, ~1,500–2,500 words each,
   e.g. from *Alice's Adventures in Wonderland* and *The Wonderful Wizard of Oz* — write the actual
   excerpt text into `src/samples/*.txt`, dialogue-heavy) can be loaded with one click.
2. **Generate the script** — the story is split into chunks (~1,200 words, paragraph boundaries).
   Each chunk is segmented into ordered `narration` / `dialogue` segments with a `speaker`, and
   newly discovered characters are added to the cast with hints (gender, age, personality, aliases).
   Results are persisted chunk by chunk so the UI shows progress (`chunksDone/chunksTotal`) and the
   script view fills in progressively. Running cast is passed to each subsequent chunk so names stay
   consistent ("the Queen" == "Queen of Hearts").
3. **Cast** — a cast panel lists every character with its voice profile (voice slot, pitch, rate,
   colour). Casting is deterministic code: distinct (voiceSlot, pitch, rate) combos are assigned
   from gender/age hints so no two characters sound the same. The user can re-assign any character's
   browser voice / pitch / rate; changes persist (PATCH) and apply immediately to playback.
4. **Listen (progressive)** — a player plays segments in order with `speechSynthesis`, switching
   voice per segment, highlighting the current segment in the script, with play / pause / skip
   back / skip forward / jump-to-segment (click a line). Playback can start as soon as the first
   chunk is done; when it reaches the end of what exists while generation is still running it
   waits and continues when more segments arrive (poll the story endpoint every ~2s while
   `status === "generating"`). If the browser exposes no voices, show a clear notice and still
   allow the script/cast to be browsed.
5. **Export** — download the script as JSON (`{title, cast, segments}`) and as a plain-text
   "screenplay" (`SPEAKER: line`).

## Stack
- **Next.js 16 (App Router) + TypeScript**, React, plain CSS modules or a single global stylesheet
  (no Tailwind needed). Node 22.
- **Vercel AI SDK** `ai` (v7.x) + `@ai-sdk/anthropic` (v4.x) for the LLM calls, with **zod** (v4)
  schemas for structured output. Check the installed version's API (`generateObject` or
  `generateText` with `Output.object`) and use whichever the installed version exports — read
  `node_modules/ai/dist/index.d.ts` if unsure; do not guess.
- **@mozilla/readability + jsdom** for URL import (fetch HTML server-side, extract article text).
- **vitest** for unit tests. **Playwright is pre-installed globally** in this environment and may
  be used for the smoke test, but a plain `node` HTTP smoke script is sufficient.
- **Storage**: JSON files under `data/stories/<id>.json` (gitignored) via a tiny repository module
  (`src/lib/store.ts`). No database.
- No auth, no billing, no accounts.

## Data model (TypeScript types in `src/lib/types.ts`)
```ts
type Story = {
  id: string; title: string; source: { kind: "paste"|"file"|"url"|"sample"; url?: string; filename?: string };
  text: string; wordCount: number;
  status: "imported"|"generating"|"ready"|"error"; error?: string;
  chunksTotal: number; chunksDone: number; mode: "mock"|"live"; model?: string;
  cast: Character[]; segments: Segment[]; createdAt: string; updatedAt: string;
};
type Character = {
  id: string; name: string; aliases: string[]; isNarrator: boolean;
  genderHint: "female"|"male"|"neutral"|"unknown"; ageHint: "child"|"young"|"adult"|"elder"|"unknown";
  personality: string; voice: VoiceProfile; color: string;
};
type VoiceProfile = { slot: number; pitch: number; rate: number; preferredVoiceName?: string };
type Segment = { index: number; chunkIndex: number; kind: "narration"|"dialogue"; characterId: string; text: string; emotion?: string };
```

## Screens
- `/` — Library: import form (text area, file input, URL field, title), "Load sample" buttons,
  list of stories with status badge, word count, cast size, link to each story.
- `/stories/[id]` — Workspace: header (title, status, progress bar, mode badge "mock"/"live",
  Generate button when `imported`, Export buttons); three regions: **Script** (segments, colour
  per character, current segment highlighted, click to jump), **Cast** (cards with hints + voice
  controls), **Player** (sticky bottom bar: play/pause, prev/next, current speaker + line,
  position `n / total`, "waiting for more…" state while generating).
- Must be usable at 390 px width (no horizontal scroll; panels stack).

## API endpoints (App Router route handlers under `src/app/api`)
- `GET /api/stories` → `{stories: StorySummary[]}` (no text/segments).
- `POST /api/stories` body `{title?, text?, url?, sampleId?}` or `multipart/form-data` with `file`
  → creates story (`status: imported`) → `{story}`. URL import uses Readability; reject non-http(s),
  cap at 2 MB / 150k words; return 400 with a message on failure.
- `GET /api/stories/[id]` → full story (segments + cast + progress).
- `POST /api/stories/[id]/generate` → starts generation; respond immediately `{status:"generating"}`
  and continue processing chunks in the background within the server process (use Next's `after()`
  from `next/server` if available, otherwise a fire-and-forget promise with error capture). Idempotent
  while generating. Also support `?sync=1` to run to completion before responding (used by tests).
- `PATCH /api/stories/[id]/cast` body `{characterId, voice: Partial<VoiceProfile>, name?}` → `{story}`.
- `GET /api/stories/[id]/export?format=json|txt` → downloadable file.
- `GET /api/samples` → bundled sample list `{id, title, words}`.
- `DELETE /api/stories/[id]`.

## LLM pipeline (`src/lib/segmenter/`)
- `chunk.ts`: split text into ~1,200-word chunks at paragraph (blank line) boundaries; never split
  inside a paragraph; return `{index, text, startParagraph}`.
- `schema.ts`: zod schema for one chunk result:
  `{ segments: [{kind, speaker, text, emotion?}], characters: [{name, aliases, genderHint, ageHint, personality}] }`.
  `speaker` is a display name; `"Narrator"` for narration. The code maps speaker names to
  `characterId` (case-insensitive match on name or aliases; create the character if new).
- `llm.ts` (live mode): one structured-output call per chunk with `@ai-sdk/anthropic`, model from
  `ANTHROPIC_MODEL` (default `claude-opus-5-5`; `claude-sonnet-5-5` is the cheaper option — mention
  both in README). System prompt: you are an audiobook script editor; split the chunk into ordered
  segments that together reproduce the text verbatim (every sentence appears exactly once, in order,
  nothing paraphrased, nothing dropped); dialogue inside quotes is a `dialogue` segment attributed to
  the speaking character — infer implied speakers from context and turn-taking; attribution tags
  like `said Alice` are narration; keep the existing cast names (passed in) for recurring characters
  and add new characters with hints. Retry once on schema failure; on second failure fall back to the
  heuristic segmenter for that chunk and record `error` text on the story but keep going.
- `heuristic.ts` (mock mode, also the fallback): deterministic, no network. Per paragraph: find
  quoted spans (straight and curly quotes); attribute each via patterns around the quote —
  `"…," said X` / `"…" X said` / `X said, "…"` / `"…," X asked|replied|cried|shouted|whispered|…`
  (verb list) / `"…" X [verb]ed` — else, in a run of consecutive dialogue paragraphs with no tag,
  alternate between the last two distinct speakers (turn-taking); else `"Unknown Speaker"`.
  Non-quoted text becomes narration (attribution tags stay narration). Characters discovered from
  attributions get hints from a tiny name/pronoun heuristic (e.g. nearby "she/he", titles like
  Mrs/Mr/Queen/King) and otherwise `unknown`.
- `cast.ts`: deterministic voice assignment. Narrator = slot 0, pitch 1.0, rate 1.0. For each new
  character pick the next unused `(slot, pitch, rate)` from a table keyed by genderHint/ageHint
  (female → slots preferring female-sounding voices, higher pitch; child → pitch 1.3+, rate 1.05;
  elder → pitch 0.85, rate 0.9; …). Also assign a distinct colour from a 12-colour palette.
  On the client, `slot` maps to the n-th available `speechSynthesis` voice for the page language,
  filtered by a gender keyword heuristic on voice names when possible; `preferredVoiceName`
  overrides the slot when set and present.
- Mode selection (`src/lib/llm-mode.ts`): `LLM_MODE=mock|live|auto` (default `auto` = live if
  `ANTHROPIC_API_KEY` is set, else mock). The story records which mode produced it.

## Environment variables (`.env.example`)
- `ANTHROPIC_API_KEY` — optional; when absent the app runs fully in mock mode.
- `ANTHROPIC_MODEL` — default `claude-opus-5-5`.
- `LLM_MODE` — `auto` (default) | `mock` | `live`.
- `DATA_DIR` — default `./data`.
- `PORT` — default 3000.

## Skip (document in README)
Accounts/auth/billing, neural TTS and audio-file export (Web Speech API only; architecture leaves a
`TtsProvider` interface stub in `src/lib/tts.ts` for a future server-side provider), EPUB/PDF/DOCX
parsing (txt/md/paste/URL only), site-specific importers (AO3/Wattpad/Reddit use generic Readability),
emotion-driven delivery (store `emotion` only), background job queue (in-process only).

## Acceptance checks (all must pass with NO API key set)
1. `npm install`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all exit 0.
2. Unit tests (vitest) cover: chunker never splits a paragraph and covers all text; heuristic
   attribution handles the four tag patterns plus turn-taking; cast assignment yields unique
   voice profiles for ≥ 8 characters and is deterministic; the live-schema → characterId mapping
   merges aliases case-insensitively.
3. `npm run smoke` starts the production server on a free port (or uses `PORT`), then via HTTP:
   `GET /api/samples` lists 2 samples; `POST /api/stories {sampleId}` creates a story;
   `POST /api/stories/:id/generate?sync=1` returns `ready` with `mode: "mock"`;
   `GET /api/stories/:id` has ≥ 40 segments, ≥ 4 distinct characters including a Narrator and at
   least 3 named speakers, segments' concatenated text contains every non-empty paragraph's first 20
   characters in order; `PATCH cast` changes pitch and persists; `GET export?format=txt` and `json`
   return 200 with correct content types; URL import rejects `ftp://x` with 400; `DELETE` works.
   Prints `SMOKE PASSED` and stops the server.
4. Manual/Playwright check: `/` and `/stories/[id]` render without console errors, and at 390 px
   width `document.documentElement.scrollWidth <= window.innerWidth`.
5. README documents setup, env vars, mock vs live, limitations, and next steps.

---
