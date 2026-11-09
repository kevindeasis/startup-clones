import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import db
from .llm import LLM, build_llm
from .routes_api import router as api_router
from .routes_pages import router as pages_router

logging.basicConfig(level=logging.INFO)


def setup_app(app: FastAPI, llm: LLM | None = None):
    """Initialise DB (once) and the LLM provider. Called by lifespan; also usable without lifespan (seed, tests)."""
    if db._engine is None:
        db.init_engine()
    if llm is not None:
        app.state.llm = llm
    elif getattr(app.state, "llm", None) is None:
        app.state.llm = build_llm()


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_app(app)
    yield


app = FastAPI(title="Agnost AI clone", description="Unofficial educational clone: conversation analytics for AI agents.", lifespan=lifespan)
app.state.llm = None
app.include_router(api_router)
app.include_router(pages_router)
