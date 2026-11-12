/**
 * Scripts evaluated inside the page, kept as plain strings so tsx/esbuild helper
 * injection (e.g. __name) cannot leak into page.evaluate.
 */

/** Defines buildSelector(el) and helpers. Prefers #id, then [name], then a short tag.class:nth-of-type path. */
export const BUILD_SELECTOR_SRC = String.raw`
function cssEsc(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/([^\w-])/g, '\\$1'); }
function isUnique(sel) { try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; } }
function nthOfType(el) {
  var i = 1, s = el.previousElementSibling;
  while (s) { if (s.tagName === el.tagName) i++; s = s.previousElementSibling; }
  return i;
}
function nthChild(el) {
  var i = 1, s = el.previousElementSibling;
  while (s) { i++; s = s.previousElementSibling; }
  return i;
}
function buildSelector(el) {
  var tag = el.tagName.toLowerCase();
  if (el.id && isUnique('#' + cssEsc(el.id))) return '#' + cssEsc(el.id);
  var nm = el.getAttribute('name');
  if (nm) {
    var sn = tag + '[name="' + nm.replace(/"/g, '') + '"]';
    if (isUnique(sn)) return sn;
  }
  var parts = [], cur = el;
  while (cur && cur.nodeType === 1) {
    if (cur !== el && cur.id && isUnique('#' + cssEsc(cur.id))) { parts.unshift('#' + cssEsc(cur.id)); break; }
    var t = cur.tagName.toLowerCase();
    if (t === 'html') { parts.unshift('html'); break; }
    var cls = '';
    var list = cur.classList ? Array.prototype.slice.call(cur.classList) : [];
    for (var i = 0; i < list.length; i++) { if (/^[A-Za-z][\w-]*$/.test(list[i])) { cls = '.' + list[i]; break; } }
    parts.unshift(t + cls + ':nth-of-type(' + nthOfType(cur) + ')');
    cur = cur.parentElement;
  }
  var sel = parts.join(' > ');
  if (isUnique(sel)) return sel;
  var p2 = [];
  cur = el;
  while (cur && cur.nodeType === 1 && cur.tagName.toLowerCase() !== 'html') {
    p2.unshift(cur.tagName.toLowerCase() + ':nth-child(' + nthChild(cur) + ')');
    cur = cur.parentElement;
  }
  return 'html > ' + p2.join(' > ');
}
`;

export const BUILD_SELECTOR_FN = `(el) => { ${BUILD_SELECTOR_SRC}; return buildSelector(el); }`;

export const SNAPSHOT_JS = `(() => { ${BUILD_SELECTOR_SRC}
` + String.raw`
  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  function visible(el) {
    var r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && (r.width > 0 || r.height > 0);
  }
  function roleOf(el) {
    var t = el.tagName.toLowerCase(), ty = (el.getAttribute('type') || 'text').toLowerCase();
    var ar = el.getAttribute('role'); if (ar) return ar;
    if (t === 'a') return 'link';
    if (t === 'button') return 'button';
    if (t === 'select') return 'combobox';
    if (t === 'textarea') return 'textbox';
    if (t === 'table') return 'table';
    if (/^h[1-6]$/.test(t)) return 'heading';
    if (t === 'input') {
      if (ty === 'submit' || ty === 'button' || ty === 'reset') return 'button';
      if (ty === 'checkbox') return 'checkbox';
      if (ty === 'radio') return 'radio';
      if (ty === 'search') return 'searchbox';
      return 'textbox';
    }
    if (t === 'ul' || t === 'ol') return 'list';
    return t;
  }
  function nameOf(el) {
    var t = el.tagName.toLowerCase();
    var al = el.getAttribute('aria-label'); if (al) return clean(al);
    if (el.id) { var l = document.querySelector('label[for="' + el.id.replace(/"/g, '') + '"]'); if (l) return clean(l.textContent); }
    var wl = el.closest('label'); if (wl) { var c = clean(wl.textContent); if (c) return c; }
    if (t === 'input' && /^(submit|button|reset)$/i.test(el.getAttribute('type') || '')) return clean(el.value);
    if (t === 'button' || t === 'a' || /^h[1-6]$/.test(t)) return clean(el.textContent);
    if (t === 'table') { var cap = el.querySelector('caption'); return cap ? clean(cap.textContent) : ''; }
    return clean(el.getAttribute('title') || '');
  }
  var out = [];
  var seen = new Set();
  function add(rec) { if (out.length < 150) out.push(rec); }
  var nodes = document.querySelectorAll('input,textarea,select,button,a[href],table,h1,h2,h3,ul,ol,[role=list],[role=button],main,section,div');
  for (var k = 0; k < nodes.length && out.length < 150; k++) {
    var el = nodes[k], t = el.tagName.toLowerCase();
    if (seen.has(el)) continue;
    if (t === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'hidden') continue;
    if (!visible(el)) continue;
    var rec = null;
    if (t === 'main' || t === 'section' || t === 'div') {
      if (el.closest('table,select,ul,ol,nav,header,footer,form')) continue;
      var groups = {}, kids = el.children;
      for (var j = 0; j < kids.length; j++) {
        var kc = kids[j].className && typeof kids[j].className === 'string' ? clean(kids[j].className) : '';
        if (!kc) continue;
        var key = kids[j].tagName.toLowerCase() + '.' + kc.split(' ').join('.');
        groups[key] = (groups[key] || 0) + 1;
      }
      var best = null;
      for (var g in groups) { if (groups[g] >= 3 && (!best || groups[g] > groups[best])) best = g; }
      if (!best) continue;
      rec = { kind: 'list', role: 'list', tag: t, name: '', selector: buildSelector(el), itemSelector: ':scope > ' + best, itemCount: groups[best], text: clean(el.textContent).slice(0, 80) };
    } else if (t === 'ul' || t === 'ol' || el.getAttribute('role') === 'list') {
      var lis = el.querySelectorAll(':scope > li');
      if (lis.length < 2 || el.closest('nav,header,footer')) continue;
      rec = { kind: 'list', role: 'list', tag: t, name: '', selector: buildSelector(el), itemSelector: ':scope > li', itemCount: lis.length, text: clean(el.textContent).slice(0, 80) };
    } else if (t === 'table') {
      var rows = el.querySelectorAll('tr'), hdr = [];
      var hc = el.querySelectorAll('thead th'); if (!hc.length && rows.length) hc = rows[0].querySelectorAll('th,td');
      for (var h = 0; h < hc.length; h++) hdr.push(clean(hc[h].textContent));
      rec = { kind: 'table', role: 'table', tag: 'table', name: nameOf(el), selector: buildSelector(el), cols: hdr.length, rows: Math.max(0, rows.length - 1), headers: hdr, text: hdr.join(' | ') };
    } else {
      var role = roleOf(el);
      rec = { kind: role, role: role, tag: t, name: nameOf(el), selector: buildSelector(el), placeholder: el.getAttribute('placeholder') || undefined,
              href: t === 'a' ? el.getAttribute('href') : undefined, inputType: t === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : undefined,
              text: (t === 'button' || t === 'a') ? clean(el.textContent) : undefined };
      if (t === 'select') rec.options = Array.prototype.slice.call(el.options).map(function (o) { return clean(o.text); });
      if (t === 'input' || t === 'button') { var f = el.closest('form'); if (f) { rec.formSelector = buildSelector(f); rec.submitsForm = (t === 'button' ? (el.getAttribute('type') || 'submit') === 'submit' : /submit/i.test(el.getAttribute('type') || '')); } }
    }
    seen.add(el);
    add(rec);
  }
  return { url: location.href, title: document.title, elements: out, bodyText: clean(document.body ? document.body.innerText : '').slice(0, 400) };
})()`;

export const EXTRACT_TABLE_FN = String.raw`(table) => {
  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  var rows = Array.prototype.slice.call(table.querySelectorAll('tr'));
  if (!rows.length) return [];
  var headRow = table.querySelector('thead tr') || rows[0];
  var headers = Array.prototype.slice.call(headRow.children).map(function (c) { return clean(c.textContent); });
  var keys = [], used = {};
  headers.forEach(function (h, i) {
    var k = h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || ('col' + (i + 1));
    if (used[k]) { used[k]++; k = k + '_' + used[k]; } else used[k] = 1;
    keys.push(k);
  });
  var body = rows.filter(function (r) { return r !== headRow; });
  var out = [];
  body.forEach(function (r) {
    var cells = Array.prototype.slice.call(r.children).filter(function (c) { return c.tagName === 'TD' || c.tagName === 'TH'; });
    if (cells.length < keys.length) return;
    var o = {};
    keys.forEach(function (k, i) { o[k] = clean(cells[i].textContent); });
    out.push(o);
  });
  return out;
}`;

export const EXTRACT_LIST_FN = String.raw`(root, arg) => {
  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  var items = Array.prototype.slice.call(root.querySelectorAll(arg.item));
  return items.map(function (it) {
    var o = {};
    Object.keys(arg.fields).forEach(function (k) {
      var f = arg.fields[k];
      var n = f.selector ? it.querySelector(f.selector) : it;
      if (!n) { o[k] = ''; return; }
      o[k] = f.attr === 'text' ? clean(n.textContent) : (n.getAttribute(f.attr) || '');
    });
    return o;
  });
}`;
