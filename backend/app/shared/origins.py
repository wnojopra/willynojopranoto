"""Origin checks shared by WebSocket endpoints and cookie-authenticated HTTP APIs."""

from __future__ import annotations

import os
from urllib.parse import urlsplit

from fastapi import WebSocket

ALLOWED_ORIGINS = {
    o.strip()
    for o in os.environ.get(
        "SB_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if o.strip()
}


def origin_ok(origin: str | None, host: str | None) -> bool:
    """True for same-origin requests (or the local Vite dev server). Fails closed."""
    if not origin:
        return False
    if origin in ALLOWED_ORIGINS:
        return True
    # Same-origin (production: the frontend is served by this service).
    return bool(host) and urlsplit(origin).netloc == host


def ws_origin_allowed(ws: WebSocket) -> bool:
    """Blocks cross-site WebSocket hijacking: browsers always send Origin."""
    return origin_ok(ws.headers.get("origin"), ws.headers.get("host"))
