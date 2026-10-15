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

### Host controls (TV)

- Lobby: change the seat order (▲▼) to match the room, remove players, add/remove
  bots, and set the target score.
- In a turn: **Skip** whoever is up (a skipped main player passes the turn on; a
  skipped guesser scores nothing), **New cards** (before the main player marks),
  and **End game** (two clicks).
- There are no turn timers.

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
- **Phone → server:** `join{code,name}`, `mark{x,y}` (the secret or a guess, depending on
  the phase and whose turn it is)
- **Server → everyone:** `state` (phase, players in seat order, `mainId`, `currentId`,
  `order`, `queue`, `traits`, `guesses`, `reveal`, `winners`, …)
- **Server → main player only:** `secret{turn,x,y}`. The secret is never in `state`
  before the reveal.
