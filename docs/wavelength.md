# 🌊 Wavelength

A digital TV + Phone (and pass-and-play) edition of *Wavelength*, inspired by [`mikeck1/mikeck1.github.io`](https://github.com/mikeck1/mikeck1.github.io) and isolated in its own backend and frontend packages.

| Screen | URL |
|---|---|
| TV (host) | `/wavelength` |
| Phone | `/wavelength/play` (the QR on the TV pre-fills the room code) |

## Game Modes & Rules

- **Spectrum & Dial:** Each round draws a spectrum card with two opposing concepts (e.g. *Cold ↔ Hot*, *Underrated ↔ Overrated*) and places a hidden 5-band target along the semicircle dial ($-90^\circ$ to $+90^\circ$).
- **Psychic Phase:** The current Psychic secretly views the target wedge on their phone (or via **Peek on TV** for single-screen pass-and-play), optionally draws a new card, and submits a single clue (typed to display on the TV banner or spoken out loud).
- **Three Playable Modes (configurable in the Lobby):**
  1. **⚡ Teams (2–6 Teams):** Active team members drag the needle on their phones (synced live on the TV) and lock in their guess. When **Left/Right Opposing Bonus** is enabled, the opposing team(s) vote whether the true target center is **◀ Left** or **Right ▶** of the locked needle for $+1$ bonus point. Optional **Catch-Up Rule** awards an immediate bonus turn when a team hits a Bullseye while trailing by $4+$ points.
  2. **🎯 Free-for-All:** Every non-Psychic player drags and locks in their own personal needle on their phone. On reveal, all player needles (with selfie avatars on the tips) appear simultaneously, and the Psychic earns $+1$ point per player who lands on the target (up to $+3$).
  3. **🤝 Co-op:** Everyone collaborates across $7$ cards (a Bullseye earns $+1$ bonus card) to achieve the highest end-of-game mind-meld rating.
- **Scoring Wedges:**
  - **2 · 3 · 4 · 3 · 2** points for Bullseye ($\pm 4.5^\circ$, **4 pts**), Close ($\pm 13.5^\circ$, **3 pts**), and Near ($\pm 22.5^\circ$, **2 pts**).

## Card Packs & Custom Decks

| Pack | Cards | Examples |
|---|---|---|
| 🌊 Classic Spectrum (`core`) | 135 | *Cold ↔ Hot*, *Useless App ↔ Must-Have App* |
| 🔥 Hot Takes & Party (`spicy`) | 40 | *Red Flag ↔ Green Flag*, *Trashy ↔ Classy* |
| 🎬 Pop Culture & Nerd (`pop`) | 40 | *Bad Villain ↔ Iconic Villain*, *Filler Episode ↔ Peak Cinema* |
| 🌌 Deep & Weird (`deep`) | 40 | *Chaotic Evil ↔ Lawful Good*, *Dystopia ↔ Utopia* |

The host can also open **🗂️ Deck** to add custom cards or import/export `.json`, `.csv`, or `Left | Right` text lists.

## Files

```text
backend/app/wavelength/
  decks.py     4 built-in spectrum packs + custom card parser
  rules.py     pure angle clamping, 5-wedge scoring, bonus & Co-op ratings
  rooms.py     WavelengthRoom state machine, Bot AI, and WavelengthRoomManager
  api.py       /ws/wavelength/tv and /ws/wavelength/play
backend/tests/wavelength/test_wavelength_*.py
frontend/src/wavelength/
  WavelengthTv.tsx   lobby, scoreboard, turn banner, dial stage, pass-and-play controls
  WavelengthPlay.tsx join, selfie picker, psychic peek/clue, guesser dial, L/R bonus vote
  Dial.tsx           shared SVG semicircle dial with animated shutter and avatar needles
  DeckModal.tsx      pack picker + custom card editor and JSON/CSV/TXT import/export
  HowTo.tsx          tutorial modal (TV) and drawer (phone)
  audio.ts           synthesized Web Audio dial ticks, shutter clack, drumroll & fanfares
  protocol.ts        TypeScript protocol types and spectrum color hashing
  wavelength.css     scoped theme in @layer wavelength with wl- class prefix
```
