"""Tests for search-engine de-indexing, usage telemetry (DAU/MAU & rooms), and /api/admin/analytics."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import json
import logging

from fastapi.testclient import TestClient
import pytest

from app.avalon import api as avalon_api
from app.main import NOINDEX_ROBOTS_TAG, app
from app.psych import api as psych_api
from app.shared import telemetry
from app.spiritboard import api as sb_api, hunt_api
from app.wavelength import api as wl_api
from app.wavelength.rooms import WavelengthRoom

ORIGIN = "https://testserver"


def make_browser() -> TestClient:
    c = TestClient(app, base_url=ORIGIN)
    c.get("/api/session")
    return c


def admin_post(c: TestClient, url: str, body: dict | None = None):
    return c.post(
        url,
        json=body or {},
        headers={
            "origin": ORIGIN,
            "x-csrf-token": c.cookies.get(hunt_api.COOKIE_CSRF) or "",
        },
    )


def recv_until(ws, kind: str):
    for _ in range(60):
        msg = ws.receive_json()
        if msg.get("type") == kind:
            return msg
    raise AssertionError(f"never received {kind}")


# ---- Phase 1: Search-engine & crawler de-indexing ---------------------------


def test_homepage_and_robots_txt_are_indexable_while_games_and_admin_are_noindex():
    c = TestClient(app, base_url=ORIGIN)

    home = c.get("/")
    assert home.status_code == 200
    assert "x-robots-tag" not in {k.lower() for k in home.headers.keys()}

    robots = c.get("/robots.txt")
    assert robots.status_code == 200
    assert "x-robots-tag" not in {k.lower() for k in robots.headers.keys()}
    text = robots.text
    for bot in ("GPTBot", "ClaudeBot", "Bytespider", "AhrefsBot", "SemrushBot"):
        assert f"User-agent: {bot}" in text
    assert "Disallow: /api/" in text
    assert "Disallow: /admin" in text

    blocked_paths = [
        "/admin",
        "/spiritboard",
        "/spiritboard/play",
        "/spiritboard/relics",
        "/spiritboard/admin",
        "/spiritboard/admin/print",
        "/spiritboard/claim/ABCDEFGHIJKLMNOP",
        "/psychological",
        "/psychological/play",
        "/avalon",
        "/avalon/play",
        "/wavelength",
        "/wavelength/play",
        "/api/health",
        "/api/session",
    ]
    for path in blocked_paths:
        res = c.get(path)
        assert res.status_code == 200, path
        assert res.headers.get("x-robots-tag") == NOINDEX_ROBOTS_TAG, path


# ---- Phase 2: Telemetry store, PT date bucketing & DAU/MAU deduplication ----


def test_pt_bucketing_keeps_friday_evening_game_night_on_friday():
    # 2026-11-14T05:30:00Z is Friday 2026-11-13 at 9:30 PM PST (UTC-8).
    ts = datetime(2026, 11, 14, 5, 30, 0, tzinfo=timezone.utc).timestamp()
    assert telemetry.day_key(ts) == "2026-11-13"
    assert telemetry.month_key(ts) == "2026-11"


def test_dau_mau_deduplication_bots_excluded_and_lobby_vs_started():
    mem = telemetry.MemoryTelemetryStore()
    # Day 1: 2026-11-13 20:00 PST
    t0 = datetime(2026, 11, 14, 4, 0, 0, tzinfo=timezone.utc).timestamp()
    now = [t0]
    trk = telemetry.TelemetryTracker(mem, clock=lambda: now[0])

    dev_alice = "A" * 43
    dev_bob = "B" * 43
    dev_host = "H" * 43

    # Room 1: Lobby opened from Reddit referrer in US, never started -> 1 created, 0 started.
    r1 = WavelengthRoom("BCDF")
    r1.host_device = dev_host
    trk.on_room_created(
        "wavelength",
        r1,
        headers={"referer": "https://www.reddit.com/r/boardgames", "cf-ipcountry": "US"},
    )
    now[0] += 45
    trk.on_room_closed("wavelength", r1, reason="idle")

    # Room 2: Wavelength game played with Alice, Bob, and 1 Bot; Alice reconnects 4 times.
    r2 = WavelengthRoom("GHJK")
    r2.host_device = dev_host
    trk.on_room_created("wavelength", r2, headers={"host": "willynojopranoto.com", "referer": "https://willynojopranoto.com/"})
    r2.add_player("Alice", device=dev_alice)
    trk.on_player_joined("wavelength", r2, device=dev_alice, is_bot=False)
    # Simulate iPhone lock/unlock reconnect spam -> must still count as 1 DAU
    for _ in range(4):
        trk.on_player_joined("wavelength", r2, device=dev_alice, is_bot=False)
    r2.add_player("Bob", device=dev_bob)
    trk.on_player_joined("wavelength", r2, device=dev_bob, is_bot=False)
    r2.add_bot()
    trk.on_player_joined("wavelength", r2, device=None, is_bot=True)

    assert r2.start() is True
    trk.on_game_started("wavelength", r2, host_device=dev_host)
    trk.on_round_started("wavelength", r2)  # round 2
    trk.on_round_started("wavelength", r2)  # round 3
    now[0] += 1800
    trk.on_room_closed("wavelength", r2, reason="idle")

    # Same evening, Alice also plays Psychological -> global DAU stays 3 (Alice, Bob, Host),
    # while per-game DAU is wavelength=3, psych=1.
    r3 = WavelengthRoom("LMNP")
    trk.on_room_created("psych", r3)
    trk.on_player_joined("psych", r3, device=dev_alice, is_bot=False)
    now[0] += 300
    trk.on_room_closed("psych", r3, reason="closed")

    # Day 2 (next evening, same month): Alice plays again -> Day 2 DAU = 1, Month MAU = 3!
    now[0] = datetime(2026, 11, 15, 4, 0, 0, tzinfo=timezone.utc).timestamp()
    r4 = WavelengthRoom("QRST")
    trk.on_room_created("avalon", r4)
    trk.on_player_joined("avalon", r4, device=dev_alice, is_bot=False)
    now[0] += 600
    trk.on_room_closed("avalon", r4, reason="idle")

    stats = asyncio.run(mem.get_stats(now_ts=now[0], days=5, months=3, recent_limit=10))
    by_day = {d["date"]: d for d in stats["daily"]}
    fri = by_day["2026-11-13"]
    sat = by_day["2026-11-14"]

    assert fri["dau"] == 3  # Alice + Bob + Host (bot excluded, reconnects deduplicated)
    assert fri["dauByGame"]["wavelength"] == 3
    assert fri["dauByGame"]["psych"] == 1
    assert fri["roomsCreated"] == 3
    assert fri["roomsStarted"] == 1
    assert fri["roundsPlayed"] == 3

    assert sat["dau"] == 1
    assert sat["roomsCreated"] == 1
    assert sat["roomsStarted"] == 0

    nov = stats["monthly"][-1]
    assert nov["month"] == "2026-11"
    assert nov["mau"] == 3  # Alice across Fri+Sat + playing 3 games still = 1 unique monthly user!
    assert nov["roomsCreated"] == 4
    assert nov["roomsStarted"] == 1
    assert nov["roundsPlayed"] == 3

    # Verify recent rooms order & referrer cleaning (same-origin referer stripped to None)
    recent = stats["recentRooms"]
    assert len(recent) == 4
    wl_played = next(r for r in recent if r["started"])
    assert wl_played["game"] == "wavelength"
    assert wl_played["humanPlayers"] == 3  # Alice, Bob, Host
    assert wl_played["botPlayers"] == 1
    assert wl_played["roundsPlayed"] == 3
    assert wl_played["durationSec"] == 1800
    assert wl_played["refererHost"] is None

    wl_lobby = recent[-1]
    assert wl_lobby["started"] is False
    assert wl_lobby["country"] == "US"
    assert wl_lobby["refererHost"] == "reddit.com"


def test_structured_json_events_contain_no_raw_device_ids():
    captured: list[str] = []

    class CaptureHandler(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            captured.append(self.format(record))

    handler = CaptureHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    telemetry._json_log.addHandler(handler)
    try:
        mem = telemetry.MemoryTelemetryStore()
        trk = telemetry.TelemetryTracker(mem, clock=lambda: 1_763_000_000.0)
        secret_cookie = "SECRET_DEVICE_COOKIE_" + "X" * 22
        room = WavelengthRoom("VWXZ")
        room.host_device = secret_cookie
        trk.on_room_created("wavelength", room, headers={"cf-ipcountry": "CA"})
        trk.on_player_joined("wavelength", room, device=secret_cookie, is_bot=False)
        room.add_player("P1", device=secret_cookie)
        room.add_player("P2", device="Y" * 43)
        assert room.start() is True
        trk.on_game_started("wavelength", room, host_device=secret_cookie)
        trk.on_room_closed("wavelength", room, reason="idle")
    finally:
        telemetry._json_log.removeHandler(handler)

    events = [json.loads(line) for line in captured]
    kinds = [e["event"] for e in events]
    assert kinds == ["room_created", "game_started", "room_closed"]
    for raw in captured:
        assert secret_cookie not in raw
    assert events[0]["country"] == "CA"
    assert events[2]["started"] is True
    assert events[2]["roundsPlayed"] == 1


# ---- Phase 3: /api/admin/analytics end-to-end with live WebSockets ----------


def test_admin_analytics_requires_auth_and_tracks_live_and_closed_ws_sessions(monkeypatch):
    mem = telemetry.MemoryTelemetryStore()
    trk = telemetry.TelemetryTracker(mem)
    trk.register_manager("spiritboard", sb_api.manager)
    trk.register_manager("psych", psych_api.manager)
    trk.register_manager("avalon", avalon_api.manager)
    trk.register_manager("wavelength", wl_api.manager)

    monkeypatch.setattr(telemetry, "store", mem)
    monkeypatch.setattr(telemetry, "tracker", trk)
    monkeypatch.setattr(sb_api, "tracker", trk)
    monkeypatch.setattr(psych_api, "tracker", trk)
    monkeypatch.setattr(avalon_api, "tracker", trk)
    monkeypatch.setattr(wl_api, "tracker", trk)

    monkeypatch.setenv("SB_ADMIN_PASSCODE", "super-secret-passcode")
    monkeypatch.setattr(hunt_api, "_admin_sessions", {})
    for lim in (hunt_api.login_limiter, hunt_api.login_global, hunt_api.admin_limiter):
        lim.buckets.clear()

    admin = make_browser()
    assert admin.get("/api/admin/analytics").status_code == 401
    assert admin_post(admin, "/api/admin/login", {"passcode": "super-secret-passcode"}).status_code == 200

    def ws_headers(c: TestClient) -> dict[str, str]:
        # Starlette's TestClient opens ws:// rather than wss://, so Secure __Host-
        # cookies must be attached explicitly just like tests/spiritboard/test_reconnect.py.
        return {
            "origin": ORIGIN,
            "cookie": f"{hunt_api.COOKIE_DEVICE}={c.cookies.get(hunt_api.COOKIE_DEVICE)}",
        }

    tv_client = make_browser()
    p1_client = make_browser()
    code = None
    try:
        with tv_client.websocket_connect("/ws/wavelength/tv", headers=ws_headers(tv_client)) as tv_ws:
            tv_ws.send_json({"type": "create"})
            code = recv_until(tv_ws, "created")["code"]

            with p1_client.websocket_connect("/ws/wavelength/play", headers=ws_headers(p1_client)) as p1_ws:
                p1_ws.send_json({"type": "join", "code": code, "name": "Willy"})
                recv_until(p1_ws, "joined")

                tv_ws.send_json({"type": "add_bot"})
                recv_until(tv_ws, "state")
                tv_ws.send_json({"type": "start"})
                recv_until(tv_ws, "state")

                # Inspect live dashboard payload while sockets are open!
                res = admin.get("/api/admin/analytics")
                assert res.status_code == 200
                body = res.json()
                assert body["timezone"] == "America/Los_Angeles"
                assert body["live"]["byGame"]["wavelength"]["activeRooms"] >= 1
                assert body["live"]["byGame"]["wavelength"]["playingRooms"] >= 1
                assert body["live"]["openWebSockets"] >= 2

                today = body["daily"][-1]
                assert today["dau"] == 2  # TV host + 1 phone player (bot not counted)
                assert today["roomsCreated"] == 1
                assert today["roomsStarted"] == 1
                # Ensure raw hashed user sets are never exposed in API responses
                assert "activeUsers" not in today
                assert "activeUsers" not in body["monthly"][-1]
    finally:
        if code:
            wl_api.manager.close_room(code, reason="test_cleanup")

    after = admin.get("/api/admin/analytics").json()
    assert len(after["recentRooms"]) == 1
    assert after["recentRooms"][0]["game"] == "wavelength"
    assert after["recentRooms"][0]["started"] is True
    assert after["recentRooms"][0]["roundsPlayed"] == 1


# ---- Phase 4: FirestoreTelemetryStore async batching, merging & streaming ---


def test_firestore_telemetry_store_batches_merges_and_reads_async_streams():
    class FakeIncrement:
        def __init__(self, amount: int) -> None:
            self.amount = amount

    class FakeArrayUnion:
        def __init__(self, values: list[str]) -> None:
            self.values = list(values)

    def apply_merge(target: dict, patch: dict) -> None:
        for k, v in patch.items():
            if isinstance(v, FakeIncrement):
                target[k] = int(target.get(k) or 0) + v.amount
            elif isinstance(v, FakeArrayUnion):
                cur = list(target.get(k) or [])
                for item in v.values:
                    if item not in cur:
                        cur.append(item)
                target[k] = cur
            elif isinstance(v, dict):
                sub = target.setdefault(k, {})
                apply_merge(sub, v)
            else:
                target[k] = v

    class FakeSnap:
        def __init__(self, doc_id: str, data: dict | None) -> None:
            self.id = doc_id
            self._data = data
            self.exists = data is not None

        def to_dict(self):
            return dict(self._data) if self._data is not None else None

    class FakeDocRef:
        def __init__(self, col_docs: dict[str, dict], doc_id: str) -> None:
            self._col_docs = col_docs
            self.id = doc_id

        async def get(self) -> FakeSnap:
            return FakeSnap(self.id, self._col_docs.get(self.id))

    class FakeQuery:
        def __init__(self, col_docs: dict[str, dict], field: str, limit_n: int = 25) -> None:
            self._col_docs = col_docs
            self._field = field
            self._limit = limit_n

        def limit(self, n: int) -> FakeQuery:
            return FakeQuery(self._col_docs, self._field, n)

        async def stream(self):
            ordered = sorted(
                self._col_docs.items(),
                key=lambda kv: kv[1].get(self._field, 0),
                reverse=True,
            )[: self._limit]
            for doc_id, data in ordered:
                yield FakeSnap(doc_id, data)

    class FakeCollection:
        def __init__(self) -> None:
            self.docs: dict[str, dict] = {}
            self._seq = 0

        def document(self, doc_id: str | None = None) -> FakeDocRef:
            if doc_id is None:
                self._seq += 1
                doc_id = f"auto_{self._seq}"
            return FakeDocRef(self.docs, doc_id)

        def order_by(self, field: str, *, direction: str) -> FakeQuery:
            assert direction == "DESCENDING"
            return FakeQuery(self.docs, field)

    class FakeBatch:
        def __init__(self) -> None:
            self._ops: list[tuple[str, FakeDocRef, dict]] = []

        def set(self, ref: FakeDocRef, data: dict, *, merge: bool = False) -> None:
            assert merge is True
            self._ops.append(("merge", ref, data))

        def create(self, ref: FakeDocRef, data: dict) -> None:
            self._ops.append(("create", ref, data))

        async def commit(self) -> None:
            for kind, ref, data in self._ops:
                if kind == "create":
                    ref._col_docs[ref.id] = dict(data)
                else:
                    doc = ref._col_docs.setdefault(ref.id, {})
                    apply_merge(doc, data)

    class FakeDB:
        def __init__(self) -> None:
            self.cols: dict[str, FakeCollection] = {}

        def collection(self, name: str) -> FakeCollection:
            return self.cols.setdefault(name, FakeCollection())

        def batch(self) -> FakeBatch:
            return FakeBatch()

        async def get_all(self, refs: list[FakeDocRef]):
            for ref in refs:
                yield await ref.get()

    class FakeFSModule:
        Increment = FakeIncrement
        ArrayUnion = FakeArrayUnion

        class Query:
            DESCENDING = "DESCENDING"

    # Build store without hitting GCP credentials by injecting fake client & module.
    fs_store = object.__new__(telemetry.FirestoreTelemetryStore)
    fake_db = FakeDB()
    fs_store._fs = FakeFSModule
    fs_store._db = fake_db
    fs_store._daily = fake_db.collection("analytics_daily")
    fs_store._monthly = fake_db.collection("analytics_monthly")
    fs_store._rooms = fake_db.collection("analytics_rooms")
    fs_store._peaks_loaded = set()
    fs_store._peak_rooms = {}
    fs_store._peak_players = {}

    async def scenario():
        t0 = datetime(2026, 11, 14, 4, 30, 0, tzinfo=timezone.utc).timestamp()  # 2026-11-13 PT
        await fs_store.record_room_created(t0, "spiritboard", peak_rooms=2, peak_players=7)
        await fs_store.record_room_created(t0 + 10, "wavelength", peak_rooms=1, peak_players=4)
        await fs_store.record_active_user(t0, "spiritboard", "aaaa1111bbbb2222")
        await fs_store.record_active_user(t0, "spiritboard", "aaaa1111bbbb2222")  # duplicate
        await fs_store.record_active_user(t0, "wavelength", "cccc3333dddd4444")
        await fs_store.record_room_started(t0 + 20, "spiritboard")
        await fs_store.record_peak(t0 + 30, peak_rooms=3, peak_players=9)
        await fs_store.record_room_closed(
            telemetry.ClosedRoomSummary(
                game="spiritboard",
                created_at=t0,
                closed_at=t0 + 900,
                duration_sec=900,
                reason="idle",
                started=True,
                rounds_played=5,
                human_players=4,
                bot_players=1,
                peak_concurrent=5,
                country="US",
                referer_host=None,
            )
        )
        return await fs_store.get_stats(now_ts=t0 + 900, days=3, months=2, recent_limit=5)

    stats = asyncio.run(scenario())
    today = stats["daily"][-1]
    assert today["date"] == "2026-11-13"
    assert today["dau"] == 2
    assert today["dauByGame"]["spiritboard"] == 1
    assert today["dauByGame"]["wavelength"] == 1
    assert today["roomsCreated"] == 2
    assert today["roomsCreatedByGame"]["spiritboard"] == 1
    assert today["roomsCreatedByGame"]["wavelength"] == 1
    assert today["roomsStarted"] == 1
    assert today["roundsPlayed"] == 5
    assert today["peakConcurrentRooms"] == 3
    assert today["peakConcurrentPlayers"] == 9

    month = stats["monthly"][-1]
    assert month["month"] == "2026-11"
    assert month["mau"] == 2
    assert month["roomsCreated"] == 2
    assert month["roundsPlayed"] == 5
    assert len(stats["recentRooms"]) == 1
    assert stats["recentRooms"][0]["durationSec"] == 900


# ---- Phase 5: Historical Cloud Run log backfill script ----------------------


def test_backfill_script_reconstructs_sessions_lanes_and_idempotent_merges():
    import importlib.util
    from pathlib import Path
    import sys

    script_path = Path(__file__).resolve().parents[2] / "scripts" / "backfill-analytics.py"
    spec = importlib.util.spec_from_file_location("backfill_analytics", script_path)
    assert spec and spec.loader
    bf = importlib.util.module_from_spec(spec)
    sys.modules["backfill_analytics"] = bf
    spec.loader.exec_module(bf)

    # Mirror real Cloud Run logs from Nov 14-15 (PT evenings Nov 13 & Nov 14):
    # - Nov 13 PT (73.170.205.147): Windows host + 2 simultaneous iPhones with identical UA
    #   (one of which reconnects sequentially) -> 3 DAU, 1 room created & started!
    # - Nov 14 PT (76.226.71.167): Mac TV open for two consecutive 1h segments (2s reconnect gap)
    #   -> merged into 1 room created & started, 1 DAU!
    entries = [
        # Nov 13 evening PT: Windows TV open 04:41Z -> 06:36Z
        {
            "timestamp": "2026-11-14T06:36:00.123456789Z",
            "httpRequest": {
                "status": 101,
                "requestUrl": "https://willynojopranoto.com/ws/wavelength/tv",
                "remoteIp": "73.170.205.147",
                "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/157.0.0.0",
                "latency": "6900.0s",
            },
        },
        # Friend 1 iPhone: 04:45Z -> 05:15Z, then sequential reconnect 05:16Z -> 06:00Z
        {
            "timestamp": "2026-11-14T05:15:00Z",
            "httpRequest": {
                "status": 101,
                "requestUrl": "https://willynojopranoto.com/ws/wavelength/play",
                "remoteIp": "73.170.205.147",
                "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 27_2_1 like Mac OS X)",
                "latency": "1800.0s",
            },
        },
        {
            "timestamp": "2026-11-14T06:00:00Z",
            "httpRequest": {
                "status": 101,
                "requestUrl": "https://willynojopranoto.com/ws/wavelength/play",
                "remoteIp": "73.170.205.147",
                "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 27_2_1 like Mac OS X)",
                "latency": "2640.0s",
            },
        },
        # Friend 2 iPhone (same Wi-Fi IP + identical UA, overlapping 04:50Z -> 05:50Z -> lane 1!)
        {
            "timestamp": "2026-11-14T05:50:00Z",
            "httpRequest": {
                "status": 101,
                "requestUrl": "https://willynojopranoto.com/ws/wavelength/play",
                "remoteIp": "73.170.205.147",
                "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 27_2_1 like Mac OS X)",
                "latency": "3600.0s",
            },
        },
        # Nov 14 evening PT: Mac TV hits 3600s Cloud Run timeout twice (2s gap -> 1 room!)
        {
            "timestamp": "2026-11-15T01:22:29.998242Z",
            "httpRequest": {
                "status": 101,
                "requestUrl": "https://willynojopranoto.com/ws/wavelength/tv",
                "remoteIp": "76.226.71.167",
                "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/158.0.0.0",
                "latency": "3600.0s",
            },
        },
        {
            "timestamp": "2026-11-15T02:22:31.987476Z",
            "httpRequest": {
                "status": 101,
                "requestUrl": "https://willynojopranoto.com/ws/wavelength/tv",
                "remoteIp": "76.226.71.167",
                "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/158.0.0.0",
                "latency": "3600.0s",
            },
        },
    ]

    spans = bf.parse_ws_request_entries(entries)
    res = bf.reconstruct_analytics(spans)

    fri = res["daily"]["2026-11-13"]
    assert len(fri["activeUsers"]) == 3  # Windows host + 2 simultaneous iPhones (reconnect deduplicated)
    assert fri["roomsCreated"] == 1
    assert fri["roomsStarted"] == 1

    sat = res["daily"]["2026-11-14"]
    assert len(sat["activeUsers"]) == 1  # Mac pass-and-play host
    assert sat["roomsCreated"] == 1
    assert sat["roomsStarted"] == 1

    nov = res["monthly"]["2026-11"]
    assert len(nov["activeUsers"]) == 4
    assert nov["roomsCreated"] == 2
    assert nov["roomsStarted"] == 2

    # Verify idempotency when merging onto a doc that already has 1 live room:
    live_existing = {
        "date": "2026-11-13",
        "activeUsers": ["liveuser12345678"],
        "activeUsersByGame": {"spiritboard": ["liveuser12345678"], "psych": [], "avalon": [], "wavelength": []},
        "roomsCreated": 1,
        "roomsCreatedByGame": {"spiritboard": 1, "psych": 0, "avalon": 0, "wavelength": 0},
        "roomsStarted": 1,
        "roomsStartedByGame": {"spiritboard": 1, "psych": 0, "avalon": 0, "wavelength": 0},
        "roundsPlayed": 4,
        "roundsPlayedByGame": {"spiritboard": 4, "psych": 0, "avalon": 0, "wavelength": 0},
        "peakConcurrentRooms": 1,
        "peakConcurrentPlayers": 2,
    }
    merged_once = bf.merge_bucket_with_existing("date", "2026-11-13", fri, live_existing, 1_763_500_000.0)
    merged_twice = bf.merge_bucket_with_existing("date", "2026-11-13", fri, merged_once, 1_763_500_100.0)
    assert merged_once["roomsCreated"] == 2  # 1 live + 1 backfilled
    assert merged_twice["roomsCreated"] == 2  # re-running never double-counts!
    assert len(merged_twice["activeUsers"]) == 4  # 1 live + 3 backfilled
    assert merged_twice["roundsPlayed"] == 4  # live rounds preserved

    # Verify Firestore REST commit endpoint uses /documents:commit (not :commit on the DB root):
    seen_urls: list[str] = []

    class _FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return b"{}"

    def _fake_urlopen(req, timeout=30):
        seen_urls.append(req.full_url)
        return _FakeResp()

    orig_urlopen = bf.urllib.request.urlopen
    bf.urllib.request.urlopen = _fake_urlopen
    try:
        bf._fs_commit_writes(
            "https://firestore.googleapis.com/v1/projects/nojo-client/databases/spirit-board",
            "tok",
            [{"update": {"name": "projects/nojo-client/databases/spirit-board/documents/analytics_daily/2026-11-13", "fields": {}}}],
        )
    finally:
        bf.urllib.request.urlopen = orig_urlopen

    assert seen_urls == [
        "https://firestore.googleapis.com/v1/projects/nojo-client/databases/spirit-board/documents:commit"
    ]
