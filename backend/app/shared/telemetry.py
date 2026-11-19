"""Privacy-preserving usage telemetry, DAU/MAU rollups, and structured JSON event logging.

Design principles:
- Game state machines (`rooms.py`) stay synchronous and deterministic.
- All Firestore writes run asynchronously in the background with short timeouts
  and exception guards so telemetry hiccups can never disrupt a party game.
- Zero PII or raw IPs are persisted: browser `__Host-sb_device` cookies are
  hashed into irreversible 16-hex-char anonymous tokens solely to deduplicate
  unique daily (DAU) and monthly (MAU) human players.
- Structured single-line JSON events go directly to stdout so Cloud Run indexes
  them under `jsonPayload.*` without duplicate Uvicorn access-log noise.
"""

from __future__ import annotations

import asyncio
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import hashlib
import json
import logging
import os
import re
import sys
import time
from typing import Any, Callable, Iterable, Mapping, Protocol
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

log = logging.getLogger("telemetry")

# Dedicated stdout JSON logger (no `INFO:logger:` prefix) so Cloud Run's built-in
# log agent parses every line straight into `jsonPayload` + native `severity`.
_json_log = logging.getLogger("spiritboard.telemetry.json")
_json_log.setLevel(logging.INFO)
_json_log.propagate = False
if not _json_log.handlers:
    _handler = logging.StreamHandler(sys.stdout)
    _handler.setFormatter(logging.Formatter("%(message)s"))
    _json_log.addHandler(_handler)

GAMES: tuple[str, ...] = ("spiritboard", "psych", "avalon", "wavelength")
PT = ZoneInfo("America/Los_Angeles")
CONCURRENCY_LIMIT = 200
FIRESTORE_TIMEOUT_SEC = 5.0
MAX_RECENT_ROOMS_MEMORY = 100

_COUNTRY_RE = re.compile(r"^[A-Z]{2}$")
_IGNORED_HOSTS = {"localhost", "127.0.0.1", "testserver", "willynojopranoto.com"}


def emit_event(event: str, *, severity: str = "INFO", **fields: Any) -> None:
    """Writes one structured JSON event line to stdout for Cloud Logging."""
    payload: dict[str, Any] = {"severity": severity, "event": event}
    for k, v in fields.items():
        if v is not None:
            payload[k] = v
    try:
        _json_log.info(json.dumps(payload, separators=(",", ":"), sort_keys=False))
    except Exception:  # pragma: no cover - logging must never raise
        pass


def day_key(ts: float) -> str:
    """YYYY-MM-DD in Pacific Time so evening game nights stay on one date."""
    return datetime.fromtimestamp(ts, tz=PT).strftime("%Y-%m-%d")


def month_key(ts: float) -> str:
    """YYYY-MM in Pacific Time."""
    return datetime.fromtimestamp(ts, tz=PT).strftime("%Y-%m")


def recent_day_keys(now_ts: float, days: int) -> list[str]:
    """Chronological list (oldest -> newest) of the last `days` PT dates."""
    today = datetime.fromtimestamp(now_ts, tz=PT).date()
    return [(today - timedelta(days=offset)).strftime("%Y-%m-%d") for offset in range(days - 1, -1, -1)]


def recent_month_keys(now_ts: float, months: int) -> list[str]:
    """Chronological list (oldest -> newest) of the last `months` PT YYYY-MM keys."""
    dt = datetime.fromtimestamp(now_ts, tz=PT)
    year, month = dt.year, dt.month
    out: list[str] = []
    for _ in range(months):
        out.append(f"{year:04d}-{month:02d}")
        month -= 1
        if month == 0:
            month = 12
            year -= 1
    out.reverse()
    return out


def anon_device_id(device: str | None) -> str | None:
    """Irreversible 64-bit hash prefix of `__Host-sb_device` for DAU/MAU deduplication."""
    if not device or not isinstance(device, str):
        return None
    return hashlib.sha256(f"sb-telemetry-v1:{device}".encode("utf-8")).hexdigest()[:16]


def extract_referer_host(headers: Mapping[str, str] | None) -> str | None:
    """External referrer hostname (e.g. 'reddit.com'), or None for direct/same-site visits."""
    if not headers:
        return None
    raw_ref = headers.get("referer") or headers.get("Referer")
    if not raw_ref:
        return None
    try:
        host = (urlsplit(raw_ref).hostname or "").lower().strip(".")
    except ValueError:
        return None
    if host.startswith("www."):
        host = host[4:]
    if not host or host in _IGNORED_HOSTS:
        return None
    req_host = (headers.get("host") or headers.get("Host") or "").split(":")[0].lower().strip(".")
    if req_host.startswith("www."):
        req_host = req_host[4:]
    if req_host and host == req_host:
        return None
    return host[:80]


def extract_country(headers: Mapping[str, str] | None) -> str | None:
    """2-letter ISO country code from CDN/proxy headers if present (no GeoIP DB needed)."""
    if not headers:
        return None
    for header in ("cf-ipcountry", "x-appengine-country", "x-country-code"):
        val = (headers.get(header) or "").strip().upper()
        if _COUNTRY_RE.fullmatch(val) and val not in ("XX", "ZZ"):
            return val
    return None


@dataclass(frozen=True)
class ClosedRoomSummary:
    game: str
    created_at: float
    closed_at: float
    duration_sec: int
    reason: str
    started: bool
    rounds_played: int
    human_players: int
    bot_players: int
    peak_concurrent: int
    country: str | None = None
    referer_host: str | None = None

    def to_doc(self) -> dict[str, Any]:
        return {
            "game": self.game,
            "createdAt": round(self.created_at, 3),
            "closedAt": round(self.closed_at, 3),
            "durationSec": self.duration_sec,
            "reason": self.reason,
            "started": self.started,
            "roundsPlayed": self.rounds_played,
            "humanPlayers": self.human_players,
            "botPlayers": self.bot_players,
            "peakConcurrent": self.peak_concurrent,
            "country": self.country,
            "refererHost": self.referer_host,
        }


def _empty_by_game() -> dict[str, int]:
    return {g: 0 for g in GAMES}


def _format_bucket_doc(key_field: str, key_val: str, raw: Mapping[str, Any] | None) -> dict[str, Any]:
    """Converts a raw daily/monthly Firestore or memory bucket into public admin counts."""
    d = raw or {}
    users = d.get("activeUsers") or ()
    unique_count = len(set(users))
    raw_users_by_game = d.get("activeUsersByGame") or {}
    users_by_game = {
        g: len(set(raw_users_by_game.get(g) or ()))
        for g in GAMES
    }
    created_by = _empty_by_game()
    for g, v in (d.get("roomsCreatedByGame") or {}).items():
        if g in created_by and isinstance(v, int):
            created_by[g] = v
    started_by = _empty_by_game()
    for g, v in (d.get("roomsStartedByGame") or {}).items():
        if g in started_by and isinstance(v, int):
            started_by[g] = v
    rounds_by = _empty_by_game()
    for g, v in (d.get("roundsPlayedByGame") or {}).items():
        if g in rounds_by and isinstance(v, int):
            rounds_by[g] = v

    user_metric = "dau" if key_field == "date" else "mau"
    return {
        key_field: key_val,
        user_metric: unique_count,
        f"{user_metric}ByGame": users_by_game,
        "roomsCreated": int(d.get("roomsCreated") or 0),
        "roomsCreatedByGame": created_by,
        "roomsStarted": int(d.get("roomsStarted") or 0),
        "roomsStartedByGame": started_by,
        "roundsPlayed": int(d.get("roundsPlayed") or 0),
        "roundsPlayedByGame": rounds_by,
        "peakConcurrentRooms": int(d.get("peakConcurrentRooms") or 0),
        "peakConcurrentPlayers": int(d.get("peakConcurrentPlayers") or 0),
    }


class TelemetryStore(Protocol):
    async def record_room_created(
        self, ts: float, game: str, *, peak_rooms: int, peak_players: int
    ) -> None: ...
    async def record_active_user(self, ts: float, game: str, anon_id: str) -> None: ...
    async def record_room_started(self, ts: float, game: str) -> None: ...
    async def record_peak(
        self, ts: float, *, peak_rooms: int, peak_players: int
    ) -> None: ...
    async def record_room_closed(self, summary: ClosedRoomSummary) -> None: ...
    async def get_stats(
        self,
        *,
        now_ts: float | None = None,
        days: int = 30,
        months: int = 12,
        recent_limit: int = 25,
    ) -> dict[str, Any]: ...


class MemoryTelemetryStore:
    """In-memory telemetry store for local development and deterministic unit tests."""

    def __init__(self) -> None:
        self.daily: dict[str, dict[str, Any]] = {}
        self.monthly: dict[str, dict[str, Any]] = {}
        self.recent_rooms: deque[dict[str, Any]] = deque(maxlen=MAX_RECENT_ROOMS_MEMORY)

    @staticmethod
    def _ensure_bucket(store: dict[str, dict[str, Any]], key: str) -> dict[str, Any]:
        b = store.get(key)
        if b is None:
            b = {
                "roomsCreated": 0,
                "roomsCreatedByGame": _empty_by_game(),
                "roomsStarted": 0,
                "roomsStartedByGame": _empty_by_game(),
                "roundsPlayed": 0,
                "roundsPlayedByGame": _empty_by_game(),
                "activeUsers": set(),
                "activeUsersByGame": {g: set() for g in GAMES},
                "peakConcurrentRooms": 0,
                "peakConcurrentPlayers": 0,
            }
            store[key] = b
        return b

    def _apply_room_created(
        self, ts: float, game: str, *, peak_rooms: int, peak_players: int
    ) -> None:
        for store, key in ((self.daily, day_key(ts)), (self.monthly, month_key(ts))):
            b = self._ensure_bucket(store, key)
            b["roomsCreated"] += 1
            if game in b["roomsCreatedByGame"]:
                b["roomsCreatedByGame"][game] += 1
            b["peakConcurrentRooms"] = max(b["peakConcurrentRooms"], peak_rooms)
            b["peakConcurrentPlayers"] = max(b["peakConcurrentPlayers"], peak_players)

    def _apply_active_user(self, ts: float, game: str, anon_id: str) -> None:
        for store, key in ((self.daily, day_key(ts)), (self.monthly, month_key(ts))):
            b = self._ensure_bucket(store, key)
            b["activeUsers"].add(anon_id)
            if game in b["activeUsersByGame"]:
                b["activeUsersByGame"][game].add(anon_id)

    def _apply_room_started(self, ts: float, game: str) -> None:
        for store, key in ((self.daily, day_key(ts)), (self.monthly, month_key(ts))):
            b = self._ensure_bucket(store, key)
            b["roomsStarted"] += 1
            if game in b["roomsStartedByGame"]:
                b["roomsStartedByGame"][game] += 1

    def _apply_peak(self, ts: float, *, peak_rooms: int, peak_players: int) -> None:
        for store, key in ((self.daily, day_key(ts)), (self.monthly, month_key(ts))):
            b = self._ensure_bucket(store, key)
            b["peakConcurrentRooms"] = max(b["peakConcurrentRooms"], peak_rooms)
            b["peakConcurrentPlayers"] = max(b["peakConcurrentPlayers"], peak_players)

    def _apply_room_closed(self, summary: ClosedRoomSummary) -> None:
        if summary.rounds_played > 0:
            for store, key in (
                (self.daily, day_key(summary.closed_at)),
                (self.monthly, month_key(summary.closed_at)),
            ):
                b = self._ensure_bucket(store, key)
                b["roundsPlayed"] += summary.rounds_played
                if summary.game in b["roundsPlayedByGame"]:
                    b["roundsPlayedByGame"][summary.game] += summary.rounds_played
        self.recent_rooms.appendleft(summary.to_doc())

    async def record_room_created(
        self, ts: float, game: str, *, peak_rooms: int, peak_players: int
    ) -> None:
        self._apply_room_created(ts, game, peak_rooms=peak_rooms, peak_players=peak_players)

    async def record_active_user(self, ts: float, game: str, anon_id: str) -> None:
        self._apply_active_user(ts, game, anon_id)

    async def record_room_started(self, ts: float, game: str) -> None:
        self._apply_room_started(ts, game)

    async def record_peak(
        self, ts: float, *, peak_rooms: int, peak_players: int
    ) -> None:
        self._apply_peak(ts, peak_rooms=peak_rooms, peak_players=peak_players)

    async def record_room_closed(self, summary: ClosedRoomSummary) -> None:
        self._apply_room_closed(summary)

    async def get_stats(
        self,
        *,
        now_ts: float | None = None,
        days: int = 30,
        months: int = 12,
        recent_limit: int = 25,
    ) -> dict[str, Any]:
        ts = time.time() if now_ts is None else now_ts
        d_keys = recent_day_keys(ts, days)
        m_keys = recent_month_keys(ts, months)
        return {
            "daily": [_format_bucket_doc("date", k, self.daily.get(k)) for k in d_keys],
            "monthly": [_format_bucket_doc("month", k, self.monthly.get(k)) for k in m_keys],
            "recentRooms": list(self.recent_rooms)[:recent_limit],
        }


class FirestoreTelemetryStore:
    """Firestore-backed telemetry store sharing the `spirit-board` database.

    Collections:
    - `analytics_daily/{YYYY-MM-DD}`
    - `analytics_monthly/{YYYY-MM}`
    - `analytics_rooms/{auto_id}`
    """

    def __init__(self, project: str | None, database: str) -> None:
        from google.cloud import firestore  # lazy import: only needed in production

        self._fs = firestore
        self._db = firestore.AsyncClient(project=project, database=database)
        self._daily = self._db.collection("analytics_daily")
        self._monthly = self._db.collection("analytics_monthly")
        self._rooms = self._db.collection("analytics_rooms")
        # Cache known peaks per key so we never overwrite a higher peak after a restart.
        self._peaks_loaded: set[str] = set()
        self._peak_rooms: dict[str, int] = {}
        self._peak_players: dict[str, int] = {}

    async def _compute_peak_updates(
        self, col, key: str, prefix: str, peak_rooms: int, peak_players: int
    ) -> dict[str, int]:
        cache_key = f"{prefix}:{key}"
        if cache_key not in self._peaks_loaded:
            snap = await col.document(key).get()
            existing = (snap.to_dict() or {}) if snap.exists else {}
            self._peak_rooms[cache_key] = int(existing.get("peakConcurrentRooms") or 0)
            self._peak_players[cache_key] = int(existing.get("peakConcurrentPlayers") or 0)
            self._peaks_loaded.add(cache_key)

        updates: dict[str, int] = {}
        if peak_rooms > self._peak_rooms.get(cache_key, 0):
            self._peak_rooms[cache_key] = peak_rooms
            updates["peakConcurrentRooms"] = peak_rooms
        if peak_players > self._peak_players.get(cache_key, 0):
            self._peak_players[cache_key] = peak_players
            updates["peakConcurrentPlayers"] = peak_players
        return updates

    async def record_room_created(
        self, ts: float, game: str, *, peak_rooms: int, peak_players: int
    ) -> None:
        inc = self._fs.Increment
        d_key, m_key = day_key(ts), month_key(ts)
        d_peaks = await self._compute_peak_updates(self._daily, d_key, "d", peak_rooms, peak_players)
        m_peaks = await self._compute_peak_updates(self._monthly, m_key, "m", peak_rooms, peak_players)

        base_d: dict[str, Any] = {
            "date": d_key,
            "roomsCreated": inc(1),
            "roomsCreatedByGame": {game: inc(1)},
            "updatedAt": ts,
            **d_peaks,
        }
        base_m: dict[str, Any] = {
            "month": m_key,
            "roomsCreated": inc(1),
            "roomsCreatedByGame": {game: inc(1)},
            "updatedAt": ts,
            **m_peaks,
        }
        batch = self._db.batch()
        batch.set(self._daily.document(d_key), base_d, merge=True)
        batch.set(self._monthly.document(m_key), base_m, merge=True)
        await batch.commit()

    async def record_active_user(self, ts: float, game: str, anon_id: str) -> None:
        union = self._fs.ArrayUnion([anon_id])
        d_key, m_key = day_key(ts), month_key(ts)
        batch = self._db.batch()
        batch.set(
            self._daily.document(d_key),
            {
                "date": d_key,
                "activeUsers": union,
                "activeUsersByGame": {game: union},
                "updatedAt": ts,
            },
            merge=True,
        )
        batch.set(
            self._monthly.document(m_key),
            {
                "month": m_key,
                "activeUsers": union,
                "activeUsersByGame": {game: union},
                "updatedAt": ts,
            },
            merge=True,
        )
        await batch.commit()

    async def record_room_started(self, ts: float, game: str) -> None:
        inc = self._fs.Increment
        d_key, m_key = day_key(ts), month_key(ts)
        batch = self._db.batch()
        batch.set(
            self._daily.document(d_key),
            {
                "date": d_key,
                "roomsStarted": inc(1),
                "roomsStartedByGame": {game: inc(1)},
                "updatedAt": ts,
            },
            merge=True,
        )
        batch.set(
            self._monthly.document(m_key),
            {
                "month": m_key,
                "roomsStarted": inc(1),
                "roomsStartedByGame": {game: inc(1)},
                "updatedAt": ts,
            },
            merge=True,
        )
        await batch.commit()

    async def record_peak(
        self, ts: float, *, peak_rooms: int, peak_players: int
    ) -> None:
        d_key, m_key = day_key(ts), month_key(ts)
        d_peaks = await self._compute_peak_updates(self._daily, d_key, "d", peak_rooms, peak_players)
        m_peaks = await self._compute_peak_updates(self._monthly, m_key, "m", peak_rooms, peak_players)
        if not d_peaks and not m_peaks:
            return
        batch = self._db.batch()
        if d_peaks:
            batch.set(self._daily.document(d_key), {"date": d_key, "updatedAt": ts, **d_peaks}, merge=True)
        if m_peaks:
            batch.set(self._monthly.document(m_key), {"month": m_key, "updatedAt": ts, **m_peaks}, merge=True)
        await batch.commit()

    async def record_room_closed(self, summary: ClosedRoomSummary) -> None:
        batch = self._db.batch()
        if summary.rounds_played > 0:
            inc = self._fs.Increment(summary.rounds_played)
            d_key = day_key(summary.closed_at)
            m_key = month_key(summary.closed_at)
            batch.set(
                self._daily.document(d_key),
                {
                    "date": d_key,
                    "roundsPlayed": inc,
                    "roundsPlayedByGame": {summary.game: inc},
                    "updatedAt": summary.closed_at,
                },
                merge=True,
            )
            batch.set(
                self._monthly.document(m_key),
                {
                    "month": m_key,
                    "roundsPlayed": inc,
                    "roundsPlayedByGame": {summary.game: inc},
                    "updatedAt": summary.closed_at,
                },
                merge=True,
            )
        batch.create(self._rooms.document(), summary.to_doc())
        await batch.commit()

    async def get_stats(
        self,
        *,
        now_ts: float | None = None,
        days: int = 30,
        months: int = 12,
        recent_limit: int = 25,
    ) -> dict[str, Any]:
        ts = time.time() if now_ts is None else now_ts
        d_keys = recent_day_keys(ts, days)
        m_keys = recent_month_keys(ts, months)

        d_map: dict[str, dict[str, Any]] = {}
        async for snap in self._db.get_all([self._daily.document(k) for k in d_keys]):
            if snap.exists:
                d_map[snap.id] = snap.to_dict() or {}

        m_map: dict[str, dict[str, Any]] = {}
        async for snap in self._db.get_all([self._monthly.document(k) for k in m_keys]):
            if snap.exists:
                m_map[snap.id] = snap.to_dict() or {}

        query = self._rooms.order_by(
            "closedAt", direction=self._fs.Query.DESCENDING
        ).limit(recent_limit)
        recent: list[dict[str, Any]] = [
            snap.to_dict() or {} async for snap in query.stream()
        ]

        return {
            "daily": [_format_bucket_doc("date", k, d_map.get(k)) for k in d_keys],
            "monthly": [_format_bucket_doc("month", k, m_map.get(k)) for k in m_keys],
            "recentRooms": recent,
        }


def make_telemetry_store(database: str | None, project: str | None) -> TelemetryStore:
    if database:
        return FirestoreTelemetryStore(project, database)
    return MemoryTelemetryStore()


# ---- Room lifecycle & live capacity tracker ---------------------------------


def _iter_players(room: Any) -> Iterable[Any]:
    players = getattr(room, "players", None)
    if isinstance(players, dict):
        return players.values()
    if isinstance(players, list):
        return players
    return ()


@dataclass
class _RoomSession:
    game: str
    code: str
    created_at: float
    started: bool = False
    rounds_played: int = 0
    human_ids: set[str] = field(default_factory=set)
    max_humans: int = 0
    max_bots: int = 0
    peak_concurrent: int = 0
    country: str | None = None
    referer_host: str | None = None


class TelemetryTracker:
    """Coordinates structured logs, deduplicated DAU/MAU writes, and live capacity."""

    def __init__(
        self,
        store: TelemetryStore,
        *,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.store = store
        self.clock = clock
        self._managers: dict[str, tuple[Any, int]] = {}
        self._sessions: dict[int, _RoomSession] = {}
        # Avoid duplicate Firestore ArrayUnion writes when the same device plays
        # multiple games or reconnects on the same day.
        self._seen_daily_user: set[tuple[str, str, str]] = set()
        self._pending: set[asyncio.Task[Any]] = set()

    def register_manager(self, game: str, manager: Any, *, max_rooms: int = 20) -> None:
        self._managers[game] = (manager, max_rooms)

    def _schedule(self, coro) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # Synchronous unit tests calling RoomManager without a running loop:
            # execute MemoryTelemetryStore inline and close any unawaited coroutine cleanly.
            coro.close()
            return

        async def _runner() -> None:
            try:
                await asyncio.wait_for(coro, timeout=FIRESTORE_TIMEOUT_SEC)
            except Exception:
                log.warning("telemetry write failed", exc_info=True)

        task = loop.create_task(_runner())
        self._pending.add(task)
        task.add_done_callback(self._pending.discard)

    async def flush(self) -> None:
        """Waits for any in-flight background telemetry writes (handy in tests)."""
        if self._pending:
            await asyncio.gather(*list(self._pending), return_exceptions=True)

    def _refresh_room_counts(self, room: Any, session: _RoomSession) -> None:
        humans = 0
        bots = 0
        for p in _iter_players(room):
            if getattr(p, "is_bot", False):
                bots += 1
            else:
                humans += 1
        session.max_humans = max(session.max_humans, humans)
        session.max_bots = max(session.max_bots, bots)
        conns = len(getattr(room, "tv_conns", ())) + len(getattr(room, "player_conns", ()))
        session.peak_concurrent = max(session.peak_concurrent, conns)

    def live_snapshot(self) -> dict[str, Any]:
        """Current live rooms, sockets, and player counts across all 4 games."""
        by_game: dict[str, dict[str, int]] = {}
        total_rooms = 0
        total_max_rooms = 0
        total_tv_sockets = 0
        total_player_sockets = 0
        total_humans = 0
        total_bots = 0

        for game in GAMES:
            entry = self._managers.get(game)
            if entry is None:
                by_game[game] = {
                    "activeRooms": 0,
                    "lobbyRooms": 0,
                    "playingRooms": 0,
                    "maxRooms": 20,
                    "connectedPlayers": 0,
                    "humanSeats": 0,
                    "botSeats": 0,
                }
                total_max_rooms += 20
                continue

            mgr, max_rooms = entry
            rooms = list(getattr(mgr, "rooms", {}).values())
            lobby = sum(1 for r in rooms if getattr(r, "phase", "lobby") == "lobby")
            playing = len(rooms) - lobby
            tv_socks = sum(len(getattr(r, "tv_conns", ())) for r in rooms)
            pl_socks = sum(len(getattr(r, "player_conns", ())) for r in rooms)
            humans = sum(
                1 for r in rooms for p in _iter_players(r) if not getattr(p, "is_bot", False)
            )
            bots = sum(
                1 for r in rooms for p in _iter_players(r) if getattr(p, "is_bot", False)
            )
            by_game[game] = {
                "activeRooms": len(rooms),
                "lobbyRooms": lobby,
                "playingRooms": playing,
                "maxRooms": max_rooms,
                "connectedPlayers": pl_socks,
                "humanSeats": humans,
                "botSeats": bots,
            }
            total_rooms += len(rooms)
            total_max_rooms += max_rooms
            total_tv_sockets += tv_socks
            total_player_sockets += pl_socks
            total_humans += humans
            total_bots += bots

        return {
            "activeRooms": total_rooms,
            "maxRoomsTotal": total_max_rooms,
            "openWebSockets": total_tv_sockets + total_player_sockets,
            "tvSockets": total_tv_sockets,
            "playerSockets": total_player_sockets,
            "concurrencyLimit": CONCURRENCY_LIMIT,
            "humanSeats": total_humans,
            "botSeats": total_bots,
            "byGame": by_game,
        }

    def _totals_for_peaks(self) -> tuple[int, int]:
        snap = self.live_snapshot()
        # Peak concurrent players tracks connected player WebSockets (or human seats if pass-and-play).
        concurrent_players = max(snap["playerSockets"], snap["humanSeats"])
        return snap["activeRooms"], concurrent_players

    def on_room_created(
        self,
        game: str,
        room: Any,
        *,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        ts = self.clock()
        rid = id(room)
        country = extract_country(headers)
        ref_host = extract_referer_host(headers)
        session = self._sessions.get(rid)
        if session is None:
            session = _RoomSession(
                game=game,
                code=getattr(room, "code", ""),
                created_at=ts,
                country=country,
                referer_host=ref_host,
            )
            self._sessions[rid] = session
        else:
            if country and not session.country:
                session.country = country
            if ref_host and not session.referer_host:
                session.referer_host = ref_host

        self._refresh_room_counts(room, session)
        active_total, peak_players = self._totals_for_peaks()
        mgr_entry = self._managers.get(game)
        active_game = len(getattr(mgr_entry[0], "rooms", {})) if mgr_entry else 1

        emit_event(
            "room_created",
            game=game,
            activeRoomsGame=active_game,
            activeRoomsTotal=active_total,
            country=session.country,
            refererHost=session.referer_host,
        )

        if isinstance(self.store, MemoryTelemetryStore):
            self.store._apply_room_created(
                ts, game, peak_rooms=active_total, peak_players=peak_players
            )
        else:
            self._schedule(
                self.store.record_room_created(
                    ts, game, peak_rooms=active_total, peak_players=peak_players
                )
            )

    def attach_host_headers(
        self, room: Any, headers: Mapping[str, str] | None
    ) -> None:
        """Attaches HTTP upgrade metadata (`Referer`, country) after `create_room()`."""
        session = self._sessions.get(id(room))
        if session is None or not headers:
            return
        if not session.country:
            session.country = extract_country(headers)
        if not session.referer_host:
            session.referer_host = extract_referer_host(headers)
        self._refresh_room_counts(room, session)

    def _record_user(self, ts: float, game: str, session: _RoomSession | None, device: str | None) -> None:
        anon = anon_device_id(device)
        if anon is None:
            return
        if session is not None:
            session.human_ids.add(anon)
        d_key = day_key(ts)
        # Bound cache size if process stays up across many days
        if len(self._seen_daily_user) > 20_000:
            self._seen_daily_user.clear()
        dedup_key = (d_key, game, anon)
        if dedup_key in self._seen_daily_user:
            return
        self._seen_daily_user.add(dedup_key)
        if isinstance(self.store, MemoryTelemetryStore):
            self.store._apply_active_user(ts, game, anon)
        else:
            self._schedule(self.store.record_active_user(ts, game, anon))

    def on_player_joined(
        self,
        game: str,
        room: Any,
        *,
        device: str | None,
        is_bot: bool = False,
    ) -> None:
        ts = self.clock()
        session = self._sessions.get(id(room))
        if session is not None:
            self._refresh_room_counts(room, session)
        if is_bot:
            return
        self._record_user(ts, game, session, device)
        active_total, peak_players = self._totals_for_peaks()
        if isinstance(self.store, MemoryTelemetryStore):
            self.store._apply_peak(ts, peak_rooms=active_total, peak_players=peak_players)
        else:
            self._schedule(
                self.store.record_peak(ts, peak_rooms=active_total, peak_players=peak_players)
            )

    def on_game_started(
        self,
        game: str,
        room: Any,
        *,
        host_device: str | None = None,
        increment_round: bool = True,
    ) -> None:
        ts = self.clock()
        session = self._sessions.get(id(room))
        first_start = False
        if session is not None:
            self._refresh_room_counts(room, session)
            if not session.started:
                session.started = True
                first_start = True
            if increment_round:
                session.rounds_played += 1

        # Count the TV host as an active user once a game actually starts
        # (covers single-screen pass-and-play rooms with 0 phone sockets).
        self._record_user(ts, game, session, host_device or getattr(room, "host_device", None))

        humans = sum(1 for p in _iter_players(room) if not getattr(p, "is_bot", False))
        bots = sum(1 for p in _iter_players(room) if getattr(p, "is_bot", False))

        if first_start:
            emit_event(
                "game_started",
                game=game,
                humanPlayers=humans,
                botPlayers=bots,
            )
            if isinstance(self.store, MemoryTelemetryStore):
                self.store._apply_room_started(ts, game)
            else:
                self._schedule(self.store.record_room_started(ts, game))

    def on_round_started(self, game: str, room: Any) -> None:
        session = self._sessions.get(id(room))
        if session is not None:
            self._refresh_room_counts(room, session)
            if not session.started:
                self.on_game_started(game, room, increment_round=True)
                return
            session.rounds_played += 1

    def on_room_closed(self, game: str, room: Any, *, reason: str = "closed") -> None:
        session = self._sessions.pop(id(room), None)
        if session is None:
            return
        ts = self.clock()
        self._refresh_room_counts(room, session)
        # For Avalon, quests can also advance via bot ticks in the background loop:
        quest_results = getattr(room, "quest_results", None)
        if isinstance(quest_results, list):
            session.rounds_played = max(session.rounds_played, len(quest_results))

        human_count = max(session.max_humans, len(session.human_ids))
        summary = ClosedRoomSummary(
            game=game,
            created_at=session.created_at,
            closed_at=ts,
            duration_sec=max(0, int(round(ts - session.created_at))),
            reason=reason,
            started=session.started,
            rounds_played=session.rounds_played,
            human_players=human_count,
            bot_players=session.max_bots,
            peak_concurrent=session.peak_concurrent,
            country=session.country,
            referer_host=session.referer_host,
        )
        emit_event(
            "room_closed",
            game=game,
            reason=reason,
            durationSec=summary.duration_sec,
            started=summary.started,
            roundsPlayed=summary.rounds_played,
            humanPlayers=summary.human_players,
            botPlayers=summary.bot_players,
            peakConcurrent=summary.peak_concurrent,
            country=summary.country,
            refererHost=summary.referer_host,
        )
        if isinstance(self.store, MemoryTelemetryStore):
            self.store._apply_room_closed(summary)
        else:
            self._schedule(self.store.record_room_closed(summary))


store: TelemetryStore = make_telemetry_store(
    os.environ.get("SB_FIRESTORE_DATABASE"), os.environ.get("GOOGLE_CLOUD_PROJECT")
)
tracker = TelemetryTracker(store)
