"""Per-run execution context shared with tools via a contextvar.

Holds the governance budget (tool-call cap, token cap), the trace sink and
the run/user identity so tools can record every step.
"""
from __future__ import annotations

import contextvars
import time
from dataclasses import dataclass, field

from ..config import settings
from ..tz import now_utc_iso

current: contextvars.ContextVar["RunContext | None"] = contextvars.ContextVar(
    "dp_runctx", default=None)


@dataclass
class RunContext:
    run_id: str
    user_id: str
    source_id: str | None = None
    max_tool_calls: int = settings.max_tool_calls
    max_total_tokens: int = settings.max_total_tokens
    steps: list[dict] = field(default_factory=list)
    tool_calls: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    est_cost_usd: float = 0.0
    injection_detections: int = 0
    limit_hit: str = ""

    def step(self, kind: str, name: str = "", summary: str = "",
             detail: dict | None = None, latency_ms: int = 0) -> None:
        self.steps.append({
            "seq": len(self.steps) + 1,
            "kind": kind,
            "name": name,
            "summary": summary[:600],
            "detail": detail or {},
            "latency_ms": latency_ms,
            "ts": now_utc_iso(),
        })

    def check_tool_budget(self, tool_name: str) -> str | None:
        """Return an error string when governance limits are hit."""
        if self.tool_calls >= self.max_tool_calls:
            self.limit_hit = "tool_call_limit"
            return (f"GOVERNANCE_LIMIT: ツール呼び出し上限 "
                    f"({self.max_tool_calls}) に達しました。これ以上ツールは"
                    f"呼べません。現在の情報で propose_action してください。")
        if self.tokens_in + self.tokens_out >= self.max_total_tokens:
            self.limit_hit = "token_limit"
            return ("GOVERNANCE_LIMIT: トークン上限に達しました。"
                    "現在の情報で propose_action してください。")
        return None

    def use_tool(self, tool_name: str):
        return _ToolTimer(self, tool_name)


class _ToolTimer:
    def __init__(self, ctx: "RunContext", name: str):
        self.ctx, self.name = ctx, name
        self.t0 = time.monotonic()
        ctx.tool_calls += 1

    def finish(self, result_summary: str, detail: dict | None = None):
        ms = int((time.monotonic() - self.t0) * 1000)
        self.ctx.step("tool_result", self.name, result_summary, detail, ms)


def get_ctx() -> RunContext:
    ctx = current.get()
    if ctx is None:
        raise RuntimeError("no run context")
    return ctx
