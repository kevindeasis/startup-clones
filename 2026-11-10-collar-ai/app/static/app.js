async function api(path, opts) {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || r.statusText);
  return j;
}
const post = (p, body) => api(p, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
function renderAnswer(r) {
  let h = `<div class="card"><p><b>${esc(r.answer)}</b></p><p class="muted">Confidence: ${esc(r.confidence)}</p>`;
  (r.citations || []).forEach(c => h += `<div class="q"><span class="tag">chunk ${c.chunk_id}</span> ${esc(c.doc)}<br><i>"${esc(c.quote)}"</i></div>`);
  (r.warnings || []).forEach(w => h += `<p class="warn">Warning: ${esc(w)}</p>`);
  (r.disclosure_risk || []).forEach(w => h += `<p class="warn">Disclosure risk: ${esc(w)}</p>`);
  if ((r.follow_ups || []).length) h += `<p class="muted">Likely follow-ups: ${r.follow_ups.map(esc).join("; ")}</p>`;
  return h + "</div>";
}
