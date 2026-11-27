"""GitHub twin (REST v3 subset): /e/{env_id}/github/..."""
from __future__ import annotations

import copy
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from ..envs import Env
from ..ids import github_issue_number, github_object_id
from ..seed import gh_label
from .common import TwinError, get_params, lookup_env, to_int

router = APIRouter(prefix="/e/{env_id}/github")
DOCS = "https://docs.github.com/rest"


def gh_err(status: int, message: str, errors: list | None = None) -> TwinError:
    body: dict[str, Any] = {"message": message, "documentation_url": DOCS}
    if errors:
        body["errors"] = errors
    return TwinError(status, body)


def dep(request: Request, env_id: str) -> Env:
    env = lookup_env(request, env_id)
    auth = request.headers.get("authorization", "")
    token = auth.split(" ", 1)[-1].strip()
    if not auth or not token.startswith("ghp_"):
        raise TwinError(401, {"message": "Requires authentication", "documentation_url": DOCS})
    return env


def api(request: Request, env: Env) -> str:
    return f"{str(request.base_url)}e/{env.env_id}/github"


def get_repo(env: Env, owner: str, name: str) -> dict:
    rec = env.reg("github.repos").get(f"{owner}/{name}")
    if not rec:
        raise gh_err(404, "Not Found")
    return rec


def label_obj(base: str, repo: str, lb: dict) -> dict:
    return {"id": lb.get("id", 0), "name": lb["name"], "color": lb.get("color", "ededed"), "default": False,
            "description": lb.get("description"), "url": f"{base}/repos/{repo}/labels/{lb['name']}"}


def issue_obj(request: Request, env: Env, rec: dict) -> dict:
    base, repo, n = api(request, env), rec["repo"], rec["number"]
    out = copy.deepcopy(rec)
    out.pop("repo", None)
    ncomments = sum(1 for c in env.reg("github.comments").values()
                    if c["repo"] == repo and c["issue_number"] == n)
    out.update({
        "url": f"{base}/repos/{repo}/issues/{n}", "html_url": f"https://github.com/{repo}/issues/{n}",
        "repository_url": f"{base}/repos/{repo}", "comments_url": f"{base}/repos/{repo}/issues/{n}/comments",
        "labels_url": f"{base}/repos/{repo}/issues/{n}/labels{{/name}}", "comments": ncomments,
        "labels": [label_obj(base, repo, lb) for lb in rec["labels"]], "assignees": [], "assignee": None,
        "locked": False, "author_association": "NONE", "node_id": f"I_{rec['id']}",
        "user": {**rec["user"], "url": f"{base}/users/{rec['user']['login']}"},
    })
    return out


def repo_obj(request: Request, env: Env, rec: dict) -> dict:
    base = api(request, env)
    out = copy.deepcopy(rec)
    nopen = sum(1 for i in env.reg("github.issues").values() if i["repo"] == rec["full_name"] and i["state"] == "open")
    out.update({"url": f"{base}/repos/{rec['full_name']}", "html_url": f"https://github.com/{rec['full_name']}",
                "open_issues_count": nopen, "open_issues": nopen, "fork": False, "node_id": f"R_{rec['id']}",
                "owner": {**rec["owner"], "url": f"{base}/users/{rec['owner']['login']}"}})
    return out


def comment_obj(request: Request, env: Env, c: dict) -> dict:
    base = api(request, env)
    out = {k: v for k, v in c.items() if k not in ("repo", "issue_number")}
    out.update({"url": f"{base}/repos/{c['repo']}/issues/comments/{c['id']}",
                "issue_url": f"{base}/repos/{c['repo']}/issues/{c['issue_number']}",
                "html_url": f"https://github.com/{c['repo']}/issues/{c['issue_number']}#issuecomment-{c['id']}",
                "updated_at": c["created_at"], "user": {**c["user"], "url": f"{base}/users/{c['user']['login']}"}})
    return out


def get_issue(env: Env, owner: str, repo: str, n: int) -> dict:
    get_repo(env, owner, repo)
    rec = env.reg("github.issues").get(f"{owner}/{repo}#{n}")
    if not rec:
        raise gh_err(404, "Not Found")
    return rec


def ensure_label(env: Env, repo: str, name: str) -> dict:
    key = f"{repo}:{name}"
    lb = env.reg("github.labels").get(key)
    if not lb:
        lb = {"id": github_object_id(env, "label"), "name": name, "color": "ededed", "repo": repo}
        env.put("github.labels", key, lb)
    return lb


def add_labels(env: Env, rec: dict, names: list[str]) -> None:
    have = {lb["name"] for lb in rec["labels"]}
    for name in names:
        if name in have:
            continue
        lb = ensure_label(env, rec["repo"], name)
        rec["labels"].append({"name": name, "color": lb["color"], "id": lb["id"]})
        have.add(name)
        env.emit("github", "github.issue.labeled", {"repo": rec["repo"], "number": rec["number"], "label": name})
    rec["updated_at"] = env.now_iso()
    env.put("github.issues", f"{rec['repo']}#{rec['number']}", rec)


def label_names(raw: Any) -> list[str]:
    if isinstance(raw, dict):
        raw = raw.get("labels", raw.get("_list", []))
    if isinstance(raw, str):
        raw = [raw]
    return [x if isinstance(x, str) else x.get("name") for x in (raw or []) if x]


@router.get("/user")
async def user(env: Env = Depends(dep)):
    return {"login": "rehearsal-bot", "id": 1, "type": "User", "name": "Rehearsal Bot"}


@router.get("/rate_limit")
async def rate_limit(env: Env = Depends(dep)):
    used = env.sequences.get("github.calls", 0)
    core = {"limit": 5000, "used": used, "remaining": max(0, 5000 - used), "reset": env.epoch() + 3600}
    return {"resources": {"core": core, "search": {"limit": 30, "used": 0, "remaining": 30, "reset": env.epoch() + 60}},
            "rate": core}


@router.get("/repos/{owner}/{repo}")
async def repo_get(owner: str, repo: str, request: Request, env: Env = Depends(dep)):
    return repo_obj(request, env, get_repo(env, owner, repo))


@router.get("/repos/{owner}/{repo}/labels")
async def labels_list(owner: str, repo: str, request: Request, env: Env = Depends(dep)):
    get_repo(env, owner, repo)
    full = f"{owner}/{repo}"
    return [label_obj(api(request, env), full, lb) for lb in env.reg("github.labels").values() if lb.get("repo") == full]


@router.get("/repos/{owner}/{repo}/issues")
async def issues_list(owner: str, repo: str, request: Request, env: Env = Depends(dep)):
    get_repo(env, owner, repo)
    p = await get_params(request)
    state = p.get("state", "open")
    want = [x for x in str(p.get("labels", "")).split(",") if x]
    full = f"{owner}/{repo}"
    rows = [i for i in env.reg("github.issues").values() if i["repo"] == full
            and (state == "all" or i["state"] == state)
            and all(w in {lb["name"] for lb in i["labels"]} for w in want)]
    rows.sort(key=lambda i: i["number"], reverse=True)
    per_page = to_int(p.get("per_page")) or 30
    page = to_int(p.get("page")) or 1
    rows = rows[(page - 1) * per_page: page * per_page]
    return [issue_obj(request, env, i) for i in rows]


@router.post("/repos/{owner}/{repo}/issues", status_code=201)
async def issues_create(owner: str, repo: str, request: Request, env: Env = Depends(dep)):
    get_repo(env, owner, repo)
    p = await get_params(request)
    if not p.get("title"):
        raise gh_err(422, "Validation Failed", [{"resource": "Issue", "code": "missing_field", "field": "title"}])
    full = f"{owner}/{repo}"
    n = github_issue_number(env, full)
    rec = {"id": github_object_id(env, "issue"), "number": n, "repo": full, "title": p["title"],
           "body": p.get("body"), "state": "open", "labels": [], "user": {"login": "rehearsal-bot", "id": 1, "type": "User"},
           "created_at": env.now_iso(), "updated_at": env.now_iso(), "closed_at": None}
    env.put("github.issues", f"{full}#{n}", rec)
    env.emit("github", "github.issue.opened", {"repo": full, "number": n, "title": rec["title"]})
    add_labels(env, rec, label_names(p.get("labels")))
    return issue_obj(request, env, rec)


@router.get("/repos/{owner}/{repo}/issues/{n}")
async def issue_get(owner: str, repo: str, n: int, request: Request, env: Env = Depends(dep)):
    return issue_obj(request, env, get_issue(env, owner, repo, n))


@router.patch("/repos/{owner}/{repo}/issues/{n}")
async def issue_patch(owner: str, repo: str, n: int, request: Request, env: Env = Depends(dep)):
    rec = get_issue(env, owner, repo, n)
    p = await get_params(request)
    if "state" in p and p["state"] not in ("open", "closed"):
        raise gh_err(422, "Validation Failed", [{"resource": "Issue", "code": "invalid", "field": "state"}])
    for k in ("title", "body"):
        if k in p:
            rec[k] = p[k]
    if "labels" in p:
        rec["labels"] = []
        add_labels(env, rec, label_names(p["labels"]))
    if "state" in p and p["state"] != rec["state"]:
        rec["state"] = p["state"]
        rec["closed_at"] = env.now_iso() if p["state"] == "closed" else None
        if p["state"] == "closed":
            env.emit("github", "github.issue.closed", {"repo": rec["repo"], "number": n})
    rec["updated_at"] = env.now_iso()
    env.put("github.issues", f"{rec['repo']}#{n}", rec)
    return issue_obj(request, env, rec)


@router.get("/repos/{owner}/{repo}/issues/{n}/comments")
async def comments_list(owner: str, repo: str, n: int, request: Request, env: Env = Depends(dep)):
    rec = get_issue(env, owner, repo, n)
    return [comment_obj(request, env, c) for c in env.reg("github.comments").values()
            if c["repo"] == rec["repo"] and c["issue_number"] == n]


@router.post("/repos/{owner}/{repo}/issues/{n}/comments", status_code=201)
async def comments_create(owner: str, repo: str, n: int, request: Request, env: Env = Depends(dep)):
    rec = get_issue(env, owner, repo, n)
    p = await get_params(request)
    if not p.get("body"):
        raise gh_err(422, "Validation Failed", [{"resource": "IssueComment", "code": "missing_field", "field": "body"}])
    cid = github_object_id(env, "comment")
    c = {"id": cid, "repo": rec["repo"], "issue_number": n, "body": p["body"],
         "user": {"login": "rehearsal-bot", "id": 1, "type": "User"}, "created_at": env.now_iso()}
    env.put("github.comments", f"{rec['repo']}#{n}/{cid}", c)
    env.emit("github", "github.issue.commented", {"repo": rec["repo"], "number": n, "comment_id": cid})
    return comment_obj(request, env, c)


@router.post("/repos/{owner}/{repo}/issues/{n}/labels")
async def labels_add(owner: str, repo: str, n: int, request: Request, env: Env = Depends(dep)):
    rec = get_issue(env, owner, repo, n)
    p = await get_params(request)
    names = label_names(p.get("labels") if "labels" in p else p.get("_list"))
    if not names:
        raise gh_err(422, "Validation Failed", [{"resource": "Issue", "code": "missing_field", "field": "labels"}])
    add_labels(env, rec, names)
    base = api(request, env)
    return [label_obj(base, rec["repo"], lb) for lb in rec["labels"]]


@router.delete("/repos/{owner}/{repo}/issues/{n}/labels/{name}")
async def label_remove(owner: str, repo: str, n: int, name: str, request: Request, env: Env = Depends(dep)):
    rec = get_issue(env, owner, repo, n)
    if name not in {lb["name"] for lb in rec["labels"]}:
        raise gh_err(404, "Label does not exist")
    rec["labels"] = [lb for lb in rec["labels"] if lb["name"] != name]
    rec["updated_at"] = env.now_iso()
    env.put("github.issues", f"{rec['repo']}#{n}", rec)
    base = api(request, env)
    return [label_obj(base, rec["repo"], lb) for lb in rec["labels"]]
