"""Relics: one-time powers players find in the scavenger hunt.

Rules (design doc §6): using a Relic is public (the TV announces who used it
on whom), except Ghost Whisper, which is anonymous. Max one Relic per player
per round, with no limit in the Final Séance.

This module is pure data + input validation; Room applies the effects.
"""

from __future__ import annotations

import random
import re
import unicodedata
from dataclasses import dataclass

# When a Relic can be used.
PULL = "pull"  # during the pull, by anyone pulling (not the Medium)
BET = "bet"  # while betting/guessing (or during the pull), by bettors
ANY = "any"  # any time in a round, including by the Medium

# What a Relic needs from the caster.
PLAYER = "player"
SPOT = "spot"
TEXT = "text"

HEX_SECONDS = 6.0
MAGNET_STRENGTH = 0.45  # extra force toward the spot (one player pulls at 1.0)
JUMP_SCARE_SPEED = 0.9  # planchette velocity kick, board units/s
WHISPER_MAX = 40


@dataclass(frozen=True)
class Relic:
    key: str
    name: str
    emoji: str
    tier: str  # common | rare | cursed
    timing: str
    target: str | None
    blurb: str  # the one-liner the TV shows on the Relic card

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "name": self.name,
            "emoji": self.emoji,
            "tier": self.tier,
            "timing": self.timing,
            "target": self.target,
            "blurb": self.blurb,
        }


CATALOG: dict[str, Relic] = {
    r.key: r
    for r in [
        Relic("mirror", "Mirror Curse", "🙃", "cursed", PULL, PLAYER,
              "Their controls are reversed for the rest of this pull."),
        Relic("hex", "Hex of Stillness", "🧊", "common", PULL, PLAYER,
              f"Frozen solid for {HEX_SECONDS:.0f} seconds."),
        Relic("salt", "Salt Circle", "🧂", "rare", PULL, SPOT,
              "The planchette can’t land there this round."),
        Relic("magnet", "Cursed Magnet", "🧲", "rare", PULL, SPOT,
              "That spot tugs the planchette toward it for the rest of the round."),
        Relic("crystal", "Crystal Ball", "🔮", "rare", BET, None,
              "They can see the future. (Or at least everyone’s bets.)"),
        Relic("double", "Double Down", "✖️", "rare", BET, None,
              "If their bet wins, their share is doubled."),
        Relic("whisper", "Ghost Whisper", "👻", "common", ANY, TEXT,
              "Someone in this room has something to say…"),
        Relic("jumpscare", "Jump Scare", "😱", "common", ANY, None,
              "BOO. The planchette jolts."),
    ]
}

WAVE_1 = list(CATALOG)

# Starter Relics (no hunt): one per player per game, mostly commons.
STARTER_TIER_WEIGHTS = {"common": 6, "rare": 3, "cursed": 1}


def starter_relic(rng: random.Random) -> str:
    tiers = list(STARTER_TIER_WEIGHTS)
    tier = rng.choices(tiers, weights=[STARTER_TIER_WEIGHTS[t] for t in tiers])[0]
    return rng.choice([k for k, r in CATALOG.items() if r.tier == tier])


_CONTROL = re.compile(r"[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]")


def clean_whisper(raw: object) -> str | None:
    """Validates a Ghost Whisper. Returns None if it's unusable.

    Rendered as plain text by React (never as HTML); we still strip control
    and bidi-override characters so nobody can garble the TV.
    """
    if not isinstance(raw, str):
        return None
    text = unicodedata.normalize("NFKC", raw)
    text = _CONTROL.sub("", text)
    text = " ".join(text.split())
    if not text or len(text) > WHISPER_MAX:
        return None
    return text
