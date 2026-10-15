"""The two trait decks.

PlayMonster's physical game has 125 "Logical" and 125 "Psycho" cards, but the
full card text was never published, so these lists are our own. A few words that
are known to be in the real game are included (Funny, Competitive, Power-Hungry).

X_DECK (white cards, X axis): grounded, everyday traits.
Y_DECK (rainbow cards, Y axis): punchier, quirkier traits.
No word appears in both decks.
"""

from __future__ import annotations

X_DECK: tuple[str, ...] = (
    "Adventurous", "Ambitious", "Analytical", "Artistic", "Athletic",
    "Calm", "Careful", "Caring", "Cautious", "Charming",
    "Cheerful", "Clean", "Clever", "Confident", "Considerate",
    "Cooperative", "Courageous", "Creative", "Curious", "Decisive",
    "Dependable", "Determined", "Diplomatic", "Disciplined", "Easygoing",
    "Efficient", "Empathetic", "Energetic", "Fair", "Flexible",
    "Focused", "Forgiving", "Friendly", "Frugal", "Funny",
    "Generous", "Gentle", "Genuine", "Grateful", "Hardworking",
    "Healthy", "Helpful", "Honest", "Hopeful", "Humble",
    "Imaginative", "Independent", "Inquisitive", "Intelligent", "Kind",
    "Laid-back", "Logical", "Loyal", "Mature", "Methodical",
    "Modest", "Motivated", "Musical", "Neat", "Nurturing",
    "Observant", "Open-minded", "Optimistic", "Organized", "Outdoorsy",
    "Outgoing", "Passionate", "Patient", "Peaceful", "Persistent",
    "Playful", "Polite", "Practical", "Precise", "Prepared",
    "Productive", "Protective", "Punctual", "Rational", "Realistic",
    "Reasonable", "Relaxed", "Reliable", "Resilient", "Resourceful",
    "Respectful", "Responsible", "Romantic", "Self-aware", "Sensible",
    "Sentimental", "Serious", "Sincere", "Smart", "Sociable",
    "Sophisticated", "Spiritual", "Spontaneous", "Sporty", "Steady",
    "Stoic", "Strong", "Studious", "Supportive", "Sweet",
    "Tactful", "Talented", "Thoughtful", "Thrifty", "Tidy",
    "Tolerant", "Trusting", "Trustworthy", "Understanding", "Unselfish",
    "Upbeat", "Warm", "Well-read", "Wise", "Witty",
    "Worldly", "Cultured", "Handy", "Brave", "Techy",
)

Y_DECK: tuple[str, ...] = (
    "Absent-minded", "Aggressive", "Anxious", "Argumentative", "Arrogant",
    "Awkward", "Bossy", "Chaotic", "Cheap", "Childish",
    "Clingy", "Clumsy", "Cocky", "Competitive", "Complicated",
    "Controlling", "Cranky", "Crazy", "Cynical", "Daredevil",
    "Dramatic", "Dreamy", "Eccentric", "Edgy", "Emotional",
    "Extra", "Extravagant", "Fearless", "Feisty", "Fickle",
    "Fiery", "Flaky", "Flirty", "Forgetful", "Fussy",
    "Geeky", "Gossipy", "Goofy", "Greedy", "Grumpy",
    "Gullible", "Hangry", "Headstrong", "Hyper", "Impatient",
    "Impulsive", "Indecisive", "Intense", "Jealous", "Judgmental",
    "Klutzy", "Lazy", "Loud", "Manipulative", "Materialistic",
    "Messy", "Mischievous", "Moody", "Mysterious", "Naive",
    "Nerdy", "Nervous", "Nosy", "Obsessive", "Overconfident",
    "Overthinking", "Paranoid", "Party animal", "Perfectionist", "Picky",
    "Power-Hungry", "Pretentious", "Quirky", "Rebellious", "Reckless",
    "Restless", "Rowdy", "Rude", "Ruthless", "Sarcastic",
    "Sassy", "Savage", "Scatterbrained", "Secretive", "Selfish",
    "Shady", "Shy", "Sneaky", "Snobby", "Spoiled",
    "Squeamish", "Stubborn", "Superstitious", "Suspicious", "Talkative",
    "Temperamental", "Theatrical", "Thrill-seeking", "Touchy", "Unpredictable",
    "Vain", "Vengeful", "Weird", "Wild", "Workaholic",
    "Bougie", "Cheesy", "Dorky", "Drama queen", "Night owl",
    "Know-it-all", "Couch potato", "Hopeless romantic", "Adrenaline junkie", "Sore loser",
    "Neurotic", "Petty", "Smug", "Stingy", "Tardy",
    "Wishy-washy", "Zany", "Gloomy", "Opinionated", "Prankster",
)


# ---- Expansion packs ---------------------------------------------------------
# Picked per axis in the lobby (any pack on either axis). The defaults are the
# core decks above. Words are unique across every deck, so a turn never shows
# the same card twice.

INTERNET_FOOD: tuple[str, ...] = (
    # Internet brain
    "Main character energy", "NPC energy", "Golden retriever energy", "Black cat energy", "Villain arc",
    "Chronically online", "Delulu", "Unbothered", "Chaotic good", "Rizz",
    "Doomscroller", "Lurker", "Reply guy", "Oversharer", "Group chat menace",
    "Meme lord", "Screenshotter", "Leaves people on read", "Needs to touch grass", "Hot take machine",
    "Plot armor", "Side quest enjoyer", "Gatekeeper", "Aesthetic", "Cringe",
    "Feral", "Soft launcher", "Emoji overuser", "Voice memo sender", "Iconic",
    # Foodie
    "Picky eater", "Spice tolerance", "Snack goblin", "Adventurous eater", "Five-second rule",
    "Brunch person", "Food photographer", "Leftover hoarder", "Midnight snacker", "Coffee dependent",
    "Sauce boss", "Ketchup on everything", "Pineapple on pizza", "Cereal for dinner", "Buffet strategist",
    "Food critic", "Sweet tooth", "Salt fiend", "Fast eater", "Plate cleaner",
    "Microwave chef", "Takeout loyalist", "Drive-thru regular", "Food sharer", "Bite stealer",
    "Bread lover", "Fancy restaurant ready", "Orders the same thing", "Hot sauce collector", "Eats dessert first",
)

DARK: tuple[str, ...] = (
    # Haunted
    "Dies first in a horror movie", "Believes in ghosts", "Scared of the dark", "Reads the cursed book", "Investigates the noise",
    "Splits up the group", "Final girl", "Secretly the killer", "Easily possessed", "Ouija curious",
    "Jump-scare proof", "Sleeps with the lights on", "Cemetery stroller", "Tarot reader", "Witchy",
    "Vampire vibes", "Werewolf energy", "Ghost whisperer", "Creepy doll owner", "Horror movie screamer",
    "Ignores the warning", "Summons something", "Basement explorer", "Séance host", "Cursed object collector",
    "Stays in the haunted house", "Talks to mirrors", "Says “Who’s there?”", "Moves into the creepy house", "Hears whispers",
    # Apocalypse
    "Survives the zombies", "Hoards supplies", "Useful in a crisis", "Trusts the stranger", "Makes fire",
    "Bunker builder", "Hides the bite", "Natural leader", "Loot goblin", "Map reader",
    "Bow and arrow ready", "Grows own food", "Rations snacks", "Purifies water", "Getaway driver",
    "Heroic sacrifice", "Betrays the group", "Radio operator", "Fort builder", "Wilderness ready",
    "Calm in chaos", "Panics first", "Last one standing", "Zombie whisperer", "Doomsday prepper",
    "Raider material", "Scavenger", "First aid hero", "Takes the night watch", "Cult leader potential",
)

LIFE_SKILLS: tuple[str, ...] = (
    "Can parallel park", "Cooks without a recipe", "Keeps plants alive", "Good with kids", "Assembles IKEA alone",
    "Changes a tire", "Does own taxes", "Folds a fitted sheet", "Unclogs a toilet", "Sews a button",
    "Packs a suitcase well", "Reads a paper map", "Remembers birthdays", "Wakes up on time", "Sticks to a budget",
    "Negotiates a deal", "Fixes a leak", "Hangs a shelf level", "Wraps presents neatly", "Gives good directions",
    "Calls instead of texting", "Jump-starts a car", "Grills a steak", "Bakes from scratch", "Irons a shirt",
    "Does laundry right", "Kills the spider", "Makes small talk", "Gives a great toast", "Haggles at markets",
    "Plays trunk Tetris", "Navigates without GPS", "Speaks another language", "Keeps a secret", "Remembers names",
    "Writes in cursive", "Ties a tie", "Swims well", "Rides a bike no-handed", "Whistles loudly",
    "Uses chopsticks", "Opens any jar", "Pitches a tent", "Plans a trip", "Fixes the Wi-Fi",
    "Cleans as they go", "Meal preps", "Changes a diaper", "Survives hold music", "Returns things on time",
    "Cuts own hair", "Paints a wall", "Finds a deal", "Catches a ball", "Dances in public",
    "Sings on key", "Remembers where they parked", "Splits the bill fairly", "Replies to emails", "Calms a crying baby",
)

# id -> (name, emoji, words). Order is the lobby picker's order.
DECKS: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "logical": ("Logical (core)", "🧠", X_DECK),
    "psycho": ("Psycho (core)", "🌈", Y_DECK),
    "internet_food": ("Internet Brain + Foodie", "🍕", INTERNET_FOOD),
    "dark": ("Haunted + Apocalypse", "🧟", DARK),
    "life_skills": ("Life Skills", "🛠", LIFE_SKILLS),
}
DEFAULT_DECK_X = "logical"
DEFAULT_DECK_Y = "psycho"
