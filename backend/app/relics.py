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
GRIP_SECONDS = 8.0
GRIP_MULTIPLIER = 3.0
REWIND_SECONDS = 5.0
SHUFFLE_MIN_DELAY = 1.5  # if cast after the halfway mark, shuffle this long after casting


@dataclass(frozen=True)
class Relic:
    key: str
    name: str
    emoji: str
    tier: str  # common | rare | cursed
    timing: str
    target: str | None
    blurb: str  # the one-liner the TV shows on the Relic card
    hint: str = ""  # ultra-short summary shown on the phone pill
    help: str = ""  # 2nd-person instructions shown on the phone sheet & claim page

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "name": self.name,
            "emoji": self.emoji,
            "tier": self.tier,
            "timing": self.timing,
            "target": self.target,
            "blurb": self.blurb,
            "hint": self.hint or self.blurb,
            "help": self.help or self.blurb,
        }


CATALOG: dict[str, Relic] = {
    r.key: r
    for r in [
        Relic("mirror", "Mirror Curse", "🙃", "cursed", PULL, PLAYER,
              "Their controls are reversed for the rest of this pull.",
              "Reverse someone’s pull",
              "Pick a player during the pull to reverse their controls for the rest of the round."),
        Relic("hex", "Hex of Stillness", "🧊", "common", PULL, PLAYER,
              f"Frozen solid for {HEX_SECONDS:.0f} seconds.",
              f"Freeze someone {HEX_SECONDS:.0f}s",
              f"Pick a player during the pull to freeze their controls for {HEX_SECONDS:.0f} seconds."),
        Relic("salt", "Salt Circle", "🧂", "rare", PULL, SPOT,
              "The planchette can’t land there this round.",
              "Block an answer spot",
              "Pick an answer spot during the pull so the planchette cannot lock in there this round."),
        Relic("magnet", "Cursed Magnet", "🧲", "rare", PULL, SPOT,
              "That spot tugs the planchette toward it for the rest of the round.",
              "Pull toward a spot",
              "Pick an answer spot during the pull so it constantly tugs the planchette toward itself."),
        Relic("crystal", "Crystal Ball", "🔮", "rare", BET, None,
              "They can see the future. (Or at least everyone’s bets.)",
              "See bets / cut 2 wrong",
              "Spirit Bets: see live bet counts on every answer. Medium rounds: cross out 2 wrong answers."),
        Relic("double", "Double Down", "✖️", "rare", BET, None,
              "If their bet wins, their share is doubled.",
              "2× candy if you win",
              "Use while betting or pulling in Spirit Bets to double your share of the pot if your bet wins."),
        Relic("whisper", "Ghost Whisper", "👻", "common", ANY, TEXT,
              "Someone in this room has something to say…",
              "Anonymous TV message",
              "Type a short message to flash anonymously on the TV and have the narrator whisper it aloud."),
        Relic("jumpscare", "Jump Scare", "😱", "common", ANY, None,
              "BOO. The planchette jolts.",
              "Jolt board & scream",
              "Shake the TV with a jump scare scream—and if used during the pull, jolt the planchette in a random direction."),
        # ---- Wave 2 ----
        Relic("grip", "Iron Grip", "💪", "common", PULL, None,
              f"Their pull counts {GRIP_MULTIPLIER:.0f}× for {GRIP_SECONDS:.0f} seconds.",
              f"Your pull counts {GRIP_MULTIPLIER:.0f}×",
              f"Use during the pull to make your pull {GRIP_MULTIPLIER:.0f}× stronger for {GRIP_SECONDS:.0f} seconds."),
        Relic("shuffle", "Ouija Shuffle", "🌀", "cursed", PULL, None,
              "Halfway through the pull, the answers trade places.",
              "Scramble all spots",
              "Use during the pull to make every answer spot trade places on the board."),
        Relic("rewind", "Séance Rewind", "⏪", "cursed", PULL, None,
              f"The planchette snaps back to where it was {REWIND_SECONDS:.0f} seconds ago.",
              f"Rewind planchette {REWIND_SECONDS:.0f}s",
              f"Use during the pull to snap the planchette back to where it was {REWIND_SECONDS:.0f} seconds ago."),
        Relic("tarot", "Tarot Card", "🃏", "rare", PULL, SPOT,
              "They changed their bet mid-pull. To what? Only the spirits know.",
              "Switch bet mid-pull",
              "Secretly switch your bet or guess to a different answer spot while the planchette is moving."),
        Relic("pact", "Blood Pact", "🩸", "cursed", BET, PLAYER,
              "Whatever their victim wins this round, they win too.",
              "Copy someone’s payout",
              "Bind yourself to another player while betting or pulling: whatever candy they win this round, you win too."),
    ]
}

WAVE_1 = ["mirror", "hex", "salt", "magnet", "crystal", "double", "whisper", "jumpscare"]
WAVE_2 = ["grip", "shuffle", "rewind", "tarot", "pact"]

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
