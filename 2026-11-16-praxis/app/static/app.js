// Vanilla JS: all buttons/forms call the JSON/form API, then reload the page.
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 4000);
}
async function call(url, opts) {
  const r = await fetch(url, opts);
  let data = null; try { data = await r.json(); } catch (e) {}
  if (!r.ok) { toast((data && data.detail) || ('Error ' + r.status)); throw new Error('request failed'); }
  return data;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  try {
    if (b.dataset.post) {
      b.disabled = true;
      const data = await call(b.dataset.post, { method: 'POST' });
      if (b.dataset.summary) { toast('Daily agents: ' + data.chasers.length + ' chasers, ' + data.payment_reminders.length + ' reminders drafted'); setTimeout(() => location.reload(), 900); }
      else if (b.dataset.goto) location.href = b.dataset.goto;
      else location.reload();
    } else if (b.dataset.approve) {
      const card = b.closest('.approval');
      const payload = {};
      if (b.dataset.edited) { payload.draft_text = card.querySelector('.draft').value; const s = card.querySelector('.subj'); if (s) payload.subject = s.value; }
      b.disabled = true;
      await call('/api/approvals/' + b.dataset.approve + '/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      location.reload();
    } else if (b.dataset.reject) {
      const card = b.closest('.approval');
      const reason = card.querySelector('.reason').value.trim();
      if (!reason) { toast('A rejection reason is required.'); return; }
      await call('/api/approvals/' + b.dataset.reject + '/reject', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
      location.reload();
    }
  } catch (err) { b.disabled = false; }
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form.ajax'); if (!f) return;
  e.preventDefault();
  try {
    const data = await call(f.getAttribute('action'), { method: 'POST', body: new FormData(f) });
    if (data && data.message) toast(data.message);
    setTimeout(() => location.reload(), data && data.message ? 1200 : 0);
  } catch (err) {}
});
