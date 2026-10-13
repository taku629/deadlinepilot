"""Thin google-genai wrapper: Vertex AI Gemini calls with JSON schema output
and token accounting for the trace/cost display.
"""
from __future__ import annotations

import threading
from typing import TypeVar

from pydantic import BaseModel

from .config import settings

T = TypeVar("T", bound=BaseModel)

_client = None
_client_lock = threading.Lock()
_usage = threading.local()


def get_client():
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                from google import genai
                if settings.gemini_api_key and not settings.use_vertexai:
                    _client = genai.Client(api_key=settings.gemini_api_key)
                else:
                    _client = genai.Client(
                        vertexai=True,
                        project=settings.gcp_project or None,
                        location=settings.gcp_location,
                    )
    return _client


def last_usage() -> dict:
    return getattr(_usage, "last", {"in": 0, "out": 0})


def generate_json(prompt: str, schema: type[T], model: str | None = None,
                  system: str | None = None) -> T:
    from google.genai import types
    model = model or settings.extractor_model
    cfg = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=schema,
        system_instruction=system,
        temperature=0.1,
    )
    resp = get_client().models.generate_content(
        model=model, contents=prompt, config=cfg)
    um = getattr(resp, "usage_metadata", None)
    _usage.last = {
        "in": getattr(um, "prompt_token_count", 0) or 0,
        "out": getattr(um, "candidates_token_count", 0) or 0,
        "model": model,
    }
    return schema.model_validate_json(resp.text)


def estimate_cost_usd(tokens_in: int, tokens_out: int, model: str) -> float:
    pin, pout = settings.price_table.get(model, (0.30, 2.50))
    return round((tokens_in * pin + tokens_out * pout) / 1_000_000, 6)
