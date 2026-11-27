"""Control plane: /_sim/*"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException, Request, Response
from pydantic import ValidationError

from . import __version__
from .envs import Env, NetworkProfile
from .scenarios import apply_scenario, builtin_scenarios, get_scenario
from .seed import SeedError, seed_env

router = APIRouter(prefix="/_sim")


def _env(request: Request, env_id: str) -> Env:
    env = request.app.state.registry.get(env_id)
    if env is None:
        raise HTTPException(404, f"No such env: {env_id}")
    return env


def _boot(env: Env) -> None:
    sc_name = env.boot.get("scenario")
    if sc_name:
        sc = get_scenario(sc_name)
        if sc:
            apply_scenario(env, sc)
    if env.boot.get("seed"):
        seed_env(env, env.boot["seed"])


@router.post("/envs", status_code=201)
async def create_env(request: Request, body: dict | None = Body(None)):
    body = body or {}
    env = request.app.state.registry.create()
    try:
        name = body.get("scenario")
        if name:
            sc = get_scenario(name)
            if sc is None:
                raise HTTPException(404, f"No such scenario: {name}")
            apply_scenario(env, sc)
        if body.get("seed"):
            seed_env(env, body["seed"])
    except SeedError as exc:
        request.app.state.registry.delete(env.env_id)
        raise HTTPException(400, str(exc))
    except HTTPException:
        request.app.state.registry.delete(env.env_id)
        raise
    env.boot = {"scenario": body.get("scenario"), "seed": body.get("seed")}
    return {"env_id": env.env_id}


@router.get("/envs")
async def list_envs(request: Request):
    return {"envs": [
        {"env_id": e.env_id, "created_at": e.created_at, "calls": len(e.ledger), "egress": len(e.egress),
         "clock": e.now_iso(), "scenario": e.boot.get("scenario")}
        for e in request.app.state.registry.envs.values()]}


@router.delete("/envs/{env_id}", status_code=204)
async def delete_env(request: Request, env_id: str):
    if not request.app.state.registry.delete(env_id):
        raise HTTPException(404, f"No such env: {env_id}")
    return Response(status_code=204)


@router.post("/envs/{env_id}/reset", status_code=204)
async def reset_env(request: Request, env_id: str, body: dict | None = Body(None)):
    env = _env(request, env_id)
    env.clear()
    if (body or {}).get("to") == "boot":
        _boot(env)
    return Response(status_code=204)


@router.post("/envs/{env_id}/seed", status_code=204)
async def seed(request: Request, env_id: str, body: Any = Body(...)):
    env = _env(request, env_id)
    try:
        seed_env(env, body)
    except SeedError as exc:
        raise HTTPException(400, str(exc))
    return Response(status_code=204)


@router.post("/envs/{env_id}/scenario", status_code=204)
async def load_scenario(request: Request, env_id: str, body: dict = Body(...)):
    env = _env(request, env_id)
    sc = get_scenario(body.get("name", ""))
    if sc is None:
        raise HTTPException(404, f"No such scenario: {body.get('name')}")
    apply_scenario(env, sc)
    env.boot = {"scenario": sc.name, "seed": None}
    return Response(status_code=204)


@router.post("/envs/{env_id}/clock")
async def clock(request: Request, env_id: str, body: dict = Body(...)):
    env = _env(request, env_id)
    try:
        if "time" in body:
            env.set_time(body["time"])
        if "advance_seconds" in body:
            env.advance(int(body["advance_seconds"]))
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, f"bad clock request: {exc}")
    return {"time": env.now_iso(), "pinned": env.pinned is not None}


@router.post("/envs/{env_id}/network")
async def set_network(request: Request, env_id: str, body: dict = Body(...)):
    env = _env(request, env_id)
    try:
        env.network = NetworkProfile.model_validate(body)
    except ValidationError as exc:
        raise HTTPException(400, exc.errors(include_url=False, include_context=False))
    env.rate_window.clear()
    return env.network.model_dump()


@router.get("/envs/{env_id}/network")
async def get_network(request: Request, env_id: str):
    return _env(request, env_id).network.model_dump()


@router.get("/envs/{env_id}/inspect")
async def inspect(request: Request, env_id: str, register: str | None = None):
    return _env(request, env_id).inspect(register)


@router.get("/envs/{env_id}/calls")
async def calls(request: Request, env_id: str, tail: int | None = None):
    led = _env(request, env_id).ledger
    return {"calls": led[-tail:] if tail else led}


@router.get("/envs/{env_id}/egress")
async def egress(request: Request, env_id: str, tail: int | None = None):
    eg = _env(request, env_id).egress
    return {"events": eg[-tail:] if tail else eg}


@router.post("/envs/{env_id}/snapshot")
async def snapshot(request: Request, env_id: str):
    return {"snapshot_id": _env(request, env_id).snapshot()}


@router.post("/envs/{env_id}/restore", status_code=204)
async def restore(request: Request, env_id: str, body: dict = Body(...)):
    if not _env(request, env_id).restore(body.get("snapshot_id", "")):
        raise HTTPException(404, "No such snapshot")
    return Response(status_code=204)


@router.get("/scenarios")
async def scenarios():
    return {"scenarios": [{"name": n, "description": s.description} for n, s in builtin_scenarios().items()]}


@router.get("/version")
async def version():
    return {"version": __version__, "twins": ["stripe", "slack", "github"]}


@router.post("/grade")
def grade(request: Request, body: dict = Body(...)):
    # sync handler -> runs in a threadpool so the agent can call this same server over HTTP
    from .grade import run_scenario_against

    sc = get_scenario(body.get("scenario", ""))
    if sc is None:
        raise HTTPException(404, f"No such scenario: {body.get('scenario')}")
    flags = (body.get("agent_flags") or {})
    extra = [f"--{k}" for k, v in flags.items() if v] if isinstance(flags, dict) else list(flags)
    base = str(request.base_url).rstrip("/")
    return run_scenario_against(base, request.app.state.registry, sc, extra_flags=extra)
