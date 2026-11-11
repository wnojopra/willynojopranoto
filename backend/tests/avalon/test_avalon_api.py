from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
import pytest

from app.main import app

ORIGIN = {"origin": "http://localhost:5173"}


def recv_until(ws, kind, pred=lambda m: True):
    for _ in range(80):
        msg = ws.receive_json()
        if msg["type"] == kind and pred(msg):
            return msg
    raise AssertionError(f"never got {kind}")


def test_avalon_rejects_foreign_origin():
    with TestClient(app) as c:
        with pytest.raises(WebSocketDisconnect):
            with c.websocket_connect("/ws/avalon/tv", headers={"origin": "https://evil.example"}) as ws:
                ws.receive_json()


def test_avalon_websocket_flow():
    with TestClient(app) as c:
        with c.websocket_connect("/ws/avalon/tv", headers=ORIGIN) as tv:
            tv.send_json({"type": "create"})
            code = recv_until(tv, "created")["code"]

            with c.websocket_connect("/ws/avalon/play", headers=ORIGIN) as p1:
                p1.send_json({"type": "join", "code": code, "name": "Alice"})
                joined = recv_until(p1, "joined")
                p1_id = joined["playerId"]

                # Add 4 bots to reach 5 players
                for _ in range(4):
                    tv.send_json({"type": "add_bot"})

                st = recv_until(tv, "state", lambda m: len(m["players"]) == 5)
                assert st["canStart"] is True

                tv.send_json({"type": "start"})
                st = recv_until(tv, "state", lambda m: m["phase"] == "night")
                secret = recv_until(p1, "role_secret")
                assert secret["role"] in (
                    "merlin",
                    "percival",
                    "servant",
                    "assassin",
                    "morgana",
                    "mordred",
                    "oberon",
                    "minion",
                )

                # Player marks ready on phone -> since other 4 are bots, transitions to team_building
                p1.send_json({"type": "ready"})
                st = recv_until(tv, "state", lambda m: m["phase"] == "team_building")
                assert st["round"] == 1 and st["questSize"] == 2
                assert p1_id in [p["id"] for p in st["players"]]


def test_cross_game_code_isolation():
    with TestClient(app) as c:
        with c.websocket_connect("/ws/avalon/tv", headers=ORIGIN) as tv:
            tv.send_json({"type": "create"})
            code = recv_until(tv, "created")["code"]
            with c.websocket_connect("/ws/psych/play", headers=ORIGIN) as psych_phone:
                psych_phone.send_json({"type": "join", "code": code, "name": "Ann"})
                assert recv_until(psych_phone, "error")["message"] == "No game with that code."


def test_avalon_spa_routes_and_security_headers():
    with TestClient(app) as c:
        for path in ("/avalon", "/avalon/play"):
            r = c.get(path)
            assert r.status_code == 200
            assert "Content-Security-Policy" in r.headers
            assert r.headers["X-Frame-Options"] == "DENY"
            assert r.headers["X-Content-Type-Options"] == "nosniff"

