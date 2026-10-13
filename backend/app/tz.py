"""Deterministic timezone normalization.

The LLM is never allowed to do timezone math. It reports the deadline text as
written plus a timezone token; this module converts it to UTC and JST using
zoneinfo only.
"""
from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

JST = ZoneInfo("Asia/Tokyo")

# Tokens we accept from the extractor -> IANA zone (or fixed offset semantics).
TZ_MAP: dict[str, str] = {
    "JST": "Asia/Tokyo",
    "UTC": "UTC",
    "GMT": "UTC",
    "Z": "UTC",
    "AOE": "Etc/GMT+12",  # Anywhere on Earth == UTC-12
    "PT": "America/Los_Angeles",
    "PST": "America/Los_Angeles",
    "PDT": "America/Los_Angeles",
    "ET": "America/New_York",
    "EST": "America/New_York",
    "EDT": "America/New_York",
    "CT": "America/Chicago",
    "CST": "America/Chicago",
    "MT": "America/Denver",
    "MST": "America/Denver",
    "CET": "Europe/Berlin",
    "CEST": "Europe/Berlin",
    "BST": "Europe/London",
    "KST": "Asia/Seoul",
    "CST_CHINA": "Asia/Shanghai",
    "IST": "Asia/Kolkata",
    "AEST": "Australia/Sydney",
    "AEDT": "Australia/Sydney",
    "HST": "Pacific/Honolulu",
    "AKDT": "America/Anchorage",
}


def normalize_tz_token(token: str | None) -> str:
    """Map an LLM-reported timezone token to an IANA name. Defaults to JST
    for ambiguous Japanese sources is NOT done here -- unknown means UTC with
    low confidence handled by caller."""
    if not token:
        return "UTC"
    t = token.strip().upper()
    return TZ_MAP.get(t, "UTC" if t in ("UTC", "GMT") else token.strip())


def to_jst(deadline_local: str, source_tz: str | None) -> dict:
    """Convert a (naive or offset-aware) ISO deadline string written in
    `source_tz` into UTC and JST. Deterministic -- no LLM involved.

    Returns dict with deadline_utc / deadline_jst ISO strings, the resolved
    zone name, and whether the result had to guess naive-zone handling.
    """
    zone_name = normalize_tz_token(source_tz)
    try:
        zone = ZoneInfo(zone_name)
    except Exception:
        zone_name, zone = "UTC", timezone.utc

    raw = deadline_local.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    dt = None
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        # Common formats like "2026-10-15 23:59"
        for fmt in ("%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M", "%Y-%m-%d %H:%M:%S",
                    "%Y/%m/%d", "%Y-%m-%d"):
            try:
                dt = datetime.strptime(raw, fmt)
                break
            except ValueError:
                continue
    if dt is None:
        raise ValueError(f"unparseable deadline: {deadline_local!r}")

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=zone)  # interpret wall-clock in source zone
    else:
        dt = dt.astimezone(zone)

    dt_utc = dt.astimezone(timezone.utc)
    dt_jst = dt.astimezone(JST)
    return {
        "deadline_utc": dt_utc.isoformat(),
        "deadline_jst": dt_jst.isoformat(),
        "resolved_zone": zone_name,
    }


def now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def now_jst() -> datetime:
    return datetime.now(JST)
