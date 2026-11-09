(function () {
  const $ = (s) => document.querySelector(s);
  const msg = (t) => { const m = $('#msg'); if (m) m.textContent = t || ''; };
  async function j(url, opts) {
    const r = await fetch(url, opts);
    let body = null; try { body = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error((body && (body.detail && (body.detail.message || JSON.stringify(body.detail)))) || r.statusText);
    return body;
  }

  const demo = $('#demo-btn');
  if (demo) demo.onclick = async () => {
    demo.disabled = true; demo.textContent = 'Loading...';
    try { const r = await j('/api/demo', { method: 'POST' }); location.href = '/claims/' + r.claim_id; }
    catch (e) { msg(e.message); demo.disabled = false; demo.textContent = 'Load demo claim'; }
  };

  const cf = $('#claim-form');
  if (cf) cf.onsubmit = async (ev) => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(cf).entries());
    try {
      const c = await j('/api/claims', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      location.href = '/claims/' + c.id;
    } catch (e) { msg(e.message); }
  };

  const uf = $('#upload-form');
  if (uf) uf.onsubmit = async (ev) => {
    ev.preventDefault();
    try { await j('/api/claims/' + uf.dataset.claim + '/documents', { method: 'POST', body: new FormData(uf) }); location.reload(); }
    catch (e) { msg(e.message); }
  };

  document.querySelectorAll('.del-doc').forEach((b) => b.onclick = async () => {
    if (!confirm('Delete this document?')) return;
    try { await j('/api/claims/' + b.dataset.claim + '/documents/' + b.dataset.doc, { method: 'DELETE' }); location.reload(); }
    catch (e) { msg(e.message); }
  });

  const ib = $('#investigate-btn');
  if (ib) {
    const prog = $('#progress');
    const render = (d) => {
      const all = d.steps_total || [];
      prog.innerHTML = all.map((s) => {
        const cls = d.steps_done.includes(s) ? 'done' : (d.current_step || '').startsWith(s) ? 'cur' : '';
        const mark = cls === 'done' ? '[x] ' : cls === 'cur' ? '[...] ' : '[ ] ';
        return '<li class="' + cls + '">' + mark + s + (cls === 'cur' && d.current_step !== s ? ' ' + d.current_step.slice(s.length) : '') + '</li>';
      }).join('');
    };
    const poll = async (id) => {
      ib.disabled = true;
      const tick = async () => {
        try {
          const d = await j('/api/investigations/' + id);
          render(d);
          if (d.status === 'done') { location.href = '/claims/' + ib.dataset.claim + '/report'; return; }
          if (d.status === 'error') { msg('Investigation failed: ' + d.error); ib.disabled = false; return; }
        } catch (e) { msg(e.message); }
        setTimeout(tick, 1500);
      };
      tick();
    };
    ib.onclick = async () => {
      msg('');
      try { const r = await j('/api/claims/' + ib.dataset.claim + '/investigate', { method: 'POST' }); poll(r.investigation_id); }
      catch (e) { msg(e.message); }
    };
    if (ib.dataset.running) poll(ib.dataset.running);
  }
})();
