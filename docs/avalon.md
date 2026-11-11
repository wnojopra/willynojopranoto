# 🛡️ The Resistance: Avalon

A digital adaptation of Don Eskridge's *The Resistance: Avalon* (5–10 players), running in the same Cloud Run service as Spirit Board and Psychological while fully isolated in its own package.

| Screen | URL |
|---|---|
| TV (host) | `/avalon` |
| Phone | `/avalon/play` (the QR on the TV pre-fills the room code) |

## Rules & Flow

- **Player Counts & Alignments (5–10 players):**
  - **5 players:** 3 Good, 2 Evil · Quests: `2, 3, 2, 3, 3`
  - **6 players:** 4 Good, 2 Evil · Quests: `2, 3, 4, 3, 4`
  - **7 players:** 4 Good, 3 Evil · Quests: `2, 3, 3, 4*, 4`
  - **8 players:** 5 Good, 3 Evil · Quests: `3, 4, 4, 5*, 5`
  - **9 players:** 6 Good, 3 Evil · Quests: `3, 4, 4, 5*, 5`
  - **10 players:** 6 Good, 4 Evil · Quests: `3, 4, 4, 5*, 5`
  - *(`*` Quest 4 in games of 7+ players requires at least **2 Fail** cards to fail.)*
- **Core Characters (always included):**
  - **Merlin** (Good): Sees all agents of Evil during the Night reveal (except Mordred).
  - **The Assassin** (Evil): If Good completes 3 Quests, gets one final chance to win for Evil by naming Merlin.
  - **Loyal Servants of Arthur** (Good) & **Minions of Mordred** (Evil): Fill remaining Good and Evil slots.
- **Optional Characters (configurable in the Lobby):**
  - **Percival** (Good): Sees Merlin (and Morgana, if in play) during the Night reveal.
  - **Morgana** (Evil): Appears as Merlin to Percival.
  - **Mordred** (Evil): His identity is hidden from Merlin during the Night reveal.
  - **Oberon** (Evil): Not a Minion of Mordred — does not know the other Evil players, nor do they know him (still seen by Merlin).
- **Night Phase (Role Review & Audio Ceremony):**
  - Each phone receives a private `role_secret` message behind a peak-proof **Hold to Reveal Secret Role & Sightings** button.
  - The TV runs a synthesized Web Audio + `SpeechSynthesis` narrator ceremony dynamically tailored to the active optional roles.
- **Team Building, Voting & Quests:**
  - The current Leader selects the Quest Team on their phone and calls for a Vote.
  - All players secretly vote **Approve** or **Reject** on their phones; votes flip simultaneously.
  - **5 consecutive rejected teams** in a single round wins the game for Evil.
  - On an approved Quest, Team members secretly play **Success** (or **Fail** if Evil; Good players are strictly required to play Success).
- **Game End & Assassination:**
  - 3 Failed Quests → **Evil wins**.
  - 3 Successful Quests → **Assassinate Merlin** phase: the Assassin selects one Good player on their phone. Naming Merlin wins the game for Evil; otherwise **Good wins**!

## Files

```text
backend/app/avalon/
  rules.py     pure alignment splits, quest specs, night sightings, and script builder
  rooms.py     AvalonRoom state machine, bot AI, and AvalonRoomManager
  api.py       /ws/avalon/tv and /ws/avalon/play
backend/tests/avalon/test_avalon_*.py
frontend/src/avalon/
  AvalonTv.tsx   lobby, night ceremony narrator, quest tableau, chronicle, gameover
  AvalonPlay.tsx join, selfie picker, hold-to-reveal role card, team/vote/quest/assassinate controls
  Art.tsx        SVG shields, Grail crest, crowns, and character emblems
  HowTo.tsx      rules overlay (TV) and drawer (phone)
  audio.ts       Web Audio chimes/fanfare + Night Phase SpeechSynthesis sequencer
  protocol.ts    TypeScript protocol types and role catalog
  avalon.css     scoped theme in @layer avalon with ava- class prefix
```
