"""Run orchestration: executes the ADK planner under governance limits and
records a full trace (steps, tokens, latency, cost) into the run document.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re

from ..config import settings
from ..llm import estimate_cost_usd
from ..store import get_store, new_doc
from ..tz import now_utc_iso
from .planner import GOAL, build_planner
from .runctx import RunContext, current

logger = logging.getLogger("deadlinepilot.agent")


def _truncate(s: str, n: int = 400) -> str:
    s = s or ""
    return s if len(s) <= n else s[:n] + "…"


_RUN_ID_RE = re.compile(r"^[a-zA-Z0-9]{8,40}$")


async def run_agent(user_id: str, source_ids: list[str], run_id: str = "",
                    trigger: str = "manual", hint: str = "",
                    pre_steps: list[tuple] | None = None) -> dict:
    """Run the planner against the given sources (or all pending sources).

    run_id may be supplied by the client so the UI can follow the run live
    (it polls GET /api/runs/{id} while this request is in flight).
    trigger: manual | watch | schedule.  hint: extra planner context (e.g.
    "this page changed since the last crawl").  pre_steps: steps to record
    before the planner starts (the watcher's change-detection evidence).
    """
    store = get_store()
    if not source_ids:
        pending = store.query("sources", {"user_id": user_id,
                                          "status": "pending"})
        source_ids = [s["id"] for s in pending]

    if not run_id or not _RUN_ID_RE.match(run_id) or store.get("runs", run_id):
        run_id = ""
    run = new_doc({
        "user_id": user_id, "status": "running", "goal": GOAL,
        "trigger": trigger,
        "source_ids": source_ids, "started_at": now_utc_iso(),
        "steps": [], "tool_calls": 0, "tokens_in": 0, "tokens_out": 0,
        "est_cost_usd": 0.0, "injection_detections": 0,
    })
    run_id = store.put("runs", run, run_id or None)
    ctx = RunContext(run_id=run_id, user_id=user_id)
    token = current.set(ctx)
    for st in pre_steps or []:
        ctx.step(*st)

    logger.info(json.dumps({"event": "run_start", "run_id": run_id,
                            "user_id": user_id, "sources": source_ids}))
    try:
        await asyncio.wait_for(_execute(ctx, source_ids, hint),
                               settings.run_timeout_seconds)
        status, err = "success", ""
        if ctx.limit_hit:
            status, err = "success", f"limit_hit:{ctx.limit_hit}"
    except asyncio.TimeoutError:
        status, err = "error", f"timeout {settings.run_timeout_seconds}s"
        ctx.step("error", "timeout", f"{settings.run_timeout_seconds}s 超過で強制終了")
    except Exception as ex:
        status, err = "error", f"{type(ex).__name__}: {ex}"
        ctx.step("error", "run_failed", _truncate(f"{type(ex).__name__}: {ex}"))
        logger.exception("agent run failed")
    finally:
        current.reset(token)

    patch = {
        "status": status, "ended_at": now_utc_iso(), "error": err,
        "steps": ctx.steps, "tool_calls": ctx.tool_calls,
        "tokens_in": ctx.tokens_in, "tokens_out": ctx.tokens_out,
        "est_cost_usd": round(ctx.est_cost_usd, 6),
        "injection_detections": ctx.injection_detections,
        "summary": next((st["summary"] for st in reversed(ctx.steps)
                         if st["kind"] == "model" and st["name"] == "判断"),
                        ""),
    }
    ctx.live = False
    store.update("runs", run_id, patch)
    for sid in source_ids:
        src = store.get("sources", sid)
        if src and src.get("status") in ("pending", "scanned"):
            store.update("sources", sid, {"status": "processed",
                                          "run_id": run_id,
                                          "updated_at": now_utc_iso()})
    logger.info(json.dumps({"event": "run_end", "run_id": run_id,
                            "status": status, "tool_calls": ctx.tool_calls,
                            "tokens_in": ctx.tokens_in,
                            "tokens_out": ctx.tokens_out,
                            "est_cost_usd": ctx.est_cost_usd,
                            "injections": ctx.injection_detections}))
    run.update(patch)
    run["id"] = run_id
    return run


async def _execute(ctx: RunContext, source_ids: list[str],
                   hint: str = "") -> None:
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types as gt

    agent = build_planner()
    svc = InMemorySessionService()
    runner = Runner(agent=agent, app_name="deadlinepilot",
                    session_service=svc)
    session = await svc.create_session(
        app_name="deadlinepilot", user_id=ctx.user_id,
        session_id=ctx.run_id)

    src_desc = ", ".join(source_ids) if source_ids else "(なし)"
    prompt = (
        f"対象ソースID: {src_desc}\n"
        "各ソースの種類は email（parse_email を使う）か url（fetch_page を"
        "使う）です。ストアの sources/{id} の 'type' フィールドで判断して"
        "ください。ソースの type が分からない場合は parse_email を先に試し、"
        "SOURCE_NOT_FOUND なら fetch_page を対応URLで使ってください。"
        "すべて処理したら検出・登録・提案を行い、サマリーを書いて終了。"
    )
    # Give the planner each source's type + url explicitly to avoid guessing.
    store = get_store()
    parts = []
    for sid in source_ids:
        s = store.get("sources", sid) or {}
        parts.append(f"- {sid}: type={s.get('type')} url={s.get('url')}")
    if parts:
        prompt = "対象ソース一覧:\n" + "\n".join(parts) + "\n" + prompt
    if hint:
        prompt = hint + "\n\n" + prompt

    ctx.step("model", "planner_start", "プランナー起動",
             {"model": settings.planner_model, "sources": source_ids})
    async for event in runner.run_async(
            user_id=ctx.user_id, session_id=session.id,
            new_message=gt.Content(role="user",
                                   parts=[gt.Part(text=prompt)])):
        _record_event(ctx, event)


def _record_event(ctx: RunContext, event) -> None:
    um = getattr(event, "usage_metadata", None)
    if um:
        tin = getattr(um, "prompt_token_count", 0) or 0
        tout = getattr(um, "candidates_token_count", 0) or 0
        ctx.tokens_in += tin
        ctx.tokens_out += tout
        ctx.est_cost_usd += estimate_cost_usd(tin, tout,
                                              settings.planner_model)
    content = getattr(event, "content", None)
    for part in (getattr(content, "parts", None) or []):
        fc = getattr(part, "function_call", None)
        if fc:
            args = dict(getattr(fc, "args", {}) or {})
            ctx.step("io", f"call:{fc.name or '?'}",
                     _truncate(json.dumps(args, ensure_ascii=False, default=str)),
                     {"args": _safe(args)})
        fr = getattr(part, "function_response", None)
        if fr:
            resp = getattr(fr, "response", None)
            ctx.step("io", f"response:{getattr(fr, 'name', '?')}",
                     _truncate(json.dumps(resp, ensure_ascii=False, default=str)
                               if not isinstance(resp, str) else resp))
        txt = getattr(part, "text", None)
        if txt and txt.strip():
            thought = getattr(part, "thought", False)
            ctx.step("model", "思考" if thought else "判断",
                     _truncate(txt.strip()))
    # usage logged to Cloud Logging for observability
    logger = logging.getLogger("deadlinepilot.agent")
    logger.info(json.dumps({"event": "agent_event", "run_id": ctx.run_id,
                            "steps": len(ctx.steps)}))


def _safe(v):
    try:
        json.dumps(v, default=str)
        return v
    except Exception:
        return str(v)
