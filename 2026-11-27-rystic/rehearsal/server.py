"""FastAPI app factory: mounts the twins, control plane and the UI."""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse

from . import __version__
from .control import router as control_router
from .envs import Registry
from .faults import SimMiddleware
from .twins import github, slack, stripe
from .twins.common import TwinError

STATIC = Path(__file__).resolve().parent / "static"


def create_app() -> FastAPI:
    app = FastAPI(title="Rehearsal", version=__version__, docs_url="/docs", redoc_url=None)
    app.state.registry = Registry()
    app.add_middleware(SimMiddleware)

    @app.exception_handler(TwinError)
    async def twin_error(request: Request, exc: TwinError):
        return JSONResponse(exc.body, status_code=exc.status, headers=exc.headers)

    app.include_router(control_router)
    for mod in (stripe, slack, github):
        app.include_router(mod.router)

    @app.get("/healthz")
    async def healthz():
        return {"status": "ok", "version": __version__}

    @app.get("/", include_in_schema=False)
    async def index():
        return FileResponse(STATIC / "index.html")

    return app


app = create_app()
