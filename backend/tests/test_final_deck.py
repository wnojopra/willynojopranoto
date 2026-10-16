"""Final Séance variety: the last question rotates, and admin finals can be forced in."""

import random

from app.questions import DECK, FINAL_DECK, KINDS, MEDIUM_DECK, OPTIONS_MAX, OPTIONS_MIN, TEXT_MAX, TEXT_MIN, Question
from app.rooms import Room


def make_room(seed: int = 1) -> Room:
    room = Room("ABCD", rng=random.Random(seed), clock=lambda: 0.0)
    for n in ("A", "B", "C"):
        room.add_player(n)
    return room


def test_final_deck_has_variety():
    assert len(FINAL_DECK) >= 6
    assert len(set(FINAL_DECK)) == len(FINAL_DECK)


def test_all_builtin_decks_are_valid():
    for deck in (DECK, MEDIUM_DECK, FINAL_DECK):
        assert len({q.text for q in deck}) == len(deck)
        for q in deck:
            assert q.kind in KINDS
            assert TEXT_MIN <= len(q.text) <= TEXT_MAX
            cleaned = q.text.replace("{player}", "")
            assert "{" not in cleaned and "}" not in cleaned
            if q.kind == "pick":
                assert OPTIONS_MIN <= len(q.options) <= OPTIONS_MAX
                assert len({o.casefold() for o in q.options}) == len(q.options)
            else:
                assert q.options == ()


def test_finals_do_not_repeat_until_deck_is_used_up():
    room = make_room()
    seen = [room._pick_final() for _ in range(len(FINAL_DECK))]
    assert set(seen) == set(FINAL_DECK)
    # After a full cycle the deck resets instead of running dry.
    assert room._pick_final() in FINAL_DECK


def test_always_include_custom_final_comes_first():
    room = make_room()
    mine = Question("who", "Who will be blamed for the broken lamp?")
    other = Question("yesno", "Will the host cry tonight?")
    room.set_custom_questions([("final", mine, True), ("final", other, False), ("bets", other, True)])
    assert room.custom_final == [mine, other]
    assert room._pick_final() == mine
    # Once used, it's back in the normal rotation (no repeat next game).
    assert room._pick_final() != mine


def test_custom_finals_join_the_rotation():
    room = make_room()
    mine = Question("who", "Who is secretly a ghost?")
    room.set_custom_questions([("final", mine, False)])
    picks = {room._pick_final() for _ in range(len(FINAL_DECK) + 1)}
    assert mine in picks
