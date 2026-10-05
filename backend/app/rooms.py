"""Room and game-state management for Spirit Board.

A Room holds everything for one party session: players, the current round,
and the planchette. Game logic here is synchronous and clock-injectable so it
can be unit tested without sockets; RoomManager runs the async tick loop and
broadcasts state.
"""

from __future__ import annotations

import asyncio
import logging
import math
import random
import re
import secrets
import time
import unicodedata
from dataclasses import dataclass
from typing import Any, Callable, Protocol

from app import physics
from app.questions import DECK, YES_NO_SPOTS, Question

log = logging.getLogger(__name__)

MAX_PLAYERS = 10
MIN_PLAYERS_TO_START = 2
MAX_ROOMS = 20
QUESTION_SECONDS = 12.0  # read the question + place your secret bet
PULL_SECONDS = 20.0
POT_PER_PLAYER = 50  # playtest knob: pot = POT_PER_PLAYER x players
INPUT_STALE_SECONDS = 0.5
TICK_HZ = 30
PHONE_TICK_EVERY = 2  # phones get ticks at TICK_HZ / 2
ROOM_IDLE_SECONDS = 10 * 60  # close rooms with no TV for this long

# No vowels, so room codes can't spell anything rude. 20^4 = 160k codes.
CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ"
CODE_LENGTH = 4

# Letters (any language), digits, spaces, and a little punctuation.
NAME_RE = re.compile(r"[\w .'\-]{1,14}")

COLORS = [
    "#e8a33d",  # candle
    "#7fb069",  # slime
    "#d1495b",  # blood
    "#66a5ad",  # ghost
    "#c47ac0",  # potion
    "#f2e8cf",  # bone
    "#ef7b45",  # pumpkin
    "#5c80bc",  # moon
    "#a3b18a",  # moss
    "#e0a6a6",  # flesh
]

BOT_NAMES = [
    "Casper",
    "Bloody Mary",
    "Slimer",
    "Beetlejuice",
    "Mothman",
    "Chucky",
    "Wednesday",
    "Ghostface",
    "Pennywise",
    "The Nun",
]


class Conn(Protocol):
    async def send_json(self, data: Any) -> None: ...


class JoinError(Exception):
    """A player-facing reason a join was rejected."""


class RoomLimitError(Exception):
    pass


def normalize_name(raw: object) -> str:
    if not isinstance(raw, str):
        raise JoinError("Pick a name.")
    name = unicodedata.normalize("NFKC", raw)
    name = " ".join(name.split())
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
class Player:
    id: str
    name: str
    color: str
    is_bot: bool = False
    connected: bool = True
    pull: tuple[float, float] = (0.0, 0.0)
    pull_at: float = 0.0
    score: int = 0
    # Secret bet for the current round (a spot id), and whether the spirits
    # had to bet for them because they didn't.
    bet: str | None = None
    auto_bet: bool = False
    # Bot brain.
    bot_target: str | None = None
    bot_strength: float = 1.0
    bot_next_think: float = 0.0

    def to_dict(self, phase: str) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "color": self.color,
            "isBot": self.is_bot,
            "connected": self.connected,
            "score": self.score,
            # Only *whether* someone bet is public before the reveal.
            "hasBet": self.bet is not None if phase == "question" else None,
        }


class Room:
    def __init__(
        self,
        code: str,
        rng: random.Random | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.code = code
        self._rng = rng or random.Random(secrets.randbits(64))
        self._clock = clock
        self.players: dict[str, Player] = {}
        self.phase = "lobby"  # lobby | question | pull | reveal
        self.round_no = 0
        self.question: Question | None = None
        self.question_text = ""
        self.spots: list[physics.Spot] = []
        self.planchette = physics.Planchette()
        self.phase_ends_at = 0.0
        self.result_spot_id: str | None = None
        # Spirit Bets.
        self.pot = 0
        self.pot_bonus = 0  # the part of the pot that rolled over
        self.carryover = 0  # rolled-over pot waiting for the next round
        self.last_payout: dict[str, int] = {}
        self.last_rolled_over = False
        self._used_questions: set[int] = set()
        self._player_subject_history: set[str] = set()
        self.tv_conns: set[Conn] = set()
        self.player_conns: dict[str, Conn] = {}
        self.last_activity = clock()

    # ---- Players ---------------------------------------------------------

    def touch(self) -> None:
        self.last_activity = self._clock()

    def add_player(self, raw_name: object, is_bot: bool = False) -> Player:
        name = normalize_name(raw_name)
        for p in self.players.values():
            if p.name.casefold() == name.casefold():
                # Let a human who dropped (e.g. refreshed) rejoin by name.
                if not p.connected and not p.is_bot and not is_bot:
                    p.connected = True
                    return p
                raise JoinError("That name is taken.")
        if len(self.players) >= MAX_PLAYERS:
            raise JoinError("The s\u00e9ance is full.")
        used_colors = {p.color for p in self.players.values()}
        color = next(c for c in COLORS if c not in used_colors)
        player = Player(
            id=secrets.token_hex(4), name=name, color=color, is_bot=is_bot
        )
        self.players[player.id] = player
        self.touch()
        return player

    def remove_player(self, player_id: str) -> None:
        self.players.pop(player_id, None)

    def mark_disconnected(self, player_id: str) -> None:
        p = self.players.get(player_id)
        if p:
            p.connected = False
            p.pull = (0.0, 0.0)

    def add_bot(self) -> Player | None:
        taken = {p.name for p in self.players.values()}
        for name in BOT_NAMES:
            if name not in taken:
                try:
                    return self.add_player(name, is_bot=True)
                except JoinError:
                    return None
        return None

    def remove_bot(self) -> None:
        bots = [p.id for p in self.players.values() if p.is_bot]
        if bots:
            self.remove_player(bots[-1])

    # ---- Rounds ----------------------------------------------------------

    @property
    def can_start(self) -> bool:
        return (
            self.phase in ("lobby", "reveal")
            and len(self.players) >= MIN_PLAYERS_TO_START
        )

    def start_round(self) -> bool:
        if not self.can_start:
            return False
        self.question = self._pick_question()
        if self.question.kind == "who":
            labels = [(p.id, p.name) for p in self.players.values()]
            self.question_text = self.question.text
        else:
            labels = list(YES_NO_SPOTS)
            self.question_text = self.question.text.replace(
                "{player}", self._pick_subject()
            )
        self.spots = physics.layout_spots(labels)
        self.planchette.reset()
        self.result_spot_id = None
        self.last_payout = {}
        self.last_rolled_over = False
        self.pot = POT_PER_PLAYER * len(self.players) + self.carryover
        self.pot_bonus = self.carryover
        self.carryover = 0
        for p in self.players.values():
            p.pull = (0.0, 0.0)
            p.bet = None
            p.auto_bet = False
            p.bot_target = None
            p.bot_next_think = 0.0
        self.round_no += 1
        self.phase = "question"
        self.phase_ends_at = self._clock() + QUESTION_SECONDS
        self.touch()
        return True

    def back_to_lobby(self) -> None:
        self.phase = "lobby"
        self.question = None
        self.question_text = ""
        self.spots = []
        self.result_spot_id = None
        self.planchette.reset()

    def reset_scores(self) -> None:
        if self.phase != "lobby":
            return
        for p in self.players.values():
            p.score = 0
        self.carryover = 0
        self.round_no = 0

    def place_bet(self, player_id: str, spot_id: object) -> bool:
        """Records (or changes) a secret bet. Only allowed before the pull."""
        p = self.players.get(player_id)
        if p is None or p.is_bot or self.phase != "question":
            return False
        if not isinstance(spot_id, str) or not any(s.id == spot_id for s in self.spots):
            return False
        p.bet = spot_id
        p.auto_bet = False
        return True

    def set_pull(self, player_id: str, dx: object, dy: object) -> None:
        p = self.players.get(player_id)
        if p is None or p.is_bot or self.phase != "pull":
            return
        p.pull = physics.sanitize_pull(dx, dy)
        p.pull_at = self._clock()

    def tick(self, dt: float) -> bool:
        """Advances the game by dt seconds. Returns True if phase changed."""
        now = self._clock()
        if self.phase == "question" and now >= self.phase_ends_at:
            self._lock_bets()
            self.phase = "pull"
            self.phase_ends_at = now + PULL_SECONDS
            return True
        if self.phase != "pull":
            return False

        self._think_bots(now)
        pulls = []
        for p in self.players.values():
            if p.is_bot:
                pulls.append(p.pull)
            elif p.connected and now - p.pull_at <= INPUT_STALE_SECONDS:
                pulls.append(p.pull)
            else:
                # Players not touching the pad still count toward 1/sqrt(n),
                # so idle players act like a little friction.
                pulls.append((0.0, 0.0))
        force = physics.combine_pulls(pulls)
        locked = physics.step(self.planchette, force, dt, self.spots)
        if locked is None and now >= self.phase_ends_at:
            spot, _ = physics.nearest_spot(self.planchette, self.spots)
            locked = spot.id if spot else None
        if locked is not None:
            self._finish_round(locked)
            return True
        return False

    def _finish_round(self, spot_id: str) -> None:
        self.result_spot_id = spot_id
        spot = next(s for s in self.spots if s.id == spot_id)
        self.planchette.x, self.planchette.y = spot.x, spot.y
        self.planchette.vx = self.planchette.vy = 0.0
        self.planchette.fx = self.planchette.fy = 0.0
        self.planchette.hover_spot = spot_id
        self.planchette.hover_time = physics.LOCK_SECONDS
        self._pay_out(spot_id)
        self.phase = "reveal"

    def _lock_bets(self) -> None:
        """Bets close when the pull starts. The spirits bet for stragglers."""
        if not self.spots:
            return
        for p in self.players.values():
            if p.bet is None:
                p.bet = self._rng.choice(self.spots).id
                p.auto_bet = not p.is_bot

    def _pay_out(self, spot_id: str) -> None:
        winners = [p for p in self.players.values() if p.bet == spot_id]
        if not winners:
            # "The spirits keep the candy": the pot rolls into the next round.
            self.carryover = self.pot
            self.last_rolled_over = True
            self.last_payout = {}
            return
        share = self.pot // len(winners)
        self.last_payout = {p.id: share for p in winners}
        for p in winners:
            p.score += share
        self.last_rolled_over = False

    def _pick_question(self) -> Question:
        available = [i for i in range(len(DECK)) if i not in self._used_questions]
        if not available:
            self._used_questions.clear()
            available = list(range(len(DECK)))
        idx = self._rng.choice(available)
        self._used_questions.add(idx)
        return DECK[idx]

    def _pick_subject(self) -> str:
        humans = [p.name for p in self.players.values() if not p.is_bot]
        pool = humans or [p.name for p in self.players.values()]
        fresh = [n for n in pool if n not in self._player_subject_history]
        if not fresh:
            self._player_subject_history.clear()
            fresh = pool
        name = self._rng.choice(fresh)
        self._player_subject_history.add(name)
        return name

    def _think_bots(self, now: float) -> None:
        for p in self.players.values():
            if not p.is_bot:
                continue
            if p.bot_target is None or now >= p.bot_next_think:
                # Mostly fight for their own bet; sometimes wander off.
                if p.bet and self._rng.random() < 0.75:
                    p.bot_target = p.bet
                else:
                    p.bot_target = self._rng.choice(self.spots).id if self.spots else None
                p.bot_strength = self._rng.uniform(0.5, 1.0)
                p.bot_next_think = now + self._rng.uniform(2.0, 5.0)
            target = next((s for s in self.spots if s.id == p.bot_target), None)
            if target is None:
                p.pull = (0.0, 0.0)
                continue
            dx = target.x - self.planchette.x
            dy = target.y - self.planchette.y
            d = math.hypot(dx, dy) or 1.0
            jitter = self._rng.uniform(-0.35, 0.35)
            c, s = math.cos(jitter), math.sin(jitter)
            ux, uy = dx / d, dy / d
            p.pull = (
                (ux * c - uy * s) * p.bot_strength,
                (ux * s + uy * c) * p.bot_strength,
            )

    # ---- Serialization ---------------------------------------------------

    def state_dict(self) -> dict:
        now = self._clock()
        ends_in = (
            max(0.0, self.phase_ends_at - now)
            if self.phase in ("question", "pull")
            else None
        )
        return {
            "type": "state",
            "code": self.code,
            "phase": self.phase,
            "roundNo": self.round_no,
            "players": [p.to_dict(self.phase) for p in self.players.values()],
            "question": (
                {"kind": self.question.kind, "text": self.question_text}
                if self.question
                else None
            ),
            "spots": [s.to_dict() for s in self.spots],
            "phaseEndsIn": ends_in,
            "resultSpotId": self.result_spot_id,
            "pot": self.pot,
            "potBonus": self.pot_bonus,
            "carryover": self.carryover,
            "reveal": self._reveal_dict() if self.phase == "reveal" else None,
            "canStart": self.can_start,
            "minPlayers": MIN_PLAYERS_TO_START,
            "maxPlayers": MAX_PLAYERS,
            "board": {"w": physics.BOARD_W, "h": physics.BOARD_H},
            "planchette": self._planchette_dict(),
        }

    def _reveal_dict(self) -> dict:
        return {
            "bets": {p.id: p.bet for p in self.players.values() if p.bet},
            "autoBets": [p.id for p in self.players.values() if p.auto_bet],
            "payout": self.last_payout,
            "rolledOver": self.last_rolled_over,
        }

    def tick_dict(self) -> dict:
        return {"type": "tick", **self._planchette_dict()}

    def _planchette_dict(self) -> dict:
        p = self.planchette
        now = self._clock()
        return {
            "x": round(p.x, 4),
            "y": round(p.y, 4),
            "fx": round(p.fx, 3),
            "fy": round(p.fy, 3),
            "hoverSpot": p.hover_spot,
            "lockProgress": round(p.lock_progress, 3),
            "timeLeft": (
                round(max(0.0, self.phase_ends_at - now), 2)
                if self.phase == "pull"
                else None
            ),
        }

    # ---- Broadcasting ----------------------------------------------------

    async def broadcast_state(self) -> None:
        await self._send_all(self.state_dict(), list(self.tv_conns), list(self.player_conns.values()))

    async def broadcast_tick(self, include_phones: bool) -> None:
        phones = list(self.player_conns.values()) if include_phones else []
        await self._send_all(self.tick_dict(), list(self.tv_conns), phones)

    def bet_msg(self, player: Player) -> dict:
        """A player's own bet. Only ever sent to that player's phone."""
        return {
            "type": "bet_ok",
            "spotId": player.bet,
            "roundNo": self.round_no,
            "auto": player.auto_bet,
        }

    async def send_auto_bets(self) -> None:
        """Tells phones the spirits bet for them (bets are secret until reveal)."""
        for pid, conn in list(self.player_conns.items()):
            p = self.players.get(pid)
            if p and p.auto_bet and p.bet:
                try:
                    await conn.send_json(self.bet_msg(p))
                except Exception:
                    log.debug("auto-bet send failed")

    @staticmethod
    async def _send_all(msg: dict, *groups: list[Conn]) -> None:
        conns = [c for g in groups for c in g]
        if not conns:
            return
        results = await asyncio.gather(
            *(c.send_json(msg) for c in conns), return_exceptions=True
        )
        # Dead sockets are cleaned up by their own receive loops.
        failures = sum(1 for r in results if isinstance(r, Exception))
        if failures:
            log.debug("broadcast: %d send failures", failures)


class RoomManager:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}
        self._tasks: dict[str, asyncio.Task] = {}

    def create_room(self) -> Room:
        if len(self.rooms) >= MAX_ROOMS:
            raise RoomLimitError()
        for _ in range(50):
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
            if code not in self.rooms:
                break
        else:
            raise RoomLimitError()
        room = Room(code)
        self.rooms[code] = room
        self._tasks[code] = asyncio.create_task(self._run(room))
        log.info("room created (%d active)", len(self.rooms))
        return room

    def get(self, raw_code: object) -> Room | None:
        code = normalize_code(raw_code)
        return self.rooms.get(code) if code else None

    def close_room(self, code: str) -> None:
        self.rooms.pop(code, None)
        task = self._tasks.pop(code, None)
        if task and task is not asyncio.current_task():
            task.cancel()

    async def _run(self, room: Room) -> None:
        dt = 1.0 / TICK_HZ
        n = 0
        last = time.monotonic()
        try:
            while True:
                await asyncio.sleep(dt)
                now = time.monotonic()
                elapsed = min(now - last, 0.1)  # don't teleport after a stall
                last = now
                changed = room.tick(elapsed)
                if changed:
                    await room.broadcast_state()
                    if room.phase == "pull":
                        await room.send_auto_bets()
                if room.phase == "pull":
                    n += 1
                    await room.broadcast_tick(include_phones=n % PHONE_TICK_EVERY == 0)
                if not room.tv_conns and now - room.last_activity > ROOM_IDLE_SECONDS:
                    log.info("closing idle room")
                    self.close_room(room.code)
                    return
        except asyncio.CancelledError:
            pass
        except Exception:  # pragma: no cover - keep one room from killing others
            log.exception("room loop crashed")
            self.close_room(room.code)
