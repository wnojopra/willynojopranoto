"""WebSocket endpoints for Spirit Board: /ws/spiritboard/tv and /ws/spiritboard/play."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.shared.cookies import device_of
from app.shared.origins import ws_origin_allowed
from app.shared.rooms_util import JoinError, RoomLimitError
from app.shared.ws import ClientGone, RateLimiter, recv_message, send_error
from app.spiritboard import hunt_api
from app.spiritboard.rooms import RoomManager

log = logging.getLogger("spiritboard")

MAX_MESSAGE_BYTES = 512
# Phones send ~20 pulls/sec; allow headroom but cap abuse.
RATE_PER_SEC = 40.0
RATE_BURST = 60.0
MAX_DROPPED_BEFORE_CLOSE = 400
JOIN_TIMEOUT_SECONDS = 30

router = APIRouter()
manager = RoomManager()


def _new_limiter() -> RateLimiter:
    return RateLimiter(
        rate_per_sec=RATE_PER_SEC,
        burst=RATE_BURST,
        max_dropped=MAX_DROPPED_BEFORE_CLOSE,
    )


async def _recv(ws: WebSocket, limiter: RateLimiter) -> dict | None:
    return await recv_message(ws, limiter, max_bytes=MAX_MESSAGE_BYTES)


# ---- TV --------------------------------------------------------------------


@router.websocket("/ws/spiritboard/tv")
async def tv_socket(ws: WebSocket) -> None:
    if not ws_origin_allowed(ws):
        await ws.close(code=1008)
        return
    await ws.accept()
    limiter = _new_limiter()
    room = None
    try:
        msg = await asyncio.wait_for(_recv(ws, limiter), JOIN_TIMEOUT_SECONDS)
        if not msg or msg["type"] != "create":
            await ws.close(code=1008)
            return
        device = device_of(ws.cookies)
        # A refreshed TV asks for its room back. Only the browser that created
        # it (same HttpOnly device cookie) gets it; anyone else gets a new room.
        old = manager.get(msg.get("resume"))
        if old is not None and old.is_host(device):
            room = old
            log.info("TV reattached to its room")
        else:
            try:
                room = manager.create_room()
            except RoomLimitError:
                await send_error(ws, "Too many s\u00e9ances right now. Try again later.")
                await ws.close()
                return
            room.host_device = device
        room.tv_conns.add(ws)
        room.touch()
        await ws.send_json({"type": "created", "code": room.code})
        await room.broadcast_state()

        while True:
            msg = await _recv(ws, limiter)
            if msg is None:
                continue
            kind = msg["type"]
            if kind in ("start_round", "new_game") and (
                kind == "new_game" or not room.game_active
            ):
                await load_custom_questions(
                    room
                )  # a new game picks up the host's latest questions
            if kind == "start_round":
                room.start_round()
            elif kind == "add_bot":
                room.add_bot()
            elif kind == "remove_bot":
                room.remove_bot()
            elif kind == "back_to_lobby":
                room.back_to_lobby()
            elif kind == "new_game":
                room.new_game()
            elif kind == "restart_game":
                room.restart_game()
            elif kind == "set_length":
                room.set_length(msg.get("length"))
            elif kind == "set_curses":
                room.set_curses(msg.get("on"))
            elif kind == "set_starter_relics":
                room.set_starter_relics(msg.get("on"))
            elif kind == "set_catchup_relics":
                room.set_catchup_relics(msg.get("on"))
            elif kind == "set_practice":
                room.set_practice(msg.get("on"))
            elif kind == "dev_grant_relics":
                # Playtesting aid; the button only renders on /spiritboard?dev=1.
                room.dev_grant_all()
            elif kind == "kick":
                pid = msg.get("playerId")
                if isinstance(pid, str):
                    conn = room.player_conns.pop(pid, None)
                    room.remove_player(pid)
                    if conn is not None:
                        try:
                            await send_error(
                                conn, "The host removed you from the s\u00e9ance."
                            )
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


# ---- Phones ----------------------------------------------------------------


@router.websocket("/ws/spiritboard/play")
async def play_socket(ws: WebSocket) -> None:
    if not ws_origin_allowed(ws):
        await ws.close(code=1008)
        return
    await ws.accept()
    limiter = _new_limiter()
    room = None
    player = None
    try:
        msg = await asyncio.wait_for(_recv(ws, limiter), JOIN_TIMEOUT_SECONDS)
        if not msg or msg["type"] != "join":
            await ws.close(code=1008)
            return
        room = manager.get(msg.get("code"))
        if room is None:
            await send_error(ws, "No s\u00e9ance with that code.")
            await ws.close()
            return
        device = device_of(ws.cookies)
        try:
            player = room.add_player(msg.get("name"), device=device)
        except JoinError as e:
            await send_error(ws, str(e))
            await ws.close()
            return
        stale = room.player_conns.get(player.id)
        room.player_conns[player.id] = ws
        if stale is not None and stale is not ws:
            # Same phone, new tab or refresh: the old socket loses its seat.
            # The error stops that tab from auto-rejoining and stealing it back.
            try:
                await send_error(stale, "You rejoined from another tab.")
                await stale.close()
            except Exception:
                pass
        if device is not None and not player.hunt_loaded:
            try:
                found = await hunt_api.store.get_device(device)
                room.load_hunt_relics(player, device, found.relics)
            except Exception:
                log.exception(
                    "couldn't load hunt Relics"
                )  # the game still works without them
        await ws.send_json(
            {"type": "joined", "playerId": player.id, "code": room.code}
        )
        if player.bet is not None and room.phase != "lobby":
            # Rejoined mid-round: remind this phone (only) of its secret bet.
            await ws.send_json(room.bet_msg(player))
        if player.id == room.medium_id and room.medium_answer is not None:
            await ws.send_json(room.answer_msg())
        await ws.send_json(room.relics_msg(player))
        player.relics_dirty = False
        await room.broadcast_state()

        while True:
            msg = await _recv(ws, limiter)
            if msg is None:
                continue
            if msg["type"] == "pull":
                room.set_pull(player.id, msg.get("dx"), msg.get("dy"))
            elif msg["type"] == "bet":
                if room.place_bet(player.id, msg.get("spotId")):
                    await ws.send_json(room.bet_msg(player))
                    await room.broadcast_state()
                    await room.send_private()  # live Crystal Ball counts
            elif msg["type"] == "answer":
                if room.medium_answers(player.id, msg.get("spotId")):
                    await ws.send_json(room.answer_msg())
                    await room.broadcast_state()
            elif msg["type"] == "relic":
                err = room.use_relic(
                    player.id, msg.get("key"), msg.get("target"), msg.get("text")
                )
                if err:
                    await ws.send_json({"type": "relic_error", "message": err})
                else:
                    await room.broadcast_state()
                    await room.send_private()
                    await spend_hunt_relics(player)
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


async def load_custom_questions(room) -> None:
    """Gives the room the host's custom questions. On failure the built-in decks still work."""
    try:
        qs = await asyncio.wait_for(hunt_api.store.list_questions(), timeout=3.0)
    except Exception:
        log.warning("could not load custom questions; using the built-in decks")
        return
    room.set_custom_questions([(q.deck, q.to_question(), q.always) for q in qs])


async def spend_hunt_relics(player) -> None:
    """Removes hunt Relics spent in a game from the phone's saved collection."""
    while player.hunt_spent and player.device:
        key = player.hunt_spent.pop()
        try:
            if not await hunt_api.store.consume(player.device, key):
                log.warning("spent hunt Relic wasn't in the store")
        except Exception:
            log.exception("couldn't record a spent hunt Relic")
