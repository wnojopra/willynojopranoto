"""WebSocket and HTTP integration tests for Wavelength (/ws/wavelength/*)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app

ORIGIN = {"origin": "http://localhost:5173"}


def recv_until(ws, kind: str, pred=lambda m: True):
    for _ in range(80):
        msg = ws.receive_json()
        if msg["type"] == kind and pred(msg):
            return msg
    raise AssertionError(f"never received {kind}")


def test_foreign_origin_rejected() -> None:
    client = TestClient(app)
    evil = {"origin": "https://evil.example"}
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/wavelength/tv", headers=evil):
            pass
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/wavelength/play", headers=evil):
            pass


def test_end_to_end_websocket_flow() -> None:
    client = TestClient(app)
    with client.websocket_connect("/ws/wavelength/tv", headers=ORIGIN) as tv:
        tv.send_json({"type": "create"})
        created = recv_until(tv, "created")
        code = created["code"]
        recv_until(tv, "state", lambda s: s["phase"] == "lobby")

        with (
            client.websocket_connect("/ws/wavelength/play", headers=ORIGIN) as p1,
            client.websocket_connect("/ws/wavelength/play", headers=ORIGIN) as p2,
        ):
            p1.send_json({"type": "join", "code": code, "name": "Alice"})
            j1 = recv_until(p1, "joined")
            p2.send_json({"type": "join", "code": code, "name": "Bob"})
            j2 = recv_until(p2, "joined")

            # Switch to Co-op mode so both players play together seamlessly
            tv.send_json({"type": "set_mode", "mode": "coop"})
            recv_until(tv, "state", lambda s: s["mode"] == "coop")

            tv.send_json({"type": "start"})
            st = recv_until(tv, "state", lambda s: s["phase"] == "psychic")

            psychic_ws = p1 if st["psychicId"] == j1["playerId"] else p2
            guesser_ws = p2 if st["psychicId"] == j1["playerId"] else p1

            # Psychic receives private psychic_secret
            sec = recv_until(psychic_ws, "psychic_secret")
            assert -90.0 <= sec["target"] <= 90.0

            psychic_ws.send_json({"type": "clue", "clue": "Warm coffee"})
            recv_until(tv, "state", lambda s: s["phase"] == "guessing" and s["clue"] == "Warm coffee")

            guesser_ws.send_json({"type": "lock", "angle": sec["target"]})
            reveal_state = recv_until(tv, "state", lambda s: s["phase"] == "reveal")
            assert reveal_state["reveal"]["bullseye"] is True


def test_cross_game_room_isolation() -> None:
    client = TestClient(app)
    with client.websocket_connect("/ws/wavelength/tv", headers=ORIGIN) as tv:
        tv.send_json({"type": "create"})
        code = recv_until(tv, "created")["code"]

        # Trying to join Psychological or Avalon with a Wavelength room code fails
        with client.websocket_connect("/ws/psych/play", headers=ORIGIN) as psy_play:
            psy_play.send_json({"type": "join", "code": code, "name": "Alice"})
            err = recv_until(psy_play, "error")
            assert "No game" in err["message"]


def test_spa_routes_and_security_headers() -> None:
    client = TestClient(app)
    for path in ("/wavelength", "/wavelength/play"):
        res = client.get(path)
        assert res.status_code == 200
        assert "Content-Security-Policy" in res.headers
        assert res.headers.get("X-Frame-Options") == "DENY"
        assert res.headers.get("X-Content-Type-Options") == "nosniff"
