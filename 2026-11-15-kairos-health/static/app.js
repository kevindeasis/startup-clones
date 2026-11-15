// Vanilla JS for ChairFill. One init function per page, selected by <body data-page>.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
async function api(path, method = 'GET', body) {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || r.statusText);
  return data;
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toolHtml = (c) => `<div class="tool"><b>${esc(c.name)}</b><code>${esc(JSON.stringify(c.input))}</code><code>&rarr; ${esc(JSON.stringify(c.result))}</code></div>`;

$('#reset-demo')?.addEventListener('click', async () => {
  if (!confirm('Drop and re-seed all demo data?')) return;
  await api('/api/demo/reset', 'POST');
  location.reload();
});

// ---- voice (optional, browser only; degrades silently) ----
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function speak(text) {
  try { if ($('#voice')?.checked && 'speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch (e) { /* ignore */ }
}

const pages = {
  index() {
    let convId = null;
    const log = $('#log');
    const add = (role, text) => { const d = document.createElement('div'); d.className = 'msg ' + role; d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight; };
    const addTools = (calls) => {
      if (!calls || !calls.length) return;
      const d = document.createElement('details'); d.className = 'tools'; d.open = true;
      d.innerHTML = `<summary>${calls.length} tool call${calls.length > 1 ? 's' : ''} the agent made</summary>` + calls.map(toolHtml).join('');
      log.appendChild(d); log.scrollTop = log.scrollHeight;
    };
    async function start() {
      log.innerHTML = ''; $('#outcome').textContent = '';
      const c = await api('/api/conversations', 'POST', { channel: 'inbound' });
      convId = c.id; add('assistant', c.greeting); speak(c.greeting);
    }
    async function send(text) {
      add('user', text);
      try {
        const r = await api(`/api/conversations/${convId}/messages`, 'POST', { text });
        add('assistant', r.reply); addTools(r.tool_calls); speak(r.reply);
        $('#outcome').textContent = r.outcome ? `Outcome so far: ${r.outcome}` : '';
      } catch (e) { add('assistant', 'Error: ' + e.message); }
    }
    $('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); const i = $('#chat-input'); const t = i.value.trim(); if (t) { i.value = ''; send(t); } });
    $$('.chip').forEach((b) => b.addEventListener('click', () => send(b.textContent)));
    $('#hangup').addEventListener('click', async () => { if (convId) await api(`/api/conversations/${convId}/end`, 'POST').catch(() => {}); start(); });
    if (SR) {
      const mic = $('#mic'); mic.hidden = false;
      const rec = new SR(); rec.lang = 'en-US'; rec.interimResults = false;
      rec.onresult = (ev) => { const t = ev.results[0][0].transcript; if (t) send(t); };
      rec.onerror = () => {};
      mic.addEventListener('mousedown', () => { try { rec.start(); } catch (e) { /* ignore */ } });
      mic.addEventListener('mouseup', () => { try { rec.stop(); } catch (e) { /* ignore */ } });
    }
    start();
  },

  recall() {
    const setCounters = (c) => Object.entries(c).forEach(([k, v]) => { const el = $(`[data-c=${k}]`); if (el) el.textContent = v; });
    $('#run-recall').addEventListener('click', async (e) => {
      e.target.disabled = true;
      await api('/api/recall/run', 'POST');
      location.reload();
    });
    $$('.outreach').forEach((card) => {
      $('.reply-form', card).addEventListener('submit', async (e) => {
        e.preventDefault();
        const inp = $('input', card); const text = inp.value.trim(); if (!text) return; inp.value = '';
        const th = $('.thread', card);
        th.insertAdjacentHTML('beforeend', `<div class="sms in">${esc(text)}</div>`);
        try {
          const r = await api(`/api/recall/${card.dataset.id}/reply`, 'POST', { text });
          th.insertAdjacentHTML('beforeend', `<div class="sms out">${esc(r.reply)}</div>` +
            (r.tool_calls && r.tool_calls.length ? `<details class="tools"><summary>${r.tool_calls.length} tool calls</summary>${r.tool_calls.map(toolHtml).join('')}</details>` : ''));
          const pill = $('.pill', card); pill.textContent = r.status; pill.className = 'pill ' + r.status;
          setCounters(r.counters);
        } catch (err) { th.insertAdjacentHTML('beforeend', `<div class="sms out">Error: ${esc(err.message)}</div>`); }
      });
    });
  },

  insurance() {
    $$('tr.fill').forEach((tr) => tr.addEventListener('click', () => {
      const f = $('#ins-form'); f.payer.value = tr.dataset.payer; f.member_id.value = tr.dataset.member; f.dob.value = tr.dataset.dob; f.patient_id.value = tr.dataset.pid;
    }));
    $('#ins-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target; const body = { payer: f.payer.value, member_id: f.member_id.value.trim(), dob: f.dob.value };
      if (f.patient_id.value) body.patient_id = Number(f.patient_id.value);
      const out = $('#ins-result');
      try {
        const r = await api('/api/insurance/verify', 'POST', body);
        const flags = r.flags.length ? r.flags.map((x) => `<span class="flag">${esc(x)}</span>`).join('') : '<span class="flag ok">no flags</span>';
        out.innerHTML = `<h3>${r.eligible ? 'Eligible' : 'Not eligible'} ${r.plan_name ? '- ' + esc(r.plan_name) : ''}</h3><div>${flags}</div>` + (r.found ? `<table class="small">
          <tr><th>In network</th><td>${r.in_network ? 'yes' : 'no'}</td></tr><tr><th>Annual max</th><td>$${r.annual_max}</td></tr><tr><th>Remaining</th><td>$${r.remaining_max}</td></tr>
          <tr><th>Preventive / basic / major</th><td>${r.coverage.preventive}% / ${r.coverage.basic}% / ${r.coverage.major}%</td></tr><tr><th>Notes</th><td>${esc(r.copay_notes || '')} ${esc(r.waiting_period || '')}</td></tr></table>` : '<p class="muted">No matching member in the payer directory.</p>');
      } catch (err) { out.textContent = 'Error: ' + err.message; }
    });
  },

  calls() {
    $$('tr.fill').forEach((tr) => tr.addEventListener('click', async () => {
      const c = await api('/api/conversations/' + tr.dataset.id);
      $('#drawer').innerHTML = `<h3>Call #${c.id} <span class="muted">${esc(c.channel)} - ${esc(c.outcome || 'in progress')}</span></h3>` +
        c.transcript.map((m) => `<div class="msg ${m.role}">${esc(m.text)}</div>`).join('') +
        '<h3>Tool calls</h3>' + (c.tool_calls.map(toolHtml).join('') || '<p class="muted">none</p>');
    }));
  },

  messages() {
    $$('.done').forEach((cb) => cb.addEventListener('change', () => api(`/api/messages/${cb.dataset.id}/done?done=${cb.checked}`, 'POST')));
  },
};
(pages[document.body.dataset.page] || (() => {}))();
