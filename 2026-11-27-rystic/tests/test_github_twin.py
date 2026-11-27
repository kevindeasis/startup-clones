from github import Auth, Github

from conftest import GHP

SEED = {"github.repos": {"acme/widgets": {}},
        "github.issues": {"acme/widgets#1": {"title": "crash", "body": "boom"},
                          "acme/widgets#2": {"title": "feature", "labels": ["enhancement"]},
                          "acme/widgets#3": {"title": "old", "state": "closed"}}}


def gh(env_id, path):
    return f"/e/{env_id}/github{path}"


def test_auth_and_error_shape(live, env_id):
    r = live.http.get(gh(env_id, "/repos/acme/widgets"))
    assert r.status_code == 401 and r.json()["message"] == "Requires authentication"
    live.http.post(f"/_sim/envs/{env_id}/seed", json=SEED)
    r = live.http.get(gh(env_id, "/repos/acme/nope"), headers=GHP)
    assert r.status_code == 404 and r.json() == {"message": "Not Found", "documentation_url": "https://docs.github.com/rest"}
    r = live.http.get(gh(env_id, "/repos/acme/widgets"), headers={"Authorization": "token ghp_abc"})
    assert r.status_code == 200 and r.json()["full_name"] == "acme/widgets"
    assert r.headers["x-ratelimit-limit"] == "5000" and "x-ratelimit-remaining" in r.headers and "x-ratelimit-reset" in r.headers


def test_issue_lifecycle(live, env_id):
    live.http.post(f"/_sim/envs/{env_id}/seed", json=SEED)
    opened = live.http.get(gh(env_id, "/repos/acme/widgets/issues"), headers=GHP).json()
    assert [i["number"] for i in opened] == [2, 1]
    new = live.http.post(gh(env_id, "/repos/acme/widgets/issues"), json={"title": "new one", "labels": ["bug"]}, headers=GHP)
    assert new.status_code == 201 and new.json()["number"] == 4
    c = live.http.post(gh(env_id, "/repos/acme/widgets/issues/4/comments"), json={"body": "hi"}, headers=GHP)
    assert c.status_code == 201
    p = live.http.patch(gh(env_id, "/repos/acme/widgets/issues/4"), json={"state": "closed"}, headers=GHP).json()
    assert p["state"] == "closed" and p["closed_at"]
    types = [e["type"] for e in live.http.get(f"/_sim/envs/{env_id}/egress").json()["events"]]
    assert types == ["github.issue.opened", "github.issue.labeled", "github.issue.commented", "github.issue.closed"]


def test_labels_add_remove_and_validation(live, env_id):
    live.http.post(f"/_sim/envs/{env_id}/seed", json=SEED)
    r = live.http.post(gh(env_id, "/repos/acme/widgets/issues/1/labels"), json=["bug", "p1"], headers=GHP)
    assert [x["name"] for x in r.json()] == ["bug", "p1"]
    r = live.http.delete(gh(env_id, "/repos/acme/widgets/issues/1/labels/p1"), headers=GHP)
    assert [x["name"] for x in r.json()] == ["bug"]
    assert live.http.delete(gh(env_id, "/repos/acme/widgets/issues/1/labels/zzz"), headers=GHP).status_code == 404
    bad = live.http.post(gh(env_id, "/repos/acme/widgets/issues"), json={"body": "x"}, headers=GHP)
    assert bad.status_code == 422 and bad.json()["message"] == "Validation Failed"
    names = [x["name"] for x in live.http.get(gh(env_id, "/repos/acme/widgets/labels"), headers=GHP).json()]
    assert {"bug", "p1", "enhancement"} <= set(names) or {"bug", "p1"} <= set(names)


def test_rate_limit_endpoint(live, env_id):
    r = live.http.get(gh(env_id, "/rate_limit"), headers=GHP).json()
    assert r["resources"]["core"]["limit"] == 5000


def test_sdk_pygithub_list_and_label(live, env_id):
    live.http.post(f"/_sim/envs/{env_id}/seed", json=SEED)
    g = Github(auth=Auth.Token("ghp_placeholder"), base_url=f"{live.base}/e/{env_id}/github")
    repo = g.get_repo("acme/widgets")
    issues = list(repo.get_issues(state="open"))
    assert sorted(i.number for i in issues) == [1, 2]
    issue = next(i for i in issues if i.number == 1)
    issue.add_to_labels("bug")
    again = repo.get_issue(1)
    assert [lb.name for lb in again.labels] == ["bug"]
    issue.create_comment("triaged")
    assert repo.get_issue(1).comments == 1
