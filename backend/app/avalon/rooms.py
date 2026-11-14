"""Rooms and turn flow for The Resistance: Avalon.

Turn-based, so state is broadcast whenever a player or the host acts. A slow
loop per room only drives bots and closes idle rooms. Game logic is synchronous
and clock-injectable so it can be tested without sockets.

Phases:
  lobby         - 5-10 players join; host orders seats, toggles optional roles, and starts
  night         - Role Review: TV narrates the eyes-closed script; phones hold-to-reveal role
  team_building - Current Leader selects quest_size players to propose for the Quest
  team_vote     - Every player secretly votes Approve or Reject on the proposed Team
  team_reveal   - All votes are revealed simultaneously; majority Approve -> quest, else next Leader
  quest         - Selected Team members secretly play Success (or Fail, if Evil)
  quest_reveal  - Played Quest cards are revealed; 3 Fails -> Evil wins, 3 Successes -> assassinate
  assassinate   - The Assassin names one Good player as Merlin
  gameover      - Winner, reason, and all character cards revealed
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import hmac
import logging
import random
import secrets
import time
from dataclasses import dataclass
from typing import Any, Callable, Protocol

from app.avalon import rules
from app.shared.rooms_util import (
    CODE_ALPHABET,
    CODE_LENGTH,
    JoinError,
    RoomLimitError,
    normalize_code,
    normalize_name,
)

log = logging.getLogger(__name__)

MAX_PLAYERS = rules.MAX_PLAYERS  # 10
MIN_PLAYERS_TO_START = rules.MIN_PLAYERS  # 5
MAX_ROOMS = 20
BOT_DELAY_SECONDS = 1.2
LOOP_SECONDS = 0.25
ROOM_IDLE_SECONDS = 10 * 60

AVATAR_PREFIX = "data:image/jpeg;base64,"
MAX_AVATAR_BYTES = 18_000
AVATAR_COOLDOWN_SECONDS = 2.0

COLORS = [
    "#3b82f6",  # royal blue
    "#ef4444",  # crimson
    "#10b981",  # emerald
    "#f59e0b",  # amber gold
    "#8b5cf6",  # amethyst
    "#ec4899",  # rose
    "#06b6d4",  # cyan
    "#84cc16",  # lime
    "#f97316",  # tangerine
    "#e2e8f0",  # silver
]
assert len(COLORS) >= MAX_PLAYERS

BOT_NAMES = [
    "Arthur",
    "Lancelot",
    "Guinevere",
    "Gawain",
    "Galahad",
    "Tristan",
    "Isolde",
    "Bedivere",
    "Kay",
    "Bors",
]


class Conn(Protocol):
    async def send_json(self, data: Any) -> None: ...


@dataclass
class AvalonPlayer:
    id: str
    name: str
    color: str
    is_bot: bool = False
    connected: bool = True
    device: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "color": self.color,
            "isBot": self.is_bot,
            "connected": self.connected,
        }


def validate_avatar(data: object) -> str | None:
    """A small JPEG data URL, or None. Checked by decoding, not just by prefix."""
    if not isinstance(data, str) or not data.startswith(AVATAR_PREFIX):
        return None
    b64 = data[len(AVATAR_PREFIX) :]
    if len(b64) > (MAX_AVATAR_BYTES * 4) // 3 + 4:
        return None
    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        return None
    if (
        len(raw) > MAX_AVATAR_BYTES
        or not raw.startswith(b"\xff\xd8\xff")
        or not raw.rstrip(b"\x00").endswith(b"\xff\xd9")
    ):
        return None
    return AVATAR_PREFIX + base64.b64encode(raw).decode("ascii")


class AvalonRoom:
    def __init__(
        self,
        code: str,
        rng: random.Random | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.code = code
        self._rng = rng or random.Random(secrets.randbits(64))
        self._clock = clock
        self.players: dict[str, AvalonPlayer] = {}
        self.seats: list[str] = []  # seating order around the table
        self.phase = "lobby"

        # Optional roles enabled by host in lobby: subset of OPTIONAL_ROLES
        self.optional_roles: set[str] = {"percival", "morgana", "mordred"}

        # Secret per-game state (never leaked in public state_dict until gameover)
        self.roles: dict[str, str] = {}
        self.sightings: dict[str, dict[str, Any]] = {}

        # Quest & round progression
        self.round_num = 1  # 1..5
        self.proposal_num = 1  # 1..5 within the current round (5th rejection -> Evil wins)
        self.rejected_count = 0  # 0..5 rejected teams in this round
        self.leader_id: str | None = None
        self.night_ready: set[str] = set()

        # Current proposal & voting
        self.draft_team: list[str] = []
        self.proposed_team: list[str] = []
        self.votes: dict[str, bool] = {}  # player_id -> True (Approve) / False (Reject)
        self.last_vote_reveal: dict[str, Any] | None = None

        # Current quest cards
        self.quest_cards: dict[str, bool] = {}  # player_id -> True (Success) / False (Fail)
        self.last_quest_reveal: dict[str, Any] | None = None
        self.quest_results: list[dict[str, Any] | None] = [None] * rules.TOTAL_QUESTS

        # Public log of all team proposals and quest outcomes
        self.history: list[dict[str, Any]] = []

        # End-game state
        self.assassin_target_id: str | None = None
        self.winner: str | None = None  # 'good' | 'evil' | None
        self.win_reason: str | None = None

        # Selfies & connections
        self.avatars: dict[str, str] = {}
        self._avatar_at: dict[str, float] = {}
        self._phase_since = clock()
        self.tv_conns: set[Conn] = set()
        self.player_conns: dict[str, Conn] = {}
        self.host_device: str | None = None
        self.last_activity = clock()

    # ---- Players & Lobby -------------------------------------------------

    def touch(self) -> None:
        self.last_activity = self._clock()

    def is_host(self, device: str | None) -> bool:
        return bool(device and self.host_device) and hmac.compare_digest(device, self.host_device)

    def add_player(
        self, raw_name: object, is_bot: bool = False, device: str | None = None
    ) -> AvalonPlayer:
        name = normalize_name(raw_name)
        for p in self.players.values():
            if p.name.casefold() != name.casefold():
                continue
            if p.is_bot or is_bot:
                raise JoinError("That name is taken.")
            if p.device is not None:
                if device is not None and hmac.compare_digest(device, p.device):
                    p.connected = True
                    return p
                raise JoinError("That name is taken. On a new phone? Add a letter to your name.")
            if not p.connected:
                p.connected = True
                return p
            raise JoinError("That name is taken.")

        if self.phase != "lobby":
            raise JoinError("This game has already started. Ask a player if you need to rejoin their seat.")
        if len(self.players) >= MAX_PLAYERS:
            raise JoinError("This game is full (max 10 players).")

        used = {p.color for p in self.players.values()}
        color = next(c for c in COLORS if c not in used)
        player = AvalonPlayer(
            id=secrets.token_hex(4),
            name=name,
            color=color,
            is_bot=is_bot,
            device=None if is_bot else device,
        )
        self.players[player.id] = player
        self.seats.append(player.id)
        self.touch()
        return player

    def mark_disconnected(self, player_id: str) -> None:
        p = self.players.get(player_id)
        if p:
            p.connected = False

    def remove_player(self, player_id: str) -> None:
        if player_id not in self.players:
            return
        self.players.pop(player_id)
        self.seats = [s for s in self.seats if s != player_id]
        self.avatars.pop(player_id, None)
        if self.phase != "lobby":
            # In a hidden-role game, removing a player mid-game invalidates the role split;
            # return cleanly to the lobby if fewer than MIN_PLAYERS_TO_START remain or reset.
            self._to_lobby()

    def add_bot(self) -> AvalonPlayer | None:
        if self.phase != "lobby" or len(self.players) >= MAX_PLAYERS:
            return None
        taken = {p.name for p in self.players.values()}
        for name in BOT_NAMES:
            if name not in taken:
                try:
                    return self.add_player(name, is_bot=True)
                except JoinError:
                    return None
        return None

    def remove_bot(self) -> bool:
        if self.phase != "lobby":
            return False
        bots = [pid for pid in self.seats if self.players[pid].is_bot]
        if not bots:
            return False
        self.remove_player(bots[-1])
        return True

    def move_seat(self, player_id: object, direction: object) -> bool:
        """Lobby only: moves a player one seat earlier (-1) or later (+1)."""
        if self.phase != "lobby" or player_id not in self.seats or direction not in (-1, 1):
            return False
        i = self.seats.index(player_id)  # type: ignore[arg-type]
        j = i + direction  # type: ignore[operator]
        if not 0 <= j < len(self.seats):
            return False
        self.seats[i], self.seats[j] = self.seats[j], self.seats[i]
        return True

    def toggle_role(self, role: object) -> bool:
        """Lobby only: toggles an optional character card."""
        if self.phase != "lobby" or not isinstance(role, str) or role not in rules.OPTIONAL_ROLES:
            return False
        if role == "mordred":
            return False  # Mordred is always selected and cannot be toggled off
        if role in self.optional_roles:
            self.optional_roles.remove(role)
        else:
            self.optional_roles.add(role)
        return True

    def set_avatar(self, player_id: str, data: object) -> bool:
        """A player's selfie (or None to remove it)."""
        if player_id not in self.players:
            return False
        now = self._clock()
        if now - self._avatar_at.get(player_id, -1e9) < AVATAR_COOLDOWN_SECONDS:
            return False
        self._avatar_at[player_id] = now
        if data is None:
            return self.avatars.pop(player_id, None) is not None
        url = validate_avatar(data)
        if url is None:
            return False
        self.avatars[player_id] = url
        return True

    # ---- Helpers ---------------------------------------------------------

    @property
    def num_players(self) -> int:
        return len(self.seats)

    @property
    def current_quest_size(self) -> int:
        n = max(rules.MIN_PLAYERS, min(rules.MAX_PLAYERS, self.num_players))
        idx = max(0, min(rules.TOTAL_QUESTS - 1, self.round_num - 1))
        return rules.QUEST_TEAM_SIZES[n][idx]

    @property
    def assassin_id(self) -> str | None:
        for pid, r in self.roles.items():
            if r == "assassin":
                return pid
        return None

    def _seat_after(self, player_id: str | None) -> str | None:
        if not self.seats:
            return None
        if player_id not in self.seats:
            return self.seats[0]
        return self.seats[(self.seats.index(player_id) + 1) % len(self.seats)]

    def can_start(self) -> bool:
        return self.phase == "lobby" and MIN_PLAYERS_TO_START <= len(self.seats) <= MAX_PLAYERS

    # ---- Game Flow -------------------------------------------------------

    def start(self) -> bool:
        """Starts the game: deals roles, computes Night sightings, and enters 'night'."""
        if not self.can_start():
            return False
        self.roles = rules.deal_roles(self.seats, self.optional_roles, self._rng)
        self.sightings = rules.compute_sightings(self.seats, self.roles)
        self.round_num = 1
        self.proposal_num = 1
        self.rejected_count = 0
        self.leader_id = self._rng.choice(self.seats)
        self.night_ready = {pid for pid in self.seats if self.players[pid].is_bot}
        self.draft_team = []
        self.proposed_team = []
        self.votes = {}
        self.last_vote_reveal = None
        self.quest_cards = {}
        self.last_quest_reveal = None
        self.quest_results = [None] * rules.TOTAL_QUESTS
        self.history = []
        self.assassin_target_id = None
        self.winner = None
        self.win_reason = None
        self.phase = "night"
        self._phase_since = self._clock()
        return True

    def mark_night_ready(self, player_id: str) -> bool:
        """A player confirms they have reviewed their secret role during the Night phase."""
        if self.phase != "night" or player_id not in self.players:
            return False
        self.night_ready.add(player_id)
        if len(self.night_ready) >= len(self.seats):
            self._enter_team_building()
        return True

    def advance(self, by_player_id: str | None = None) -> bool:
        """Advances from night, team_reveal, or quest_reveal to the next phase.

        Can be triggered by the TV host (by_player_id=None) or by the current Leader on their phone.
        """
        if by_player_id is not None and by_player_id != self.leader_id:
            return False

        if self.phase == "night":
            self._enter_team_building()
            return True
        if self.phase == "team_reveal":
            if self.last_vote_reveal and self.last_vote_reveal.get("approved"):
                self._enter_quest()
            else:
                self.leader_id = self._seat_after(self.leader_id)
                self.proposal_num += 1
                self._enter_team_building()
            return True
        if self.phase == "quest_reveal":
            self.round_num += 1
            self.proposal_num = 1
            self.rejected_count = 0
            self.leader_id = self._seat_after(self.leader_id)
            self._enter_team_building()
            return True
        return False

    def _enter_team_building(self) -> None:
        self.phase = "team_building"
        self.draft_team = []
        self.proposed_team = []
        self.votes = {}
        self._phase_since = self._clock()

    def select_team(self, player_id: str, team_ids: object) -> bool:
        """Leader updates the draft team on the board before calling for a vote."""
        if self.phase != "team_building" or player_id != self.leader_id:
            return False
        cleaned = self._clean_team_list(team_ids, allow_partial=True)
        if cleaned is None:
            return False
        self.draft_team = cleaned
        return True

    def propose_team(self, player_id: str, team_ids: object) -> bool:
        """Leader locks in the proposed Quest Team and calls for a Team Vote."""
        if self.phase != "team_building" or player_id != self.leader_id:
            return False
        cleaned = self._clean_team_list(team_ids, allow_partial=False)
        if cleaned is None:
            return False
        self.draft_team = list(cleaned)
        self.proposed_team = list(cleaned)
        self.votes = {}
        self.phase = "team_vote"
        self._phase_since = self._clock()
        return True

    def _clean_team_list(self, team_ids: object, *, allow_partial: bool) -> list[str] | None:
        if not isinstance(team_ids, list):
            return None
        req = self.current_quest_size
        seen: set[str] = set()
        ordered: list[str] = []
        for item in team_ids:
            if not isinstance(item, str) or item not in self.players or item in seen:
                return None
            seen.add(item)
            ordered.append(item)
        if len(ordered) > req:
            return None
        if not allow_partial and len(ordered) != req:
            return None
        # Return in canonical seat order
        return [pid for pid in self.seats if pid in seen]

    def vote(self, player_id: str, approve: object) -> bool:
        """Player secretly casts or changes their Approve/Reject vote."""
        if self.phase != "team_vote" or player_id not in self.players or not isinstance(approve, bool):
            return False
        self.votes[player_id] = approve
        if len(self.votes) >= len(self.seats):
            self._resolve_votes()
        return True

    def _resolve_votes(self) -> None:
        approves = sum(1 for v in self.votes.values() if v)
        rejects = len(self.votes) - approves
        approved = approves > rejects  # Ties are rejected per rulebook page 4
        votes_by_seat = {pid: self.votes[pid] for pid in self.seats if pid in self.votes}

        if not approved:
            self.rejected_count += 1

        reveal_record = {
            "round": self.round_num,
            "proposal": self.proposal_num,
            "leaderId": self.leader_id,
            "teamIds": list(self.proposed_team),
            "votes": votes_by_seat,
            "approves": approves,
            "rejects": rejects,
            "approved": approved,
        }
        self.last_vote_reveal = reveal_record
        self.history.append({"kind": "vote", **reveal_record})

        if not approved and self.rejected_count >= rules.MAX_REJECTED_VOTES:
            self.phase = "gameover"
            self.winner = "evil"
            self.win_reason = "Five Teams were rejected in a single round."
            self._phase_since = self._clock()
            return

        self.phase = "team_reveal"
        self._phase_since = self._clock()

    def _enter_quest(self) -> None:
        self.phase = "quest"
        self.quest_cards = {}
        self._phase_since = self._clock()

    def submit_quest_card(self, player_id: str, success: object) -> bool:
        """Team member submits a Quest Success or Fail card.

        Per rulebook page 5: 'The Good players must select the Quest Success card;
        Evil may select either the Quest Success or Quest Fail card.'
        """
        if (
            self.phase != "quest"
            or player_id not in self.proposed_team
            or player_id in self.quest_cards
            or not isinstance(success, bool)
        ):
            return False
        alignment = rules.role_alignment(self.roles[player_id])
        if alignment == "good" and not success:
            return False
        self.quest_cards[player_id] = success
        if len(self.quest_cards) >= len(self.proposed_team):
            self._resolve_quest()
        return True

    def _resolve_quest(self) -> None:
        cards = list(self.quest_cards.values())
        self._rng.shuffle(cards)
        success_count = sum(1 for c in cards if c)
        fail_count = len(cards) - success_count
        succeeded = rules.quest_succeeded(self.num_players, self.round_num, fail_count)

        result = {
            "quest": self.round_num,
            "leaderId": self.leader_id,
            "teamIds": list(self.proposed_team),
            "cards": ["success" if c else "fail" for c in cards],
            "successCount": success_count,
            "failCount": fail_count,
            "failsRequired": rules.fails_required(self.num_players, self.round_num),
            "succeeded": succeeded,
        }
        self.last_quest_reveal = result
        self.quest_results[self.round_num - 1] = result
        self.history.append({"kind": "quest", **result})

        completed = [q for q in self.quest_results if q is not None]
        good_wins = sum(1 for q in completed if q["succeeded"])
        evil_wins = sum(1 for q in completed if not q["succeeded"])

        if evil_wins >= rules.QUESTS_TO_WIN:
            self.phase = "gameover"
            self.winner = "evil"
            self.win_reason = "Three Quests ended in failure."
            self._phase_since = self._clock()
            return

        if good_wins >= rules.QUESTS_TO_WIN:
            # Enter Assassinate Merlin phase
            self.phase = "assassinate"
            self._phase_since = self._clock()
            return

        self.phase = "quest_reveal"
        self._phase_since = self._clock()

    def assassinate(self, player_id: str, target_id: object) -> bool:
        """The Assassin names one Good player as Merlin."""
        if (
            self.phase != "assassinate"
            or player_id != self.assassin_id
            or not isinstance(target_id, str)
            or target_id not in self.players
            or target_id == player_id
        ):
            return False
        # The Assassin must target a Good player (or any non-Evil player)
        if rules.role_alignment(self.roles[target_id]) == "evil":
            return False

        self.assassin_target_id = target_id
        target_name = self.players[target_id].name
        merlin_id = next((pid for pid, r in self.roles.items() if r == "merlin"), None)
        merlin_name = self.players[merlin_id].name if merlin_id else "Merlin"

        self.phase = "gameover"
        self._phase_since = self._clock()
        if target_id == merlin_id:
            self.winner = "evil"
            self.win_reason = f"The Assassin struck down {target_name}, who was Merlin!"
        else:
            self.winner = "good"
            self.win_reason = (
                f"The Assassin named {target_name}, but {merlin_name} was Merlin! "
                "Camelot prevails!"
            )
        return True

    def skip_unresponsive(self) -> bool:
        """Host skip control to unstick the game if someone's phone died."""
        if self.phase == "night":
            self._enter_team_building()
            return True
        if self.phase == "team_building":
            # Auto-propose a random team for the Leader
            if self.leader_id:
                team = self._rng.sample(self.seats, self.current_quest_size)
                return self.propose_team(self.leader_id, team)
            return False
        if self.phase == "team_vote":
            for pid in self.seats:
                if pid not in self.votes:
                    self.votes[pid] = True
            self._resolve_votes()
            return True
        if self.phase == "quest":
            for pid in self.proposed_team:
                if pid not in self.quest_cards:
                    self.quest_cards[pid] = True
            self._resolve_quest()
            return True
        if self.phase in ("team_reveal", "quest_reveal"):
            return self.advance()
        if self.phase == "assassinate" and self.assassin_id:
            good_ids = [
                pid for pid in self.seats if rules.role_alignment(self.roles[pid]) == "good"
            ]
            if good_ids:
                return self.assassinate(self.assassin_id, self._rng.choice(good_ids))
        return False

    def play_again(self) -> bool:
        """Resets the room back to the lobby keeping all connected players."""
        if self.phase == "lobby":
            return False
        self._to_lobby()
        return True

    def _to_lobby(self) -> None:
        self.phase = "lobby"
        self.roles = {}
        self.sightings = {}
        self.round_num = 1
        self.proposal_num = 1
        self.rejected_count = 0
        self.leader_id = None
        self.night_ready = set()
        self.draft_team = []
        self.proposed_team = []
        self.votes = {}
        self.last_vote_reveal = None
        self.quest_cards = {}
        self.last_quest_reveal = None
        self.quest_results = [None] * rules.TOTAL_QUESTS
        self.history = []
        self.assassin_target_id = None
        self.winner = None
        self.win_reason = None
        self._phase_since = self._clock()

    # ---- Bots ------------------------------------------------------------

    def tick(self) -> bool:
        """Drives bot actions after a short delay. Returns True if state changed."""
        if self.phase == "lobby" or self.phase == "gameover":
            return False
        if self._clock() - self._phase_since < BOT_DELAY_SECONDS:
            return False

        if self.phase == "night":
            # If all players are bots, advance automatically
            if all(self.players[pid].is_bot for pid in self.seats):
                self._enter_team_building()
                return True
            return False

        if self.phase == "team_building":
            leader = self.players.get(self.leader_id or "")
            if leader and leader.is_bot:
                team = self._bot_choose_team(leader.id)
                return self.propose_team(leader.id, team)
            return False

        if self.phase == "team_vote":
            for pid in self.seats:
                p = self.players[pid]
                if p.is_bot and pid not in self.votes:
                    approve = self._bot_choose_vote(pid)
                    return self.vote(pid, approve)
            return False

        if self.phase == "quest":
            for pid in self.proposed_team:
                p = self.players[pid]
                if p.is_bot and pid not in self.quest_cards:
                    card = self._bot_choose_quest_card(pid)
                    return self.submit_quest_card(pid, card)
            return False

        if self.phase == "assassinate":
            assassin = self.players.get(self.assassin_id or "")
            if assassin and assassin.is_bot:
                good_ids = [
                    pid for pid in self.seats if rules.role_alignment(self.roles[pid]) == "good"
                ]
                if good_ids:
                    return self.assassinate(assassin.id, self._rng.choice(good_ids))
            return False

        return False

    def _bot_choose_team(self, bot_id: str) -> list[str]:
        req = self.current_quest_size
        others = [pid for pid in self.seats if pid != bot_id]
        picks = [bot_id] + self._rng.sample(others, max(0, req - 1))
        return [pid for pid in self.seats if pid in picks]

    def _bot_choose_vote(self, bot_id: str) -> bool:
        # On the 5th proposal, Good bots always approve so Evil doesn't win by default
        if self.rejected_count >= 4 and rules.role_alignment(self.roles[bot_id]) == "good":
            return True
        if bot_id == self.leader_id:
            return True
        if self.roles[bot_id] == "merlin":
            evil_seen = set(self.sightings[bot_id]["seenIds"])
            if any(pid in evil_seen for pid in self.proposed_team):
                return False
            return True
        return self._rng.random() < 0.65

    def _bot_choose_quest_card(self, bot_id: str) -> bool:
        if rules.role_alignment(self.roles[bot_id]) == "good":
            return True
        # Evil bots usually play Fail, especially on later quests
        return self._rng.random() < 0.15

    # ---- Serialization & Broadcasts --------------------------------------

    def state_dict(self) -> dict[str, Any]:
        n = max(rules.MIN_PLAYERS, min(rules.MAX_PLAYERS, len(self.seats) or rules.MIN_PLAYERS))
        good_count, evil_count = rules.ALIGNMENT_SPLIT[n]
        active_opt = rules.effective_optional_roles(n, self.optional_roles)

        # Reveal Assassin & known Minions of Mordred during 'assassinate' so Evil can discuss openly
        evil_discuss_ids: list[str] = []
        if self.phase in ("assassinate", "gameover"):
            evil_discuss_ids = [
                pid
                for pid in self.seats
                if pid in self.roles
                and rules.role_alignment(self.roles[pid]) == "evil"
                and self.roles[pid] != "oberon"
            ]

        revealed_roles: dict[str, dict[str, str]] | None = None
        if self.phase == "gameover":
            revealed_roles = {
                pid: {
                    "role": r,
                    "name": rules.ROLE_METADATA[r]["name"],
                    "alignment": rules.ROLE_METADATA[r]["alignment"],
                    "title": rules.ROLE_METADATA[r]["title"],
                }
                for pid, r in self.roles.items()
            }

        return {
            "type": "state",
            "code": self.code,
            "phase": self.phase,
            "players": [self.players[pid].to_dict() for pid in self.seats],
            "leaderId": self.leader_id,
            "round": self.round_num,
            "proposal": self.proposal_num,
            "rejectedCount": self.rejected_count,
            "questSize": self.current_quest_size,
            "alignmentCount": {"good": good_count, "evil": evil_count},
            "optionalRoles": sorted(self.optional_roles),
            "activeOptionalRoles": active_opt,
            "nightScript": rules.build_night_script(active_opt),
            "nightReadyIds": [pid for pid in self.seats if pid in self.night_ready],
            "questSpecs": rules.quest_specs(n),
            "questResults": self.quest_results,
            "draftTeam": list(self.draft_team),
            "proposedTeam": list(self.proposed_team),
            "votedIds": [pid for pid in self.seats if pid in self.votes],
            "questSubmittedIds": [pid for pid in self.proposed_team if pid in self.quest_cards],
            "lastVoteReveal": self.last_vote_reveal,
            "lastQuestReveal": self.last_quest_reveal,
            "history": self.history,
            "assassinId": self.assassin_id if self.phase in ("assassinate", "gameover") else None,
            "evilDiscussIds": evil_discuss_ids,
            "assassinTargetId": self.assassin_target_id,
            "winner": self.winner,
            "winReason": self.win_reason,
            "revealedRoles": revealed_roles,
            "canStart": self.can_start(),
            "minPlayers": MIN_PLAYERS_TO_START,
            "maxPlayers": MAX_PLAYERS,
        }

    def private_msg(self, player_id: str) -> dict[str, Any] | None:
        """Private message sent only to player_id's WebSocket."""
        if self.phase == "lobby" or player_id not in self.sightings:
            return None
        info = self.sightings[player_id]
        return {
            "type": "role_secret",
            "role": info["role"],
            "name": info["name"],
            "alignment": info["alignment"],
            "title": info["title"],
            "power": info["power"],
            "seenIds": info["seenIds"],
            "seenLabel": info["seenLabel"],
            "seenNote": info["seenNote"],
            "myVote": self.votes.get(player_id),
            "myQuestCard": self.quest_cards.get(player_id),
        }

    def avatars_msg(self) -> dict[str, Any]:
        return {"type": "avatars", "avatars": dict(self.avatars)}

    async def broadcast_avatars(self) -> None:
        await self._send_all(
            self.avatars_msg(), list(self.tv_conns) + list(self.player_conns.values())
        )

    async def broadcast_state(self) -> None:
        await self._send_all(
            self.state_dict(), list(self.tv_conns) + list(self.player_conns.values())
        )

    async def send_private(self, player_id: str | None = None) -> None:
        targets = [player_id] if player_id else list(self.player_conns.keys())
        for pid in targets:
            conn = self.player_conns.get(pid)
            msg = self.private_msg(pid)
            if conn is not None and msg is not None:
                await self._send_all(msg, [conn])

    @staticmethod
    async def _send_all(msg: dict[str, Any], conns: list[Conn]) -> None:
        for conn in conns:
            try:
                await conn.send_json(msg)
            except Exception:
                pass


class AvalonRoomManager:
    def __init__(self) -> None:
        self.rooms: dict[str, AvalonRoom] = {}
        self._tasks: dict[str, asyncio.Task] = {}

    def create_room(self) -> AvalonRoom:
        if len(self.rooms) >= MAX_ROOMS:
            raise RoomLimitError()
        for _ in range(50):
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
            if code not in self.rooms:
                break
        else:
            raise RoomLimitError()
        room = AvalonRoom(code)
        self.rooms[code] = room
        self._tasks[code] = asyncio.create_task(self._run(room))
        log.info("avalon room created (%d active)", len(self.rooms))
        return room

    def get(self, raw_code: object) -> AvalonRoom | None:
        code = normalize_code(raw_code)
        return self.rooms.get(code) if code else None

    def close_room(self, code: str) -> None:
        self.rooms.pop(code, None)
        task = self._tasks.pop(code, None)
        if task and task is not asyncio.current_task():
            task.cancel()

    async def _run(self, room: AvalonRoom) -> None:
        try:
            while True:
                await asyncio.sleep(LOOP_SECONDS)
                if room.tick():
                    await room.broadcast_state()
                    await room.send_private()
                if (
                    not room.tv_conns
                    and time.monotonic() - room.last_activity > ROOM_IDLE_SECONDS
                ):
                    log.info("closing idle avalon room")
                    self.close_room(room.code)
                    return
        except asyncio.CancelledError:
            pass
        except Exception:  # pragma: no cover
            log.exception("avalon room loop crashed")
            self.close_room(room.code)
