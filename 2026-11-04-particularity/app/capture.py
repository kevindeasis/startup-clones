"""Playwright capture: screenshot, HTML, extracted text, hashes, timer re-check."""
import asyncio
import hashlib
import re
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse

from . import db

TIMER_RE = re.compile(r"\b\d{1,2}:\d{2}\b")
STOCK_RE = re.compile(r"only \d+ left[^\n.!]*", re.I)
PRICE_RE = re.compile(r"\$\d[\d,]*(?:\.\d{2})?")
TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def extract_meta(text: str, html: str) -> dict:
    m = TITLE_RE.search(html)
    return {
        "title": re.sub(r"\s+", " ", m.group(1)).strip() if m else "",
        "timers": TIMER_RE.findall(text),
        "stock": [s.strip() for s in STOCK_RE.findall(text)],
        "prices": PRICE_RE.findall(text),
    }


def extract_text(html: str, body_text: str) -> str:
    """trafilatura main text; fall back to body inner_text when it is empty or drops
    price / timer strings that are visible on the page (short commerce pages often lose them)."""
    main = ""
    try:
        import trafilatura
        main = trafilatura.extract(html, include_comments=False) or ""
    except Exception:
        main = ""
    if len(main) < 40:
        return body_text
    needed = set(PRICE_RE.findall(body_text)) | set(TIMER_RE.findall(body_text))
    if any(tok not in main for tok in needed):
        return body_text
    return main


async def capture_page(context, url: str, kind: str, case_id: int, sample_seconds: float = 0) -> dict:
    page = await context.new_page()
    try:
        try:
            await page.goto(url, wait_until="networkidle", timeout=20000)
        except Exception:
            await page.goto(url, wait_until="load", timeout=20000)
        captured_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        png = await page.screenshot(full_page=True)
        html = await page.content()
        body_text = await page.inner_text("body")
        samples = []
        if sample_seconds:
            # Keep the SAME page open and sample timer/stock text about once per second.
            loop = asyncio.get_running_loop()
            t0 = loop.time()
            samples.append(_sample(0.0, body_text))
            while loop.time() - t0 < sample_seconds:
                await asyncio.sleep(1)
                samples.append(_sample(round(loop.time() - t0, 1), await page.inner_text("body")))
    finally:
        await page.close()
    text = extract_text(html, body_text)
    out = db.evidence_dir() / f"case_{case_id}"
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{kind}.png").write_bytes(png)
    html_bytes = html.encode("utf-8")
    (out / f"{kind}.html").write_bytes(html_bytes)
    meta = extract_meta(text, html)
    links = re.findall(r'href="([^"#]*terms[^"]*)"', html, re.I)
    if samples:
        meta["timer_samples"] = samples
    meta["terms_links"] = [urljoin(url, l) for l in links]
    return {
        "kind": kind, "url": url, "captured_at": captured_at,
        "html_path": f"case_{case_id}/{kind}.html", "html_sha256": sha256(html_bytes),
        "screenshot_path": f"case_{case_id}/{kind}.png", "screenshot_sha256": sha256(png),
        "text_excerpt": text[:4000], "meta": meta,
    }


def _sample(t: float, text: str) -> dict:
    return {"t": t, "timers": TIMER_RE.findall(text), "stock": [x.strip() for x in STOCK_RE.findall(text)]}


def seconds(timer: str) -> int:
    m, s = timer.split(":")
    return int(m) * 60 + int(s)


async def capture_case(case_id: int, target_url: str, checkout_url=None, cancel_url=None,
                       sample_seconds: float = 7.0) -> list[dict]:
    """Capture landing (kept open ~7s, sampling timers each second), landing_recheck (fresh reload afterwards), checkout, cancel and (if linked from landing) terms.
    Landing failure raises; other failures are recorded as notes and skipped."""
    from playwright.async_api import async_playwright
    evidence: list[dict] = []
    errors: list[str] = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, args=["--no-sandbox"])
        try:
            ctx = await browser.new_context(viewport={"width": 1280, "height": 900})
            landing = await capture_page(ctx, target_url, "landing", case_id, sample_seconds)
            evidence.append(landing)
            try:
                evidence.append(await capture_page(ctx, target_url, "landing_recheck", case_id))
            except Exception as e:
                errors.append(f"landing_recheck: {e}")
            same_host = urlparse(target_url).netloc
            plan = [("checkout", checkout_url), ("cancel", cancel_url)]
            terms = next((l for l in landing["meta"].get("terms_links", [])
                          if urlparse(l).netloc == same_host and l.startswith("http")), None)
            plan.append(("terms", terms))
            for kind, url in plan:
                if not url:
                    continue
                try:
                    evidence.append(await capture_page(ctx, url, kind, case_id))
                except Exception as e:
                    errors.append(f"{kind}: {e}")
        finally:
            await browser.close()
    if errors:
        evidence[0]["meta"]["capture_errors"] = errors
    return evidence
