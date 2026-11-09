import os
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


_engine = None
_Session = None


def init_engine(url: str | None = None):
    """(Re)create the engine; tests call this with a temp DB URL."""
    global _engine, _Session
    url = url or get_settings()["database_url"]
    if url.startswith("sqlite:///") and not url.startswith("sqlite:///:memory:"):
        path = url[len("sqlite:///"):]
        d = os.path.dirname(os.path.abspath(path))
        os.makedirs(d, exist_ok=True)
    _engine = create_engine(url, connect_args={"check_same_thread": False} if url.startswith("sqlite") else {})
    _Session = sessionmaker(bind=_engine, expire_on_commit=False)
    from . import models  # noqa: F401

    Base.metadata.create_all(_engine)
    return _engine


def get_session():
    if _Session is None:
        init_engine()
    return _Session()


def get_db():
    s = get_session()
    try:
        yield s
    finally:
        s.close()
