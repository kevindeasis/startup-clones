import type { Business, DesignDirection, Page, Section } from "../schema";
import { slugify, titleCase } from "../util";

const today = () => new Date().toISOString();
const loc = (b: Business) => `${b.city}, ${b.region}`;

export function directionsFor(b: Business): DesignDirection[] {
  const seed = [...b.name].reduce((a, c) => a + c.charCodeAt(0), 0);
  const hues = [seed % 360, (seed + 120) % 360, (seed + 240) % 360];
  const hsl = (h: number, s: number, l: number) => {
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const c = l / 100 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * c).toString(16).padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };
  const defs = [
    { id: "dir_trusted", name: "Trusted Local", vibe: `Warm, reliable and neighborly, the ${b.industry} you can call today`, fonts: ["Merriweather", "Inter"], bg: "#ffffff", text: "#1b2430", s: 55, l: 32, notes: "Big hero with phone CTA, service cards, short about strip, FAQ near the bottom." },
    { id: "dir_modern", name: "Clean Modern", vibe: `Crisp, minimal and fast for ${b.city} homeowners`, fonts: ["Poppins", "Inter"], bg: "#f7f8fa", text: "#10151c", s: 70, l: 45, notes: "Generous whitespace, left-aligned hero, three-column services, sticky call button." },
    { id: "dir_bold", name: "Bold Workshop", vibe: `Confident, high-contrast, work-boots-on energy`, fonts: ["Oswald", "Source Sans 3"], bg: "#14171c", text: "#f2f4f7", s: 80, l: 55, notes: "Dark theme, oversized headings, accent-colored buttons, service area list in footer." },
  ];
  return defs.map((d, i) => ({
    id: d.id,
    name: d.name,
    vibe: d.vibe,
    palette: { primary: hsl(hues[i], d.s, d.l), accent: hsl((hues[i] + 40) % 360, 85, 52), background: d.bg, text: d.text },
    headingFont: d.fonts[0],
    bodyFont: d.fonts[1],
    layoutNotes: d.notes,
  }));
}

export function servicePage(b: Business, service: string, idSuffix = ""): Page {
  const s = titleCase(service);
  const slug = slugify(service);
  return {
    id: `p_svc_${slug}${idSuffix}`,
    path: `/services/${slug}`,
    type: "service",
    title: `${s} in ${b.city}, ${b.region} | ${b.name}`,
    metaDescription: `${b.name} provides ${service.toLowerCase()} for homes and businesses in ${b.city}, ${b.region}. Call${b.phone ? ` ${b.phone}` : ""} for a clear quote.`.slice(0, 160),
    h1: `${s} in ${b.city}`,
    targetKeyword: `${service.toLowerCase()} ${b.city.toLowerCase()}`,
    publishedAt: today(),
    sections: [
      { type: "hero", headline: `${s} in ${b.city}, ${b.region}`, subheadline: `${b.name} handles ${service.toLowerCase()} with clear pricing and respectful, on-time service.`, ctaLabel: "Request a quote", ctaHref: "/contact" },
      { type: "text", heading: `What our ${service.toLowerCase()} service includes`, body: `When you call ${b.name} about ${service.toLowerCase()}, we look at the problem first, explain your options in plain language, and give you a quote before any work begins.\n\nWe serve ${loc(b)} and nearby neighborhoods. ${b.tone ? `Our approach is ${b.tone.toLowerCase()}.` : "We keep things simple and honest."}` },
      { type: "cta", heading: `Need ${service.toLowerCase()} in ${b.city}?`, body: b.phone ? `Call ${b.phone} or send us a message.` : "Send us a message and we will get back to you.", ctaLabel: "Contact us", ctaHref: "/contact" },
    ],
  };
}

export function faqFor(b: Business) {
  const first = b.services[0]?.toLowerCase() ?? b.industry.toLowerCase();
  return [
    { q: `What areas does ${b.name} serve?`, a: `We serve ${b.city}, ${b.region} and surrounding communities. Call or send a message to confirm your address.` },
    { q: `What services do you offer?`, a: `We offer ${b.services.map((s) => s.toLowerCase()).join(", ")}.` },
    { q: `How do I get a quote for ${first}?`, a: `Contact us by ${b.phone ? "phone" : "the contact form"} or email with a short description of the job and we will follow up with a quote.` },
    { q: `What are your hours?`, a: b.hours ? b.hours : "Contact us to confirm current hours of availability." },
    { q: `Are you licensed and insured?`, a: `Please ask us directly for current licensing and insurance details for your ${b.industry.toLowerCase()} job.` },
  ];
}

export function buildPages(b: Business, d: DesignDirection): Page[] {
  const L = loc(b);
  const servicesSection: Section = {
    type: "services",
    heading: `${titleCase(b.industry)} services in ${b.city}`,
    items: b.services.map((s) => ({ name: titleCase(s), blurb: `Professional ${s.toLowerCase()} for ${b.city} customers.`, href: `/services/${slugify(s)}` })),
  };
  const home: Page = {
    id: "p_home",
    path: "/",
    type: "home",
    title: `${b.name} | ${titleCase(b.industry)} in ${L}`,
    metaDescription: `${b.name} is a ${b.industry.toLowerCase()} serving ${L}. ${b.services.slice(0, 3).map((s) => titleCase(s)).join(", ")} and more. Get in touch today.`.slice(0, 160),
    h1: `${titleCase(b.industry)} in ${b.city}, ${b.region}`,
    publishedAt: today(),
    sections: [
      { type: "hero", headline: `${b.name}: ${titleCase(b.industry)} in ${b.city}`, subheadline: b.description || `Dependable ${b.services.slice(0, 2).map((s) => s.toLowerCase()).join(" and ")} for ${b.city} homes and businesses.`, ctaLabel: b.phone ? `Call ${b.phone}` : "Get a quote", ctaHref: b.phone ? `tel:${b.phone}` : "/contact" },
      servicesSection,
      { type: "about", heading: `About ${b.name}`, body: `${b.name} is a local ${b.industry.toLowerCase()} based in ${L}. ${b.description ?? `We focus on ${b.services.map((s) => s.toLowerCase()).join(", ")}.`}` },
      { type: "serviceArea", heading: "Where we work", areas: [b.city, `Greater ${b.city} area`] },
      { type: "faq", heading: "Frequently asked questions", items: faqFor(b) },
      { type: "cta", heading: `Ready to talk to ${b.name}?`, body: "Tell us about your project and we will respond promptly.", ctaLabel: "Contact us", ctaHref: "/contact" },
    ],
  };
  const about: Page = {
    id: "p_about",
    path: "/about",
    type: "about",
    title: `About ${b.name} | ${b.industry} in ${b.city}`,
    metaDescription: `Learn about ${b.name}, a local ${b.industry.toLowerCase()} serving ${L}.`,
    h1: `About ${b.name}`,
    publishedAt: today(),
    sections: [
      { type: "about", heading: `Who we are`, body: `${b.name} serves ${L} with ${b.services.map((s) => s.toLowerCase()).join(", ")}.\n\n${b.description ?? "We believe in clear communication, fair quotes and work that lasts."}` },
      { type: "serviceArea", heading: "Service area", areas: [b.city, `Greater ${b.city} area`] },
      { type: "cta", heading: "Let us help with your next job", ctaLabel: "Contact us", ctaHref: "/contact" },
    ],
  };
  const contact: Page = {
    id: "p_contact",
    path: "/contact",
    type: "contact",
    title: `Contact ${b.name} | ${b.city}, ${b.region}`,
    metaDescription: `Contact ${b.name} in ${L}${b.phone ? ` at ${b.phone}` : ""} for a quote.`.slice(0, 160),
    h1: `Contact ${b.name}`,
    publishedAt: today(),
    sections: [{ type: "contact", heading: "Get in touch", phone: b.phone, email: b.email, address: L, hours: b.hours, mapQuery: `${b.name} ${L}` }],
  };
  return [home, about, ...b.services.map((s) => servicePage(b, s)), contact];
}
