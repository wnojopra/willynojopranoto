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
