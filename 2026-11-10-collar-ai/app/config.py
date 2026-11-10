import os


def database_path() -> str:
    return os.environ.get("DATABASE_PATH", "./irdesk.db")


def model_name() -> str:
    return os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5")


# Fictional company profile used by the targeting score (Northwind Robotics).
COMPANY_PROFILE = {
    "name": "Northwind Robotics",
    "ticker": "NWR",
    "style_affinity": {"growth": 1.0, "garp": 0.8, "quant": 0.5, "value": 0.35},
    "sectors": ["robotics", "industrial automation", "logistics", "ai", "technology"],
    "aum_sweet_spot_musd": (500, 25000),
}
