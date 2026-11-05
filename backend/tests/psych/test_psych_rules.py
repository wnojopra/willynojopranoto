import pytest

from app.psych import rules
from app.psych.traits import X_DECK, Y_DECK


@pytest.mark.parametrize(
    "guess,secret,expected",
    [
        ((5, 5), (5, 5), 3),
        ((4, 5), (5, 5), 2),
        ((6, 5), (5, 5), 2),
        ((5, 4), (5, 5), 2),
        ((5, 6), (5, 5), 2),
        ((4, 4), (5, 5), 1),
        ((6, 6), (5, 5), 1),
        ((4, 6), (5, 5), 1),
        ((6, 4), (5, 5), 1),
        ((7, 5), (5, 5), 0),
        ((5, 3), (5, 5), 0),
        ((7, 7), (5, 5), 0),
        ((1, 1), (10, 10), 0),
        # Corners and edges.
        ((1, 1), (1, 1), 3),
        ((2, 1), (1, 1), 2),
        ((2, 2), (1, 1), 1),
        ((10, 9), (10, 10), 2),
        ((9, 9), (10, 10), 1),
    ],
)
def test_score(guess, secret, expected):
    assert rules.score(guess, secret) == expected


@pytest.mark.parametrize(
    "x,y,ok",
    [(1, 1, True), (10, 10, True), (0, 5, False), (5, 11, False), (True, 3, False), ("3", 3, False), (2.0, 3, False), (None, 1, False)],
)
def test_valid_square(x, y, ok):
    assert rules.valid_square(x, y) is ok


def test_guess_order_starts_after_main_and_wraps():
    seats = ["a", "b", "c", "d"]
    assert rules.guess_order(seats, "a") == ["b", "c", "d"]
    assert rules.guess_order(seats, "c") == ["d", "a", "b"]
    assert rules.guess_order(seats, "d") == ["a", "b", "c"]


def test_winners():
    assert rules.winners({}, 10) == []
    assert rules.winners({"a": 9, "b": 4}, 10) == []
    assert rules.winners({"a": 10, "b": 4}, 10) == ["a"]
    assert rules.winners({"a": 11, "b": 12}, 10) == ["b"]
    assert sorted(rules.winners({"a": 12, "b": 12, "c": 3}, 10)) == ["a", "b"]


def test_decks_are_full_and_disjoint():
    assert len(X_DECK) == len(set(X_DECK)) == 125
    assert len(Y_DECK) == len(set(Y_DECK)) == 125
    assert not {w.casefold() for w in X_DECK} & {w.casefold() for w in Y_DECK}
    for word in ("Stoic", "Spiritual", "Studious", "Funny"):
        assert word in X_DECK
    for word in ("Competitive", "Power-Hungry"):
        assert word in Y_DECK


def test_expansion_decks_are_unique_across_all_decks():
    from app.psych.traits import DECKS

    words = [w.casefold() for _, _, ws in DECKS.values() for w in ws]
    assert len(words) == len(set(words))
    for deck_id in ("internet_food", "dark", "life_skills"):
        assert len(DECKS[deck_id][2]) == 60
    # Long enough to read, short enough to fit on a card.
    assert max(len(w) for w in words) <= 30
