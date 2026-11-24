import type { Page, Section, Site } from "./schema";
import { esc } from "./util";

const fontUrl = (f: string) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;600;700`;

function md(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function section(s: Section, base: string): string {
  const href = (h: string) => (h.startsWith("/") ? base + (h === "/" ? "" : h) : h);
  switch (s.type) {
    case "hero":
      return `<section class="hero"><div class="wrap"><h2 class="hero-h">${esc(s.headline)}</h2><p class="lead">${esc(s.subheadline)}</p><a class="btn" href="${esc(href(s.ctaHref))}">${esc(s.ctaLabel)}</a></div></section>`;
    case "services":
      return `<section class="sec"><div class="wrap"><h2>${esc(s.heading)}</h2><div class="grid">${s.items.map((i) => `<a class="card" href="${esc(href(i.href))}"><h3>${esc(i.name)}</h3><p>${esc(i.blurb)}</p></a>`).join("")}</div></div></section>`;
    case "about":
      return `<section class="sec"><div class="wrap"><h2>${esc(s.heading)}</h2>${md(s.body)}</div></section>`;
    case "text":
      return `<section class="sec"><div class="wrap">${s.heading ? `<h2>${esc(s.heading)}</h2>` : ""}${md(s.body)}</div></section>`;
    case "faq":
      return `<section class="sec"><div class="wrap"><h2>${esc(s.heading)}</h2>${s.items.map((i) => `<details><summary>${esc(i.q)}</summary><p>${esc(i.a)}</p></details>`).join("")}</div></section>`;
    case "cta":
      return `<section class="cta"><div class="wrap"><h2>${esc(s.heading)}</h2>${s.body ? `<p>${esc(s.body)}</p>` : ""}<a class="btn alt" href="${esc(href(s.ctaHref))}">${esc(s.ctaLabel)}</a></div></section>`;
    case "contact":
      return `<section class="sec"><div class="wrap"><h2>${esc(s.heading)}</h2><ul class="contact">${s.phone ? `<li>Phone: <a href="tel:${esc(s.phone)}">${esc(s.phone)}</a></li>` : ""}${s.email ? `<li>Email: <a href="mailto:${esc(s.email)}">${esc(s.email)}</a></li>` : ""}${s.address ? `<li>Location: ${esc(s.address)}</li>` : ""}${s.hours ? `<li>Hours: ${esc(s.hours)}</li>` : ""}</ul>${s.mapQuery ? `<p><a href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(s.mapQuery)}" rel="noopener">View on map</a></p>` : ""}</div></section>`;
    case "serviceArea":
      return `<section class="sec"><div class="wrap"><h2>${esc(s.heading)}</h2><ul class="areas">${s.areas.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div></section>`;
  }
}

export function publishedPages(site: Site): Page[] {
  return site.pages; // pages only enter site.pages when published
}

export function pageUrl(site: Site, p: Page, origin = ""): string {
  return `${origin}/s/${site.slug}${p.path === "/" ? "" : p.path}`;
}

export function jsonLd(site: Site, origin = ""): object {
  const b = site.business;
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: b.name,
    description: b.description ?? `${b.industry} in ${b.city}, ${b.region}`,
    url: `${origin}/s/${site.slug}`,
    ...(b.phone ? { telephone: b.phone } : {}),
    ...(b.email ? { email: b.email } : {}),
    address: { "@type": "PostalAddress", addressLocality: b.city, addressRegion: b.region, ...(b.country ? { addressCountry: b.country } : {}) },
    areaServed: b.city,
    ...(b.hours ? { openingHours: b.hours } : {}),
    makesOffer: b.services.map((s) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: s } })),
  };
}

export function renderPage(site: Site, page: Page, origin = "", opts: { base?: string; staticMode?: boolean } = {}): string {
  const d = site.design.palette;
  const base = opts.base ?? `/s/${site.slug}`;
  const nav = site.pages.filter((p) => ["home", "about", "contact"].includes(p.type) || p.type === "service").slice(0, 8);
  const depth0 = page.path === "/" ? 0 : page.path.split("/").filter(Boolean).length;
  const up0 = "../".repeat(depth0) || "./";
  const link = (p: Page) => (opts.staticMode ? up0 + (p.path === "/" ? "index.html" : `${p.path.slice(1)}/index.html`) : base + (p.path === "/" ? "" : p.path));
  const canonical = `${origin}/s/${site.slug}${page.path === "/" ? "" : page.path}`;
  let body = page.sections.map((s) => section(s, base)).join("\n");
  if (opts.staticMode) {
    const depth = page.path === "/" ? 0 : page.path.split("/").filter(Boolean).length;
    const up = "../".repeat(depth) || "./";
    body = body.replace(new RegExp(`href="${base.replace(/[/.]/g, "\\$&")}(/[^"]*)?"`, "g"), (_m, p) => `href="${up}${p ? p.slice(1) + "/" : ""}index.html"`);
  }
  const hasHero = page.sections.some((s) => s.type === "hero");
  const h1 = hasHero ? "" : `<div class="wrap"><h1 class="h1">${esc(page.h1)}</h1></div>`;
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.metaDescription)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(page.title)}"><meta property="og:description" content="${esc(page.metaDescription)}"><meta property="og:url" content="${esc(canonical)}"><meta property="og:site_name" content="${esc(site.business.name)}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fontUrl(site.design.headingFont)}&${fontUrl(site.design.bodyFont)}&display=swap">
<script type="application/ld+json">${JSON.stringify(jsonLd(site, origin)).replace(/</g, "\\u003c")}</script>
<style>
:root{--primary:${esc(d.primary)};--accent:${esc(d.accent)};--bg:${esc(d.background)};--text:${esc(d.text)}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:'${esc(site.design.bodyFont)}',system-ui,sans-serif;line-height:1.6}
h1,h2,h3{font-family:'${esc(site.design.headingFont)}',Georgia,serif;line-height:1.2}
.wrap{max-width:960px;margin:0 auto;padding:0 20px}
header.top{border-bottom:1px solid color-mix(in srgb,var(--text) 15%,transparent)}header.top .wrap{display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:14px 20px}
.brand{font-weight:700;font-size:1.2rem;color:var(--primary);text-decoration:none;font-family:'${esc(site.design.headingFont)}',serif}
nav a{margin-right:14px;color:var(--text);text-decoration:none;font-size:.95rem}nav a:hover{color:var(--primary)}
.hero{background:var(--primary);color:#fff;padding:64px 0}.hero-h{font-size:2.4rem;margin:0 0 12px;color:#fff}.lead{font-size:1.2rem;max-width:640px}
.btn{display:inline-block;background:var(--accent);color:#111;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700}
.sec{padding:40px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
.card{display:block;padding:18px;border:1px solid color-mix(in srgb,var(--text) 18%,transparent);border-radius:10px;text-decoration:none;color:inherit}.card:hover{border-color:var(--primary)}
.cta{background:color-mix(in srgb,var(--primary) 12%,var(--bg));padding:40px 0;text-align:center}
details{border-bottom:1px solid color-mix(in srgb,var(--text) 15%,transparent);padding:10px 0}summary{cursor:pointer;font-weight:600}
.areas{display:flex;gap:10px;flex-wrap:wrap;padding:0;list-style:none}.areas li{background:color-mix(in srgb,var(--primary) 12%,var(--bg));padding:4px 12px;border-radius:99px}
.contact{list-style:none;padding:0}a{color:var(--primary)}.hero a.btn,.cta a.btn{color:#111}
footer{border-top:1px solid color-mix(in srgb,var(--text) 15%,transparent);padding:24px 0;font-size:.9rem}.h1{margin:28px 0 0}
</style></head><body>
<header class="top"><div class="wrap"><a class="brand" href="${esc(link(site.pages[0]))}">${esc(site.business.name)}</a><nav>${nav.map((p) => `<a href="${esc(link(p))}">${esc(p.type === "home" ? "Home" : p.type === "service" ? p.h1.replace(/ in .*$/, "") : p.type === "about" ? "About" : "Contact")}</a>`).join("")}</nav></div></header>
<main>${h1}${body}</main>
<footer><div class="wrap">&copy; ${new Date().getFullYear()} ${esc(site.business.name)} &middot; ${esc(site.business.city)}, ${esc(site.business.region)}${site.business.phone ? ` &middot; ${esc(site.business.phone)}` : ""}</div></footer>
</body></html>`;
  return html;
}

export function sitemapXml(site: Site, origin = ""): string {
  const urls = site.pages.map((p) => `  <url><loc>${esc(pageUrl(site, p, origin))}</loc><lastmod>${esc((p.publishedAt || site.updatedAt).slice(0, 10))}</lastmod></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function robotsTxt(site: Site, origin = ""): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${origin}/s/${site.slug}/sitemap.xml\n`;
}
