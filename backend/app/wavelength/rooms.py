"""Rooms, state machine, and Bot AI for Wavelength.

Supports three modes:
  - "teams": 2–6 teams take turns. One member of the active team is Psychic,
             the active team locks in the dial angle, and (optionally) opposing
             teams vote whether the true target is Left or Right of the needle.
  - "ffa":   Free-for-All. Rotating Psychic gives a clue; every other player
             independently locks in their own dial angle on their phone.
  - "coop":  Cooperative. Everyone plays together across 7 cards (Bullseye grants
             +1 bonus card) aiming for the highest cosmic rating.

Secret target angle (`_target`) is NEVER included in public `state` during
`psychic`, `guessing`, or `bonus` phases—only sent to the Psychic's socket via
`psychic_secret`.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import hmac
import logging
import random
import re
import secrets
import time
from dataclasses import dataclass
from typing import Any, Callable, Protocol

from app.shared.rooms_util import (
    CODE_ALPHABET,
    CODE_LENGTH,
    JoinError,
    RoomLimitError,
    normalize_code,
    normalize_name,
)
from app.wavelength import rules
from app.wavelength.decks import (
    CardPair,
    DECKS,
    DEFAULT_PACKS,
    build_card_pool,
    card_key,
    clean_card_text,
    deck_catalog,
    normalize_custom_cards,
)
from app.wavelength.rules import BonusDirection, GameMode, ScoringPreset

log = logging.getLogger(__name__)

MAX_PLAYERS = 16
MIN_PLAYERS_TO_START = 2
MAX_TEAMS = 6
MIN_TEAMS = 2
MAX_ROOMS = 20
DEFAULT_TARGET_SCORE = 10
MIN_TARGET_SCORE = 5
MAX_TARGET_SCORE = 25
DEFAULT_COOP_CARDS = 7
MAX_SCORE = 99
MAX_CLUE_LEN = 60
MAX_TEAM_NAME_LEN = 24
BOT_DELAY_SECONDS = 1.4
LOOP_SECONDS = 0.25
ROOM_IDLE_SECONDS = 10 * 60

AVATAR_PREFIX = "data:image/jpeg;base64,"
MAX_AVATAR_BYTES = 18_000
AVATAR_COOLDOWN_SECONDS = 2.0

# mikeck1's 6 team colors
TEAM_COLORS: tuple[str, ...] = (
    "#ff5d8f",  # neon pink
    "#4cc9f0",  # electric cyan
    "#ffc94a",  # solar gold
    "#3ee6b0",  # mint green
    "#a78bfa",  # cosmic violet
    "#ff8a5c",  # coral orange
)

DEFAULT_TEAM_NAMES: tuple[str, ...] = (
    "Mind Readers",
    "Brainwaves",
    "Astral Signals",
    "Static Shifters",
    "Frequency Five",
    "Neon Psychics",
)

PLAYER_COLORS: tuple[str, ...] = (
    "#ff5d8f",
    "#4cc9f0",
    "#ffc94a",
    "#3ee6b0",
    "#a78bfa",
    "#ff8a5c",
    "#f43f5e",
    "#38bdf8",
    "#facc15",
    "#34d399",
    "#c084fc",
    "#fb923c",
    "#e879f9",
    "#2dd4bf",
    "#a3e635",
    "#fb7185",
)

BOT_NAMES: tuple[str, ...] = (
    "Hertz",
    "Tesla",
    "Marconi",
    "Doppler",
    "Faraday",
    "Maxwell",
    "Fourier",
    "Curie",
    "Shannon",
    "Lovelace",
    "Kepler",
    "Sagan",
)


class Conn(Protocol):
    async def send_json(self, data: Any) -> None: ...


def validate_avatar(data: object) -> str | None:
    """Validates a small JPEG data URL by checking JPEG SOI/EOI markers."""
    if not isinstance(data, str) or not data.startswith(AVATAR_PREFIX):
        return None
    b64 = data[len(AVATAR_PREFIX) :]
    if len(b64) > (MAX_AVATAR_BYTES * 4) // 3 + 4:
        return None
    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        return None
    if len(raw) < 4 or len(raw) > MAX_AVATAR_BYTES:
        return None
    if not (raw.startswith(b"\xff\xd8\xff") and raw.rstrip(b"\x00").endswith(b"\xff\xd9")):
        return None
    return AVATAR_PREFIX + base64.b64encode(raw).decode("ascii")


def clean_clue(value: object) -> str:
    if not isinstance(value, str):
        return ""
    cleaned = re.sub(r"[\x00-\x1f\x7f]+", " ", value)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:MAX_CLUE_LEN]


def _bot_clue_for(card: CardPair, target: float) -> str:
    """Generates a playful synthetic clue for a Bot Psychic based on target angle."""
    left, right = card
    if target <= -60:
        return f"100% {left}"
    if target <= -28:
        return f"Mostly {left}"
    if target < -8:
        return f"Leaning {left}"
    if target <= 8:
        return f"Right between {left} & {right}"
    if target < 28:
        return f"Leaning {right}"
    if target < 60:
        return f"Mostly {right}"
    return f"100% {right}"


@dataclass
class WlTeam:
    id: str
    name: str
    color: str
    score: int = 0
    psychic_cursor: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "color": self.color,
            "score": self.score,
        }


@dataclass
class WlPlayer:
    id: str
    name: str
    color: str
    team_id: str = "t0"
    is_bot: bool = False
    connected: bool = True
    device: str | None = None
    score: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "color": self.color,
            "teamId": self.team_id,
            "isBot": self.is_bot,
            "connected": self.connected,
            "score": self.score,
        }


class WavelengthRoom:
    def __init__(
        self,
        code: str,
        *,
        rng: random.Random | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.code = code
        self.rng = rng or random.Random(secrets.randbits(64))
        self.clock = clock
        self.last_active = clock()
        self.host_device: str | None = None

        self.phase: str = "lobby"
        self.mode: GameMode = "teams"
        self.preset: ScoringPreset = "classic"
        self.left_right_bonus: bool = True
        self.catchup_rule: bool = True
        self.target_score: int = DEFAULT_TARGET_SCORE
        self.coop_total_cards: int = DEFAULT_COOP_CARDS

        self.packs: list[str] = list(DEFAULT_PACKS)
        self.custom_cards: list[CardPair] = []
        self._seen_keys: set[str] = set()

        self.teams: list[WlTeam] = [
            WlTeam(id="t0", name=DEFAULT_TEAM_NAMES[0], color=TEAM_COLORS[0]),
            WlTeam(id="t1", name=DEFAULT_TEAM_NAMES[1], color=TEAM_COLORS[1]),
        ]
        self.players: list[WlPlayer] = []
        self._next_pid = 1
        self._next_team_seq = 2

        # Turn / Round state
        self.round: int = 0
        self.active_team_idx: int = 0
        self._ffa_psychic_cursor: int = 0
        self.psychic_id: str | None = None
        self.card: CardPair | None = None
        self._target: float | None = None
        self.clue: str = ""
        self.clue_spoken: bool = False

        # Dial state
        self.needle: float = 0.0
        self.locked_by: str | None = None

        # Free-for-All guesses
        self._ffa_guesses: dict[str, float] = {}
        self._ffa_live: dict[str, float] = {}

        # Teams Left/Right bonus votes
        self.bonus_votes: dict[str, BonusDirection] = {}

        # Co-op counters
        self.coop_score: int = 0
        self.coop_cards_remaining: int = DEFAULT_COOP_CARDS
        self.coop_bonus_cards: int = 0

        # Reveal summary
        self.reveal: dict[str, Any] | None = None
        self.winners: list[str] = []

        # Selfies & connections
        self.avatars: dict[str, str] = {}
        self._avatar_at: dict[str, float] = {}
        self.tv_conns: set[Conn] = set()
        self.player_conns: dict[str, Conn] = {}
        self._dirty = False
        self._bot_due: float | None = None

    def touch(self) -> None:
        self.last_active = self.clock()

    def is_host(self, device: str | None) -> bool:
        return bool(
            device
            and self.host_device
            and hmac.compare_digest(device, self.host_device)
        )

    # ---- Players, Teams & Selfies -------------------------------------------

    def _smallest_team_id(self) -> str:
        counts = {t.id: 0 for t in self.teams}
        for p in self.players:
            if p.team_id in counts:
                counts[p.team_id] += 1
        return min(self.teams, key=lambda t: counts.get(t.id, 0)).id

    def add_player(
        self, raw_name: object, *, is_bot: bool = False, device: str | None = None
    ) -> WlPlayer:
        name = normalize_name(raw_name)
        for p in self.players:
            if p.name.casefold() != name.casefold():
                continue
            if p.is_bot or is_bot:
                raise JoinError("That name is taken.")
            if p.device is not None:
                if device is not None and hmac.compare_digest(device, p.device):
                    p.connected = True
                    self._dirty = True
                    self.touch()
                    return p
                raise JoinError(
                    "That name is taken. On a new phone? Add a letter to your name."
                )
            if not p.connected:
                p.connected = True
                if device is not None:
                    p.device = device
                self._dirty = True
                self.touch()
                return p
            raise JoinError("That name is taken.")

        # Also allow a player whose device cookie matches to reclaim their seat even if they typed a slightly different name
        if not is_bot and device is not None:
            for p in self.players:
                if not p.is_bot and p.device and hmac.compare_digest(p.device, device):
                    p.name = name
                    p.connected = True
                    self._dirty = True
                    self.touch()
                    return p

        if len(self.players) >= MAX_PLAYERS:
            raise JoinError(f"This room is full (max {MAX_PLAYERS} players).")

        used_colors = {p.color for p in self.players}
        color = next(
            (c for c in PLAYER_COLORS if c not in used_colors),
            PLAYER_COLORS[len(self.players) % len(PLAYER_COLORS)],
        )
        player = WlPlayer(
            id=f"p{self._next_pid}",
            name=name,
            color=color,
            team_id=self._smallest_team_id(),
            is_bot=is_bot,
            device=None if is_bot else device,
        )
        self._next_pid += 1
        self.players.append(player)
        self._dirty = True
        self._schedule_bot_if_needed()
        self.touch()
        return player

    def mark_disconnected(self, player_id: str) -> None:
        p = self.get_player(player_id)
        if p:
            p.connected = False
            self._dirty = True

    def get_player(self, player_id: str | None) -> WlPlayer | None:
        if not player_id:
            return None
        for p in self.players:
            if p.id == player_id:
                return p
        return None

    def get_team(self, team_id: str | None) -> WlTeam | None:
        if not team_id:
            return None
        for t in self.teams:
            if t.id == team_id:
                return t
        return None

    def move_seat(self, player_id: object, direction: object) -> bool:
        if self.phase != "lobby" or not isinstance(player_id, str):
            return False
        if isinstance(direction, bool) or not isinstance(direction, int) or direction not in (-1, 1):
            return False
        idx = next((i for i, p in enumerate(self.players) if p.id == player_id), None)
        if idx is None:
            return False
        new_idx = (idx + direction) % len(self.players)
        if new_idx == idx:
            return False
        self.players[idx], self.players[new_idx] = self.players[new_idx], self.players[idx]
        self._dirty = True
        self.touch()
        return True

    def set_avatar(self, player_id: str, data: object) -> bool:
        if not self.get_player(player_id):
            return False
        now = self.clock()
        if now - self._avatar_at.get(player_id, -AVATAR_COOLDOWN_SECONDS) < AVATAR_COOLDOWN_SECONDS:
            return False
        if data is None or data == "":
            self.avatars.pop(player_id, None)
            self._avatar_at[player_id] = now
            self.touch()
            return True
        clean = validate_avatar(data)
        if clean is None:
            return False
        self.avatars[player_id] = clean
        self._avatar_at[player_id] = now
        self.touch()
        return True

    def avatars_msg(self) -> dict[str, Any]:
        return {"type": "avatars", "avatars": dict(self.avatars)}

    def add_bot(self) -> WlPlayer | None:
        if self.phase != "lobby" or len(self.players) >= MAX_PLAYERS:
            return None
        taken = {p.name.casefold() for p in self.players}
        for name in BOT_NAMES:
            if name.casefold() not in taken:
                try:
                    return self.add_player(name, is_bot=True)
                except JoinError:
                    continue
        return None

    def remove_bot(self) -> bool:
        if self.phase != "lobby":
            return False
        bots = [p for p in self.players if p.is_bot]
        if not bots:
            return False
        self.remove_player(bots[-1].id)
        return True

    def remove_player(self, player_id: str) -> None:
        idx = next((i for i, p in enumerate(self.players) if p.id == player_id), None)
        if idx is None:
            return
        self.players.pop(idx)
        self.player_conns.pop(player_id, None)
        self.avatars.pop(player_id, None)
        self._avatar_at.pop(player_id, None)
        self._ffa_guesses.pop(player_id, None)
        self._ffa_live.pop(player_id, None)
        self._dirty = True
        self.touch()

        if self.phase == "lobby":
            return
        if len(self.players) < MIN_PLAYERS_TO_START:
            self._reset_to_lobby()
            return
        if self.psychic_id == player_id and self.phase in ("psychic", "guessing", "bonus"):
            self._start_next_turn(advance_team=False)
        elif self.phase == "guessing" and self.mode == "ffa":
            if self._all_ffa_guessed():
                self._finish_reveal()

    # ---- Lobby & Host Settings ----------------------------------------------

    def set_mode(self, mode: object) -> bool:
        if self.phase != "lobby" or mode not in ("teams", "ffa", "coop"):
            return False
        self.mode = mode  # type: ignore[assignment]
        self._dirty = True
        self.touch()
        return True

    def set_preset(self, preset: object) -> bool:
        if preset not in ("classic", "board"):
            return False
        self.preset = preset  # type: ignore[assignment]
        self._dirty = True
        self.touch()
        return True

    def set_left_right_bonus(self, on: object) -> bool:
        if not isinstance(on, bool):
            return False
        self.left_right_bonus = on
        self._dirty = True
        self.touch()
        return True

    def set_catchup_rule(self, on: object) -> bool:
        if not isinstance(on, bool):
            return False
        self.catchup_rule = on
        self._dirty = True
        self.touch()
        return True

    def set_target_score(self, target: object) -> bool:
        if isinstance(target, bool) or not isinstance(target, int):
            return False
        if not (MIN_TARGET_SCORE <= target <= MAX_TARGET_SCORE):
            return False
        self.target_score = target
        self._dirty = True
        self.touch()
        return True

    def toggle_pack(self, pack_id: object) -> bool:
        if not isinstance(pack_id, str) or pack_id not in DECKS:
            return False
        if pack_id in self.packs:
            if len(self.packs) == 1 and not self.custom_cards:
                return False
            self.packs.remove(pack_id)
        else:
            self.packs.append(pack_id)
        self._dirty = True
        self.touch()
        return True

    def set_custom_cards(self, raw_cards: object, *, replace_packs: bool = False) -> int:
        cards = normalize_custom_cards(raw_cards)
        self.custom_cards = cards
        if replace_packs and cards:
            self.packs = []
        elif not self.packs and not cards:
            self.packs = list(DEFAULT_PACKS)
        self._seen_keys.clear()
        self._dirty = True
        self.touch()
        return len(cards)

    def add_team(self) -> bool:
        if self.phase != "lobby" or len(self.teams) >= MAX_TEAMS:
            return False
        idx = len(self.teams)
        used_colors = {t.color for t in self.teams}
        color = next(
            (c for c in TEAM_COLORS if c not in used_colors),
            TEAM_COLORS[idx % len(TEAM_COLORS)],
        )
        name = DEFAULT_TEAM_NAMES[idx % len(DEFAULT_TEAM_NAMES)]
        self.teams.append(
            WlTeam(id=f"t{self._next_team_seq}", name=name, color=color)
        )
        self._next_team_seq += 1
        self._dirty = True
        self.touch()
        return True

    def remove_team(self, team_id: object) -> bool:
        if self.phase != "lobby" or len(self.teams) <= MIN_TEAMS:
            return False
        if not isinstance(team_id, str):
            return False
        idx = next((i for i, t in enumerate(self.teams) if t.id == team_id), None)
        if idx is None:
            return False
        self.teams.pop(idx)
        fallback = self.teams[0].id
        for p in self.players:
            if p.team_id == team_id:
                p.team_id = fallback
        self._dirty = True
        self.touch()
        return True

    def rename_team(self, team_id: object, raw_name: object) -> bool:
        if not isinstance(team_id, str) or not isinstance(raw_name, str):
            return False
        team = self.get_team(team_id)
        if not team:
            return False
        cleaned = clean_card_text(raw_name)[:MAX_TEAM_NAME_LEN]
        if not cleaned:
            return False
        team.name = cleaned
        self._dirty = True
        self.touch()
        return True

    def set_player_team(self, player_id: str, team_id: object) -> bool:
        player = self.get_player(player_id)
        team = self.get_team(team_id if isinstance(team_id, str) else None)
        if not player or not team:
            return False
        player.team_id = team.id
        self._dirty = True
        self.touch()
        return True

    def shuffle_teams(self) -> bool:
        if not self.teams or not self.players:
            return False
        shuffled = list(self.players)
        self.rng.shuffle(shuffled)
        for i, p in enumerate(shuffled):
            p.team_id = self.teams[i % len(self.teams)].id
        self._dirty = True
        self.touch()
        return True

    def adjust_score(self, target_id: object, delta: object) -> bool:
        if not isinstance(target_id, str) or isinstance(delta, bool) or not isinstance(delta, int):
            return False
        if delta not in (-1, 1):
            return False
        if self.mode == "teams":
            team = self.get_team(target_id)
            if not team:
                return False
            team.score = max(0, min(MAX_SCORE, team.score + delta))
        elif self.mode == "ffa":
            player = self.get_player(target_id)
            if not player:
                return False
            player.score = max(0, min(MAX_SCORE, player.score + delta))
        else:
            self.coop_score = max(0, min(MAX_SCORE, self.coop_score + delta))
        self._dirty = True
        self.touch()
        return True

    # ---- Card Drawing -------------------------------------------------------

    def _card_pool(self) -> list[CardPair]:
        pool = build_card_pool(self.packs, self.custom_cards)
        if not pool:
            pool = build_card_pool(DEFAULT_PACKS, [])
        return pool

    def _draw_card(self, exclude: CardPair | None = None) -> CardPair:
        pool = self._card_pool()
        ex_key = card_key(exclude[0], exclude[1]) if exclude else None
        candidates = [
            c
            for c in pool
            if card_key(c[0], c[1]) not in self._seen_keys
            and (len(pool) == 1 or card_key(c[0], c[1]) != ex_key)
        ]
        if not candidates:
            self._seen_keys.clear()
            candidates = [
                c for c in pool if len(pool) == 1 or card_key(c[0], c[1]) != ex_key
            ]
        chosen = self.rng.choice(candidates)
        self._seen_keys.add(card_key(chosen[0], chosen[1]))
        return chosen

    # ---- Game Flow ----------------------------------------------------------

    def can_start(self) -> bool:
        return len(self.players) >= MIN_PLAYERS_TO_START

    def start(self) -> bool:
        if self.phase != "lobby" or len(self.players) < MIN_PLAYERS_TO_START:
            return False
        # In Teams mode, if fewer than 2 teams have players, auto-balance them across teams
        if self.mode == "teams":
            populated = [
                t for t in self.teams if any(p.team_id == t.id for p in self.players)
            ]
            if len(populated) < 2:
                self.shuffle_teams()

        for t in self.teams:
            t.score = 0
            t.psychic_cursor = 0
        for p in self.players:
            p.score = 0

        self.round = 0
        self.active_team_idx = 0
        self._ffa_psychic_cursor = 0
        self.coop_score = 0
        self.coop_cards_remaining = self.coop_total_cards
        self.coop_bonus_cards = 0
        self.winners = []
        self.reveal = None

        self._start_next_turn(advance_team=False)
        return True

    def _populated_team_indices(self) -> list[int]:
        return [
            i
            for i, t in enumerate(self.teams)
            if any(p.team_id == t.id for p in self.players)
        ]

    def _start_next_turn(self, *, advance_team: bool) -> None:
        if len(self.players) < MIN_PLAYERS_TO_START:
            self._reset_to_lobby()
            return

        if self.mode == "teams":
            pop_indices = self._populated_team_indices()
            if len(pop_indices) < 2:
                self.shuffle_teams()
                pop_indices = self._populated_team_indices()
            if advance_team:
                cur_pos = (
                    pop_indices.index(self.active_team_idx)
                    if self.active_team_idx in pop_indices
                    else -1
                )
                self.active_team_idx = pop_indices[(cur_pos + 1) % len(pop_indices)]
            elif self.active_team_idx not in pop_indices:
                self.active_team_idx = pop_indices[0]

            team = self.teams[self.active_team_idx]
            members = [p for p in self.players if p.team_id == team.id]
            psychic = members[team.psychic_cursor % len(members)]
            team.psychic_cursor += 1
            self.psychic_id = psychic.id
        else:
            psychic = self.players[self._ffa_psychic_cursor % len(self.players)]
            self._ffa_psychic_cursor += 1
            self.psychic_id = psychic.id

        self.round += 1
        self.phase = "psychic"
        self.card = self._draw_card(self.card)
        self._target = round(self.rng.uniform(-82.0, 82.0), 2)
        self.clue = ""
        self.clue_spoken = False
        self.needle = 0.0
        self.locked_by = None
        self._ffa_guesses.clear()
        self._ffa_live.clear()
        self.bonus_votes.clear()
        self.reveal = None
        self._dirty = True
        self._schedule_bot_if_needed()
        self.touch()

    def redraw_card(self, actor_id: str | None = None) -> bool:
        """Draws a fresh spectrum card (and new target angle) during the psychic phase."""
        if self.phase != "psychic":
            return False
        if actor_id is not None and actor_id != self.psychic_id:
            return False
        self.card = self._draw_card(self.card)
        self._target = round(self.rng.uniform(-82.0, 82.0), 2)
        self._dirty = True
        self.touch()
        return True

    def submit_clue(
        self,
        actor_id: str | None,
        raw_clue: object,
        *,
        spoken: bool = False,
    ) -> bool:
        """Psychic (or TV host when `actor_id is None`) submits the clue and opens guessing."""
        if self.phase != "psychic":
            return False
        if actor_id is not None and actor_id != self.psychic_id:
            return False
        clue = clean_clue(raw_clue)
        if not clue and not spoken:
            return False
        self.clue = clue
        self.clue_spoken = bool(spoken and not clue)
        self.phase = "guessing"
        self.needle = 0.0
        self.locked_by = None
        self._ffa_guesses.clear()
        self._ffa_live.clear()
        self._dirty = True
        self._schedule_bot_if_needed()
        self.touch()
        return True

    def can_player_guess(self, player_id: str) -> bool:
        if self.phase != "guessing":
            return False
        if player_id == self.psychic_id:
            return False
        player = self.get_player(player_id)
        if not player:
            return False
        if self.mode == "teams":
            active_team = self.teams[self.active_team_idx]
            members = [p for p in self.players if p.team_id == active_team.id]
            # If the active team has only 1 player (the Psychic), let teammates/others or TV move it
            if len(members) <= 1:
                return True
            return player.team_id == active_team.id
        return True

    def aim_dial(self, actor_id: str | None, raw_angle: object) -> bool:
        """Live needle movement while dragging on phone or TV."""
        if self.phase != "guessing":
            return False
        angle = rules.clamp_angle(raw_angle)
        if angle is None:
            return False

        if self.mode in ("teams", "coop"):
            if actor_id is not None and not self.can_player_guess(actor_id):
                return False
            self.needle = angle
            self._dirty = True
            self.touch()
            return True

        # Free-for-All
        if actor_id is None:
            return False
        if not self.can_player_guess(actor_id) or actor_id in self._ffa_guesses:
            return False
        self._ffa_live[actor_id] = angle
        self.touch()
        return True

    def lock_guess(self, actor_id: str | None, raw_angle: object = None) -> bool:
        """Locks in a dial guess (`actor_id=None` is TV host override)."""
        if self.phase != "guessing":
            return False
        if raw_angle is not None:
            clamped = rules.clamp_angle(raw_angle)
            if clamped is None:
                return False
        else:
            clamped = None

        if self.mode in ("teams", "coop"):
            if actor_id is not None and not self.can_player_guess(actor_id):
                return False
            if clamped is not None:
                self.needle = clamped
            self.locked_by = actor_id or "tv"
            if self.mode == "teams" and self.left_right_bonus and len(self._opposing_teams()) >= 1:
                self.phase = "bonus"
                self.bonus_votes.clear()
                self._dirty = True
                self._schedule_bot_if_needed()
                self.touch()
                return True
            self._finish_reveal()
            return True

        # Free-for-All
        if actor_id is None:
            for p in self._ffa_guessers():
                if p.id not in self._ffa_guesses:
                    self._ffa_guesses[p.id] = self._ffa_live.get(p.id, 0.0)
            self._finish_reveal()
            return True

        if not self.can_player_guess(actor_id):
            return False
        angle = clamped if clamped is not None else self._ffa_live.get(actor_id, 0.0)
        self._ffa_guesses[actor_id] = angle
        self._dirty = True
        self._schedule_bot_if_needed()
        self.touch()
        if self._all_ffa_guessed():
            self._finish_reveal()
        return True

    def _ffa_guessers(self) -> list[WlPlayer]:
        return [p for p in self.players if p.id != self.psychic_id]

    def _all_ffa_guessed(self) -> bool:
        guessers = self._ffa_guessers()
        return bool(guessers) and all(p.id in self._ffa_guesses for p in guessers)

    def _opposing_teams(self) -> list[WlTeam]:
        if self.mode != "teams":
            return []
        active_id = self.teams[self.active_team_idx].id
        return [
            t
            for t in self.teams
            if t.id != active_id and any(p.team_id == t.id for p in self.players)
        ]

    def submit_bonus(
        self, actor_id: str | None, direction: object, *, team_id: str | None = None
    ) -> bool:
        """Opposing team member (or TV host) votes 'left' or 'right' during the bonus phase."""
        if self.phase != "bonus" or direction not in ("left", "right"):
            return False
        vote_dir: BonusDirection = direction  # type: ignore[assignment]
        opposing = self._opposing_teams()
        opposing_ids = {t.id for t in opposing}

        if actor_id is None:
            target_teams = (
                [team_id]
                if team_id in opposing_ids
                else [t.id for t in opposing]
            )
            for tid in target_teams:
                if tid:
                    self.bonus_votes[tid] = vote_dir
        else:
            player = self.get_player(actor_id)
            if not player or player.team_id not in opposing_ids:
                return False
            self.bonus_votes[player.team_id] = vote_dir

        self._dirty = True
        self._schedule_bot_if_needed()
        self.touch()
        if all(t.id in self.bonus_votes for t in opposing):
            self._finish_reveal()
        return True

    def _finish_reveal(self) -> None:
        target = self._target if self._target is not None else 0.0
        self.phase = "reveal"

        if self.mode == "teams":
            active_team = self.teams[self.active_team_idx]
            pts = rules.score_angle(self.needle, target, self.preset)
            prev_score = active_team.score
            active_team.score = min(MAX_SCORE, active_team.score + pts)
            hit_bullseye = rules.is_bullseye(self.needle, target)

            bonus_awarded: dict[str, int] = {}
            for opp in self._opposing_teams():
                vote = self.bonus_votes.get(opp.id)
                if rules.evaluate_bonus_direction(self.needle, target, vote):
                    opp.score = min(MAX_SCORE, opp.score + 1)
                    bonus_awarded[opp.id] = 1
                else:
                    bonus_awarded[opp.id] = 0

            max_other = max(
                (t.score for t in self.teams if t.id != active_team.id), default=0
            )
            extra_turn = bool(
                self.catchup_rule
                and hit_bullseye
                and (active_team.score < max_other)
                and (max_other - prev_score >= 4)
            )

            self.reveal = {
                "target": target,
                "needle": self.needle,
                "points": pts,
                "bullseye": hit_bullseye,
                "teamId": active_team.id,
                "bonusVotes": dict(self.bonus_votes),
                "bonusPoints": bonus_awarded,
                "extraTurn": extra_turn,
            }

        elif self.mode == "ffa":
            player_points: dict[str, int] = {}
            any_bullseye = False
            for p in self._ffa_guessers():
                ang = self._ffa_guesses.get(p.id, 0.0)
                pts = rules.score_angle(ang, target, self.preset)
                player_points[p.id] = pts
                p.score = min(MAX_SCORE, p.score + pts)
                if rules.is_bullseye(ang, target):
                    any_bullseye = True

            psychic_pts = rules.ffa_psychic_points(player_points)
            psychic = self.get_player(self.psychic_id)
            if psychic:
                psychic.score = min(MAX_SCORE, psychic.score + psychic_pts)

            self.reveal = {
                "target": target,
                "guesses": dict(self._ffa_guesses),
                "playerPoints": player_points,
                "psychicId": self.psychic_id,
                "psychicPoints": psychic_pts,
                "bullseye": any_bullseye,
            }

        else:  # coop
            pts = rules.score_angle(self.needle, target, self.preset)
            hit_bullseye = rules.is_bullseye(self.needle, target)
            self.coop_score = min(MAX_SCORE, self.coop_score + pts)
            self.coop_cards_remaining = max(0, self.coop_cards_remaining - 1)
            bonus_card = False
            if hit_bullseye:
                self.coop_cards_remaining += 1
                self.coop_bonus_cards += 1
                bonus_card = True

            self.reveal = {
                "target": target,
                "needle": self.needle,
                "points": pts,
                "bullseye": hit_bullseye,
                "bonusCard": bonus_card,
            }

        self._bot_due = None
        self._dirty = True
        self.touch()

    def next_turn(self) -> bool:
        if self.phase != "reveal":
            return False

        if self.mode == "teams":
            scores = {t.id: t.score for t in self.teams}
            winners = rules.winning_ids(scores, self.target_score)
            if winners:
                self.phase = "gameover"
                self.winners = winners
                self._dirty = True
                self.touch()
                return True
            extra_turn = bool(self.reveal and self.reveal.get("extraTurn"))
            self._start_next_turn(advance_team=not extra_turn)
            return True

        if self.mode == "ffa":
            scores = {p.id: p.score for p in self.players}
            winners = rules.winning_ids(scores, self.target_score)
            if winners:
                self.phase = "gameover"
                self.winners = winners
                self._dirty = True
                self.touch()
                return True
            self._start_next_turn(advance_team=False)
            return True

        # Co-op
        if self.coop_cards_remaining <= 0:
            self.phase = "gameover"
            self.winners = [p.id for p in self.players]
            self._dirty = True
            self.touch()
            return True
        self._start_next_turn(advance_team=False)
        return True

    def skip(self) -> bool:
        """Host skip control to unstick any phase."""
        if self.phase == "psychic":
            return self.submit_clue(None, "", spoken=True)
        if self.phase == "guessing":
            return self.lock_guess(None)
        if self.phase == "bonus":
            self._finish_reveal()
            return True
        if self.phase == "reveal":
            return self.next_turn()
        return False

    def play_again(self) -> None:
        self._reset_to_lobby()

    def _reset_to_lobby(self) -> None:
        self.phase = "lobby"
        self.round = 0
        self.psychic_id = None
        self.card = None
        self._target = None
        self.clue = ""
        self.clue_spoken = False
        self.needle = 0.0
        self.locked_by = None
        self._ffa_guesses.clear()
        self._ffa_live.clear()
        self.bonus_votes.clear()
        self.reveal = None
        self.winners = []
        self._bot_due = None
        self._dirty = True
        self.touch()

    # ---- Bot AI -------------------------------------------------------------

    def _schedule_bot_if_needed(self) -> None:
        if self.phase == "psychic":
            psychic = self.get_player(self.psychic_id)
            if psychic and psychic.is_bot:
                self._bot_due = self.clock() + BOT_DELAY_SECONDS
                return
        elif self.phase == "guessing":
            if self.mode in ("teams", "coop"):
                eligible = [p for p in self.players if self.can_player_guess(p.id)]
                if eligible and all(p.is_bot for p in eligible):
                    self._bot_due = self.clock() + BOT_DELAY_SECONDS
                    return
            else:
                pending_bots = [
                    p
                    for p in self._ffa_guessers()
                    if p.is_bot and p.id not in self._ffa_guesses
                ]
                if pending_bots:
                    self._bot_due = self.clock() + BOT_DELAY_SECONDS
                    return
        elif self.phase == "bonus":
            for opp in self._opposing_teams():
                if opp.id not in self.bonus_votes:
                    members = [p for p in self.players if p.team_id == opp.id]
                    if members and all(p.is_bot for p in members):
                        self._bot_due = self.clock() + BOT_DELAY_SECONDS
                        return
        self._bot_due = None

    def tick_bots(self) -> bool:
        """Advances any due bot action; returns True if state changed."""
        if self._bot_due is None or self.clock() < self._bot_due:
            return False
        self._bot_due = None
        target = self._target if self._target is not None else 0.0

        if self.phase == "psychic":
            psychic = self.get_player(self.psychic_id)
            if psychic and psychic.is_bot and self.card:
                clue = _bot_clue_for(self.card, target)
                return self.submit_clue(psychic.id, clue)
            return False

        if self.phase == "guessing":
            if self.mode in ("teams", "coop"):
                eligible = [p for p in self.players if self.can_player_guess(p.id)]
                if eligible and all(p.is_bot for p in eligible):
                    noisy = rules.clamp_angle(target + self.rng.gauss(0, 12.0)) or 0.0
                    return self.lock_guess(eligible[0].id, noisy)
            else:
                changed = False
                for bot in self._ffa_guessers():
                    if bot.is_bot and bot.id not in self._ffa_guesses:
                        noisy = rules.clamp_angle(target + self.rng.gauss(0, 14.0)) or 0.0
                        self.lock_guess(bot.id, noisy)
                        changed = True
                        if self.phase != "guessing":
                            break
                return changed

        if self.phase == "bonus":
            changed = False
            for opp in self._opposing_teams():
                if opp.id not in self.bonus_votes:
                    members = [p for p in self.players if p.team_id == opp.id]
                    if members and all(p.is_bot for p in members):
                        true_dir: BonusDirection = "left" if target < self.needle else "right"
                        opp_dir: BonusDirection = "right" if true_dir == "left" else "left"
                        pick = true_dir if self.rng.random() < 0.65 else opp_dir
                        self.submit_bonus(members[0].id, pick)
                        changed = True
                        if self.phase != "bonus":
                            break
            return changed

        return False

    # Alias for callers
    step_bots = tick_bots

    # ---- Serialization & Broadcast ------------------------------------------

    def psychic_secret_msg(self) -> dict[str, Any] | None:
        if self._target is None or self.phase not in ("psychic", "guessing", "bonus", "reveal"):
            return None
        return {
            "type": "psychic_secret",
            "round": self.round,
            "target": self._target,
        }

    async def send_private(self, only_pid: str | None = None) -> None:
        """Sends the secret target angle only to the current Psychic's socket."""
        sec = self.psychic_secret_msg()
        if sec is None or not self.psychic_id:
            return
        if only_pid is not None and only_pid != self.psychic_id:
            return
        ws = self.player_conns.get(self.psychic_id)
        if ws is not None:
            try:
                await ws.send_json(sec)
            except Exception:
                pass

    def state_dict(self) -> dict[str, Any]:
        pool = self._card_pool()
        active_team_id = (
            self.teams[self.active_team_idx].id
            if self.mode == "teams" and self.teams
            else None
        )
        bullseye_pts, close_pts, near_pts = rules.band_values(self.preset)
        return {
            "type": "state",
            "code": self.code,
            "phase": self.phase,
            "mode": self.mode,
            "round": self.round,
            "players": [p.to_dict() for p in self.players],
            "teams": [t.to_dict() for t in self.teams],
            "activeTeamId": active_team_id,
            "psychicId": self.psychic_id,
            "card": list(self.card) if self.card else None,
            "clue": self.clue,
            "clueSpoken": self.clue_spoken,
            "needle": self.needle,
            "lockedBy": self.locked_by,
            "ffaLockedIds": list(self._ffa_guesses.keys()),
            "bonusVotes": dict(self.bonus_votes),
            "settings": {
                "preset": self.preset,
                "bands": [bullseye_pts, close_pts, near_pts],
                "leftRightBonus": self.left_right_bonus,
                "catchupRule": self.catchup_rule,
                "targetScore": self.target_score,
                "packs": list(self.packs),
                "customCount": len(self.custom_cards),
                "deckSize": len(pool),
            },
            "decks": deck_catalog(),
            "coop": {
                "score": self.coop_score,
                "cardsRemaining": self.coop_cards_remaining,
                "bonusCards": self.coop_bonus_cards,
                "rating": (
                    rules.coop_rating(self.coop_score)
                    if self.phase == "gameover" and self.mode == "coop"
                    else None
                ),
            },
            "reveal": self.reveal,
            "winners": list(self.winners),
            "canStart": self.can_start(),
            "minPlayers": MIN_PLAYERS_TO_START,
        }

    async def broadcast_state(self) -> None:
        self._dirty = False
        msg = self.state_dict()
        dead_tv: list[Conn] = []
        for ws in list(self.tv_conns):
            try:
                await ws.send_json(msg)
            except Exception:
                dead_tv.append(ws)
        for ws in dead_tv:
            self.tv_conns.discard(ws)

        for pid, ws in list(self.player_conns.items()):
            try:
                await ws.send_json(msg)
            except Exception:
                self.mark_disconnected(pid)
                self.player_conns.pop(pid, None)
        await self.send_private()

    async def broadcast_avatars(self) -> None:
        msg = self.avatars_msg()
        for ws in list(self.tv_conns):
            try:
                await ws.send_json(msg)
            except Exception:
                self.tv_conns.discard(ws)
        for pid, ws in list(self.player_conns.items()):
            try:
                await ws.send_json(msg)
            except Exception:
                self.mark_disconnected(pid)
                self.player_conns.pop(pid, None)


class WavelengthRoomManager:
    def __init__(self, *, clock: Callable[[], float] = time.monotonic) -> None:
        self.rooms: dict[str, WavelengthRoom] = {}
        self.clock = clock
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def _generate_code(self) -> str:
        for _ in range(100):
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
            if code not in self.rooms:
                return code
        raise RoomLimitError("Could not allocate room code.")

    def create_room(self) -> WavelengthRoom:
        self.reap_idle()
        if len(self.rooms) >= MAX_ROOMS:
            raise RoomLimitError("Too many active rooms.")
        code = self._generate_code()
        room = WavelengthRoom(code, clock=self.clock)
        self.rooms[code] = room
        try:
            loop = asyncio.get_running_loop()
            self._tasks[code] = loop.create_task(self._room_loop(room))
        except RuntimeError:
            pass
        return room

    def get(self, raw_code: object) -> WavelengthRoom | None:
        code = normalize_code(raw_code)
        if not code:
            return None
        return self.rooms.get(code)

    def reap_idle(self) -> None:
        now = self.clock()
        stale = [
            code
            for code, r in self.rooms.items()
            if not r.tv_conns and (now - r.last_active) > ROOM_IDLE_SECONDS
        ]
        for code in stale:
            self.close_room(code)

    def close_room(self, code: str) -> None:
        self.rooms.pop(code, None)
        task = self._tasks.pop(code, None)
        if task:
            task.cancel()

    async def _room_loop(self, room: WavelengthRoom) -> None:
        try:
            while room.code in self.rooms:
                await asyncio.sleep(LOOP_SECONDS)
                if not room.tv_conns and (self.clock() - room.last_active) > ROOM_IDLE_SECONDS:
                    self.close_room(room.code)
                    return
                if room.tick_bots() or room._dirty:
                    await room.broadcast_state()
        except asyncio.CancelledError:
            return
