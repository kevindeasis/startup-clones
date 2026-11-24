import * as cheerio from "cheerio";
import { generateJSON } from "./llm";
import { auditPrompt, SYSTEM } from "./prompts";
import { AuditWriterSchema, type AuditCheck, type AuditReport } from "./schema";

async function get(url: string, ms = 8000): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), redirect: "follow", headers: { "user-agent": "TheoCloneAudit/0.1 (learning project)" } });
    return { ok: r.ok, status: r.status, text: r.ok ? await r.text() : "" };
  } catch {
    return { ok: false, status: 0, text: "" };
  }
}

export async function runAudit(input: { url?: string; html?: string }): Promise<AuditReport> {
  let html = input.html ?? "";
  let url = input.url ?? "";
  let size = 0;
  let robots: boolean | null = null;
  let sitemap: boolean | null = null;
  if (!html && url) {
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    const page = await get(url);
    if (!page.ok) throw new Error(`Could not fetch ${url} (status ${page.status || "network error"}). Paste the page HTML instead.`);
    html = page.text;
    const origin = new URL(url).origin;
    robots = (await get(origin + "/robots.txt", 4000)).ok;
    sitemap = (await get(origin + "/sitemap.xml", 4000)).ok;
  }
  if (!html) throw new Error("Provide a url or html");
  size = Buffer.byteLength(html);
  const $ = cheerio.load(html);
  const title = $("title").first().text().trim() || undefined;
  const description = $('meta[name="description"]').attr("content")?.trim() || undefined;
  const h1s = $("h1").map((_, e) => $(e).text().trim()).get().filter(Boolean);
  const imgs = $("img");
  const withAlt = imgs.filter((_, e) => !!($(e).attr("alt") ?? "").trim()).length;
  const ld = $('script[type="application/ld+json"]').map((_, e) => $(e).text()).get().join(" ");
  const bodyText = $("body").text().replace(/\s+/g, " ");
  const host = url ? safeHost(url) : "";
  const links = $("a[href]").filter((_, e) => {
    const h = $(e).attr("href") || "";
    if (!h || h.startsWith("#") || /^(mailto|tel|javascript):/i.test(h)) return false;
    return !/^(https?:)?\/\//i.test(h) || (!!host && h.includes(host));
  }).length;
  const locMatch = /\b(?:in|serving|near)\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)(?:,\s*([A-Z]{2}))?/.exec(bodyText);
  const locationGuess = locMatch ? (locMatch[2] ? `${locMatch[1]}, ${locMatch[2]}` : locMatch[1]) : undefined;
  const hasLocation = !!locMatch || /\b[A-Z][a-z]+,\s[A-Z]{2}\b/.test(bodyText);
  const svcWords = ["plumbing", "repair", "installation", "cleaning", "maintenance", "emergency", "drain", "heating", "cooling", "roofing", "electrical", "landscaping", "painting", "inspection", "replacement"];
  const servicesGuess = svcWords.filter((w) => new RegExp(`\\b${w}`, "i").test(bodyText));
  const headingServices = $("h2,h3").filter((_, e) => /service|repair|install|clean/i.test($(e).text())).length;
  const nameGuess = (ld && /"name"\s*:\s*"([^"]+)"/.exec(ld)?.[1]) || title?.split(/[|\-–:]/).pop()?.trim() || undefined;

  const C = (id: string, label: string, passed: boolean, detail: string, weight: number): AuditCheck => ({ id, label, passed, detail, weight });
  const checks: AuditCheck[] = [
    C("title", "Title tag (10-65 chars)", !!title && title.length >= 10 && title.length <= 65, title ? `"${title}" (${title.length} chars)` : "No <title> found", 10),
    C("meta", "Meta description (70-170 chars)", !!description && description.length >= 70 && description.length <= 170, description ? `${description.length} chars` : "No meta description", 10),
    C("h1", "Exactly one H1", h1s.length === 1, `${h1s.length} H1 tag(s) found`, 8),
    C("viewport", "Viewport meta tag", $('meta[name="viewport"]').length > 0, $('meta[name="viewport"]').length ? "Present" : "Missing (not mobile-friendly)", 8),
    C("alt", "Image alt text coverage", imgs.length === 0 || withAlt / imgs.length >= 0.8, imgs.length ? `${withAlt}/${imgs.length} images have alt text` : "No images", 8),
    C("jsonld", "LocalBusiness JSON-LD", /LocalBusiness|Plumber|Electrician|HVACBusiness|Store|Restaurant|ProfessionalService|HomeAndConstructionBusiness/.test(ld), ld ? "Structured data found" : "No JSON-LD found", 14),
    C("canonical", "Canonical link", $('link[rel="canonical"]').length > 0, $('link[rel="canonical"]').length ? "Present" : "Missing", 5),
    C("location", "Mentions a location", hasLocation, locationGuess ? `Found: ${locationGuess}` : "No city/region detected in the text", 12),
    C("services", "Names its services", servicesGuess.length >= 2 || headingServices > 0, servicesGuess.length ? `Terms: ${servicesGuess.slice(0, 5).join(", ")}` : "No service terms detected", 10),
    C("links", "Internal links (3+)", links >= 3, `${links} internal link(s)`, 6),
    C("robots", "robots.txt present", robots === null ? false : robots, robots === null ? "Not checked (HTML pasted); assumed missing" : robots ? "Found" : "Not found", 4),
    C("sitemap", "sitemap.xml present", sitemap === null ? false : sitemap, sitemap === null ? "Not checked (HTML pasted); assumed missing" : sitemap ? "Found" : "Not found", 5),
    C("size", "Page size under 500 KB", size < 500_000, `${Math.round(size / 1024)} KB`, 4),
  ];
  const total = checks.reduce((a, c) => a + c.weight, 0);
  const score = Math.round((checks.filter((c) => c.passed).reduce((a, c) => a + c.weight, 0) / total) * 100);
  const writer = await generateJSON({
    name: "audit_writer",
    system: SYSTEM,
    prompt: auditPrompt({ checks, score, title, description }),
    schema: AuditWriterSchema,
    input: { checks, score, title, description },
  });
  return {
    url: url || "(pasted HTML)",
    fetchedAt: new Date().toISOString(),
    score,
    checks,
    summary: writer.summary,
    fixes: writer.fixes,
    extracted: { title, description, h1s, businessNameGuess: nameGuess, locationGuess, servicesGuess },
  };
}

function safeHost(u: string) {
  try {
    return new URL(/^https?:/i.test(u) ? u : "https://" + u).host;
  } catch {
    return "";
  }
}
