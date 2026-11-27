"""Stripe twin: /e/{env_id}/stripe/v1/..."""
from __future__ import annotations

import copy
import re
from typing import Any, Callable

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from ..envs import Env
from ..ids import stripe_id
from .common import TwinError, get_params, lookup_env, to_int

router = APIRouter(prefix="/e/{env_id}/stripe/v1")


def err(status: int, code: str | None, message: str, param: str | None = None,
        type_: str = "invalid_request_error") -> TwinError:
    e: dict[str, Any] = {"type": type_, "message": message}
    if code:
        e["code"] = code
    if param:
        e["param"] = param
    return TwinError(status, {"error": e})


def missing(kind: str, id_: str, param: str = "id") -> TwinError:
    return err(404, "resource_missing", f"No such {kind}: '{id_}'", param)


def dep(request: Request, env_id: str) -> Env:
    env = lookup_env(request, env_id)
    auth = request.headers.get("authorization", "")
    if not auth:
        raise err(401, None, "You did not provide an API key. You need to provide your API key in the "
                  "Authorization header, using Bearer auth (e.g. 'Authorization: Bearer YOUR_SECRET_KEY').")
    token = auth.split(" ", 1)[-1].strip()
    if not token.startswith("sk_test_"):
        raise err(401, None, f"Invalid API Key provided: {token[:12]}")
    return env


def listing(env: Env, register: str, params: dict, url: str, flt: Callable[[dict], bool] = lambda r: True) -> dict:
    rows = [(i, r) for i, r in enumerate(env.reg(register).values()) if flt(r)]
    rows.sort(key=lambda x: (x[1].get("created", 0), x[0]), reverse=True)
    items = [r for _, r in rows]
    if params.get("starting_after"):
        ids = [r["id"] for r in items]
        if params["starting_after"] in ids:
            items = items[ids.index(params["starting_after"]) + 1:]
    limit = max(1, min(to_int(params.get("limit")) or 10, 100))
    return {"object": "list", "data": copy.deepcopy(items[:limit]), "has_more": len(items) > limit, "url": url}


def idem(env: Env, request: Request, fn: Callable[[], tuple[int, dict]]) -> JSONResponse:
    key = request.headers.get("idempotency-key")
    if key:
        cached = env.reg("stripe.idempotency_keys").get(key)
        if cached:
            return JSONResponse(cached["body"], status_code=cached["status"], headers={"Idempotent-Replayed": "true"})
    try:
        status, body = fn()
    except TwinError as e:
        status, body = e.status, e.body
    if key:
        env.put("stripe.idempotency_keys", key, {"status": status, "body": copy.deepcopy(body)})
    return JSONResponse(body, status_code=status)


# ---------------- customers ----------------
@router.post("/customers")
async def create_customer(request: Request, env: Env = Depends(dep)):
    p = await get_params(request)

    def run():
        cid = stripe_id(env, "cus")
        rec = {"id": cid, "object": "customer", "email": p.get("email"), "name": p.get("name"),
               "description": p.get("description"), "created": env.epoch(), "metadata": p.get("metadata") or {},
               "livemode": False}
        env.put("stripe.customers", cid, rec)
        env.emit("stripe", "customer.created", {"object": rec})
        return 200, rec
    return idem(env, request, run)


@router.get("/customers")
async def list_customers(request: Request, env: Env = Depends(dep)):
    p = await get_params(request)
    email = p.get("email")
    return listing(env, "stripe.customers", p, "/v1/customers", lambda r: not email or r.get("email") == email)


@router.get("/customers/search")
async def search_customers(request: Request, env: Env = Depends(dep)):
    p = await get_params(request)
    m = re.fullmatch(r"\s*email\s*:\s*['\"]([^'\"]*)['\"]\s*", p.get("query", ""))
    if not m:
        raise err(400, "invalid_search_query", "Only the email:'...' query form is supported by this twin.", "query")
    rows = [r for r in env.reg("stripe.customers").values() if r.get("email") == m.group(1)]
    return {"object": "search_result", "data": copy.deepcopy(rows), "has_more": False,
            "url": "/v1/customers/search", "next_page": None}


@router.get("/customers/{cid}")
async def get_customer(cid: str, env: Env = Depends(dep)):
    rec = env.reg("stripe.customers").get(cid)
    if not rec:
        raise missing("customer", cid)
    return rec


@router.post("/customers/{cid}")
async def update_customer(cid: str, request: Request, env: Env = Depends(dep)):
    p = await get_params(request)

    def run():
        rec = env.reg("stripe.customers").get(cid)
        if not rec:
            raise missing("customer", cid)
        for k in ("email", "name", "description"):
            if k in p:
                rec[k] = p[k]
        if isinstance(p.get("metadata"), dict):
            rec["metadata"] = {**rec.get("metadata", {}), **p["metadata"]}
        env.put("stripe.customers", cid, rec)
        return 200, rec
    return idem(env, request, run)


@router.delete("/customers/{cid}")
async def delete_customer(cid: str, env: Env = Depends(dep)):
    if cid not in env.reg("stripe.customers"):
        raise missing("customer", cid)
    env.delete("stripe.customers", cid)
    return {"id": cid, "object": "customer", "deleted": True}


# ---------------- payment intents / charges ----------------
def make_charge(env: Env, amount: int, currency: str, customer: str | None, pi: str | None, desc: str | None) -> dict:
    chid = stripe_id(env, "ch")
    ch = {"id": chid, "object": "charge", "amount": amount, "currency": currency, "customer": customer,
          "status": "succeeded", "paid": True, "refunded": False, "amount_refunded": 0, "payment_intent": pi,
          "description": desc, "created": env.epoch(), "metadata": {}, "livemode": False}
    env.put("stripe.charges", chid, ch)
    env.emit("stripe", "charge.succeeded", {"object": ch})
    return ch


def confirm_pi(env: Env, pi: dict) -> dict:
    if pi["status"] == "succeeded":
        raise err(400, "payment_intent_unexpected_state",
                  f"This PaymentIntent's status is succeeded, so it cannot be confirmed again.", "payment_intent")
    ch = make_charge(env, pi["amount"], pi["currency"], pi.get("customer"), pi["id"], pi.get("description"))
    pi.update(status="succeeded", latest_charge=ch["id"])
    env.put("stripe.payment_intents", pi["id"], pi)
    env.emit("stripe", "payment_intent.succeeded", {"object": pi})
    return pi


@router.post("/payment_intents")
async def create_pi(request: Request, env: Env = Depends(dep)):
    p = await get_params(request)

    def run():
        amount = to_int(p.get("amount"))
        if amount is None:
            raise err(400, "parameter_missing", "Missing required param: amount.", "amount")
        if not p.get("currency"):
            raise err(400, "parameter_missing", "Missing required param: currency.", "currency")
        pid = stripe_id(env, "pi")
        pi = {"id": pid, "object": "payment_intent", "amount": amount, "currency": p["currency"],
              "customer": p.get("customer"), "description": p.get("description"),
              "status": "requires_confirmation", "latest_charge": None, "created": env.epoch(),
              "metadata": p.get("metadata") or {}, "client_secret": f"{pid}_secret_sim"}
        env.put("stripe.payment_intents", pid, pi)
        if str(p.get("confirm", "")).lower() == "true":
            confirm_pi(env, pi)
        return 200, pi
    return idem(env, request, run)


@router.get("/payment_intents")
async def list_pis(request: Request, env: Env = Depends(dep)):
    p = await get_params(request)
    return listing(env, "stripe.payment_intents", p, "/v1/payment_intents",
                   lambda r: not p.get("customer") or r.get("customer") == p["customer"])


@router.get("/payment_intents/{pid}")
async def get_pi(pid: str, env: Env = Depends(dep)):
    rec = env.reg("stripe.payment_intents").get(pid)
    if not rec:
        raise missing("payment_intent", pid)
    return rec


@router.post("/payment_intents/{pid}/confirm")
async def confirm(pid: str, request: Request, env: Env = Depends(dep)):
    def run():
        rec = env.reg("stripe.payment_intents").get(pid)
        if not rec:
            raise missing("payment_intent", pid)
        return 200, confirm_pi(env, rec)
    return idem(env, request, run)


@router.get("/charges")
async def list_charges(request: Request, env: Env = Depends(dep)):
    p = await get_params(request)
    return listing(env, "stripe.charges", p, "/v1/charges",
                   lambda r: not p.get("customer") or r.get("customer") == p["customer"])


@router.get("/charges/{chid}")
async def get_charge(chid: str, env: Env = Depends(dep)):
    rec = env.reg("stripe.charges").get(chid)
    if not rec:
        raise missing("charge", chid)
    return rec


# ---------------- refunds ----------------
@router.post("/refunds")
async def create_refund(request: Request, env: Env = Depends(dep)):
    p = await get_params(request)

    def run():
        chid = p.get("charge")
        pid = p.get("payment_intent")
        if not chid and not pid:
            raise err(400, "parameter_missing", "Must provide either charge or payment_intent.", "charge")
        if not chid:
            pi = env.reg("stripe.payment_intents").get(pid)
            if not pi:
                raise missing("payment_intent", pid, "payment_intent")
            chid = pi.get("latest_charge")
            if not chid:
                raise err(400, "charge_not_refundable", f"PaymentIntent {pid} has no charge to refund.", "payment_intent")
        ch = env.reg("stripe.charges").get(chid)
        if not ch:
            raise err(400, "resource_missing", f"No such charge: '{chid}'", "charge")
        amount = to_int(p.get("amount"))
        remaining = ch["amount"] - ch.get("amount_refunded", 0)
        if amount is None:
            amount = remaining
        if amount <= 0 and remaining > 0:
            raise err(400, "parameter_invalid_integer", "Invalid positive integer", "amount")
        if remaining <= 0 or amount > remaining:
            msg = (f"Charge {chid} has already been refunded." if remaining <= 0 else
                   f"Refund amount ({amount}) is greater than unrefunded amount on charge ({remaining}).")
            raise err(400, "charge_already_refunded", msg, "charge")
        rid = stripe_id(env, "re")
        ref = {"id": rid, "object": "refund", "amount": amount, "charge": chid,
               "payment_intent": ch.get("payment_intent"), "currency": ch["currency"], "status": "succeeded",
               "reason": p.get("reason"), "created": env.epoch(), "metadata": p.get("metadata") or {}}
        env.put("stripe.refunds", rid, ref)
        ch["amount_refunded"] = ch.get("amount_refunded", 0) + amount
        ch["refunded"] = ch["amount_refunded"] >= ch["amount"]
        env.put("stripe.charges", chid, ch)
        env.emit("stripe", "refund.created", {"object": ref})
        env.emit("stripe", "charge.refunded", {"object": ch})
        return 200, ref
    return idem(env, request, run)


@router.get("/refunds")
async def list_refunds(request: Request, env: Env = Depends(dep)):
    p = await get_params(request)
    return listing(env, "stripe.refunds", p, "/v1/refunds",
                   lambda r: (not p.get("charge") or r.get("charge") == p["charge"])
                   and (not p.get("payment_intent") or r.get("payment_intent") == p["payment_intent"]))


@router.get("/refunds/{rid}")
async def get_refund(rid: str, env: Env = Depends(dep)):
    rec = env.reg("stripe.refunds").get(rid)
    if not rec:
        raise missing("refund", rid)
    return rec
