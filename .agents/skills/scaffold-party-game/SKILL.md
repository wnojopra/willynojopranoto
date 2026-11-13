---
name: scaffold-party-game
description: >-
  End-to-end blueprint and checklist for scaffolding a new multiplayer TV + Phone
  party game in the spooktacular repository. Use this skill when adding a new game,
  creating its backend and frontend packages, registering routes and lazy chunks,
  adding it to the homepage showcase, or writing its design doc.
---

# Scaffold a New Party Game

Every multiplayer game in this repository runs inside a single FastAPI + React service while remaining **strictly isolated** in its own backend and frontend packages.

Use this checklist and blueprint whenever creating a new game `<game>` (with a 2–4 letter CSS/storage prefix `<pfx>`, e.g. `sb`, `psy`, `ava`).

---

## 1. Architecture & Isolation Rules

1. **Isolated Packages**:
   - Backend package: `backend/app/<game>/`
   - Backend tests: `backend/tests/<game>/`
   - Frontend package: `frontend/src/<game>/`
   - Documentation: `docs/<game>.md`
2. **Permitted Shared Imports Only**:
   - Backend games may only import from `app.shared` ([origins.py](../../../backend/app/shared/origins.py), [cookies.py](../../../backend/app/shared/cookies.py), [ws.py](../../../backend/app/shared/ws.py), [rooms_util.py](../../../backend/app/shared/rooms_util.py)) and standard library / FastAPI. Never import from another game's package.
   - Frontend games may only import from `../shared/QrCode` ([QrCode.tsx](../../../frontend/src/shared/QrCode.tsx)) and `../shared/useGameSocket` ([useGameSocket.ts](../../../frontend/src/shared/useGameSocket.ts)). Never import components or styles from another game.
3. **Separate Room Manager**:
   - Every game instantiates its own `<Game>RoomManager` in `backend/app/<game>/api.py`. Room codes from one game must never resolve in another game.

---

## 2. File-by-File Scaffolding Checklist

### Step 1: Backend Package (`backend/app/<game>/`)

Create the following files (see the `party-game-backend` skill for implementation patterns):

- `backend/app/<game>/__init__.py`: Empty package marker.
- `backend/app/<game>/rules.py`: Pure, stateless functions and constants (`MIN_PLAYERS`, `MAX_PLAYERS`, deck definitions, role/turn calculations, scoring, winner determination). No WebSockets, clocks, or I/O.
- `backend/app/<game>/rooms.py`:
  - `<Game>Player` dataclass (`id`, `name`, `color`, `is_bot`, `connected`, `device`).
  - `<Game>Room` synchronous state machine with injectable `rng: random.Random` and `clock: Callable[[], float] = time.monotonic`.
  - `<Game>RoomManager` managing active rooms (`MAX_ROOMS = 20`, `ROOM_IDLE_SECONDS = 600`) and a background asyncio task (`LOOP_SECONDS = 0.25`) that ticks bots and prunes idle rooms.
- `backend/app/<game>/api.py`:
  - FastAPI `APIRouter` exposing `/ws/<game>/tv` and `/ws/<game>/play`.

### Step 2: Frontend Shared Font Loader (`frontend/src/shared/useGameSocket.ts`)

Add a non-blocking Google Fonts loader in [useGameSocket.ts](../../../frontend/src/shared/useGameSocket.ts):

```ts
const <GAME>_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=...&display=swap';

export function load<Game>Fonts(): void {
  loadFonts('<pfx>-fonts', <GAME>_FONTS_URL);
}
```

### Step 3: Frontend Package (`frontend/src/<game>/`)

Create the following files (see the `party-game-frontend-ux` skill for UI/UX conventions):

- `frontend/src/<game>/protocol.ts`: TypeScript discriminated unions for server messages (`<Pfx>State`, `created`, `joined`, `avatars`, `error`, plus any private message types like `secret` or `role_secret`) and client messages.
- `frontend/src/<game>/<Game>Tv.tsx`: Living-room TV host view (Lobby with QR code, seating controls, bot controls, options, main board/tableau, HowTo modal, and two-click Confirm buttons).
- `frontend/src/<game>/<Game>Play.tsx`: Phone controller view (Join form pre-filled from `?code=`, selfie uploader, Hold-to-Reveal secret cards, turn controls, and HowTo/Score drawers).
- `frontend/src/<game>/HowTo.tsx`: Tutorial cards (`HowToOverlay` for TV and `HowToList` for phone drawer).
- `frontend/src/<game>/<game>.css`: Scoped stylesheet wrapped in `@layer <game> { .<pfx>-root { ... } }` with all classes prefixed `<pfx>-`.
- Optional art/audio modules: `Art.tsx` (custom inline SVGs, pawns, badges) and `audio.ts` (procedural Web Audio API sound effects + `SpeechSynthesis` narrator).

### Step 4: Wire Routes & Code-Splitting

1. **Frontend lazy routes** in [App.tsx](../../../frontend/src/App.tsx):
   ```tsx
   const <Game>Tv = lazy(() => import('./<game>/<Game>Tv').then((m) => ({ default: m.<Game>Tv })));
   const <Game>Play = lazy(() => import('./<game>/<Game>Play').then((m) => ({ default: m.<Game>Play })));
   ```
   And inside `App()`:
   ```tsx
   if (path === '/<game>') return <Suspense fallback={null}><<Game>Tv /></Suspense>;
   if (path === '/<game>/play') return <Suspense fallback={null}><<Game>Play /></Suspense>;
   ```
2. **Backend router & SPA routes** in [main.py](../../../backend/app/main.py):
   - Import `from app.<game> import api as <game>_api` and register `app.include_router(<game>_api.router)`.
   - Add `@app.api_route("/<game>", methods=["GET", "HEAD"])` and `@app.api_route("/<game>/play", methods=["GET", "HEAD"])` to `spa_routes`.
3. **Homepage showcase** in [HomePage.tsx](../../../frontend/src/home/HomePage.tsx):
   - Add an entry to `GAMES` with `Host on TV` (`/<game>`) and `Join on Phone` (`/<game>/play`) actions and a preview image under `frontend/public/images/`.

### Step 5: Docs & Tests

1. Create `docs/<game>.md` documenting URLs, rules, lobby options, host/player controls, file layout, and WebSocket protocol.
2. Update [README.md](../../../README.md) (`URLs & Routes`, `Games`, `Repository Layout`, and `Run Locally` sections).
3. Create the 3-tier test suite in `backend/tests/<game>/` (see the `party-game-testing` skill):
   - `test_<game>_rules.py`
   - `test_<game>_rooms.py`
   - `test_<game>_api.py`

---

## 3. Verification Commands

Run both backend and frontend checks before considering the scaffold complete:

```bash
cd backend && .venv/bin/python -m pytest -q
cd frontend && npm run typecheck && npm run build
```
