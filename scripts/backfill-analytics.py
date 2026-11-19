#!/usr/bin/env python3
"""One-off historical analytics backfill from Cloud Run logs into Firestore.

Reads the last N days (default: 30) of Cloud Run WebSocket request logs
(`run.googleapis.com/requests` on `/ws/<game>/<tv|play>`) and legacy stdout room
creation logs via `gcloud`, reconstructs daily/monthly active users (DAU/MAU) and
room sessions in `America/Los_Angeles`, and writes them idempotently into the
`spirit-board` Firestore database (`analytics_daily`, `analytics_monthly`,
`analytics_rooms`).

Uses only the Python 3 standard library + your existing `gcloud` CLI login
(no virtualenv or Application Default Credentials setup required).

Usage:
  ./scripts/backfill-analytics.py           # Dry-run: prints reconstructed table only
  ./scripts/backfill-analytics.py --apply   # Writes reconstructed history to Firestore
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import json
import re
import subprocess
import sys
from typing import Any, Iterable
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

GAMES: tuple[str, ...] = ("spiritboard", "psych", "avalon", "wavelength")
PT = ZoneInfo("America/Los_Angeles")

WS_PATH_RE = re.compile(r"^/ws/(spiritboard|psych|avalon|wavelength)/(tv|play)/?$")
RFC3339_RE = re.compile(
    r"^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$"
)
LEGACY_CREATED_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("psych", re.compile(r"\bpsych room created\b")),
    ("avalon", re.compile(r"\bavalon room created\b")),
    ("spiritboard", re.compile(r"(?<![\w-])room created \(\d+ active\)")),
)
IGNORED_REFERER_HOSTS = {"localhost", "127.0.0.1", "testserver", "willynojopranoto.com"}

# Matches backend/app/*/rooms.py ROOM_IDLE_SECONDS (15 min): TV reconnects within
# 15 minutes from the same IP resume the existing room rather than opening a new one.
SESSION_MERGE_GAP_SEC = 15 * 60
# Small buffer when assigning concurrent device lanes so a quick tab refresh
# doesn't look like two simultaneous phones with the same User-Agent.
LANE_OVERLAP_BUFFER_SEC = 3.0


@dataclass(frozen=True)
class WsSpan:
    game: str
    role: str  # "tv" | "play"
    start_ts: float
    end_ts: float
    duration_sec: float
    remote_ip: str
    user_agent: str
    referer_host: str | None


@dataclass
class ReconstructedRoom:
    game: str
    remote_ip: str
    created_at: float
    closed_at: float
    tv_duration_sec: float = 0.0
    human_ids: set[str] = field(default_factory=set)
    peak_concurrent: int = 1
    referer_host: str | None = None

    @property
    def duration_sec(self) -> int:
        return max(0, int(round(self.closed_at - self.created_at)))

    @property
    def has_phone_players(self) -> bool:
        return len(self.human_ids) > 0

    @property
    def started(self) -> bool:
        # Conservative heuristic for pre-telemetry sessions:
        # - Phone players joined and room stayed open >= 2 min, OR
        # - Single-screen / pass-and-play TV stayed actively connected >= 3 min.
        if self.has_phone_players and self.duration_sec >= 120:
            return True
        if self.tv_duration_sec >= 180:
            return True
        return False

    def doc_id(self) -> str:
        raw = f"{self.game}:{self.remote_ip}:{int(self.created_at)}"
        return "bf_" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]

    def to_doc(self, total_humans: int) -> dict[str, Any]:
        return {
            "game": self.game,
            "createdAt": round(self.created_at, 3),
            "closedAt": round(self.closed_at, 3),
            "durationSec": self.duration_sec,
            "reason": "backfill",
            "started": self.started,
            "roundsPlayed": 0,
            "humanPlayers": max(total_humans, 1 if self.started else 0),
            "botPlayers": 0,
            "peakConcurrent": max(1, self.peak_concurrent),
            "country": None,
            "refererHost": self.referer_host,
        }


def parse_rfc3339(raw: str | None) -> float | None:
    if not raw or not isinstance(raw, str):
        return None
    m = RFC3339_RE.match(raw.strip())
    if not m:
        return None
    date_part, time_part, frac, tz_part = m.groups()
    micros = (frac or "0").ljust(6, "0")[:6]
    tz_iso = "+00:00" if tz_part == "Z" else tz_part
    dt = datetime.fromisoformat(f"{date_part}T{time_part}.{micros}{tz_iso}")
    return dt.timestamp()


def parse_latency_sec(raw: str | None) -> float:
    if not raw or not isinstance(raw, str):
        return 0.0
    s = raw.strip()
    if s.endswith("s"):
        try:
            return max(0.0, float(s[:-1]))
        except ValueError:
            return 0.0
    return 0.0


def extract_referer_host(raw_ref: str | None) -> str | None:
    if not raw_ref:
        return None
    try:
        host = (urllib.parse.urlsplit(raw_ref).hostname or "").lower().strip(".")
    except ValueError:
        return None
    if host.startswith("www."):
        host = host[4:]
    if not host or host in IGNORED_REFERER_HOSTS:
        return None
    return host[:80]


def day_key(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=PT).strftime("%Y-%m-%d")


def month_key(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=PT).strftime("%Y-%m")


def anon_backfill_id(remote_ip: str, user_agent: str, lane: int) -> str:
    raw = f"sb-backfill-v1:{remote_ip}:{user_agent}:lane={lane}"
    return "bf_" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:13]


def parse_ws_request_entries(
    entries: Iterable[dict[str, Any]],
    *,
    cutoff_ts: float | None = None,
) -> list[WsSpan]:
    """Converts Cloud Run `run.googleapis.com/requests` JSON entries into WsSpans."""
    spans: list[WsSpan] = []
    for entry in entries:
        req = entry.get("httpRequest") or {}
        status = int(req.get("status") or 0)
        if status and status >= 400:
            continue
        url = req.get("requestUrl") or ""
        try:
            path = urllib.parse.urlsplit(url).path
        except ValueError:
            continue
        m = WS_PATH_RE.match(path)
        if not m:
            continue
        end_ts = parse_rfc3339(entry.get("timestamp"))
        if end_ts is None:
            continue
        dur = parse_latency_sec(req.get("latency"))
        start_ts = max(0.0, end_ts - dur)
        if cutoff_ts is not None and start_ts >= cutoff_ts:
            continue
        game, role = m.group(1), m.group(2)
        remote_ip = (req.get("remoteIp") or "unknown").strip()
        user_agent = (req.get("userAgent") or "unknown").strip()
        ref_host = extract_referer_host(req.get("referer"))
        spans.append(
            WsSpan(
                game=game,
                role=role,
                start_ts=start_ts,
                end_ts=end_ts,
                duration_sec=dur,
                remote_ip=remote_ip,
                user_agent=user_agent,
                referer_host=ref_host,
            )
        )
    spans.sort(key=lambda s: (s.start_ts, s.end_ts))
    return spans


def parse_legacy_stdout_room_counts(
    entries: Iterable[dict[str, Any]],
    *,
    cutoff_ts: float | None = None,
) -> dict[tuple[str, str], int]:
    """Counts `(day_key, game)` occurrences from legacy `room created` stdout logs."""
    counts: dict[tuple[str, str], int] = defaultdict(int)
    for entry in entries:
        ts = parse_rfc3339(entry.get("timestamp"))
        if ts is None or (cutoff_ts is not None and ts >= cutoff_ts):
            continue
        text = entry.get("textPayload") or ""
        if not text:
            continue
        for game, pattern in LEGACY_CREATED_PATTERNS:
            if pattern.search(text):
                counts[(day_key(ts), game)] += 1
                break
    return counts


def assign_device_ids(spans: list[WsSpan]) -> dict[int, str]:
    """Assigns deterministic anonymous device IDs to spans via greedy lane coloring.

    Why lanes? On party Wi-Fi, multiple friends share `remoteIp` and two iPhones on
    the same iOS version also share `userAgent`. Sequential reconnects from one
    phone reuse lane 0 (1 DAU), whereas N phones connected simultaneously get
    lanes 0..N-1 (N distinct DAU).
    """
    play_by_fp: dict[tuple[str, str], list[tuple[int, WsSpan]]] = defaultdict(list)
    for idx, s in enumerate(spans):
        if s.role == "play":
            play_by_fp[(s.remote_ip, s.user_agent)].append((idx, s))

    assigned: dict[int, str] = {}
    for (ip, ua), items in play_by_fp.items():
        items.sort(key=lambda pair: (pair[1].start_ts, pair[1].end_ts))
        lane_free_at: list[float] = []
        for idx, s in items:
            chosen_lane: int | None = None
            for lane_idx, free_ts in enumerate(lane_free_at):
                if free_ts <= s.start_ts + LANE_OVERLAP_BUFFER_SEC:
                    chosen_lane = lane_idx
                    lane_free_at[lane_idx] = max(free_ts, s.end_ts)
                    break
            if chosen_lane is None:
                chosen_lane = len(lane_free_at)
                lane_free_at.append(s.end_ts)
            assigned[idx] = anon_backfill_id(ip, ua, chosen_lane)

    # TV sockets map to lane 0 of their (ip, ua) so a host playing on the same
    # laptop doesn't double-count as 2 people.
    for idx, s in enumerate(spans):
        if s.role == "tv":
            assigned[idx] = anon_backfill_id(s.remote_ip, s.user_agent, 0)

    return assigned


def _peak_overlap(intervals: list[tuple[float, float]]) -> int:
    events: list[tuple[float, int]] = []
    for start, end in intervals:
        eff_end = max(start + 0.5, end)
        events.append((start, 1))
        events.append((eff_end, -1))
    events.sort(key=lambda e: (e[0], e[1]))
    cur = peak = 0
    for _, delta in events:
        cur += delta
        if cur > peak:
            peak = cur
    return peak


def reconstruct_analytics(
    spans: list[WsSpan],
    legacy_stdout_counts: dict[tuple[str, str], int] | None = None,
) -> dict[str, Any]:
    """Reconstructs daily buckets, monthly buckets, and room summaries from spans."""
    legacy_counts = legacy_stdout_counts or {}
    span_device = assign_device_ids(spans)

    # 1. Cluster TV spans per (game, remote_ip) into room sessions.
    by_game_ip: dict[tuple[str, str], list[tuple[int, WsSpan]]] = defaultdict(list)
    for idx, s in enumerate(spans):
        by_game_ip[(s.game, s.remote_ip)].append((idx, s))

    rooms: list[ReconstructedRoom] = []
    for (game, ip), group in by_game_ip.items():
        tv_items = [(idx, s) for idx, s in group if s.role == "tv"]
        play_items = [(idx, s) for idx, s in group if s.role == "play"]

        group_rooms: list[ReconstructedRoom] = []
        for idx, tv in sorted(tv_items, key=lambda p: p[1].start_ts):
            if group_rooms and tv.start_ts <= group_rooms[-1].closed_at + SESSION_MERGE_GAP_SEC:
                cur = group_rooms[-1]
                cur.closed_at = max(cur.closed_at, tv.end_ts)
                cur.tv_duration_sec += tv.duration_sec
                if not cur.referer_host and tv.referer_host:
                    cur.referer_host = tv.referer_host
            else:
                group_rooms.append(
                    ReconstructedRoom(
                        game=game,
                        remote_ip=ip,
                        created_at=tv.start_ts,
                        closed_at=tv.end_ts,
                        tv_duration_sec=tv.duration_sec,
                        referer_host=tv.referer_host,
                    )
                )

        # Fallback if a room's TV opened >30d ago or stayed open differently while
        # `/play` sockets were logged in-window: cluster orphan `/play` spans.
        for idx, pl in sorted(play_items, key=lambda p: p[1].start_ts):
            matched: ReconstructedRoom | None = None
            for r in group_rooms:
                if pl.end_ts >= r.created_at - 30 and pl.start_ts <= r.closed_at + SESSION_MERGE_GAP_SEC:
                    matched = r
                    break
            if matched is None:
                matched = ReconstructedRoom(
                    game=game,
                    remote_ip=ip,
                    created_at=pl.start_ts,
                    closed_at=pl.end_ts,
                )
                group_rooms.append(matched)
            matched.closed_at = max(matched.closed_at, pl.end_ts)
            matched.human_ids.add(span_device[idx])

        # Compute peak concurrent sockets & host participation per room.
        for r in group_rooms:
            member_spans = [
                (idx, s)
                for idx, s in group
                if s.end_ts >= r.created_at - 30 and s.start_ts <= r.closed_at + 30
            ]
            r.peak_concurrent = max(
                1, _peak_overlap([(s.start_ts, s.end_ts) for _, s in member_spans])
            )
            if r.started:
                for idx, s in member_spans:
                    if s.role == "tv":
                        r.human_ids.add(span_device[idx])

        rooms.extend(group_rooms)

    rooms.sort(key=lambda r: r.closed_at, reverse=True)

    # 2. Build daily & monthly rollups.
    def new_bucket() -> dict[str, Any]:
        return {
            "activeUsers": set(),
            "activeUsersByGame": {g: set() for g in GAMES},
            "roomsCreated": 0,
            "roomsCreatedByGame": {g: 0 for g in GAMES},
            "roomsStarted": 0,
            "roomsStartedByGame": {g: 0 for g in GAMES},
            "peakConcurrentRooms": 0,
            "peakConcurrentPlayers": 0,
        }

    daily: dict[str, dict[str, Any]] = defaultdict(new_bucket)
    monthly: dict[str, dict[str, Any]] = defaultdict(new_bucket)

    # Active users: every `/play` span counts on its start PT day/month; `/tv` host
    # counts when the session actually started (`r.started` populates `r.human_ids`).
    for idx, s in enumerate(spans):
        if s.role == "play":
            uid = span_device[idx]
            for store, key in ((daily, day_key(s.start_ts)), (monthly, month_key(s.start_ts))):
                b = store[key]
                b["activeUsers"].add(uid)
                b["activeUsersByGame"][s.game].add(uid)

    for r in rooms:
        dk, mk = day_key(r.created_at), month_key(r.created_at)
        for store, key in ((daily, dk), (monthly, mk)):
            b = store[key]
            b["roomsCreated"] += 1
            b["roomsCreatedByGame"][r.game] += 1
            if r.started:
                b["roomsStarted"] += 1
                b["roomsStartedByGame"][r.game] += 1
                for uid in r.human_ids:
                    b["activeUsers"].add(uid)
                    b["activeUsersByGame"][r.game].add(uid)

    # Reconcile with exact legacy stdout `room created` logs if higher on any day.
    for (dk, game), exact_cnt in legacy_counts.items():
        cur_cnt = daily[dk]["roomsCreatedByGame"][game]
        if exact_cnt > cur_cnt:
            diff = exact_cnt - cur_cnt
            daily[dk]["roomsCreatedByGame"][game] += diff
            daily[dk]["roomsCreated"] += diff
            mk = dk[:7]
            monthly[mk]["roomsCreatedByGame"][game] += diff
            monthly[mk]["roomsCreated"] += diff

    # Peak concurrent rooms & players per day/month.
    rooms_by_day: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for r in rooms:
        rooms_by_day[day_key(r.created_at)].append((r.created_at, r.closed_at))
    plays_by_day: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for s in spans:
        if s.role == "play":
            plays_by_day[day_key(s.start_ts)].append((s.start_ts, s.end_ts))

    for dk, b in daily.items():
        peak_r = max(_peak_overlap(rooms_by_day.get(dk, [])), 1 if b["roomsCreated"] > 0 else 0)
        peak_p = max(_peak_overlap(plays_by_day.get(dk, [])), 1 if b["activeUsers"] else 0)
        b["peakConcurrentRooms"] = peak_r
        b["peakConcurrentPlayers"] = peak_p
        mk = dk[:7]
        monthly[mk]["peakConcurrentRooms"] = max(monthly[mk]["peakConcurrentRooms"], peak_r)
        monthly[mk]["peakConcurrentPlayers"] = max(monthly[mk]["peakConcurrentPlayers"], peak_p)

    room_docs = [(r.doc_id(), r.to_doc(len(r.human_ids))) for r in rooms]
    return {"daily": dict(daily), "monthly": dict(monthly), "rooms": room_docs}


# ---- gcloud CLI + Firestore v1 REST helpers (stdlib only) -------------------


def run_gcloud_json(args: list[str]) -> Any:
    cmd = ["gcloud", *args, "--format=json"]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"Command failed ({' '.join(cmd)}):\n{proc.stderr.strip()}")
    out = proc.stdout.strip()
    return json.loads(out) if out else []


def get_gcloud_access_token() -> str:
    proc = subprocess.run(
        ["gcloud", "auth", "print-access-token"],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0 or not proc.stdout.strip():
        raise RuntimeError(
            "Could not get access token from `gcloud auth print-access-token`. "
            "Run `gcloud auth login` first."
        )
    return proc.stdout.strip()


def detect_live_telemetry_cutoff(project: str, service: str, days: int) -> float | None:
    """Finds the earliest timestamp emitted by the new structured telemetry deploy."""
    flt = (
        f'resource.type="cloud_run_revision" '
        f'AND resource.labels.service_name="{service}" '
        f'AND jsonPayload.event:("room_created" OR "game_started" OR "room_closed")'
    )
    entries = run_gcloud_json(
        [
            "logging",
            "read",
            flt,
            f"--project={project}",
            f"--freshness={days}d",
            "--order=asc",
            "--limit=1",
        ]
    )
    if entries:
        return parse_rfc3339(entries[0].get("timestamp"))
    return None


def _to_fs_value(val: Any) -> dict[str, Any]:
    if val is None:
        return {"nullValue": None}
    if isinstance(val, bool):
        return {"booleanValue": val}
    if isinstance(val, int):
        return {"integerValue": str(val)}
    if isinstance(val, float):
        return {"doubleValue": val}
    if isinstance(val, str):
        return {"stringValue": val}
    if isinstance(val, (list, tuple)):
        return {"arrayValue": {"values": [_to_fs_value(x) for x in val]}}
    if isinstance(val, dict):
        return {"mapValue": {"fields": {k: _to_fs_value(v) for k, v in val.items()}}}
    raise TypeError(f"Unsupported Firestore value type: {type(val)}")


def _from_fs_value(raw: dict[str, Any]) -> Any:
    if "nullValue" in raw:
        return None
    if "booleanValue" in raw:
        return bool(raw["booleanValue"])
    if "integerValue" in raw:
        return int(raw["integerValue"])
    if "doubleValue" in raw:
        return float(raw["doubleValue"])
    if "stringValue" in raw:
        return str(raw["stringValue"])
    if "arrayValue" in raw:
        return [_from_fs_value(v) for v in (raw["arrayValue"].get("values") or [])]
    if "mapValue" in raw:
        return {k: _from_fs_value(v) for k, v in (raw["mapValue"].get("fields") or {}).items()}
    return None


def _fs_get_doc(base_url: str, token: str, rel_path: str) -> dict[str, Any] | None:
    req = urllib.request.Request(
        f"{base_url}/documents/{rel_path}",
        headers={"Authorization": f"Bearer {token}"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            fields = payload.get("fields") or {}
            return {k: _from_fs_value(v) for k, v in fields.items()}
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Firestore GET {rel_path} failed ({e.code}): {body}") from e


def _fs_commit_writes(base_url: str, token: str, writes: list[dict[str, Any]]) -> None:
    for i in range(0, len(writes), 200):
        chunk = writes[i : i + 200]
        data = json.dumps({"writes": chunk}).encode("utf-8")
        req = urllib.request.Request(
            f"{base_url}/documents:commit",
            data=data,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                resp.read()
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Firestore commit failed ({e.code}): {body}") from e


def merge_bucket_with_existing(
    key_field: str,
    key_val: str,
    bf_bucket: dict[str, Any],
    existing: dict[str, Any] | None,
    now_ts: float,
) -> dict[str, Any]:
    """Idempotently combines backfilled counts with any live telemetry on the same doc."""
    ex = existing or {}
    prev_bf = ex.get("backfill") if isinstance(ex.get("backfill"), dict) else {}

    users = sorted(set(ex.get("activeUsers") or ()) | set(bf_bucket["activeUsers"]))
    ex_users_by = ex.get("activeUsersByGame") or {}
    users_by_game = {
        g: sorted(set(ex_users_by.get(g) or ()) | set(bf_bucket["activeUsersByGame"][g]))
        for g in GAMES
    }

    live_created = max(0, int(ex.get("roomsCreated") or 0) - int(prev_bf.get("roomsCreated") or 0))
    live_started = max(0, int(ex.get("roomsStarted") or 0) - int(prev_bf.get("roomsStarted") or 0))

    ex_created_by = ex.get("roomsCreatedByGame") or {}
    prev_bf_created_by = prev_bf.get("roomsCreatedByGame") or {}
    created_by = {
        g: max(0, int(ex_created_by.get(g) or 0) - int(prev_bf_created_by.get(g) or 0))
        + int(bf_bucket["roomsCreatedByGame"][g])
        for g in GAMES
    }

    ex_started_by = ex.get("roomsStartedByGame") or {}
    prev_bf_started_by = prev_bf.get("roomsStartedByGame") or {}
    started_by = {
        g: max(0, int(ex_started_by.get(g) or 0) - int(prev_bf_started_by.get(g) or 0))
        + int(bf_bucket["roomsStartedByGame"][g])
        for g in GAMES
    }

    ex_rounds_by = ex.get("roundsPlayedByGame") or {}
    rounds_by = {g: int(ex_rounds_by.get(g) or 0) for g in GAMES}

    bf_meta = {
        "roomsCreated": int(bf_bucket["roomsCreated"]),
        "roomsCreatedByGame": {g: int(bf_bucket["roomsCreatedByGame"][g]) for g in GAMES},
        "roomsStarted": int(bf_bucket["roomsStarted"]),
        "roomsStartedByGame": {g: int(bf_bucket["roomsStartedByGame"][g]) for g in GAMES},
    }

    return {
        key_field: key_val,
        "activeUsers": users,
        "activeUsersByGame": users_by_game,
        "roomsCreated": live_created + int(bf_bucket["roomsCreated"]),
        "roomsCreatedByGame": created_by,
        "roomsStarted": live_started + int(bf_bucket["roomsStarted"]),
        "roomsStartedByGame": started_by,
        "roundsPlayed": int(ex.get("roundsPlayed") or 0),
        "roundsPlayedByGame": rounds_by,
        "peakConcurrentRooms": max(
            int(ex.get("peakConcurrentRooms") or 0), int(bf_bucket["peakConcurrentRooms"])
        ),
        "peakConcurrentPlayers": max(
            int(ex.get("peakConcurrentPlayers") or 0), int(bf_bucket["peakConcurrentPlayers"])
        ),
        "updatedAt": round(now_ts, 3),
        "backfill": bf_meta,
    }


def apply_to_firestore(
    *,
    project: str,
    database: str,
    result: dict[str, Any],
) -> int:
    token = get_gcloud_access_token()
    db_root = f"projects/{project}/databases/{database}"
    base_url = f"https://firestore.googleapis.com/v1/{db_root}"
    now_ts = datetime.now(tz=timezone.utc).timestamp()

    writes: list[dict[str, Any]] = []

    for d_key, bf_bucket in sorted(result["daily"].items()):
        existing = _fs_get_doc(base_url, token, f"analytics_daily/{d_key}")
        merged = merge_bucket_with_existing("date", d_key, bf_bucket, existing, now_ts)
        writes.append(
            {
                "update": {
                    "name": f"{db_root}/documents/analytics_daily/{d_key}",
                    "fields": {k: _to_fs_value(v) for k, v in merged.items()},
                }
            }
        )

    for m_key, bf_bucket in sorted(result["monthly"].items()):
        existing = _fs_get_doc(base_url, token, f"analytics_monthly/{m_key}")
        merged = merge_bucket_with_existing("month", m_key, bf_bucket, existing, now_ts)
        writes.append(
            {
                "update": {
                    "name": f"{db_root}/documents/analytics_monthly/{m_key}",
                    "fields": {k: _to_fs_value(v) for k, v in merged.items()},
                }
            }
        )

    for doc_id, room_doc in result["rooms"]:
        writes.append(
            {
                "update": {
                    "name": f"{db_root}/documents/analytics_rooms/{doc_id}",
                    "fields": {k: _to_fs_value(v) for k, v in room_doc.items()},
                }
            }
        )

    if writes:
        _fs_commit_writes(base_url, token, writes)
    return len(writes)


def print_summary(result: dict[str, Any], *, span_count: int, cutoff_ts: float | None) -> None:
    if cutoff_ts is not None:
        cutoff_str = datetime.fromtimestamp(cutoff_ts, tz=PT).strftime("%Y-%m-%d %H:%M:%S %Z")
        print(f"Live telemetry cutoff detected: {cutoff_str} (newer events left to live tracker)")
    else:
        print("Live telemetry cutoff: none found yet (processing all logs in window)")
    print(f"WebSocket upgrade spans parsed: {span_count}\n")

    if not result["daily"]:
        print("No historical /ws/ activity found in the selected window.")
        return

    print("=== Daily Rollups (America/Los_Angeles) ===")
    print(f"{'DATE':<12} {'DAU':>5} {'STARTED':>8} {'CREATED':>8} {'PEAK_P':>7}  BY GAME (DAU)")
    for dk in sorted(result["daily"].keys()):
        b = result["daily"][dk]
        by_g = ", ".join(
            f"{g}:{len(b['activeUsersByGame'][g])}"
            for g in GAMES
            if b["activeUsersByGame"][g]
        )
        print(
            f"{dk:<12} {len(b['activeUsers']):>5} {b['roomsStarted']:>8} "
            f"{b['roomsCreated']:>8} {b['peakConcurrentPlayers']:>7}  {by_g or '-'}"
        )

    print("\n=== Monthly Rollups (America/Los_Angeles) ===")
    print(f"{'MONTH':<10} {'MAU':>5} {'STARTED':>8} {'CREATED':>8}")
    for mk in sorted(result["monthly"].keys()):
        b = result["monthly"][mk]
        print(
            f"{mk:<10} {len(b['activeUsers']):>5} {b['roomsStarted']:>8} {b['roomsCreated']:>8}"
        )

    print(f"\n=== Reconstructed Sessions ({len(result['rooms'])} total, showing up to 15) ===")
    print(f"{'CLOSED (PT)':<22} {'GAME':<13} {'STATE':<8} {'HUMANS':>6} {'PEAK':>5} {'DURATION':>9}")
    for _, doc in result["rooms"][:15]:
        closed_pt = datetime.fromtimestamp(doc["closedAt"], tz=PT).strftime("%Y-%m-%d %H:%M")
        mins, secs = divmod(doc["durationSec"], 60)
        dur_str = f"{mins}m {secs:02d}s"
        state_str = "Played" if doc["started"] else "Lobby"
        print(
            f"{closed_pt:<22} {doc['game']:<13} {state_str:<8} "
            f"{doc['humanPlayers']:>6} {doc['peakConcurrent']:>5} {dur_str:>9}"
        )


def main() -> int:
    ap = argparse.ArgumentParser(description="Backfill /admin analytics from Cloud Run logs.")
    ap.add_argument("--project", default="nojo-client", help="GCP project ID (default: nojo-client)")
    ap.add_argument("--service", default="spirit-board", help="Cloud Run service (default: spirit-board)")
    ap.add_argument("--database", default="spirit-board", help="Firestore database (default: spirit-board)")
    ap.add_argument("--days", type=int, default=30, help="Days of Cloud Logging history to read (default: 30)")
    ap.add_argument("--limit", type=int, default=5000, help="Max log entries per query (default: 5000)")
    ap.add_argument("--apply", action="store_true", help="Write reconstructed analytics into Firestore")
    args = ap.parse_args()

    print(
        f"Querying Cloud Logging (project={args.project}, service={args.service}, "
        f"freshness={args.days}d)..."
    )
    cutoff_ts = detect_live_telemetry_cutoff(args.project, args.service, args.days)

    ws_filter = (
        f'resource.type="cloud_run_revision" '
        f'AND resource.labels.service_name="{args.service}" '
        f'AND logName:"run.googleapis.com%2Frequests" '
        f'AND httpRequest.requestUrl:"/ws/"'
    )
    ws_entries = run_gcloud_json(
        [
            "logging",
            "read",
            ws_filter,
            f"--project={args.project}",
            f"--freshness={args.days}d",
            f"--limit={args.limit}",
        ]
    )

    stdout_filter = (
        f'resource.type="cloud_run_revision" '
        f'AND resource.labels.service_name="{args.service}" '
        f'AND textPayload:"room created"'
    )
    stdout_entries = run_gcloud_json(
        [
            "logging",
            "read",
            stdout_filter,
            f"--project={args.project}",
            f"--freshness={args.days}d",
            f"--limit={args.limit}",
        ]
    )

    spans = parse_ws_request_entries(ws_entries, cutoff_ts=cutoff_ts)
    legacy_counts = parse_legacy_stdout_room_counts(stdout_entries, cutoff_ts=cutoff_ts)
    result = reconstruct_analytics(spans, legacy_counts)

    print_summary(result, span_count=len(spans), cutoff_ts=cutoff_ts)

    if not args.apply:
        print(
            "\nDry run complete (nothing written to Firestore). "
            "Re-run with `--apply` to save these metrics to `/admin`."
        )
        return 0

    if not result["daily"] and not result["rooms"]:
        print("\nNothing to write.")
        return 0

    written = apply_to_firestore(
        project=args.project,
        database=args.database,
        result=result,
    )
    print(
        f"\nBackfill complete: updated {written} Firestore documents in database "
        f"'{args.database}'. Refresh https://willynojopranoto.com/admin to view!"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
