"""Rooms and turn flow for Psychological.

Turn-based, so there is no physics tick: state is broadcast when something
happens. A slow loop per room only moves bots and closes idle rooms. Game logic
is synchronous and clock-injectable so it can be tested without sockets.

Phases:
  lobby    - players join; the host orders seats and starts
  secret   - the main player marks their own spot (hidden)
  guessing - the others guess one at a time; claimed squares are blocked
  reveal   - secret shown, points added
  gameover - someone reached the target score
"""

from __future__ import annotations

import asyncio
import hmac
import logging
import random
import re
import secrets
import time
import unicodedata
from dataclasses import dataclass
from typing import Any, Callable, Protocol

from app.psych import rules
from app.psych.traits import X_DECK, Y_DECK

log = logging.getLogger(__name__)

MAX_PLAYERS = 12
MIN_PLAYERS_TO_START = 2
MAX_ROOMS = 20
DEFAULT_TARGET = 10
MIN_TARGET = 5
MAX_TARGET = 20
BOT_DELAY_SECONDS = 1.5
LOOP_SECONDS = 0.25
ROOM_IDLE_SECONDS = 10 * 60  # close rooms with no TV for this long

# No vowels, so room codes can't spell anything rude.
CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ"
CODE_LENGTH = 4
NAME_RE = re.compile(r"[\w .'\-]{1,14}")

# The physical game's six pawn colours first, then six more in the same style.
COLORS = [
    "#e8353b",  # red
    "#1fa34a",  # green
    "#3cc6d0",  # teal
    "#1e63c6",  # blue
    "#f4f4f4",  # white
    "#d6338f",  # magenta
    "#f28c28",  # orange
    "#7d4cc9",  # purple
    "#9bcf2e",  # lime
    "#1d2f6f",  # navy
    "#f5c518",  # yellow
    "#ff8fc0",  # pink
]
assert len(COLORS) >= MAX_PLAYERS

BOT_NAMES = ["Freud", "Jung", "Pavlov", "Skinner", "Maslow", "Piaget", "Adler", "Rogers", "Erikson", "Bandura", "Horney", "Milgram"]

Square = tuple[int, int]


class Conn(Protocol):
    async def send_json(self, data: Any) -> None: ...


class JoinError(Exception):
    """A player-facing reason a join was rejected."""


class RoomLimitError(Exception):
    pass


def normalize_name(raw: object) -> str:
    if not isinstance(raw, str):
        raise JoinError("Pick a name.")
    name = " ".join(unicodedata.normalize("NFKC", raw).split())
    if not NAME_RE.fullmatch(name):
        raise JoinError("Names are 1\u201314 letters, numbers, or spaces.")
    return name


def normalize_code(raw: object) -> str | None:
    if not isinstance(raw, str):
        return None
    code = raw.strip().upper()
    if len(code) != CODE_LENGTH or any(c not in CODE_ALPHABET for c in code):
        return None
    return code


@dataclass
class PsychPlayer:
    id: str
    name: str
    color: str
    is_bot: bool = False
    connected: bool = True
    device: str | None = None
    score: int = 0

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "color": self.color,
            "isBot": self.is_bot,
            "connected": self.connected,
            "score": self.score,
        }


class Deck:
    """Draws without repeats until empty, then reshuffles."""

    def __init__(self, words: tuple[str, ...], rng: random.Random) -> None:
        self._words = words
        self._rng = rng
        self._pile: list[str] = []

    def draw(self) -> str:
        if not self._pile:
            self._pile = list(self._words)
            self._rng.shuffle(self._pile)
        return self._pile.pop()


class PsychRoom:
    def __init__(
        self,
        code: str,
        rng: random.Random | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.code = code
        self._rng = rng or random.Random(secrets.randbits(64))
        self._clock = clock
        self.players: dict[str, PsychPlayer] = {}
        self.seats: list[str] = []  # turn order around the table
        self.phase = "lobby"
        self.target = DEFAULT_TARGET
        self.turn = 0
        self.main_id: str | None = None
        self.traits: tuple[str, str] | None = None  # (x, y)
        self.secret: Square | None = None
        self.order: list[str] = []  # this turn's guessers, in order
        self.queue: list[str] = []  # guessers still to go; queue[0] is up
        self.guesses: dict[str, Square] = {}
        self.points: dict[str, int] = {}
        self.winners: list[str] = []
        self._x_deck = Deck(X_DECK, self._rng)
        self._y_deck = Deck(Y_DECK, self._rng)
        self._actor_since = clock()
        self.tv_conns: set[Conn] = set()
        self.player_conns: dict[str, Conn] = {}
        self.host_device: str | None = None
        self.last_activity = clock()

    # ---- Players ---------------------------------------------------------

    def touch(self) -> None:
        self.last_activity = self._clock()

    def is_host(self, device: str | None) -> bool:
        return bool(device and self.host_device) and hmac.compare_digest(device, self.host_device)

    def add_player(self, raw_name: object, is_bot: bool = False, device: str | None = None) -> PsychPlayer:
        name = normalize_name(raw_name)
        for p in self.players.values():
            if p.name.casefold() != name.casefold():
                continue
            if p.is_bot or is_bot:
                raise JoinError("That name is taken.")
            if p.device is not None:
                # Seats belong to the phone that took them.
                if device is not None and hmac.compare_digest(device, p.device):
                    p.connected = True
                    return p
                raise JoinError("That name is taken. On a new phone? Add a letter to your name.")
            if not p.connected:  # no device cookie (local dev / tests)
                p.connected = True
                return p
            raise JoinError("That name is taken.")
        if len(self.players) >= MAX_PLAYERS:
            raise JoinError("This game is full.")
        used = {p.color for p in self.players.values()}
        color = next(c for c in COLORS if c not in used)
        player = PsychPlayer(
            id=secrets.token_hex(4), name=name, color=color, is_bot=is_bot,
            device=None if is_bot else device,
        )
        self.players[player.id] = player
        self.seats.append(player.id)  # late joiners play from the next turn
        self.touch()
        return player

    def mark_disconnected(self, player_id: str) -> None:
        p = self.players.get(player_id)
        if p:
            p.connected = False

    def remove_player(self, player_id: str) -> None:
        if player_id not in self.players:
            return
        was_main = player_id == self.main_id and self.phase in ("secret", "guessing")
        next_main = self._seat_after(player_id) if was_main else None
        self.players.pop(player_id)
        self.seats = [s for s in self.seats if s != player_id]
        self.order = [s for s in self.order if s != player_id]
        self.guesses.pop(player_id, None)  # their square opens back up
        self.points.pop(player_id, None)
        self.winners = [w for w in self.winners if w != player_id]
        if was_main:
            self.main_id = None
            if len(self.players) < MIN_PLAYERS_TO_START:
                self._to_lobby()
            else:
                self._start_turn(next_main)
            return
        if player_id in self.queue:
            was_up = self.queue[0] == player_id
            self.queue.remove(player_id)
            if was_up:
                self._actor_since = self._clock()
            if self.phase == "guessing" and not self.queue:
                self._reveal()

    def add_bot(self) -> PsychPlayer | None:
        taken = {p.name for p in self.players.values()}
        for name in BOT_NAMES:
            if name not in taken:
                try:
                    return self.add_player(name, is_bot=True)
                except JoinError:
                    return None
        return None

    def remove_bot(self) -> None:
        bots = [pid for pid in self.seats if self.players[pid].is_bot]
        if bots:
            self.remove_player(bots[-1])

    def move_seat(self, player_id: object, direction: object) -> bool:
        """Lobby only: moves a player one seat earlier (-1) or later (+1)."""
        if self.phase != "lobby" or player_id not in self.seats or direction not in (-1, 1):
            return False
        i = self.seats.index(player_id)
        j = i + direction  # type: ignore[operator]
        if not 0 <= j < len(self.seats):
            return False
        self.seats[i], self.seats[j] = self.seats[j], self.seats[i]
        return True

    def set_target(self, n: object) -> bool:
        if self.phase != "lobby" or not isinstance(n, int) or isinstance(n, bool):
            return False
        if not MIN_TARGET <= n <= MAX_TARGET:
            return False
        self.target = n
        return True

    # ---- Turn flow -------------------------------------------------------

    @property
    def current_id(self) -> str | None:
        if self.phase == "secret":
            return self.main_id
        if self.phase == "guessing" and self.queue:
            return self.queue[0]
        return None

    def can_start(self) -> bool:
        return self.phase == "lobby" and len(self.players) >= MIN_PLAYERS_TO_START

    def start(self) -> bool:
        if not self.can_start():
            return False
        for p in self.players.values():
            p.score = 0
        self.turn = 0
        self.winners = []
        self._start_turn(self.seats[0])
        return True

    def mark(self, player_id: str, x: object, y: object) -> bool:
        """The main player's secret mark, or the current guesser's guess."""
        if not rules.valid_square(x, y) or player_id != self.current_id:
            return False
        sq = (x, y)  # type: ignore[assignment]
        if self.phase == "secret":
            self.secret = sq
            self.phase = "guessing"
            self._actor_since = self._clock()
            if not self.queue:
                self._reveal()
            return True
        if sq in self.guesses.values():
            return False  # someone already claimed it
        self.guesses[player_id] = sq
        self.queue.pop(0)
        self._actor_since = self._clock()
        if not self.queue:
            self._reveal()
        return True

    def skip(self) -> bool:
        """Host: skip whoever is up (a skipped guesser scores nothing)."""
        if self.phase == "secret" and self.main_id:
            self._start_turn(self._seat_after(self.main_id))
            return True
        if self.phase == "guessing" and self.queue:
            self.queue.pop(0)
            self._actor_since = self._clock()
            if not self.queue:
                self._reveal()
            return True
        return False

    def redraw(self) -> bool:
        """Host: new trait cards, before the main player has marked."""
        if self.phase != "secret":
            return False
        self.traits = (self._x_deck.draw(), self._y_deck.draw())
        return True

    def next_turn(self) -> bool:
        if self.phase != "reveal":
            return False
        if self.winners:
            self.phase = "gameover"
            return True
        nxt = self._seat_after(self.main_id) if self.main_id else (self.seats[0] if self.seats else None)
        self._start_turn(nxt)
        return True

    def play_again(self) -> bool:
        """Back to the lobby with everyone at 0."""
        if self.phase == "lobby":
            return False
        self._to_lobby()
        for p in self.players.values():
            p.score = 0
        return True

    def _seat_after(self, player_id: str | None) -> str | None:
        if not self.seats:
            return None
        if player_id not in self.seats:
            return self.seats[0]
        return self.seats[(self.seats.index(player_id) + 1) % len(self.seats)]

    def _start_turn(self, main_id: str | None) -> None:
        if main_id is None or main_id not in self.players:
            self._to_lobby()
            return
        self.turn += 1
        self.phase = "secret"
        self.main_id = main_id
        self.traits = (self._x_deck.draw(), self._y_deck.draw())
        self.secret = None
        self.order = rules.guess_order(self.seats, main_id)
        self.queue = list(self.order)
        self.guesses = {}
        self.points = {}
        self._actor_since = self._clock()

    def _reveal(self) -> None:
        assert self.secret is not None
        self.phase = "reveal"
        self.points = {pid: rules.score(sq, self.secret) for pid, sq in self.guesses.items()}
        for pid, pts in self.points.items():
            self.players[pid].score += pts
        self.winners = rules.winners({p.id: p.score for p in self.players.values()}, self.target)

    def _to_lobby(self) -> None:
        self.phase = "lobby"
        self.main_id = None
        self.traits = None
        self.secret = None
        self.order = []
        self.queue = []
        self.guesses = {}
        self.points = {}
        self.winners = []

    # ---- Bots ------------------------------------------------------------

    def tick(self) -> bool:
        """Lets a bot take its turn after a short pause. True if state changed."""
        actor = self.players.get(self.current_id or "")
        if actor is None or not actor.is_bot:
            return False
        if self._clock() - self._actor_since < BOT_DELAY_SECONDS:
            return False
        taken = set(self.guesses.values()) if self.phase == "guessing" else set()
        open_squares = [
            (x, y)
            for x in range(1, rules.GRID_SIZE + 1)
            for y in range(1, rules.GRID_SIZE + 1)
            if (x, y) not in taken
        ]
        x, y = self._rng.choice(open_squares)
        return self.mark(actor.id, x, y)

    # ---- Messages ----------------------------------------------------------

    def state_dict(self) -> dict:
        shown = self.phase in ("reveal", "gameover")
        return {
            "type": "state",
            "code": self.code,
            "phase": self.phase,
            "target": self.target,
            "turn": self.turn,
            "players": [self.players[pid].to_dict() for pid in self.seats],
            "mainId": self.main_id,
            "currentId": self.current_id,
            "order": list(self.order),
            "queue": list(self.queue),
            "traits": {"x": self.traits[0], "y": self.traits[1]} if self.traits else None,
            "secretMarked": self.secret is not None,
            "guesses": [{"playerId": pid, "x": sq[0], "y": sq[1]} for pid, sq in self.guesses.items()],
            # The secret only leaves the server (to everyone) once it's revealed.
            "reveal": (
                {"x": self.secret[0], "y": self.secret[1], "points": dict(self.points)}
                if shown and self.secret is not None
                else None
            ),
            "winners": list(self.winners),
            "canStart": self.can_start(),
            "minPlayers": MIN_PLAYERS_TO_START,
        }

    def secret_msg(self) -> dict | None:
        """Private to the main player: their own mark this turn."""
        if self.secret is None or self.phase not in ("guessing", "reveal"):
            return None
        return {"type": "secret", "turn": self.turn, "x": self.secret[0], "y": self.secret[1]}

    async def broadcast_state(self) -> None:
        await self._send_all(self.state_dict(), list(self.tv_conns) + list(self.player_conns.values()))

    async def send_private(self) -> None:
        msg = self.secret_msg()
        conn = self.player_conns.get(self.main_id or "")
        if msg is not None and conn is not None:
            await self._send_all(msg, [conn])

    @staticmethod
    async def _send_all(msg: dict, conns: list[Conn]) -> None:
        for conn in conns:
            try:
                await conn.send_json(msg)
            except Exception:
                pass  # the socket handler cleans up its own disconnects


class PsychRoomManager:
    def __init__(self) -> None:
        self.rooms: dict[str, PsychRoom] = {}
        self._tasks: dict[str, asyncio.Task] = {}

    def create_room(self) -> PsychRoom:
        if len(self.rooms) >= MAX_ROOMS:
            raise RoomLimitError()
        for _ in range(50):
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
            if code not in self.rooms:
                break
        else:
            raise RoomLimitError()
        room = PsychRoom(code)
        self.rooms[code] = room
        self._tasks[code] = asyncio.create_task(self._run(room))
        log.info("psych room created (%d active)", len(self.rooms))
        return room

    def get(self, raw_code: object) -> PsychRoom | None:
        code = normalize_code(raw_code)
        return self.rooms.get(code) if code else None

    def close_room(self, code: str) -> None:
        self.rooms.pop(code, None)
        task = self._tasks.pop(code, None)
        if task and task is not asyncio.current_task():
            task.cancel()

    async def _run(self, room: PsychRoom) -> None:
        try:
            while True:
                await asyncio.sleep(LOOP_SECONDS)
                if room.tick():
                    await room.broadcast_state()
                    await room.send_private()
                if not room.tv_conns and time.monotonic() - room.last_activity > ROOM_IDLE_SECONDS:
                    log.info("closing idle psych room")
                    self.close_room(room.code)
                    return
        except asyncio.CancelledError:
            pass
        except Exception:  # pragma: no cover - keep one room from killing others
            log.exception("psych room loop crashed")
            self.close_room(room.code)
