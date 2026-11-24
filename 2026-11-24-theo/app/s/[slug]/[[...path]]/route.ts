import { findBySlug } from "@/lib/store";
import { renderPage, robotsTxt, sitemapXml } from "@/lib/render";
export const dynamic = "force-dynamic";

const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

export async function GET(req: Request, { params }: { params: Promise<{ slug: string; path?: string[] }> }) {
  const { slug, path = [] } = await params;
  const site = await findBySlug(slug);
  if (!site) return html("<h1>Site not found</h1>", 404);
  const origin = new URL(req.url).origin;
  const rel = "/" + path.join("/");
  if (rel === "/sitemap.xml") return new Response(sitemapXml(site, origin), { headers: { "content-type": "application/xml" } });
  if (rel === "/robots.txt") return new Response(robotsTxt(site, origin), { headers: { "content-type": "text/plain" } });
  const page = site.pages.find((p) => p.path === rel.toLowerCase());
  if (!page) return html(`<!doctype html><title>Not found</title><h1>Page not found</h1><p><a href="/s/${slug}">Back to home</a></p>`, 404);
  return html(renderPage(site, page, origin));
}
