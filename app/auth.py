"""Single-password authentication, signed session cookies and brute-force
protection — all in memory, nothing stored in the database.

The shared password comes from LOGBOOK_PASSWORD (required) and is hashed with
bcrypt at import time. Session cookies are signed with SESSION_SECRET (a random
one is generated if unset, which invalidates sessions on restart).
"""
import math
import os
import secrets
import sys
import time

import bcrypt
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

# ---------------------------------------------------------------------------
# Password (required) — hashed in memory on startup.
# ---------------------------------------------------------------------------
_PASSWORD = os.environ.get("LOGBOOK_PASSWORD")
if not _PASSWORD:
    sys.stderr.write(
        "LOGBOOK_PASSWORD environment variable is not set. "
        "Set it in docker-compose.yml\n"
    )
    raise SystemExit(1)

_PASSWORD_HASH = bcrypt.hashpw(_PASSWORD.encode("utf-8"), bcrypt.gensalt())
# Drop the plaintext reference; only the hash is kept.
del _PASSWORD


def verify_password(candidate: str) -> bool:
    try:
        return bcrypt.checkpw((candidate or "").encode("utf-8"), _PASSWORD_HASH)
    except (ValueError, TypeError):
        return False


# ---------------------------------------------------------------------------
# Session cookie signing.
# ---------------------------------------------------------------------------
COOKIE_NAME = "logbook_session"
COOKIE_MAX_AGE = 30 * 24 * 3600  # 30 days

_SESSION_SECRET = os.environ.get("SESSION_SECRET")
if not _SESSION_SECRET:
    _SESSION_SECRET = secrets.token_urlsafe(48)
    sys.stderr.write(
        "SESSION_SECRET not set — generated a random one. "
        "Sessions will be invalidated when the container restarts.\n"
    )

_serializer = URLSafeTimedSerializer(_SESSION_SECRET, salt="logbook-session")


def create_session_token() -> str:
    return _serializer.dumps({"auth": True})


def _token_valid(token: str) -> bool:
    try:
        _serializer.loads(token, max_age=COOKIE_MAX_AGE)
        return True
    except (BadSignature, SignatureExpired, Exception):
        return False


def is_authenticated(request) -> bool:
    token = request.cookies.get(COOKIE_NAME)
    return bool(token) and _token_valid(token)


# ---------------------------------------------------------------------------
# Brute-force protection (in-memory, per IP).
# ---------------------------------------------------------------------------
MAX_ATTEMPTS = 5
BLOCK_SECONDS = 15 * 60  # 15 minutes

# ip -> {"count": int, "window_start": float, "blocked_until": float}
_attempts: dict[str, dict] = {}


def client_ip(request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def block_remaining_seconds(ip: str) -> int:
    """Return seconds remaining on an active block, else 0."""
    rec = _attempts.get(ip)
    if not rec:
        return 0
    remaining = rec.get("blocked_until", 0) - time.time()
    return int(math.ceil(remaining)) if remaining > 0 else 0


def record_failure(ip: str) -> None:
    now = time.time()
    rec = _attempts.get(ip)
    # Start a fresh window if none exists or the previous one has elapsed.
    if not rec or now - rec.get("window_start", now) > BLOCK_SECONDS:
        rec = {"count": 0, "window_start": now, "blocked_until": 0.0}
    rec["count"] += 1
    if rec["count"] >= MAX_ATTEMPTS:
        rec["blocked_until"] = now + BLOCK_SECONDS
    _attempts[ip] = rec


def reset_attempts(ip: str) -> None:
    _attempts.pop(ip, None)


def block_message(remaining_seconds: int) -> str:
    minutes = max(1, math.ceil(remaining_seconds / 60))
    return f"Too many attempts. Try again in {minutes} minutes."
