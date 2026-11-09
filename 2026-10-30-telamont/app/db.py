import os
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/girder.db")
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "./data/uploads"))

if DATABASE_URL.startswith("sqlite:///") and ":memory:" not in DATABASE_URL:
    Path(DATABASE_URL[len("sqlite:///"):]).parent.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=_args)


def init_db() -> None:
    from . import models  # noqa: F401  (register tables)

    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
