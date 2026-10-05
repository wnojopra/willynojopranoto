"""Game structure: round plan, and end-of-game awards.

Pure functions so they're easy to test. Room (rooms.py) owns the state.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Protocol

# Number of regular rounds before the Final Séance.
LENGTHS = {"short": 6, "standard": 9, "long": 12}
DEFAULT_LENGTH = "standard"
# 1-based round slots that are Medium rounds (never round 1).
MEDIUM_SLOTS = {"short": (3, 5), "standard": (3, 7), "long": (3, 7, 10)}


def make_plan(length: str) -> list[str]:
    """Round kinds for a game: "bets" | "medium", then "final"."""
    n = LENGTHS.get(length, LENGTHS[DEFAULT_LENGTH])
    slots = MEDIUM_SLOTS.get(length, MEDIUM_SLOTS[DEFAULT_LENGTH])
    return ["medium" if i in slots else "bets" for i in range(1, n + 1)] + ["final"]


class AwardSubject(Protocol):
    id: str
    name: str
    is_bot: bool
    score: int
    haunted: int
    solo_wins: int
    mind_reads: int
    open_book: int
    liar_rounds: int
    pull_effort: float


@dataclass(frozen=True)
class AwardDef:
    key: str
    emoji: str
    title: str
    blurb: str
    humans_only: bool = False


AWARDS = [
    AwardDef("grand_medium", "👑", "Grand Medium", "Most candy. The spirits favor you."),
    AwardDef("most_haunted", "💀", "Most Haunted", "The board kept choosing you. The Final Curse is yours."),
    AwardDef("lone_wolf", "🐺", "Lone Wolf", "Called it alone the most times."),
    AwardDef("mind_reader", "🧠", "Mind Reader", "Read the Medium's mind the most."),
    AwardDef("open_book", "📖", "Open Book", "The Medium everyone saw right through."),
    AwardDef("biggest_liar", "🤥", "Biggest Liar", "Kept pulling away from their own bet.", humans_only=True),
    AwardDef("strongest_pull", "🧲", "Strongest Pull", "Dragged the planchette the hardest.", humans_only=True),
]

_VALUE = {
    "grand_medium": lambda p: p.score,
    "most_haunted": lambda p: p.haunted,
    "lone_wolf": lambda p: p.solo_wins,
    "mind_reader": lambda p: p.mind_reads,
    "open_book": lambda p: p.open_book,
    "biggest_liar": lambda p: p.liar_rounds,
    "strongest_pull": lambda p: round(p.pull_effort),
}


def compute_awards(players: Iterable[AwardSubject]) -> list[dict]:
    """Each award goes to whoever has the highest non-zero stat (ties share)."""
    players = list(players)
    out = []
    for award in AWARDS:
        pool = [p for p in players if not (award.humans_only and p.is_bot)]
        value = _VALUE[award.key]
        best = max((value(p) for p in pool), default=0)
        if best <= 0:
            continue
        winners = [p.id for p in pool if value(p) == best]
        out.append(
            {
                "key": award.key,
                "emoji": award.emoji,
                "title": award.title,
                "blurb": award.blurb,
                "playerIds": winners,
                "value": best,
            }
        )
    return out
