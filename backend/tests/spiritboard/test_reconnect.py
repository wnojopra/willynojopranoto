"""Reconnects: a refreshed TV gets its room back; seats belong to the phone that took them."""

from fastapi.testclient import TestClient

from app.main import app
from app.spiritboard import hunt, hunt_api
from app.spiritboard.api import manager
from app.spiritboard.rooms import JoinError, Room

ORIGIN = "https://testserver"


def hdrs(c: TestClient) -> dict:
    # The test client opens ws:// (not wss://), so it drops our Secure cookies;
    # send the device cookie by hand, as a browser on https would.
    return {"origin": ORIGIN, "cookie": f"{hunt_api.COOKIE_DEVICE}={c.cookies.get(hunt_api.COOKIE_DEVICE)}"}


def browser() -> TestClient:
    c = TestClient(app, base_url=ORIGIN)
    c.get("/api/session")
    assert hunt.valid_device(c.cookies.get(hunt_api.COOKIE_DEVICE))
    return c


def recv_until(ws, kind):
    for _ in range(50):
        msg = ws.receive_json()
        if msg["type"] == kind:
            return msg
    raise AssertionError(f"never got {kind}")


def test_refreshed_tv_gets_its_room_back_but_nobody_else_does():
    host, other = browser(), browser()
    with host.websocket_connect("/ws/spiritboard/tv", headers=hdrs(host)) as tv:
        tv.send_json({"type": "create"})
        code = recv_until(tv, "created")["code"]
    # The host's TV refreshes: same browser, same room.
    with host.websocket_connect("/ws/spiritboard/tv", headers=hdrs(host)) as tv:
        tv.send_json({"type": "create", "resume": code})
        assert recv_until(tv, "created")["code"] == code
        # Another browser that knows the (public) code can't take the room.
        with other.websocket_connect("/ws/spiritboard/tv", headers=hdrs(other)) as thief:
            thief.send_json({"type": "create", "resume": code})
            assert recv_until(thief, "created")["code"] != code
    # A resume for a room that's gone just makes a new one.
    with host.websocket_connect("/ws/spiritboard/tv", headers=hdrs(host)) as tv:
        tv.send_json({"type": "create", "resume": "ZZZZ"})
        assert recv_until(tv, "created")["code"] != "ZZZZ"


def test_phone_refresh_takes_its_seat_back_and_others_cant():
    host, kevin, faker = browser(), browser(), browser()
    with host.websocket_connect("/ws/spiritboard/tv", headers=hdrs(host)) as tv:
        tv.send_json({"type": "create"})
        code = recv_until(tv, "created")["code"]
        with kevin.websocket_connect("/ws/spiritboard/play", headers=hdrs(kevin)) as old:
            old.send_json({"type": "join", "code": code, "name": "Kevin"})
            pid = recv_until(old, "joined")["playerId"]
            # Refresh: the new tab connects before the old socket is gone.
            with kevin.websocket_connect("/ws/spiritboard/play", headers=hdrs(kevin)) as new:
                new.send_json({"type": "join", "code": code, "name": "kevin"})
                assert recv_until(new, "joined")["playerId"] == pid
                assert recv_until(old, "error")["message"].startswith("You rejoined")
                # Someone else can't join as Kevin.
                with faker.websocket_connect("/ws/spiritboard/play", headers=hdrs(faker)) as f:
                    f.send_json({"type": "join", "code": code, "name": "Kevin"})
                    assert "taken" in recv_until(f, "error")["message"]
        room = manager.get(code)
        assert room is not None and len([p for p in room.players.values() if p.name == "Kevin"]) == 1


def test_seat_ownership_in_the_room():
    room = Room("ABCD")
    p = room.add_player("Kevin", device="dev-kevin")
    room.mark_disconnected(p.id)
    try:
        room.add_player("Kevin", device="dev-someone-else")
        raise AssertionError("impersonation allowed")
    except JoinError:
        pass
    assert room.add_player("KEVIN", device="dev-kevin") is p and p.connected
    # Hunt Relics still load once, even though the seat already knows its device.
    room.load_hunt_relics(p, "dev-kevin", ["hex"])
    room.load_hunt_relics(p, "dev-kevin", ["hex"])
    assert p.relics.count("hex") == 1 and p.hunt == ["hex"]
    assert room.is_host(None) is False
    room.host_device = "dev-host"
    assert room.is_host("dev-host") and not room.is_host("dev-kevin")
