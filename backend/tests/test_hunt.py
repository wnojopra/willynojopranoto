"""Scavenger hunt: claim rules, cookies/CSRF, admin auth, and game integration."""

import asyncio
import random

import pytest
from fastapi.testclient import TestClient

from app import hunt, hunt_api
from app.main import app
from app.rooms import Room

ORIGIN = "https://testserver"


@pytest.fixture(autouse=True)
def fresh_store(monkeypatch):
    store = hunt.MemoryStore()
    monkeypatch.setattr(hunt_api, "store", store)
    monkeypatch.setattr(hunt_api, "_admin_sessions", {})
    for lim in (hunt_api.claim_limiter, hunt_api.login_limiter, hunt_api.login_global, hunt_api.admin_limiter):
        lim.buckets.clear()
    return store


def phone() -> TestClient:
    """A browser: https (so Secure cookies flow) with device + CSRF cookies."""
    c = TestClient(app, base_url=ORIGIN)
    c.get("/api/session")
    assert hunt.valid_device(c.cookies.get(hunt_api.COOKIE_DEVICE))
    return c


def post(c: TestClient, url: str, json: dict | None = None, *, csrf: bool = True, origin: str = ORIGIN):
    headers = {"origin": origin}
    if csrf:
        headers["x-csrf-token"] = c.cookies.get(hunt_api.COOKIE_CSRF) or ""
    return c.post(url, json=json or {}, headers=headers)


def make_codes(store, n=1, relic="hex", tier=None):
    return asyncio.run(store.create_codes(n, "fridge", relic, tier))


def test_claim_flow_name_once_then_yours_then_taken(fresh_store):
    (code,) = make_codes(fresh_store)
    kevin, sarah = phone(), phone()
    assert kevin.get(f"/api/claim/{code.token}").json()["status"] == "need_name"
    assert post(kevin, f"/api/claim/{code.token}").json()["status"] == "need_name"
    r = post(kevin, f"/api/claim/{code.token}", {"name": "Kevin"}).json()
    assert r == {"status": "claimed", "relic": "hex"}
    assert kevin.get(f"/api/claim/{code.token}").json() == {"status": "yours", "relic": "hex"}
    assert post(sarah, f"/api/claim/{code.token}", {"name": "Sarah"}).json()["status"] == "taken"
    assert kevin.get("/api/me").json() == {"name": "Kevin", "relics": ["hex"]}
    # Second code: no name needed now.
    (code2,) = make_codes(fresh_store, relic=None, tier="cursed")
    assert kevin.get(f"/api/claim/{code2.token}").json()["status"] == "unclaimed"
    r2 = post(kevin, f"/api/claim/{code2.token}").json()
    assert r2["status"] == "claimed" and hunt.relics.CATALOG[r2["relic"]].tier == "cursed"


def test_claim_rejects_bad_tokens_names_and_missing_csrf(fresh_store):
    (code,) = make_codes(fresh_store)
    c = phone()
    assert c.get("/api/claim/not-a-token").json()["status"] == "invalid"
    assert post(c, "/api/claim/AAAAAAAAAAAAAAAA", {"name": "Kev"}).json()["status"] == "invalid"
    assert post(c, f"/api/claim/{code.token}", {"name": "<script>"}).status_code == 400
    assert post(c, f"/api/claim/{code.token}", {"name": "Kev"}, csrf=False).status_code == 403
    assert post(c, f"/api/claim/{code.token}", {"name": "Kev"}, origin="https://evil.example").status_code == 403
    no_cookies = TestClient(app, base_url=ORIGIN)
    assert no_cookies.post(f"/api/claim/{code.token}", json={}, headers={"origin": ORIGIN}).status_code == 403
    assert fresh_store.codes[code.token].claimed_by is None


def test_claims_are_rate_limited(fresh_store):
    codes = make_codes(fresh_store, n=15)
    c = phone()
    statuses = [post(c, f"/api/claim/{k.token}", {"name": "Kev"}).status_code for k in codes]
    assert 429 in statuses


def test_cookies_are_hardened():
    c = TestClient(app, base_url=ORIGIN)
    r = c.get("/api/session")
    cookies = r.headers.get_list("set-cookie")
    device = next(h for h in cookies if h.startswith(hunt_api.COOKIE_DEVICE))
    assert "HttpOnly" in device and "Secure" in device and "Path=/" in device and "Domain" not in device
    assert "samesite=lax" in device.lower()
    assert r.headers["cache-control"] == "no-store"


def test_admin_disabled_without_passcode(monkeypatch):
    monkeypatch.delenv("SB_ADMIN_PASSCODE", raising=False)
    c = phone()
    assert c.get("/api/admin/session").json() == {"configured": False, "admin": False}
    assert post(c, "/api/admin/login", {"passcode": ""}).status_code == 503
    assert c.get("/api/admin/codes").status_code == 401


def test_admin_login_create_list_delete(monkeypatch, fresh_store):
    monkeypatch.setenv("SB_ADMIN_PASSCODE", "correct horse battery")
    c = phone()
    assert c.get("/api/admin/codes").status_code == 401
    assert post(c, "/api/admin/login", {"passcode": "nope"}).status_code == 401
    assert post(c, "/api/admin/login", {"passcode": "correct horse battery"}, csrf=False).status_code == 403
    r = post(c, "/api/admin/login", {"passcode": "correct horse battery"})
    assert r.status_code == 200
    admin_cookie = next(h for h in r.headers.get_list("set-cookie") if h.startswith(hunt_api.COOKIE_ADMIN))
    assert "HttpOnly" in admin_cookie and "samesite=strict" in admin_cookie.lower()

    made = post(c, "/api/admin/codes", {"count": 3, "label": "under the stairs", "tier": "rare"}).json()["codes"]
    assert len(made) == 3 and all(hunt.valid_token(m["token"]) for m in made)
    assert post(c, "/api/admin/codes", {"count": 1, "relic": "nope"}).status_code == 400
    assert post(c, "/api/admin/codes", {"count": 1}).status_code == 400  # neither relic nor tier
    assert post(c, "/api/admin/codes", {"count": 101, "tier": "any"}).status_code == 422
    listed = c.get("/api/admin/codes").json()["codes"]
    assert [m["token"] for m in listed] == [m["token"] for m in made]
    assert "claimedBy" not in listed[0]  # device ids never leave the server
    assert post(c, f"/api/admin/codes/{made[0]['token']}/delete").json() == {"ok": True}
    assert len(c.get("/api/admin/codes").json()["codes"]) == 2

    post(c, "/api/admin/logout")
    assert c.get("/api/admin/codes").status_code == 401
    # A different browser never had the session.
    assert phone().get("/api/admin/codes").status_code == 401


def test_admin_login_is_rate_limited(monkeypatch):
    monkeypatch.setenv("SB_ADMIN_PASSCODE", "correct horse battery")
    c = phone()
    codes = [post(c, "/api/admin/login", {"passcode": f"guess{i}"}).status_code for i in range(8)]
    assert 429 in codes


def test_hunt_relics_join_the_game_and_are_spent_last():
    room = Room("BCDF", rng=random.Random(1))
    room.starter_relics = False
    a = room.add_player("Alice")
    room.add_player("Bob")
    room.add_player("Cara")
    room.load_hunt_relics(a, "d" * 43, ["jumpscare", "bogus"])
    assert a.relics == ["jumpscare"] and a.hunt == ["jumpscare"]
    room.load_hunt_relics(a, "e" * 43, ["hex"])  # only once per player
    assert a.relics == ["jumpscare"]
    room._grant(a, "jumpscare")  # e.g. a starter copy of the same Relic
    room.new_game()
    assert room.use_relic(a.id, "jumpscare") is None
    assert a.hunt == ["jumpscare"] and a.hunt_spent == []  # spent the non-hunt copy first
    room.round_kind = "final"
    assert room.use_relic(a.id, "jumpscare") is None
    assert a.hunt == [] and a.hunt_spent == ["jumpscare"]


def test_starter_expiry_never_takes_a_hunt_relic():
    room = Room("BCDF", rng=random.Random(1))
    a = room.add_player("Alice")
    room.add_player("Bob")
    room.load_hunt_relics(a, "d" * 43, ["hex"])
    a.starter = "hex"  # pretend the starter rolled the same Relic, then got spent
    room.phase = "results"
    room.starter_relics = False
    room.new_game()
    assert a.relics == ["hex"]


# ---- Custom questions -----------------------------------------------------------


def admin_client(monkeypatch) -> TestClient:
    monkeypatch.setenv("SB_ADMIN_PASSCODE", "correct horse battery")
    c = phone()
    assert post(c, "/api/admin/login", {"passcode": "correct horse battery"}).status_code == 200
    return c


def test_custom_questions_validate_and_crud(monkeypatch, fresh_store):
    c = admin_client(monkeypatch)
    assert phone().get("/api/admin/questions").status_code == 401
    good = {"deck": "bets", "kind": "who", "text": "  Who  ate the\u202e last   taco? ", "always": True}
    q = post(c, "/api/admin/questions", good).json()["question"]
    assert q["text"] == "Who ate the last taco?" and q["always"] is True and hunt.valid_question_id(q["id"])
    pick = {"deck": "medium", "kind": "pick", "text": "Your ghost name?", "options": ["Boo", " Casper ", ""]}
    assert post(c, "/api/admin/questions", pick).status_code == 200
    bad = [
        {**good, "deck": "nope"},
        {**good, "kind": "numbers"},
        {**good, "text": "Hi"},
        {**good, "text": "x" * 141},
        {**pick, "options": ["Only one"]},
        {**pick, "options": ["Same", "same"]},
        {**pick, "options": ["Way too long for the board", "ok"]},
    ]
    for b in bad:
        assert post(c, "/api/admin/questions", b).status_code == 400, b
    assert post(c, "/api/admin/questions", good, csrf=False).status_code == 403
    listed = c.get("/api/admin/questions").json()["questions"]
    assert [x["kind"] for x in listed] == ["who", "pick"] and listed[1]["options"] == ["Boo", "Casper"]
    assert post(c, f"/api/admin/questions/{q['id']}", {"always": False}).json() == {"ok": True}
    assert c.get("/api/admin/questions").json()["questions"][0]["always"] is False
    assert post(c, f"/api/admin/questions/{q['id']}/delete").json() == {"ok": True}
    assert post(c, f"/api/admin/questions/{q['id']}/delete").status_code == 404
    assert len(c.get("/api/admin/questions").json()["questions"]) == 1


def test_always_include_questions_come_up_in_the_game():
    from app.questions import Question

    room = Room("ABCD", rng=random.Random(3))
    for n in ("Ann", "Ben", "Cy"):
        room.add_player(n)
    room.set_starter_relics(False)
    mine = [Question("who", f"Inside joke {i}?") for i in range(3)]
    room.set_custom_questions([("bets", q, True) for q in mine] + [("medium", Question("yesno", "Med joke?"), True)])
    seen = []
    room.new_game()
    while room.phase != "results":
        seen.append(room.question_text)
        room._finish_round(room.spots[0].id) if room.phase != "medium" else None
        room.phase = "reveal"
        room.start_round()
    for q in mine:
        assert q.text in seen
    assert "Med joke?" in seen
