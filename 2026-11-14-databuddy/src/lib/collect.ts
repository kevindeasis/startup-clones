import { z } from "zod";
import { getDb } from "./db";
import { getSite } from "./repo";
import { parseUa } from "./ua";
import { pickSession, visitorId } from "./visitor";

const short = (max: number) => z.string().max(max).nullish();

export const CollectEventSchema = z.object({
  site: z.string().min(1).max(64),
  type: z.enum(["pageview", "event", "error", "vital"]).default("pageview"),
  name: short(300),
  path: short(500),
  referrer: short(1000),
  screen_w: z.number().int().min(0).max(100000).nullish(),
  props: z.record(z.string(), z.unknown()).nullish(),
  value: z.number().finite().nullish(),
  utm: z.object({ source: short(200), medium: short(200), campaign: short(200) }).nullish(),
});
export const CollectBodySchema = z.union([CollectEventSchema, z.array(CollectEventSchema).min(1).max(25)]);
export type CollectEvent = z.infer<typeof CollectEventSchema>;

export type RequestContext = { ip: string; userAgent: string; country: string; now?: Date };

export function hostOf(referrer: string | null | undefined): string {
  if (!referrer) return "";
  try {
    return new URL(referrer).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Inserts the events. Returns the number stored, or null when a site is unknown. */
export function ingest(events: CollectEvent[], ctx: RequestContext): number | null {
  const now = ctx.now ?? new Date();
  const db = getDb();
  const ua = parseUa(ctx.userAgent);
  const lastEvent = db.prepare(
    "SELECT session_id, ts FROM events WHERE site_id = ? AND visitor_id = ? ORDER BY ts DESC LIMIT 1",
  );
  const insert = db.prepare(`INSERT INTO events
    (site_id, ts, type, name, path, referrer, referrer_host, utm_source, utm_medium, utm_campaign,
     country, browser, os, device, screen_w, visitor_id, session_id, props, value)
    VALUES (@site_id, @ts, @type, @name, @path, @referrer, @referrer_host, @utm_source, @utm_medium, @utm_campaign,
     @country, @browser, @os, @device, @screen_w, @visitor_id, @session_id, @props, @value)`);

  const sites = new Map<string, string>();
  for (const e of events) {
    const site = getSite(e.site);
    if (!site) return null;
    sites.set(e.site, site.domain);
  }

  db.transaction(() => {
    for (const e of events) {
      const visitor = visitorId(e.site, ctx.ip, ctx.userAgent, now);
      const last = lastEvent.get(e.site, visitor) as { session_id: string; ts: string } | undefined;
      const host = hostOf(e.referrer);
      insert.run({
        site_id: e.site,
        ts: now.toISOString(),
        type: e.type,
        name: e.name ?? null,
        path: e.path ?? "/",
        referrer: e.referrer ?? null,
        referrer_host: host === sites.get(e.site) ? "" : host,
        utm_source: e.utm?.source ?? null,
        utm_medium: e.utm?.medium ?? null,
        utm_campaign: e.utm?.campaign ?? null,
        country: ctx.country,
        browser: ua.browser,
        os: ua.os,
        device: ua.device,
        screen_w: e.screen_w ?? null,
        visitor_id: visitor,
        session_id: pickSession(visitor, last, now.getTime()),
        props: e.props ? JSON.stringify(e.props) : null,
        value: e.value ?? null,
      });
    }
  })();
  return events.length;
}
