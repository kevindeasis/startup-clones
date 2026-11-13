"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";

type Recognition = {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const noSubscribe = () => () => undefined;

/** Browser Web Speech API only: dictation in, speechSynthesis out. Both feature-detected. */
export function useSpeech(onTranscript: (text: string) => void) {
  const micSupported = useSyncExternalStore(noSubscribe, () => Boolean(recognitionCtor()), () => false);
  const ttsSupported = useSyncExternalStore(noSubscribe, () => "speechSynthesis" in window, () => false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);

  const toggleMic = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new Ctor();
    r.lang = navigator.language;
    r.interimResults = false;
    r.onresult = (e) => onTranscript(Array.from(e.results).map((res) => res[0].transcript).join(" "));
    r.onend = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  }, [listening, onTranscript]);

  const speak = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }, []);

  return { micSupported, ttsSupported, listening, toggleMic, speak };
}
