"""Shared WebSocket rate limiting and JSON message validation."""

from __future__ import annotations

import json
import time
from typing import Any

from fastapi import WebSocket


class RateLimiter:
    def __init__(
        self,
        *,
        rate_per_sec: float = 40.0,
        burst: float = 60.0,
        max_dropped: int = 400,
    ) -> None:
        self.rate_per_sec = rate_per_sec
        self.burst = burst
        self.max_dropped = max_dropped
        self.tokens = burst
        self.last = time.monotonic()
        self.dropped = 0

    def allow(self) -> bool:
        now = time.monotonic()
        self.tokens = min(
            self.burst, self.tokens + (now - self.last) * self.rate_per_sec
        )
        self.last = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        self.dropped += 1
        return False


class ClientGone(Exception):
    pass


async def recv_message(
    ws: WebSocket,
    limiter: RateLimiter,
    *,
    max_bytes: int = 512,
    large_types: dict[str, int] | None = None,
) -> dict[str, Any] | None:
    """Receives one validated JSON message, or None if it should be ignored."""
    text = await ws.receive_text()
    if not limiter.allow():
        if limiter.dropped > limiter.max_dropped:
            raise ClientGone()
        return None
    hard_cap = max([max_bytes, *(large_types.values() if large_types else ())])
    if len(text) > hard_cap:
        return None
    try:
        msg = json.loads(text)
    except ValueError:
        return None
    if not isinstance(msg, dict) or not isinstance(msg.get("type"), str):
        return None
    allowed_bytes = (
        large_types.get(msg["type"], max_bytes) if large_types else max_bytes
    )
    if len(text) > allowed_bytes:
        return None
    return msg


async def send_error(ws: WebSocket, message: str) -> None:
    await ws.send_json({"type": "error", "message": message})
