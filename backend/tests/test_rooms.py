import random

import pytest

from app import game, rooms
from app.rooms import JoinError, Room


class FakeClock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def make_room():
    clock = FakeClock()
    room = Room("BCDF", rng=random.Random(1), clock=clock)
    room.starter_relics = False  # keep the seeded question order stable
    return room, clock


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


def test_player_placeholder_always_substituted():
    room, clock = make_room()
    room.add_player("Zed")
    room.add_bot()
    room.add_bot()
    room.set_length("long")
    room.new_game()
    for _ in range(len(rooms.DECK) + 5):
        assert "{player}" not in room.question_text
        if room.question.kind == "pick":
            assert [s.label for s in room.spots] == list(room.question.options)
        play_round(room, clock)
        room.start_round()
        if room.phase == "results":
            room.new_game()


def test_normalize_code():
    assert rooms.normalize_code(" bcdf ") == "BCDF"
    assert rooms.normalize_code("ABCD") is None  # vowels never used
    assert rooms.normalize_code("BCD") is None
    assert rooms.normalize_code(None) is None


# ---- Spirit Bets ------------------------------------------------------------


def start_two(room, clock):
    a = room.add_player("A")
    b = room.add_player("B")
    assert room.start_round()
    return a, b


def to_pull(room, clock):
    clock.t += rooms.QUESTION_SECONDS
    assert room.tick(1 / 30)
    assert room.phase == "pull"


def test_bets_only_valid_spots_and_only_during_question():
    room, clock = make_room()
    a, b = room.add_player("A"), room.add_player("B")
    assert not room.place_bet(a.id, "yes")  # lobby
    room.start_round()
    spot = room.spots[0].id
    assert not room.place_bet(a.id, "not-a-spot")
    assert not room.place_bet(a.id, 123)
    assert not room.place_bet("ghost", spot)
    assert room.place_bet(a.id, spot)
    assert room.place_bet(a.id, room.spots[1].id)  # can change mind
    assert a.bet == room.spots[1].id
    to_pull(room, clock)
    assert not room.place_bet(a.id, spot)  # locked
    assert a.bet == room.spots[1].id


def test_bets_hidden_until_reveal():
    room, clock = make_room()
    a, b = start_two(room, clock)
    room.place_bet(a.id, room.spots[0].id)
    state = room.state_dict()
    assert state["reveal"] is None
    pa = next(p for p in state["players"] if p["id"] == a.id)
    pb = next(p for p in state["players"] if p["id"] == b.id)
    assert pa["hasBet"] is True and pb["hasBet"] is False
    assert "bet" not in pa
    to_pull(room, clock)
    assert all(p["hasBet"] is None for p in room.state_dict()["players"])
    assert room.state_dict()["reveal"] is None


def test_spirits_bet_for_stragglers():
    room, clock = make_room()
    a, b = start_two(room, clock)
    room.place_bet(a.id, room.spots[0].id)
    to_pull(room, clock)
    assert b.bet is not None and b.auto_bet
    assert not a.auto_bet


def test_pot_split_between_winners():
    room, clock = make_room()
    a, b = start_two(room, clock)
    c = room.add_player("C")  # joins mid-round: not in this pot
    assert room.pot == 2 * rooms.POT_PER_PLAYER
    spot = room.spots[0].id
    for p in (a, b):
        room.place_bet(p.id, spot)
    room.place_bet(c.id, room.spots[1].id)
    to_pull(room, clock)
    room._finish_round(spot)
    share = room.pot // 2
    assert a.score == b.score == share and c.score == 0
    reveal = room.state_dict()["reveal"]
    assert reveal["payout"] == {a.id: share, b.id: share}
    assert reveal["bets"][c.id] == room.spots[1].id
    assert reveal["rolledOver"] is False


def test_no_winner_rolls_pot_over():
    room, clock = make_room()
    a, b = start_two(room, clock)
    room.place_bet(a.id, room.spots[0].id)
    room.place_bet(b.id, room.spots[0].id)
    to_pull(room, clock)
    room._finish_round(room.spots[1].id)
    assert a.score == b.score == 0
    assert room.carryover == 2 * rooms.POT_PER_PLAYER
    assert room.state_dict()["reveal"]["rolledOver"] is True
    room.start_round()
    assert room.pot == 4 * rooms.POT_PER_PLAYER
    assert room.carryover == 0


def test_new_game_resets_scores_and_stats():
    room, clock = make_room()
    a, b = start_two(room, clock)
    a.score, a.haunted, a.solo_wins = 300, 2, 1
    room.back_to_lobby()
    assert room.game_active  # mid-game trip to the lobby keeps the game
    assert a.score == 300
    assert room.new_game()
    assert (a.score, a.haunted, a.solo_wins) == (0, 0, 0)
    assert room.game_round == 1


# ---- Game structure ---------------------------------------------------------


def play_round(room, clock, answer=None):
    """Runs the current round to the reveal; lands on `answer` (or spot 0)."""
    if room.phase == "medium":
        medium = room.players[room.medium_id]
        if medium.is_bot:
            clock.t += 5
            room.tick(1 / 30)
        else:
            room.medium_answers(medium.id, room.spots[0].id)
    assert room.phase == "question"
    clock.t += rooms.QUESTION_SECONDS
    room.tick(1 / 30)
    assert room.phase == "pull"
    room._finish_round(answer or room.spots[0].id)
    assert room.phase == "reveal"


def test_plan_lengths_and_medium_slots():
    assert game.make_plan("short") == ["bets", "bets", "medium", "bets", "medium", "bets", "final"]
    std = game.make_plan("standard")
    assert len(std) == 10 and std[2] == std[6] == "medium" and std[-1] == "final"
    assert game.make_plan("long").count("medium") == 3
    assert game.make_plan("bogus") == std


def test_set_length_only_in_lobby_between_games():
    room, clock = make_room()
    room.add_player("A")
    room.add_player("B")
    room.set_length("short")
    room.set_length("nonsense")
    assert room.game_length == "short"
    room.new_game()
    room.set_length("long")
    assert room.game_length == "short"


def test_full_short_game_reaches_results_with_final_pot():
    room, clock = make_room()
    for n in ("A", "B", "C"):
        room.add_player(n)
    room.set_length("short")
    assert room.new_game()
    kinds = []
    while True:
        kinds.append(room.round_kind)
        if room.round_kind == "final":
            assert room.pot >= 3 * rooms.POT_PER_PLAYER * 3
            assert room.question == rooms.FINAL_QUESTION
        play_round(room, clock)
        assert room.start_round()
        if room.phase == "results":
            break
    assert kinds == game.make_plan("short")
    state = room.state_dict()
    assert state["awards"] and state["awards"][0]["key"] == "grand_medium"
    assert not room.game_active
    # Play again from the results screen.
    assert room.new_game() and room.phase == "question" and room.game_round == 1


def test_medium_round_hides_answer_and_scores():
    room, clock = make_room()
    a, b, c = (room.add_player(n) for n in ("A", "B", "C"))
    room.plan = ["medium", "final"]
    room.game_active = True
    assert room.start_round()
    assert room.phase == "medium"
    medium = room.players[room.medium_id]
    others = [p for p in (a, b, c) if p is not medium]
    if room.question.kind == "who":
        assert medium.id not in {s.id for s in room.spots}
    # Only the Medium can answer, and only with a real spot.
    assert not room.medium_answers(others[0].id, room.spots[0].id)
    assert not room.medium_answers(medium.id, "nope")
    assert room.medium_answers(medium.id, room.spots[1].id)
    assert room.phase == "question"
    state = room.state_dict()
    assert state["medium"] == {"playerId": medium.id, "answered": True}
    assert state["reveal"] is None  # the answer stays secret until the reveal
    assert "mediumAnswer" not in str(state)
    # The Medium can't bet or pull.
    assert not room.place_bet(medium.id, room.spots[0].id)
    room.place_bet(others[0].id, room.spots[1].id)  # right
    room.place_bet(others[1].id, room.spots[0].id)  # wrong
    clock.t += rooms.GUESS_SECONDS
    room.tick(1 / 30)
    room.set_pull(medium.id, 1, 0)
    assert medium.pull == (0.0, 0.0)
    room._finish_round(room.spots[1].id)  # board lands on the answer too
    assert others[0].score == 200  # guess + board
    assert others[1].score == 100  # board
    assert medium.score == 150  # board + 1 correct guesser
    reveal = room.state_dict()["reveal"]
    assert reveal["mediumAnswer"] == room.spots[1].id
    assert reveal["correct"] == [others[0].id] and reveal["boardMatched"]
    assert medium.open_book == 1 and others[0].mind_reads == 1


def test_medium_times_out_and_spirits_answer():
    room, clock = make_room()
    for n in ("A", "B", "C"):
        room.add_player(n)
    room.plan = ["medium", "final"]
    room.game_active = True
    room.start_round()
    clock.t += rooms.MEDIUM_ANSWER_SECONDS
    assert room.tick(1 / 30)
    assert room.phase == "question" and room.medium_auto and room.medium_answer


def test_medium_falls_back_to_bets_with_two_players():
    room, clock = make_room()
    room.add_player("A")
    room.add_player("B")
    room.plan = ["medium", "final"]
    room.game_active = True
    room.start_round()
    assert room.round_kind == "bets" and room.medium_id is None


def test_everyone_bet_shortens_timer():
    room, clock = make_room()
    a, b = start_two(room, clock)
    room.place_bet(a.id, room.spots[0].id)
    room.place_bet(b.id, room.spots[0].id)
    assert room.phase_ends_at - clock.t <= rooms.ALL_IN_SECONDS


def test_haunted_marks_and_awards():
    room, clock = make_room()
    a, b = start_two(room, clock)
    room.place_bet(a.id, b.id)
    room.place_bet(b.id, a.id)
    to_pull(room, clock)
    room._finish_round(b.id)
    assert b.haunted == 1 and a.solo_wins == 1
    awards = {aw["key"]: aw for aw in game.compute_awards(room.players.values())}
    assert awards["most_haunted"]["playerIds"] == [b.id]
    assert awards["lone_wolf"]["playerIds"] == [a.id]
    assert awards["grand_medium"]["playerIds"] == [a.id]
    assert "mind_reader" not in awards  # nobody scored it


def test_abandoned_round_is_replayed():
    room, clock = make_room()
    start_two(room, clock)
    assert room.game_round == 1
    room.back_to_lobby()
    assert room.game_round == 0
    room.start_round()
    assert room.game_round == 1


# ---- Curses -----------------------------------------------------------------

from app import curses, physics  # noqa: E402


def land_on(room, clock, player):
    """Plays the current round on a who-board and lands on `player`."""
    if room.phase == "medium":
        room.medium_answers(room.medium_id, room.spots[0].id)
    room.spots = physics.layout_spots([(p.id, p.name) for p in room.players.values()])
    play_round(room, clock, answer=player.id)


def test_curse_deck_rules():
    assert len(curses.CURSE_DECK) >= 30
    assert all(c.alt for c in curses.CURSE_DECK if c.drink)
    assert curses.FINAL_CURSES


def test_board_landing_on_human_deals_public_curse_until_next_reveal():
    room, clock = make_room()
    a = room.add_player("Alice")
    b = room.add_player("Bob")
    room.add_player("Cara")
    room.set_length("short")
    room.new_game()
    land_on(room, clock, a)
    curse = room.state_dict()["curse"]
    assert curse["playerId"] == a.id and curse["roundNo"] == room.round_no
    assert "{other}" not in curse["text"] and (not curse["drink"] or curse["alt"])
    # Still in force (shown as a reminder) during the next round...
    room.start_round()
    assert room.state_dict()["curse"]["playerId"] == a.id
    # ...and replaced at the next reveal.
    land_on(room, clock, b)
    assert room.state_dict()["curse"]["playerId"] == b.id


def test_no_curse_for_bots_non_players_or_when_off():
    room, clock = make_room()
    a = room.add_player("Alice")
    room.add_player("Bob")
    bot = room.add_bot()
    room.new_game()
    land_on(room, clock, bot)
    assert room.curse is None
    room.set_curses(False)
    room.start_round()
    land_on(room, clock, a)
    assert room.curse is None and room.state_dict()["game"]["cursesOn"] is False
    room.set_curses("yes")  # ignored: not a bool
    assert room.curses_on is False


def test_curse_deck_does_not_repeat_until_exhausted():
    room, _ = make_room()
    a = room.add_player("Alice")
    room.add_player("Bob")
    room.round_kind = "bets"
    dealt = set()
    for _ in range(len(curses.CURSE_DECK)):
        room._deal_curse(a)
        dealt.add((room.curse["drink"], room.curse["text"]))
    assert len(dealt) == len(curses.CURSE_DECK) and room._curse_order == []
    room._deal_curse(a)  # reshuffles instead of running dry
    assert room.curse is not None


def test_final_curse_goes_to_most_haunted():
    room, clock = make_room()
    a = room.add_player("Alice")
    room.add_player("Bob")
    room.set_length("short")
    room.new_game()
    while room.phase != "results":
        if room.phase == "reveal" or room.phase == "lobby":
            room.start_round()
            continue
        land_on(room, clock, a)
    fc = room.state_dict()["finalCurse"]
    assert fc["playerIds"] == [a.id] and fc["text"] in curses.FINAL_CURSES
    assert room.state_dict()["curse"] is None


def test_final_curse_skips_bots():
    room, _ = make_room()
    a = room.add_player("Alice")
    room.add_player("Bob")
    bot = room.add_bot()
    bot.haunted, a.haunted = 5, 1
    room._show_results()
    assert room.final_curse["playerIds"] == [a.id]
    a.haunted = 0
    room._show_results()
    assert room.final_curse is None


# ---- Relics -----------------------------------------------------------------

from app import relics  # noqa: E402


def relic_room(n_humans=3, kind_plan=None):
    room, clock = make_room()
    ps = [room.add_player(n) for n in ["Alice", "Bob", "Cara", "Dan"][:n_humans]]
    room.set_starter_relics(False)
    room.set_length("short")
    room.new_game()
    return room, clock, ps


def to_pull_phase(room, clock):
    if room.phase == "medium":
        room.medium_answers(room.medium_id, room.spots[0].id)
    clock.t += rooms.QUESTION_SECONDS
    room.tick(1 / 30)
    assert room.phase == "pull"


def test_starter_relics_dealt_per_game_and_to_late_joiners():
    room, clock = make_room()
    room.set_starter_relics(True)
    a = room.add_player("Alice")
    room.add_player("Bob")
    bot = room.add_bot()
    room.new_game()
    assert len(a.relics) == 1 and a.relics[0] in relics.CATALOG and bot.relics == []
    late = room.add_player("Late")
    assert len(late.relics) == 1


def test_unused_starter_relic_expires_at_next_game_but_others_carry_over():
    room, clock = make_room()
    room.set_starter_relics(True)
    a = room.add_player("Alice")
    room.add_player("Bob")
    room.new_game()
    first = a.starter
    assert a.relics == [first]
    room._grant(a, "whisper")  # e.g. found in the hunt
    room.phase = "results"
    room.new_game()
    assert len(a.relics) == 2 and "whisper" in a.relics  # old starter gone, new one dealt
    assert a.relics.count(a.starter) >= 1
    room.phase = "results"
    room.set_starter_relics(False)
    room.new_game()
    assert a.relics == ["whisper"] and a.starter is None


def test_relic_requires_ownership_phase_and_once_per_round():
    room, clock, (a, b, c) = relic_room()
    assert room.use_relic(a.id, "hex", b.id) == "You don’t have that Relic."
    room.dev_grant_all()
    assert "pull" in room.use_relic(a.id, "hex", b.id)  # still in question phase
    to_pull_phase(room, clock)
    assert room.use_relic(a.id, "hex", a.id)  # can't hex yourself
    assert room.use_relic(a.id, "hex", b.id) is None
    assert "One Relic" in room.use_relic(a.id, "salt", room.spots[0].id)
    assert a.relics.count("hex") == 0 and a.relic_round == room.round_no
    ev = room.state_dict()["relicEvents"][-1]
    assert ev["key"] == "hex" and ev["by"] == a.id and ev["target"] == b.id


def test_hex_freezes_and_mirror_reverses_input():
    room, clock, (a, b, c) = relic_room()
    room.dev_grant_all()
    to_pull_phase(room, clock)
    room.use_relic(a.id, "mirror", b.id)
    room.use_relic(c.id, "hex", a.id)
    for p in (a, b, c):
        p.pull_at = clock.t
    a.pull, b.pull, c.pull = (1.0, 0.0), (1.0, 0.0), (0.0, 0.0)
    room.tick(1 / 30)
    # Alice is frozen and Bob is mirrored: the net force points left.
    assert room.planchette.fx < 0
    assert room.state_dict()["effects"]["mirrored"] == [b.id]
    assert a.id in room.state_dict()["effects"]["hexed"]


def test_salt_blocks_landing_and_keeps_one_spot_open():
    room, clock, (a, b, c) = relic_room()
    room.dev_grant_all()
    to_pull_phase(room, clock)
    target = room.spots[0]
    assert room.use_relic(a.id, "salt", target.id) is None
    # Park the planchette on the salted spot: it never locks there.
    room.planchette.x, room.planchette.y = target.x, target.y
    for p in room.players.values():
        p.pull = (0.0, 0.0)
    for _ in range(90):
        room.tick(1 / 30)
    assert room.phase == "pull"
    # Time out: lands on the nearest *unsalted* spot.
    clock.t += rooms.PULL_SECONDS
    room.tick(1 / 30)
    assert room.result_spot_id != target.id
    # Can't salt every spot.
    room.start_round()
    to_pull_phase(room, clock)
    room.round_kind = "final"  # unlimited Relics, to salt many
    for s in room.spots[:-1]:
        room.dev_grant_all()
        room.use_relic(a.id, "salt", s.id)
    room.dev_grant_all()
    assert "open" in room.use_relic(a.id, "salt", room.spots[-1].id)


def test_magnet_pulls_planchette_toward_spot():
    room, clock, (a, b, c) = relic_room()
    room.dev_grant_all()
    to_pull_phase(room, clock)
    spot = room.spots[0]
    room.use_relic(a.id, "magnet", spot.id)
    d0 = ((spot.x - room.planchette.x) ** 2 + (spot.y - room.planchette.y) ** 2) ** 0.5
    for _ in range(20):
        room.tick(1 / 30)
    d1 = ((spot.x - room.planchette.x) ** 2 + (spot.y - room.planchette.y) ** 2) ** 0.5
    assert d1 < d0


def test_double_down_doubles_only_the_casters_share():
    room, clock, (a, b, c) = relic_room()
    room.dev_grant_all()
    spot = room.spots[0].id
    room.place_bet(a.id, spot)
    room.place_bet(b.id, spot)
    room.place_bet(c.id, room.spots[1].id)
    assert room.use_relic(a.id, "double") is None
    to_pull_phase(room, clock)
    room._finish_round(spot)
    share = room.pot // 2
    assert room.last_payout == {a.id: share * 2, b.id: share}
    assert room.state_dict()["reveal"]["doubled"] == [a.id]


def test_crystal_ball_is_private_counts_in_bets_and_crosses_out_in_medium():
    room, clock, (a, b, c) = relic_room()
    room.dev_grant_all()
    room.place_bet(b.id, room.spots[0].id)
    assert room.use_relic(a.id, "crystal") is None
    assert room.crystal_msg(a)["counts"] == {room.spots[0].id: 1}
    assert room.crystal_msg(b) is None
    # Medium round: two wrong answers crossed out, never the real one.
    while room.round_kind != "medium":
        play_round(room, clock)
        room.start_round()
    room.medium_answers(room.medium_id, room.spots[0].id)
    guesser = next(p for p in (a, b, c) if p.id != room.medium_id)
    room.dev_grant_all()
    assert room.use_relic(guesser.id, "crystal") is None
    crossed = room.crystal_msg(guesser)["crossed"]
    assert room.spots[0].id not in crossed and len(crossed) == min(2, len(room.spots) - 1)
    assert "Medium" in room.use_relic(room.medium_id, "crystal")


def test_ghost_whisper_is_anonymous_and_sanitized():
    room, clock, (a, b, c) = relic_room()
    room.dev_grant_all()
    assert room.use_relic(a.id, "whisper", text="x" * 41)
    assert room.use_relic(a.id, "whisper", text="  kevin\u202e bet on   himself  ") is None
    ev = room.state_dict()["relicEvents"][-1]
    assert ev["by"] is None and ev["text"] == "kevin bet on himself"


def test_medium_can_use_chaos_relics_but_not_pull_ones():
    room, clock, (a, b, c) = relic_room()
    while room.round_kind != "medium":
        play_round(room, clock)
        room.start_round()
    room.dev_grant_all()
    to_pull_phase(room, clock)
    other = next(p for p in (a, b, c) if p.id != room.medium_id)
    assert room.use_relic(room.medium_id, "hex", other.id)
    assert room.use_relic(room.medium_id, "jumpscare") is None


def test_final_seance_allows_many_relics():
    room, clock, (a, b, c) = relic_room()
    room.dev_grant_all()
    to_pull_phase(room, clock)
    room.round_kind = "final"
    assert room.use_relic(a.id, "hex", b.id) is None
    assert room.use_relic(a.id, "jumpscare") is None


# ---- Relics, Wave 2 ---------------------------------------------------------


def test_iron_grip_triples_pull_then_wears_off():
    room, clock, (a, b, c) = relic_room()
    room.dev_grant_all()
    to_pull_phase(room, clock)
    assert room.use_relic(a.id, "grip") is None
    for p in (a, b, c):
        p.pull_at = clock.t
    a.pull, b.pull, c.pull = (1.0, 0.0), (-1.0, 0.0), (0.0, 0.0)
    room.tick(1 / 30)
    assert room.planchette.fx > 0  # 3 vs 1: Alice wins the tug-of-war
    assert a.id in room.state_dict()["effects"]["gripping"]
    clock.t += relics.GRIP_SECONDS + 0.1
    for p in (a, b, c):
        p.pull_at = clock.t
    room.tick(1 / 30)
    assert abs(room.planchette.fx) < 1e-9 and room.state_dict()["effects"]["gripping"] == {}


def test_ouija_shuffle_moves_every_spot_at_halfway():
    room, clock, (a, b, c) = relic_room()
    room.dev_grant_all()
    to_pull_phase(room, clock)
    before = {s.id: (s.x, s.y, s.label) for s in room.spots}
    assert room.use_relic(a.id, "shuffle") is None
    shuffle_in = room.state_dict()["effects"]["shuffleIn"]
    assert abs(shuffle_in - rooms.PULL_SECONDS / 2) < 0.1
    room.dev_grant_all()
    room.round_kind = "final"  # allow a second cast this round
    assert "already" in room.use_relic(b.id, "shuffle")
    for p in room.players.values():
        p.pull = (0.0, 0.0)
    clock.t += rooms.PULL_SECONDS / 2 + 0.01
    assert room.tick(1 / 30) is True  # state changes -> rebroadcast
    after = {s.id: (s.x, s.y, s.label) for s in room.spots}
    assert set(after) == set(before)
    for sid in before:
        assert after[sid][2] == before[sid][2]  # labels stay with their ids
        assert after[sid][:2] != before[sid][:2]  # but nothing stays put
    assert sorted(v[:2] for v in after.values()) == sorted(v[:2] for v in before.values())
    assert room.state_dict()["effects"]["shuffleIn"] is None


def test_ouija_shuffle_cast_late_fires_soon():
    room, clock, (a, b, c) = relic_room()
    room.dev_grant_all()
    to_pull_phase(room, clock)
    clock.t += rooms.PULL_SECONDS * 0.75
    assert room.use_relic(a.id, "shuffle") is None
    assert abs(room.state_dict()["effects"]["shuffleIn"] - relics.SHUFFLE_MIN_DELAY) < 0.01


def test_seance_rewind_snaps_back_five_seconds():
    room, clock, (a, b, c) = relic_room()
    room.dev_grant_all()
    to_pull_phase(room, clock)
    a.pull_at = clock.t
    positions = []
    for _ in range(30 * 8):  # 8 seconds of Alice pulling right
        clock.t += 1 / 30
        for p in (a, b, c):
            p.pull_at = clock.t
        a.pull, b.pull, c.pull = (1.0, 0.0), (0.0, 0.0), (0.0, 0.0)
        room.tick(1 / 30)
        if room.phase != "pull":
            break
        positions.append((clock.t, room.planchette.x, room.planchette.y))
    assert room.phase == "pull"
    want = next(p for p in positions if p[0] >= clock.t - relics.REWIND_SECONDS)
    assert room.use_relic(b.id, "rewind") is None
    assert abs(room.planchette.x - want[1]) < 1e-9 and abs(room.planchette.y - want[2]) < 1e-9
    assert room.planchette.vx == 0 and room.planchette.hover_spot is None


def test_rewind_early_in_pull_goes_to_start():
    room, clock, (a, b, c) = relic_room()
    room.dev_grant_all()
    to_pull_phase(room, clock)
    room.planchette.x += 0.1
    assert room.use_relic(a.id, "rewind") is None
    assert (room.planchette.x, room.planchette.y) == (rooms.physics.START_X, rooms.physics.START_Y)


def test_tarot_changes_bet_secretly_during_pull():
    room, clock, (a, b, c) = relic_room()
    room.dev_grant_all()
    s0, s1 = room.spots[0].id, room.spots[1].id
    room.place_bet(a.id, s0)
    assert "pull" in room.use_relic(a.id, "tarot", s1)  # only during the pull
    to_pull_phase(room, clock)
    assert room.use_relic(a.id, "tarot", s0) == "That's already your bet."
    assert room.use_relic(a.id, "tarot", s1) is None
    assert a.bet == s1 and a.bet_dirty
    ev = room.state_dict()["relicEvents"][-1]
    assert ev["key"] == "tarot" and ev["target"] is None  # the new bet stays secret
    room.place_bet(b.id, s1)  # ignored: bets are closed
    room._finish_round(s1)
    assert a.id in room.last_payout


def test_blood_pact_shares_partners_winnings_without_chains():
    room, clock, (a, b, c) = relic_room()
    room.dev_grant_all()
    s0, s1 = room.spots[0].id, room.spots[1].id
    room.place_bet(a.id, s1)
    room.place_bet(b.id, s0)
    room.place_bet(c.id, s1)
    assert room.use_relic(a.id, "pact", a.id)  # not yourself
    assert room.use_relic(a.id, "pact", b.id) is None
    assert room.state_dict()["effects"]["pacts"] == {a.id: b.id}
    to_pull_phase(room, clock)
    room.round_kind = "final"
    room.dev_grant_all()
    assert room.use_relic(c.id, "pact", a.id) is None  # chain: Cara -> Alice -> Bob
    room.round_kind = "bets"
    score_before = {p.id: p.score for p in (a, b, c)}
    room._finish_round(s0)  # only Bob called it
    pot = room.pot
    assert room.last_payout[b.id] == pot
    assert room.last_payout[a.id] == pot  # Alice feeds on Bob's win
    assert c.id not in room.last_payout  # Cara gets Alice's *own* winnings only (none)
    assert a.score - score_before[a.id] == pot
    reveal = room.state_dict()["reveal"]
    assert reveal["pacts"] == {a.id: b.id, c.id: a.id} and reveal["pactGains"] == {a.id: pot}


# ---- Catch-up Relics -----------------------------------------------------------


def test_catchup_relic_goes_to_last_place_after_rounds_3_and_6_and_expires():
    room, clock, (a, b, c) = relic_room()
    a.score, b.score, c.score = 300, 100, 100
    dealt = []
    for _ in range(6):  # rounds 1..6
        a.score += 1000  # Alice stays far ahead
        if room.phase == "medium":
            room.medium_answers(room.medium_id, room.spots[0].id)
        room._finish_round(room.spots[0].id)
        room.phase = "reveal"
        if room.last_catchup:
            dealt.append((room.game_round, dict(room.last_catchup)))
            assert room.state_dict()["reveal"]["catchUp"] == sorted(room.last_catchup)
        room.start_round()
    assert [r for r, _ in dealt] == [3, 6]
    for _, who in dealt:
        # Payouts in these rounds may shuffle the bottom; whoever was lowest got one.
        assert a.id not in who
        assert all(relics.CATALOG[k].tier == "common" for k in who.values())
    held = {p.id: list(p.catchup) for p in (a, b, c)}
    assert sum(len(v) for v in held.values()) >= 2
    # They expire when the next game starts.
    room.phase = "results"
    room.new_game()
    assert all(p.catchup == [] and p.relics == [] for p in (a, b, c))


def test_no_catchup_when_tied_or_turned_off():
    room, clock, (a, b, c) = relic_room()
    room.set_catchup_relics(False)
    a.score = 500
    room.game_round = 3
    room._deal_catchup()
    assert room.last_catchup == {}
    room.set_catchup_relics(True)
    a.score = b.score = c.score = 0
    room._deal_catchup()
    assert room.last_catchup == {}
