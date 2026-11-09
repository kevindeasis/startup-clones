async function postJSON(url, data) {
  const r = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data || {})});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail || j));
  return j;
}
const $ = (s) => document.querySelector(s);
function formData(form) { const o = {}; new FormData(form).forEach((v, k) => { if (String(v).trim()) o[k] = String(v).trim(); }); return o; }

const nc = $('#new-case');
if (nc) {
  $('#fill-demo').onclick = () => {
    const o = location.origin;
    nc.target_url.value = o + '/demo/'; nc.checkout_url.value = o + '/demo/checkout'; nc.cancel_url.value = o + '/demo/account';
  };
  nc.onsubmit = async (e) => {
    e.preventDefault();
    const st = $('#new-case-status'), btn = nc.querySelector('button[type=submit]');
    st.textContent = 'Capturing and analyzing… (10–30 s)'; btn.disabled = true;
    try { const c = await postJSON('/api/cases', formData(nc)); location.href = '/cases/' + c.id; }
    catch (err) { st.textContent = 'Error: ' + err.message; btn.disabled = false; }
  };
}
const cf = $('#new-complaint');
if (cf) cf.onsubmit = async (e) => {
  e.preventDefault();
  const st = $('#complaint-status');
  st.textContent = 'Triaging…';
  try { await postJSON('/api/complaints', formData(cf)); location.reload(); }
  catch (err) { st.textContent = 'Error: ' + err.message; }
};
const df = $('#decision-form');
if (df) df.onsubmit = async (e) => {
  e.preventDefault();
  try { await postJSON('/api/cases/' + df.dataset.case + '/decisions', formData(df)); location.reload(); }
  catch (err) { alert('Error: ' + err.message); }
};
const dl = $('#draft-letter');
if (dl) {
  dl.onclick = async () => {
    $('#letter-status').textContent = 'Drafting…';
    try {
      const r = await postJSON('/api/cases/' + dl.dataset.case + '/letter');
      $('#letter-body').textContent = r.body; $('#letter-box').hidden = false; $('#letter-status').textContent = '';
    } catch (err) { $('#letter-status').textContent = 'Error: ' + err.message; }
  };
  $('#copy-letter').onclick = async () => {
    try { await navigator.clipboard.writeText($('#letter-body').textContent); $('#copy-letter').textContent = 'Copied'; }
    catch (e) { const r = document.createRange(); r.selectNode($('#letter-body')); getSelection().addRange(r); }
  };
}
