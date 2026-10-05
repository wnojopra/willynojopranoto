from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
import pytest

from app.main import app

ORIGIN = {"origin": "http://localhost:5173"}


def recv_until(ws, kind):
    for _ in range(50):
        msg = ws.receive_json()
        if msg["type"] == kind:
            return msg
    raise AssertionError(f"never got {kind}")


def test_health_has_security_headers():
    with TestClient(app) as c:
        r = c.get("/api/health")
        assert r.status_code == 200
        assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
        assert r.headers["x-content-type-options"] == "nosniff"


def test_rejects_foreign_origin():
    with TestClient(app) as c:
        with pytest.raises(WebSocketDisconnect):
            with c.websocket_connect("/ws/tv", headers={"origin": "https://evil.example"}) as ws:
                ws.receive_json()


def test_tv_creates_room_and_phone_joins():
    with TestClient(app) as c:
        with c.websocket_connect("/ws/tv", headers=ORIGIN) as tv:
            tv.send_json({"type": "create"})
            code = recv_until(tv, "created")["code"]
            with c.websocket_connect("/ws/play", headers=ORIGIN) as phone:
                phone.send_json({"type": "join", "code": code.lower(), "name": "Kevin"})
                joined = recv_until(phone, "joined")
                assert joined["code"] == code
                for _ in range(10):
                    state = recv_until(tv, "state")
                    names = [p["name"] for p in state["players"]]
                    if "Kevin" in names:
                        break
                assert "Kevin" in names
                tv.send_json({"type": "add_bot"})
                tv.send_json({"type": "start_round"})
                for _ in range(20):
                    st = recv_until(tv, "state")
                    if st["phase"] == "question":
                        break
                assert st["question"]["text"]


def test_phone_bad_code_gets_error():
    with TestClient(app) as c:
        with c.websocket_connect("/ws/play", headers=ORIGIN) as phone:
            phone.send_json({"type": "join", "code": "ZZZZ", "name": "Kevin"})
            assert phone.receive_json()["type"] == "error"
