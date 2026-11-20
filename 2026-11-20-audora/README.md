# FullCast - an Audora clone (2026-11-20)

> **Independent learning clone. Not affiliated with, endorsed by, or derived from the code of Audora.**
> It re-implements the public idea of the product for educational purposes only.

## What the original does

**Audora** ([audora.art](https://audora.art), Y Combinator F26) turns a story - a pasted link or an uploaded file - into an
audiobook in which the narrator and every character have **distinct, consistent voices**. It works out who is speaking in
each line (including lines where the speaker is only implied), builds a cast, assigns each character a voice, and
**starts playback before the whole book has been generated**. The first preview is free and needs no account; the initial
audience is fanfiction readers and indie authors whose books never get a professional narration.

## What this clone does (FullCast)

It reproduces the product layer: **import -> script (who says what) -> cast -> progressive playback**.
Neural TTS is replaced by the browser's free Web Speech API (one synthetic voice per character, varied by voice slot, pitch
and rate).

1. **Import**: paste text, upload `.txt`/`.md`, or paste a public URL (article extraction with Mozilla Readability).
   Two bundled public-domain, dialogue-heavy samples (Alice's *A Mad Tea-Party*, Oz's *Scarecrow and Tin Woodman*) load with one click.
2. **Generate the script**: text is chunked (~1,200 words, paragraph boundaries); each chunk becomes ordered `narration` /
   `dialogue` segments with a speaker; new characters join the cast with gender/age/personality hints. Results are saved chunk by chunk
   (`chunksDone/chunksTotal`) and the script fills in live. The running cast is passed to each next chunk so names stay consistent.
3. **Cast**: deterministic voice assignment gives every character a distinct `(slot, pitch, rate)` and colour. You can change a
   character's browser voice, slot, pitch, rate and name; changes persist (`PATCH`) and apply to the next line played.
4. **Listen**: sticky player with play/pause, previous/next, click-a-line to jump, current-line highlight, `n / total`.
   Playback may start after the first chunk; at the end of what exists while generation is running it shows "waiting for more..."
   and continues when new segments arrive (the page polls every 2 s while generating).
   If the browser has no voices, a notice is shown and the script/cast stay browsable.
5. **Export**: script as JSON (`{title, cast, segments}`) or a plain-text screenplay (`SPEAKER: line`).

### What it skips

Accounts/auth/billing; neural TTS and audio-file export (Web Speech only; `src/lib/tts.ts` holds a `TtsProvider` interface stub for a
future server-side provider); EPUB/PDF/DOCX parsing (txt/md/paste/URL only); site-specific importers (AO3, Wattpad, Reddit use generic
Readability); emotion-driven delivery (`emotion` is stored, never used); a real background job queue (in-process only).

## Architecture

```
Browser (Next.js client components)                 Server (Next.js 16 route handlers, Node 22)
  ImportForm / StoryList  --POST /api/stories-->     importer.ts  (Readability + jsdom, size/word caps, SSRF guard)
  Workspace (script, cast, player)                   store.ts     (data/stories/<id>.json, atomic writes)
    speechSynthesis + voices.ts (slot -> voice)      generate.ts  (chunk loop, persists per chunk, after() background)
    polls GET /api/stories/:id every 2 s             segmenter/
                                                       chunk.ts      ~1,200-word paragraph-aligned chunks
                                                       schema.ts     zod schema for one chunk result
                                                       llm.ts        live: generateText + Output.object (AI SDK)
                                                       heuristic.ts  mock mode + fallback (quotes, tags, turn-taking)
                                                       merge.ts      speaker name -> characterId (aliases, case-insensitive)
                                                       cast.ts       deterministic voice slots / pitch / rate / colours
```

* **Route handlers** (`src/app/api`): `GET/POST /api/stories`, `GET/DELETE /api/stories/[id]`,
  `POST /api/stories/[id]/generate` (`?sync=1` runs to completion first), `PATCH /api/stories/[id]/cast`,
  `GET /api/stories/[id]/export?format=json|txt`, `GET /api/samples`.
* **Generation** returns `{status:"generating"}` immediately and continues with `after()` from `next/server`. It is idempotent while running,
  resumes a story left half-done by a restart, and re-reads the story from disk before each chunk so concurrent cast edits are not lost.
* **Live mode** makes one structured-output call per chunk (retry once; on a second failure that chunk falls back to the heuristic and
  the story records a warning in `error` while generation continues). The output is also checked for text fidelity (word count of the
  segments must match the chunk within ~10%).
* **Voice slots** (see `cast.ts`/`voices.ts`): slot 0 = default/narrator voice, odd slots index the female-sounding pool, even slots the
  male-sounding pool (names matched against a keyword list; falls back to all voices of the page language). `preferredVoiceName` overrides the slot.

## GitHub tools used

| Tool | Used for |
| --- | --- |
| [vercel/next.js](https://github.com/vercel/next.js) (16.4) | App Router, route handlers, `after()` background work |
| [facebook/react](https://github.com/facebook/react) (19) | UI |
| [vercel/ai](https://github.com/vercel/ai) (`ai` 7.0) | `generateText` + `Output.object` structured output; `ai/test` mock model in tests |
| [`@ai-sdk/anthropic`](https://github.com/vercel/ai/tree/main/packages/anthropic) (4.0) | Claude provider (`createAnthropic`) |
| [colinhacks/zod](https://github.com/colinhacks/zod) (4) | Chunk-result schema and request validation |
| [mozilla/readability](https://github.com/mozilla/readability) | Article extraction for URL import |
| [jsdom/jsdom](https://github.com/jsdom/jsdom) | DOM for Readability (kept out of the bundle via `serverExternalPackages`) |
| [vitest-dev/vitest](https://github.com/vitest-dev/vitest) | Unit tests |
| [microsoft/playwright](https://github.com/microsoft/playwright) | Manual browser verification (not a dependency) |
| [eslint/eslint](https://github.com/eslint/eslint) + [eslint-config-next](https://github.com/vercel/next.js/tree/canary/packages/eslint-config-next) | Linting |
| [microsoft/TypeScript](https://github.com/microsoft/TypeScript) (6.0) | Types. TypeScript 7 is not yet supported by typescript-eslint, hence 6.0.3 |

## Setup and run

Requirements: Node 22+, npm.

```bash
cd 2026-11-20-audora
npm install
cp .env.example .env.local     # optional; the app works with no key (mock mode)
npm run dev                    # http://localhost:3000   (or: npm run build && npm start)
```

Other scripts:

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # vitest (unit tests)
npm run build        # production build
npm run smoke        # needs a prior build; starts `next start` on a free port, runs the HTTP acceptance checks, prints SMOKE PASSED
```

Open `/`, click a **Load sample** button, press **Generate script**, then **Play** (use Chrome, Edge or Safari for the best voice selection).

## Environment variables (`.env.example`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | unset | Optional. When unset (and `LLM_MODE=auto`) the app runs fully in mock mode |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Model for live mode. `claude-sonnet-5-5` is the cheaper option |
| `LLM_MODE` | `auto` | `auto` = live iff key is set, `mock`, or `live` (live without a key makes generation fail with a clear error) |
| `DATA_DIR` | `./data` | Where `stories/<id>.json` lives (gitignored) |
| `PORT` | `3000` | Port for `next start` / `next dev` (smoke test picks a free one unless `PORT` is set) |
| `MOCK_CHUNK_DELAY_MS` | `600` | Optional: delay between chunks in mock mode on the async path, so progress is visible |
| `ALLOW_PRIVATE_URLS` | unset | Optional: set to `1` to allow URL import from localhost/private IPs (the smoke test uses it; keep off in production) |

## Mock vs live mode

* **Mock** (no key): `heuristic.ts` is deterministic and offline. Per paragraph it finds quoted spans (straight and curly quotes) and
  attributes them via tag patterns (`"...," said X`, `"..." X said`, `X said, "..."`, `"...," X asked|replied|cried|...`), otherwise
  by turn-taking between the last two distinct speakers inside a run of dialogue paragraphs, otherwise `Unknown Speaker`.
  Attribution tags stay narration. Gender/age hints come from titles, a tiny first-name list and nearby pronouns.
* **Live** (`ANTHROPIC_API_KEY` set): the model sees the chunk plus the existing cast and returns `{segments, characters}`
  validated by zod. Each story records the mode that produced it (badge "mock"/"live" in the UI).
  **The live path has been exercised only against a mocked language model in the unit tests (no API key was available when this was built);
  it has not been run against the real Anthropic API.**

## Known limitations

* Voices are the browser's built-in synthetic voices; quality and the number of distinct voices vary by OS/browser. With few voices,
  characters are differentiated mostly by pitch/rate. Headless/Linux browsers often expose none (the UI says so).
* The heuristic cannot resolve implied speakers beyond simple turn-taking, mislabels some multi-party scenes, and uses `Unknown Speaker`
  when nothing matches. Gender/age hints are weak guesses. Live mode is much better but is untested against the real API.
* Chrome's Web Speech quirks: long text is split into sentence-sized utterances; changing a voice applies from the next line, not mid-line.
* Generation runs in the server process: a restart mid-way leaves the story `generating` until you press Generate again (it then resumes).
  Serverless hosting is not supported (needs a long-lived Node process and a writable disk).
* JSON-file storage with no locking beyond a single process; no auth, so anyone with access can read or delete any story.
* URL import: generic Readability extraction only (no login walls, no JavaScript rendering, no multi-page stories). The SSRF guard blocks
  localhost/private addresses by DNS lookup but is not a complete defence (e.g. DNS rebinding).
* Dialogue segments keep their quotation marks (verbatim text); the speech engine ignores them.

## Next 3 things to build

1. **Server-side neural TTS** behind the `TtsProvider` interface (e.g. ElevenLabs/OpenAI voices): synthesize per segment, cache audio, stream the
   first segments while the rest render, and add MP3/M4B export - this is the real heart of the product.
2. **Better attribution and casting**: run live mode on real books with an eval set (speaker accuracy, text fidelity), add a second pass for
   coreference/alias merging across chunks, and let the user fix a mis-attributed line in the script view (re-assigning the speaker).
3. **Importers and persistence**: EPUB/PDF/DOCX parsing and site-specific importers (AO3, Wattpad, Reddit), then a database plus a job queue so
   generation survives restarts and can run on managed hosting.
