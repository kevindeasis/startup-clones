import * as cheerio from "cheerio";

const BLOCK_SEL = "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,table,figure,img,section,article,div,svg";
const CONTAINER_SEL = "section,article,div";

function hasDirectText($: cheerio.CheerioAPI, el: any): boolean {
  return $(el).contents().toArray().some((n: any) => n.type === "text" && n.data.trim().length > 0);
}

/** Assign data-block ids to elements lacking one, continuing from the max existing id. */
export function assignBlockIds(html: string): string {
  const $ = cheerio.load(html);
  let max = 0;
  $("[data-block]").each((_, el) => {
    const m = /^b(\d+)$/.exec($(el).attr("data-block") || "");
    if (m) max = Math.max(max, Number(m[1]));
  });
  $(BLOCK_SEL).each((_, el) => {
    const $el = $(el);
    if ($el.attr("data-block")) return;
    const tag = (el as any).tagName;
    if ($el.closest("svg").length && tag !== "svg") return;
    if (tag !== "svg" && $el.parents("pre,table,figure").length) return; // nested inside an atomic block
    if (tag === "li" || /^(h\d|p|blockquote|pre|table|figure|img|svg)$/.test(tag)) {
      // ok
    } else if (CONTAINER_SEL.includes(tag)) {
      const hasChildEl = $el.children().length > 0;
      if (!(hasDirectText($, el) || !hasChildEl)) return;
    }
    $el.attr("data-block", "b" + ++max);
  });
  return $.html();
}

export function extractText(html: string): string {
  const $ = cheerio.load(html);
  $("script,style,noscript").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

export function blockText(html: string, block: string | null): string {
  const $ = cheerio.load(html);
  const el = block ? $(`[data-block="${block}"]`).first() : $("body");
  el.find("script,style").remove();
  return el.text().replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

export function hasBlock(html: string, block: string): boolean {
  const $ = cheerio.load(html);
  return $(`[data-block="${block}"]`).length > 0;
}

export function getBlockHtml(html: string, block: string | null): string {
  const $ = cheerio.load(html);
  if (!block) return $("body").html() || "";
  return $.html($(`[data-block="${block}"]`).first());
}

export function surroundingText(html: string, block: string | null, size = 1500): string {
  const full = extractText(html);
  if (!block) return full.slice(0, size);
  const t = blockText(html, block).replace(/\s+/g, " ");
  const idx = full.indexOf(t.slice(0, 40));
  if (idx < 0) return full.slice(0, size);
  const start = Math.max(0, idx - Math.floor(size / 2));
  return full.slice(start, start + size);
}

/** Replace the target block (or body inner html) with replacement; keeps data-block. */
export function replaceBlock(html: string, block: string | null, replacement: string): string {
  const $ = cheerio.load(html);
  if (!block) {
    $("body").html(replacement);
    return $.html();
  }
  const target = $(`[data-block="${block}"]`).first();
  const frag = cheerio.load(replacement, null, false);
  const root = frag.root().children().first();
  if (!root.length) throw new Error("replacement is empty");
  if (root.attr("data-block") !== block) root.attr("data-block", block);
  target.replaceWith(frag.html(root));
  return $.html();
}
