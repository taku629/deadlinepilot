"""Storage layer: Firestore in production, in-memory for local dev/tests."""
from __future__ import annotations

import threading
import uuid
from typing import Any

from .config import settings
from .tz import now_utc_iso

_lock = threading.Lock()


def _id() -> str:
    return uuid.uuid4().hex[:16]


class MemoryStore:
    """Simple dict-backed store implementing the same interface as Firestore."""
    def __init__(self):
        from collections import defaultdict
        self.data: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)

    # -- generic helpers -------------------------------------------------
    def put(self, coll: str, doc: dict, doc_id: str | None = None) -> str:
        with _lock:
            did = doc_id or doc.get("id") or _id()
            doc = dict(doc)
            doc["id"] = did
            self.data[coll][did] = doc
            return did

    def get(self, coll: str, doc_id: str) -> dict | None:
        return self.data[coll].get(doc_id)

    def update(self, coll: str, doc_id: str, patch: dict) -> dict | None:
        with _lock:
            d = self.data[coll].get(doc_id)
            if d is None:
                return None
            d.update(patch)
            return d

    def query(self, coll: str, filters: dict | None = None,
              order_by: str | None = None, desc: bool = True,
              limit: int = 500) -> list[dict]:
        rows = list(self.data[coll].values())
        for k, v in (filters or {}).items():
            rows = [r for r in rows if r.get(k) == v]
        if order_by:
            rows.sort(key=lambda r: r.get(order_by) or "", reverse=desc)
        return rows[:limit]

    def delete(self, coll: str, doc_id: str) -> None:
        self.data[coll].pop(doc_id, None)


class FirestoreStore:
    def __init__(self, project: str):
        from google.cloud import firestore  # lazy import
        self.db = firestore.Client(project=project or None)

    def put(self, coll: str, doc: dict, doc_id: str | None = None) -> str:
        did = doc_id or doc.get("id") or _id()
        doc = dict(doc)
        doc["id"] = did
        self.db.collection(coll).document(did).set(doc)
        return did

    def get(self, coll: str, doc_id: str) -> dict | None:
        snap = self.db.collection(coll).document(doc_id).get()
        return snap.to_dict() if snap.exists else None

    def update(self, coll: str, doc_id: str, patch: dict) -> dict | None:
        ref = self.db.collection(coll).document(doc_id)
        ref.update(patch)
        snap = ref.get()
        return snap.to_dict() if snap.exists else None

    def query(self, coll: str, filters: dict | None = None,
              order_by: str | None = None, desc: bool = True,
              limit: int = 500) -> list[dict]:
        # filter server-side (single-field indexes only), sort client-side
        # so no composite indexes are required.
        q = self.db.collection(coll)
        for k, v in (filters or {}).items():
            q = q.where(k, "==", v)
        rows = [d.to_dict() for d in q.limit(2000).stream()]
        if order_by:
            rows.sort(key=lambda r: r.get(order_by) or "", reverse=desc)
        return rows[:limit]

    def delete(self, coll: str, doc_id: str) -> None:
        self.db.collection(coll).document(doc_id).delete()


_store = None


def get_store():
    global _store
    if _store is None:
        if settings.use_firestore and settings.gcp_project:
            try:
                _store = FirestoreStore(settings.gcp_project)
                _store.query("users", limit=1)  # probe
            except Exception:
                _store = MemoryStore()
        else:
            _store = MemoryStore()
    return _store


# ---- convenience domain helpers ------------------------------------------

def new_doc(extra: dict) -> dict:
    d = {"created_at": now_utc_iso(), "updated_at": now_utc_iso()}
    d.update(extra)
    return d
