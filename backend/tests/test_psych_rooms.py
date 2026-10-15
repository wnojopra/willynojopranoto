import random

import pytest

from app.psych import rooms
from app.psych.rooms import JoinError, PsychRoom


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def make_room(n: int = 3) -> tuple[PsychRoom, list[str], Clock]:
    clock = Clock()
    room = PsychRoom("BCDF", rng=random.Random(1), clock=clock)
    ids = [room.add_player(f"P{i}").id for i in range(n)]
    return room, ids, clock


def test_needs_two_players_to_start():
    room, ids, _ = make_room(1)
    assert not room.start()
    room.add_player("Two")
    assert room.start()
    assert room.phase == "secret"


def test_full_turn_flow_and_scoring():
    room, (a, b, c), _ = make_room(3)
    room.start()
    assert room.main_id == a and room.current_id == a
    assert room.traits and room.traits[0] in rooms.X_DECK and room.traits[1] in rooms.Y_DECK
    assert room.order == [b, c]
    # Guessers can't go before the secret is marked.
    assert not room.mark(b, 5, 5)
    assert room.mark(a, 10, 1)
    assert room.phase == "guessing" and room.current_id == b
    # Out of turn.
    assert not room.mark(c, 3, 3)
    assert room.mark(b, 10, 1)
    # Claimed square is blocked.
    assert not room.mark(c, 10, 1)
    assert room.mark(c, 9, 2)
    assert room.phase == "reveal"
    assert room.points == {b: 3, c: 1}
    assert room.players[b].score == 3 and room.players[c].score == 1
    assert room.players[a].score == 0  # the main player doesn't score
    assert room.next_turn()
    assert room.main_id == b and room.order == [c, a]


def test_secret_never_in_broadcast_before_reveal():
    room, (a, b, c), _ = make_room(3)
    room.start()
    room.mark(a, 7, 3)
    st = room.state_dict()
    assert st["reveal"] is None
    assert st["secretMarked"] is True
    assert "secret" not in st and "x" not in st
    assert room.secret_msg() == {"type": "secret", "turn": 1, "x": 7, "y": 3}
    room.mark(b, 1, 1)
    room.mark(c, 2, 2)
    assert room.state_dict()["reveal"]["x"] == 7


def test_invalid_marks_rejected():
    room, (a, _, _), _ = make_room(3)
    room.start()
    for x, y in [(0, 1), (11, 1), ("5", 5), (True, 1), (None, None), (5.0, 5)]:
        assert not room.mark(a, x, y)
    assert room.phase == "secret"


def test_win_and_tie():
    room, (a, b, c), _ = make_room(3)
    room.target = 5
    room.start()
    room.players[b].score = 3
    room.players[c].score = 2
    room.mark(a, 5, 5)
    room.mark(b, 5, 6)  # +2 -> 5
    room.mark(c, 5, 5)  # +3 -> 5
    assert sorted(room.winners) == sorted([b, c])
    assert room.next_turn()
    assert room.phase == "gameover"
    assert room.play_again()
    assert room.phase == "lobby" and all(p.score == 0 for p in room.players.values())


def test_skip_guesser_and_main():
    room, (a, b, c), _ = make_room(3)
    room.start()
    assert room.skip()  # skip main
    assert room.main_id == b and room.phase == "secret"
    room.mark(b, 4, 4)
    assert room.current_id == c
    assert room.skip()
    assert room.current_id == a
    room.mark(a, 4, 4)
    assert room.phase == "reveal"
    assert room.points == {a: 3}


def test_leaving_guesser_unblocks_square_and_advances():
    room, (a, b, c), _ = make_room(3)
    d = room.add_player("Dee").id
    room.start()
    room.mark(a, 1, 1)
    room.mark(b, 2, 2)
    assert room.current_id == c
    room.remove_player(b)
    assert (2, 2) not in room.guesses.values()
    room.remove_player(c)
    assert room.current_id == d
    assert room.mark(d, 2, 2)
    assert room.phase == "reveal"


def test_main_leaving_starts_next_turn():
    room, (a, b, c), _ = make_room(3)
    room.start()
    room.mark(a, 1, 1)
    room.remove_player(a)
    assert room.phase == "secret" and room.main_id == b


def test_dropping_below_two_returns_to_lobby():
    room, (a, b), _ = make_room(2)
    room.start()
    room.remove_player(a)
    assert room.phase == "lobby"


def test_late_joiner_waits_for_next_turn():
    room, (a, b), _ = make_room(2)
    room.start()
    late = room.add_player("Late").id
    assert late not in room.order
    room.mark(a, 3, 3)
    room.mark(b, 3, 4)
    room.next_turn()
    assert late in room.order


def test_redraw_only_before_mark():
    room, (a, _, _), _ = make_room(3)
    room.start()
    assert room.redraw()
    room.mark(a, 1, 1)
    assert not room.redraw()


def test_move_seat_and_target_lobby_only():
    room, (a, b, c), _ = make_room(3)
    assert room.move_seat(c, -1)
    assert room.seats == [a, c, b]
    assert not room.move_seat(a, -1)
    assert not room.move_seat(a, 2)
    assert room.set_target(15) and room.target == 15
    assert not room.set_target(4) and not room.set_target(True) and not room.set_target("10")
    room.start()
    assert not room.move_seat(a, 1)
    assert not room.set_target(12)


def test_deck_no_repeats_until_exhausted():
    deck = rooms.Deck(("a", "b", "c"), random.Random(0))
    assert sorted(deck.draw() for _ in range(3)) == ["a", "b", "c"]
    assert deck.draw() in ("a", "b", "c")


def test_bots_play_after_delay():
    room, (a,), clock = make_room(1)
    room.add_bot()
    room.add_bot()
    room.start()
    room.mark(a, 5, 5)
    assert not room.tick()
    clock.t += rooms.BOT_DELAY_SECONDS + 0.1
    assert room.tick()
    clock.t += rooms.BOT_DELAY_SECONDS + 0.1
    assert room.tick()
    assert room.phase == "reveal"
    assert len(set(room.guesses.values())) == 2


def test_names_and_capacity():
    room, _, _ = make_room(0)
    with pytest.raises(JoinError):
        room.add_player("<script>")
    for i in range(rooms.MAX_PLAYERS):
        room.add_player(f"N{i}")
    with pytest.raises(JoinError):
        room.add_player("Extra")
    assert len({p.color for p in room.players.values()}) == rooms.MAX_PLAYERS


def test_device_owns_seat():
    room, _, _ = make_room(0)
    p = room.add_player("Kim", device="dev-1")
    room.mark_disconnected(p.id)
    with pytest.raises(JoinError):
        room.add_player("kim", device="dev-2")
    assert room.add_player("Kim", device="dev-1").id == p.id
