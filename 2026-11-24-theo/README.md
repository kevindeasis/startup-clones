# Theo clone (2026-11-24)

An independent learning clone of **Theo**, a YC F26 startup. It is **not affiliated with Theo or Finale Labs, Inc.**

- Original: https://theo.site/ and https://www.ycombinator.com/companies/theo

## What the original does

Theo is "the site-builder and engine that gets your business found". A small-business owner answers a few questions, optionally points Theo at an existing site, and picks one of three design directions. An AI agent then builds a multi-page website. Edits are requested in chat. After launch, a weekly growth agent studies search demand and drafts SEO pages, posts and technical fixes that wait in a Growth tab (or auto-publish). A free, no-login audit checks whether Google can understand a site.

## What this clone does

1. Questionnaire to 3 design directions to a full site model (Home, About, one page per service, Contact, FAQ).
2. Chat edits beside a live iframe preview. Each edit is a zod-validated full site model saved as a new version, with one-click revert.
3. Growth agent (manual button + auto-publish toggle): keyword ideas (Google Autocomplete when enabled/reachable, otherwise LLM/mock), then 3-6 drafts (SEO pages, posts, fixes) with Publish/Dismiss and a run log.
4. Public `/audit`: URL or pasted HTML, 13 deterministic checks, 0-100 score, plain-English summary and 3-5 prioritized fixes, "Build a new site with these details".
5. Published sites at `/s/<slug>/...` as real server-rendered HTML with title, meta description, Open Graph, canonical and `LocalBusiness` JSON-LD, plus `sitemap.xml` and `robots.txt`. "Export static site" writes `exports/<slug>/` and returns a zip.

**Skipped:** auth, billing, custom domains, real hosting, Search Console/Analytics, booking, Stripe, Shopify/Wix import, weekly scheduler (the run is manual), email summaries, scraping the existing website into the build (the URL is stored only).

## Architecture

```
Browser (React client components)
   |  fetch JSON
Next.js 16 App Router
   |-- app/api/*            zod-validated route handlers
   |-- app/s/[slug]/[[...path]]   server-rendered public site (lib/render.ts)
   |-- lib/ops.ts           create site, chat edit, revert, growth run, draft actions
   |-- lib/llm.ts           generateJSON(): ai generateObject + @ai-sdk/anthropic  |  mock fixtures (lib/mock)
   |-- lib/audit.ts         cheerio checks + LLM/mock writer
   '-- lib/store.ts         JSON files in data/sites/*.json
```

The installed `ai` v7 exposes `generateObject` (also `generateText` with `Output.object`); `lib/llm.ts` uses `generateObject({ model, schema, system, prompt })`.

## Open-source tools used

| Tool | Covers |
| --- | --- |
| [Next.js](https://github.com/vercel/next.js) 16 | App Router, API routes, server-rendered sites |
| [Vercel AI SDK](https://github.com/vercel/ai) (`ai`) + [`@ai-sdk/anthropic`](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic) | Structured LLM output (`generateObject`) |
| [zod](https://github.com/colinhacks/zod) 4 | LLM output schemas and API input validation |
| [cheerio](https://github.com/cheeriojs/cheerio) | HTML parsing for the audit |
| [JSZip](https://github.com/Stuk/jszip) | Export zip |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) 4 | App UI styling |

## Setup and run

```bash
cd 2026-11-24-theo
npm install
cp .env.example .env.local     # optional; leave the key empty for mock mode
npm run dev                    # http://localhost:3000   (PORT env var honored)
# or: npm run build && npm start
npm run smoke                  # in another shell; BASE_URL defaults to http://localhost:3000
```

`npm run lint` runs `tsc --noEmit` (no ESLint is configured).

## Environment variables

| Name | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Optional. Empty means mock mode. |
| `ANTHROPIC_MODEL` | Default `claude-sonnet-5-5`. |
| `MOCK_LLM` | `1` forces mock mode even with a key. |
| `PORT` | Server port for `npm run dev` / `npm start` (default 3000). |
| `GROWTH_AUTOCOMPLETE` | Optional. `1` makes the growth agent query Google Autocomplete even in mock mode. |

## Mock mode

With no `ANTHROPIC_API_KEY` (or `MOCK_LLM=1`) `generateJSON` returns deterministic fixtures from `lib/mock/`, keyed by call name and derived from your inputs: the site uses your real business name, city and services; the chat editor applies rules ("add ... service" appends a service page and home link, "shorter headline", "move the FAQ above the CTA", otherwise appends a note section); the growth agent makes one `<service> in <city>` page per service (max 3), one post and one fix; the audit writer maps failed checks to canned fixes. A banner shows "Mock mode" in the UI and `/api/health` returns `mock: true`.

## Known limitations

- No auth: anyone with access can edit any site. Slugs and ids are not protected.
- Data is local JSON files with no locking beyond atomic writes.
- Real-LLM mode is untested here (no API key was available); only mock mode was exercised end to end.
- Existing-site URL is stored but not imported. Audit location/service detection is heuristic.
- Static export links are rewritten for internal hrefs only; fonts load from Google Fonts.
- Fix drafts only patch top-level page fields; the audit fetches arbitrary URLs (SSRF protection not implemented).

## Next 3 things to build

1. Weekly scheduler (cron) for the growth agent plus an email summary of new drafts.
2. Import of the existing site (crawl with cheerio, feed content to the builder) and richer sections/images.
3. Real hosting with custom domains, auth and a Search Console integration to rank drafts by actual demand.
