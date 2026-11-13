"""Spectrum card decks and custom card parser for Wavelength.

Includes the full 135-card classic deck from mikeck1.github.io plus themed party,
pop-culture, and deep/weird expansion packs.
"""

from __future__ import annotations

import json
import re
from typing import Any

MAX_CARD_LEN = 60
MAX_CUSTOM_CARDS = 500

CardPair = tuple[str, str]

# 135 classic spectrum pairs from mikeck1/mikeck1.github.io (clues.json)
CORE_CARDS: tuple[CardPair, ...] = (
    ("Cold", "Hot"),
    ("Tiny", "Giant"),
    ("Slow", "Fast"),
    ("Quiet", "Loud"),
    ("Soft", "Hard"),
    ("Light as a Feather", "Super Heavy"),
    ("Smooth", "Bumpy"),
    ("Dry", "Soaking Wet"),
    ("Short", "Tall"),
    ("Dark", "Bright"),
    ("Sour", "Sweet"),
    ("Stinky", "Smells Amazing"),
    ("Squishy", "Crunchy"),
    ("Sparkling Clean", "Super Messy"),
    ("Sleepy", "Wide Awake"),
    ("Down Low", "Up High"),
    ("Close By", "Far, Far Away"),
    ("Brand New", "Really Old"),
    ("Plain", "Colorful"),
    ("Round", "Pointy"),
    ("Scaly", "Fluffy"),
    ("Calm", "Wild"),
    ("Sinks", "Floats"),
    ("Straight", "Wiggly"),
    ("Sticky", "Slippery"),
    ("Scary Animal", "Cuddly Animal"),
    ("Slow Animal", "Speedy Animal"),
    ("Quiet Animal", "Noisy Animal"),
    ("Tricky Pet", "Perfect Pet"),
    ("Lazy Animal", "Busy Animal"),
    ("Silly-Looking Animal", "Cool-Looking Animal"),
    ("Animal You'd Never Ride", "Animal You'd Love to Ride"),
    ("Sneaky Animal", "Clumsy Animal"),
    ("Worst Class Pet", "Best Class Pet"),
    ("Boring Zoo Exhibit", "Best Zoo Exhibit"),
    ("Yucky Food", "Yummy Food"),
    ("Breakfast Food", "Dinner Food"),
    ("Tidy Food", "Messy Food"),
    ("Little Snack", "Giant Feast"),
    ("Mild", "Spicy"),
    ("Worst Pizza Topping", "Best Pizza Topping"),
    ("Worst Ice Cream Flavor", "Best Ice Cream Flavor"),
    ("Everyday Food", "Special Treat"),
    ("Spoon Food", "Finger Food"),
    ("Boring Sandwich", "Amazing Sandwich"),
    ("Worst Lunchbox Surprise", "Best Lunchbox Surprise"),
    ("Better Cold", "Better Hot"),
    ("Weird Food Combo", "Perfect Food Combo"),
    ("Worst Road Trip Snack", "Best Road Trip Snack"),
    ("Worst School Lunch", "Best School Lunch"),
    ("Boring Toy", "Awesome Toy"),
    ("Indoor Fun", "Outdoor Fun"),
    ("Easy Game", "Tricky Game"),
    ("Fun Alone", "Fun With Friends"),
    ("Gentle Ride", "Wild Ride"),
    ("Terrible Hiding Spot", "Great Hiding Spot"),
    ("Boring Playground Thing", "Best Playground Thing"),
    ("Easy Sport", "Hard Sport"),
    ("Boring Rainy Day Activity", "Best Rainy Day Activity"),
    ("Sleepy Birthday Party", "Epic Birthday Party"),
    ("Easy to Draw", "Hard to Draw"),
    ("Easy to Build", "Hard to Build"),
    ("Calm Hobby", "Exciting Hobby"),
    ("Quick Game", "Game That Takes Forever"),
    ("Boring Car Ride Game", "Fun Car Ride Game"),
    ("Wobbly Fort Material", "Sturdy Fort Material"),
    ("Worst Costume", "Best Costume"),
    ("Boring Video Game", "Can't-Stop-Playing Video Game"),
    ("Boring School Subject", "Fascinating School Subject"),
    ("Easy Homework", "Hard Homework"),
    ("Worst Field Trip", "Best Field Trip"),
    ("Silly Homework Excuse", "Believable Homework Excuse"),
    ("Useless Fact", "Mind-Blowing Fact"),
    ("Easy Word to Spell", "Hard Word to Spell"),
    ("Boring Show-and-Tell", "Amazing Show-and-Tell"),
    ("Easy to Learn", "Takes Years to Master"),
    ("Tough Group Project Partner", "Dream Group Project Partner"),
    ("Book You Can't Finish", "Book You Can't Put Down"),
    ("Useless Superpower", "Awesome Superpower"),
    ("Silly Superhero Name", "Mighty Superhero Name"),
    ("Friendly Monster", "Spooky Monster"),
    ("Not Magical", "Very Magical"),
    ("Real", "Make-Believe"),
    ("Useless Robot", "Helpful Robot"),
    ("Worst Treasure to Find", "Best Treasure to Find"),
    ("Boring Place to Explore", "Amazing Place to Explore"),
    ("Terrible Dragon Name", "Perfect Dragon Name"),
    ("Silly Wish", "Smart Wish"),
    ("Worst Sidekick", "Best Sidekick"),
    ("Old-Timey", "Futuristic"),
    ("Background Character", "Main Character"),
    ("Useless Invention", "World-Changing Invention"),
    ("Chore You Dread", "Chore You Don't Mind"),
    ("Itchy Clothes", "Comfy Clothes"),
    ("Annoying Sound", "Satisfying Sound"),
    ("Forgettable Gift", "Thoughtful Gift"),
    ("Morning Thing", "Nighttime Thing"),
    ("School Day Thing", "Weekend Thing"),
    ("Winter Thing", "Summer Thing"),
    ("Nice to Have", "Can't Live Without"),
    ("Costs Pennies", "Costs a Fortune"),
    ("Fits in Your Pocket", "Needs a Truck"),
    ("Worst Weather", "Best Weather"),
    ("Boring Bedtime Story", "Great Bedtime Story"),
    ("Worst Thing to Step On", "Best Thing to Step On"),
    ("Not Scary", "Very Scary"),
    ("Hard to Share", "Easy to Share"),
    ("Takes a Second", "Takes All Day"),
    ("Ordinary", "Fancy"),
    ("Easy to Lose", "Impossible to Lose"),
    ("Worst Place to Nap", "Best Place to Nap"),
    ("Bad Thing to Bring Camping", "Great Thing to Bring Camping"),
    ("Bad Thing to Bring to the Beach", "Great Thing to Bring to the Beach"),
    ("Easy Job", "Hard Job"),
    ("Boring Job", "Dream Job"),
    ("Makes You Grumpy", "Makes You Smile"),
    ("Not Funny", "Hilarious"),
    ("Embarrassing", "Makes You Proud"),
    ("Stressful", "Relaxing"),
    ("Small Act of Kindness", "Huge Act of Kindness"),
    ("Rude", "Polite"),
    ("Tough Teammate Habit", "Great Teammate Habit"),
    ("Takes a Little Courage", "Takes a Lot of Courage"),
    ("Joke That Flops", "Joke Everyone Laughs At"),
    ("Underrated", "Overrated"),
    ("Forgettable Song", "Song Stuck in Your Head"),
    ("Movie You'd Sleep Through", "Movie You'd Watch Again"),
    ("Out of Style", "Trendy"),
    ("Useless App", "Must-Have App"),
    ("Worst Team Name", "Best Team Name"),
    ("Worst Band Name", "Best Band Name"),
    ("Cringey", "Cool"),
    ("Hardly Anyone Knows It", "Everyone Knows It"),
    ("Skill Nobody Notices", "Skill That Wows Everyone"),
    ("Forgettable Mascot", "Lovable Mascot"),
)

SPICY_CARDS: tuple[CardPair, ...] = (
    ("Red Flag", "Green Flag"),
    ("Trashy", "Classy"),
    ("Guilty Pleasure", "Openly Proud"),
    ("Cult", "Religion"),
    ("Second Date Idea", "Anniversary Idea"),
    ("Text Breakup", "Marriage Material"),
    ("Bad Excuse to Leave Early", "Elite Excuse to Leave Early"),
    ("Secretly Judged", "Universally Admired"),
    ("Unpaid Intern Energy", "CEO Energy"),
    ("Mildly Illegal", "Felony Energy"),
    ("Overpriced Scam", "Worth Every Penny"),
    ("Worst First Date Spot", "Best First Date Spot"),
    ("Fake Apology", "Heartfelt Apology"),
    ("Roommate Nightmare", "Dream Roommate"),
    ("Drunk Text", "Love Letter"),
    ("Passive-Aggressive", "Aggressively Polite"),
    ("Socially Unacceptable", "Mandatory Etiquette"),
    ("Gossip", "Breaking News"),
    ("Mid", "Iconic"),
    ("Try-Hard", "Effortlessly Cool"),
    ("Conspiracy Theory", "Proven Fact"),
    ("Bad Tattoo Idea", "Masterpiece Tattoo"),
    ("Awkward Small Talk", "3 AM Deep Talk"),
    ("Humblebrag", "Pure Flex"),
    ("Redacted from the Group Chat", "Pinned in the Group Chat"),
    ("Delusional", "Visionary"),
    ("Toxic Trait", "Love Language"),
    ("Tourist Trap", "Hidden Gem"),
    ("Bad Financial Decision", "Genius Investment"),
    ("Chaos Gremlin", "Golden Retriever Energy"),
    ("Overstayed Welcome", "Irish Goodbye"),
    ("Unseasoned", "Flavor Bomb"),
    ("Pretentious", "Sophisticated"),
    ("Corporate Buzzword", "Real Human Speech"),
    ("Worst Hill to Die On", "Best Hill to Die On"),
    ("Zero Rizz", "Unspoken Rizz"),
    ("Cancelable Offense", "Harmless Quirk"),
    ("Chronically Online", "Touches Grass Daily"),
    ("Impulse Buy", "Heirloom Purchase"),
    ("Party Killer", "Life of the Party"),
)

POP_CARDS: tuple[CardPair, ...] = (
    ("Bad Villain", "Iconic Villain"),
    ("Filler Episode", "Peak Cinema"),
    ("NPC Behavior", "Main Character Energy"),
    ("Forgotten Meme", "Hall of Fame Meme"),
    ("One-Hit Wonder", "Timeless Legend"),
    ("Worst Sequel", "Sequel Better Than the Original"),
    ("Indie Darling", "Blockbuster Giant"),
    ("Skip Intro", "Never Skip Intro"),
    ("Tutorial Boss", "Final Boss"),
    ("Casual Game", "Sweaty Esports Game"),
    ("Sci-Fi", "Fantasy"),
    ("90s Nostalgia", "Gen-Z Brainrot"),
    ("Worst Karaoke Song", "Crowd-Pleaser Karaoke Song"),
    ("Overhyped Franchise", "Underrated Masterpiece"),
    ("Villain Was Wrong", "Villain Had a Point"),
    ("Plot Hole", "Genius Foreshadowing"),
    ("Cursed Image", "Blessed Image"),
    ("Podcast Bro Topic", "Documentary Worthy"),
    ("Worst Sitcom Character", "Best Sitcom Character"),
    ("Low-Budget Prop", "Practical Effects Wizardry"),
    ("Background Music", "Absolute Banger"),
    ("Cozy Sim Game", "Rage-Quit Game"),
    ("Comic Relief", "Tragic Hero"),
    ("Unwatchable Reboot", "Definitive Remake"),
    ("Worst Reality Show", "Addictive Reality Show"),
    ("Clickbait", "Must-Watch Video"),
    ("D-List Celebrity", "Living Legend"),
    ("Fandom Nobody Admits To", "Fandom Everyone Loves"),
    ("Spoiled Immediately", "Unforgettable Plot Twist"),
    ("Stock Sound Effect", "Iconic Movie Quote"),
    ("Worst Game Controller", "Peak Ergonomics"),
    ("AI Slop", "Human Masterpiece"),
    ("Guilty Binge-Watch", "Criterion Collection"),
    ("Easy Trivia Question", "Impossible Deep-Lore Trivia"),
    ("Side Quest", "Main Storyline"),
    ("Pay-to-Win", "Skill-Based"),
    ("Worst Anime Trope", "Best Anime Trope"),
    ("Dad Rock", "Hyperpop"),
    ("Obscure Indie Band", "Stadium Headliner"),
    ("Meme Format That Died Fast", "Immortal Meme Format"),
)

DEEP_CARDS: tuple[CardPair, ...] = (
    ("Chaotic Evil", "Lawful Good"),
    ("Dystopia", "Utopia"),
    ("Simulation Glitch", "Natural Law"),
    ("Feels Illegal", "Should Be Illegal"),
    ("Art", "Science"),
    ("Nature", "Nurture"),
    ("Temporary", "Eternal"),
    ("Fragile", "Indestructible"),
    ("Selfish Act", "Selfless Act"),
    ("Rational", "Emotional"),
    ("Predictable", "Pure Chaos"),
    ("Ancient Wisdom", "Modern Invention"),
    ("Harmless Lie", "Unforgivable Betrayal"),
    ("Freedom", "Security"),
    ("Talent", "Hard Work"),
    ("Means Nothing", "Means Everything"),
    ("Accidental Genius", "Calculated Masterplan"),
    ("Comfort Zone", "Leap of Faith"),
    ("Human Nature", "Learned Behavior"),
    ("Simple Truth", "Complicated Lie"),
    ("Microscopic", "Cosmic"),
    ("Solved Mystery", "Unexplained Phenomenon"),
    ("Mundane", "Transcendent"),
    ("Order", "Entropy"),
    ("Optimistic", "Cynical"),
    ("Necessary Evil", "Pure Good"),
    ("Sacred", "Profane"),
    ("Illusion", "Reality"),
    ("Forgotten History", "Living Memory"),
    ("Instinct", "Logic"),
    ("Solitude", "Community"),
    ("Finite", "Infinite"),
    ("Coincidence", "Destiny"),
    ("Literal", "Metaphorical"),
    ("Boring Utopia", "Exciting Dystopia"),
    ("Unwritten Rule", "Strict Law"),
    ("Question With No Answer", "Obvious Fact"),
    ("Fleeting Trend", "Human Constant"),
    ("Quiet Rebellion", "Loud Revolution"),
    ("Tame", "Untamed"),
)

DECKS: dict[str, dict[str, Any]] = {
    "core": {
        "id": "core",
        "name": "Classic Spectrum",
        "emoji": "🌊",
        "description": "135 all-ages spectrum pairs from mikeck1's Wavelength deck.",
        "cards": CORE_CARDS,
    },
    "spicy": {
        "id": "spicy",
        "name": "Hot Takes & Party",
        "emoji": "🔥",
        "description": "Red flags, social etiquette, chaos gremlins, and party debates.",
        "cards": SPICY_CARDS,
    },
    "pop": {
        "id": "pop",
        "name": "Pop Culture & Nerd",
        "emoji": "🎬",
        "description": "Movies, video games, music, internet lore, and iconic villains.",
        "cards": POP_CARDS,
    },
    "deep": {
        "id": "deep",
        "name": "Deep & Weird",
        "emoji": "🌌",
        "description": "Philosophical alignments, cosmic scales, and existential prompts.",
        "cards": DEEP_CARDS,
    },
}

DEFAULT_PACKS: tuple[str, ...] = ("core", "spicy", "pop")


def deck_catalog() -> list[dict[str, Any]]:
    """Metadata for every built-in deck pack."""
    return [
        {
            "id": d["id"],
            "name": d["name"],
            "emoji": d["emoji"],
            "description": d["description"],
            "count": len(d["cards"]),
        }
        for d in DECKS.values()
    ]


def clean_card_text(value: object) -> str:
    """Normalizes whitespace and strips control characters."""
    if not isinstance(value, str):
        return ""
    cleaned = re.sub(r"[\x00-\x1f\x7f]+", " ", value)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:MAX_CARD_LEN]


def card_key(left: str, right: str) -> str:
    return f"{clean_card_text(left).lower()}|{clean_card_text(right).lower()}"


def _split_csv(line: str) -> list[str]:
    out: list[str] = []
    cur: list[str] = []
    quoted = False
    i = 0
    while i < len(line):
        ch = line[i]
        if quoted:
            if ch == '"' and i + 1 < len(line) and line[i + 1] == '"':
                cur.append('"')
                i += 1
            elif ch == '"':
                quoted = False
            else:
                cur.append(ch)
        elif ch == '"':
            quoted = True
        elif ch == ",":
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
        i += 1
    out.append("".join(cur))
    return out


def split_card_line(line: str) -> CardPair | None:
    """Splits 'Left | Right', 'Left ↔ Right', CSV, or 'Left - Right' lines."""
    for sep in ("|", "\t", "↔", "<->", "<>"):
        if sep in line:
            parts = line.split(sep)
            if len(parts) == 2:
                return (clean_card_text(parts[0]), clean_card_text(parts[1]))
            return None
    csv_parts = _split_csv(line)
    if len(csv_parts) == 2:
        return (clean_card_text(csv_parts[0]), clean_card_text(csv_parts[1]))
    for sep in (" - ", " – ", " — "):
        if sep in line:
            parts = line.split(sep)
            if len(parts) == 2:
                return (clean_card_text(parts[0]), clean_card_text(parts[1]))
            return None
    return None


def _to_pair(item: object) -> CardPair | None:
    if isinstance(item, (list, tuple)) and len(item) >= 2:
        l, r = clean_card_text(item[0]), clean_card_text(item[1])
        return (l, r) if l and r else None
    if isinstance(item, dict):
        raw_l = item.get("left") or item.get("l") or item.get("min")
        raw_r = item.get("right") or item.get("r") or item.get("max")
        l, r = clean_card_text(raw_l), clean_card_text(raw_r)
        return (l, r) if l and r else None
    if isinstance(item, str):
        pair = split_card_line(item)
        if pair and pair[0] and pair[1]:
            return pair
    return None


def normalize_custom_cards(raw: object) -> list[CardPair]:
    """Validates and deduplicates a list of custom cards or raw text from the client."""
    items: list[object] = []
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return []
        if text.startswith("[") or text.startswith("{"):
            try:
                parsed = json.loads(text)
                if isinstance(parsed, list):
                    items = parsed
                elif isinstance(parsed, dict):
                    cand = parsed.get("cards") or parsed.get("deck") or parsed.get("clues") or []
                    if isinstance(cand, list):
                        items = cand
            except ValueError:
                pass
        if not items:
            lines = [
                ln.strip()
                for ln in text.splitlines()
                if ln.strip() and not ln.strip().startswith("#") and not ln.strip().startswith("//")
            ]
            if lines and re.match(r'^"?left"?\s*[,|\t]\s*"?right"?$', lines[0], re.IGNORECASE):
                lines = lines[1:]
            items = lines
    elif isinstance(raw, (list, tuple)):
        items = list(raw)
    else:
        return []

    out: list[CardPair] = []
    seen: set[str] = set()
    for item in items:
        if len(out) >= MAX_CUSTOM_CARDS:
            break
        pair = _to_pair(item)
        if not pair:
            continue
        key = card_key(pair[0], pair[1])
        if key in seen:
            continue
        seen.add(key)
        out.append(pair)
    return out


def build_card_pool(packs: list[str] | tuple[str, ...], custom_cards: list[CardPair]) -> list[CardPair]:
    """Builds the deduplicated list of spectrum cards for a room's active packs + custom cards."""
    pool: list[CardPair] = []
    seen: set[str] = set()
    for left, right in custom_cards:
        key = card_key(left, right)
        if key not in seen:
            seen.add(key)
            pool.append((left, right))
    for pack_id in packs:
        pack = DECKS.get(pack_id)
        if not pack:
            continue
        for left, right in pack["cards"]:
            key = card_key(left, right)
            if key not in seen:
                seen.add(key)
                pool.append((left, right))
    return pool
