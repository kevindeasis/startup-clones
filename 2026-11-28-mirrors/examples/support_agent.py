"""Scripted subscription-support agent with a deterministic mock LLM that exhibits two recurring mistakes.

Tools: lookup_account, offer_discount, cancel_subscription, send_troubleshooting_step.
Scenario mix (seeded): 40% cancel, 30% troubleshoot, 30% billing question.
The mock LLM only changes behaviour when the system prompt (base + Steer guidance) says so.
"""
import argparse
import json
import os
import random
import sys

import httpx

from steer_sdk import Steer

BASE_SYSTEM = "You are a helpful subscription-support agent for Acme Notes. Be concise and polite."
SCENARIOS = [("cancel", 0.4), ("troubleshoot", 0.3), ("billing", 0.3)]
SEGMENTS = ["free", "pro", "pro", "enterprise"]


def pick_scenario(rng):
    x, acc = rng.random(), 0.0
    for name, p in SCENARIOS:
        acc += p
        if x < acc:
            return name
    return SCENARIOS[-1][0]


class MockSupportLLM:
    """Deterministic: behaviour depends only on scenario, step and the system prompt text."""

    def reply(self, scenario, step, system, state):
        s = system.lower()
        if scenario == "cancel":
            if step == 0:
                return ("I see your Pro plan. Before you go, would 20% off help?",
                        [("lookup_account", {}, {"plan": "pro", "status": "active"}),
                         ("offer_discount", {"pct": 20}, {"offered": True})])
            if step == 1:
                if "do not offer" in s or "already declined" in s:
                    state["done"] = True
                    return ("Understood. I've cancelled your subscription.",
                            [("cancel_subscription", {}, {"cancelled": True})])
                state["buggy"] = True
                return ("Are you sure? I can do 20% off for six months.",
                        [("offer_discount", {"pct": 20}, {"offered": True})])
            state["done"] = True
            return ("Sorry about that. I've cancelled your subscription.",
                    [("cancel_subscription", {}, {"cancelled": True})])
        if scenario == "troubleshoot":
            if step == 0:
                return ("Sorry to hear that. Please restart the app and try again.",
                        [("send_troubleshooting_step", {"step": "restart_app"}, {"sent": True})])
            if step == 1:
                if "already tried" in s:
                    return ("Thanks for letting me know. Let's clear the app cache next.",
                            [("send_troubleshooting_step", {"step": "clear_cache"}, {"sent": True})])
                state["buggy"] = True
                return ("Please restart the app once more and check again.",
                        [("send_troubleshooting_step", {"step": "restart_app"}, {"sent": True})])
            state["done"] = True
            return (("Glad that fixed it!", []) if not state.get("buggy")
                    else ("I'll escalate this to a specialist.", []))
        # billing
        if step == 0:
            return ("That's your Pro plan renewal for this month.",
                    [("lookup_account", {}, {"plan": "pro", "invoice": 12})])
        state["done"] = True
        return ("Happy to help!", [])


USER_LINES = {
    "cancel": ["Hi, I'd like to cancel my subscription.",
               "No thanks, I just want to cancel.",
               "I already said no! Stop offering discounts, just cancel."],
    "troubleshoot": ["The app keeps crashing when I open it.",
                     "I already restarted it twice and it still crashes.",
                     None],
    "billing": ["Why was I charged $12 this month?", "Thanks, that makes sense."],
}


def user_line(scenario, step, state):
    if scenario == "troubleshoot" and step == 2:
        return "This is useless, I already said I restarted it." if state.get("buggy") \
            else "Clearing the cache fixed it, thanks!"
    return USER_LINES[scenario][step]


def run_conversation(steer: Steer, conv_id: str, scenario: str, user: dict, llm=None, log=None) -> dict:
    llm = llm or MockSupportLLM()
    messages = [{"role": "system", "content": BASE_SYSTEM}]
    state: dict = {}
    delivered_any, step, n_turns = False, 0, 0
    while True:
        messages.append({"role": "user", "content": user_line(scenario, step, state)})
        turn = steer.start_turn(conv_id, step + 1, messages, user)
        ctx = turn.get_context()
        system = BASE_SYSTEM + ("\n\n" + ctx.context if ctx.context else "")
        delivered_any |= bool(ctx.context)
        text, calls = llm.reply(scenario, step, system, state)
        tcs = [{"callId": f"c{step}_{i}", "name": n, "arguments": args} for i, (n, args, _) in enumerate(calls)]
        messages.append({"role": "assistant", "content": text, **({"toolCalls": tcs} if tcs else {})})
        for tc, (_, _, result) in zip(tcs, calls):
            messages.append({"role": "tool", "callId": tc["callId"], "name": tc["name"],
                             "content": json.dumps(result)})
        step += 1
        n_turns += 1
        last = bool(state.get("done"))
        if last:
            success = not state.get("buggy")
            note = "" if success else {"cancel": "customer frustrated by repeated discount offer",
                                       "troubleshoot": "agent repeated troubleshooting step already done"}[scenario]
            turn.capture(final=True, terminal="completed", outcome={"success": success, "note": note})
            return {"conversation_id": conv_id, "scenario": scenario, "success": success, "turns": n_turns,
                    "guidance_delivered": delivered_any}
        turn.capture(final=True, terminal="completed")


def run_batch(steer: Steer, n: int, seed: int, tag: str) -> list:
    rng = random.Random(seed)
    out = []
    for i in range(n):
        scenario = pick_scenario(rng)
        user = {"id": f"u_{tag}_{i}", "segment": rng.choice(SEGMENTS)}
        out.append(run_conversation(steer, f"{tag}-{seed}-{i}", scenario, user))
    return out


def success_rate(results) -> float:
    return sum(r["success"] for r in results) / len(results) if results else 0.0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Run scripted support conversations through the Steer SDK")
    ap.add_argument("--conversations", type=int, default=20)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--agent-id")
    ap.add_argument("--api-url", default=os.environ.get("STEER_API_URL", "http://localhost:8790"))
    ap.add_argument("--tag", choices=["baseline", "after"], default="baseline")
    a = ap.parse_args(argv)
    key = os.environ.get("STEER_API_KEY", "dev")
    agent_id = a.agent_id
    if not agent_id:
        agent_id = httpx.post(a.api_url + "/v1/agents", json={"name": "support-bot"},
                              headers={"X-Steer-Key": key}).json()["id"]
        print("created agent", agent_id)
    steer = Steer(a.api_url, key, agent_id, timeout_ms=2000)
    res = run_batch(steer, a.conversations, a.seed, a.tag)
    print(f"{len(res)} conversations, success rate {success_rate(res):.0%}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
