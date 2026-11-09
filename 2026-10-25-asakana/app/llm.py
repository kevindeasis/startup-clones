"""LLM extraction: Anthropic (tool-use forced JSON) or a deterministic mock."""
from __future__ import annotations

import base64
import io
import json
import os
from pathlib import Path

import anthropic
from pydantic import ValidationError

from .llm_mock import mock_extract
from .models import ExtractedOrder, InboundMessage, PipelineContext

SYSTEM_RULES = """You are an order-desk assistant for a seafood distributor. Restaurants send \
messy orders by email, text, or photo of a handwritten note. Turn the message into a structured \
order by calling the submit_order tool.
Rules:
- Never invent items. Only extract what the customer actually asked for.
- Keep raw_text verbatim as written by the customer.
- qty and unit exactly as written (e.g. 2 / "cs"); do not convert units.
- Put anything uncertain or ambiguous in `questions` for a human to confirm.
- Resolve relative dates ("Friday", "tmrw") to an ISO delivery_date using today's date.
- If the customer references a past order ("same as last Friday", "the usual"), set repeat_reference.
- Messages may be in English, Spanish, Japanese, Chinese or Korean (including romaji shorthand)."""


def provider_name() -> str:
    p = (os.environ.get("LLM_PROVIDER") or "").strip().lower()
    if p in ("anthropic", "mock"):
        return p
    return "anthropic" if os.environ.get("ANTHROPIC_API_KEY") else "mock"


def model_name() -> str:
    return os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-5") if provider_name() == "anthropic" else "mock-v1"


def _inline_refs(schema: dict) -> dict:
    defs = schema.get("$defs", {})

    def walk(node):
        if isinstance(node, dict):
            if "$ref" in node:
                return walk(defs[node["$ref"].split("/")[-1]])
            return {k: walk(v) for k, v in node.items() if k != "$defs"}
        if isinstance(node, list):
            return [walk(v) for v in node]
        return node

    return walk(schema)


def tool_schema() -> dict:
    return {
        "name": "submit_order",
        "description": "Submit the structured order extracted from the customer's message.",
        "input_schema": _inline_refs(ExtractedOrder.model_json_schema()),
    }


def build_system_prompt(ctx: PipelineContext) -> str:
    parts = [SYSTEM_RULES, f"\nToday's date: {ctx.today.isoformat()} ({ctx.today.strftime('%A')})"]
    if ctx.customer_name:
        parts.append(f"\nCustomer: {ctx.customer_name}")
        if ctx.customer_aliases:
            parts.append("Known shorthand: " + "; ".join(ctx.customer_aliases))
        if ctx.recent_orders:
            parts.append("Last orders:\n" + "\n".join(ctx.recent_orders))
    else:
        parts.append("\nCustomer: unknown (infer from sender/signature into customer_name_hint)")
    parts.append("\nCatalog (SKU | name | unit | pack):")
    parts += [f"{c['sku']} | {c['name']} | {c['unit']} | {c['pack_size']}" for c in ctx.catalog]
    return "\n".join(parts)


def image_block(path: str) -> dict:
    """Base64 image block, resized to <=1568px longest side."""
    from PIL import Image

    with Image.open(path) as im:
        im = im.convert("RGB")
        im.thumbnail((1568, 1568))
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=88)
    data = base64.standard_b64encode(buf.getvalue()).decode()
    return {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}}


def _has_image(message: InboundMessage) -> bool:
    return message.attachment_kind == "image" and bool(message.attachment_path) and Path(message.attachment_path).exists()


def _anthropic_extract(message: InboundMessage, ctx: PipelineContext) -> ExtractedOrder:
    client = anthropic.Anthropic()
    content: list[dict] = []
    text = message.body_text or ""
    if message.subject:
        text = f"Subject: {message.subject}\n{text}"
    if message.sender:
        text = f"From: {message.sender}\n{text}"
    content.append({"type": "text", "text": text.strip() or "(no text; see attached image)"})
    if _has_image(message):
        content.append(image_block(message.attachment_path))
    messages = [{"role": "user", "content": content}]
    system = build_system_prompt(ctx)
    tool = tool_schema()
    last_err = None
    for attempt in range(2):
        resp = client.messages.create(
            model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-5"),
            max_tokens=2048,
            system=system,
            tools=[tool],
            tool_choice={"type": "tool", "name": "submit_order"},
            messages=messages,
        )
        block = next((b for b in resp.content if getattr(b, "type", "") == "tool_use"), None)
        if block is None:
            last_err = ValueError("no tool_use block returned")
        else:
            try:
                return ExtractedOrder.model_validate(block.input)
            except ValidationError as e:
                last_err = e
                messages = messages + [
                    {"role": "assistant", "content": [{"type": "tool_use", "id": block.id,
                                                       "name": "submit_order", "input": block.input}]},
                    {"role": "user", "content": [{"type": "tool_result", "tool_use_id": block.id,
                                                  "is_error": True,
                                                  "content": f"Validation error, please fix: {e}"}]},
                ]
    raise RuntimeError(f"LLM output failed validation: {last_err}")


def extract_order(message: InboundMessage, context: PipelineContext) -> ExtractedOrder:
    if provider_name() == "anthropic":
        return _anthropic_extract(message, context)
    return mock_extract(message.body_text or "", context, has_image=_has_image(message))
