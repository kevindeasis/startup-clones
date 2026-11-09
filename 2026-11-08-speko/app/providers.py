"""Provider registry: deterministic mock providers + real adapters (litellm, lazy import).

Every adapter exposes: name, stage, is_mock, call(language=..., audio=None, text=None, use_case=...)
returning StageOutput(output, latency_ms, cost_usd).  STT/LLM output is str, TTS output is WAV bytes.
"""
from __future__ import annotations

import io
import math
import os
import random
import struct
import time
import wave
import zlib
from dataclasses import dataclass

from . import config
from .data import EVAL_SETS, LANGUAGES, normalize_text


class ProviderError(Exception):
    pass


@dataclass
class StageOutput:
    output: object
    latency_ms: float
    cost_usd: float


def seeded(*parts) -> random.Random:
    return random.Random(zlib.crc32("|".join(str(p) for p in parts).encode("utf-8")))


# ----------------------------------------------------------------- fake audio / WAV helpers
def make_wav(freq: float = 440.0, seconds: float = 0.3, rate: int = 8000, extra_chunk: bytes = b"") -> bytes:
    n = int(rate * seconds)
    frames = b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * freq * i / rate))) for i in range(n))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(frames)
    data = buf.getvalue()
    if extra_chunk:  # append a custom RIFF chunk "spko" carrying the eval-set id
        chunk = b"spko" + struct.pack("<I", len(extra_chunk)) + extra_chunk
        if len(extra_chunk) % 2:
            chunk += b"\0"
        data = data[:4] + struct.pack("<I", len(data) - 8 + len(chunk)) + data[8:] + chunk
    return data


def make_eval_audio(language: str, idx: int) -> bytes:
    """A playable beep WAV that secretly carries the id of an eval sentence (mock STT reads it)."""
    return make_wav(330.0, 0.3, extra_chunk=f"{language}:{idx}".encode())


def reference_from_audio(audio: bytes) -> tuple[str, str] | None:
    pos = audio.rfind(b"spko")
    if pos < 0 or pos + 8 > len(audio):
        return None
    (ln,) = struct.unpack("<I", audio[pos + 4:pos + 8])
    try:
        lang, idx = audio[pos + 8:pos + 8 + ln].decode().split(":")
        return lang, EVAL_SETS[lang][int(idx)]
    except Exception:
        return None


def audio_seconds(audio: bytes | None) -> float:
    if not audio:
        return 3.0
    if reference_from_audio(audio):
        return 4.0
    try:
        with wave.open(io.BytesIO(audio)) as w:
            return max(0.5, w.getnframes() / float(w.getframerate()))
    except Exception:
        return max(0.5, len(audio) / 32000.0)


# ----------------------------------------------------------------- mock characteristics
# STT: language -> (word error rate, base latency ms); price in USD / audio minute
STT_PARAMS = {
    "mock-stt-alpha": dict(price=0.0060, by_lang={"en": (0.03, 320), "es": (0.08, 340), "de": (0.09, 340),
                                                  "hi": (0.28, 380), "ja": (0.30, 380)}),
    "mock-stt-beta": dict(price=0.0090, by_lang={"en": (0.09, 420), "es": (0.07, 430), "de": (0.14, 430),
                                                 "hi": (0.07, 450), "ja": (0.09, 450)}),
    "mock-stt-gamma": dict(price=0.0020, by_lang={"en": (0.14, 520), "es": (0.15, 520), "de": (0.22, 520),
                                                  "hi": (0.18, 560), "ja": (0.19, 560)}),
}
# LLM: language -> (rubric quality 0..1, base latency ms); price in USD per 1M (input, output) tokens
LLM_PARAMS = {
    "mock-llm-fast": dict(price=(0.25, 1.25), by_lang={"en": (0.78, 350), "es": (0.80, 360), "de": (0.75, 360),
                                                       "hi": (0.66, 400), "ja": (0.64, 400)}),
    "mock-llm-smart": dict(price=(3.0, 15.0), by_lang={"en": (0.94, 1100), "es": (0.92, 1120), "de": (0.93, 1120),
                                                       "hi": (0.85, 1200), "ja": (0.86, 1200)}),
    "mock-llm-cheap": dict(price=(0.05, 0.20), by_lang={"en": (0.62, 650), "es": (0.60, 650), "de": (0.58, 650),
                                                        "hi": (0.52, 720), "ja": (0.50, 720)}),
}
# TTS: language -> (naturalness 0..1, base latency ms); price in USD per 1k characters
TTS_PARAMS = {
    "mock-tts-a": dict(price=0.015, by_lang={"en": (0.90, 250), "es": (0.85, 260), "de": (0.84, 260),
                                             "hi": (0.60, 300), "ja": (0.62, 300)}),
    "mock-tts-b": dict(price=0.020, by_lang={"en": (0.80, 400), "es": (0.80, 410), "de": (0.80, 410),
                                             "hi": (0.90, 430), "ja": (0.91, 430)}),
    "mock-tts-c": dict(price=0.004, by_lang={"en": (0.70, 500), "es": (0.70, 500), "de": (0.68, 500),
                                             "hi": (0.66, 540), "ja": (0.65, 540)}),
}

REPLY_TEMPLATES = {
    "en": "Sure, I understood: {t}. How else can I help you?",
    "es": "Entendido: {t}. ¿En qué más puedo ayudarte?",
    "de": "Verstanden: {t}. Wie kann ich sonst helfen?",
    "hi": "समझ गया: {t}। और मैं कैसे मदद कर सकता हूँ?",
    "ja": "承知しました: {t}。 ほかに何かお手伝いできますか?",
}
SYSTEM_PROMPT = "You are a concise voice assistant. Reply in {language}, max 2 sentences, no markdown."


def _lat(rng: random.Random, base: float) -> float:
    return round(base * (0.92 + 0.16 * rng.random()), 1)


def corrupt_words(text: str, error_rate: float, rng: random.Random) -> str:
    out = []
    words = text.split()
    for w in words:
        if rng.random() < error_rate:
            if rng.random() < 0.25 and len(words) > 1:
                continue  # deletion
            out.append((w[:-1] + "x") if len(w) > 1 else "x")  # substitution
        else:
            out.append(w)
    return " ".join(out) if out else (words[0] if words else "")


# ----------------------------------------------------------------- mock adapters
class MockSTT:
    stage, is_mock = "stt", True

    def __init__(self, name):
        self.name = name

    def call(self, *, language, audio=None, text=None, use_case="general"):
        err, base = STT_PARAMS[self.name]["by_lang"][language]
        if audio:
            ref = reference_from_audio(audio)
            reference = ref[1] if ref else f"[mock transcript of {len(audio)} bytes of {LANGUAGES[language]} audio]"
        elif text is not None:
            reference = text
        else:
            raise ProviderError("no audio or text given")
        rng = seeded(self.name, language, reference)
        hyp = corrupt_words(normalize_text(reference) if (audio and reference_from_audio(audio)) else reference,
                            err, rng)
        cost = STT_PARAMS[self.name]["price"] * audio_seconds(audio) / 60.0
        return StageOutput(hyp, _lat(rng, base), cost)


class MockLLM:
    stage, is_mock = "llm", True

    def __init__(self, name):
        self.name = name

    def call(self, *, language, audio=None, text=None, use_case="general"):
        _, base = LLM_PARAMS[self.name]["by_lang"][language]
        rng = seeded(self.name, language, text)
        t = (text or "").strip().rstrip(".!?。।")
        reply = REPLY_TEMPLATES[language].format(t=t)
        pin, pout = LLM_PARAMS[self.name]["price"]
        tin, tout = (len(SYSTEM_PROMPT) + len(t)) / 4.0, len(reply) / 3.0
        return StageOutput(reply, _lat(rng, base), (tin * pin + tout * pout) / 1e6)


class MockTTS:
    stage, is_mock = "tts", True

    def __init__(self, name):
        self.name = name

    def call(self, *, language, audio=None, text=None, use_case="general"):
        _, base = TTS_PARAMS[self.name]["by_lang"][language]
        rng = seeded(self.name, language, text)
        freq = 300 + (zlib.crc32(self.name.encode()) % 300)
        return StageOutput(make_wav(float(freq)), _lat(rng, base),
                           TTS_PARAMS[self.name]["price"] * len(text or "") / 1000.0)


def mock_quality(provider: str, stage: str, language: str, sample_key: str) -> float:
    """Seeded rubric (LLM) / naturalness (TTS) score for a single sample, in [0, 1]."""
    params = (LLM_PARAMS if stage == "llm" else TTS_PARAMS)[provider]["by_lang"][language][0]
    jitter = (seeded(provider, language, sample_key).random() - 0.5) * 0.06
    return max(0.0, min(1.0, params + jitter))


# ----------------------------------------------------------------- real adapters (need API keys)
def heuristic_llm_score(reply: str, language: str) -> float:
    """Real-mode LLM rubric (no judge call): <=2 sentences, no markdown, reply in the right script/language."""
    import re
    sentences = [s for s in re.split(r"[.!?。।]+", reply) if s.strip()]
    s_len = 1.0 if 1 <= len(sentences) <= 2 else 0.4
    s_md = 0.0 if re.search(r"[*#`_]|^\s*[-\d]+[.)]", reply, re.M) else 1.0
    if language == "hi":
        letters = [c for c in reply if c.isalpha()]
        s_lang = sum("ऀ" <= c <= "ॿ" for c in letters) / max(1, len(letters))
    elif language == "ja":
        letters = [c for c in reply if c.isalpha()]
        s_lang = sum(("぀" <= c <= "ヿ") or ("一" <= c <= "鿿") for c in letters) / max(1, len(letters))
    else:
        hints = {"en": {"the", "is", "you", "i", "to", "and"}, "es": {"el", "la", "de", "que", "y", "en", "puedo"},
                 "de": {"der", "die", "und", "ich", "ist", "das", "nicht"}}[language]
        words = set(re.findall(r"\w+", reply.lower()))
        s_lang = 1.0 if words & hints else 0.3
    return round(0.3 * s_len + 0.3 * s_md + 0.4 * s_lang, 4)


class RealSTT:
    stage, is_mock = "stt", False

    def __init__(self, name="openai/whisper-1", price_per_min=0.006):
        self.name, self.price = name, price_per_min

    def call(self, *, language, audio=None, text=None, use_case="general"):
        if not audio:  # text input: nothing to transcribe, pass through
            return StageOutput(text or "", 0.0, 0.0)
        import litellm  # lazy
        f = io.BytesIO(audio)
        f.name = "audio.wav"
        t0 = time.perf_counter()
        resp = litellm.transcription(model=self.name, file=f, language=language, timeout=20)
        ms = (time.perf_counter() - t0) * 1000
        return StageOutput(getattr(resp, "text", "") or "", round(ms, 1), self.price * audio_seconds(audio) / 60.0)


class RealLLM:
    stage, is_mock = "llm", False

    def __init__(self, name, price):
        self.name, self.price = name, price  # price: USD per 1M (in, out) tokens (fallback only)

    def call(self, *, language, audio=None, text=None, use_case="general"):
        import litellm  # lazy
        messages = [{"role": "system", "content": SYSTEM_PROMPT.format(language=LANGUAGES[language])},
                    {"role": "user", "content": text or ""}]
        t0 = time.perf_counter()
        resp = litellm.completion(model=self.name, messages=messages, max_tokens=150, timeout=20)
        ms = (time.perf_counter() - t0) * 1000
        reply = resp.choices[0].message.content or ""
        try:
            cost = float(litellm.completion_cost(completion_response=resp))
        except Exception:
            u = getattr(resp, "usage", None)
            cost = ((getattr(u, "prompt_tokens", 0) * self.price[0]) + (getattr(u, "completion_tokens", 0) * self.price[1])) / 1e6
        return StageOutput(reply, round(ms, 1), cost)


class RealTTS:
    stage, is_mock = "tts", False

    def __init__(self, name="openai/tts-1", price_per_1k=0.015):
        self.name, self.price = name, price_per_1k

    def call(self, *, language, audio=None, text=None, use_case="general"):
        import litellm  # lazy
        t0 = time.perf_counter()
        resp = litellm.speech(model=self.name, voice="alloy", input=text or "", response_format="wav", timeout=30)
        ms = (time.perf_counter() - t0) * 1000
        data = getattr(resp, "content", None)
        if data is None and hasattr(resp, "read"):
            data = resp.read()
        return StageOutput(bytes(data or b""), round(ms, 1), self.price * len(text or "") / 1000.0)


# ----------------------------------------------------------------- registry
def _all() -> list:
    ps: list = [MockSTT(n) for n in STT_PARAMS] + [MockLLM(n) for n in LLM_PARAMS] + [MockTTS(n) for n in TTS_PARAMS]
    if not config.mock_mode():
        if os.getenv("OPENAI_API_KEY"):
            ps += [RealSTT(), RealTTS()]
        if os.getenv("ANTHROPIC_API_KEY"):
            ps += [RealLLM("anthropic/claude-haiku-5-5", (1.0, 5.0)), RealLLM("anthropic/claude-sonnet-5-5", (3.0, 15.0))]
    return ps


def list_providers(stage: str | None = None) -> list:
    return [p for p in _all() if stage is None or p.stage == stage]


def get_provider(name: str):
    for p in _all():
        if p.name == name:
            return p
    raise KeyError(name)
