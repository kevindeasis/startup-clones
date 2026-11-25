"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Comment = { id: string; block: string | null; author: string; body: string; created_at: string; resolved: boolean; parent_id?: string; kind: "user" | "agent"; meta?: { version_created: number; previous_version: number; diff: string; summary: string } };
type Ver = { n: number; author: string; note: string; created_at: string };

const INJECT = `<style>[data-block]{cursor:pointer}[data-block].__ph{outline:2px dashed #6366f1;outline-offset:2px}[data-block].__sel{outline:2px solid #4338ca;outline-offset:2px;background:rgba(99,102,241,.08)}</style>
<script>(function(){var sel=null;function blk(e){var t=e.target;return t&&t.closest?t.closest('[data-block]'):null}
document.addEventListener('mouseover',function(e){var b=blk(e);document.querySelectorAll('.__ph').forEach(function(x){x.classList.remove('__ph')});if(b)b.classList.add('__ph')});
document.addEventListener('click',function(e){var b=blk(e);if(!b)return;e.preventDefault();parent.postMessage({paddock:'block',id:b.getAttribute('data-block')},'*')},true);
window.addEventListener('message',function(e){if(e.data&&e.data.paddock==='select'){document.querySelectorAll('.__sel').forEach(function(x){x.classList.remove('__sel')});if(e.data.id){var el=document.querySelector('[data-block="'+e.data.id+'"]');if(el)el.classList.add('__sel')}}});})();<\/script>`;

function inject(html: string) {
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, INJECT + "</body>") : html + INJECT;
}

export default function Viewer({ id, slug, initialTitle, initialVisibility, initialVersion }: { id: string; slug: string; initialTitle: string; initialVisibility: "private" | "public"; initialVersion: number }) {
  const [html, setHtml] = useState<string>("");
  const [version, setVersion] = useState(initialVersion);
  const [preview, setPreview] = useState<number | null>(null);
  const [visibility, setVisibility] = useState(initialVisibility);
  const [comments, setComments] = useState<Comment[]>([]);
  const [versions, setVersions] = useState<Ver[]>([]);
  const [block, setBlock] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const iframe = useRef<HTMLIFrameElement>(null);
  const versionRef = useRef(initialVersion);

  const loadAll = useCallback(async () => {
    const [s, c, v] = await Promise.all([fetch(`/api/spaces/${id}`).then((r) => r.json()), fetch(`/api/spaces/${id}/comments`).then((r) => r.json()), fetch(`/api/spaces/${id}/versions`).then((r) => r.json())]);
    setHtml(s.html); setVersion(s.version); versionRef.current = s.version; setVisibility(s.visibility); setComments(c); setVersions(v);
  }, [id]);

  useEffect(() => { try { setName(localStorage.getItem("paddock-name") || ""); } catch {} loadAll(); }, [loadAll]);

  // Poll every 3s; reload when the version changes.
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/spaces/${id}?since=${versionRef.current}`).then((x) => x.json());
        if (r.changed) loadAll();
      } catch {}
    }, 3000);
    return () => clearInterval(t);
  }, [id, loadAll]);

  useEffect(() => {
    const h = (e: MessageEvent) => { if (e.source === iframe.current?.contentWindow && e.data?.paddock === "block") setBlock(e.data.id); };
    window.addEventListener("message", h);
    return () => window.removeEventListener("message", h);
  }, []);

  useEffect(() => { iframe.current?.contentWindow?.postMessage({ paddock: "select", id: block }, "*"); }, [block, html]);

  async function showPreview(n: number | null) {
    setPreview(n);
    if (n === null) { setHtml((await fetch(`/api/spaces/${id}`).then((r) => r.json())).html); return; }
    setHtml(await fetch(`/api/spaces/${id}/versions/${n}`).then((r) => r.text()));
  }

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !text.trim()) { setNote("Enter a display name and a comment."); return; }
    try { localStorage.setItem("paddock-name", name.trim()); } catch {}
    setBusy(true); setNote("");
    const r = await fetch(`/api/spaces/${id}/comments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ block, author: name.trim(), body: text }) });
    const d = await r.json();
    setBusy(false);
    if (!r.ok) { setNote(d.error || "failed"); return; }
    if (d.error) setNote(d.error);
    setText("");
    setPreview(null);
    await loadAll();
  }

  async function resolve(c: Comment) {
    await fetch(`/api/spaces/${id}/comments/${c.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ resolved: !c.resolved }) });
    loadAll();
  }
  async function restore(n: number) {
    await fetch(`/api/spaces/${id}/versions/${n}/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ author: name || undefined }) });
    setPreview(null);
    await loadAll();
  }
  async function toggleVis() {
    const v = visibility === "public" ? "private" : "public";
    await fetch(`/api/spaces/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ visibility: v }) });
    setVisibility(v);
  }
  async function copy() {
    const url = `${window.location.origin}/s/${slug}`;
    try { await navigator.clipboard.writeText(url); setNote("Link copied"); } catch { setNote(url); }
  }

  const roots = comments.filter((c) => !c.parent_id || !comments.some((x) => x.id === c.parent_id));
  const replies = (pid: string) => comments.filter((c) => c.parent_id === pid);

  const renderComment = (c: Comment, isReply = false) => (
    <div key={c.id} className={`${isReply ? "ml-4 mt-2 border-l-2 border-indigo-200 pl-3" : ""}`}>
      <div className="text-xs text-stone-500">
        <b className={c.kind === "agent" ? "text-indigo-700" : "text-stone-800"}>{c.author}</b>{c.kind === "agent" && " (AI)"} · {new Date(c.created_at).toLocaleTimeString()}
        {c.block && !isReply && <button className="ml-2 underline" onClick={() => setBlock(c.block)}>{c.block}</button>}
      </div>
      <div className="text-sm whitespace-pre-wrap">{c.body}</div>
      {c.meta && (
        <div className="mt-1">
          <div className="text-xs text-stone-600">Created version {c.meta.version_created}</div>
          {c.meta.diff && <pre className="text-xs bg-stone-100 rounded p-2 mt-1 overflow-x-auto max-h-48">{c.meta.diff}</pre>}
          <button onClick={() => restore(c.meta!.previous_version)} className="mt-1 text-xs border rounded px-2 py-0.5 hover:bg-stone-100">Undo</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center gap-3 px-4 py-2 border-b bg-white flex-wrap">
        <a href="/" className="text-sm text-indigo-700">&larr; Spaces</a>
        <h1 className="font-semibold">{initialTitle}</h1>
        <span className="text-xs text-stone-500">v{version}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${visibility === "public" ? "bg-emerald-100 text-emerald-800" : "bg-stone-200"}`}>{visibility}</span>
        <button onClick={toggleVis} className="text-xs border rounded px-2 py-1 hover:bg-stone-100">Make {visibility === "public" ? "private" : "public"}</button>
        <button onClick={copy} className="text-xs border rounded px-2 py-1 hover:bg-stone-100">Copy link</button>
        {preview !== null && <span className="text-xs bg-amber-100 text-amber-900 rounded px-2 py-1">Previewing v{preview} <button className="underline ml-1" onClick={() => showPreview(null)}>back to current</button> <button className="underline ml-1" onClick={() => restore(preview)}>Restore</button></span>}
      </header>
      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        <div className="flex-1 min-h-[40vh] bg-stone-200">
          <iframe ref={iframe} title="space" sandbox="allow-scripts" srcDoc={html ? inject(html) : ""} className="w-full h-full bg-white border-0" onLoad={() => iframe.current?.contentWindow?.postMessage({ paddock: "select", id: block }, "*")} />
        </div>
        <aside className="md:w-96 w-full border-l bg-white overflow-y-auto p-3 space-y-4">
          <form onSubmit={post} className="space-y-2">
            <div className="text-xs text-stone-600">{block ? <>Commenting on block <b>{block}</b> <button type="button" className="underline" onClick={() => setBlock(null)}>clear</button></> : "Click a block in the page to pin a comment, or comment on the whole space."}</div>
            <input aria-label="Display name" className="w-full border rounded px-2 py-1 text-sm" placeholder="Your display name" value={name} onChange={(e) => setName(e.target.value)} />
            <textarea aria-label="Comment" className="w-full border rounded px-2 py-1 text-sm h-20" placeholder="Comment... mention @paddock to edit this spot" value={text} onChange={(e) => setText(e.target.value)} />
            <button disabled={busy} className="bg-stone-900 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50">{busy ? "Working..." : "Post comment"}</button>
            {note && <div className="text-xs text-stone-600" role="status">{note}</div>}
          </form>
          <section>
            <h2 className="font-medium text-sm mb-2">Comments ({comments.length})</h2>
            <div className="space-y-3">
              {roots.length === 0 && <div className="text-sm text-stone-500">No comments yet.</div>}
              {roots.map((c) => (
                <div key={c.id} className={`border rounded-lg p-2 ${c.resolved ? "opacity-60" : ""}`}>
                  {renderComment(c)}
                  {replies(c.id).map((r) => renderComment(r, true))}
                  <button onClick={() => resolve(c)} className="mt-2 text-xs underline">{c.resolved ? "Reopen" : "Resolve"}</button>
                </div>
              ))}
            </div>
          </section>
          <section>
            <h2 className="font-medium text-sm mb-2">Versions</h2>
            <ul className="space-y-1">
              {[...versions].reverse().map((v) => (
                <li key={v.n} className={`text-xs flex items-center gap-2 ${preview === v.n ? "font-semibold" : ""}`}>
                  <button className="underline" onClick={() => showPreview(v.n === version ? null : v.n)}>v{v.n}</button>
                  <span className="text-stone-500 truncate flex-1">{v.author} · {v.note || "-"}</span>
                  {v.n !== version && <button className="border rounded px-1.5 py-0.5" onClick={() => restore(v.n)}>Restore</button>}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
