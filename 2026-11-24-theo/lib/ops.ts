import { generateJSON, isMock } from "./llm";
import { builderPrompt, chatPrompt, directionsPrompt, growthPrompt, keywordPrompt, SYSTEM } from "./prompts";
import { BuiltSiteSchema, ChatEditSchema, DirectionsOutputSchema, GrowthOutputSchema, PageSchema, SiteSchema, type Business, type Draft, type DesignDirection, type Page, type Site } from "./schema";
import { appendVersion, uniqueSlug, writeSite } from "./store";
import { now, slugify, uid } from "./util";
import { z } from "zod";
import { keywordIdeas } from "./mock";

export async function designDirections(b: Business): Promise<DesignDirection[]> {
  const out = await generateJSON({ name: "design_directions", system: SYSTEM, prompt: directionsPrompt(b), schema: DirectionsOutputSchema, input: b });
  return out.directions;
}

function normalizePath(p: string) {
  const x = "/" + p.replace(/^\/+|\/+$/g, "");
  return x.replace(/[^a-zA-Z0-9/_-]/g, "-").toLowerCase();
}
function cleanPages(pages: Page[]): Page[] {
  const seen = new Set<string>();
  return pages.map((p) => ({ ...p, path: normalizePath(p.path) })).filter((p) => (seen.has(p.path) ? false : (seen.add(p.path), true)));
}

export async function createSite(business: Business, design: DesignDirection): Promise<Site> {
  const built = await generateJSON({ name: "build_site", system: SYSTEM, prompt: builderPrompt(business, design), schema: BuiltSiteSchema, input: { business, direction: design } });
  const t = now();
  const site: Site = {
    id: uid("s_"),
    slug: await uniqueSlug(slugify(`${business.name}-${business.city}`)),
    business,
    design,
    pages: cleanPages(built.pages),
    createdAt: t,
    updatedAt: t,
    versions: [],
    growth: { autoPublish: false, drafts: [], runs: [] },
  };
  return appendVersion(SiteSchema.parse(site), "Initial build");
}

export async function chatEdit(site: Site, message: string): Promise<{ site: Site; summary: string }> {
  const out = await generateJSON({ name: "chat_edit", system: SYSTEM, prompt: chatPrompt(site, message), schema: ChatEditSchema, input: { pages: site.pages, business: site.business, message } });
  const pages = cleanPages(out.pages);
  if (!pages.some((p) => p.path === "/")) throw new Error("Edit rejected: the home page was removed");
  site.pages = pages;
  await appendVersion(site, out.summary);
  return { site, summary: out.summary };
}

export async function revert(site: Site, versionId: string): Promise<Site | null> {
  const v = site.versions.find((x) => x.id === versionId);
  if (!v) return null;
  site.pages = structuredClone(v.pages);
  return appendVersion(site, `Reverted to: ${v.summary}`);
}

async function autocomplete(q: string): Promise<string[]> {
  try {
    const r = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return [];
    const j = (await r.json()) as [string, string[]];
    return Array.isArray(j[1]) ? j[1] : [];
  } catch {
    return [];
  }
}

export async function runGrowth(site: Site) {
  const b = site.business;
  let ideas: string[] = [];
  let source: "autocomplete" | "llm" | "mock" = "mock";
  if (!isMock() || process.env.GROWTH_AUTOCOMPLETE === "1") {
    const seeds = b.services.slice(0, 3).map((s) => `${s.toLowerCase()} in ${b.city.toLowerCase()}`);
    const lists = await Promise.all(seeds.map(autocomplete));
    ideas = [...new Set(lists.flat())].slice(0, 15);
    if (ideas.length) source = "autocomplete";
  }
  if (!ideas.length) {
    if (isMock()) ideas = keywordIdeas(b);
    else {
      const r = await generateJSON({ name: "keyword_ideas", system: SYSTEM, prompt: keywordPrompt(b), schema: z.object({ ideas: z.array(z.string()) }), input: b });
      ideas = r.ideas;
      source = "llm";
    }
  }
  const paths = [...site.pages.map((p) => p.path), ...site.growth.drafts.filter((d) => d.status === "draft").map((d) => d.page?.path).filter(Boolean) as string[]];
  const out = await generateJSON({ name: "growth_drafts", system: SYSTEM, prompt: growthPrompt(site, ideas, paths), schema: GrowthOutputSchema, input: { site, ideas, paths } });
  const t = now();
  const drafts: Draft[] = out.drafts.map((d) => ({
    id: uid("d_"),
    kind: d.kind,
    status: "draft" as const,
    keyword: d.keyword,
    rationale: d.rationale,
    page: d.page ? PageSchema.parse({ ...d.page, path: normalizePath(d.page.path), id: d.page.id || uid("p_") }) : undefined,
    fix: d.fix,
    createdAt: t,
  }));
  const run = { id: uid("r_"), at: t, keywordIdeas: ideas, draftIds: drafts.map((d) => d.id), source };
  site.growth.drafts.push(...drafts);
  site.growth.runs.push(run);
  if (site.growth.autoPublish) {
    for (const d of drafts) if (d.kind !== "fix") publishDraftInPlace(site, d);
  }
  await writeSite(site);
  if (site.growth.autoPublish) await appendVersion(site, "Growth agent auto-published drafts");
  return { run, drafts, site };
}

function publishDraftInPlace(site: Site, d: Draft): boolean {
  if (d.status !== "draft") return false;
  if (d.page) {
    if (site.pages.some((p) => p.path === d.page!.path)) return false;
    site.pages.push({ ...d.page, publishedAt: now() });
  } else if (d.fix?.patch) {
    const patch = d.fix.patch;
    const target = site.pages.find((p) => (patch.id && p.id === patch.id) || (patch.path && p.path === patch.path));
    if (!target) return false;
    Object.assign(target, patch, { id: target.id, path: target.path });
  }
  d.status = "published";
  return true;
}

export async function draftAction(site: Site, draftId: string, action: "publish" | "dismiss"): Promise<Site | { error: string; status: number }> {
  const d = site.growth.drafts.find((x) => x.id === draftId);
  if (!d) return { error: "Draft not found", status: 404 };
  if (d.status !== "draft") return { error: `Draft already ${d.status}`, status: 409 };
  if (action === "dismiss") {
    d.status = "dismissed";
    return writeSite(site);
  }
  if (d.page && site.pages.some((p) => p.path === d.page!.path)) return { error: `Path ${d.page.path} already exists`, status: 409 };
  if (d.kind === "fix" && !d.fix?.patch) {
    d.status = "published"; // advisory fix acknowledged
    return writeSite(site);
  }
  if (!publishDraftInPlace(site, d)) return { error: "Could not apply draft", status: 422 };
  return appendVersion(site, `Published growth draft: ${d.page?.title ?? d.fix?.title ?? d.id}`);
}
