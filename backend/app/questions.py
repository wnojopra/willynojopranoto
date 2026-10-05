"""Starter question deck for the pull prototype.

Only "who" (every player is a spot) and "yesno" boards for now. "{player}" is
replaced with a random human player's name.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Question:
    kind: str  # "who" | "yesno"
    text: str


YES_NO_SPOTS = [
    ("yes", "YES"),
    ("no", "NO"),
    ("maybe", "MAYBE"),
    ("ask_again", "ASK AGAIN"),
]

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
]
