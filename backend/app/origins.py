"""Origin checks shared by the WebSocket endpoints and the cookie-authenticated HTTP API."""

from __future__ import annotations

import os
from urllib.parse import urlsplit

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
