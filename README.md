# 👻 Spirit Board

A Jackbox-style Halloween party game. The TV shows a Ouija board, and everyone
drags the planchette together from their phones.

Design doc: [`docs/design.md`](docs/design.md)

## Status: pull prototype

This milestone covers the core feel:

- TV creates a room and shows a 4-letter code
- Phones join with the code and a name (up to 10 players)
- **Bots** can be added from the TV for solo testing
- Each round: question → 20s pull → planchette locks in after resting on an
  answer for 2s (or times out) → reveal
- "Who in this room" boards (every player is a spot) and Yes/No boards

Not yet: bets, payouts, Medium rounds, Relics, curses, audio, deploy.

## Layout

```
backend/    Python 3.12+ / FastAPI. Authoritative game loop at 30Hz.
  app/physics.py   planchette physics + lock-in (tuning knobs at the top)
  app/rooms.py     room state machine, bots, broadcasting
  app/main.py      WebSocket endpoints (/ws/tv, /ws/play), security headers
frontend/   React + TypeScript + Vite
  src/tv/          TV screens (lobby, board, reveal)
  src/play/        phone screens (join, touchpad, minimap)
```

## Run it locally

Prereqs: Python 3.12+, Node 22+.

```bash
# Backend
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# Frontend (second terminal)
cd frontend
npm install
npm run dev
```

Open:

- TV: <http://127.0.0.1:5173/tv>
- Phones: <http://127.0.0.1:5173/play> (open a few tabs to fake several players;
  use your browser's device emulation for touch)

Or build the frontend once (`npm run build`) and use only the backend at
<http://127.0.0.1:8000/tv>. It serves `frontend/dist` automatically.

### Testing with real phones

The dev servers only listen on `127.0.0.1`. To play with phones, either deploy
to Cloud Run (next milestone), or temporarily run the backend on your LAN IP and
add that origin, e.g.:

```bash
SB_ALLOWED_ORIGINS=http://192.168.1.20:8000 \
  .venv/bin/uvicorn app.main:app --host 192.168.1.20 --port 8000
```

## Tests

```bash
cd backend && .venv/bin/python -m pytest -q
cd frontend && npm run typecheck
```

## Security notes

- WebSockets reject cross-site origins (CSWSH protection). Allowed origins come
  from `SB_ALLOWED_ORIGINS`, plus same-origin in production.
- All client input is validated server-side: names (1–14 chars, allow-list),
  room codes, pull vectors (finite and clamped to length 1), message size (512B),
  and per-connection rate limits.
- No auth tokens are stored in the browser. Host rights are tied to the TV's
  live WebSocket connection.
- Strict CSP, `X-Frame-Options: DENY`, `nosniff`, and a locked-down
  `Permissions-Policy` are applied to everything the backend serves.
- TODO(security): if the TV refreshes, the host can't reclaim the room. Add a
  server-issued HttpOnly host cookie if that's a problem in playtesting.
