from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
import pytest

from app.main import app

ORIGIN = {"origin": "http://localhost:5173"}


def recv_until(ws, kind, pred=lambda m: True):
    for _ in range(60):
        msg = ws.receive_json()
        if msg["type"] == kind and pred(msg):
            return msg
    raise AssertionError(f"never got {kind}")


def test_psych_rejects_foreign_origin():
    with TestClient(app) as c:
        with pytest.raises(WebSocketDisconnect):
            with c.websocket_connect("/ws/psych/tv", headers={"origin": "https://evil.example"}) as ws:
                ws.receive_json()


def test_psych_full_turn_over_websockets():
    with TestClient(app) as c:
        with c.websocket_connect("/ws/psych/tv", headers=ORIGIN) as tv:
            tv.send_json({"type": "create"})
            code = recv_until(tv, "created")["code"]
            with c.websocket_connect("/ws/psych/play", headers=ORIGIN) as p1, c.websocket_connect(
                "/ws/psych/play", headers=ORIGIN
            ) as p2:
                p1.send_json({"type": "join", "code": code, "name": "Ann"})
                a = recv_until(p1, "joined")["playerId"]
                p2.send_json({"type": "join", "code": code.lower(), "name": "Ben"})
                b = recv_until(p2, "joined")["playerId"]
                tv.send_json({"type": "start"})
                st = recv_until(tv, "state", lambda m: m["phase"] == "secret")
                assert st["mainId"] == a and st["traits"]["x"] and st["traits"]["y"]
                p1.send_json({"type": "mark", "x": 3, "y": 8})
                assert recv_until(p1, "secret") == {"type": "secret", "turn": 1, "x": 3, "y": 8}
                st = recv_until(p2, "state", lambda m: m["phase"] == "guessing")
                assert st["reveal"] is None and st["currentId"] == b
                p2.send_json({"type": "mark", "x": 3, "y": 7})
                st = recv_until(tv, "state", lambda m: m["phase"] == "reveal")
                assert st["reveal"]["x"] == 3 and st["reveal"]["y"] == 8
                assert st["reveal"]["points"] == {b: 2}


def test_spirit_board_code_does_not_resolve_in_psych():
    with TestClient(app) as c:
        with c.websocket_connect("/ws/spiritboard/tv", headers=ORIGIN) as tv:
            tv.send_json({"type": "create"})
            code = recv_until(tv, "created")["code"]
            with c.websocket_connect("/ws/psych/play", headers=ORIGIN) as phone:
                phone.send_json({"type": "join", "code": code, "name": "Ann"})
                assert recv_until(phone, "error")["message"] == "No game with that code."


def test_out_of_turn_mark_rejected():
    with TestClient(app) as c:
        with c.websocket_connect("/ws/psych/tv", headers=ORIGIN) as tv:
            tv.send_json({"type": "create"})
            code = recv_until(tv, "created")["code"]
            with c.websocket_connect("/ws/psych/play", headers=ORIGIN) as p1:
                p1.send_json({"type": "join", "code": code, "name": "Ann"})
                recv_until(p1, "joined")
                tv.send_json({"type": "add_bot"})
                tv.send_json({"type": "move_seat", "playerId": "nope", "dir": 1})
                tv.send_json({"type": "start"})
                recv_until(tv, "state", lambda m: m["phase"] == "secret")
                p1.send_json({"type": "mark", "x": 99, "y": 1})
                recv_until(p1, "mark_rejected")


def test_only_selfies_may_be_big():
    from app.psych.api import MAX_MESSAGE_BYTES

    with TestClient(app) as c:
        with c.websocket_connect("/ws/psych/tv", headers=ORIGIN) as tv:
            tv.send_json({"type": "create"})
            code = recv_until(tv, "created")["code"]
            with c.websocket_connect("/ws/psych/play", headers=ORIGIN) as p1:
                p1.send_json({"type": "join", "code": code, "name": "Ann"})
                recv_until(p1, "joined")
                # A big non-selfie message is dropped silently...
                p1.send_json({"type": "mark", "x": 1, "y": 1, "pad": "x" * (MAX_MESSAGE_BYTES + 10)})
                # ...and a bad selfie is rejected.
                p1.send_json({"type": "selfie", "data": "data:image/jpeg;base64," + "A" * 400})
                assert recv_until(p1, "selfie_rejected")
