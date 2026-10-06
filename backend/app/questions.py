"""Question decks.

Board kinds:
  who   - every player's name is a spot
  yesno - YES / NO / MAYBE / ASK AGAIN
  pick  - 3-5 silly options (keep labels short; they're drawn on the board)

"{player}" is replaced with a random human player's name.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass


@dataclass(frozen=True)
class Question:
    kind: str  # "who" | "yesno" | "pick"
    text: str
    options: tuple[str, ...] = ()


YES_NO_SPOTS = [
    ("yes", "YES"),
    ("no", "NO"),
    ("maybe", "MAYBE"),
    ("ask_again", "ASK AGAIN"),
]

# Spirit Bets rounds.
DECK: list[Question] = [
    Question("who", "Who would be the first to die in a horror movie?"),
    Question("who", "Who would hook up with the ghost instead of running?"),
    Question("who", "Who would sell out the whole group to the demon for $50?"),
    Question("who", "Who has the most haunted search history?"),
    Question("who", "Who would get possessed and nobody would notice?"),
    Question("who", "Who would read the cursed book out loud \u201cjust to see\u201d?"),
    Question("who", "Who would try to start an OnlyFans with the ghost?"),
    Question("who", "Who would charge the demon rent?"),
    Question("who", "Who is most likely to have a body in their basement?"),
    Question("who", "Who would survive the horror movie by sacrificing everyone else?"),
    Question("yesno", "Is {player} the real reason the lights keep flickering?"),
    Question("yesno", "Has {player} ever ghosted someone worse than an actual ghost?"),
    Question("yesno", "Would {player} survive a zombie apocalypse past day 2?"),
    Question("yesno", "Will {player} survive the night?"),
    Question(
        "pick",
        "What is {player}\u2019s ghost form?",
        ("Victorian child", "Slutty spirit", "HOA ghost", "Costco ghost"),
    ),
    Question(
        "pick",
        "What\u2019s in {player}\u2019s cursed basement?",
        ("Browser history", "400 Crocs", "More basement", "Their ex"),
    ),
    Question(
        "pick",
        "What\u2019s actually haunting this house?",
        ("A Victorian kid", "Mold", "The landlord", "Someone\u2019s ex"),
    ),
]

# Medium rounds: the Medium answers honestly, everyone else guesses.
# On "who" boards the Medium's own name is removed.
MEDIUM_DECK: list[Question] = [
    Question("who", "Who in this room would you trust to help you hide a body?"),
    Question("who", "Who here would you least want to be stuck in a haunted elevator with?"),
    Question("who", "Who in this room would you sacrifice first to save yourself from the demon?"),
    Question("who", "Who here would you call to bail you out of ghost jail?"),
    Question("who", "Which person here would you want haunting your ex?"),
    Question(
        "pick",
        "What would you do if the ghost was hot?",
        ("Run", "Flirt", "Move in", "Start a podcast"),
    ),
]

FINAL_QUESTION = Question("who", "Who in this room is going to hell first?")


# ---- Host custom questions (design doc §5.3) ---------------------------------

DECKS = ("bets", "medium")
KINDS = ("who", "yesno", "pick")
TEXT_MIN, TEXT_MAX = 5, 140
OPTION_MAX = 16
OPTIONS_MIN, OPTIONS_MAX = 2, 5
MAX_CUSTOM = 200

_CONTROL = re.compile(r"[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]")


def _clean(raw: object) -> str:
    if not isinstance(raw, str):
        return ""
    text = _CONTROL.sub("", unicodedata.normalize("NFKC", raw))
    return " ".join(text.split())


def clean_custom(deck: object, kind: object, text: object, options: object) -> tuple[str, str, str, tuple[str, ...]]:
    """Validates a host-written question. Raises ValueError with a host-facing reason.

    Rendered as plain text everywhere (React, never HTML). "{player}" is the only
    placeholder; any other braces are just text.
    """
    if deck not in DECKS:
        raise ValueError("Pick Spirit Bets or Medium.")
    if kind not in KINDS:
        raise ValueError("Pick a board type.")
    t = _clean(text)
    if not TEXT_MIN <= len(t) <= TEXT_MAX:
        raise ValueError(f"Questions are {TEXT_MIN}\u2013{TEXT_MAX} characters.")
    opts: tuple[str, ...] = ()
    if kind == "pick":
        if not isinstance(options, list):
            raise ValueError("Pick One questions need options.")
        cleaned = [_clean(o) for o in options[: OPTIONS_MAX + 5]]
        cleaned = [o for o in cleaned if o]
        if not OPTIONS_MIN <= len(cleaned) <= OPTIONS_MAX:
            raise ValueError(f"Pick One needs {OPTIONS_MIN}\u2013{OPTIONS_MAX} options.")
        if any(len(o) > OPTION_MAX for o in cleaned):
            raise ValueError(f"Options are at most {OPTION_MAX} characters (they're drawn on the board).")
        if len({o.casefold() for o in cleaned}) != len(cleaned):
            raise ValueError("Options must be different.")
        opts = tuple(cleaned)
    return deck, kind, t, opts  # type: ignore[return-value]
