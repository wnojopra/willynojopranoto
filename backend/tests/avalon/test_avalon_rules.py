import random
import pytest

from app.avalon import rules


@pytest.mark.parametrize(
    "n,good,evil",
    [
        (5, 3, 2),
        (6, 4, 2),
        (7, 4, 3),
        (8, 5, 3),
        (9, 6, 3),
        (10, 6, 4),
    ],
)
def test_alignment_split_and_deal(n: int, good: int, evil: int):
    seats = [f"p{i}" for i in range(n)]
    dealt = rules.deal_roles(seats, {"percival", "morgana", "mordred", "oberon"}, random.Random(42))
    assert len(dealt) == n
    good_dealt = [r for r in dealt.values() if rules.role_alignment(r) == "good"]
    evil_dealt = [r for r in dealt.values() if rules.role_alignment(r) == "evil"]
    assert len(good_dealt) == good
    assert len(evil_dealt) == evil
    assert "merlin" in good_dealt
    assert "assassin" in evil_dealt


def test_quest_4_requires_two_fails_only_for_7_plus_players():
    for n in (5, 6):
        assert rules.fails_required(n, 4) == 1
        assert not rules.quest_succeeded(n, 4, 1)
    for n in (7, 8, 9, 10):
        for q in (1, 2, 3, 5):
            assert rules.fails_required(n, q) == 1
            assert not rules.quest_succeeded(n, q, 1)
        assert rules.fails_required(n, 4) == 2
        assert rules.quest_succeeded(n, 4, 1)
        assert not rules.quest_succeeded(n, 4, 2)


def test_night_sightings_with_all_special_characters():
    seats = ["p_merlin", "p_percival", "p_servant", "p_assassin", "p_morgana", "p_mordred", "p_oberon"]
    roles = {
        "p_merlin": "merlin",
        "p_percival": "percival",
        "p_servant": "servant",
        "p_assassin": "assassin",
        "p_morgana": "morgana",
        "p_mordred": "mordred",
        "p_oberon": "oberon",
    }
    sightings = rules.compute_sightings(seats, roles)

    # Merlin sees Assassin, Morgana, and Oberon, but NOT Mordred
    assert sightings["p_merlin"]["seenIds"] == ["p_assassin", "p_morgana", "p_oberon"]

    # Percival sees Merlin and Morgana
    assert sightings["p_percival"]["seenIds"] == ["p_merlin", "p_morgana"]

    # Loyal Servant sees nobody
    assert sightings["p_servant"]["seenIds"] == []

    # Minions of Mordred (Assassin, Morgana, Mordred) see each other, but NOT Oberon
    assert sightings["p_assassin"]["seenIds"] == ["p_morgana", "p_mordred"]
    assert sightings["p_morgana"]["seenIds"] == ["p_assassin", "p_mordred"]
    assert sightings["p_mordred"]["seenIds"] == ["p_assassin", "p_morgana"]

    # Oberon sees nobody
    assert sightings["p_oberon"]["seenIds"] == []


def test_night_script_adapts_to_optional_roles():
    base_script = rules.build_night_script([])
    ids = [s["id"] for s in base_script]
    assert "percival_open" not in ids
    assert "not Oberon" not in str(base_script)
    assert "not Mordred" not in str(base_script)

    full_script = rules.build_night_script(["percival", "morgana", "mordred", "oberon"])
    full_ids = [s["id"] for s in full_script]
    assert "percival_open" in full_ids
    assert any("not Oberon" in str(s["text"]) for s in full_script)
    assert any("not Mordred" in str(s["text"]) for s in full_script)
    assert any("Merlin and Morgana" in str(s["text"]) for s in full_script)
