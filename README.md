# willynojopranoto.com

Personal site and multiplayer party-game arcade for **Willy Nojopranoto**, hosted as a single FastAPI + React service on Cloud Run.

## URLs & Routes

| Path | Purpose |
|---|---|
| `/` | Personal homepage (about me, party games showcase, projects & links) |
| `/spiritboard` | **👻 Spirit Board** — TV host screen |
| `/spiritboard/play` | **👻 Spirit Board** — Phone controller & join screen |
| `/spiritboard/relics` | **👻 Spirit Board** — This phone's scavenger hunt Relic collection |
| `/spiritboard/admin` | **👻 Spirit Board** — Host admin console (hunt QR codes + custom questions) |
| `/spiritboard/admin/print` | **👻 Spirit Board** — Printable sticker sheet of unclaimed hunt QR codes |
| `/spiritboard/claim/:token` | **👻 Spirit Board** — Scavenger hunt QR sticker landing page |
| `/psychological` | **🧠 Psychological** — TV host screen |
| `/psychological/play` | **🧠 Psychological** — Phone controller & join screen |
| `/avalon` | **🛡️ Avalon** — TV host screen |
| `/avalon/play` | **🛡️ Avalon** — Phone controller & join screen |
| `/wavelength` | **🌊 Wavelength** — TV host screen |
| `/wavelength/play` | **🌊 Wavelength** — Phone controller & join screen |

## Games

### 👻 Spirit Board ([`docs/spiritboard.md`](docs/spiritboard.md))
A Jackbox-style Halloween party game. The TV shows a Ouija board (`30 Hz` server-authoritative physics loop), everyone secretly bets on the answer, and all phones drag the planchette together at the same time. Includes Spirit Bets rounds, Medium rounds, Final Séance, Haunted curse cards, 13 one-shot Relics, synthesized Web Audio + speech narrator, and a house-wide QR scavenger hunt backed by Firestore.

### 🧠 Psychological ([`docs/psychological.md`](docs/psychological.md))
A digital version of PlayMonster's *Psychological*. Each turn pairs two trait cards on a 10×10 grid; the main player secretly marks where they see themself while everyone else takes turns guessing (and optionally placing a second "real opinion" marker). Supports custom phone selfies as pawns, multiple expansion card packs, and bowling-alley bullseye celebrations.

### 🛡️ The Resistance: Avalon ([`docs/avalon.md`](docs/avalon.md))
A digital adaptation of Don Eskridge's *The Resistance: Avalon* for 5–10 players. Features a configurable lobby with optional characters (Percival, Morgana, Mordred, Oberon), a Night Phase with a synthesized TV voice narrator and peak-proof "Hold to Reveal" role cards on phones, live Quest Team building, simultaneous voting, secret Quest cards, and the final Assassinate Merlin phase.

### 🌊 Wavelength ([`docs/wavelength.md`](docs/wavelength.md))
A digital adaptation of *Wavelength* inspired by `mikeck1.github.io`. Features a rotating SVG shutter dial, 4 themed spectrum packs plus custom deck import/export, Teams mode (with Left/Right opposing bonus and Catch-Up rule), Free-for-All mode with selfie-tipped needles, Co-op mode, pass-and-play TV controls, and synthesized Web Audio sound effects.

## Repository Layout

```text
backend/                 Python 3.12+ / FastAPI
  app/
    main.py              FastAPI entrypoint, CSP/security headers, SPA static routing
    shared/              Shared origin checks, __Host- cookies/CSRF, WebSocket rate limiter, room code/name utils
    spiritboard/         Spirit Board game logic, physics, decks, Relics, scavenger hunt store, /ws/spiritboard/* & /api/*
    psych/               Psychological turn logic, trait decks, /ws/psych/*
    avalon/              Avalon role/sighting logic, quest state machine, /ws/avalon/*
    wavelength/          Wavelength angle scoring, spectrum decks, room state machine, /ws/wavelength/*
  tests/
    spiritboard/         Spirit Board unit, hunt, reconnect, and WebSocket tests
    psych/               Psychological unit and WebSocket tests
    avalon/              Avalon rules, rooms, and WebSocket tests
    wavelength/          Wavelength rules, rooms, and WebSocket tests
frontend/                React + TypeScript + Vite
  src/
    App.tsx              Route dispatcher with React.lazy() per section
    shared/              QrCode.tsx, useGameSocket.ts (WebSocket hook, session cookie init, font loader)
    home/                HomePage.tsx + home.css (willynojopranoto.com landing page)
    spiritboard/         Spirit Board TV, phone, and scavenger hunt screens + spiritboard.css
    psych/               Psychological TV and phone screens + psych.css
    avalon/              Avalon TV and phone screens, narrator audio, SVG art + avalon.css
    wavelength/          Wavelength TV and phone screens, SVG shutter dial, deck modal + wavelength.css
```

## Run Locally

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
- Homepage: <http://127.0.0.1:5173/>
- Spirit Board (TV / Phone): <http://127.0.0.1:5173/spiritboard> / <http://127.0.0.1:5173/spiritboard/play>
- Psychological (TV / Phone): <http://127.0.0.1:5173/psychological> / <http://127.0.0.1:5173/psychological/play>
- Avalon (TV / Phone): <http://127.0.0.1:5173/avalon> / <http://127.0.0.1:5173/avalon/play>
- Wavelength (TV / Phone): <http://127.0.0.1:5173/wavelength> / <http://127.0.0.1:5173/wavelength/play>

Or build the frontend once (`npm run build`) and serve everything from FastAPI at <http://127.0.0.1:8000/>.

## Tests

```bash
cd backend && .venv/bin/python -m pytest -q
cd frontend && npm run typecheck
```

## Deploy (Cloud Run)

```bash
./deploy.sh                  # build with Cloud Build + deploy (scales to zero)
MIN_INSTANCES=1 ./deploy.sh  # party night: keep one instance warm
```

Defaults: project `nojo-client`, region `us-west1`, service `spirit-board` (override with `PROJECT`, `REGION`, `SERVICE`). The service runs as a single instance (`--max-instances 1`) because active game rooms live in memory, with session affinity and a 60-minute WebSocket timeout.

**Admin passcode** (for `/spiritboard/admin`) lives in Secret Manager (`spirit-board-admin-passcode`). Locally, set `SB_ADMIN_PASSCODE=...` before starting uvicorn.
