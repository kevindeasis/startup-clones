try:  # .env is optional, never required
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # pragma: no cover
    pass
