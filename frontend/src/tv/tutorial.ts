/**
 * Teaching the game: the lobby's "How to play" cards and the practice round's
 * step-by-step captions. Shared by the TV screens and the narrator.
 */

export interface HowToCard {
  icon: string;
  title: string;
  body: string;
}

export const HOW_TO_CARDS: HowToCard[] = [
  {
    icon: '👻',
    title: 'One planchette. Everyone’s hands.',
    body: 'Every phone pulls the same planchette on this screen. Drag on your phone to pull. The board goes where the whole group pulls.',
  },
  {
    icon: '🍬',
    title: 'Bet in secret',
    body: 'Each round asks a question. Before the board moves, secretly bet on your phone where you think it will land. Nobody sees your bet.',
  },
  {
    icon: '🤝',
    title: 'Pull, bluff, betray',
    body: 'Then everyone pulls at once. Drag toward your bet, or pretend you don’t care. Everyone who bet on the spot it lands on splits the candy pot.',
  },
  {
    icon: '🧿',
    title: 'Relics and curses',
    body: 'Relics on your phone let you cheat: freeze a rival, salt a spot, flip someone’s pull. If the board lands on your name, you’re Haunted, and the spirits may curse you.',
  },
];

export const PRACTICE_STEPS = {
  question: {
    title: 'Practice · Step 1 of 3: bet in secret',
    body: 'Look at your phone and tap where you think the board will land. Nobody else can see your bet.',
  },
  pull: {
    title: 'Practice · Step 2 of 3: pull together',
    body: 'Drag on your phone. You’re all moving one planchette, so pull toward your bet. It locks in when it rests on a spot.',
  },
  reveal: {
    title: 'Practice · Step 3 of 3: the payout',
    body: 'Everyone who bet on that spot splits the pot. That was practice, so nothing counted. In the real game, Relics wake up too.',
  },
} as const;

export function practiceStep(phase: string) {
  return phase === 'question' || phase === 'pull' || phase === 'reveal' ? PRACTICE_STEPS[phase] : null;
}
