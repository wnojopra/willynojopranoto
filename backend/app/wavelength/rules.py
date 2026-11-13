"""Pure rules and angle scoring for Wavelength.

Dial angles run from -90.0 (full Left) to +90.0 (full Right), with 0.0 straight up.
The target sits anywhere in [-90.0, +90.0] and has 5 scoring wedges centered on it:
  - Bullseye: within ±4.5°
  - Close:    within ±13.5°
  - Near:     within ±22.5°

Two scoring presets are supported:
  - "classic" (mikeck1): 5 / 3 / 1 points
  - "board"   (CMYK physical board game): 4 / 3 / 2 points
"""

from __future__ import annotations

import math
from typing import Literal

MIN_ANGLE = -90.0
MAX_ANGLE = 90.0

BULLSEYE_HALF_DEG = 4.5
CLOSE_HALF_DEG = 13.5
NEAR_HALF_DEG = 22.5

ScoringPreset = Literal["classic", "board"]
GameMode = Literal["teams", "ffa", "coop"]
BonusDirection = Literal["left", "right"]

PRESET_BANDS: dict[ScoringPreset, tuple[int, int, int]] = {
    "classic": (5, 3, 1),
    "board": (4, 3, 2),
}


def clamp_angle(angle: object) -> float | None:
    """Validates and clamps a dial angle into [-90.0, +90.0], rounded to 2 decimals."""
    if isinstance(angle, bool) or not isinstance(angle, (int, float)):
        return None
    val = float(angle)
    if not math.isfinite(val):
        return None
    clamped = max(MIN_ANGLE, min(MAX_ANGLE, val))
    return round(clamped, 2)


def band_values(preset: ScoringPreset = "classic") -> tuple[int, int, int]:
    """Returns (bullseye_pts, close_pts, near_pts) for the given preset."""
    return PRESET_BANDS.get(preset, PRESET_BANDS["classic"])


def is_bullseye(needle: float, target: float) -> bool:
    return abs(needle - target) <= BULLSEYE_HALF_DEG


def score_angle(needle: float, target: float, preset: ScoringPreset = "classic") -> int:
    """Points scored for `needle` against `target` center angle."""
    diff = abs(needle - target)
    bullseye, close, near = band_values(preset)
    if diff <= BULLSEYE_HALF_DEG:
        return bullseye
    if diff <= CLOSE_HALF_DEG:
        return close
    if diff <= NEAR_HALF_DEG:
        return near
    return 0


def evaluate_bonus_direction(
    needle: float,
    target: float,
    direction: BonusDirection | None,
) -> bool:
    """Returns True if the opposing team's Left/Right guess is correct.

    In Wavelength, if the active team hits the Bullseye, the opposing team cannot
    score the Left/Right bonus. Otherwise:
      - "left" is correct if the true target center is strictly to the left of the needle (target < needle)
      - "right" is correct if the true target center is strictly to the right of the needle (target > needle)
    """
    if direction not in ("left", "right"):
        return False
    if is_bullseye(needle, target):
        return False
    if direction == "left":
        return target < needle
    return target > needle


def ffa_psychic_points(guesser_points: dict[str, int]) -> int:
    """In Free-for-All mode, the Psychic earns +1 pt for each guesser who lands on any scoring wedge (up to +3)."""
    hits = sum(1 for pts in guesser_points.values() if pts > 0)
    return min(3, hits)


def coop_rating(score: int) -> dict[str, str]:
    """Co-op end-of-game rating table inspired by the official Wavelength co-op rules."""
    if score >= 22:
        return {
            "tier": "Psychic Minds",
            "emoji": "🧠✨",
            "verdict": "One shared brain cell operating at cosmic frequency.",
        }
    if score >= 19:
        return {
            "tier": "Galaxy Brain",
            "emoji": "🌌",
            "verdict": "Locked in! You can finish each other's sentences.",
        }
    if score >= 16:
        return {
            "tier": "In Sync",
            "emoji": "📡",
            "verdict": "Crystal-clear signal! A solid cooperative win.",
        }
    if score >= 13:
        return {
            "tier": "On the Dial",
            "emoji": "📻",
            "verdict": "Decent reception—just a little static on the line.",
        }
    if score >= 10:
        return {
            "tier": "Crossed Wires",
            "emoji": "⚡",
            "verdict": "A few sparks of brilliance amidst the confusion.",
        }
    return {
        "tier": "Pure Static",
        "emoji": "📺",
        "verdict": "Are you sure you were looking at the same card?",
    }


def winning_ids(scores: dict[str, int], target_score: int) -> list[str]:
    """Returns the IDs of all teams/players tied for highest score once at least one reaches `target_score`."""
    if not scores:
        return []
    top = max(scores.values())
    if top < target_score:
        return []
    return [k for k, v in scores.items() if v == top]
