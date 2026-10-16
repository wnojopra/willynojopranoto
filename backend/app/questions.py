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
    # --- Spooktacular VI & Tonight's Party --------------------------------
    Question("who", "Who in this room is already thinking about going to bed?"),
    Question("who", "Who did / is going to tear Mimi’s house apart the hardest looking for clues?"),
    Question("who", "Who is most likely to find a clue Mimi hid in 2023 and forgot about?"),
    Question("who", "Who put the least effort into their costume tonight?"),
    Question("who", "Who is going to get wrecked by Justin’s drinks first?"),
    Question("who", "Who is going to blame the AI when they lose this game?"),
    Question("who", "Who here could drink the entire room under the table without breaking a sweat?"),
    Question("who", "Who is most likely to corner a hostage at 11pm to play one more board game?"),
    # --- Friend Group Lore & Roasts ---------------------------------------
    Question("who", "Who is going to be the reason White Elephant gets cancelled this year?"),
    Question("who", "Who would collude with their spouse just to escape a bad White Elephant gift?"),
    Question("who", "Who gets the angriest at losing?"),
    Question("who", "Who here has been forced to consume the most Stray Kids content against their will?"),
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
    # --- Yes / No / Maybe / Ask Again -------------------------------------
    Question("yesno", "Will {player} still be awake at 1:00am tonight?"),
    Question("yesno", "Will White Elephant actually happen this year before January ends?"),
    Question("yesno", "Does Mimi actually remember where she hid all the clues tonight?"),
    Question("yesno", "Would {player} survive a horror movie past the opening credits?"),
    Question("yesno", "Will we see Justin and Athena again before Spooktacular VII?"),
    # --- Pick One (options <= 16 chars for the board) ---------------------
    Question(
        "pick",
        "Why will White Elephant get cancelled again?",
        ("Natalie’s abroad", "Busy till March", "Rocks rocks rocks", "People ghosting"),
    ),
    Question(
        "pick",
        "What is {player} doing at 10:15pm tonight?",
        ("Dead asleep", "Drinking", "Hunting for clues", "Eating"),
    ),
    Question(
        "pick",
        "What is still hidden in Mimi’s house from a past party?",
        ("A 2022 clue", "D&D props", "Penalty drink", "Costume pieces"),
    ),
    Question(
        "pick",
        "Where is Natalie every November and December?",
        ("Stray Kids tour", "In a spreadsheet", "Another country", "Dodging Xmas"),
    ),
    Question(
        "pick",
        "What is Curtis’s secret to staying the fittest in the group?",
        ("Pure willpower", "Motor oil", "Badminton aura", "Dark magic"),
    ),
    Question(
        "pick",
        "What is the secret ingredient in Justin’s next cocktail?",
        ("Liquid nitrogen", "Edible smoke", "Aviary alchemy", "80-proof love"),
    ),
    Question(
        "pick",
        "What would clear the ghosts out of this house fastest?",
        ("Durian", "Jon’s dad jokes", "AI slop", "Kpop fancam"),
    ),
    Question(
        "pick",
        "What is {player}’s ghost form?",
        ("Sleepy uncle", "Orb of memes", "Lil bitch ass ghost", "Slutty spirit"),
    ),
]

# Medium rounds: the Medium answers honestly, everyone else guesses.
# On "who" boards the Medium's own name is removed.
MEDIUM_DECK: list[Question] = [
    Question("who", "Who in this room would you trust to plan your entire international vacation?"),
    Question("who", "Who in this room would you pick as your doubles partner in life-or-death badminton?"),
    Question("who", "Who here would you text first if you had a weird medical question at 2am?"),
    Question("who", "Who in this room is most likely to fall asleep on the couch before this game ends?"),
    Question("who", "Who here would you trust to help you hide a body and never tell anyone?"),
    Question("who", "Who in this room has the most mysterious life outside of Spooktacular?"),
    Question("who", "Who here would you trust to mix you a drink without ending your night early?"),
    Question("who", "Who in this room would you recruit first for a D&D campaign?"),
    Question("who", "Who here would you call to bail you out of ghost jail?"),
    Question(
        "pick",
        "You unwrap a hated Super Soaker at White Elephant. What is your move?",
        ("Spouse collusion", "Loud grunting", "Accept my fate", "Cancel Xmas"),
    ),
    Question(
        "pick",
        "Which penalty would you least want to draw during Mimi’s clue hunt?",
        ("Mystery shot", "Bite of durian", "Hot sauce challenge", "Slap"),
    ),
    Question(
        "pick",
        "What would you do if the ghost haunting your house was hot?",
        ("Run", "Flirt", "Charge it rent", "Tell Cynthia"),
    ),
]

# The Final Séance (3x pot): one per game, rotating through the deck across games.
FINAL_DECK: list[Question] = [
    Question("who", "Who in this room is the undisputed MVP of Spooktacular VI?"),
    Question("who", "Who here would sell out the entire friend group to the demon first?"),
    Question("who", "Who in this room will haunt the rest of us the hardest when they become a ghost?"),
    Question("who", "Who here has the most chaotic energy hiding behind a respectable adult life?"),
    Question("who", "Who in this room is going to need the longest recovery time tomorrow morning?"),
    Question("who", "Who here is the true final boss of this friend group?"),
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
