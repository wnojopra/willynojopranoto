---
name: party-game-backend
description: >-
  Backend architecture, state-machine, WebSocket protocol, and security conventions
  for spooktacular multiplayer games. Use this skill when writing or modifying
  backend Python code in backend/app/<game>/ (rules.py, rooms.py, api.py) or shared
  WebSocket/cookie utilities.
---

# Party Game Backend Conventions

All games in `backend/app/` run inside a single-instance FastAPI service (`--max-instances 1`) where active rooms live in memory. Follow these conventions to keep game state deterministic, testable without sockets, and resistant to abuse.

Reference implementations:
- Avalon: [rules.py](../../../backend/app/avalon/rules.py), [rooms.py](../../../backend/app/avalon/rooms.py), [api.py](../../../backend/app/avalon/api.py)
- Psychological: [rules.py](../../../backend/app/psych/rules.py), [rooms.py](../../../backend/app/psych/rooms.py), [api.py](../../../backend/app/psych/api.py)
- Shared utilities: [ws.py](../../../backend/app/shared/ws.py), [cookies.py](../../../backend/app/shared/cookies.py), [origins.py](../../../backend/app/shared/origins.py), [rooms_util.py](../../../backend/app/shared/rooms_util.py)

---

## 1. Pure Rules vs. Synchronous Room State Machine

- **`rules.py` (Pure & Stateless)**:
  - Keep all scoring math, role/alignment tables, deck definitions, and win-condition checks as pure functions in `rules.py`.
  - Do not import FastAPI, `asyncio`, clocks, or WebSockets in `rules.py`.
- **`rooms.py` (Injectable RNG & Clock)**:
  - `<Game>Room.__init__` must accept `rng: random.Random | None = None` (defaulting to `random.Random(secrets.randbits(64))`) and `clock: Callable[[], float] = time.monotonic`.
  - All state transitions (`start()`, `advance()`, `mark()`, `vote()`, `skip()`, `play_again()`, `tick_bots()`) must be **synchronous** methods on `<Game>Room` that return `bool` (whether state changed) or mutate state deterministically using `self._rng` and `self._clock()`.
  - Async methods on `<Game>Room` should be limited to I/O broadcasting (`broadcast_state()`, `broadcast_avatars()`, `send_private()`).

---

## 2. Room Codes, Names, and Player Identity

- **Room Codes & Names**:
  - Always use `CODE_ALPHABET` (`BCDFGHJKLMNPQRSTVWXZ` — 20 vowelless consonants so codes never spell rude words), `CODE_LENGTH = 4`, `normalize_code()`, and `normalize_name()` from [rooms_util.py](../../../backend/app/shared/rooms_util.py).
  - Player names are NFKC-normalized and restricted to 1–14 characters (`[\w .'\-]{1,14}`). Raise `JoinError` with a friendly player-facing message when invalid.
- **Device Cookie Rejoin & Host Verification**:
  - Extract the caller's device token via `device_of(ws.cookies)` from [cookies.py](../../../backend/app/shared/cookies.py) (`__Host-sb_device`, 256-bit `HttpOnly` cookie).
  - **Host resume**: Store `room.host_device = device` on room creation. On `create` with a `resume` code, only return the existing room if `old.is_host(device)` passes (`hmac.compare_digest(device, self.host_device)`).
  - **Player seat reclaim**: In `add_player(raw_name, device=...)`, match existing players case-insensitively (`p.name.casefold() == name.casefold()`):
    - If `p.is_bot`: raise `JoinError("That name is taken.")`.
    - If `p.device is not None`: allow rejoin if `device is not None and hmac.compare_digest(device, p.device)`; otherwise raise `JoinError("That name is taken. On a new phone? Add a letter to your name.")`.
    - If `p.device is None` and `not p.connected`: allow claiming the disconnected seat.
  - **Single active socket per player**: When a player rejoins from a new tab/refresh, replace `room.player_conns[player.id] = ws` and notify + close the stale socket (`"You rejoined from another tab."`).
  - **Disconnect cleanup**: In the `finally:` block of `play_socket`, only mark the player disconnected (`room.mark_disconnected(player.id)`) if `room.player_conns.get(player.id) is ws` (so a closing stale socket doesn't clobber a newer tab's connection).

---

## 3. Public State vs. Secret State Broadcasts

- **Never leak secrets in `state_dict()`**:
  - `broadcast_state()` sends `self.state_dict()` to all `tv_conns` and `player_conns`.
  - Hidden information (e.g. the main player's secret square in Psychological before `reveal`, or secret roles/sightings/unrevealed votes in Avalon before `gameover`) must **never** appear in `state_dict()` while hidden. Instead, expose only public indicators (such as `votedIds` or `questSubmittedIds`).
- **Private channel (`send_private`)**:
  - Send player-specific secrets (e.g. `{"type": "secret", ...}` or `{"type": "role_secret", ...}`) only to `self.player_conns.get(pid)`.
  - Always re-send a player's private message immediately when they join/rejoin so refreshing mid-game restores their secret view.
- **Separate Avatar Broadcasts (`broadcast_avatars`)**:
  - Base64 JPEG selfies (`avatars: dict[str, str]`) are up to 18 KB each. Keep them out of `state_dict()` so routine state broadcasts stay small (`< 2 KB`).
  - Send `room.avatars_msg()` (`{"type": "avatars", "avatars": self.avatars}`) once on socket connect and via `room.broadcast_avatars()` only when a selfie is added, updated, or removed.

---

## 4. Selfie Validation & Rate Limiting

- **JPEG Byte Validation (`validate_avatar`)**:
  - Must start with `"data:image/jpeg;base64,"`.
  - Base64-decode with `validate=True` and check `len(raw) <= MAX_AVATAR_BYTES` (`18_000`).
  - Verify real JPEG magic bytes: `raw.startswith(b"\xff\xd8\xff")` (SOI) and `raw.rstrip(b"\x00").endswith(b"\xff\xd9")` (EOI).
  - Enforce a per-player cooldown (`AVATAR_COOLDOWN_SECONDS = 2.0`) using `self._clock()`.

---

## 5. WebSocket Hardening (`api.py`)

Every WebSocket endpoint (`/ws/<game>/tv` and `/ws/<game>/play`) must follow this structure:

1. **Origin check before accept**:
   ```python
   if not _origin_allowed(ws):
       await ws.close(code=1008)
       return
   await ws.accept()
   ```
2. **Per-connection `RateLimiter` and message size caps**:
   - Turn-based games: `RATE_PER_SEC = 10.0`, `RATE_BURST = 20.0`, `MAX_DROPPED_BEFORE_CLOSE = 200`, `MAX_MESSAGE_BYTES = 256` or `512`, `large_types={"selfie": 26_000}`.
   - Real-time physics games (e.g. Spirit Board): higher rate limit (`40/s`, burst `60`).
3. **Handshake timeout**:
   - Wrap the first `recv_message` in `await asyncio.wait_for(recv_message(ws, limiter), JOIN_TIMEOUT_SECONDS)` (`30s`), and require `msg["type"] == "create"` (TV) or `"join"` (phone), closing with `1008` otherwise.
4. **Room limits & idle eviction**:
   - Cap concurrent rooms per game at `MAX_ROOMS = 20` (raising `RoomLimitError` -> send error `"Too many games right now. Try again later."`).
   - Evict rooms idle for `ROOM_IDLE_SECONDS = 10 * 60` (`600s`). Call `room.touch()` on valid host/player actions.
5. **Bots**:
   - Provide `add_bot()` and `remove_bot()` in the lobby using a themed `BOT_NAMES` list (10 distinct names) and the standard 10-color `COLORS` palette.
   - Drive bot actions from the room manager's background loop after `BOT_DELAY_SECONDS` (`~1.2s`) so bot turns feel natural and paced on the TV.
