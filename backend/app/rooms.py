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
import hmac
import logging
import math
import random
import re
import secrets
import time
import unicodedata
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

from app import game, physics, relics
from app.curses import CURSE_DECK, FINAL_CURSES
from app.questions import DECK, FINAL_DECK, MEDIUM_DECK, YES_NO_SPOTS, Question

log = logging.getLogger(__name__)

RELIC_CATALOG_DICT = {k: r.to_dict() for k, r in relics.CATALOG.items()}

MAX_PLAYERS = 10
MIN_PLAYERS_TO_START = 2
MIN_PLAYERS_FOR_MEDIUM = 3  # the Medium plus at least two guessers
MAX_ROOMS = 20
QUESTION_SECONDS = 12.0  # read the question + place your secret bet
MEDIUM_ANSWER_SECONDS = 15.0
GUESS_SECONDS = 10.0
ALL_IN_SECONDS = 2.5  # once everyone has bet, cut the timer down to this
PULL_SECONDS = 20.0
# Practice round (before round 1, on by default): slower, no points, no Relics.
PRACTICE_DEFAULT = True
PRACTICE_QUESTION = Question("yesno", "Practice: Is this house haunted?")
PRACTICE_QUESTION_SECONDS = 30.0
PRACTICE_ALL_IN_SECONDS = 5.0
PRACTICE_PULL_SECONDS = 30.0
# If the pull times out with the planchette this close to where it started,
# nobody really chose: a random answer wins (board units; the ring is ~0.36-0.62 out).
TIMEOUT_RANDOM_RADIUS = 0.18
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
    # Relics: inventory (keys; duplicates allowed) and the round they last
    # used one in. Private to the owner's phone.
    relics: list[str] = field(default_factory=list)
    relic_round: int = -1
    relics_dirty: bool = False
    # This game's starter Relic, while unused. It expires when a new game starts
    # (hunt-found Relics carry over between games; starters don't).
    starter: str | None = None
    # Catch-up Relics dealt this game (design doc §6.6). They expire like starters.
    catchup: list[str] = field(default_factory=list)
    # The phone's device id (its seat is tied to it), the hunt Relics still in
    # `relics` (spent last, so they carry over), and spent ones to remove from
    # the hunt store (main.py drains this).
    device: str | None = None
    hunt_loaded: bool = False
    hunt: list[str] = field(default_factory=list)
    hunt_spent: list[str] = field(default_factory=list)
    # Relic effects on this player, for the current round.
    mirrored: bool = False
    frozen_until: float = 0.0
    double_down: bool = False
    crystal: bool = False
    crystal_crossed: tuple[str, ...] = ()
    grip_until: float = 0.0
    pact_with: str | None = None  # Blood Pact partner (we also win what they win)
    bet_dirty: bool = False  # bet changed by a Relic: tell the owner's phone

    def reset_round_effects(self) -> None:
        self.mirrored = False
        self.frozen_until = 0.0
        self.double_down = False
        self.crystal = False
        self.crystal_crossed = ()
        self.grip_until = 0.0
        self.pact_with = None
        self.bet_dirty = False

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
        # Host custom questions (loaded from the store when a game starts).
        self.custom_bets: list[Question] = []
        self.custom_medium: list[Question] = []
        self.custom_final: list[Question] = []
        self.always_questions: set[Question] = set()
        self._player_subject_history: set[str] = set()
        # Curses: the card the board dealt at the last reveal, which stays in
        # force until the next reveal.
        self.curses_on = True
        self.curse: dict | None = None
        self.final_curse: dict | None = None
        self._curse_order: list[int] = []
        # Relics.
        self.starter_relics = True  # deal one per player per game (no hunt yet)
        self.catchup_relics = True  # last place after rounds 3 and 6 gets a free Common
        self.practice_on = PRACTICE_DEFAULT  # a no-stakes practice round before round 1
        self._practice_pending = False
        self._catchup_done: set[int] = set()  # game rounds already handled this game
        self.last_catchup: dict[str, str] = {}  # player id -> Relic, this reveal (private keys)
        self.salted: set[str] = set()
        self.magnets: list[str] = []  # spot ids; stacking allowed
        self.shuffle_at: float | None = None  # Ouija Shuffle pending (clock time)
        self._trail: deque[tuple[float, float, float]] = deque()  # (t, x, y) for Séance Rewind
        self.last_pact_gains: dict[str, int] = {}
        self.relic_events: list[dict] = []  # this round, for the TV
        self._relic_seq = 0
        self.tv_conns: set[Conn] = set()
        self.player_conns: dict[str, Conn] = {}
        # The device cookie of the browser that created the room. Only it may
        # reattach a TV after a refresh.
        self.host_device: str | None = None
        self.last_activity = clock()

    # ---- Players ---------------------------------------------------------

    def touch(self) -> None:
        self.last_activity = self._clock()

    def is_host(self, device: str | None) -> bool:
        return bool(device and self.host_device) and hmac.compare_digest(device, self.host_device)

    def add_player(self, raw_name: object, is_bot: bool = False, device: str | None = None) -> Player:
        name = normalize_name(raw_name)
        for p in self.players.values():
            if p.name.casefold() == name.casefold():
                if p.is_bot or is_bot:
                    raise JoinError("That name is taken.")
                if p.device is not None:
                    # Seats belong to the phone that took them, so nobody can
                    # rejoin as someone else (and spend their Relics). The same
                    # phone may take its seat back even before its old socket
                    # has noticed it's gone (a refresh).
                    if device is not None and hmac.compare_digest(device, p.device):
                        p.connected = True
                        p.relics_dirty = True
                        return p
                    raise JoinError("That name is taken. On a new phone? Add a letter to your name.")
                # No device cookie (local dev / tests): rejoin by name once they've dropped.
                if not p.connected:
                    p.connected = True
                    p.relics_dirty = True
                    return p
                raise JoinError("That name is taken.")
        if len(self.players) >= MAX_PLAYERS:
            raise JoinError("The s\u00e9ance is full.")
        used_colors = {p.color for p in self.players.values()}
        color = next(c for c in COLORS if c not in used_colors)
        player = Player(
            id=secrets.token_hex(4), name=name, color=color, is_bot=is_bot,
            device=None if is_bot else device,
        )
        self.players[player.id] = player
        if self.game_active and self.starter_relics and not is_bot:
            self._deal_starter(player)
        self.touch()
        return player

    def _grant(self, p: Player, key: str) -> None:
        p.relics.append(key)
        p.relics_dirty = True

    def _deal_starter(self, p: Player) -> None:
        key = relics.starter_relic(self._rng)
        self._grant(p, key)
        p.starter = key

    def _expire_starter(self, p: Player) -> None:
        """Takes back last game's unused starter and catch-up Relics (hunt copies stay)."""
        for s in ([p.starter] if p.starter else []) + p.catchup:
            if p.relics.count(s) > p.hunt.count(s):
                p.relics.remove(s)
                p.relics_dirty = True
        p.starter = None
        p.catchup = []

    def load_hunt_relics(self, p: Player, device: str, keys: list[str]) -> None:
        """Brings a phone's scavenger-hunt Relics into the game (once per player)."""
        if p.is_bot or p.hunt_loaded:
            return
        p.hunt_loaded = True
        p.device = device
        for key in keys:
            if key in relics.CATALOG:
                self._grant(p, key)
                p.hunt.append(key)

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

    def set_curses(self, on: object) -> None:
        if isinstance(on, bool):
            self.curses_on = on
            if not on:
                self.curse = None

    def set_practice(self, on: object) -> None:
        if isinstance(on, bool):
            self.practice_on = on

    def set_catchup_relics(self, on: object) -> None:
        if isinstance(on, bool):
            self.catchup_relics = on

    def set_custom_questions(self, items: list[tuple[str, Question, bool]]) -> None:
        """(deck, question, always) from the admin page. Takes effect at the next pick."""
        self.custom_bets = [q for deck, q, _ in items if deck == "bets"]
        self.custom_medium = [q for deck, q, _ in items if deck == "medium"]
        self.custom_final = [q for deck, q, _ in items if deck == "final"]
        self.always_questions = {q for _, q, always in items if always}

    def set_starter_relics(self, on: object) -> None:
        if isinstance(on, bool):
            self.starter_relics = on

    def dev_grant_all(self) -> None:
        """Playtesting: every human gets one of each Relic."""
        for p in self.players.values():
            if not p.is_bot:
                for key in relics.CATALOG:
                    self._grant(p, key)

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
        self.curse = None
        self.final_curse = None
        self._used_mediums.clear()
        self._catchup_done.clear()
        for p in self.players.values():
            self._expire_starter(p)
        if self.starter_relics:
            for p in self.players.values():
                if not p.is_bot:
                    self._deal_starter(p)
        self.phase = "lobby"
        self._practice_pending = self.practice_on
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

        practice = self._practice_pending
        self._practice_pending = False
        kind = "practice" if practice else self.plan[self.game_round]
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

        if practice:
            self.question = PRACTICE_QUESTION
        elif kind == "final":
            self.question = self._pick_final()
        else:
            self.question = (
                self._pick_question(MEDIUM_DECK, self.custom_medium, "medium")
                if medium
                else self._pick_question(DECK, self.custom_bets, "bets")
            )
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
        elif practice:
            self.pot = base  # shown, never paid; any rollover waits for round 1
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
            p.reset_round_effects()
        self.salted.clear()
        self.magnets.clear()
        self.shuffle_at = None
        self._trail.clear()
        self.last_pact_gains = {}
        self.relic_events = []
        self.last_catchup = {}
        if medium and medium.is_bot:
            medium.bot_next_think = now + self._rng.uniform(2.0, 4.0)

        self.round_no += 1
        if not practice:
            self.game_round += 1
        if medium:
            self.phase = "medium"
            self.phase_ends_at = now + MEDIUM_ANSWER_SECONDS
        else:
            self.phase = "question"
            self.phase_ends_at = now + (PRACTICE_QUESTION_SECONDS if practice else QUESTION_SECONDS)
        self.touch()
        return True

    def back_to_lobby(self) -> None:
        if self.round_kind == "practice" and self.phase in ("question", "pull"):
            pass  # practice never counted as a round
        elif self.phase in ("medium", "question", "pull"):
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
        self.shuffle_at = None
        self.planchette.reset()

    def restart_game(self) -> None:
        """Throws the current game away from any phase: everyone back to 0 in the
        lobby, so late joiners can get in level. The host presses Start again."""
        self.back_to_lobby()
        for p in self.players.values():
            p.reset_stats()
            p.bet = None
            p.reset_round_effects()
        self.game_active = False
        self.game_round = 0
        self.plan = []
        self.carryover = 0
        self.pot = 0
        self.pot_bonus = 0
        self.awards = []
        self.curse = None
        self.final_curse = None
        self.relic_events = []
        self.salted.clear()
        self.magnets.clear()
        self._used_mediums.clear()
        self._catchup_done.clear()
        self._practice_pending = False
        self.touch()

    def _show_results(self) -> None:
        self.awards = game.compute_awards(self.players.values())
        # The Final Curse needs someone who can actually perform it: the
        # most-haunted human(s), even if a bot won the Most Haunted award.
        humans = [p for p in self.players.values() if not p.is_bot]
        worst = max((p.haunted for p in humans), default=0)
        self.final_curse = (
            {
                "playerIds": [p.id for p in humans if p.haunted == worst],
                "text": self._rng.choice(FINAL_CURSES),
            }
            if worst > 0
            else None
        )
        self.curse = None
        self.phase = "results"
        self.game_active = False
        self.question = None
        self.question_text = ""
        self.spots = []
        self.result_spot_id = None
        self.medium_id = None

    def _labels_for(self, q: Question) -> list[tuple[str, str]]:
        if q.kind == "who":
            # Shuffled every round: in join order, the first player always sat at
            # the top, nearest the planchette's start, and got picked far too often.
            names = [(p.id, p.name) for p in self.players.values() if p.id != self.medium_id]
            self._rng.shuffle(names)
            return names
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
            grace = PRACTICE_ALL_IN_SECONDS if self.round_kind == "practice" else ALL_IN_SECONDS
            self.phase_ends_at = min(self.phase_ends_at, self._clock() + grace)
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

    def use_relic(self, player_id: str, key: object, target: object = None, text: object = None) -> str | None:
        """Casts a Relic. Returns None on success, or a player-facing reason."""
        p = self.players.get(player_id)
        relic = relics.CATALOG.get(key) if isinstance(key, str) else None
        if p is None or p.is_bot or relic is None:
            return "Unknown Relic."
        if relic.key not in p.relics:
            return "You don’t have that Relic."
        if self.phase not in ("medium", "question", "pull", "reveal"):
            return "Relics only work during a round."
        if self.round_kind == "practice":
            return "Relics rest during the practice round."
        if p.relic_round == self.round_no and self.round_kind != "final":
            return "One Relic per round (except in the Final Séance)."
        is_medium = p.id == self.medium_id
        if relic.timing == relics.PULL and (self.phase != "pull" or is_medium):
            return "That Relic only works during the pull."
        if relic.timing == relics.BET:
            if is_medium:
                return "The Medium can’t use that one."
            if self.phase not in ("question", "pull"):
                return "That Relic only works while bets are open or during the pull."
        event: dict[str, Any] = {"key": relic.key, "by": p.id, "target": None, "text": None}

        if relic.key in ("mirror", "hex"):
            victim = self.players.get(target) if isinstance(target, str) else None
            if victim is None or victim.id == p.id or victim.id == self.medium_id:
                return "Pick another player who’s pulling."
            if relic.key == "mirror":
                if victim.mirrored:
                    return f"{victim.name} is already mirrored."
                victim.mirrored = True
            else:
                victim.frozen_until = max(victim.frozen_until, self._clock()) + relics.HEX_SECONDS
            event["target"] = victim.id
        elif relic.key in ("salt", "magnet"):
            if not self._valid_spot(target):
                return "Pick a spot on the board."
            if relic.key == "salt":
                if target in self.salted:
                    return "That spot is already salted."
                if len(self.salted) + 1 >= len(self.spots):
                    return "The spirits need at least one spot left open."
                self.salted.add(target)  # type: ignore[arg-type]
                if self.planchette.hover_spot == target:
                    self.planchette.hover_spot, self.planchette.hover_time = None, 0.0
            else:
                self.magnets.append(target)  # type: ignore[arg-type]
            event["target"] = target
        elif relic.key == "crystal":
            if p.crystal:
                return "Your Crystal Ball is already glowing."
            if self.round_kind == "medium":
                if self.phase != "question":
                    return "Use it while you’re guessing."
                wrong = [s.id for s in self.spots if s.id != self.medium_answer]
                self._rng.shuffle(wrong)
                p.crystal_crossed = tuple(wrong[: min(2, len(self.spots) - 1)])
            p.crystal = True
        elif relic.key == "double":
            if self.round_kind == "medium":
                return "Double Down only works on Spirit Bets."
            if p.double_down:
                return "You already doubled down."
            p.double_down = True
        elif relic.key == "whisper":
            clean = relics.clean_whisper(text)
            if clean is None:
                return f"Whispers are 1–{relics.WHISPER_MAX} characters."
            event["by"] = None  # anonymous, even to the TV
            event["text"] = clean
        elif relic.key == "grip":
            p.grip_until = max(p.grip_until, self._clock()) + relics.GRIP_SECONDS
        elif relic.key == "shuffle":
            if len(self.spots) < 2:
                return "There's nothing to shuffle."
            if self.shuffle_at is not None:
                return "The board is already about to shuffle."
            now = self._clock()
            halfway = self.phase_ends_at - self._pull_seconds() / 2
            self.shuffle_at = max(halfway, now + relics.SHUFFLE_MIN_DELAY)
        elif relic.key == "rewind":
            self._rewind()
        elif relic.key == "tarot":
            if not self._valid_spot(target):
                return "Pick a spot on the board."
            if target == p.bet:
                return "That's already your bet."
            p.bet = target  # type: ignore[assignment]
            p.auto_bet = False
            p.bet_dirty = True
            # The new bet stays secret: the TV only learns that it changed.
        elif relic.key == "pact":
            partner = self.players.get(target) if isinstance(target, str) else None
            if partner is None or partner.id == p.id or partner.id == self.medium_id:
                return "Pick another player who's betting."
            if p.pact_with is not None:
                return "You're already bound to someone."
            p.pact_with = partner.id
            event["target"] = partner.id
        elif relic.key == "jumpscare":
            if self.phase == "pull":
                angle = self._rng.uniform(0, 2 * math.pi)
                self.planchette.vx += math.cos(angle) * relics.JUMP_SCARE_SPEED
                self.planchette.vy += math.sin(angle) * relics.JUMP_SCARE_SPEED
                self.planchette.hover_spot, self.planchette.hover_time = None, 0.0

        p.relics.remove(relic.key)
        # Spend game copies (starter/catch-up/dev) before hunt ones; record a hunt copy being spent.
        if p.relics.count(relic.key) < p.hunt.count(relic.key):
            p.hunt.remove(relic.key)
            p.hunt_spent.append(relic.key)
        elif relic.key in p.catchup:
            p.catchup.remove(relic.key)
        elif p.starter == relic.key:
            p.starter = None
        p.relic_round = self.round_no
        p.relics_dirty = True
        self._relic_seq += 1
        event["seq"] = self._relic_seq
        self.relic_events.append(event)
        self.touch()
        return None

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
            self.phase_ends_at = now + self._pull_seconds()
            return True
        if self.phase != "pull":
            return False

        self._think_bots(now)
        pulls = []
        for p in self._bettors():
            if p.is_bot or (p.connected and now - p.pull_at <= INPUT_STALE_SECONDS):
                if now < p.frozen_until:
                    pulls.append((0.0, 0.0))  # Hexed: still counts toward 1/sqrt(n)
                    continue
                px, py = (-p.pull[0], -p.pull[1]) if p.mirrored else p.pull
                if now < p.grip_until:
                    px, py = px * relics.GRIP_MULTIPLIER, py * relics.GRIP_MULTIPLIER
                pulls.append((px, py))
                self._track_pull(p, dt)
            else:
                # Players not touching the pad still count toward 1/sqrt(n),
                # so idle players act like a little friction.
                pulls.append((0.0, 0.0))
        fx, fy = physics.combine_pulls(pulls)
        for spot_id in self.magnets:
            spot = next((s for s in self.spots if s.id == spot_id), None)
            if spot is None:
                continue
            dx, dy = spot.x - self.planchette.x, spot.y - self.planchette.y
            d = math.hypot(dx, dy)
            if d > 1e-3:
                fx += dx / d * relics.MAGNET_STRENGTH
                fy += dy / d * relics.MAGNET_STRENGTH
        locked = physics.step(self.planchette, (fx, fy), dt, self.spots, self.salted)
        self._trail.append((now, self.planchette.x, self.planchette.y))
        while self._trail and self._trail[0][0] < now - relics.REWIND_SECONDS - 1.0:
            self._trail.popleft()
        if locked is None and self.shuffle_at is not None and now >= self.shuffle_at:
            self._shuffle_spots()
            return True  # spots moved: rebroadcast state
        if locked is None and now >= self.phase_ends_at:
            locked = self._timeout_spot()
        if locked is not None:
            self._finish_round(locked)
            return True
        return False

    def _timeout_spot(self) -> str | None:
        """Where the board lands when the pull runs out without locking in.

        If the planchette got somewhere, the nearest answer. If it's still near
        the middle, nobody really chose, so a random answer: "nearest to the
        middle" was always the same spot.
        """
        open_spots = [s for s in self.spots if s.id not in self.salted] or self.spots
        if not open_spots:
            return None
        pl = self.planchette
        if math.hypot(pl.x - physics.START_X, pl.y - physics.START_Y) < TIMEOUT_RANDOM_RADIUS:
            return self._rng.choice(open_spots).id
        spot, _ = physics.nearest_spot(pl, self.spots, self.salted)
        return spot.id if spot else None

    def _rewind(self) -> None:
        """Séance Rewind: back to where the planchette was REWIND_SECONDS ago (or the pull's start)."""
        target = self._clock() - relics.REWIND_SECONDS
        x, y = physics.START_X, physics.START_Y
        for t, tx, ty in self._trail:
            x, y = tx, ty
            if t >= target:
                break
        pl = self.planchette
        pl.x, pl.y = x, y
        pl.vx = pl.vy = 0.0
        pl.hover_spot, pl.hover_time = None, 0.0
        self._trail.clear()  # a second Rewind goes back from here, not further

    def _shuffle_spots(self) -> None:
        """Ouija Shuffle: every answer moves to another answer's place."""
        self.shuffle_at = None
        n = len(self.spots)
        if n < 2:
            return
        order = list(range(n))
        while any(i == j for i, j in enumerate(order)):  # derangement: nothing stays put
            self._rng.shuffle(order)
        places = [(s.x, s.y) for s in self.spots]
        self.spots = [
            physics.Spot(s.id, s.label, *places[order[i]]) for i, s in enumerate(self.spots)
        ]
        self.planchette.hover_spot, self.planchette.hover_time = None, 0.0

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

    def _pull_seconds(self) -> float:
        return PRACTICE_PULL_SECONDS if self.round_kind == "practice" else PULL_SECONDS

    def _finish_round(self, spot_id: str) -> None:
        self.result_spot_id = spot_id
        spot = next(s for s in self.spots if s.id == spot_id)
        self.planchette.x, self.planchette.y = spot.x, spot.y
        self.planchette.vx = self.planchette.vy = 0.0
        self.planchette.fx = self.planchette.fy = 0.0
        self.planchette.hover_spot = spot_id
        self.planchette.hover_time = physics.LOCK_SECONDS
        if self.round_kind == "practice":
            self._practice_result(spot_id)
            self.phase = "reveal"
            return
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
        self._pay_pacts()
        self._deal_catchup()
        self._deal_curse(haunted)
        self.phase = "reveal"

    def _practice_result(self, spot_id: str) -> None:
        """Shows what *would* have been paid. No points, marks, stats or curses."""
        winners = [p for p in self._bettors() if p.bet == spot_id]
        share = self.pot // len(winners) if winners else 0
        self.last_payout = {p.id: share for p in winners}
        self.last_rolled_over = not winners
        self.curse = None

    def _deal_curse(self, victim: Player | None) -> None:
        """The previous curse ends at this reveal; the board may deal a new one."""
        self.curse = None
        if not self.curses_on or victim is None or victim.is_bot or self.round_kind == "final":
            return
        if not self._curse_order:
            self._curse_order = list(range(len(CURSE_DECK)))
            self._rng.shuffle(self._curse_order)
        card = CURSE_DECK[self._curse_order.pop()]
        others = [p for p in self.players.values() if p.id != victim.id]
        humans = [p for p in others if not p.is_bot]
        other = self._rng.choice(humans or others).name if others else "the nearest ghost"
        self.curse = {
            "playerId": victim.id,
            "roundNo": self.round_no,
            "text": card.text.replace("{other}", other),
            "drink": card.drink,
            "alt": card.alt.replace("{other}", other) if card.alt else None,
        }

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
        # Double Down pays its bonus on top; it never shrinks anyone else's share.
        self.last_payout = {p.id: share * (2 if p.double_down else 1) for p in winners}
        for p in winners:
            p.score += self.last_payout[p.id]
        if len(winners) == 1:
            winners[0].solo_wins += 1
        self.last_rolled_over = False

    def _deal_catchup(self) -> None:
        """Design doc §6.6: last place (humans) after rounds 3 and 6 gets a free Common."""
        if not self.catchup_relics or self.round_kind == "final":
            return
        if self.game_round not in game.CATCHUP_AFTER or self.game_round in self._catchup_done:
            return
        self._catchup_done.add(self.game_round)
        humans = [p for p in self.players.values() if not p.is_bot]
        if len(humans) < 2:
            return
        low = min(p.score for p in humans)
        if low == max(p.score for p in humans):
            return  # everyone's tied: nobody is behind
        commons = [k for k, r in relics.CATALOG.items() if r.tier == "common"]
        for p in humans:
            if p.score == low:
                key = self._rng.choice(commons)
                self._grant(p, key)
                p.catchup.append(key)
                self.last_catchup[p.id] = key

    def _pay_pacts(self) -> None:
        """Blood Pact: you also win what your partner won (their own winnings only, no chains)."""
        base = dict(self.last_payout)
        gains: dict[str, int] = {}
        for p in self.players.values():
            won = base.get(p.pact_with or "", 0)
            if won > 0:
                gains[p.id] = won
                p.score += won
                self.last_payout[p.id] = self.last_payout.get(p.id, 0) + won
        self.last_pact_gains = gains

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

    def _pick_question(self, deck: list[Question], custom: list[Question], kind: str) -> Question:
        pool = deck + [q for q in custom if q not in deck]
        # "Always include" questions: spread them over the rounds of this kind
        # that are left, so they all come up but not all at the start.
        always = [q for q in custom if q in self.always_questions and q not in self._used_questions]
        if always:
            rest = [k for k in self.plan[self.game_round :] if k != "final"]
            if kind == "bets" and len(self.players) < MIN_PLAYERS_FOR_MEDIUM:
                left = len(rest)  # Medium slots fall back to Spirit Bets
            else:
                left = rest.count(kind)
            if self._rng.random() < len(always) / max(1, left):
                q = self._rng.choice(always)
                self._used_questions.add(q)
                return q
        available = [q for q in pool if q not in self._used_questions]
        if not available:
            self._used_questions -= set(pool)
            available = list(pool)
        q = self._rng.choice(available)
        self._used_questions.add(q)
        return q

    def _pick_final(self) -> Question:
        """One final per game. Always-include custom finals go first; otherwise
        rotate through the built-in and custom finals across games."""
        always = [
            q for q in self.custom_final if q in self.always_questions and q not in self._used_questions
        ]
        if always:
            q = self._rng.choice(always)
            self._used_questions.add(q)
            return q
        pool = FINAL_DECK + [q for q in self.custom_final if q not in FINAL_DECK]
        available = [q for q in pool if q not in self._used_questions]
        if not available:
            self._used_questions -= set(pool)
            available = list(pool)
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
                "cursesOn": self.curses_on,
                "starterRelics": self.starter_relics,
                "catchupRelics": self.catchup_relics,
                "practiceOn": self.practice_on,
            },
            "medium": (
                {"playerId": self.medium_id, "answered": self.medium_answer is not None}
                if self.medium_id and in_round
                else None
            ),
            # Curses are public: the TV reads them out.
            "curse": self.curse if in_round else None,
            # Relic use is public (Ghost Whisper events carry no caster).
            "relicEvents": self.relic_events if in_round else [],
            "effects": {
                "salted": sorted(self.salted),
                "magnets": self.magnets,
                "mirrored": [p.id for p in self.players.values() if p.mirrored],
                "hexed": {
                    p.id: round(p.frozen_until - now, 2)
                    for p in self.players.values()
                    if p.frozen_until > now
                },
                "gripping": {
                    p.id: round(p.grip_until - now, 2)
                    for p in self.players.values()
                    if p.grip_until > now
                },
                "shuffleIn": (
                    round(max(0.0, self.shuffle_at - now), 2)
                    if self.shuffle_at is not None and self.phase == "pull"
                    else None
                ),
                # Pacts are public (the TV announced them): caster -> partner.
                "pacts": {p.id: p.pact_with for p in self.players.values() if p.pact_with},
            },
            "relicCatalog": RELIC_CATALOG_DICT,
            "awards": self.awards if self.phase == "results" else None,
            "finalCurse": self.final_curse if self.phase == "results" else None,
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
            "doubled": [p.id for p in self.players.values() if p.double_down],
            "pacts": {p.id: p.pact_with for p in self.players.values() if p.pact_with},
            "pactGains": self.last_pact_gains,
            # Who the spirits took pity on (public); which Relic stays private.
            "catchUp": sorted(self.last_catchup),
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

    def relics_msg(self, player: Player) -> dict:
        """A player's Relic inventory. Only ever sent to that player's phone."""
        return {
            "type": "relics",
            "relics": list(player.relics),
            "usedRound": player.relic_round,
        }

    def crystal_msg(self, player: Player) -> dict | None:
        """Crystal Ball vision, for its caster only."""
        if not player.crystal or self.phase not in ("question", "pull"):
            return None
        if self.round_kind == "medium":
            return {"type": "crystal", "roundNo": self.round_no, "crossed": list(player.crystal_crossed)}
        counts: dict[str, int] = {}
        for p in self._bettors():
            if p.bet:
                counts[p.bet] = counts.get(p.bet, 0) + 1
        return {"type": "crystal", "roundNo": self.round_no, "counts": counts}

    async def send_private(self) -> None:
        """Sends each phone its own secrets: auto-picks, Relics, visions."""
        for pid, conn in list(self.player_conns.items()):
            p = self.players.get(pid)
            if p is None:
                continue
            msgs = []
            if (p.auto_bet or p.bet_dirty) and p.bet and self.phase == "pull":
                p.bet_dirty = False
                msgs.append(self.bet_msg(p))
            elif pid == self.medium_id and self.medium_auto and self.phase == "question":
                msgs.append(self.answer_msg())
            if p.relics_dirty:
                p.relics_dirty = False
                msgs.append(self.relics_msg(p))
            crystal = self.crystal_msg(p)
            if crystal:
                msgs.append(crystal)
            for msg in msgs:
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
