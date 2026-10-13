"""Simple ID/password auth: scrypt hash in users collection,
itsdangerous-signed bearer tokens. No external identity needed."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from .config import settings
from .store import get_store, new_doc

_bearer = HTTPBearer(auto_error=False)
_serializer = URLSafeTimedSerializer(settings.session_secret, salt="dp-session")
TOKEN_TTL = 60 * 60 * 24 * 7  # 7 days


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
    return base64.b64encode(salt + dk).decode()


def verify_password(password: str, stored: str) -> bool:
    try:
        raw = base64.b64decode(stored)
        salt, dk = raw[:16], raw[16:]
        check = hashlib.scrypt(password.encode(), salt=salt,
                               n=16384, r=8, p=1)
        return hmac.compare_digest(dk, check)
    except Exception:
        return False


def create_user(username: str, password: str) -> dict:
    store = get_store()
    existing = store.query("users", {"username": username}, limit=1)
    if existing:
        return existing[0]
    user = new_doc({"username": username,
                    "password_hash": hash_password(password)})
    user["id"] = store.put("users", user)
    return user


def login(username: str, password: str) -> str | None:
    store = get_store()
    rows = store.query("users", {"username": username}, limit=1)
    if not rows or not verify_password(password, rows[0]["password_hash"]):
        return None
    return _serializer.dumps({"u": rows[0]["id"], "n": username})


def get_current_user(
        creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    if creds is None:
        raise HTTPException(401, "未認証です")
    try:
        data = _serializer.loads(creds.credentials, max_age=TOKEN_TTL)
    except (BadSignature, SignatureExpired):
        raise HTTPException(401, "セッションが無効です。再ログインしてください。")
    user = get_store().get("users", data["u"])
    if not user:
        raise HTTPException(401, "ユーザーが見つかりません")
    return user
