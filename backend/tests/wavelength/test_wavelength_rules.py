"""Unit tests for Wavelength pure rules and deck invariants."""

from __future__ import annotations

import pytest

from app.wavelength import decks, rules


@pytest.mark.parametrize(
    "raw,expected",
    [
        (0, 0.0),
        (-90, -90.0),
        (90, 90.0),
        (-135.5, -90.0),
        (140.2, 90.0),
        (12.3456, 12.35),
        (True, None),
        (False, None),
        ("45", None),
        (None, None),
        (float("nan"), None),
        (float("inf"), None),
    ],
)
def test_clamp_angle(raw: object, expected: float | None) -> None:
    assert rules.clamp_angle(raw) == expected


@pytest.mark.parametrize(
    "needle,target,expected",
    [
        (10.0, 10.0, 4),
        (14.5, 10.0, 4),
        (14.6, 10.0, 3),
        (23.5, 10.0, 3),
        (23.6, 10.0, 2),
        (32.5, 10.0, 2),
        (32.6, 10.0, 0),
        (45.0, 10.0, 0),
    ],
)
def test_score_angle(
    needle: float, target: float, expected: int
) -> None:
    assert rules.score_angle(needle, target) == expected


def test_evaluate_bonus_direction() -> None:
    # Target is at +20, needle is at +5 -> target is to the right of the needle
    assert rules.evaluate_bonus_direction(5.0, 20.0, "right") is True
    assert rules.evaluate_bonus_direction(5.0, 20.0, "left") is False

    # Target is at -30, needle is at -10 -> target is to the left of the needle
    assert rules.evaluate_bonus_direction(-10.0, -30.0, "left") is True
    assert rules.evaluate_bonus_direction(-10.0, -30.0, "right") is False

    # If active team hits Bullseye, opposing team cannot score Left/Right bonus
    assert rules.evaluate_bonus_direction(18.0, 20.0, "right") is False
    assert rules.evaluate_bonus_direction(18.0, 20.0, "left") is False
    assert rules.evaluate_bonus_direction(5.0, 20.0, None) is False


def test_ffa_psychic_points_and_coop_rating() -> None:
    assert rules.ffa_psychic_points({"p1": 0, "p2": 0}) == 0
    assert rules.ffa_psychic_points({"p1": 5, "p2": 0, "p3": 3}) == 2
    assert rules.ffa_psychic_points({"p1": 5, "p2": 3, "p3": 1, "p4": 5}) == 3

    assert rules.coop_rating(24)["tier"] == "Psychic Minds"
    assert rules.coop_rating(19)["tier"] == "Galaxy Brain"
    assert rules.coop_rating(16)["tier"] == "In Sync"
    assert rules.coop_rating(5)["tier"] == "Pure Static"


def test_winning_ids() -> None:
    assert rules.winning_ids({"t0": 8, "t1": 9}, 10) == []
    assert rules.winning_ids({"t0": 10, "t1": 9}, 10) == ["t0"]
    assert set(rules.winning_ids({"t0": 12, "t1": 12, "t2": 10}, 10)) == {"t0", "t1"}


def test_decks_unique_and_bounded() -> None:
    seen: set[str] = set()
    total = 0
    for pack_id, pack in decks.DECKS.items():
        cards = pack["cards"]
        assert len(cards) >= 40, f"{pack_id} should have at least 40 cards"
        for left, right in cards:
            assert 1 <= len(left) <= decks.MAX_CARD_LEN
            assert 1 <= len(right) <= decks.MAX_CARD_LEN
            assert left.casefold() != right.casefold()
            key = decks.card_key(left, right)
            assert key not in seen, f"Duplicate card across decks: {left} ↔ {right}"
            seen.add(key)
            total += 1
    assert total >= 250


def test_normalize_custom_cards_formats() -> None:
    raw_lines = """
    # comment
    Left,Right
    Cold | Hot
    Worst Snack ↔ Best Snack
    "Sweet, Salty", "Sour, Bitter"
    Cold | Hot
    """
    parsed = decks.normalize_custom_cards(raw_lines)
    assert parsed == [
        ("Cold", "Hot"),
        ("Worst Snack", "Best Snack"),
        ("Sweet, Salty", "Sour, Bitter"),
    ]

    json_text = '{"cards": [["Alpha", "Omega"], {"left": "Low", "right": "High"}]}'
    assert decks.normalize_custom_cards(json_text) == [
        ("Alpha", "Omega"),
        ("Low", "High"),
    ]
