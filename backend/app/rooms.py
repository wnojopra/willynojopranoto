"""Room and game-state management for Spirit Board.

A Room holds everything for one party session: players, the current game and
round, and the planchette. Game logic here is synchronous and clock-injectable
so it can be unit tested without sockets; RoomManager runs the async tick loop
and broadcasts state.

Round kinds:
  bets   - Spirit Bets: everyone secretly bets, winners split the pot.
  medium - The Medium: one player answers privately, the rest guess and pull.
  final  - Final Séance: Spirit Bets with a 3x pot.
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

from app import game, physics
from app.questions import DECK, FINAL_QUESTION, MEDIUM_DECK, YES_NO_SPOTS, Question

log = logging.getLogger(__name__)

MAX_PLAYERS = 10
MIN_PLAYERS_TO_START = 2
MIN_PLAYERS_FOR_MEDIUM = 3  # the Medium plus at least two guessers
MAX_ROOMS = 20
QUESTION_SECONDS = 12.0  # read the question + place your secret bet
MEDIUM_ANSWER_SECONDS = 15.0
GUESS_SECONDS = 10.0
ALL_IN_SECONDS = 2.5  # once everyone has bet, cut the timer down to this
PULL_SECONDS = 20.0
POT_PER_PLAYER = 50  # playtest knob: pot = POT_PER_PLAYER x players
FINAL_POT_MULTIPLIER = 3
MEDIUM_CORRECT_POINTS = 100  # each correct guess
MEDIUM_BOARD_POINTS = 100  # everyone, if the board lands on the Medium's answer
MEDIUM_PER_GUESSER_POINTS = 50  # to the Medium, per correct guesser
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
    # Secret bet (or Medium-round guess) for the current round, as a spot id,
    # and whether the spirits had to pick it because they didn't.
    bet: str | None = None
    auto_bet: bool = False
    # Per-game stats for awards.
    haunted: int = 0
    solo_wins: int = 0
    mind_reads: int = 0
    open_book: int = 0
    liar_rounds: int = 0
    pull_effort: float = 0.0
    # Per-round pull tracking (toward vs. away from your own bet).
    round_toward: float = 0.0
    round_effort: float = 0.0
    # Bot brain.
    bot_target: str | None = None
    bot_strength: float = 1.0
    bot_next_think: float = 0.0

    def reset_stats(self) -> None:
        self.score = 0
        self.haunted = self.solo_wins = self.mind_reads = 0
        self.open_book = self.liar_rounds = 0
        self.pull_effort = 0.0

    def to_dict(self, phase: str) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "color": self.color,
            "isBot": self.is_bot,
            "connected": self.connected,
            "score": self.score,
            "haunted": self.haunted,
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
        self.phase = "lobby"  # lobby | medium | question | pull | reveal | results
        self.round_no = 0  # session-wide counter (never resets)
        self.question: Question | None = None
        self.question_text = ""
        self.spots: list[physics.Spot] = []
        self.planchette = physics.Planchette()
        self.phase_ends_at = 0.0
        self.result_spot_id: str | None = None
        # Game.
        self.game_length = game.DEFAULT_LENGTH
        self.plan: list[str] = []
        self.game_round = 0  # rounds started in the current game
        self.game_active = False
        self.round_kind = "bets"
        self.awards: list[dict] = []
        # Medium rounds.
        self.medium_id: str | None = None
        self.medium_answer: str | None = None
        self.medium_auto = False
        self._used_mediums: set[str] = set()
        self.last_correct: list[str] = []
        self.last_board_matched = False
        # Spirit Bets.
        self.pot = 0
        self.pot_bonus = 0  # the part of the pot that rolled over
        self.carryover = 0  # rolled-over pot waiting for the next round
        self.last_payout: dict[str, int] = {}
        self.last_rolled_over = False
        self._used_questions: set[Question] = set()
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
        if player_id == self.medium_id and self.phase == "medium":
            # The Medium left before answering: the spirits answer for them.
            self._auto_answer()

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

    # ---- Game ------------------------------------------------------------

    def set_length(self, length: object) -> None:
        if self.phase == "lobby" and not self.game_active and length in game.LENGTHS:
            self.game_length = length  # type: ignore[assignment]

    @property
    def total_rounds(self) -> int:
        return len(self.plan)

    @property
    def can_start(self) -> bool:
        return (
            self.phase in ("lobby", "reveal")
            and len(self.players) >= MIN_PLAYERS_TO_START
        )

    def new_game(self) -> bool:
        """Starts a fresh game (scores and stats reset) with round 1."""
        if self.phase not in ("lobby", "reveal", "results"):
            return False
        if len(self.players) < MIN_PLAYERS_TO_START:
            return False
        for p in self.players.values():
            p.reset_stats()
        self.plan = game.make_plan(self.game_length)
        self.game_round = 0
        self.game_active = True
        self.carryover = 0
        self.awards = []
        self._used_mediums.clear()
        self.phase = "lobby"
        return self.start_round()

    def start_round(self) -> bool:
        """Starts the next round of the current game, or shows results."""
        if not self.game_active:
            return self.new_game()
        if not self.can_start:
            return False
        if self.game_round >= self.total_rounds:
            self._show_results()
            return True

        kind = self.plan[self.game_round]
        medium = self._pick_medium() if kind == "medium" else None
        if kind == "medium" and medium is None:
            kind = "bets"  # not enough players for a Medium round right now

        self.round_kind = kind
        self.medium_id = medium.id if medium else None
        self.medium_answer = None
        self.medium_auto = False
        self.last_correct = []
        self.last_board_matched = False
        if medium:
            self._used_mediums.add(medium.id)

        if kind == "final":
            self.question = FINAL_QUESTION
        else:
            self.question = self._pick_question(MEDIUM_DECK if medium else DECK)
        self.question_text = self.question.text
        if "{player}" in self.question_text:
            self.question_text = self.question_text.replace("{player}", self._pick_subject())
        self.spots = physics.layout_spots(self._labels_for(self.question))

        self.planchette.reset()
        self.result_spot_id = None
        self.last_payout = {}
        self.last_rolled_over = False
        base = POT_PER_PLAYER * len(self.players)
        if kind == "medium":
            self.pot = 0  # Medium rounds score separately; any rollover waits.
            self.pot_bonus = 0
        else:
            mult = FINAL_POT_MULTIPLIER if kind == "final" else 1
            self.pot = base * mult + self.carryover
            self.pot_bonus = self.carryover
            self.carryover = 0

        now = self._clock()
        for p in self.players.values():
            p.pull = (0.0, 0.0)
            p.bet = None
            p.auto_bet = False
            p.round_toward = p.round_effort = 0.0
            p.bot_target = None
            p.bot_next_think = 0.0
        if medium and medium.is_bot:
            medium.bot_next_think = now + self._rng.uniform(2.0, 4.0)

        self.round_no += 1
        self.game_round += 1
        if medium:
            self.phase = "medium"
            self.phase_ends_at = now + MEDIUM_ANSWER_SECONDS
        else:
            self.phase = "question"
            self.phase_ends_at = now + QUESTION_SECONDS
        self.touch()
        return True

    def back_to_lobby(self) -> None:
        if self.phase in ("medium", "question", "pull"):
            # Abandon the round in progress: it will be replayed, and any
            # rolled-over candy goes back into the pile.
            self.game_round = max(0, self.game_round - 1)
            self.carryover += self.pot_bonus
            if self.medium_id:
                self._used_mediums.discard(self.medium_id)
        if self.phase == "results":
            self.game_active = False
        self.phase = "lobby"
        self.question = None
        self.question_text = ""
        self.spots = []
        self.result_spot_id = None
        self.medium_id = None
        self.planchette.reset()

    def _show_results(self) -> None:
        self.awards = game.compute_awards(self.players.values())
        self.phase = "results"
        self.game_active = False
        self.question = None
        self.question_text = ""
        self.spots = []
        self.result_spot_id = None
        self.medium_id = None

    def _labels_for(self, q: Question) -> list[tuple[str, str]]:
        if q.kind == "who":
            return [(p.id, p.name) for p in self.players.values() if p.id != self.medium_id]
        if q.kind == "pick":
            return [(f"opt{i}", label) for i, label in enumerate(q.options)]
        return list(YES_NO_SPOTS)

    # ---- Player actions --------------------------------------------------

    def place_bet(self, player_id: str, spot_id: object) -> bool:
        """Records (or changes) a secret bet / guess. Only before the pull."""
        p = self.players.get(player_id)
        if p is None or p.is_bot or self.phase != "question" or p.id == self.medium_id:
            return False
        if not self._valid_spot(spot_id):
            return False
        p.bet = spot_id  # type: ignore[assignment]
        p.auto_bet = False
        bettors = [x for x in self._bettors() if not x.is_bot and x.connected]
        if all(x.bet is not None for x in bettors):
            # Everyone's in: don't make them stare at the timer.
            self.phase_ends_at = min(self.phase_ends_at, self._clock() + ALL_IN_SECONDS)
        return True

    def medium_answers(self, player_id: str, spot_id: object) -> bool:
        if self.phase != "medium" or player_id != self.medium_id:
            return False
        if not self._valid_spot(spot_id):
            return False
        self.medium_answer = spot_id  # type: ignore[assignment]
        self.medium_auto = False
        self._begin_guessing()
        return True

    def set_pull(self, player_id: str, dx: object, dy: object) -> None:
        p = self.players.get(player_id)
        if p is None or p.is_bot or self.phase != "pull" or p.id == self.medium_id:
            return
        p.pull = physics.sanitize_pull(dx, dy)
        p.pull_at = self._clock()

    def _valid_spot(self, spot_id: object) -> bool:
        return isinstance(spot_id, str) and any(s.id == spot_id for s in self.spots)

    def _bettors(self) -> list[Player]:
        """Everyone who bets/guesses this round (not the Medium)."""
        return [p for p in self.players.values() if p.id != self.medium_id]

    # ---- Clock -----------------------------------------------------------

    def tick(self, dt: float) -> bool:
        """Advances the game by dt seconds. Returns True if phase changed."""
        now = self._clock()
        if self.phase == "medium":
            medium = self.players.get(self.medium_id or "")
            if medium and medium.is_bot and now >= medium.bot_next_think:
                return self.medium_answers(medium.id, self._rng.choice(self.spots).id)
            if now >= self.phase_ends_at:
                self._auto_answer()
                return True
            return False
        if self.phase == "question" and now >= self.phase_ends_at:
            self._lock_bets()
            self.phase = "pull"
            self.phase_ends_at = now + PULL_SECONDS
            return True
        if self.phase != "pull":
            return False

        self._think_bots(now)
        pulls = []
        for p in self._bettors():
            if p.is_bot or (p.connected and now - p.pull_at <= INPUT_STALE_SECONDS):
                pulls.append(p.pull)
                self._track_pull(p, dt)
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

    def _auto_answer(self) -> None:
        if self.phase != "medium" or not self.spots:
            return
        self.medium_answer = self._rng.choice(self.spots).id
        self.medium_auto = True
        self._begin_guessing()

    def _begin_guessing(self) -> None:
        self.phase = "question"
        self.phase_ends_at = self._clock() + GUESS_SECONDS

    def _track_pull(self, p: Player, dt: float) -> None:
        mag = math.hypot(*p.pull)
        if mag <= 0:
            return
        p.round_effort += mag * dt
        target = next((s for s in self.spots if s.id == p.bet), None)
        if target is None:
            return
        dx, dy = target.x - self.planchette.x, target.y - self.planchette.y
        d = math.hypot(dx, dy)
        if d > 1e-6:
            p.round_toward += (p.pull[0] * dx + p.pull[1] * dy) / d * dt

    def _finish_round(self, spot_id: str) -> None:
        self.result_spot_id = spot_id
        spot = next(s for s in self.spots if s.id == spot_id)
        self.planchette.x, self.planchette.y = spot.x, spot.y
        self.planchette.vx = self.planchette.vy = 0.0
        self.planchette.fx = self.planchette.fy = 0.0
        self.planchette.hover_spot = spot_id
        self.planchette.hover_time = physics.LOCK_SECONDS
        haunted = self.players.get(spot_id)
        if haunted:
            haunted.haunted += 1
        for p in self.players.values():
            p.pull_effort += p.round_effort
            # Pulled meaningfully, and mostly *away* from their own bet.
            if p.round_effort > 1.0 and p.round_toward < -0.25 * p.round_effort:
                p.liar_rounds += 1
        if self.round_kind == "medium":
            self._score_medium(spot_id)
        else:
            self._pay_out(spot_id)
        self.phase = "reveal"

    def _lock_bets(self) -> None:
        """Bets close when the pull starts. The spirits bet for stragglers."""
        if not self.spots:
            return
        for p in self._bettors():
            if p.bet is None:
                p.bet = self._rng.choice(self.spots).id
                p.auto_bet = not p.is_bot

    def _pay_out(self, spot_id: str) -> None:
        winners = [p for p in self._bettors() if p.bet == spot_id]
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
        if len(winners) == 1:
            winners[0].solo_wins += 1
        self.last_rolled_over = False

    def _score_medium(self, spot_id: str) -> None:
        correct = [p for p in self._bettors() if p.bet == self.medium_answer]
        matched = spot_id == self.medium_answer
        payout: dict[str, int] = {}
        for p in correct:
            payout[p.id] = payout.get(p.id, 0) + MEDIUM_CORRECT_POINTS
            p.mind_reads += 1
        if matched:
            for p in self.players.values():
                payout[p.id] = payout.get(p.id, 0) + MEDIUM_BOARD_POINTS
        medium = self.players.get(self.medium_id or "")
        if medium:
            if correct:
                payout[medium.id] = payout.get(medium.id, 0) + MEDIUM_PER_GUESSER_POINTS * len(correct)
            medium.open_book = max(medium.open_book, len(correct))
        for pid, pts in payout.items():
            self.players[pid].score += pts
        self.last_payout = payout
        self.last_correct = [p.id for p in correct]
        self.last_board_matched = matched
        self.last_rolled_over = False

    def _pick_medium(self) -> Player | None:
        if len(self.players) < MIN_PLAYERS_FOR_MEDIUM:
            return None
        fresh = [p for p in self.players.values() if p.id not in self._used_mediums]
        humans = [p for p in fresh if not p.is_bot and p.connected]
        pool = humans or fresh
        if not pool:
            pool = [p for p in self.players.values() if not p.is_bot and p.connected]
        return self._rng.choice(pool) if pool else None

    def _pick_question(self, deck: list[Question]) -> Question:
        available = [q for q in deck if q not in self._used_questions]
        if not available:
            self._used_questions -= set(deck)
            available = list(deck)
        q = self._rng.choice(available)
        self._used_questions.add(q)
        return q

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
        for p in self._bettors():
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
            if self.phase in ("medium", "question", "pull")
            else None
        )
        in_round = self.phase in ("medium", "question", "pull", "reveal")
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
            "game": {
                "length": self.game_length,
                "lengths": {k: v for k, v in game.LENGTHS.items()},
                "active": self.game_active,
                "round": self.game_round,
                "totalRounds": self.total_rounds,
                "roundKind": self.round_kind if in_round else None,
                "isLastRound": self.game_active and self.game_round >= self.total_rounds,
            },
            "medium": (
                {"playerId": self.medium_id, "answered": self.medium_answer is not None}
                if self.medium_id and in_round
                else None
            ),
            "awards": self.awards if self.phase == "results" else None,
            "canStart": self.can_start,
            "minPlayers": MIN_PLAYERS_TO_START,
            "maxPlayers": MAX_PLAYERS,
            "board": {"w": physics.BOARD_W, "h": physics.BOARD_H},
            "planchette": self._planchette_dict(),
        }

    def _reveal_dict(self) -> dict:
        out: dict[str, Any] = {
            "bets": {p.id: p.bet for p in self.players.values() if p.bet},
            "autoBets": [p.id for p in self.players.values() if p.auto_bet],
            "payout": self.last_payout,
            "rolledOver": self.last_rolled_over,
        }
        if self.round_kind == "medium":
            out["mediumAnswer"] = self.medium_answer
            out["mediumAuto"] = self.medium_auto
            out["correct"] = self.last_correct
            out["boardMatched"] = self.last_board_matched
        return out

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

    def answer_msg(self) -> dict:
        """The Medium's secret answer. Only ever sent to the Medium's phone."""
        return {
            "type": "answer_ok",
            "spotId": self.medium_answer,
            "roundNo": self.round_no,
            "auto": self.medium_auto,
        }

    async def send_private(self) -> None:
        """Tells phones what the spirits picked for them (secret until reveal)."""
        for pid, conn in list(self.player_conns.items()):
            p = self.players.get(pid)
            msg = None
            if p and p.auto_bet and p.bet and self.phase == "pull":
                msg = self.bet_msg(p)
            elif pid == self.medium_id and self.medium_auto and self.phase == "question":
                msg = self.answer_msg()
            if msg:
                try:
                    await conn.send_json(msg)
                except Exception:
                    log.debug("private send failed")

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
                    await room.send_private()
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
