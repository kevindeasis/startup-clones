"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Character, StoryView, VoiceProfile } from "@/lib/types";
import { buildPools, resolveVoice, splitForSpeech } from "@/lib/voices";

type Voices = SpeechSynthesisVoice[];

function useVoices(): { voices: Voices; loaded: boolean } {
  const [state, setState] = useState<{ voices: Voices; loaded: boolean }>({ voices: [], loaded: false });
  useEffect(() => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) {
      const t = setTimeout(() => setState({ voices: [], loaded: true }), 0);
      return () => clearTimeout(t);
    }
    const read = (loaded: boolean) => setState((prev) => ({ voices: synth.getVoices(), loaded: loaded || prev.loaded }));
    const first = setTimeout(() => read(false), 0);
    const give = setTimeout(() => read(true), 1500);
    const onChange = () => read(true);
    synth.addEventListener?.("voiceschanged", onChange);
    return () => {
      clearTimeout(first);
      clearTimeout(give);
      synth.removeEventListener?.("voiceschanged", onChange);
    };
  }, []);
  return state;
}

export function Workspace({ initial }: { initial: StoryView }) {
  const [story, setStory] = useState<StoryView>(initial);
  const [error, setError] = useState("");
  const { voices, loaded } = useVoices();
  const pools = useMemo(() => buildPools(voices, "en"), [voices]);
  const hasSpeech = typeof window === "undefined" ? true : "speechSynthesis" in window;

  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const token = useRef(0);
  const storyRef = useRef(story);
  const poolsRef = useRef(pools);
  const speakRef = useRef<(i: number) => void>(() => {});
  const edits = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; voice: Partial<VoiceProfile> }>());

  useEffect(() => {
    storyRef.current = story;
    poolsRef.current = pools;
  });

  const castById = useMemo(() => new Map(story.cast.map((c) => [c.id, c])), [story.cast]);

  // ---- progressive loading: poll while generating --------------------------------------------
  useEffect(() => {
    if (story.status !== "generating") return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/stories/${story.id}`, { cache: "no-store" });
        if (!res.ok) return;
        const next: StoryView = await res.json();
        setStory((prev) => (edits.current.size > 0 ? { ...next, cast: prev.cast } : next));
      } catch {
        /* transient network error: try again on the next tick */
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [story.status, story.id]);

  // ---- player --------------------------------------------------------------------------------
  const speakFrom = useCallback((i: number) => {
    const synth = window.speechSynthesis;
    synth.cancel();
    const my = ++token.current;
    const s = storyRef.current;
    const seg = s.segments[i];
    setIdx(i);
    if (!seg) {
      // Reached the end of what exists.
      if (s.status === "generating") { setPlaying(true); setWaiting(true); } else { setPlaying(false); setWaiting(false); }
      return;
    }
    setPlaying(true);
    setWaiting(false);
    const ch = s.cast.find((c) => c.id === seg.characterId);
    const profile: VoiceProfile = ch?.voice ?? { slot: 0, pitch: 1, rate: 1 };
    const voice = resolveVoice(profile, poolsRef.current);
    const parts = splitForSpeech(seg.text);
    let n = 0;
    const next = () => {
      if (my !== token.current) return;
      if (n >= parts.length) { speakRef.current(i + 1); return; }
      const u = new SpeechSynthesisUtterance(parts[n++]);
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      u.pitch = profile.pitch;
      u.rate = profile.rate;
      u.onend = next;
      u.onerror = () => { if (my === token.current) next(); };
      synth.speak(u);
    };
    next();
  }, []);

  useEffect(() => {
    speakRef.current = speakFrom;
  }, [speakFrom]);

  const pause = useCallback(() => {
    token.current++;
    window.speechSynthesis?.cancel();
    setPlaying(false);
    setWaiting(false);
  }, []);

  // When waiting at the end of generated material, continue as soon as more segments arrive.
  useEffect(() => {
    if (!playing || !waiting) return;
    if (story.segments.length > idx) {
      const t = setTimeout(() => speakRef.current(idx), 0);
      return () => clearTimeout(t);
    }
    if (story.status !== "generating") {
      const t = setTimeout(() => { setPlaying(false); setWaiting(false); }, 0);
      return () => clearTimeout(t);
    }
  }, [playing, waiting, story.segments.length, story.status, idx]);

  useEffect(() => () => { token.current++; window.speechSynthesis?.cancel(); }, []);

  useEffect(() => {
    if (!playing) return;
    document.getElementById(`seg-${idx}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [idx, playing]);

  // ---- actions -------------------------------------------------------------------------------
  async function generate() {
    setError("");
    try {
      const res = await fetch(`/api/stories/${story.id}/generate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start generation");
      setStory((s) => ({ ...s, status: "generating", mode: data.mode ?? s.mode, error: undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start generation");
    }
  }

  function updateVoice(c: Character, voice: Partial<VoiceProfile> & { preferredVoiceName?: string | undefined }) {
    setStory((s) => ({
      ...s,
      cast: s.cast.map((x) => {
        if (x.id !== c.id) return x;
        const merged = { ...x.voice, ...voice };
        if (!merged.preferredVoiceName) delete merged.preferredVoiceName;
        return { ...x, voice: merged };
      }),
    }));
    const pending = edits.current.get(c.id);
    if (pending) clearTimeout(pending.timer);
    const acc = { ...(pending?.voice ?? {}), ...voice };
    const timer = setTimeout(async () => {
      edits.current.delete(c.id);
      const body = { characterId: c.id, voice: { ...acc, ...("preferredVoiceName" in acc ? { preferredVoiceName: acc.preferredVoiceName ?? null } : {}) } };
      try {
        const res = await fetch(`/api/stories/${story.id}/cast`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        if (!res.ok) setError("Could not save the voice change.");
      } catch {
        setError("Could not save the voice change.");
      }
    }, 400);
    edits.current.set(c.id, { timer, voice: acc });
  }

  async function rename(c: Character, name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === c.name) return;
    setStory((s) => ({ ...s, cast: s.cast.map((x) => (x.id === c.id ? { ...x, name: trimmed } : x)) }));
    await fetch(`/api/stories/${story.id}/cast`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ characterId: c.id, voice: {}, name: trimmed }) });
  }

  function preview(c: Character) {
    pause();
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(`Hello, I am ${c.name}. This is how I sound.`);
    const v = resolveVoice(c.voice, pools);
    if (v) { u.voice = v; u.lang = v.lang; }
    u.pitch = c.voice.pitch;
    u.rate = c.voice.rate;
    synth.speak(u);
  }

  const total = story.segments.length;
  const current = story.segments[idx];
  const currentChar = current ? castById.get(current.characterId) : undefined;
  const pct = story.chunksTotal ? Math.round((story.chunksDone / story.chunksTotal) * 100) : 0;
  const canPlay = hasSpeech && voices.length > 0 && total > 0;

  return (
    <main className="container workspace">
      <header className="card wshead">
        <div className="grow">
          <p className="small"><Link href="/">&larr; Library</Link></p>
          <h1>{story.title}</h1>
          <div className="row wrap">
            <span className={`badge ${story.status}`}>{story.status}</span>
            <span className={`badge mode ${story.mode}`} title={story.model ?? "heuristic segmenter, no network"}>{story.mode}</span>
            <span className="muted small">{story.wordCount.toLocaleString()} words · {total} segments · cast {story.cast.length}</span>
          </div>
          {(story.status === "generating" || story.status === "ready") && story.chunksTotal > 0 && (
            <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Generation progress">
              <div style={{ width: `${pct}%` }} />
              <span className="small">{story.chunksDone}/{story.chunksTotal} chunks</span>
            </div>
          )}
          {story.error && <p className="error small" role="alert">{story.error}</p>}
          {error && <p className="error small" role="alert">{error}</p>}
        </div>
        <div className="row wrap actions">
          {(story.status === "imported" || story.status === "error") && (
            <button type="button" className="btn primary" onClick={generate}>Generate script</button>
          )}
          <a className="btn" href={`/api/stories/${story.id}/export?format=json`} download>Export JSON</a>
          <a className="btn" href={`/api/stories/${story.id}/export?format=txt`} download>Export screenplay</a>
        </div>
      </header>

      {!hasSpeech || (loaded && voices.length === 0) ? (
        <p className="notice" role="status">
          This browser exposes no speech-synthesis voices, so playback is disabled. You can still browse the script and cast and export them.
        </p>
      ) : null}

      <div className="panes">
        <section className="card script" aria-label="Script">
          <h2>Script</h2>
          {total === 0 ? (
            <p className="muted">{story.status === "imported" ? "Press “Generate script” to work out who says what." : "Waiting for the first chunk..."}</p>
          ) : (
            <ol className="segs">
              {story.segments.map((seg, i) => {
                const ch = castById.get(seg.characterId);
                const prev = story.segments[i - 1];
                const showName = !prev || prev.characterId !== seg.characterId || prev.kind !== seg.kind;
                return (
                  <li
                    key={seg.index}
                    id={`seg-${i}`}
                    className={`seg ${seg.kind}${i === idx ? " current" : ""}${i === idx && playing ? " playing" : ""}`}
                    style={{ ["--c" as string]: ch?.color ?? "#888" }}
                    onClick={() => { if (canPlay) speakFrom(i); else setIdx(i); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (canPlay) speakFrom(i); else setIdx(i); } }}
                    tabIndex={0}
                    role="button"
                    aria-label={`${ch?.name ?? "Unknown"}: ${seg.text.slice(0, 60)}`}
                  >
                    {showName && <span className="who">{ch?.name ?? "Unknown"}</span>}
                    <span className="line">{seg.text}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="card cast" aria-label="Cast">
          <h2>Cast</h2>
          <ul className="castlist">
            {story.cast.map((c) => {
              const options = pools.all;
              return (
                <li key={c.id} className="castcard" style={{ ["--c" as string]: c.color }}>
                  <div className="row">
                    <span className="swatch" aria-hidden />
                    {c.isNarrator ? <strong className="grow">{c.name}</strong> : (
                      <input className="grow nameinput" defaultValue={c.name} aria-label={`Name of ${c.name}`} onBlur={(e) => rename(c, e.currentTarget.value)} />
                    )}
                  </div>
                  <p className="muted small">
                    {c.genderHint} · {c.ageHint}{c.personality ? ` · ${c.personality}` : ""}
                    {c.aliases.length ? ` · also: ${c.aliases.join(", ")}` : ""}
                  </p>
                  <label className="small">Voice
                    <select
                      value={c.voice.preferredVoiceName ?? ""}
                      onChange={(e) => updateVoice(c, { preferredVoiceName: e.target.value || undefined })}
                    >
                      <option value="">Auto (slot {c.voice.slot})</option>
                      {options.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
                    </select>
                  </label>
                  <label className="small">Slot {c.voice.slot}
                    <input type="range" min={0} max={16} step={1} value={c.voice.slot} onChange={(e) => updateVoice(c, { slot: Number(e.target.value) })} />
                  </label>
                  <label className="small">Pitch {c.voice.pitch.toFixed(2)}
                    <input type="range" min={0.5} max={2} step={0.05} value={c.voice.pitch} onChange={(e) => updateVoice(c, { pitch: Number(e.target.value) })} />
                  </label>
                  <label className="small">Rate {c.voice.rate.toFixed(2)}
                    <input type="range" min={0.5} max={2} step={0.05} value={c.voice.rate} onChange={(e) => updateVoice(c, { rate: Number(e.target.value) })} />
                  </label>
                  <button type="button" className="btn small" disabled={!hasSpeech || voices.length === 0} onClick={() => preview(c)}>Preview voice</button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <div className="player" role="region" aria-label="Player">
        <div className="pbuttons">
          <button type="button" className="btn" disabled={!canPlay || idx <= 0} onClick={() => speakFrom(Math.max(0, idx - 1))} aria-label="Previous segment">&laquo;</button>
          {playing ? (
            <button type="button" className="btn primary" onClick={pause} aria-label="Pause">Pause</button>
          ) : (
            <button type="button" className="btn primary" disabled={!canPlay} onClick={() => speakFrom(Math.min(idx, Math.max(0, total - 1)))} aria-label="Play">Play</button>
          )}
          <button type="button" className="btn" disabled={!canPlay || idx >= total - 1} onClick={() => speakFrom(idx + 1)} aria-label="Next segment">&raquo;</button>
        </div>
        <div className="pnow">
          {waiting ? (
            <span className="muted">Waiting for more of the script to be generated...</span>
          ) : current ? (
            <>
              <strong style={{ color: currentChar?.color }}>{currentChar?.name ?? "Unknown"}</strong>
              <span className="pline">{current.text}</span>
            </>
          ) : (
            <span className="muted">{story.status === "generating" ? "Generating... playback can start with the first chunk." : "Nothing to play yet."}</span>
          )}
        </div>
        <div className="ppos small">{total ? `${idx + 1} / ${total}` : "0 / 0"}</div>
      </div>
    </main>
  );
}
