"""Pure rules for The Resistance: Avalon (5-10 players). No I/O."""

from __future__ import annotations

import random

MIN_PLAYERS = 5
MAX_PLAYERS = 10
TOTAL_QUESTS = 5
QUESTS_TO_WIN = 3
MAX_REJECTED_VOTES = 5

# Player count -> (good_count, evil_count)
ALIGNMENT_SPLIT: dict[int, tuple[int, int]] = {
    5: (3, 2),
    6: (4, 2),
    7: (4, 3),
    8: (5, 3),
    9: (6, 3),
    10: (6, 4),
}

# Player count -> tuple of 5 quest team sizes
QUEST_TEAM_SIZES: dict[int, tuple[int, int, int, int, int]] = {
    5: (2, 3, 2, 3, 3),
    6: (2, 3, 4, 3, 4),
    7: (2, 3, 3, 4, 4),
    8: (3, 4, 4, 5, 5),
    9: (3, 4, 4, 5, 5),
    10: (3, 4, 4, 5, 5),
}

OPTIONAL_ROLES = ("percival", "mordred", "morgana", "oberon")
OPTIONAL_GOOD_ROLES = ("percival",)
OPTIONAL_EVIL_ROLES = ("mordred", "morgana", "oberon")

ROLE_METADATA: dict[str, dict[str, str]] = {
    "merlin": {
        "id": "merlin",
        "name": "Merlin",
        "alignment": "good",
        "title": "Loyal Servant of Arthur",
        "power": "Knows the agents of Evil (except Mordred), but must keep his identity hidden from the Assassin.",
    },
    "percival": {
        "id": "percival",
        "name": "Percival",
        "alignment": "good",
        "title": "Loyal Servant of Arthur",
        "power": "Knows who Merlin is at the start of the game (though Morgana also appears as Merlin).",
    },
    "servant": {
        "id": "servant",
        "name": "Loyal Servant of Arthur",
        "alignment": "good",
        "title": "Knight of Camelot",
        "power": "Fights for Goodness and honor without special knowledge. Must deduce whom to trust.",
    },
    "assassin": {
        "id": "assassin",
        "name": "The Assassin",
        "alignment": "evil",
        "title": "Minion of Mordred",
        "power": "If Good completes three Quests, the Assassin has one final chance to win for Evil by naming Merlin.",
    },
    "morgana": {
        "id": "morgana",
        "name": "Morgana",
        "alignment": "evil",
        "title": "Minion of Mordred",
        "power": "Appears to Percival as Merlin during the Night reveal, sowing confusion among the Good.",
    },
    "mordred": {
        "id": "mordred",
        "name": "Mordred",
        "alignment": "evil",
        "title": "Leader of Evil",
        "power": "His identity is hidden from Merlin during the Night reveal, allowing him to work in the shadows.",
    },
    "oberon": {
        "id": "oberon",
        "name": "Oberon",
        "alignment": "evil",
        "title": "Agent of Evil",
        "power": "Is not a Minion of Mordred: he does not know the other Evil players, nor do they know him (though Merlin still sees him).",
    },
    "minion": {
        "id": "minion",
        "name": "Minion of Mordred",
        "alignment": "evil",
        "title": "Minion of Mordred",
        "power": "Knows the other Minions of Mordred and works to fail three Quests or uncover Merlin.",
    },
}


def role_alignment(role: str) -> str:
    """Returns 'good' or 'evil' for a role ID."""
    return ROLE_METADATA[role]["alignment"]


def quest_specs(num_players: int) -> list[dict[str, int]]:
    """Returns the 5 Quest specifications for a given player count (5..10).

    Note: The 4th Quest (and only the 4th Quest) in games of 7 or more players
    requires at least two Quest Fail cards to be a failed Quest.
    """
    n = max(MIN_PLAYERS, min(MAX_PLAYERS, num_players))
    sizes = QUEST_TEAM_SIZES[n]
    return [
        {
            "quest": i + 1,
            "teamSize": sizes[i],
            "failsRequired": 2 if (i == 3 and n >= 7) else 1,
        }
        for i in range(TOTAL_QUESTS)
    ]


def fails_required(num_players: int, quest_num: int) -> int:
    """Number of Fail cards required for quest_num (1..5) to fail."""
    return 2 if (quest_num == 4 and num_players >= 7) else 1


def quest_succeeded(num_players: int, quest_num: int, fail_count: int) -> bool:
    """True if fail_count is strictly less than the Fails required for this Quest."""
    return fail_count < fails_required(num_players, quest_num)


def effective_optional_roles(num_players: int, enabled: set[str] | list[str]) -> list[str]:
    """Filters optional roles that can actually fit in the Good/Evil slots for num_players.

    Merlin always takes 1 Good slot, and Assassin always takes 1 Evil slot.
    Remaining slots can be filled by enabled optional roles in canonical order:
    Good: percival
    Evil: morgana, mordred, oberon (if more are enabled than evil_count - 1, caps to fit).
    """
    n = max(MIN_PLAYERS, min(MAX_PLAYERS, num_players))
    good_total, evil_total = ALIGNMENT_SPLIT[n]
    good_extra = max(0, good_total - 1)
    evil_extra = max(0, evil_total - 1)

    active: list[str] = []
    if "percival" in enabled and good_extra >= 1:
        active.append("percival")

    # Prioritize optional Evil roles in a predictable order if more are toggled than fit
    for r in ("mordred", "morgana", "oberon"):
        if r in enabled and len([x for x in active if role_alignment(x) == "evil"]) < evil_extra:
            active.append(r)
    return active


def deal_roles(
    seats: list[str],
    enabled_optional: set[str] | list[str],
    rng: random.Random,
) -> dict[str, str]:
    """Deals one Character Card to each player in seats."""
    n = len(seats)
    if not MIN_PLAYERS <= n <= MAX_PLAYERS:
        raise ValueError(f"Avalon requires {MIN_PLAYERS}..{MAX_PLAYERS} players, got {n}")
    good_total, evil_total = ALIGNMENT_SPLIT[n]
    active_opt = effective_optional_roles(n, enabled_optional)

    good_deck = ["merlin"] + [r for r in active_opt if role_alignment(r) == "good"]
    while len(good_deck) < good_total:
        good_deck.append("servant")

    evil_deck = ["assassin"] + [r for r in active_opt if role_alignment(r) == "evil"]
    while len(evil_deck) < evil_total:
        evil_deck.append("minion")

    deck = good_deck + evil_deck
    rng.shuffle(deck)
    return {pid: role for pid, role in zip(seats, deck)}


def compute_sightings(
    seats: list[str],
    roles: dict[str, str],
) -> dict[str, dict[str, object]]:
    """Computes what each player learns during the Night (Role Review) phase.

    Rules from the Avalon rulebook (pages 2 & 7):
    - Minions of Mordred (all Evil EXCEPT Oberon): open their eyes and see all other
      Minions of Mordred (Evil players except Oberon).
    - Oberon: is not a "Minion of Mordred" and does not open his eyes during the Evil
      reveal, nor do the other Evil players see him.
    - Merlin: sees all agents of Evil EXCEPT Mordred (Oberon still extends his thumb
      for Merlin!).
    - Percival: sees Merlin and Morgana (cannot distinguish which is which).
    - Loyal Servants of Arthur: see no one.
    """
    out: dict[str, dict[str, object]] = {}

    # Maintain seat order for sightings so card positions don't leak deal order
    minions_of_mordred = [
        pid for pid in seats if role_alignment(roles[pid]) == "evil" and roles[pid] != "oberon"
    ]
    visible_to_merlin = [
        pid for pid in seats if role_alignment(roles[pid]) == "evil" and roles[pid] != "mordred"
    ]
    visible_to_percival = [
        pid for pid in seats if roles[pid] in ("merlin", "morgana")
    ]

    has_oberon = "oberon" in roles.values()
    has_mordred = "mordred" in roles.values()
    has_morgana = "morgana" in roles.values()

    for pid in seats:
        r = roles[pid]
        meta = ROLE_METADATA[r]
        seen_ids: list[str] = []
        label = ""
        note = ""

        if r == "merlin":
            seen_ids = list(visible_to_merlin)
            label = "Known Agents of Evil"
            note = (
                "Mordred is in the game and remains hidden from your sight!"
                if has_mordred
                else "You see all agents of Evil."
            )
        elif r == "percival":
            seen_ids = list(visible_to_percival)
            label = "Merlin or Morgana" if has_morgana else "Merlin"
            note = (
                "One is Merlin and the other is Morgana — you do not know which is which!"
                if has_morgana and len(seen_ids) > 1
                else "Protect Merlin's identity with your life."
            )
        elif r == "oberon":
            seen_ids = []
            label = "Working Alone in the Shadows"
            note = "You are Evil, but you do not know the other Minions of Mordred, nor do they know you."
        elif role_alignment(r) == "evil":
            seen_ids = [other for other in minions_of_mordred if other != pid]
            label = "Fellow Minions of Mordred"
            note = (
                "Oberon is also in the game, hidden even from you!"
                if has_oberon
                else "Coordinate in the shadows to fail three Quests or find Merlin."
            )
        else:
            seen_ids = []
            label = "No Night Vision"
            note = "You have no special night knowledge. Watch votes and discussions closely!"

        out[pid] = {
            "role": r,
            "name": meta["name"],
            "alignment": meta["alignment"],
            "title": meta["title"],
            "power": meta["power"],
            "seenIds": seen_ids,
            "seenLabel": label,
            "seenNote": note,
        }
    return out


def build_night_script(active_optional: set[str] | list[str]) -> list[dict[str, object]]:
    """Builds the ordered ceremony steps for the Night Phase audio & TV display.

    Matches the official rulebook scripts on page 2 and page 7.
    """
    has_oberon = "oberon" in active_optional
    has_mordred = "mordred" in active_optional
    has_percival = "percival" in active_optional
    has_morgana = "morgana" in active_optional

    steps: list[dict[str, object]] = [
        {
            "id": "close_eyes",
            "Cue": "Everyone",
            "text": "Everyone close your eyes and extend your hand into a fist in front of you.",
            "pauseAfterMs": 3200,
        },
        {
            "id": "evil_open",
            "Cue": "Minions of Mordred",
            "text": (
                "Minions of Mordred, not Oberon — open your eyes and look around so that you know all agents of Evil."
                if has_oberon
                else "Minions of Mordred — open your eyes and look around so that you know all agents of Evil."
            ),
            "pauseAfterMs": 5500,
        },
        {
            "id": "evil_close",
            "Cue": "Minions of Mordred",
            "text": (
                "Minions of Mordred, close your eyes. All players should have their eyes closed and hands in a fist in front of them."
            ),
            "pauseAfterMs": 2800,
        },
        {
            "id": "merlin_open",
            "Cue": "Merlin",
            "text": (
                "Minions of Mordred, not Mordred himself — extend your thumb so that Merlin will know of you. "
                "Merlin, open your eyes and see the agents of Evil."
                if has_mordred
                else "Minions of Mordred — extend your thumb so that Merlin will know of you. "
                "Merlin, open your eyes and see the agents of Evil."
            ),
            "pauseAfterMs": 6000,
        },
        {
            "id": "merlin_close",
            "Cue": "Merlin",
            "text": (
                "Minions of Mordred — put your thumbs down and re-form your hand into a fist. "
                "Merlin, close your eyes. All players should have their eyes closed and hands in a fist in front of them."
            ),
            "pauseAfterMs": 2800,
        },
    ]

    if has_percival:
        who = "Merlin and Morgana" if has_morgana else "Merlin"
        steps.append(
            {
                "id": "percival_open",
                "Cue": "Percival",
                "text": (
                    f"{who} — extend your thumb so that Percival may know of you. "
                    f"Percival, open your eyes so you may know {who}."
                ),
                "pauseAfterMs": 5500,
            }
        )
        steps.append(
            {
                "id": "percival_close",
                "Cue": "Percival",
                "text": (
                    f"{who} — put your thumbs down and form your hand into a fist. "
                    "Percival, close your eyes. All players should have their eyes closed and hands in a fist in front of them."
                ),
                "pauseAfterMs": 2800,
            }
        )

    steps.append(
        {
            "id": "wake_up",
            "Cue": "Everyone",
            "text": "Everyone open your eyes! Let the council of Camelot begin.",
            "pauseAfterMs": 1500,
        }
    )
    return steps
