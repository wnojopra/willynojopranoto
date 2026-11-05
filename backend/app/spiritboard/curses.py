"""Curse cards: dealt by the board to whoever it lands on.

DRAFT DECK: the host will review and edit these, and add inside jokes.

Rules for writing cards:
- Every card lasts "until the next reveal" unless it says otherwise, so the
  whole room can police it for one round.
- 🍺 cards (drink=True) MUST have an `alt`: a non-drinking option, so nobody is
  pressured. The TV always shows both.
- `{other}` is replaced with a random other player's name (humans preferred).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CurseCard:
    text: str
    drink: bool = False
    alt: str | None = None  # required when drink=True


CURSE_DECK: list[CurseCard] = [
    # --- Performances -----------------------------------------------------
    CurseCard("Speak only in a ghost voice until the next reveal."),
    CurseCard("Narrate everything you do like a horror movie trailer. “In a world…”"),
    CurseCard("Hold your phone in your non-dominant hand for the next round."),
    CurseCard("You are possessed. Every sentence must end with “…and the demon agrees.”"),
    CurseCard("Give {other} a dramatic, tearful eulogy. They aren’t dead. Yet."),
    CurseCard("Do your best impression of {other} discovering a body."),
    CurseCard("You may only communicate in screams of varying pitch until the next reveal."),
    CurseCard("Slow-dance with an invisible ghost for 15 seconds. Make it romantic."),
    CurseCard("Confess one red flag of yours to the group. The spirits will know if you lie."),
    CurseCard("Read your last sent text out loud in your spookiest voice."),
    CurseCard("Swap seats with {other}. They’re you now. Act accordingly."),
    CurseCard("Everyone gets to give you a new horror-movie nickname. Answer only to the winner."),
    CurseCard("You’re the first victim. Die dramatically on the floor, then rise again."),
    CurseCard("Pitch {other} as a love interest in a cheesy ghost romance. Sell it."),
    CurseCard("Whisper a dark secret to {other}. They decide if it’s good enough."),
    CurseCard("Every time someone says your name until the next reveal, you must gasp in horror."),
    CurseCard("Reveal the most cursed photo in your camera roll. The room votes if it counts."),
    CurseCard("Speak to the spirits: ask them one question out loud and answer it in their voice."),
    # --- 🍺 Drink or alternative -------------------------------------------
    CurseCard("Take a sip every time someone says your name until the next reveal.", True,
              "Do a squat instead of each sip."),
    CurseCard("Drink once for every player who bet on you this round.", True,
              "Eat one candy corn per bettor."),
    CurseCard("Ghostly Gulp: drink while the TV counts down 3 seconds.", True,
              "Hold a plank for the count instead."),
    CurseCard("Pick a drinking buddy. They drink whenever you do until the next reveal.", True,
              "Your buddy joins your alternative instead."),
    CurseCard("Toast the spirits: give a dramatic 10-second toast, then drink.", True,
              "Give the toast, then eat the scariest candy in the bowl."),
    CurseCard("Waterfall with {other}. You can’t stop until they do.", True,
              "Staring contest with {other} instead. Loser does 5 jumping jacks."),
    CurseCard("Drink with your non-dominant hand for the rest of the game. Mess up, take a sip.", True,
              "Mess up and you owe the room a compliment each time."),
    CurseCard("Blood Oath: you and {other} both drink. Your fates are bound.", True,
              "You both eat a candy, arms linked."),
    CurseCard("Never Have I Ever (haunted edition): say something you’ve never done. Everyone who has, drinks.", True,
              "Everyone who has does a spooky pose for 5 seconds."),
    CurseCard("The ghost thirsts. Finish whatever’s in your cup… or hand it to {other}.", True,
              "Let {other} pick a dare for you instead."),
    CurseCard("Cheers with the person to your left and drink like you just survived the movie.", True,
              "High-five them and scream “WE LIVED!”"),
    CurseCard("Sip for every 💀 Haunted mark you have. The spirits are keeping count.", True,
              "One push-up per mark."),
]

# The Final Curse: a bigger penalty for whoever ends with the most Haunted
# marks. The host can override with their own penalty pile.
FINAL_CURSES: list[str] = [
    "Wear the cursed hat for the rest of the party.",
    "Serenade the room with a horror-movie love song of the group’s choosing.",
    "Let the group post one (tasteful) photo to your story with a caption they write.",
    "Be the haunted butler: fetch drinks and snacks for the next 15 minutes.",
    "Re-enact a famous horror scene picked by the winner. Full commitment.",
    "Tell the scariest true story you know, by candlelight, right now.",
    "Speak like a Victorian ghost until someone else gets cursed.",
    "Text your most recent ex (or crush) a single 👻. No context.",
]

assert all(c.alt for c in CURSE_DECK if c.drink), "every 🍺 card needs a non-drinking option"
