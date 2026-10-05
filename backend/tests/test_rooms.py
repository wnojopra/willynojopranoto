import random

import pytest

from app import rooms
from app.rooms import JoinError, Room


class FakeClock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def make_room():
    clock = FakeClock()
    return Room("BCDF", rng=random.Random(1), clock=clock), clock


def test_name_validation():
    room, _ = make_room()
    assert room.add_player("  Kevin   B ").name == "Kevin B"
    for bad in ["", " ", "x" * 15, "<script>", None, 123, "semi;colon"]:
        with pytest.raises(JoinError):
            room.add_player(bad)


def test_duplicate_names_rejected_but_disconnected_can_rejoin():
    room, _ = make_room()
    p = room.add_player("Sarah")
    with pytest.raises(JoinError):
        room.add_player("sarah")
    room.mark_disconnected(p.id)
    assert room.add_player("SARAH").id == p.id


def test_max_players():
    room, _ = make_room()
    for i in range(rooms.MAX_PLAYERS):
        room.add_player(f"P{i}")
    with pytest.raises(JoinError):
        room.add_player("Extra")


def test_cannot_start_alone():
    room, _ = make_room()
    room.add_player("Solo")
    assert not room.can_start
    assert not room.start_round()
    room.add_bot()
    assert room.start_round()
    assert room.phase == "question"


def test_full_round_flow_locks_on_timeout():
    room, clock = make_room()
    room.add_player("A")
    room.add_player("B")
    assert room.start_round()
    clock.t += rooms.QUESTION_SECONDS
    assert room.tick(1 / 30) is True
    assert room.phase == "pull"
    # Nobody pulls: the round ends at the timer on the nearest spot.
    clock.t += rooms.PULL_SECONDS
    assert room.tick(1 / 30) is True
    assert room.phase == "reveal"
    assert room.result_spot_id in {s.id for s in room.spots}
    assert room.can_start


def test_pulls_ignored_outside_pull_phase_and_from_unknown_players():
    room, clock = make_room()
    a = room.add_player("A")
    room.add_player("B")
    room.set_pull(a.id, 1, 0)
    assert a.pull == (0.0, 0.0)
    room.start_round()
    clock.t += rooms.QUESTION_SECONDS
    room.tick(1 / 30)
    room.set_pull(a.id, 1, 0)
    assert a.pull == (1.0, 0.0)
    room.set_pull("nope", 1, 0)  # no crash


def test_pulling_moves_planchette_to_a_name():
    room, clock = make_room()
    a = room.add_player("A")
    b = room.add_player("B")
    room.start_round()
    clock.t += rooms.QUESTION_SECONDS
    room.tick(1 / 30)
    target = next(s for s in room.spots if s.id == b.id)
    for _ in range(30 * 15):
        clock.t += 1 / 30
        p = room.planchette
        dx, dy = target.x - p.x, target.y - p.y
        d = (dx * dx + dy * dy) ** 0.5 or 1
        s = 1.0 if d > 0.04 else 0.0
        room.set_pull(a.id, dx / d * s, dy / d * s)
        room.set_pull(b.id, dx / d * s, dy / d * s)
        if room.tick(1 / 30) and room.phase == "reveal":
            break
    assert room.result_spot_id == b.id


def test_yesno_question_substitutes_player():
    room, _ = make_room()
    room.add_player("Zed")
    room.add_bot()
    for _ in range(len(rooms.DECK)):
        room.phase = "lobby"
        room.start_round()
        assert "{player}" not in room.question_text


def test_normalize_code():
    assert rooms.normalize_code(" bcdf ") == "BCDF"
    assert rooms.normalize_code("ABCD") is None  # vowels never used
    assert rooms.normalize_code("BCD") is None
    assert rooms.normalize_code(None) is None
