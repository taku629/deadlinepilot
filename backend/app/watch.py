"""Autonomous change monitoring.

Cloud Scheduler calls POST /api/cron/watch every few hours. For each user,
the watcher re-crawls every registered URL source, compares a content
fingerprint with the previous crawl and, only when something changed, wakes
the planner agent with a hint ("this page changed -- diff it against the
saved deadlines"). Unchanged pages cost no LLM tokens.

Also hosts the built-in demo "organizer page" so judges can trigger a real
change (a deadline extension) and watch the agent catch it.
"""
from __future__ import annotations

import asyncio
import hashlib
import html as htmllib
import logging
import re

import httpx
import trafilatura

from .agent.runner import run_agent
from .config import settings
from .security import domain_allowed
from .store import get_store, new_doc
from .tz import now_utc_iso

logger = logging.getLogger("deadlinepilot.watch")

# ---------------------------------------------------------------- fingerprint


def page_text(html: str) -> str:
    text = trafilatura.extract(html) or re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", text).strip()


def fingerprint(html: str) -> str:
    return hashlib.sha256(page_text(html).encode("utf-8")).hexdigest()[:24]


def _fetch_html(url: str) -> str:
    resp = httpx.get(url, follow_redirects=True, timeout=15.0,
                     headers={"User-Agent": "DeadlinePilot-Watcher/1.0"})
    resp.raise_for_status()
    return resp.text[:500_000]


# ----------------------------------------------------------- demo organizer

DEMO_EVENT = "Tokyo AgentOps Challenge 2026"
DEMO_VERSIONS = {
    0: {
        "badge": "",
        "deadline": "November 20, 2026, 23:59 AoE (Anywhere on Earth)",
        "note": "Final submissions are due at the deadline above.",
    },
    1: {
        "badge": "UPDATE (Oct 2026): Deadline extended by one week",
        "deadline": "November 27, 2026, 23:59 AoE (Anywhere on Earth)",
        "note": ("Due to many requests, the final submission deadline has "
                 "been extended by one week. The team merger deadline is "
                 "unchanged."),
    },
}


def demo_state_id(uid: str) -> str:
    return f"demo_notice_{uid}"


def demo_version(uid: str) -> int:
    doc = get_store().get("meta", demo_state_id(uid)) or {}
    return int(doc.get("version", 0))


def set_demo_version(uid: str, version: int) -> None:
    get_store().put("meta", {"id": demo_state_id(uid), "version": version,
                             "updated_at": now_utc_iso()},
                    demo_state_id(uid))


def demo_notice_url(uid: str) -> str:
    return f"{settings.public_base_url}/demo/notice/{uid}"


def render_demo_notice(version: int) -> str:
    v = DEMO_VERSIONS.get(version, DEMO_VERSIONS[0])
    badge = (f'<p class="upd"><strong>{htmllib.escape(v["badge"])}</strong></p>'
             if v["badge"] else "")
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>{DEMO_EVENT} - Important Dates</title>
<style>body{{font-family:sans-serif;max-width:720px;margin:40px auto;
line-height:1.6;padding:0 16px}}.upd{{background:#fff3cd;padding:10px;
border-radius:6px}}.demo{{color:#888;font-size:13px}}</style></head>
<body>
<article>
<h1>{DEMO_EVENT}: Important Dates</h1>
{badge}
<p>Welcome to the {DEMO_EVENT}, an online competition for building
reliable AI agents. Please check the schedule below carefully.</p>
<h2>Schedule</h2>
<p>Team merger deadline: November 6, 2026, 23:59 AoE (Anywhere on Earth).</p>
<p>Final submission deadline: {htmllib.escape(v["deadline"])}.</p>
<p>{htmllib.escape(v["note"])}</p>
<p>Submit your repository link and a 3 minute demo video from the
competition dashboard.</p>
</article>
<p class="demo">This is a fictional organizer page served by DeadlinePilot
for demonstration purposes.</p>
</body></html>"""


# ------------------------------------------------------------------- watcher


async def watch_user(uid: str, trigger: str = "watch",
                     run_id: str = "") -> dict:
    """Re-crawl the user's URL sources; run the agent only on changes."""
    store = get_store()
    sources = [s for s in store.query("sources", {"user_id": uid})
               if s.get("type") == "url" and s.get("url")
               and s.get("status") not in ("quarantined", "pending")]
    label = "定期巡回 (Cloud Scheduler)" if trigger == "schedule" else "手動巡回"
    pre: list[tuple] = [("watch", "watch_start",
                         f"{label}: URLソース {len(sources)} 件を再取得")]
    changed: list[str] = []
    for s in sources:
        url = s["url"]
        if not domain_allowed(url):
            pre.append(("watch", "watch_skip", f"許可リスト外のため対象外: {url}"))
            continue
        try:
            fp = fingerprint(await asyncio.to_thread(_fetch_html, url))
        except Exception as ex:
            pre.append(("watch", "watch_error",
                        f"取得失敗 ({type(ex).__name__}): {url}"))
            continue
        old = s.get("content_hash")
        title = s.get("label") or url
        if old and old != fp:
            changed.append(s["id"])
            store.update("sources", s["id"], {
                "content_hash": fp, "status": "pending",
                "last_checked_at": now_utc_iso(),
                "last_changed_at": now_utc_iso(),
                "updated_at": now_utc_iso()})
            pre.append(("watch", "change_detected",
                        f"変更を検知: {title}（前回 {old[:8]} → 今回 {fp[:8]}）"))
        else:
            store.update("sources", s["id"], {
                "content_hash": fp, "last_checked_at": now_utc_iso()})
            pre.append(("watch", "unchanged", f"変更なし: {title}"))

    meta_id = f"watch_{uid}"
    if changed:
        pre.append(("watch", "wake_agent",
                    f"{len(changed)} 件のページが更新されたためエージェントを起動"))
        hint = ("【定期巡回からの起動】以下のURLソースは前回取得時から内容が"
                "変わっています。fetch_page で再取得して締切を抽出し、"
                "upsert_deadline には必ず同じ source_id を渡してください。"
                "既存の締切と値が変わっていたら（changed=true）、"
                "propose_action(kind='review_flag') で「何が・いつから・"
                "いつに変わったか」を日本語で報告し、新しい締切の "
                "propose_action(kind='ics_event') も提案してください。")
        run = await run_agent(uid, changed, run_id=run_id, trigger=trigger,
                              hint=hint, pre_steps=pre)
    else:
        pre.append(("watch", "sleep",
                    "更新なし。LLM を呼ばずに終了（トークン消費 0）"))
        run = new_doc({
            "user_id": uid, "status": "success", "trigger": trigger,
            "goal": "登録URLの変更監視", "source_ids": [],
            "started_at": now_utc_iso(), "ended_at": now_utc_iso(),
            "steps": [{"seq": i + 1, "kind": k, "name": n, "summary": m,
                       "detail": {}, "latency_ms": 0, "ts": now_utc_iso()}
                      for i, (k, n, m) in enumerate(pre)],
            "tool_calls": 0, "tokens_in": 0, "tokens_out": 0,
            "est_cost_usd": 0.0, "injection_detections": 0,
            "summary": f"{len(sources)} 件のURLを巡回し、変更はありませんでした。",
        })
        rid = store.put("runs", run, run_id or None)
        run["id"] = rid
    store.put("meta", {"id": meta_id, "last_at": now_utc_iso(),
                       "trigger": trigger, "checked": len(sources),
                       "changed": len(changed), "run_id": run["id"]}, meta_id)
    logger.info("watch user=%s checked=%d changed=%d", uid, len(sources),
                len(changed))
    return run


async def watch_all() -> dict:
    store = get_store()
    users = store.query("users", limit=1000)
    out = []
    for u in users:
        try:
            r = await watch_user(u["id"], trigger="schedule")
            out.append({"user": u.get("username"), "run_id": r["id"],
                        "status": r.get("status")})
        except Exception as ex:
            logger.exception("watch failed for %s", u.get("id"))
            out.append({"user": u.get("username"), "error": str(ex)})
    return {"users": len(users), "results": out}
