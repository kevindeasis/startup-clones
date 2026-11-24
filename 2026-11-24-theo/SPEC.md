# Theo clone — build spec

Date: 2026-11-24. Folder: `2026-11-24-theo/`. Independent learning clone of **Theo** (YC F26, https://theo.site/, https://www.ycombinator.com/companies/theo). Not affiliated with Theo or Finale Labs, Inc.

## 1. What the original product does

Theo is "the site-builder and engine that gets your business found." A small-business owner answers a few questions (business, location, services), optionally points Theo at an existing website, picks one of three design directions, and Theo's AI agent builds a complete multi-page website in minutes. Edits are requested in a chat (no drag-and-drop editor). After launch, a weekly **growth agent** studies search demand, competitors and the business's services, then drafts new SEO pages and posts (targeting queries like "plumber in Springfield") plus technical fixes. Drafts wait in a **Growth tab** for the owner to publish unless auto-publish is on. Theo also offers a free, no-login **site audit** that checks whether Google can understand a site's pages, services and locations. Plans: Basic $29.99/mo (site + hosting + chat edits), Starter $69.99/mo (adds weekly growth work + booking), Pro $129.99/mo.

## 2. What the clone implements (core user flows)

1. **Build a site from a questionnaire.** Form: business name, trade/industry, city + state/region, 2–8 services, phone, email, hours, tone, optional existing website URL. Step 1 returns **three design directions** (name, one-line vibe, palette, font pairing, layout notes). The user picks one. Step 2 generates a full **site model** (JSON): Home, About, one page per service, Contact, plus a FAQ section. Preview renders immediately.
2. **Chat edits.** A chat panel beside the live preview. The user types "add a drain-cleaning service", "make the hero headline shorter", "move the FAQ above the CTA". The LLM returns an updated site model (full JSON, validated with zod); the app saves a new version and re-renders. A version list allows reverting to any previous version.
3. **Growth agent run.** Button "Run growth agent" (plus an auto-publish toggle). The agent: (a) gathers keyword ideas for `<service> in <city>` style queries using Google Autocomplete (`https://suggestqueries.google.com/complete/search?client=firefox&q=...`) when reachable, otherwise LLM-generated ideas; (b) produces 3–6 **drafts**: new SEO landing pages (service + location), blog-style posts answering customer questions, and technical fixes (e.g. missing meta description, missing JSON-LD). Drafts appear in a **Growth tab** with Publish / Dismiss. If auto-publish is on, page/post drafts publish immediately. Each run is logged.
4. **Site audit (no login).** Public page `/audit`: paste a URL (or raw HTML as fallback if the fetch fails). Deterministic checks (title, meta description, single H1, viewport meta, image alt coverage, JSON-LD LocalBusiness, canonical, mentions of a location and services, internal links count, robots.txt and sitemap.xml presence, page size) produce a 0–100 score. The LLM then writes a short plain-English summary and 3–5 prioritized fixes. The audit page offers "Build a new site with these details".
5. **Publish / export.** Each site is served at `/s/<slug>` and `/s/<slug>/<page-path>` as real HTML with `<title>`, meta description, Open Graph tags and a `LocalBusiness` JSON-LD block. "Export static site" writes `exports/<slug>/` with one HTML file per page, `sitemap.xml` and `robots.txt`, and returns a `.zip` download.

**Skip:** auth, billing/credits, custom domains, real hosting, Google Search Console/Analytics integration, booking pages, Stripe, Shopify/Wix import, weekly scheduler (the run is manual; note a cron would be the next step), email summaries.

## 3. Stack

- **Next.js 16 (App Router) + TypeScript**, Tailwind CSS (whatever `create-next-app` scaffolds; if scaffolding needs network it is fine, otherwise hand-write the minimal config). Node 22 is available.
- **Vercel AI SDK** (`ai` v7.x) with **`@ai-sdk/anthropic`** (v4.x) as the only LLM client. Default model from `ANTHROPIC_MODEL`, defaulting to `claude-sonnet-5-5`. IMPORTANT: the installed `ai` version may differ from your training data. Before writing LLM code, read `node_modules/ai/dist/index.d.ts` (or the package README) to confirm the exact structured-output API available (`generateObject`, or `generateText` with `Output.object`/`output` option). Use whichever exists; otherwise use `generateText` and parse JSON validated by zod.
- **zod** (v4) for every LLM output schema and API input validation.
- **cheerio** for HTML parsing in the audit and existing-site import.
- **jszip** (or `archiver`) for the export zip.
- Storage: **JSON files on disk** under `data/` (gitignored) through one small `lib/store.ts` module (`readSite`, `writeSite`, `listSites`, `appendVersion`). No database, no native modules.
- No auth, no external SaaS.

## 4. LLM layer and mock mode

`lib/llm.ts` exposes `generateJSON<T>(opts: { system, prompt, schema: ZodSchema<T>, name })`. If `ANTHROPIC_API_KEY` is unset **or** `MOCK_LLM=1`, it returns deterministic fixtures from `lib/mock/` keyed by `name` and derived from the inputs (for example the mock site builder uses the real business name, city and services from the form; the mock chat editor applies simple rule-based edits such as appending a service when the message contains "add" + a service noun, or otherwise appends a note section; the mock growth agent creates one `<service> in <city>` page per service up to 3, one post, and one fix). The UI shows a visible "Mock mode: no ANTHROPIC_API_KEY set" banner. The app must be fully usable in mock mode.

Prompts (keep in `lib/prompts.ts`):
- **Design directions**: given business facts, return exactly 3 directions `{ id, name, vibe, palette: { primary, accent, background, text }, headingFont, bodyFont, layoutNotes }`.
- **Site builder**: given business + chosen direction, return the full `Site` model (schema below). Rules: concrete local copy that names the city, one page per service with path `/services/<slug>`, FAQ with 4–6 questions, no fabricated reviews or statistics, phone/email only from the form.
- **Chat editor**: given current site JSON + user message, return the complete updated site JSON plus `summary` (one sentence). Must preserve ids and untouched content.
- **Growth agent**: given site JSON + keyword ideas + list of existing paths, return `drafts[]` (3–6) with kinds `page` (full `Page`), `post` (full `Page` of type `post` under `/blog/<slug>`), `fix` (`{ title, detail, patch?: Partial<Page> }`). Avoid duplicating existing paths.
- **Audit writer**: given check results + page title/description, return `{ summary, fixes: [{ title, why, how, priority: high|medium|low }] }`.

## 5. Data model (zod schemas in `lib/schema.ts`)

```ts
Business { name, industry, city, region, country?, phone?, email?, hours?, services: string[], tone?, existingUrl?, description? }
DesignDirection { id, name, vibe, palette:{primary,accent,background,text}, headingFont, bodyFont, layoutNotes }
Section =
 | { type:'hero', headline, subheadline, ctaLabel, ctaHref }
 | { type:'services', heading, items:[{ name, blurb, href }] }
 | { type:'about', heading, body }
 | { type:'text', heading?, body }           // body is markdown-ish paragraphs
 | { type:'faq', heading, items:[{ q, a }] }
 | { type:'cta', heading, body?, ctaLabel, ctaHref }
 | { type:'contact', heading, phone?, email?, address?, hours?, mapQuery? }
 | { type:'serviceArea', heading, areas:string[] }
Page { id, path, type:'home'|'about'|'service'|'contact'|'seo'|'post', title, metaDescription, h1, sections: Section[], targetKeyword?, publishedAt }
Site { id, slug, business, design, pages: Page[], createdAt, updatedAt,
       versions: [{ id, createdAt, summary, pages: Page[] }],
       growth: { autoPublish:boolean, drafts: Draft[], runs:[{ id, at, keywordIdeas:string[], draftIds:string[], source:'autocomplete'|'llm'|'mock' }] } }
Draft { id, kind:'page'|'post'|'fix', status:'draft'|'published'|'dismissed', keyword?, rationale, page?: Page, fix?: { title, detail }, createdAt }
AuditReport { url, fetchedAt, score, checks:[{ id, label, passed, detail, weight }], summary, fixes:[{ title, why, how, priority }], extracted:{ title?, description?, h1s:string[], businessNameGuess?, locationGuess?, servicesGuess:string[] } }
```

## 6. Screens and endpoints

Screens (App Router):
- `/` — landing: what it does, "Build a site" and "Free audit" buttons, list of existing sites (from `data/`), mock-mode banner.
- `/new` — questionnaire → design directions → "Build". Redirects to `/sites/<id>`.
- `/sites/[id]` — workspace: left = chat edits + version list; center = iframe preview of `/s/<slug>`; tabs: **Pages**, **Growth** (drafts, run button, auto-publish toggle, run log), **Export**.
- `/audit` — URL input → report with score ring, checks table, fixes, "Build a site from this".
- `/s/[slug]` and `/s/[slug]/[...path]` — the rendered public site (server-rendered HTML, design palette applied via CSS variables, JSON-LD, OG tags, nav + footer). Also `/s/[slug]/sitemap.xml` and `/s/[slug]/robots.txt`.

API routes (`app/api/...`, JSON, zod-validated):
- `POST /api/design-directions` { business } → { directions[3] }
- `POST /api/sites` { business, direction } → Site
- `GET /api/sites` → Site[] (summaries); `GET /api/sites/[id]` → Site
- `POST /api/sites/[id]/chat` { message } → { site, summary }
- `POST /api/sites/[id]/revert` { versionId } → Site
- `POST /api/sites/[id]/growth/run` → { run, drafts }
- `POST /api/sites/[id]/growth/[draftId]` { action:'publish'|'dismiss' } → Site
- `PATCH /api/sites/[id]/growth` { autoPublish } → Site
- `POST /api/sites/[id]/export` → zip (and writes `exports/<slug>/`)
- `POST /api/audit` { url } or { html, url? } → AuditReport
- `GET /api/health` → { ok:true, mock:boolean, model }

## 7. Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=        # optional; when empty the app runs in mock mode
ANTHROPIC_MODEL=claude-sonnet-5-5
MOCK_LLM=                 # set to 1 to force mock mode even with a key
PORT=3000
```

## 8. Acceptance checks (the build must pass all of these with NO API key set)

1. `npm install`, `npm run build` and `npx tsc --noEmit` succeed; `npm run lint` passes or lint is removed from the scripts with a note.
2. `npm run dev` (or `npm start` after build) boots; `GET /api/health` returns `{ ok: true, mock: true }`.
3. `POST /api/design-directions` returns exactly 3 directions.
4. `POST /api/sites` with a plumber in Springfield, IL with 3 services returns a site with ≥ 6 pages (home, about, 3 services, contact), and `GET /s/<slug>` returns 200 HTML that contains the business name, a `<meta name="description">`, and a `LocalBusiness` JSON-LD block; `GET /s/<slug>/services/<first-service-slug>` returns 200.
5. `POST /api/sites/<id>/chat` with "add a water heater repair service" results in a new service page and a new version entry; `POST .../revert` restores the previous version.
6. `POST /api/sites/<id>/growth/run` creates ≥ 3 drafts of at least two kinds; publishing a `page` draft makes it reachable at its path and listed in `/s/<slug>/sitemap.xml`.
7. `POST /api/audit` with inline sample HTML returns a score between 0 and 100, ≥ 8 checks, and ≥ 3 fixes.
8. `POST /api/sites/<id>/export` returns a zip; `exports/<slug>/` contains `index.html`, `sitemap.xml`, `robots.txt`.
9. `scripts/smoke.mjs` runs checks 2–8 against a running server (base URL from `BASE_URL`, default `http://localhost:3000`) and exits 0; `npm run smoke` runs it.
10. `.gitignore` excludes `node_modules`, `.next`, `data/`, `exports/`, `.env*` (but not `.env.example`). No secrets committed.
