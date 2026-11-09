"""Seed ~80 deterministic synthetic ClipPilot conversations, ingest via the SDK, analyze and cluster.

    python scripts/seed.py             # in-process against the local SQLite DB (RESETS the DB first)
    python scripts/seed.py --url http://localhost:8000   # against a running server (does not reset)
"""
import argparse
import os
import random
import sys
from datetime import datetime, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from sdk.agnost_clone_sdk import AgnostClone  # noqa: E402

SUBTITLE_ASKS = [
    "Can you add automatic subtitles to my interview clip?",
    "I wish it could generate captions automatically for my vlog",
    "Is there a way to auto-generate subtitles for this video?",
    "Do you support automatic captions? My audience watches on mute",
    "Could you add closed captions to my product demo?",
    "Can you add subtitles from the speech in my clip",
    "Is there a way to transcribe my video into on-screen captions?",
    "I wish it could burn subtitles into the video automatically",
    "Do you support auto subtitles in Spanish?",
    "Can you add captions that follow what people are saying?",
    "Is there a way to get subtitles generated for my webinar recording?",
    "Does it support automatic subtitles? I have a 20 minute talk",
    "Can you add auto captions to my TikTok edit",
    "I wish it could caption my clips automatically",
]
SUBTITLE_REPLIES = [
    "Sorry, I can't generate subtitles automatically yet. I can add text overlays you type in manually.",
    "I'm not able to transcribe audio into captions right now. Manual text overlays are supported.",
    "We don't support automatic subtitles at the moment, but a text overlay can be added by hand.",
]
OTHER_FEATURES = [
    ("Can you add 4K export to my project?", "I'm not able to export above 1080p right now."),
    ("Do you support 4K export for the final render?", "Sorry, we don't support 4K export yet."),
    ("Is there a way to export at 4K resolution?", "I can't export in 4K, the maximum is 1080p."),
    ("Could you add 4K output for my drone footage?", "I'm not able to output 4K at the moment."),
    ("Can you add a vertical 9:16 export for TikTok?", "Sorry, I can't produce vertical TikTok exports yet."),
    ("Is there a way to make this vertical for reels?", "I'm not able to reformat to vertical automatically."),
    ("Do you support TikTok shorts format?", "We don't support the shorts format yet."),
    ("Can you add a vertical version for TikTok too", "I can't generate vertical versions yet."),
    ("Do you support a dark mode for the editor?", "Sorry, there is no dark mode yet. It's not supported."),
    ("I wish it could switch the editor to dark mode", "I'm not able to change the editor theme."),
    ("Is there a way to enable dark mode?", "We don't support dark mode at the moment."),
    ("Can you add green screen removal to my clip?", "I can't remove green screen backgrounds yet."),
    ("Do you support chroma key effects?", "We don't support chroma key right now."),
]
EXPORT_BUGS = [
    "My export keeps failing with an error at 87%",
    "Export crashes every time I hit the button",
    "I get an error when I try to export this project",
    "The export fails halfway and I lose everything",
    "Export doesn't work for my longer clips",
    "Every export ends with an error message",
]
PREVIEW_BUGS = [
    "The preview is stuck on a black frame",
    "My timeline is frozen and I can't scrub",
    "The render preview is stuck at 99%",
    "Timeline freezes whenever I add a second track",
]
UPLOAD_BUGS = ["Upload crashes every time I add a 2GB file", "Uploading my footage fails with a spinner forever"]
RAGE = [
    ("Trim the first ten seconds off my clip", "Done! I trimmed the clip.", "WHY IS THE AUDIO STILL THERE!! THIS IS USELESS"),
    ("Remove the background noise", "All set, the noise is removed.", "WTF it sounds exactly the same, this tool is garbage!!"),
    ("Make the text bigger", "Done, the text is now larger.", "NOTHING CHANGED!! USELESS ASSISTANT"),
    ("Apply a black and white filter", "Completed. Here you go.", "This is stupid, it is still in color!! Fix it NOW"),
    ("Add a fade out at the end", "Done! Fade added.", "ARE YOU KIDDING ME, there is no fade at all!!"),
]
REPHRASE_BASES = ["make the video brighter", "make the intro shorter", "slow down the middle part", "zoom in on the speaker",
                  "make the logo smaller"]
CORRECTIONS = [
    ("Cut the clip at 0:30", "Done! I cut it at 3:00.", "No, I meant 0:30, not 3:00.", "Fixed, here you go.", "Perfect, thanks"),
    ("Add the title to the second scene", "Done, the title is on the first scene.", "That's wrong, I said the second scene.", "Moved it, here you go.", "Great, works now"),
    ("Export just the audio track", "Here you go, I exported the full video.", "Not what I asked, I only wanted audio.", "Completed, audio only.", "Thanks, that works"),
    ("Use the blue theme", "All set, applied the red theme.", "No, I meant the blue one.", "Done, blue theme applied.", "Awesome thanks"),
]
HALLUC = [
    ("Where can I learn keyframes?", "Check https://clippilot.app/tutorials/keyframes-101 for a full guide.", "That link gives me a 404."),
    ("Is there a template for YouTube intros?", "Yes: https://clippilot.app/templates/youtube-intro has several.", "That page doesn't exist."),
    ("Do you have docs on color grading?", "See https://docs.clippilot.app/color-grading for details.", "I get a 404 on that link too."),
    ("Where do I download the desktop app?", "Download it at https://clippilot.app/download/desktop", "Page not found, that link is dead."),
]
CHURN = [
    ("Why is rendering so slow?", "Longer clips take more time to process.", "This is the third time it's slow. I want a refund."),
    ("How do I get rid of the watermark?", "The watermark is removed on the Pro plan.", "Too expensive. I'm switching to CapCut."),
    ("Can I pause my plan?", "Plans can't be paused, only changed.", "Then I'm going to cancel my subscription."),
    ("How do I unsubscribe?", "You can manage billing in Settings.", "Please just cancel it, this product isn't for me."),
]
PLAIN_TOPICS = {
    "trim": ["Trim the first 5 seconds of my clip", "Cut the last ten seconds off my intro video", "Trim my clip so it starts at 0:12"],
    "color": ["Apply a warm color grade to my footage", "Give my video a cinematic color grade", "Make the colors of my clip more vibrant"],
    "music": ["Add background music to my video", "Put some upbeat music under my clip", "Add a calm music track behind the voiceover"],
    "speed": ["Speed up the clip to 2x", "Slow down my clip to half speed", "Make the video play at 1.5x speed"],
    "crop": ["Crop my video to a square", "Resize my clip for Instagram", "Crop the edges of my video"],
    "transition": ["Add a fade transition between my two clips", "Add a cross dissolve between scenes", "Put a smooth transition between the clips"],
    "noise": ["Remove the background noise from my recording", "Clean up the audio noise in my clip", "Reduce the hiss in my voiceover"],
}
PLAIN_REPLIES = ["Done! Your clip has been updated.", "Here you go, the edit is applied.", "Completed. Take a look at the preview."]
PLAIN_ENDS = ["Thanks, perfect!", "Great, that works", "Awesome, thank you"]


def build(rng: random.Random):
    convs = []  # list of (kind, [(role, text)])
    for q in SUBTITLE_ASKS:
        convs.append(("subtitles", [("user", q), ("assistant", rng.choice(SUBTITLE_REPLIES)), ("user", "Okay, thanks anyway")]))
    for q, a in OTHER_FEATURES:
        convs.append(("feature", [("user", q), ("assistant", a), ("user", "Okay, bummer")]))
    for q in EXPORT_BUGS + PREVIEW_BUGS + UPLOAD_BUGS:
        convs.append(("bug", [("user", q), ("assistant", "Sorry about that. Try restarting the app and lowering the resolution."), ("user", "Okay, I'll wait for a fix")]))
    for a, b, c in RAGE:
        convs.append(("rage", [("user", a), ("assistant", b), ("user", c)]))
    for base in REPHRASE_BASES:
        convs.append(("rephrase", [("user", base), ("assistant", "Done, I made an adjustment."), ("user", base + " please"),
                                   ("assistant", "Completed, here you go."), ("user", base + " right now")]))
    for u1, a1, u2, a2, u3 in CORRECTIONS:
        convs.append(("correction", [("user", u1), ("assistant", a1), ("user", u2), ("assistant", a2), ("user", u3)]))
    for u1, a1, u2 in HALLUC:
        convs.append(("halluc", [("user", u1), ("assistant", a1), ("user", u2), ("assistant", "Sorry about that."), ("user", "ok")]))
    for u1, a1, u2 in CHURN:
        convs.append(("churn", [("user", u1), ("assistant", a1), ("user", u2)]))
    for topic, qs in PLAIN_TOPICS.items():
        for q in qs:
            convs.append(("plain", [("user", q), ("assistant", rng.choice(PLAIN_REPLIES)), ("user", rng.choice(PLAIN_ENDS))]))
    rng.shuffle(convs)
    return convs


def seed_messages(product: str = "ClipPilot"):
    rng = random.Random(42)
    base = datetime(2026, 10, 18, 9, 0, 0)
    out = []
    for n, (kind, turns) in enumerate(build(rng), start=1):
        cid, uid = f"cp-{n:04d}", f"user_{(n * 7) % 97 + 1:03d}" if kind != "subtitles" else f"user_s{n:03d}"
        meta = {"plan": rng.choice(["free", "pro", "team"]), "org": f"org_{rng.randint(1, 12)}", "product": product}
        t0 = base + timedelta(days=n % 10, hours=rng.randint(0, 9), minutes=rng.randint(0, 59))
        for j, (role, text) in enumerate(turns):
            out.append(dict(conversation_id=cid, role=role, content=text, user_id=uid, metadata=meta,
                            timestamp=(t0 + timedelta(minutes=j)).isoformat()))
    return out


def main():
    import logging
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpx2").setLevel(logging.WARNING)
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", help="base URL of a running server; default is in-process with a reset local DB")
    args = ap.parse_args()

    if args.url:
        client = AgnostClone(args.url)
    else:
        from sqlalchemy import inspect  # noqa: F401
        from fastapi.testclient import TestClient

        from app import db
        from app.main import app, setup_app

        engine = db.init_engine()
        db.Base.metadata.drop_all(engine)
        db.Base.metadata.create_all(engine)
        setup_app(app)
        client = AgnostClone("http://testserver", client=TestClient(app, base_url="http://testserver", raise_server_exceptions=True))

    msgs = seed_messages(os.environ.get("PRODUCT_NAME", "ClipPilot") or "ClipPilot")
    for m in msgs:
        client.track(m["conversation_id"], m["role"], m["content"], user_id=m["user_id"], metadata=m["metadata"], timestamp=m["timestamp"])
    sent = client.flush()
    n_conv = len({m["conversation_id"] for m in msgs})
    an = client.analyze()
    cl = client.cluster()
    print(f"Ingested {n_conv} conversations ({sent['ingested']} messages in {sent['batches']} batches)")
    print(f"Analyzed {an['analyzed']} conversations (model={an['model']})")
    print(f"Patterns created: {cl['patterns']} ({cl['clusters']} clusters + 2 default categories; "
          f"{cl['feature_groups']} feature-request groups, {cl['bug_groups']} bug groups)")
    return 0 if an["analyzed"] == n_conv and n_conv >= 60 else 1


if __name__ == "__main__":
    sys.exit(main())
