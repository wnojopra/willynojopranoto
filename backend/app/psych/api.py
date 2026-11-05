"""WebSocket endpoints for Psychological: /ws/psych/tv and /ws/psych/play."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.psych.rooms import JoinError, PsychRoomManager, RoomLimitError
from app.shared.cookies import device_of
from app.shared.origins import ws_origin_allowed as _origin_allowed
from app.shared.ws import ClientGone, RateLimiter, recv_message as _shared_recv, send_error

log = logging.getLogger("psychological")

JOIN_TIMEOUT_SECONDS = 30
# Turn-based: phones send a handful of messages per turn.
MAX_MESSAGE_BYTES = 256
# Only "selfie" messages may be bigger (a ~128px JPEG as a data URL).
MAX_SELFIE_MESSAGE_BYTES = 26_000
RATE_PER_SEC = 10.0
RATE_BURST = 20.0
MAX_DROPPED_BEFORE_CLOSE = 200

router = APIRouter()
manager = PsychRoomManager()


def _new_limiter() -> RateLimiter:
    return RateLimiter(
        rate_per_sec=RATE_PER_SEC,
        burst=RATE_BURST,
        max_dropped=MAX_DROPPED_BEFORE_CLOSE,
    )


async def recv_message(ws: WebSocket, limiter: RateLimiter) -> dict | None:
    return await _shared_recv(
        ws,
        limiter,
        max_bytes=MAX_MESSAGE_BYTES,
        large_types={"selfie": MAX_SELFIE_MESSAGE_BYTES},
    )


@router.websocket("/ws/psych/tv")
async def tv_socket(ws: WebSocket) -> None:
    if not _origin_allowed(ws):
        await ws.close(code=1008)
        return
    await ws.accept()
    limiter = _new_limiter()
    room = None
    try:
        msg = await asyncio.wait_for(recv_message(ws, limiter), JOIN_TIMEOUT_SECONDS)
        if not msg or msg["type"] != "create":
            await ws.close(code=1008)
            return
        device = device_of(ws.cookies)
        # A refreshed TV gets its room back only from the browser that made it.
        old = manager.get(msg.get("resume"))
        if old is not None and old.is_host(device):
            room = old
        else:
            try:
                room = manager.create_room()
            except RoomLimitError:
                await send_error(ws, "Too many games right now. Try again later.")
                await ws.close()
                return
            room.host_device = device
        room.tv_conns.add(ws)
        room.touch()
        await ws.send_json({"type": "created", "code": room.code})
        await ws.send_json(room.avatars_msg())
        await room.broadcast_state()

        while True:
            msg = await recv_message(ws, limiter)
            if msg is None:
                continue
            kind = msg["type"]
            if kind == "start":
                room.start()
            elif kind == "next_turn":
                room.next_turn()
            elif kind == "skip":
                room.skip()
            elif kind == "redraw":
                room.redraw()
            elif kind == "move_seat":
                room.move_seat(msg.get("playerId"), msg.get("dir"))
            elif kind == "set_target":
                room.set_target(msg.get("target"))
            elif kind == "set_deck":
                room.set_deck(msg.get("axis"), msg.get("deck"))
            elif kind == "set_opinions":
                room.set_opinions(msg.get("on"))
            elif kind == "set_opinion_points":
                room.set_opinion_points(msg.get("on"))
            elif kind == "adjust_score":
                room.adjust_score(msg.get("playerId"), msg.get("delta"))
            elif kind == "add_bot":
                room.add_bot()
            elif kind == "remove_bot":
                room.remove_bot()
            elif kind == "play_again":
                room.play_again()
            elif kind == "kick":
                pid = msg.get("playerId")
                if isinstance(pid, str):
                    conn = room.player_conns.pop(pid, None)
                    had_avatar = pid in room.avatars
                    room.remove_player(pid)
                    if had_avatar:
                        await room.broadcast_avatars()
                    if conn is not None:
                        try:
                            await send_error(conn, "The host removed you from the game.")
                            await conn.close()
                        except Exception:
                            pass
            else:
                continue
            room.touch()
            await room.broadcast_state()
            await room.send_private()
    except (WebSocketDisconnect, ClientGone, asyncio.TimeoutError):
        pass
    finally:
        if room is not None:
            room.tv_conns.discard(ws)
            room.touch()


@router.websocket("/ws/psych/play")
async def play_socket(ws: WebSocket) -> None:
    if not _origin_allowed(ws):
        await ws.close(code=1008)
        return
    await ws.accept()
    limiter = _new_limiter()
    room = None
    player = None
    try:
        msg = await asyncio.wait_for(recv_message(ws, limiter), JOIN_TIMEOUT_SECONDS)
        if not msg or msg["type"] != "join":
            await ws.close(code=1008)
            return
        room = manager.get(msg.get("code"))
        if room is None:
            await send_error(ws, "No game with that code.")
            await ws.close()
            return
        try:
            player = room.add_player(msg.get("name"), device=device_of(ws.cookies))
        except JoinError as e:
            await send_error(ws, str(e))
            await ws.close()
            return
        stale = room.player_conns.get(player.id)
        room.player_conns[player.id] = ws
        if stale is not None and stale is not ws:
            # Same phone, new tab or refresh: the old socket loses its seat.
            try:
                await send_error(stale, "You rejoined from another tab.")
                await stale.close()
            except Exception:
                pass
        room.touch()
        await ws.send_json({"type": "joined", "playerId": player.id, "code": room.code})
        await ws.send_json(room.avatars_msg())
        await room.broadcast_state()
        if room.main_id == player.id:
            await room.send_private()

        while True:
            msg = await recv_message(ws, limiter)
            if msg is None:
                continue
            kind = msg["type"]
            if kind == "mark":
                if room.mark(player.id, msg.get("x"), msg.get("y"), msg.get("ox"), msg.get("oy")):
                    room.touch()
                    await room.broadcast_state()
                    await room.send_private()
                else:
                    await ws.send_json({"type": "mark_rejected"})
            elif kind == "unmark":
                if room.unmark(player.id):
                    room.touch()
                    await room.broadcast_state()
                else:
                    await ws.send_json({"type": "unmark_rejected"})
            elif kind == "selfie":
                if room.set_avatar(player.id, msg.get("data")):
                    room.touch()
                    await room.broadcast_avatars()
                elif msg.get("data") is not None:
                    await ws.send_json({"type": "selfie_rejected"})
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
