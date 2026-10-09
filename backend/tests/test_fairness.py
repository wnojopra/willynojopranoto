"""Fairness: when nobody steers, no player's name should come up more than chance."""

import collections
import random

from app.rooms import Room


def play_idle_rounds(n_players: int, games: int, seed: int) -> collections.Counter:
    t = [0.0]
    room = Room("ABCD", rng=random.Random(seed), clock=lambda: t[0])
    room.curses_on = False
    for i in range(n_players):
        room.add_player(f"P{i}")
    landed: collections.Counter = collections.Counter()
    for _ in range(games):
        room.game_active = False
        room.phase = "lobby"
        assert room.new_game()
        while room.phase != "results":
            if room.phase == "reveal":
                room.start_round()
                continue
            t[0] += 0.05
            room.tick(0.05)
            if room.phase == "reveal" and room.question.kind == "who":
                landed[room.result_spot_id] += 1
    return landed


def test_idle_timeouts_spread_across_players():
    for n in (3, 6, 7):
        landed = play_idle_rounds(n, games=40, seed=n)
        total = sum(landed.values())
        assert len(landed) == n, landed  # everyone comes up sometimes
        # Nobody gets more than twice their fair share (it was ~75% for one player before).
        assert max(landed.values()) < 2 * total / n, landed


def test_who_spots_are_shuffled_each_round():
    room = Room("ABCD", rng=random.Random(3))
    for i in range(6):
        room.add_player(f"P{i}")
    from app.questions import Question

    q = Question("who", "Who?")
    orders = {tuple(i for i, _ in room._labels_for(q)) for _ in range(20)}
    assert len(orders) > 5
