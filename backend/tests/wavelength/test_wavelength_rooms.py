"""State machine tests for WavelengthRoom across Teams, Free-for-All, and Co-op modes."""

from __future__ import annotations

import base64
import random
import pytest

from app.shared.rooms_util import JoinError
from app.wavelength import rooms


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def make_room(n: int = 4) -> tuple[rooms.WavelengthRoom, list[str], Clock]:
    clock = Clock()
    room = rooms.WavelengthRoom("BCDF", rng=random.Random(42), clock=clock)
    ids = [room.add_player(f"Player{i}").id for i in range(n)]
    return room, ids, clock


def test_lobby_and_secret_isolation() -> None:
    room, ids, _ = make_room(1)
    assert not room.can_start()
    assert not room.start()

    p2 = room.add_player("Player1")
    ids.append(p2.id)
    assert room.can_start()
    assert room.move_seat(ids[0], 1)
    assert room.start()
    assert room.phase == "psychic"

    # Public state must NEVER contain the secret target during psychic, guessing, or bonus
    st = room.state_dict()
    assert st["reveal"] is None
    assert "target" not in st
    sec = room.psychic_secret_msg()
    assert sec is not None and isinstance(sec["target"], float)


def test_teams_mode_turn_and_bonus_flow() -> None:
    room, ids, _ = make_room(4)
    room.set_target_score(5)
    assert room.start()
    assert room.phase == "psychic"

    psychic_id = room.psychic_id
    assert psychic_id in ids
    target = room._target
    assert target is not None

    # Non-psychic cannot submit clue
    other_id = next(pid for pid in ids if pid != psychic_id)
    assert not room.submit_clue(other_id, "Nope")
    assert room.submit_clue(psychic_id, "Warm soup")
    assert room.phase == "guessing"
    assert room.state_dict()["clue"] == "Warm soup"

    # Find teammate on active team to lock in a guess 10 degrees to the left of target (worth 3 pts)
    active_team_id = room.teams[room.active_team_idx].id
    teammate = next(
        p for p in room.players if p.team_id == active_team_id and p.id != psychic_id
    )
    guess_angle = max(-90.0, min(90.0, target - 10.0))
    assert room.aim_dial(teammate.id, guess_angle)
    assert room.lock_guess(teammate.id, guess_angle)
    assert room.phase == "bonus"

    # Opposing team member votes "right" (since target > guess_angle) and earns +1 bonus pt
    opp_player = next(p for p in room.players if p.team_id != active_team_id)
    assert room.submit_bonus(opp_player.id, "right")
    assert room.phase == "reveal"
    rev = room.state_dict()["reveal"]
    assert rev is not None
    assert rev["points"] == 3
    assert rev["bonusPoints"][opp_player.team_id] == 1


def test_ffa_mode_and_gameover() -> None:
    room, ids, _ = make_room(3)
    assert room.set_mode("ffa")
    assert room.set_target_score(5)
    assert room.start()

    psychic_id = room.psychic_id
    target = room._target or 0.0
    assert room.submit_clue(psychic_id, "Exact spot")

    guessers = [pid for pid in ids if pid != psychic_id]
    # First guesser hits bullseye (4 pts), second misses -> adjust by +1 to hit 5 target
    assert room.lock_guess(guessers[0], target)
    assert room.phase == "guessing"
    far_angle = -85.0 if target > 0 else 85.0
    assert room.lock_guess(guessers[1], far_angle)
    assert room.phase == "reveal"
    assert room.adjust_score(guessers[0], 1)

    # Advance turn -> guessers[0] reached 5 points, so game over!
    assert room.next_turn()
    assert room.phase == "gameover"
    assert guessers[0] in room.winners


def test_coop_mode_flow() -> None:
    room, ids, _ = make_room(2)
    assert room.set_mode("coop")
    room.coop_total_cards = 1
    assert room.start()

    psychic_id = room.psychic_id
    guesser_id = next(pid for pid in ids if pid != psychic_id)
    assert room.submit_clue(psychic_id, "Clue")
    # Miss so no bonus card is added
    far = -85.0 if (room._target or 0.0) > 0 else 85.0
    assert room.lock_guess(guesser_id, far)
    assert room.phase == "reveal"
    assert room.next_turn()
    assert room.phase == "gameover"
    assert room.state_dict()["coop"]["rating"] is not None


def test_device_rejoin_and_bot_progression() -> None:
    clock = Clock()
    room = rooms.WavelengthRoom("BCDF", rng=random.Random(7), clock=clock)
    p1 = room.add_player("Alice", device="dev-alice")
    with pytest.raises(JoinError):
        room.add_player("Alice", device="dev-impostor")

    # Rejoining with same device token reclaims seat
    p1_re = room.add_player("Alice", device="dev-alice")
    assert p1_re.id == p1.id

    # Add bots and drive a full bot turn
    room.add_bot()
    room.add_bot()
    room.add_bot()
    assert room.start()

    # If human is psychic, submit clue; then let bots finish
    if not room.get_player(room.psychic_id).is_bot:  # type: ignore[union-attr]
        room.submit_clue(room.psychic_id, "Bot test")
    else:
        clock.t += rooms.BOT_DELAY_SECONDS + 0.1
        assert room.tick_bots()
    assert room.phase == "guessing"


def test_avatar_validation_and_cooldown() -> None:
    room, ids, clock = make_room(2)
    pid = ids[0]
    valid_jpeg = b"\xff\xd8\xff\xe0" + b"0" * 32 + b"\xff\xd9"
    data_url = rooms.AVATAR_PREFIX + base64.b64encode(valid_jpeg).decode("ascii")

    assert room.set_avatar(pid, data_url)
    # Cooldown blocks immediate second upload
    assert not room.set_avatar(pid, data_url)
    clock.t += rooms.AVATAR_COOLDOWN_SECONDS + 0.1
    assert room.set_avatar(pid, None)
    assert pid not in room.avatars

    # Reject non-JPEG bytes
    clock.t += rooms.AVATAR_COOLDOWN_SECONDS + 0.1
    bad_url = rooms.AVATAR_PREFIX + base64.b64encode(b"not-a-jpeg").decode("ascii")
    assert not room.set_avatar(pid, bad_url)
