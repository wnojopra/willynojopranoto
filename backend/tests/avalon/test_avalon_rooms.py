import random
import pytest

from app.avalon import rooms, rules
from app.avalon.rooms import AvalonRoom, JoinError


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def make_room(n: int = 5) -> tuple[AvalonRoom, list[str], Clock]:
    clock = Clock()
    room = AvalonRoom("BCDF", rng=random.Random(7), clock=clock)
    ids = [room.add_player(f"P{i}").id for i in range(n)]
    return room, ids, clock


def test_requires_five_players_to_start():
    room, _, _ = make_room(4)
    assert not room.can_start()
    assert not room.start()
    room.add_player("Fifth")
    assert room.can_start()
    assert room.start()
    assert room.phase == "night"


def test_secret_roles_never_in_public_state_until_gameover():
    room, ids, _ = make_room(5)
    room.start()
    st = room.state_dict()
    assert st["revealedRoles"] is None
    assert st["assassinId"] is None
    assert st["evilDiscussIds"] == []
    for pid in ids:
        priv = room.private_msg(pid)
        assert priv is not None
        assert priv["role"] == room.roles[pid]


def test_night_ready_transitions_to_team_building():
    room, ids, _ = make_room(5)
    room.start()
    for pid in ids[:-1]:
        assert room.mark_night_ready(pid)
        assert room.phase == "night"
    assert room.mark_night_ready(ids[-1])
    assert room.phase == "team_building"


def test_five_rejected_teams_evil_wins():
    room, ids, _ = make_room(5)
    room.start()
    room.advance()
    assert room.phase == "team_building"

    for attempt in range(1, 6):
        leader = room.leader_id
        assert leader is not None
        assert room.propose_team(leader, ids[:2])
        assert room.phase == "team_vote"
        # Everyone rejects
        for pid in ids:
            assert room.vote(pid, False)
        if attempt < 5:
            assert room.phase == "team_reveal"
            assert room.rejected_count == attempt
            assert room.advance()
            assert room.phase == "team_building"
        else:
            assert room.phase == "gameover"
            assert room.winner == "evil"
            assert "Five Teams" in (room.win_reason or "")


def test_three_failed_quests_evil_wins():
    room, ids, _ = make_room(5)
    room.start()
    room.advance()

    evil_ids = [pid for pid in ids if rules.role_alignment(room.roles[pid]) == "evil"]
    good_ids = [pid for pid in ids if rules.role_alignment(room.roles[pid]) == "good"]

    for q in range(1, 4):
        leader = room.leader_id
        assert leader is not None
        req = room.current_quest_size
        # Include 1 evil player and fill rest with good players
        team = [evil_ids[0]] + good_ids[: req - 1]
        assert room.propose_team(leader, team)
        for pid in ids:
            room.vote(pid, True)
        assert room.phase == "team_reveal"
        room.advance()
        assert room.phase == "quest"

        # Good players cannot play Fail
        for pid in team:
            if pid in good_ids:
                assert not room.submit_quest_card(pid, False)
                assert room.submit_quest_card(pid, True)
            else:
                assert room.submit_quest_card(pid, False)

        if q < 3:
            assert room.phase == "quest_reveal"
            assert room.last_quest_reveal["succeeded"] is False
            room.advance()
        else:
            assert room.phase == "gameover"
            assert room.winner == "evil"


def test_three_successful_quests_and_assassination():
    room, ids, _ = make_room(5)
    room.start()
    room.advance()

    good_ids = [pid for pid in ids if rules.role_alignment(room.roles[pid]) == "good"]
    merlin_id = next(pid for pid in ids if room.roles[pid] == "merlin")
    non_merlin_good = next(pid for pid in good_ids if pid != merlin_id)
    assassin_id = room.assassin_id
    assert assassin_id is not None

    for q in range(1, 4):
        leader = room.leader_id
        assert leader is not None
        req = room.current_quest_size
        team = good_ids[:req]
        assert room.propose_team(leader, team)
        for pid in ids:
            room.vote(pid, True)
        room.advance()
        for pid in team:
            room.submit_quest_card(pid, True)
        if q < 3:
            assert room.phase == "quest_reveal"
            room.advance()
        else:
            assert room.phase == "assassinate"

    # Assassin cannot target themselves or another Evil player
    evil_ids = [pid for pid in ids if rules.role_alignment(room.roles[pid]) == "evil"]
    for eid in evil_ids:
        assert not room.assassinate(assassin_id, eid)

    # Non-assassin cannot assassinate
    assert not room.assassinate(merlin_id, non_merlin_good)

    # If Assassin misses Merlin, Good wins!
    assert room.assassinate(assassin_id, non_merlin_good)
    assert room.phase == "gameover"
    assert room.winner == "good"
    assert room.state_dict()["revealedRoles"] is not None


def test_assassin_hits_merlin_evil_wins():
    room, ids, _ = make_room(5)
    room.start()
    room.advance()
    good_ids = [pid for pid in ids if rules.role_alignment(room.roles[pid]) == "good"]
    merlin_id = next(pid for pid in ids if room.roles[pid] == "merlin")
    assassin_id = room.assassin_id
    assert assassin_id is not None

    for q in range(1, 4):
        req = room.current_quest_size
        team = good_ids[:req]
        room.propose_team(room.leader_id, team)
        for pid in ids:
            room.vote(pid, True)
        room.advance()
        for pid in team:
            room.submit_quest_card(pid, True)
        if q < 3:
            room.advance()

    assert room.phase == "assassinate"
    assert room.assassinate(assassin_id, merlin_id)
    assert room.phase == "gameover"
    assert room.winner == "evil"


def test_bots_complete_actions_on_tick():
    room, (human,), clock = make_room(1)
    for _ in range(4):
        room.add_bot()
    assert room.start()
    room.mark_night_ready(human)
    assert room.phase == "team_building"

    # Let bots or human act through a proposal
    if room.leader_id == human:
        room.propose_team(human, room.seats[:2])
    else:
        clock.t += rooms.BOT_DELAY_SECONDS + 0.1
        assert room.tick()
    assert room.phase == "team_vote"
    room.vote(human, True)
    for _ in range(4):
        clock.t += rooms.BOT_DELAY_SECONDS + 0.1
        room.tick()
    assert room.phase == "team_reveal"
