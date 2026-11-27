"""Scenario YAML schema, loader and built-in registry."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

from .envs import Env, NetworkProfile
from .seed import seed_env

SCENARIO_DIR = Path(__file__).resolve().parent.parent / "scenarios"


class AgentSpec(BaseModel):
    task: str = "support"  # support | triage
    flags: list[str] = Field(default_factory=list)


class Scenario(BaseModel):
    name: str
    description: str = ""
    clock: str | None = None
    rng_seed: int = 0
    seed: dict[str, Any] = Field(default_factory=dict)
    network: NetworkProfile = Field(default_factory=NetworkProfile)
    agent: AgentSpec = Field(default_factory=AgentSpec)
    assertions: list[dict[str, Any]] = Field(default_factory=list)


def load_scenario_file(path: str | Path) -> Scenario:
    with open(path) as fh:
        return Scenario.model_validate(yaml.safe_load(fh))


def builtin_scenarios() -> dict[str, Scenario]:
    out: dict[str, Scenario] = {}
    for p in sorted(SCENARIO_DIR.glob("*.yaml")):
        sc = load_scenario_file(p)
        out[sc.name] = sc
    return out


def get_scenario(name: str) -> Scenario | None:
    return builtin_scenarios().get(name)


def apply_scenario(env: Env, sc: Scenario) -> None:
    """Reset the env then load the scenario's clock, rng seed, seed data and network."""
    env.clear()
    env.rng_seed = sc.rng_seed
    if sc.clock:
        env.set_time(sc.clock)
    seed_env(env, sc.seed)
    env.network = sc.network.model_copy(deep=True)
