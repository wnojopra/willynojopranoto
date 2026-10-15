"""WebSocket endpoints for Psychological: /ws/psych/tv and /ws/psych/play."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.hunt_api import device_of
from app.origins import origin_ok
from app.psych.rooms import JoinError, PsychRoomManager, RoomLimitError
from app.psych.ws_util import ClientGone, RateLimiter, recv_message, send_error

log = logging.getLogger("psychological")

JOIN_TIMEOUT_SECONDS = 30

router = APIRouter()
manager = PsychRoomManager()


def _origin_allowed(ws: WebSocket) -> bool:
    """Blocks cross-site WebSocket hijacking: browsers always send Origin."""
    return origin_ok(ws.headers.get("origin"), ws.headers.get("host"))


@router.websocket("/ws/psych/tv")
async def tv_socket(ws: WebSocket) -> None:
    if not _origin_allowed(ws):
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
                    room.remove_player(pid)
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
        await room.broadcast_state()
        if room.main_id == player.id:
            await room.send_private()

        while True:
            msg = await recv_message(ws, limiter)
            if msg is None:
                continue
            if msg["type"] == "mark":
                if room.mark(player.id, msg.get("x"), msg.get("y")):
                    room.touch()
                    await room.broadcast_state()
                    await room.send_private()
                else:
                    await ws.send_json({"type": "mark_rejected"})
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
