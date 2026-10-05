"""FastAPI entrypoint: WebSocket endpoints for the TV and phones."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.rooms import JoinError, RoomLimitError, RoomManager

logging.basicConfig(level=os.environ.get("SB_LOG_LEVEL", "INFO"))
log = logging.getLogger("spiritboard")

MAX_MESSAGE_BYTES = 512
# Phones send ~20 pulls/sec; allow headroom but cap abuse.
RATE_PER_SEC = 40.0
RATE_BURST = 60.0
MAX_DROPPED_BEFORE_CLOSE = 400
JOIN_TIMEOUT_SECONDS = 30

ALLOWED_ORIGINS = {
    o.strip()
    for o in os.environ.get(
        "SB_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if o.strip()
}

_default_static = Path(__file__).resolve().parents[2] / "frontend" / "dist"
STATIC_DIR = Path(os.environ.get("SB_STATIC_DIR", str(_default_static)))

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self'; "
    "img-src 'self' data:; font-src 'self'; connect-src 'self'; "
    "media-src 'self'; object-src 'none'; base-uri 'none'; "
    "form-action 'self'; frame-ancestors 'none'"
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = CSP
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
        )
        return response


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(SecurityHeadersMiddleware)
manager = RoomManager()


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True}


# ---- WebSocket helpers -----------------------------------------------------


def origin_allowed(ws: WebSocket) -> bool:
    """Blocks cross-site WebSocket hijacking: browsers always send Origin."""
    origin = ws.headers.get("origin")
    if not origin:
        return False
    if origin in ALLOWED_ORIGINS:
        return True
    # Same-origin (production: frontend served by this service).
    return urlsplit(origin).netloc == ws.headers.get("host", "")


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
    """Receives one validated JSON message, or None if it should be ignored."""
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


# ---- TV --------------------------------------------------------------------


@app.websocket("/ws/tv")
async def tv_socket(ws: WebSocket) -> None:
    if not origin_allowed(ws):
        await ws.close(code=1008)
        return
    await ws.accept()
    limiter = RateLimiter()
    room = None
    try:
        msg = await asyncio.wait_for(recv_message(ws, limiter), JOIN_TIMEOUT_SECONDS)
        if not msg or msg["type"] != "create":
            await ws.close(code=1008)
            return
        try:
            room = manager.create_room()
        except RoomLimitError:
            await send_error(ws, "Too many s\u00e9ances right now. Try again later.")
            await ws.close()
            return
        # The TV that created the room is its host for the whole session.
        # TODO(security): host can't reclaim a room after a TV refresh; add a
        # server-issued HttpOnly host cookie if that becomes a problem.
        room.tv_conns.add(ws)
        await ws.send_json({"type": "created", "code": room.code})
        await room.broadcast_state()

        while True:
            msg = await recv_message(ws, limiter)
            if msg is None:
                continue
            kind = msg["type"]
            if kind == "start_round":
                room.start_round()
            elif kind == "add_bot":
                room.add_bot()
            elif kind == "remove_bot":
                room.remove_bot()
            elif kind == "back_to_lobby":
                room.back_to_lobby()
            elif kind == "kick":
                pid = msg.get("playerId")
                if isinstance(pid, str):
                    conn = room.player_conns.pop(pid, None)
                    room.remove_player(pid)
                    if conn is not None:
                        try:
                            await send_error(conn, "The host removed you from the s\u00e9ance.")
                            await conn.close()
                        except Exception:
                            pass
            else:
                continue
            room.touch()
            await room.broadcast_state()
    except (WebSocketDisconnect, ClientGone, asyncio.TimeoutError):
        pass
    finally:
        if room is not None:
            room.tv_conns.discard(ws)
            room.touch()


# ---- Phones ----------------------------------------------------------------


@app.websocket("/ws/play")
async def play_socket(ws: WebSocket) -> None:
    if not origin_allowed(ws):
        await ws.close(code=1008)
        return
    await ws.accept()
    limiter = RateLimiter()
    room = None
    player = None
    try:
        msg = await asyncio.wait_for(recv_message(ws, limiter), JOIN_TIMEOUT_SECONDS)
        if not msg or msg["type"] != "join":
            await ws.close(code=1008)
            return
        room = manager.get(msg.get("code"))
        if room is None:
            await send_error(ws, "No s\u00e9ance with that code.")
            await ws.close()
            return
        try:
            player = room.add_player(msg.get("name"))
        except JoinError as e:
            await send_error(ws, str(e))
            await ws.close()
            return
        room.player_conns[player.id] = ws
        await ws.send_json({"type": "joined", "playerId": player.id, "code": room.code})
        await room.broadcast_state()

        while True:
            msg = await recv_message(ws, limiter)
            if msg is None:
                continue
            if msg["type"] == "pull":
                room.set_pull(player.id, msg.get("dx"), msg.get("dy"))
    except (WebSocketDisconnect, ClientGone, asyncio.TimeoutError):
        pass
    finally:
        if room is not None and player is not None:
            if room.player_conns.get(player.id) is ws:
                room.player_conns.pop(player.id, None)
                room.mark_disconnected(player.id)
                try:
                    await room.broadcast_state()
                except Exception:
                    pass


# ---- Static frontend (production) -------------------------------------------

if STATIC_DIR.is_dir():
    _index = STATIC_DIR / "index.html"

    @app.get("/tv")
    @app.get("/play")
    async def spa_routes() -> FileResponse:
        return FileResponse(_index, headers={"Cache-Control": "no-store"})

    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
