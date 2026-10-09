# 👻 Spirit Board

A Jackbox-style Halloween party game. The TV shows a Ouija board, and everyone
drags the planchette together from their phones.

Design doc: [`docs/design.md`](docs/design.md)

## Status: feature-complete for the party (all 13 Relics, hunt, custom questions, sound)

- TV creates a room with a 4-letter code and a **join QR** (scanning it pre-fills the code)
- Phones join with the code and a name (up to 10 players)
- **Bots** can be added from the TV for solo testing
- **Game length**: Short (6), Standard (9), or Long (12) rounds, then the **Final Séance** (3× pot,
  one of 12 rotating final questions plus any custom ones)
- **Teaching the game**: a 📜 **How to play** deck in the lobby (4 cards; the host steps through,
  the narrator reads them) and a 🎓 **Practice round** before round 1 (lobby toggle, on by
  default): a yes/no question with slower timers (30s bet, 30s pull), no points, no Relics, no
  curses, and a "Step 1/2/3" caption on the TV and phones
- **Restart game** (lobby and reveal screen, two clicks): everyone back to 0 in the lobby so
  late joiners can start level. Late joiners can also just join mid-game
- **Fairness**: names on "who" boards are shuffled every round, and if the pull times out with
  the planchette still near the middle, a random answer wins (not whoever sits at the top)
- **Big pull timer** on the TV (turns red for the last 5 seconds) and a **Relic recap** on the
  reveal listing every Relic used that round
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
- **Custom questions** (`/admin`, below the codes): add your own Spirit Bets, Medium or
  Final Séance questions (who / yes-no / pick 2–5 options; `{player}` fills in a random name).
  "Always include" questions are spread through every game (an always-include final is used
  for the next game's Final Séance); the rest are shuffled in with the built-in deck. They're loaded when a game starts, so edits apply next game

- **Sound** (TV only, `src/tv/audio.ts`): all synthesized in the browser, no audio files.
  Séance drone (louder for the Final Séance), creaking floorboards, a heartbeat that speeds
  up as the pull runs out, clock ticks at the end of betting, a stinger on lock-in, candy
  cascade on payout (a groan on rollover), gong for curses, Relic shimmer, a Jump Scare
  shriek, and an organ chord for the results
  - **Narrator** (🗣️): the TV reads each question, the answer, curse cards (with the
    non-drinking option), catch-up pity, ghost whispers, and the Final Curse, using the
    browser's built-in voices
  - 🔊 / 🗣️ buttons top-left (remembered per browser). Browsers need one click on the
    page before they'll play sound; the TV shows "Click anywhere for sound" until then
- **Reconnects**: a refreshed or dropped TV gets its room back (same game, same players).
  Phones rejoin on their own after a refresh, a locked screen, or a Wi-Fi blip

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
  src/tv/          TV screens (lobby, board, reveal, Relic cards), sound + narrator
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
- No auth tokens in localStorage. The host is the browser that created the room:
  a refreshed TV sends the (public) room code and gets the room back only if its
  HttpOnly device cookie matches the creator's. Anyone else gets a new room.
- Seats belong to the phone that took them (same device cookie), so nobody can
  rejoin under someone else's name and see their bet or spend their Relics.
  A phone that refreshes takes its seat back; the old tab is told and stops.
  Someone on a new phone has to pick a slightly different name.
- Hunt: each browser gets a random device id in an HttpOnly `__Host-` cookie
  (whoever holds the phone owns its Relics). POSTs need a double-submit CSRF
  token plus a same-origin `Origin`. Claims and logins are rate limited.
  Claim codes are 96-bit random tokens. The admin list never shows device ids.
- Admin: passcode from Secret Manager (constant-time compare, never logged),
  then a 12-hour HttpOnly, SameSite=Strict session cookie.
- Strict CSP, `X-Frame-Options: DENY`, `nosniff`, and a locked-down
  `Permissions-Policy` are applied to everything the backend serves. Sound is
  synthesized in the browser (no audio files), so the CSP didn't need to change.
- Known edge cases: one phone in two rooms at once could use a hunt Relic twice;
  Relics found mid-game show up after the phone rejoins.
