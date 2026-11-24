import type { Business, Page, Section, Site } from "../schema";
import { directionsFor, buildPages, servicePage } from "./site";
import { slugify, titleCase, uid, now } from "../util";

/* Deterministic mock fixtures keyed by LLM call name, derived from the real inputs. */
export function mockFor(name: string, input: unknown): unknown {
  switch (name) {
    case "design_directions":
      return { directions: directionsFor(input as Business) };
    case "build_site": {
      const { business, direction } = input as { business: Business; direction: any };
      return { pages: buildPages(business, direction) };
    }
    case "chat_edit":
      return mockChat(input as { pages: Page[]; business: Business; message: string });
    case "keyword_ideas":
      return { ideas: keywordIdeas(input as Business) };
    case "growth_drafts":
      return mockGrowth(input as { site: Site; ideas: string[]; paths: string[] });
    case "audit_writer":
      return mockAudit(input as AuditIn);
    default:
      throw new Error(`No mock fixture for ${name}`);
  }
}

export function keywordIdeas(b: Business): string[] {
  const c = b.city.toLowerCase();
  const out: string[] = [];
  for (const s of b.services) out.push(`${s.toLowerCase()} in ${c}`, `emergency ${s.toLowerCase()} ${c}`);
  out.push(`${b.industry.toLowerCase()} near me`, `best ${b.industry.toLowerCase()} in ${c}`);
  return out;
}

const NOUN = /(service|repair|installation|install|cleaning|replacement|inspection|maintenance|removal|detection|upgrade)/i;

function mockChat({ pages, business, message }: { pages: Page[]; business: Business; message: string }) {
  const next: Page[] = structuredClone(pages);
  const home = next.find((p) => p.type === "home");
  const m = message.trim();
  let summary = "";
  const add = /\badd\s+(?:an?\s+|the\s+|new\s+)*(.+?)(?:\s+services?)?(?:\s+(?:to|on|for)\b.*)?$/i.exec(m);
  if (add && NOUN.test(m)) {
    const raw = add[1].replace(/[.!?]+$/, "").trim();
    const name = titleCase(raw);
    const slug = slugify(raw);
    if (!next.some((p) => p.path === `/services/${slug}`)) {
      const idx = next.findIndex((p) => p.type === "contact");
      const page = servicePage({ ...business, services: [...business.services, name] }, name);
      next.splice(idx < 0 ? next.length : idx, 0, page);
      const svc = home?.sections.find((s) => s.type === "services");
      if (svc && svc.type === "services") svc.items.push({ name, blurb: `Professional ${raw.toLowerCase()} for ${business.city} customers.`, href: `/services/${slug}` });
      summary = `Added a new "${name}" service page and linked it from the home page.`;
    } else summary = `The "${name}" service page already exists; no change made.`;
  } else if (/(shorter|shorten).*(headline|hero)|(headline|hero).*(shorter|shorten)/i.test(m) && home) {
    const hero = home.sections.find((s) => s.type === "hero");
    if (hero && hero.type === "hero") {
      hero.headline = hero.headline.split(/[:|–-]/)[0].trim().split(" ").slice(0, 5).join(" ");
      summary = `Shortened the hero headline to "${hero.headline}".`;
    }
  } else if (/move.*faq.*(above|before).*cta/i.test(m) && home) {
    const f = home.sections.findIndex((s) => s.type === "faq");
    const [faq] = f >= 0 ? home.sections.splice(f, 1) : [];
    const c = home.sections.findIndex((s) => s.type === "cta");
    if (faq) {
      home.sections.splice(c < 0 ? home.sections.length : c, 0, faq);
      summary = "Moved the FAQ section above the call-to-action.";
    }
  }
  if (!summary && home) {
    const note: Section = { type: "text", heading: "A note from us", body: m };
    const c = home.sections.findIndex((s) => s.type === "cta");
    home.sections.splice(c < 0 ? home.sections.length : c, 0, note);
    summary = "Added a note section to the home page with your request (mock editor).";
  }
  return { pages: next, summary: summary || "No changes made." };
}

function mockGrowth({ site, ideas, paths }: { site: Site; ideas: string[]; paths: string[] }) {
  const b = site.business;
  const taken = new Set(paths);
  const drafts: any[] = [];
  const city = slugify(b.city);
  const variants = ["", "-near-me", "-emergency", "-cost", "-same-day", "-local"];
  for (const s of b.services.slice(0, 3)) {
    let path = "";
    let v = "";
    for (const x of variants) {
      path = `/${slugify(s)}-${city}${x}`;
      v = x;
      if (!taken.has(path)) break;
    }
    if (taken.has(path)) path = `${path}-${uid().slice(0, 4)}`;
    taken.add(path);
    const kw = `${s.toLowerCase()} in ${b.city.toLowerCase()}${v ? v.replace(/-/g, " ") : ""}`;
    const page: Page = {
      id: uid("p_seo_"), path, type: "seo", targetKeyword: kw, publishedAt: now(),
      title: `${titleCase(s)} in ${b.city}, ${b.region}${v ? ` (${v.slice(1).replace(/-/g, " ")})` : ""} | ${b.name}`.slice(0, 70),
      metaDescription: `Looking for ${kw}? ${b.name} offers ${s.toLowerCase()} in ${b.city}, ${b.region}. Contact us for a quote.`.slice(0, 160),
      h1: `${titleCase(s)} in ${b.city}, ${b.region}`,
      sections: [
        { type: "hero", headline: `${titleCase(s)} in ${b.city}`, subheadline: `Local ${s.toLowerCase()} from ${b.name}.`, ctaLabel: "Request a quote", ctaHref: "/contact" },
        { type: "text", heading: `Why ${b.city} customers choose ${b.name}`, body: `People search for "${kw}" when they need help quickly. ${b.name} is based in ${b.city}, ${b.region}, and offers ${s.toLowerCase()} with upfront quotes and clear communication.` },
        { type: "cta", heading: `Get ${s.toLowerCase()} in ${b.city}`, ctaLabel: "Contact us", ctaHref: "/contact" },
      ],
    };
    drafts.push({ kind: "page", keyword: kw, rationale: `People search "${kw}"; no dedicated landing page exists for this query yet.`, page });
  }
  const qs = [`How do I choose a ${b.industry.toLowerCase()} in ${b.city}?`, `What should I ask a ${b.industry.toLowerCase()} before hiring?`, `How much does ${(b.services[0] ?? b.industry).toLowerCase()} cost in ${b.city}?`, `When should I call a ${b.industry.toLowerCase()}?`];
  let q = qs.find((x) => !taken.has(`/blog/${slugify(x)}`)) ?? `${qs[0]} (${uid().slice(0, 4)})`;
  const ppath = `/blog/${slugify(q)}`;
  drafts.push({
    kind: "post", keyword: q.toLowerCase().replace(/\?$/, ""), rationale: "Answers a question customers ask before they call, and targets an informational query.",
    page: {
      id: uid("p_post_"), path: ppath, type: "post", publishedAt: now(), targetKeyword: q.toLowerCase().replace(/\?$/, ""),
      title: `${q.replace(/\?$/, "")} | ${b.name}`.slice(0, 70), metaDescription: `${q} A practical guide from ${b.name} in ${b.city}, ${b.region}.`.slice(0, 160), h1: q,
      sections: [{ type: "text", body: `Choosing the right ${b.industry.toLowerCase()} in ${b.city} comes down to a few simple things: clear quotes, clear timelines, and someone who answers the phone.\n\nAsk for a written estimate, ask what is included, and ask how soon work can start. ${b.name} is happy to answer these questions for any ${b.city} customer.` }, { type: "cta", heading: "Have a question?", ctaLabel: "Contact us", ctaHref: "/contact" }],
    },
  });
  const weak = site.pages.find((p) => p.metaDescription.length < 110 && p.type !== "post");
  drafts.push(
    weak
      ? { kind: "fix", rationale: "Short meta descriptions waste search-result space.", fix: { title: `Expand meta description on ${weak.path}`, detail: `The description on ${weak.path} is only ${weak.metaDescription.length} characters. Expand to ~150 characters with the city and service.`, patch: { id: weak.id, path: weak.path, metaDescription: `${weak.metaDescription.replace(/\.$/, "")}. ${b.name} serves ${b.city}, ${b.region}; call or message us for a quote.`.slice(0, 160) } } }
      : { kind: "fix", rationale: "Internal links help Google discover service pages.", fix: { title: "Link service pages from the About page", detail: `Add links from /about to each service page so crawlers and visitors in ${b.city} can reach them.` } },
  );
  return { drafts, keywordIdeas: ideas };
}

export type AuditIn = { checks: { id: string; label: string; passed: boolean; detail: string }[]; score: number; title?: string; description?: string };
const FIXES: Record<string, { title: string; why: string; how: string; priority: "high" | "medium" | "low" }> = {
  title: { title: "Write a clear page title", why: "The title is the main headline in Google results.", how: "Use 50-60 characters: business name, service and city.", priority: "high" },
  meta: { title: "Add a meta description", why: "Descriptions improve click-through from search results.", how: "Write 120-160 characters describing the service and location.", priority: "high" },
  h1: { title: "Use exactly one H1", why: "A single H1 tells Google the page topic.", how: "Keep one H1 that names the service and city.", priority: "high" },
  jsonld: { title: "Add LocalBusiness structured data", why: "JSON-LD helps Google understand who you are and where you work.", how: "Add a LocalBusiness JSON-LD block with name, address, phone and services.", priority: "high" },
  location: { title: "Mention your city and service area", why: "Local searches need location signals.", how: "Name the city in the headline, intro text and footer.", priority: "high" },
  services: { title: "Name your services on the page", why: "Pages that name services can match service queries.", how: "Create a section or page per service with its own heading.", priority: "medium" },
  viewport: { title: "Add a viewport meta tag", why: "Most local searches happen on phones.", how: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.', priority: "medium" },
  alt: { title: "Add alt text to images", why: "Alt text helps accessibility and image search.", how: "Describe each image briefly, including the service or location when relevant.", priority: "medium" },
  canonical: { title: "Add a canonical link", why: "Prevents duplicate-URL confusion.", how: 'Add <link rel="canonical" href="..."> pointing to the preferred URL.', priority: "low" },
  links: { title: "Add internal links", why: "Links help crawlers find all pages.", how: "Link to each service page from the home page and navigation.", priority: "medium" },
  robots: { title: "Add a robots.txt", why: "Tells crawlers what to index and where the sitemap is.", how: "Serve /robots.txt with a Sitemap line.", priority: "low" },
  sitemap: { title: "Publish a sitemap.xml", why: "Helps Google discover every page.", how: "Generate /sitemap.xml listing all public pages.", priority: "medium" },
  size: { title: "Reduce page size", why: "Heavy pages load slowly on mobile.", how: "Compress images and remove unused scripts.", priority: "low" },
};
function mockAudit(a: AuditIn) {
  const failed = a.checks.filter((c) => !c.passed);
  const fixes = failed.map((c) => FIXES[c.id]).filter(Boolean);
  const order = { high: 0, medium: 1, low: 2 } as const;
  fixes.sort((x, y) => order[x.priority] - order[y.priority]);
  const generic = [
    { title: "Add a call-to-action above the fold", why: "Visitors should know how to contact you immediately.", how: "Place a phone button or quote form in the first screen.", priority: "low" as const },
    { title: "Create a landing page per service and city", why: "Dedicated pages rank for specific local queries.", how: "Use titles like '<Service> in <City>'.", priority: "medium" as const },
    { title: "Keep content fresh", why: "Regular updates signal an active business.", how: "Publish a short post answering a customer question each month.", priority: "low" as const },
  ];
  for (const g of generic) if (fixes.length < 3) fixes.push(g);
  return {
    summary: `This page scored ${a.score}/100. ${failed.length ? `${failed.length} of ${a.checks.length} checks failed, mainly: ${failed.slice(0, 3).map((c) => c.label.toLowerCase()).join(", ")}.` : "All checks passed."} Fixing the high-priority items first will make it easier for Google to understand what you offer and where.`,
    fixes: fixes.slice(0, 5),
  };
}
