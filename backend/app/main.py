from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from .agent.runner import run_agent
from .auth import create_user, get_current_user, login
from .config import settings
from .models import LoginRequest, SourceIn
from .store import get_store, new_doc
from .tz import now_utc_iso

logging.basicConfig(
    level=logging.INFO,
    format='{"severity":"%(levelname)s","message":%(message)s}'
    if False else "%(asctime)s %(levelname)s %(name)s %(message)s",
)

app = FastAPI(title="DeadlinePilot API", version="1.0.0")


@app.on_event("startup")
def _startup_seed():
    """Dev/demo convenience: when the store is empty, ensure the judge
    account exists, and seed demo data when SEED_DEMO=true."""
    import os
    store = get_store()
    if not store.query("users", limit=1):
        pw = os.environ.get("JUDGE_PASSWORD", "ChangeMe-Demo-2026!")
        create_user("judge", pw)
    if os.environ.get("SEED_DEMO", "").lower() == "true":
        try:
            from seed.seed import main as seed_main
            seed_main()
        except Exception:
            logging.getLogger(__name__).exception("seed failed")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.frontend_origin.split(",")],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)


@app.get("/api/health")
def health():
    store = get_store()
    return {"ok": True, "store": type(store).__name__,
            "vertex": settings.use_vertexai,
            "model": settings.planner_model,
            "ts": now_utc_iso()}


@app.post("/api/login")
def api_login(body: LoginRequest):
    token = login(body.username.strip(), body.password)
    if not token:
        raise HTTPException(401, "IDまたはパスワードが違います")
    return {"token": token, "username": body.username.strip()}


@app.get("/api/me")
def api_me(user: dict = Depends(get_current_user)):
    return {"username": user["username"], "id": user["id"]}


# ---------- sources ----------

@app.get("/api/sources")
def list_sources(user: dict = Depends(get_current_user)):
    return get_store().query("sources", {"user_id": user["id"]},
                             order_by="created_at")


@app.post("/api/sources")
def add_source(body: SourceIn, user: dict = Depends(get_current_user)):
    if body.type == "url" and not body.url:
        raise HTTPException(400, "URLが必要です")
    if body.type == "email" and not (body.raw_text or "").strip():
        raise HTTPException(400, "メール本文が必要です")
    doc = new_doc({
        "user_id": user["id"], "type": body.type,
        "url": body.url, "raw_text": (body.raw_text or "")[:60000],
        "status": "pending", "injection_flag": "",
    })
    sid = get_store().put("sources", doc)
    return {"id": sid, "status": "pending"}


# ---------- runs ----------

@app.post("/api/runs")
async def start_run(body: dict | None = None,
                    user: dict = Depends(get_current_user)):
    source_ids = (body or {}).get("source_ids") or []
    # Run synchronously so the response carries the finished trace; the UI
    # polls GET /api/runs/{id} for progress while this is in-flight via the
    # background task below for long runs.
    run = await run_agent(user["id"], source_ids)
    return run


@app.get("/api/runs")
def list_runs(user: dict = Depends(get_current_user)):
    rows = get_store().query("runs", {"user_id": user["id"]},
                             order_by="started_at")
    for r in rows:
        r.pop("steps", None)  # list view: no step bodies
    return rows


@app.get("/api/runs/{run_id}")
def get_run(run_id: str, user: dict = Depends(get_current_user)):
    run = get_store().get("runs", run_id)
    if not run or run.get("user_id") != user["id"]:
        raise HTTPException(404, "run not found")
    return run


# ---------- deadlines ----------

@app.get("/api/deadlines")
def list_deadlines(user: dict = Depends(get_current_user)):
    rows = get_store().query("deadlines", {"user_id": user["id"]},
                             order_by="deadline_utc", desc=False)
    now = datetime.now(timezone.utc)
    for d in rows:
        try:
            dt = datetime.fromisoformat(d["deadline_utc"])
            d["hours_left"] = round((dt - now).total_seconds() / 3600, 1)
        except Exception:
            d["hours_left"] = None
    return rows


@app.delete("/api/deadlines/{did}")
def delete_deadline(did: str, user: dict = Depends(get_current_user)):
    d = get_store().get("deadlines", did)
    if not d or d.get("user_id") != user["id"]:
        raise HTTPException(404)
    get_store().delete("deadlines", did)
    return {"ok": True}


# ---------- proposals (human approval gate) ----------

@app.get("/api/proposals")
def list_proposals(user: dict = Depends(get_current_user)):
    return get_store().query("proposals", {"user_id": user["id"]},
                             order_by="created_at")


@app.post("/api/proposals/{pid}/approve")
def approve_proposal(pid: str, user: dict = Depends(get_current_user)):
    store = get_store()
    p = store.get("proposals", pid)
    if not p or p.get("user_id") != user["id"]:
        raise HTTPException(404)
    store.update("proposals", pid, {"status": "approved",
                                    "decided_at": now_utc_iso()})
    return {"ok": True, "status": "approved"}


@app.post("/api/proposals/{pid}/reject")
def reject_proposal(pid: str, user: dict = Depends(get_current_user)):
    store = get_store()
    p = store.get("proposals", pid)
    if not p or p.get("user_id") != user["id"]:
        raise HTTPException(404)
    store.update("proposals", pid, {"status": "rejected",
                                    "decided_at": now_utc_iso()})
    return {"ok": True, "status": "rejected"}


@app.get("/api/proposals/{pid}/ics")
def proposal_ics(pid: str, user: dict = Depends(get_current_user)):
    """Materialize an approved ics_event proposal into a downloadable ICS.
    Only runs when the proposal is approved -- the human gate."""
    store = get_store()
    p = store.get("proposals", pid)
    if not p or p.get("user_id") != user["id"]:
        raise HTTPException(404)
    if p.get("status") != "approved":
        raise HTTPException(409, "承認後にのみICSを生成できます")
    d = store.get("deadlines", p.get("deadline_id") or "") or {}
    dt_utc = d.get("deadline_utc") or p.get("payload", {}).get("deadline_utc")
    title = d.get("title") or p.get("title")
    if not dt_utc:
        raise HTTPException(422, "締切日時が不明です")
    dt = datetime.fromisoformat(dt_utc).strftime("%Y%m%dT%H%M%SZ")
    uid = f"{pid}@deadlinepilot"
    ics = "\r\n".join([
        "BEGIN:VCALENDAR", "VERSION:2.0",
        "PRODID:-//DeadlinePilot//JP", "BEGIN:VEVENT",
        f"UID:{uid}", f"DTSTAMP:{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}",
        f"DTSTART:{dt}", f"SUMMARY:[締切] {title}",
        f"DESCRIPTION:{p.get('detail','')}",
        "BEGIN:VALARM", "TRIGGER:-PT24H", "ACTION:DISPLAY",
        f"DESCRIPTION:{title} の締切が明日です", "END:VALARM",
        "END:VEVENT", "END:VCALENDAR", ""])
    return Response(
        ics, media_type="text/calendar",
        headers={"Content-Disposition":
                 f'attachment; filename="deadline_{pid}.ics"'})


# ---------- stats ----------

@app.get("/api/stats")
def stats(user: dict = Depends(get_current_user)):
    store = get_store()
    runs = store.query("runs", {"user_id": user["id"]})
    props = store.query("proposals", {"user_id": user["id"]})
    sources = store.query("sources", {"user_id": user["id"]})
    deadlines = store.query("deadlines", {"user_id": user["id"]})
    return {
        "runs_total": len(runs),
        "runs_success": sum(1 for r in runs if r.get("status") == "success"),
        "runs_error": sum(1 for r in runs if r.get("status") == "error"),
        "tool_calls": sum(r.get("tool_calls", 0) for r in runs),
        "tokens_in": sum(r.get("tokens_in", 0) for r in runs),
        "tokens_out": sum(r.get("tokens_out", 0) for r in runs),
        "est_cost_usd": round(sum(r.get("est_cost_usd", 0) for r in runs), 6),
        "injection_detections": sum(r.get("injection_detections", 0)
                                    for r in runs),
        "sources_quarantined": sum(1 for s in sources
                                   if s.get("status") == "quarantined"),
        "proposals_pending": sum(1 for p in props
                                 if p.get("status") == "pending"),
        "proposals_approved": sum(1 for p in props
                                  if p.get("status") == "approved"),
        "proposals_rejected": sum(1 for p in props
                                  if p.get("status") == "rejected"),
        "deadlines_total": len(deadlines),
        "deadlines_needs_review": sum(1 for d in deadlines
                                      if d.get("status") in
                                      ("needs_review", "conflict")),
        "limits": {"max_tool_calls": settings.max_tool_calls,
                   "max_total_tokens": settings.max_total_tokens,
                   "run_timeout_s": settings.run_timeout_seconds},
        "allowed_domains": settings.allowed_domains,
    }


def seed_defaults(judge_password: str):
    """Create the judge account if missing (called from seed script)."""
    create_user("judge", judge_password)
