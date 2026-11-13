---
name: party-game-testing
description: >-
  Testing and verification conventions for spooktacular multiplayer games. Use this
  skill when writing or updating unit, state-machine, or WebSocket tests in
  backend/tests/<game>/ or running backend pytest and frontend TypeScript/build checks.
---

# Party Game Testing & Verification Conventions

Every game in `backend/app/<game>/` has a matching three-tier test suite under `backend/tests/<game>/`, paired with frontend TypeScript type-checking and Vite build verification.

Reference implementations:
- Avalon: [test_avalon_rules.py](../../../backend/tests/avalon/test_avalon_rules.py), [test_avalon_rooms.py](../../../backend/tests/avalon/test_avalon_rooms.py), [test_avalon_api.py](../../../backend/tests/avalon/test_avalon_api.py)
- Psychological: [test_psych_rules.py](../../../backend/tests/psych/test_psych_rules.py), [test_psych_rooms.py](../../../backend/tests/psych/test_psych_rooms.py), [test_psych_api.py](../../../backend/tests/psych/test_psych_api.py)
- Spirit Board: [backend/tests/spiritboard/](../../../backend/tests/spiritboard)

---

## 1. Tier 1: Pure Rules & Content Invariants (`test_<game>_rules.py`)

Test `app.<game>.rules` (and any card/deck modules) directly without creating rooms or sockets:
- **Scoring & Outcome Math**: Use `@pytest.mark.parametrize` to cover exact matches, adjacency/edge cases, ties, and invalid input types (e.g. `bool` passed where `int` is expected — note `isinstance(True, int)` is `True` in Python, so guard with `not isinstance(x, bool)`).
- **Player Count Tables & Role/Turn Order**: Verify all supported player counts (`MIN_PLAYERS..MAX_PLAYERS`), wrap-around seating order, and role/sighting matrices.
- **Deck & Content Invariants**:
  - Assert expected deck sizes, no duplicate strings (`casefold()`) within or across decks, and reasonable character-length bounds so text fits on TV and phone cards.

---

## 2. Tier 2: Synchronous Room State Machine (`test_<game>_rooms.py`)

Test `<Game>Room` synchronously by injecting a deterministic `random.Random(seed)` and a controllable `Clock` helper:

```python
class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def make_room(n: int = 5) -> tuple[<Game>Room, list[str], Clock]:
    clock = Clock()
    room = <Game>Room("BCDF", rng=random.Random(7), clock=clock)
    ids = [room.add_player(f"P{i}").id for i in range(n)]
    return room, ids, clock
```

Required test cases for every game's `test_<game>_rooms.py`:
1. **Lobby & Minimum Players**: Cannot `start()` below `MIN_PLAYERS`; seat reordering (`move_seat`), option toggles, and bot addition/removal work only in `lobby`.
2. **Secret Isolation (`state_dict` vs. `private_msg`)**: Assert that `room.state_dict()` **never** contains secret roles, sightings, or unrevealed coordinates/cards during active play, and only reveals them in the designated reveal/gameover phase.
3. **Full Turn & Win Loops**: Drive a complete game from `lobby` to `gameover` for each win condition.
4. **Device Rejoin & Seat Protection**:
   - Rejoining with the matching `device` token reclaims the seat (`connected = True`).
   - Attempting to join with an active player's name and a different `device` raises `JoinError`.
   - Host verification (`room.is_host(device)`) succeeds only for the creator's device token.
5. **Bot Progression (`tick_bots`)**: Advance `clock.t += rooms.BOT_DELAY_SECONDS + 0.1` and assert `room.tick_bots()` advances bot decisions through all phases.
6. **Selfie Validation (`validate_avatar` / `set_avatar`)**:
   - Reject non-JPEG prefixes, oversized payloads (`> 18 KB`), and payloads missing JPEG SOI (`\xff\xd8\xff`) or EOI (`\xff\xd9`) markers.
   - Enforce `AVATAR_COOLDOWN_SECONDS` using the fake `Clock`.

---

## 3. Tier 3: WebSocket & HTTP Security Suite (`test_<game>_api.py`)

Use FastAPI's `TestClient` with `ORIGIN = {"origin": "http://localhost:5173"}` and a `recv_until` helper:

```python
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
```

Required test cases for every game's `test_<game>_api.py`:
1. **Foreign Origin Rejection**: Connecting to `/ws/<game>/tv` or `/ws/<game>/play` with `headers={"origin": "https://evil.example"}` raises `WebSocketDisconnect` (closed with `1008`).
2. **End-to-End WebSocket Flow**: Connect a TV socket (`create` -> `created`), connect a player socket (`join` -> `joined`), add bots via TV, start the game, exchange public `state` and private secret messages, and transition phases.
3. **Cross-Game Room Code Isolation**: Create a room on `/ws/<game>/tv` and verify that joining `/ws/<other_game>/play` with that code returns `{"type": "error", "message": "No game with that code."}`.
4. **SPA Routes & Security Headers**: `GET /<game>` and `GET /<game>/play` return `200` with `Content-Security-Policy`, `X-Frame-Options: DENY`, and `X-Content-Type-Options: nosniff`.

---

## 4. Running the Verification Suite

Always run both backend tests and frontend typecheck/build after making changes:

```bash
# 1. Run full backend pytest suite
cd backend && .venv/bin/python -m pytest -q

# 2. Run frontend TypeScript check and production bundle build
cd frontend && npm run typecheck && npm run build
```
