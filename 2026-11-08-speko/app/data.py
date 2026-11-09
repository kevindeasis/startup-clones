"""Languages, use cases and the built-in eval sets (6 sentences per language).

Japanese sentences are pre-segmented with spaces so that word-level WER via jiwer is meaningful.
"""
import unicodedata

LANGUAGES = {"en": "English", "es": "Spanish", "de": "German", "hi": "Hindi", "ja": "Japanese"}
USE_CASES = ("general", "support_call", "realtime_voice", "transcription", "ivr")
PRIORITIES = ("quality", "latency", "cost", "balanced")

EVAL_SETS = {
    "en": [
        "please book a table for two at seven tonight",
        "what is the weather like in london tomorrow",
        "i would like to change my delivery address",
        "can you remind me to call the doctor on friday",
        "my internet connection has been slow since this morning",
        "thank you for your help and have a nice day",
    ],
    "es": [
        "quiero reservar una mesa para dos esta noche",
        "cual es el pronostico del tiempo para mañana en madrid",
        "necesito cambiar la direccion de entrega de mi pedido",
        "puedes recordarme llamar al médico el viernes",
        "mi conexion de internet va muy lenta desde esta mañana",
        "muchas gracias por tu ayuda que tengas un buen día",
    ],
    "de": [
        "bitte reservieren sie einen tisch für zwei personen heute abend",
        "wie wird das wetter morgen in berlin",
        "ich möchte meine lieferadresse ändern",
        "kannst du mich am freitag an den arzttermin erinnern",
        "meine internetverbindung ist seit heute morgen sehr langsam",
        "vielen dank für ihre hilfe und einen schönen tag",
    ],
    "hi": [
        "कृपया आज रात सात बजे दो लोगों के लिए मेज बुक करें",
        "कल दिल्ली में मौसम कैसा रहेगा",
        "मैं अपना डिलीवरी का पता बदलना चाहता हूँ",
        "शुक्रवार को डॉक्टर को फोन करने की याद दिलाना",
        "आज सुबह से मेरा इंटरनेट बहुत धीमा चल रहा है",
        "आपकी मदद के लिए बहुत धन्यवाद आपका दिन शुभ हो",
    ],
    "ja": [
        "今夜 七時 に 二人 の テーブル を 予約 して ください",
        "明日 の 東京 の 天気 は どう です か",
        "配達 先 の 住所 を 変更 したい です",
        "金曜日 に 医者 に 電話 する よう に 知らせ て",
        "今朝 から インターネット の 接続 が とても 遅い です",
        "ご 協力 ありがとう ござい ました 良い 一日 を",
    ],
}


def validate_language(language: str) -> str:
    if language not in LANGUAGES:
        raise ValueError(f"Unsupported language '{language}'. Supported: {', '.join(LANGUAGES)}")
    return language


def validate_stage(stage: str) -> str:
    if stage not in ("stt", "llm", "tts"):
        raise ValueError(f"Unknown stage '{stage}'. Supported: stt, llm, tts")
    return stage


def validate_use_case(use_case: str) -> str:
    if use_case not in USE_CASES:
        raise ValueError(f"Unknown use_case '{use_case}'. Supported: {', '.join(USE_CASES)}")
    return use_case


def validate_priority(priority: str) -> str:
    if priority not in PRIORITIES:
        raise ValueError(f"Unknown priority '{priority}'. Supported: {', '.join(PRIORITIES)}")
    return priority


def normalize_text(s: str) -> str:
    """Lowercase and drop punctuation/symbols (keeps combining marks, e.g. Devanagari matras)."""
    s = "".join(c for c in s.lower() if unicodedata.category(c)[0] not in ("P", "S"))
    return " ".join(s.split())
