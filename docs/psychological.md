# 🧠 Psychological

A digital version of PlayMonster's *Psychological*, running in the same Cloud Run
service as Spirit Board but fully separate from it.

| Screen | URL |
|---|---|
| TV (host) | `/psychological` |
| Phone | `/psychological/play` (the QR on the TV pre-fills the room code) |

## Rules

- **Board:** a 10×10 grid. Each turn draws one card from each of the two decks: a
  **white X-axis card** (everyday trait, e.g. *Studious*) and a **rainbow Y-axis card**
  (punchier trait, e.g. *Power-Hungry*). 1 means "not at all" and 10 means "very".
- **Main player:** turns go around the seating order. The main player secretly marks
  where they see themself.
- **Guessing:** the other players go **one at a time**, starting from the seat after the
  main player. Earlier guesses show on the TV, and **a square that's already taken is
  blocked**.
- **Scoring (guessers only):** 3 for the exact square, 2 for one step
  up/down/left/right, 1 for diagonally next to it.
- **Winning:** first to **10** (the host can set 5–20). If several players reach it
  on the same reveal, the highest score wins, and a tie at the top is a shared win.

### Variant: second marker (lobby toggles)

- **Second marker:** after their guess, each guesser also places a small marker for
  where *they* really think the main player is. It may sit on any square, including
  on top of other pawns, and shows on the TV as soon as it's locked in.
- **Half points** (needs Second marker): the second marker scores half
  (1.5 / 1 / 0.5), so scores can end in .5.

### Host controls (TV)

- Lobby: change the seat order (▲▼) to match the room, remove players, add/remove
  bots, and set the target score.
- In a turn: **Skip** whoever is up (a skipped main player passes the turn on; a
  skipped guesser scores nothing), **New cards** (before the main player marks),
  and **End game** (two clicks).
- **✎ Edit** on the scoreboard: fix anyone's points by hand (±1, or ±0.5 with half points).
- **📖 How to play:** a 4–5 card tutorial (lobby and in game). Phones have a
  how-to drawer in the lobby.
- Tap a **trait card** on the TV (or phone) to see its definition
  (`frontend/src/psych/definitions.ts`).
- The room code stays on the TV during the game so people can rejoin.
- There are no turn timers.

### Players (phone)

- **Selfie** in the lobby: it becomes your pawn. The phone's own camera opens via
  `<input capture>` (no camera permission needed). It's cropped to a 128px JPEG,
  validated server-side (real JPEG bytes, max 18 KB, one per 2s), kept only in memory,
  and deleted when you leave or the room closes.
- **Scores drawer** (closed by default) during the game.
- The main player can **change their answer** until the first guess is in.

### Fun stuff

- A **bullseye** (3 points) sets off a bowling-alley-style celebration on the TV,
  rotating through five: STRIKE!, MIND READER!, GET OUT OF MY HEAD!,
  ARE YOU IN MY WALLS?, ONE SHARED BRAIN CELL (`Strike.tsx`).
- The winner wears a badly drawn crown, and last place gets roasted.

### Edge cases

- Late joiners take the next seat and play from the next turn.
- If a guesser leaves, their square opens back up. If the main player leaves, the
  next turn starts. If fewer than 2 players are left, the game goes back to the lobby.
- Phones rejoin their seat after a refresh (device cookie). A refreshed TV gets its
  room back.

## Card words

The physical game has 125 "Psycho" and 125 "Logical" cards, but the full card text
was never published. The decks in `backend/app/psych/traits.py` are our own
(125 + 125, with no word in both decks). They include the few words known to be in
the real game (*Funny*, *Competitive*, *Power-Hungry*). Edit freely; the tests check
deck sizes and that no word is in both decks.

## Isolation from Spirit Board

Only additive lines touch Spirit Board files:
- `backend/app/main.py`: the router import, `include_router`, and two SPA routes.
- `frontend/src/App.tsx`: two `React.lazy` routes, so the game's JS and CSS are
  separate chunks that Spirit Board pages never load.

The game imports only the shared origin check (`app/origins.py`) and device cookie
reader (`hunt_api.device_of`), plus the `tv/QrCode.tsx` component. It has its own
room manager (Spirit Board codes don't work on the Psychological join screen),
uses no 30 Hz tick (state is sent when it changes; a 4 Hz loop only moves bots), and
its CSS is in `@layer psych` with `psy-` class names.

## Files

```
backend/app/psych/
  rules.py     pure scoring, guessing order, winners
  traits.py    the two word decks
  rooms.py     PsychRoom (phase machine) + PsychRoomManager
  api.py       /ws/psych/tv and /ws/psych/play
  ws_util.py   rate limiter + message validation (a copy, so we never import main.py)
backend/tests/test_psych_*.py
frontend/src/psych/
  PsychTv.tsx  lobby, board + sidebar, reveal, game over
  PsychPlay.tsx join, waiting, tap-a-square + lock in
  Grid.tsx     the 10×10 board with axis cards (shared by TV and phone)
  Pawn.tsx     SVG pawns, scoring tokens, the gold secret marker
  HeadArt.tsx  the rainbow watercolour head in SVG
  psych.css    theme (fonts load via a non-blocking <link>)
```

## Protocol

- **TV → server:** `create{resume}`, `start`, `next_turn`, `skip`, `redraw`,
  `move_seat{playerId,dir}`, `set_target{target}`, `add_bot`, `remove_bot`, `kick{playerId}`,
  `play_again`
- **Phone → server:** `join{code,name}`, `mark{x,y[,ox,oy]}` (the secret or a guess,
  plus the second marker when that's on), `unmark`, `selfie{data|null}`
- **TV → server (round 2):** `set_opinions{on}`, `set_opinion_points{on}`,
  `adjust_score{playerId,delta}`
- **Server → everyone:** `avatars{avatars}` when selfies change (kept out of `state`
  because they're large)
- **Server → everyone:** `state` (phase, players in seat order, `mainId`, `currentId`,
  `order`, `queue`, `traits`, `guesses`, `reveal`, `winners`, …)
- **Server → main player only:** `secret{turn,x,y}`. The secret is never in `state`
  before the reveal.
