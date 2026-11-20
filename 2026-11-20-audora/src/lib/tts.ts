import type { VoiceProfile } from "./types";

/**
 * Text-to-speech abstraction. FullCast ships only the browser Web Speech API provider
 * (see `WebSpeechProvider`). A future server-side neural provider (ElevenLabs, OpenAI, ...)
 * would implement `synthesize()` and return audio bytes that can be streamed/exported.
 */
export interface TtsProvider {
  readonly name: string;
  /** Speak one piece of text with the given voice profile; resolves when finished or cancelled. */
  speak(text: string, voice: VoiceProfile, opts?: { signal?: AbortSignal }): Promise<void>;
  cancel(): void;
  /** Optional: render audio to bytes (server-side providers only). Not implemented in this clone. */
  synthesize?(text: string, voice: VoiceProfile): Promise<{ mimeType: string; data: Uint8Array }>;
}

/** Placeholder for a future server-side neural TTS provider. Intentionally unimplemented. */
export class ServerTtsProviderStub implements TtsProvider {
  readonly name = "server-stub";
  async speak(): Promise<void> {
    throw new Error("Server-side TTS is not implemented in this clone (see README: next steps).");
  }
  cancel(): void {}
}
