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
    # --- Party & Group Dynamics -------------------------------------------
    Question("who", "Who in this room is already thinking about going to bed?"),
    Question("who", "Who is going to tear the house apart the hardest looking for clues?"),
    Question("who", "Who is most likely to find a clue hidden three years ago and forgotten about?"),
    Question("who", "Who put the least effort into their costume tonight?"),
    Question("who", "Who is going to blame the AI when they lose this game?"),
    Question("who", "Who here could drink the entire room under the table without breaking a sweat?"),
    Question("who", "Who is most likely to corner a hostage at 11pm to play one more board game?"),
    Question("who", "Who gets the angriest at losing?"),
    Question("who", "Who would bring stinky food into a haunted house and scare the ghosts away?"),
    Question("who", "Who could eat 5,000 calories tonight and still be the fittest person here tomorrow?"),
    Question("who", "Who is most likely to get paged by their work in the middle of a séance?"),
    Question("who", "Who is most likely to tell a dad joke so bad the ghost leaves the room?"),
    Question("who", "Who is showing up 45 minutes late to their own haunting?"),
    # --- Spooky & Unhinged Hypotheticals ----------------------------------
    Question("who", "Who would be the first to die in a horror movie?"),
    Question("who", "Who would survive a horror movie by sacrificing everyone else?"),
    Question("who", "Who would try to analyze or medically diagnose the ghost instead of running?"),
    Question("who", "Who has the most haunted search history?"),
    Question("who", "Who would sell out the whole group to the demon for a Michelin-star dinner?"),
    Question("who", "Who would get possessed and nobody would notice for an hour?"),
    Question("who", "Who would read the cursed Latin book out loud “just to see what happens”?"),
    Question("who", "Who would try to charge the demon rent?"),
    # --- Yes / No / Maybe / Ask Again -------------------------------------
    Question("yesno", "Will {player} still be awake at 1:00am tonight?"),
    Question("yesno", "Would {player} survive a horror movie past the opening credits?"),
    Question("yesno", "Is {player} the real reason the lights keep flickering?"),
    Question("yesno", "Would {player} survive a zombie apocalypse past day two?"),
    Question("yesno", "Did the host actually remember where they hid all the clues tonight?"),
    # --- Pick One (options <= 16 chars for the board) ---------------------
    Question(
        "pick",
        "What is {player} doing at 10:15pm tonight?",
        ("Dead asleep", "Making a drink", "Hunting clues", "Raiding snacks"),
    ),
    Question(
        "pick",
        "What is still hidden in this house from a past party?",
        ("An old clue", "D&D props", "Mystery drink", "Costume pieces"),
    ),
    Question(
        "pick",
        "What would clear the ghosts out of this house fastest?",
        ("Durian", "Bad dad jokes", "Tech talk", "Karaoke"),
    ),
    Question(
        "pick",
        "What is {player}’s ghost form?",
        ("Sleepy uncle", "Orb of memes", "HOA ghost", "Costco ghost"),
    ),
    Question(
        "pick",
        "What is actually haunting this house?",
        ("Victorian child", "Unpaid rent", "The landlord", "Bad Wi-Fi"),
    ),
    Question(
        "pick",
        "What is in {player}’s cursed basement?",
        ("Browser history", "400 Crocs", "More basement", "Board games"),
    ),
]

# Medium rounds: the Medium answers honestly, everyone else guesses.
# On "who" boards the Medium's own name is removed.
MEDIUM_DECK: list[Question] = [
    Question("who", "Who in this room would you trust to plan your entire international vacation?"),
    Question("who", "Who in this room would you pick as your partner in a life-or-death escape room?"),
    Question("who", "Who here would you text first if you had a weird emergency at 2am?"),
    Question("who", "Who in this room is most likely to fall asleep on the couch before this game ends?"),
    Question("who", "Who here would you trust to help you hide a body and never tell anyone?"),
    Question("who", "Who in this room has the most mysterious double life?"),
    Question("who", "Who here would you trust to mix you a drink without ending your night early?"),
    Question("who", "Who in this room would you recruit first for a D&D campaign?"),
    Question("who", "Who here would you call to bail you out of ghost jail?"),
    Question("who", "Who here would you least want to be stuck in a haunted elevator with?"),
    Question(
        "pick",
        "Which penalty would you least want to draw during a clue hunt?",
        ("Mystery shot", "Bite of durian", "Hot sauce", "Ghost story"),
    ),
    Question(
        "pick",
        "What would you do if a ghost moved into your house?",
        ("Run", "Split the rent", "Befriend it", "Start a podcast"),
    ),
]

# The Final Séance (3x pot): one per game, rotating through the deck across games.
FINAL_DECK: list[Question] = [
    Question("who", "Who in this room is the undisputed MVP of the night?"),
    Question("who", "Who here would sell out the entire group to the demon first?"),
    Question("who", "Who in this room will haunt the rest of us the hardest when they become a ghost?"),
    Question("who", "Who here has the most chaotic energy hiding behind a respectable adult life?"),
    Question("who", "Who in this room is going to need the longest recovery time tomorrow morning?"),
    Question("who", "Who here is the true final boss of this group?"),
    Question("who", "Who in this room is secretly already a ghost?"),
    Question("who", "Who here would summon a demon by accident?"),
    Question("who", "Who here would make a deal with the devil and talk their way into winning?"),
    Question("who", "Who should never, ever be left alone with a Ouija board?"),
]
FINAL_QUESTION = FINAL_DECK[0]


# ---- Host custom questions (design doc §5.3) ---------------------------------

DECKS = ("bets", "medium", "final")
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
        raise ValueError("Pick Spirit Bets, Medium, or Final Séance.")
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
