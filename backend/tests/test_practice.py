"""The practice round: before round 1, slower, and nothing counts."""

import random

from app import rooms
from app.rooms import Room


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def make_room():
    clock = Clock()
    room = Room("BCDF", rng=random.Random(3), clock=clock)
    room.practice_on = True
    room.curses_on = True
    for n in ("A", "B", "C"):
        room.add_player(n)
    return room, clock


def test_practice_is_first_slow_and_scoreless():
    room, clock = make_room()
    assert room.new_game()
    assert room.round_kind == "practice" and room.game_round == 0
    assert room.question == rooms.PRACTICE_QUESTION
    assert room.phase_ends_at - clock.t == rooms.PRACTICE_QUESTION_SECONDS
    a, b, c = room.players.values()
    assert room.place_bet(a.id, "yes") and room.place_bet(b.id, "yes")
    room.place_bet(c.id, "no")
    # Everyone's in: a few seconds of grace, longer than a real round's.
    assert room.phase_ends_at - clock.t == rooms.PRACTICE_ALL_IN_SECONDS
    clock.t += rooms.PRACTICE_ALL_IN_SECONDS
    room.tick(1 / 30)
    assert room.phase == "pull"
    assert room.phase_ends_at - clock.t == rooms.PRACTICE_PULL_SECONDS
    room._finish_round("yes")
    assert room.phase == "reveal"
    # The TV can show what they *would* have won, but nobody scores.
    assert room.last_payout == {a.id: room.pot // 2, b.id: room.pot // 2}
    assert all(p.score == 0 and p.haunted == 0 for p in room.players.values())
    assert room.curse is None and room.carryover == 0


def test_practice_landing_on_a_name_hands_out_no_marks_or_curses():
    room, clock = make_room()
    room.new_game()
    victim = next(iter(room.players.values()))
    room.spots = [rooms.physics.Spot(victim.id, victim.name, 0.5, 0.2)]
    clock.t += rooms.PRACTICE_QUESTION_SECONDS
    room.tick(1 / 30)
    room._finish_round(victim.id)
    assert victim.haunted == 0 and room.curse is None


def test_no_relics_in_practice():
    room, _ = make_room()
    room.new_game()
    p = next(iter(room.players.values()))
    p.relics.append("double")
    assert room.use_relic(p.id, "double") == "Relics rest during the practice round."
    assert "double" in p.relics


def test_after_practice_the_real_game_starts_at_round_one():
    room, clock = make_room()
    room.set_length("short")
    room.new_game()
    clock.t += rooms.PRACTICE_QUESTION_SECONDS
    room.tick(1 / 30)
    room._finish_round(room.spots[0].id)
    assert room.start_round()
    assert room.round_kind == "bets" and room.game_round == 1
    assert room.phase_ends_at - clock.t == rooms.QUESTION_SECONDS


def test_practice_can_be_turned_off_and_back_to_lobby_skips_it():
    room, _ = make_room()
    room.set_practice("yes")  # ignored: not a bool
    assert room.practice_on
    room.set_practice(False)
    room.new_game()
    assert room.round_kind == "bets" and room.game_round == 1

    room2, _ = make_room()
    room2.new_game()
    assert room2.round_kind == "practice"
    room2.back_to_lobby()
    assert room2.game_round == 0 and room2.game_active
    room2.start_round()
    assert room2.round_kind == "bets" and room2.game_round == 1


def test_practice_plays_once_then_play_again_skips_it():
    """"Play again" shouldn't re-teach the room: the toggle turns itself off once played."""
    room, _ = make_room()
    room.set_length("short")
    assert room.new_game()
    assert room.round_kind == "practice"
    assert not room.practice_on  # consumed: the lobby toggle now reads "off"
    assert not room.state_dict()["game"]["practiceOn"]
    # Next game (here via restart; "Play again" from the results is the same path): straight to round 1.
    room.restart_game()
    assert room.new_game()
    assert room.round_kind == "bets" and room.game_round == 1
    # The host can switch it back on for newcomers.
    room.restart_game()
    room.set_practice(True)
    assert room.new_game()
    assert room.round_kind == "practice"
