---
name: party-game-frontend-ux
description: >-
  Frontend UI/UX, living-room party game conventions, CSS isolation, custom SVG art,
  and procedural Web Audio / SpeechSynthesis guidelines for spooktacular games.
  Use this skill when building or styling TV host screens, phone controllers,
  audio engines, or game stylesheets in frontend/src/<game>/.
---

# Party Game Frontend & Living-Room UX Conventions

Every game has two distinct surfaces designed for a physical living room:
1. **TV Screen (`/<game>`)**: Viewed from 6–12 feet away on a shared TV or laptop. Prioritizes high-contrast typography, theatrical reveals, clear turn prompts, and host recovery controls.
2. **Phone Controller (`/<game>/play`)**: Held in each player's hand (`100dvh`, touch-first, no horizontal scroll). Prioritizes large tap targets, privacy from couch neighbors, haptics, and effortless reconnection.

Reference implementations:
- Avalon: [AvalonTv.tsx](../../../frontend/src/avalon/AvalonTv.tsx), [AvalonPlay.tsx](../../../frontend/src/avalon/AvalonPlay.tsx), [audio.ts](../../../frontend/src/avalon/audio.ts), [Art.tsx](../../../frontend/src/avalon/Art.tsx), [avalon.css](../../../frontend/src/avalon/avalon.css)
- Psychological: [PsychTv.tsx](../../../frontend/src/psych/PsychTv.tsx), [PsychPlay.tsx](../../../frontend/src/psych/PsychPlay.tsx), [Grid.tsx](../../../frontend/src/psych/Grid.tsx), [Pawn.tsx](../../../frontend/src/psych/Pawn.tsx), [psych.css](../../../frontend/src/psych/psych.css)
- Shared hooks/components: [useGameSocket.ts](../../../frontend/src/shared/useGameSocket.ts), [QrCode.tsx](../../../frontend/src/shared/QrCode.tsx)

---

## 1. Connection & Session Persistence (`useGameSocket`)

- **Initialize session cookie before opening socket**:
  - In `useEffect` on mount, call `ensureSession().then(() => setReady(true))` and pass `ready ? '/ws/<game>/tv' : null` (or `/play`) to `useGameSocket` so the browser always has its `__Host-sb_device` cookie even on the Vite dev server.
- **TV Room Persistence**:
  - Store the active room code in `sessionStorage` under `<pfx>-tv-room`.
  - Send `JSON.stringify({ type: 'create', resume: savedRoom() })` as `firstMessage` so refreshing the TV seamlessly resumes the room.
- **Phone Join Persistence & QR Pre-fill**:
  - Read `new URLSearchParams(location.search).get('code')` on mount so scanning the TV's QR code pre-fills the 4-letter room code.
  - Store `{ code, name }` in `sessionStorage` under `<pfx>-join`. If a saved join matches the URL's `code` (or no URL code is given), auto-connect on mount so refreshing a phone puts the player right back in their seat.
- **Auto-Reconnect with Backoff**:
  - When `status === 'closed'` and `!error`, retry up to `MAX_RETRIES` (6–8 attempts) with exponential backoff (`Math.min(4000, 500 * 2 ** retries)`), and offer a manual **Reconnect** button if retries are exhausted.

---

## 2. TV (Host) Living-Room Conventions

- **Lobby Essentials**:
  - Render `<QrCode url={`${location.origin}/<game>/play?code=${state.code}`} />` alongside the large 4-letter room code and join URL.
  - **Seat Ordering (`▲` / `▼`)**: Let the host reorder seats in the lobby (`move_seat` with `dir: -1 | 1`) so the on-screen turn ring matches where people are physically sitting around the room.
  - **Bots (`+ Bot` / `- Bot`)**: Allow adding/removing bots in the lobby so small groups can test or fill out player counts.
  - **Kick (`✕`)**: Allow removing a player from the lobby (or mid-game).
- **In-Game Host Controls**:
  - **Keep Room Code Visible**: Always display `CODE: XXXX` in the TV header/sidebar during gameplay so a disconnected player or latecomer can rejoin.
  - **Host Skip Instead of Punishing Timers**: For turn-based social games, do not force strict turn countdown timers that ruin room conversation. Instead, provide a host **Skip** button to bypass an unresponsive or away player.
  - **Two-Click `ConfirmButton`**: Wrap destructive mid-game actions (`End Game`, `Reset to Lobby`, `New Room`) in a two-click `ConfirmButton` that arms for 4 seconds (`armed ? confirmLabel : label`) to prevent accidental clicks.
  - **`📖 How to Play` Modal**: Provide a 4–5 card visual walkthrough accessible from both the Lobby and in-game header (`HowToOverlay`).

---

## 3. Phone (Player) Controller Conventions

- **Peek-Proof Secret Information ("Hold to Reveal")**:
  - Whenever a phone displays private information that neighbors on the couch shouldn't see (e.g. secret roles & sightings in Avalon, or secret coordinates), hide it behind a **Hold to Reveal** button using pointer events (`onPointerDown={() => setRevealed(true)}`, `onPointerUp={() => setRevealed(false)}`, `onPointerLeave`, `onPointerCancel`, `onContextMenu={(e) => e.preventDefault()}`).
- **Selfie Pawns (`shrinkSelfie`)**:
  - Let players upload/snap a selfie in the lobby via `<input type="file" accept="image/*" capture="user">` (opens the front camera directly on mobile without `getUserMedia` permissions).
  - Crop to a centered square (`128×128`), mirror horizontally (`ctx.translate(128, 0); ctx.scale(-1, 1)`), and encode as JPEG stepping down quality (`[0.75, 0.6, 0.45, 0.3]`) until `url.length <= 24_000`, then send `{ type: 'selfie', data: url }`.
  - Always provide a custom SVG fallback pawn/avatar colored with `player.color` when a player hasn't taken a selfie.
- **Tactile Haptics (`vibrate`)**:
  - Trigger short vibration pulses (`navigator.vibrate(30)` on join/confirm, `vibrate([25, 45, 25])` on `action_rejected` or turn alert), guarding against `navigator.userActivation?.hasBeenActive`.
- **Collapsible Drawers**:
  - Keep the phone screen focused on the current action; put secondary info (`📖 How to Play`, `Scores`, `Quest Chronicle`) in toggleable bottom/inline drawers.

---

## 4. Scoped CSS (`@layer`) & Non-Blocking Fonts

- **CSS Layer & Prefix Isolation**:
  - Wrap the entire stylesheet in `@layer <game> { .<pfx>-root { ... } }`.
  - Prefix **every** CSS class and CSS custom property with `<pfx>-` (e.g. `psy-`, `ava-`, `sb-`).
  - Never style bare global `body` or `html` tags inside a game's CSS file; apply background, font, and color variables to `.<pfx>-root` (`min-height: 100dvh; box-sizing: border-box;`).
- **Non-Blocking Font Loading**:
  - Load Google Fonts dynamically via `load<Game>Fonts()` in [useGameSocket.ts](../../../frontend/src/shared/useGameSocket.ts) (`<link rel="stylesheet">` injected once by ID) with sensible system/serif fallbacks so a slow font CDN never blocks first paint.

---

## 5. Procedural Web Audio & SpeechSynthesis Narration

- **Zero External Audio Files**:
  - Synthesize sound effects (chimes, drums, fanfares, strikes) procedurally using the Web Audio API (`AudioContext`, `OscillatorNode`, `GainNode`, routed through a `DynamicsCompressorNode`).
  - Use `window.speechSynthesis` (`SpeechSynthesisUtterance`) for TV voice narration (e.g., Avalon's Night Phase ceremony or Spirit Board's announcer), selecting a natural English voice and resolving a Promise on `onend` / `onerror` (with a safety timeout).
- **Browser Autoplay Unlock**:
  - Browsers suspend `AudioContext` until the first user gesture. Install a one-time `pointerdown` / `keydown` listener (`install<Game>WakeOnGesture()`) that resumes the `AudioContext`, and show a subtle `"🔇 Tap anywhere to enable sound"` banner on the TV if still suspended.
- **Persistent Mute Toggles**:
  - Provide independent **Sound Effects** and **Voice Narration** toggles on the TV persisted in `localStorage` (`<pfx>-sound`, `<pfx>-narrate`).
