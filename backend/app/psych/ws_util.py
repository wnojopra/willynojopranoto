"""WebSocket helpers for Psychological.

Deliberately a small copy of the ones in app/main.py, so this game never imports
Spirit Board's entrypoint (which would also be a circular import).
"""

from __future__ import annotations

import json
import time
from typing import Any

from fastapi import WebSocket

# Turn-based: phones send a handful of messages per turn.
MAX_MESSAGE_BYTES = 256
RATE_PER_SEC = 10.0
RATE_BURST = 20.0
MAX_DROPPED_BEFORE_CLOSE = 200


class RateLimiter:
    def __init__(self) -> None:
        self.tokens = RATE_BURST
        self.last = time.monotonic()
        self.dropped = 0

    def allow(self) -> bool:
        now = time.monotonic()
        self.tokens = min(RATE_BURST, self.tokens + (now - self.last) * RATE_PER_SEC)
        self.last = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        self.dropped += 1
        return False


class ClientGone(Exception):
    pass


async def recv_message(ws: WebSocket, limiter: RateLimiter) -> dict[str, Any] | None:
    """Receives one validated JSON object, or None if it should be ignored."""
    text = await ws.receive_text()
    if not limiter.allow():
        if limiter.dropped > MAX_DROPPED_BEFORE_CLOSE:
            raise ClientGone()
        return None
    if len(text) > MAX_MESSAGE_BYTES:
        return None
    try:
        msg = json.loads(text)
    except ValueError:
        return None
    if not isinstance(msg, dict) or not isinstance(msg.get("type"), str):
        return None
    return msg


async def send_error(ws: WebSocket, message: str) -> None:
    await ws.send_json({"type": "error", "message": message})
