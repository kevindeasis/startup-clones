import { z } from "zod";

export const BusinessSchema = z.object({
  name: z.string().min(1),
  industry: z.string().min(1),
  city: z.string().min(1),
  region: z.string().min(1),
  country: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  hours: z.string().optional(),
  services: z.array(z.string().min(1)).min(1).max(12),
  tone: z.string().optional(),
  existingUrl: z.string().optional(),
  description: z.string().optional(),
});
export type Business = z.infer<typeof BusinessSchema>;

export const DesignDirectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  vibe: z.string(),
  palette: z.object({ primary: z.string(), accent: z.string(), background: z.string(), text: z.string() }),
  headingFont: z.string(),
  bodyFont: z.string(),
  layoutNotes: z.string(),
});
export type DesignDirection = z.infer<typeof DesignDirectionSchema>;
export const DirectionsOutputSchema = z.object({ directions: z.array(DesignDirectionSchema).length(3) });

export const SectionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hero"), headline: z.string(), subheadline: z.string(), ctaLabel: z.string(), ctaHref: z.string() }),
  z.object({
    type: z.literal("services"),
    heading: z.string(),
    items: z.array(z.object({ name: z.string(), blurb: z.string(), href: z.string() })),
  }),
  z.object({ type: z.literal("about"), heading: z.string(), body: z.string() }),
  z.object({ type: z.literal("text"), heading: z.string().optional(), body: z.string() }),
  z.object({ type: z.literal("faq"), heading: z.string(), items: z.array(z.object({ q: z.string(), a: z.string() })) }),
  z.object({ type: z.literal("cta"), heading: z.string(), body: z.string().optional(), ctaLabel: z.string(), ctaHref: z.string() }),
  z.object({
    type: z.literal("contact"),
    heading: z.string(),
    phone: z.string().optional(),
    email: z.string().optional(),
    address: z.string().optional(),
    hours: z.string().optional(),
    mapQuery: z.string().optional(),
  }),
  z.object({ type: z.literal("serviceArea"), heading: z.string(), areas: z.array(z.string()) }),
]);
export type Section = z.infer<typeof SectionSchema>;

export const PageSchema = z.object({
  id: z.string(),
  path: z.string(),
  type: z.enum(["home", "about", "service", "contact", "seo", "post"]),
  title: z.string(),
  metaDescription: z.string(),
  h1: z.string(),
  sections: z.array(SectionSchema),
  targetKeyword: z.string().optional(),
  publishedAt: z.string(),
});
export type Page = z.infer<typeof PageSchema>;

export const DraftSchema = z.object({
  id: z.string(),
  kind: z.enum(["page", "post", "fix"]),
  status: z.enum(["draft", "published", "dismissed"]),
  keyword: z.string().optional(),
  rationale: z.string(),
  page: PageSchema.optional(),
  fix: z.object({ title: z.string(), detail: z.string(), patch: PageSchema.partial().optional() }).optional(),
  createdAt: z.string(),
});
export type Draft = z.infer<typeof DraftSchema>;

export const RunSchema = z.object({
  id: z.string(),
  at: z.string(),
  keywordIdeas: z.array(z.string()),
  draftIds: z.array(z.string()),
  source: z.enum(["autocomplete", "llm", "mock"]),
});
export type Run = z.infer<typeof RunSchema>;

export const VersionSchema = z.object({ id: z.string(), createdAt: z.string(), summary: z.string(), pages: z.array(PageSchema) });
export type Version = z.infer<typeof VersionSchema>;

export const SiteSchema = z.object({
  id: z.string(),
  slug: z.string(),
  business: BusinessSchema,
  design: DesignDirectionSchema,
  pages: z.array(PageSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  versions: z.array(VersionSchema),
  growth: z.object({ autoPublish: z.boolean(), drafts: z.array(DraftSchema), runs: z.array(RunSchema) }),
});
export type Site = z.infer<typeof SiteSchema>;

// What the LLM returns for the site builder / chat editor (no bookkeeping fields).
export const BuiltSiteSchema = z.object({ pages: z.array(PageSchema) });
export const ChatEditSchema = z.object({ pages: z.array(PageSchema), summary: z.string() });

export const GrowthOutputSchema = z.object({
  drafts: z
    .array(
      z.object({
        kind: z.enum(["page", "post", "fix"]),
        keyword: z.string().optional(),
        rationale: z.string(),
        page: PageSchema.optional(),
        fix: z.object({ title: z.string(), detail: z.string(), patch: PageSchema.partial().optional() }).optional(),
      }),
    )
    .min(3)
    .max(6),
  keywordIdeas: z.array(z.string()).optional(),
});
export type GrowthOutput = z.infer<typeof GrowthOutputSchema>;

export const CheckSchema = z.object({ id: z.string(), label: z.string(), passed: z.boolean(), detail: z.string(), weight: z.number() });
export const FixSchema = z.object({ title: z.string(), why: z.string(), how: z.string(), priority: z.enum(["high", "medium", "low"]) });
export const AuditWriterSchema = z.object({ summary: z.string(), fixes: z.array(FixSchema).min(3).max(5) });
export const AuditReportSchema = z.object({
  url: z.string(),
  fetchedAt: z.string(),
  score: z.number(),
  checks: z.array(CheckSchema),
  summary: z.string(),
  fixes: z.array(FixSchema),
  extracted: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    h1s: z.array(z.string()),
    businessNameGuess: z.string().optional(),
    locationGuess: z.string().optional(),
    servicesGuess: z.array(z.string()),
  }),
});
export type AuditReport = z.infer<typeof AuditReportSchema>;
export type AuditCheck = z.infer<typeof CheckSchema>;
