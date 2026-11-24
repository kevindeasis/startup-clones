import type { Business, DesignDirection, Site } from "./schema";

const j = (v: unknown) => JSON.stringify(v, null, 1);

export const SYSTEM = "You are Theo, an AI website builder and SEO growth agent for local small businesses. Output must match the requested schema exactly.";

export const directionsPrompt = (b: Business) =>
  `Business facts:\n${j(b)}\n\nReturn exactly 3 distinct design directions { id, name, vibe, palette:{primary,accent,background,text} as hex colors, headingFont, bodyFont, layoutNotes }. Make sure text/background have strong contrast.`;

export const builderPrompt = (b: Business, d: DesignDirection) =>
  `Build the full site model for this business with the chosen design direction.\n\nBusiness:\n${j(b)}\n\nDirection:\n${j(d)}\n\nRules:\n- Pages: home (path "/"), about ("/about"), one page per service with path "/services/<slug>" (type "service"), contact ("/contact").\n- Concrete local copy that names the city (${b.city}). No fabricated reviews, testimonials or statistics.\n- Phone and email ONLY from the business facts; omit if absent.\n- Home includes hero, services, about, faq (4-6 questions), cta. Each page has unique title, metaDescription (<=160 chars), h1.\n- Use unique ids per page (e.g. "p_home"). publishedAt = current ISO date.`;

export const chatPrompt = (site: Site, message: string) =>
  `Current site pages JSON:\n${j(site.pages)}\n\nBusiness:\n${j(site.business)}\n\nOwner request: ${message}\n\nReturn the COMPLETE updated "pages" array plus "summary" (one sentence). Preserve ids and all untouched content. New service pages must use path /services/<slug> and also be linked from the home services section.`;

export const growthPrompt = (site: Site, ideas: string[], paths: string[]) =>
  `Site:\n${j({ business: site.business, pages: site.pages.map((p) => ({ path: p.path, title: p.title })) })}\n\nKeyword ideas:\n${j(ideas)}\n\nExisting paths (do not duplicate): ${j(paths)}\n\nReturn "drafts" (3-6): kind "page" (full SEO landing Page of type "seo", service + location), kind "post" (full Page of type "post" under /blog/<slug> answering a customer question), kind "fix" ({title, detail, patch?}). Include a rationale per draft. No fabricated stats or reviews.`;

export const keywordPrompt = (b: Business) =>
  `Suggest 10 realistic local search queries customers would type for this business:\n${j(b)}`;

export const auditPrompt = (payload: unknown) =>
  `Audit check results:\n${j(payload)}\n\nWrite { summary: short plain-English paragraph, fixes: 3-5 items { title, why, how, priority: high|medium|low } } ordered by priority.`;
