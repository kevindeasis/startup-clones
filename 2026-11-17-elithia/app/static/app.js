async function api(method, url, body) {
  const opt = {method, headers: {}};
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  if (!r.ok) { let m = r.statusText; try { m = (await r.json()).detail || m; } catch (e) {} alert('Error: ' + (typeof m === 'string' ? m : JSON.stringify(m))); throw new Error(m); }
  return r.json();
}
const $ = (s) => document.querySelector(s);
const caseId = () => ($('.actions') || {dataset: {}}).dataset.case;

// ---- new case
const nc = $('#new-case');
if (nc) nc.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const r = await api('POST', '/cases', new FormData(nc));
  location.href = '/cases/' + r.id;
});

// ---- upload / sample
const up = $('#upload-form');
if (up) up.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  await api('POST', `/cases/${up.dataset.case}/files`, new FormData(up));
  location.reload();
});
const sb = $('#sample-btn');
if (sb) sb.addEventListener('click', async () => { await api('POST', `/cases/${caseId()}/sample`); location.reload(); });

// ---- pipeline buttons with progress polling
async function runStage(path) {
  await api('POST', `/cases/${caseId()}/${path}`);
  const box = $('#progress'); box.classList.remove('hidden');
  const timer = setInterval(async () => {
    const s = await (await fetch(`/cases/${caseId()}/status`)).json();
    const pct = s.total ? Math.round(100 * s.done / s.total) : 5;
    $('#bar').style.width = pct + '%';
    $('#progress-msg').textContent = `${s.stage}: ${s.message} (${s.done}/${s.total})`;
    if (s.stage === 'idle' || s.stage === 'error') {
      clearInterval(timer);
      if (s.stage === 'error') alert(s.message); else location.reload();
    }
  }, 600);
}
const pb = $('#paginate-btn'); if (pb) pb.addEventListener('click', () => runStage('paginate'));
const cb = $('#chrono-btn'); if (cb) cb.addEventListener('click', () => runStage('chronology'));

// ---- citations side panel
function esc(s) { return s.replace(/[&<>]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c])); }
async function openPage(pageId, eventId) {
  const q = eventId ? '?event_id=' + eventId : '';
  const p = await (await fetch('/api/pages/' + pageId + q)).json();
  $('#panel-title').textContent = `${p.bates || ''} · ${p.doc_type || ''} · ${p.facility || ''}`;
  $('#panel-img').src = `/pages/${pageId}.png`;
  let html = esc(p.text || '');
  if (p.quote) {
    const i = html.indexOf(esc(p.quote));
    if (i >= 0) html = html.slice(0, i) + '<mark>' + esc(p.quote) + '</mark>' + html.slice(i + esc(p.quote).length);
    else html = '<em>(quote not found verbatim on this page)</em>\n\n' + html;
  }
  $('#panel-text').innerHTML = html;
  $('#panel').classList.remove('hidden');
}
function closePanel() { $('#panel').classList.add('hidden'); }
document.addEventListener('click', (e) => {
  const c = e.target.closest('.cite'); if (c) { e.preventDefault(); openPage(c.dataset.page, c.dataset.event); return; }
  const t = e.target.closest('.thumb'); if (t && t.dataset.page) openPage(t.dataset.page);
});

// ---- event actions
async function verifyEvent(id) { await api('POST', `/api/events/${id}/verify`, {}); location.reload(); }
async function deleteEvent(id) { if (confirm('Delete this event?')) { await api('DELETE', `/api/events/${id}`); location.reload(); } }
async function resolveConflict(id) { const note = prompt('Resolution note (optional):', '') ; if (note === null) return; await api('POST', `/api/conflicts/${id}/resolve`, {note}); location.reload(); }
function editEvent(id) {
  const tr = document.getElementById('event-' + id);
  if (tr.dataset.editing) return; tr.dataset.editing = 1;
  const d = tr.querySelector('.c-date'), s = tr.querySelector('.c-summary'), g = tr.querySelector('.c-sig');
  const dv = d.childNodes[0].textContent.trim(), sv = s.childNodes[0].textContent.trim(), gv = g.textContent.trim();
  d.innerHTML = `<input class="ed" value="${dv === 'undated' ? '' : dv}" size="10">`;
  s.innerHTML = `<input class="es" style="width:100%" value="${sv.replace(/"/g, '&quot;')}">`;
  g.innerHTML = `<select class="eg">${['low', 'medium', 'high'].map((x) => `<option ${x === gv ? 'selected' : ''}>${x}</option>`).join('')}</select>`;
  const b = document.createElement('button'); b.textContent = 'save'; b.className = 'small primary';
  b.onclick = async () => {
    await api('PATCH', `/api/events/${id}`, {date: tr.querySelector('.ed').value || null, summary: tr.querySelector('.es').value, significance: tr.querySelector('.eg').value});
    location.reload();
  };
  tr.querySelector('td:last-child').prepend(b);
}
const ae = $('#add-event');
if (ae) ae.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ae), sp = (f.get('source_pages') || '').trim();
  await api('POST', `/api/cases/${ae.dataset.case}/events`, {date: f.get('date') || null, category: f.get('category'),
    significance: f.get('significance'), summary: f.get('summary'), source_pages: sp ? sp.split(/[ ,]+/) : []});
  location.reload();
});
