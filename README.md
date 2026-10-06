# 👻 Spirit Board

A Jackbox-style Halloween party game. The TV shows a Ouija board, and everyone
drags the planchette together from their phones.

Design doc: [`docs/design.md`](docs/design.md)

## Status: playable game with all 13 Relics and the scavenger hunt

- TV creates a room with a 4-letter code and a **join QR** (scanning it pre-fills the code)
- Phones join with the code and a name (up to 10 players)
- **Bots** can be added from the TV for solo testing
- **Game length**: Short (6), Standard (9), or Long (12) rounds, then the **Final Séance** (3× pot)
- **Spirit Bets** rounds: secret bet → 20s pull → the planchette locks in →
  the pot (50 × players) is split among correct bettors, with rollover if nobody wins
- **Medium** rounds: one player answers privately, the others guess (+100) and
  pull; +100 to everyone if the board agrees; then "explain yourself"
- **Haunted** marks when the board lands on you, plus a **curse card** the TV reads out
  (deck: `backend/app/curses.py`; 🍺 cards always offer a non-drinking option).
  Most marks gets the Final Curse. The host can turn curses off in the lobby
- **Relics** (`backend/app/relics.py`): one-shot powers used from a tray on the phone.
  One per round (unlimited in the Final Séance). The TV announces who used what on whom,
  except Ghost Whisper, which is anonymous.
  - Pull: 🙃 Mirror Curse, 🧊 Hex of Stillness, 🧂 Salt Circle, 🧲 Cursed Magnet,
    💪 Iron Grip (3× pull for 8s), 🌀 Ouija Shuffle (answers trade places halfway through),
    ⏪ Séance Rewind (planchette back to 5s ago), 🃏 Tarot Card (secretly change your bet)
  - Betting: 🔮 Crystal Ball (see live bets / cross out 2 wrong answers), ✖️ Double Down,
    🩸 Blood Pact (you also win whatever your partner wins)
  - Any time: 👻 Ghost Whisper, 😱 Jump Scare
  - **Starter Relics** (lobby toggle, on by default): each human gets one random Relic per game.
    An unused starter expires when the next game starts (other Relics carry over)
  - **Catch-up Relics** (lobby toggle, on by default): after rounds 3 and 6, whoever is in
    last place (ties included) gets a random Common Relic. Nobody gets one if everyone is
    tied. Unused ones expire when the next game starts, like starters
  - `/tv?dev=1` shows a "Give everyone all Relics" button for playtesting
- **Results**: standings + awards (Grand Medium, Most Haunted, Lone Wolf, …), play again
- **Scavenger hunt** (before the game): QR stickers hidden around the house
  - `/admin` (host passcode): make batches of codes (a set Relic, or random
    common / rare / cursed / any), label where each is hidden, and see who found what
  - `/admin/print`: printable sticker sheet of every unclaimed code
  - `/claim/<code>`: the first scan asks for a name, then reveals the Relic. One
    claim per code; later scanners see "Someone got here first 👻"
  - `/relics`: this phone's collection. Hunt Relics come along when the phone
    joins a game (no starter needed) and are spent for good when used
  - Codes and collections live in Firestore (database `spirit-board`). Locally
    they're in memory unless `SB_FIRESTORE_DATABASE` is set
- **Custom questions** (`/admin`, below the codes): add your own Spirit Bets or Medium
  questions (who / yes-no / pick 2–5 options; `{player}` fills in a random name).
  "Always include" questions are spread through every game; the rest are shuffled in
  with the built-in deck. They're loaded when a game starts, so edits apply next game

Not yet: audio.

## Layout

```
backend/    Python 3.12+ / FastAPI. Authoritative game loop at 30Hz.
  app/physics.py   planchette physics + lock-in (tuning knobs at the top)
  app/rooms.py     room state machine, bots, Relic effects, broadcasting
  app/game.py      game plan (lengths, Medium slots) + end-of-game awards
  app/questions.py question decks (Spirit Bets, Medium, Final)
  app/curses.py    curse cards + Final Curses (edit these!)
  app/relics.py    Relic catalog, starter odds, tuning (Hex length, magnet strength)
  app/hunt.py      hunt codes + device collections (Firestore / in-memory stores)
  app/hunt_api.py  /api routes: claim, collection, admin (cookies, CSRF, rate limits)
  app/main.py      WebSocket endpoints (/ws/tv, /ws/play), security headers
frontend/   React + TypeScript + Vite
  src/tv/          TV screens (lobby, board, reveal, Relic cards)
  src/play/        phone screens (join, touchpad, minimap, Relic tray)
  src/hunt/        claim page, /relics, admin console, sticker sheet
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

It runs as the `spirit-board@nojo-client` service account, which can only use
the `spirit-board` Firestore database and read the admin passcode secret.

**Admin passcode** (for `/admin`) lives in Secret Manager:

```bash
# read it
gcloud secrets versions access latest --secret spirit-board-admin-passcode --project nojo-client
# change it (then redeploy, or wait for a new instance)
printf '%s' 'new-passcode' | gcloud secrets versions add spirit-board-admin-passcode --data-file=- --project nojo-client
```

Locally, set `SB_ADMIN_PASSCODE=...` before starting uvicorn. Without it, admin is off.

Live: <https://spirit-board-270279587994.us-west1.run.app/tv>

## Tests

```bash
cd backend && .venv/bin/python -m pytest -q
cd frontend && npm run typecheck
```

## Security notes

- WebSockets and hunt POSTs reject cross-site origins. Allowed origins come
  from `SB_ALLOWED_ORIGINS`, plus same-origin in production.
- All client input is validated server-side: names (1–14 chars, allow-list),
  room codes, hunt codes, pull vectors (finite and clamped to length 1),
  message size (512B), and per-connection rate limits.
- No auth tokens in localStorage. Host rights in a game are tied to the TV's
  live WebSocket connection.
- Hunt: each browser gets a random device id in an HttpOnly `__Host-` cookie
  (whoever holds the phone owns its Relics). POSTs need a double-submit CSRF
  token plus a same-origin `Origin`. Claims and logins are rate limited.
  Claim codes are 96-bit random tokens. The admin list never shows device ids.
- Admin: passcode from Secret Manager (constant-time compare, never logged),
  then a 12-hour HttpOnly, SameSite=Strict session cookie.
- Strict CSP, `X-Frame-Options: DENY`, `nosniff`, and a locked-down
  `Permissions-Policy` are applied to everything the backend serves.
- TODO(security): if the TV refreshes, the host can't reclaim the room. Add a
  server-issued HttpOnly host cookie if that's a problem in playtesting.
- Known edge cases: one phone in two rooms at once could use a hunt Relic twice;
  Relics found mid-game show up after the phone rejoins.
