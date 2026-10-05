# 👻 Spirit Board

A Jackbox-style Halloween party game. The TV shows a Ouija board, and everyone
drags the planchette together from their phones.

Design doc: [`docs/design.md`](docs/design.md)

## Status: playable game (no Relics yet)

- TV creates a room with a 4-letter code and a **join QR** (scanning it pre-fills the code)
- Phones join with the code and a name (up to 10 players)
- **Bots** can be added from the TV for solo testing
- **Game length**: Short (6), Standard (9), or Long (12) rounds, then the **Final Séance** (3× pot)
- **Spirit Bets** rounds: secret bet → 20s pull → the planchette locks in →
  the pot (50 × players) is split among correct bettors, with rollover if nobody wins
- **Medium** rounds: one player answers privately, the others guess (+100) and
  pull; +100 to everyone if the board agrees; then "explain yourself"
- **Haunted** marks when the board lands on you; most marks gets the Final Curse
- **Results**: standings + awards (Grand Medium, Most Haunted, Lone Wolf, …), play again

Not yet: curse cards, Relics, hunt QR claiming, audio.

## Layout

```
backend/    Python 3.12+ / FastAPI. Authoritative game loop at 30Hz.
  app/physics.py   planchette physics + lock-in (tuning knobs at the top)
  app/rooms.py     room state machine, bots, broadcasting
  app/game.py      game plan (lengths, Medium slots) + end-of-game awards
  app/questions.py question decks (Spirit Bets, Medium, Final)
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

Deploy to Cloud Run (below) and open the service URL. Phones join at
`<service-url>/play`.

## Deploy (Cloud Run)

```bash
./deploy.sh            # build with Cloud Build + deploy (scales to zero)
PARTY=1 ./deploy.sh    # party night: keep one instance warm all evening
```

Defaults: project `nojo-client`, region `us-west1`, service `spirit-board`
(override with `PROJECT`, `REGION`, `SERVICE`). The service runs as a single
instance (`--max-instances 1`) because game state is in memory, with session
affinity and a 60-minute request timeout for WebSockets.

Live: <https://spirit-board-270279587994.us-west1.run.app/tv>

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
