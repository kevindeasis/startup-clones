"""Cheap deterministic signals computed in code before (and independent of) the LLM."""
import re

TOKEN_RE = re.compile(r"[a-z0-9']+")

PROFANITY = {
    "damn", "wtf", "shit", "crap", "fuck", "fucking", "hell", "bullshit", "stupid", "idiot", "garbage",
    "trash", "sucks", "suck", "pathetic", "worthless", "ridiculous",
}

# --- keyword rules shared by the mock LLM and the per-turn highlighter -----------------------
FEATURE_PHRASES = re.compile(
    r"\b(can you add|could you add|can you support|wish it could|i wish (?:you|it) (?:could|had)|is there a way to|"
    r"do you support|does it support|any plans? (?:to|for)|would love (?:to have|it if)|please add|i need (?:you to )?support|"
    r"can it (?:also )?(?:generate|do|export|make)|is it possible to)\b", re.I)
REFUSAL = re.compile(r"(not able|don't support|do not support|can't|cannot|isn't supported|not supported|unable|no support|not yet)", re.I)
BUG_WORDS = re.compile(r"\b(broken|error|crash(?:es|ed|ing)?|doesn't work|does not work|stuck|freez\w*|frozen|fails?|failed)\b", re.I)
LINK_COMPLAINT = re.compile(r"(404|doesn't exist|does not exist|not found|dead link|no such page|link is dead|page is gone)", re.I)
CORRECTION = re.compile(r"(no, i meant|no i meant|that's wrong|that is wrong|not what i asked|that's not what i|i said |you misunderstood|wrong clip)", re.I)
CHURN = re.compile(r"\b(cancel|cancelling|canceling|switching to|switch to|refund|unsubscribe|competitor|going back to)\b", re.I)
SUCCESS_WORDS = re.compile(r"\b(done|here you go|completed|all set|finished)\b", re.I)
NEGATIVE_WORDS = re.compile(r"(useless|wrong|not what|terrible|awful|hate|still (?:not|broken|no)|doesn't|didn't|nope|again|worse|bad)", re.I)
POSITIVE_WORDS = re.compile(r"\b(thanks|thank you|perfect|great|awesome|works|love it|nice|exactly)\b", re.I)
URL_RE = re.compile(r"https?://\S+", re.I)


def tokens(text: str) -> set[str]:
    return set(TOKEN_RE.findall(text.lower()))


def jaccard(a: str, b: str) -> float:
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def user_messages(messages: list[dict]) -> list[tuple[int, str]]:
    return [(i, m["content"]) for i, m in enumerate(messages) if m["role"] == "user"]


def rephrase_pairs(messages: list[dict], threshold: float = 0.5) -> list[tuple[int, int]]:
    """Index pairs (earlier, later) of consecutive user messages with Jaccard token similarity >= threshold."""
    users = user_messages(messages)
    pairs = []
    for (i1, t1), (i2, t2) in zip(users, users[1:]):
        if jaccard(t1, t2) >= threshold:
            pairs.append((i1, i2))
    return pairs


def caps_ratio(text: str) -> float:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 0.0
    return sum(1 for c in letters if c.isupper()) / len(letters)


def profanity_hit(text: str) -> bool:
    return any(w in PROFANITY for w in TOKEN_RE.findall(text.lower()))


def compute_hints(messages: list[dict]) -> dict:
    """Deterministic hints: rephrase_count, caps_ratio, exclamation_count, profanity_hit, user_message_count, ended_on_user_turn."""
    users = [m["content"] for m in messages if m["role"] == "user"]
    joined = " ".join(users)
    non_system = [m for m in messages if m["role"] in ("user", "assistant")]
    return {
        "rephrase_count": len(rephrase_pairs(messages)),
        "caps_ratio": round(caps_ratio(joined), 3),
        "exclamation_count": joined.count("!"),
        "profanity_hit": profanity_hit(joined),
        "user_message_count": len(users),
        "ended_on_user_turn": bool(non_system and non_system[-1]["role"] == "user"),
    }


def is_shouting(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    return len(letters) >= 8 and caps_ratio(text) > 0.6


def is_frustrated_text(text: str) -> bool:
    return bool(profanity_hit(text) or is_shouting(text) or "!!" in text or re.search(r"\buseless\b", text, re.I))


def message_flags(messages: list[dict]) -> dict[int, list[str]]:
    """Per-turn tags used to highlight turns that triggered signals on the conversation page."""
    flags: dict[int, list[str]] = {}

    def add(i, tag):
        flags.setdefault(i, [])
        if tag not in flags[i]:
            flags[i].append(tag)

    for a, b in rephrase_pairs(messages):
        add(a, "rephrase")
        add(b, "rephrase")
    for i, m in enumerate(messages):
        c = m["content"]
        if m["role"] == "user":
            if is_frustrated_text(c):
                add(i, "frustration")
            if CORRECTION.search(c):
                add(i, "correction")
            if CHURN.search(c):
                add(i, "churn")
            if LINK_COMPLAINT.search(c):
                add(i, "hallucination")
            elif BUG_WORDS.search(c):
                add(i, "bug")
            if FEATURE_PHRASES.search(c) and i + 1 < len(messages) and REFUSAL.search(messages[i + 1]["content"]):
                add(i, "feature-request")
        elif m["role"] == "assistant" and URL_RE.search(c):
            if any(LINK_COMPLAINT.search(x["content"]) for x in messages[i + 1:] if x["role"] == "user"):
                add(i, "hallucination")
    return flags


# --- text normalisation for near-duplicate grouping -----------------------------------------
_SYN = {
    "captions": "subtitle", "caption": "subtitle", "subtitles": "subtitle", "subtitle": "subtitle",
    "transcribe": "subtitle", "transcription": "subtitle", "transcript": "subtitle",
    "automatic": "auto", "automatically": "auto", "autogenerate": "auto", "autogenerated": "auto",
    "videos": "video", "clips": "clip", "movies": "video",
}
_STOP = {"the", "a", "an", "to", "of", "for", "my", "me", "i", "it", "and", "or", "is", "in", "on", "with", "this", "that",
         "you", "your", "can", "could", "please", "user", "asks", "ask", "asked", "wants", "want", "generate", "add"}


def norm_word(w: str) -> str:
    w = w.lower().strip("'")
    if w in _SYN:
        return _SYN[w]
    for suf in ("ing", "ed", "es", "s"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def normalize_for_grouping(text: str, drop_stop: bool = True) -> str:
    words = re.findall(r"[a-z0-9]+", text.lower())
    out = []
    for w in words:
        n = norm_word(w)
        if drop_stop and n in _STOP:
            continue
        out.append(n)
    return " ".join(out)


def content_words(text: str) -> set[str]:
    return set(normalize_for_grouping(text).split())
