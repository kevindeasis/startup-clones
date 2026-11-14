/* Hutch tracker: cookieless, no localStorage, no fingerprinting. */
(function () {
  "use strict";
  var script = document.currentScript || document.querySelector("script[data-site][src*='track.js']");
  if (!script) return;
  var site = script.getAttribute("data-site");
  if (!site) return;
  var origin;
  try { origin = new URL(script.src).origin; } catch (e) { origin = location.origin; }
  var endpoint = script.getAttribute("data-endpoint") || origin + "/api/collect";
  var dnt = navigator.doNotTrack === "1" || window.doNotTrack === "1";

  // Always expose the API so calls to hutch.track never throw, even when tracking is off.
  window.hutch = { track: function (name, props) { send({ type: "event", name: String(name), props: props }); } };
  if (dnt) return;

  function utm() {
    var q;
    try { q = new URLSearchParams(location.search); } catch (e) { return undefined; }
    var u = { source: q.get("utm_source"), medium: q.get("utm_medium"), campaign: q.get("utm_campaign") };
    return u.source || u.medium || u.campaign ? u : undefined;
  }

  function send(partial) {
    var payload = {
      site: site,
      type: partial.type,
      name: partial.name,
      path: location.pathname,
      referrer: partial.referrer,
      screen_w: window.screen && window.screen.width ? window.screen.width : undefined,
      props: partial.props,
      value: partial.value,
      utm: partial.type === "pageview" && partial.referrer !== undefined ? utm() : undefined,
    };
    var body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }))) return;
    } catch (e) { /* fall through to fetch */ }
    try {
      fetch(endpoint, { method: "POST", body: body, keepalive: true, headers: { "content-type": "application/json" } }).catch(function () {});
    } catch (e) { /* tracking must never break the page */ }
  }

  // Pageviews, including SPA navigations. The referrer is only sent for the first view of a visit.
  var lastPath = null;
  var first = true;
  function pageview() {
    var path = location.pathname + location.search;
    if (path === lastPath) return;
    lastPath = path;
    send({ type: "pageview", referrer: first ? document.referrer || "" : undefined });
    first = false;
  }

  ["pushState", "replaceState"].forEach(function (method) {
    var original = history[method];
    history[method] = function () {
      var result = original.apply(this, arguments);
      pageview();
      return result;
    };
  });
  window.addEventListener("popstate", pageview);

  // JS errors
  function reportError(message, stack) {
    send({ type: "error", name: String(message || "Unknown error").slice(0, 200), props: { stack: String(stack || "").slice(0, 500) } });
  }
  window.addEventListener("error", function (e) {
    reportError(e.message, e.error && e.error.stack);
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    reportError(r && r.message ? r.message : r, r && r.stack);
  });

  // Web Vitals: LCP, sent once when the page is hidden.
  var lcp = null;
  var lcpSent = false;
  try {
    new PerformanceObserver(function (list) {
      var entries = list.getEntries();
      if (entries.length) lcp = entries[entries.length - 1].startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch (e) { /* unsupported browser */ }
  function flushVitals() {
    if (lcpSent || lcp === null) return;
    lcpSent = true;
    send({ type: "vital", name: "LCP", value: Math.round(lcp) });
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flushVitals();
  });
  window.addEventListener("pagehide", flushVitals);

  pageview();
})();
