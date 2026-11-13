"""WebSocket endpoints for Wavelength: /ws/wavelength/tv and /ws/wavelength/play."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.shared.cookies import device_of
from app.shared.origins import ws_origin_allowed as _origin_allowed
from app.shared.ws import ClientGone, RateLimiter, recv_message as _shared_recv, send_error
from app.wavelength.rooms import JoinError, RoomLimitError, WavelengthRoomManager

log = logging.getLogger("wavelength")

JOIN_TIMEOUT_SECONDS = 30
MAX_MESSAGE_BYTES = 512
MAX_SELFIE_MESSAGE_BYTES = 26_000
MAX_CUSTOM_DECK_BYTES = 48_000
# Higher rate per sec to allow smooth live dial dragging (`aim` messages)
RATE_PER_SEC = 30.0
RATE_BURST = 50.0
MAX_DROPPED_BEFORE_CLOSE = 300

router = APIRouter()
manager = WavelengthRoomManager()


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
        large_types={
            "selfie": MAX_SELFIE_MESSAGE_BYTES,
            "custom_deck": MAX_CUSTOM_DECK_BYTES,
        },
    )


@router.websocket("/ws/wavelength/tv")
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
                room.redraw_card()
            elif kind == "clue":
                room.submit_clue(
                    None,
                    msg.get("clue"),
                    spoken=bool(msg.get("spoken")),
                )
            elif kind == "aim":
                room.aim_dial(None, msg.get("angle"))
            elif kind == "lock":
                room.lock_guess(None, msg.get("angle"))
            elif kind == "bonus":
                room.submit_bonus(
                    None,
                    msg.get("direction"),
                    team_id=msg.get("teamId") if isinstance(msg.get("teamId"), str) else None,
                )
            elif kind == "tv_peek":
                # Single-screen / pass-and-play mode: TV requests the target angle for peeking
                sec = room.psychic_secret_msg()
                if sec is not None:
                    await ws.send_json(sec)
                continue
            elif kind == "move_seat":
                room.move_seat(msg.get("playerId"), msg.get("dir"))
            elif kind == "set_mode":
                room.set_mode(msg.get("mode"))
            elif kind == "set_left_right":
                room.set_left_right_bonus(msg.get("on"))
            elif kind == "set_catchup":
                room.set_catchup_rule(msg.get("on"))
            elif kind == "set_target":
                room.set_target_score(msg.get("target"))
            elif kind == "toggle_pack":
                room.toggle_pack(msg.get("pack"))
            elif kind == "custom_deck":
                room.set_custom_cards(
                    msg.get("cards"),
                    replace_packs=bool(msg.get("replacePacks")),
                )
            elif kind == "add_team":
                room.add_team()
            elif kind == "remove_team":
                room.remove_team(msg.get("teamId"))
            elif kind == "rename_team":
                room.rename_team(msg.get("teamId"), msg.get("name"))
            elif kind == "set_team":
                pid = msg.get("playerId")
                if isinstance(pid, str):
                    room.set_player_team(pid, msg.get("teamId"))
            elif kind == "shuffle_teams":
                room.shuffle_teams()
            elif kind == "adjust_score":
                room.adjust_score(msg.get("targetId"), msg.get("delta"))
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
    except (WebSocketDisconnect, ClientGone, asyncio.TimeoutError):
        pass
    finally:
        if room is not None:
            room.tv_conns.discard(ws)
            room.touch()


@router.websocket("/ws/wavelength/play")
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
            try:
                await send_error(stale, "You rejoined from another tab.")
                await stale.close()
            except Exception:
                pass
        room.touch()
        await ws.send_json({"type": "joined", "playerId": player.id, "code": room.code})
        await ws.send_json(room.avatars_msg())
        await room.broadcast_state()
        await room.send_private(player.id)

        while True:
            msg = await recv_message(ws, limiter)
            if msg is None:
                continue
            kind = msg["type"]
            changed = False
            if kind == "set_team":
                changed = room.set_player_team(player.id, msg.get("teamId"))
            elif kind == "redraw":
                if room.redraw_card(player.id):
                    changed = True
                else:
                    await ws.send_json({"type": "action_rejected", "reason": "Only the Psychic can draw a new card."})
            elif kind == "clue":
                if room.submit_clue(
                    player.id,
                    msg.get("clue"),
                    spoken=bool(msg.get("spoken")),
                ):
                    changed = True
                else:
                    await ws.send_json({"type": "action_rejected", "reason": "Enter a clue or tap Spoken Out Loud."})
            elif kind == "aim":
                changed = room.aim_dial(player.id, msg.get("angle"))
            elif kind == "lock":
                if room.lock_guess(player.id, msg.get("angle")):
                    changed = True
                else:
                    await ws.send_json({"type": "action_rejected", "reason": "Wait for your turn to lock in the dial."})
            elif kind == "bonus":
                if room.submit_bonus(player.id, msg.get("direction")):
                    changed = True
                else:
                    await ws.send_json({"type": "action_rejected", "reason": "Only opposing teams vote Left or Right."})
            elif kind == "selfie":
                if room.set_avatar(player.id, msg.get("data")):
                    room.touch()
                    await room.broadcast_avatars()
                elif msg.get("data") is not None:
                    await ws.send_json({"type": "selfie_rejected"})
                continue

            if changed:
                room.touch()
                await room.broadcast_state()
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
