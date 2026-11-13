/** Messages and helpers for Wavelength (`/ws/wavelength/*`). */

export type WlPhase = 'lobby' | 'psychic' | 'guessing' | 'bonus' | 'reveal' | 'gameover';
export type WlMode = 'teams' | 'ffa' | 'coop';
export type WlBonusDir = 'left' | 'right';

export interface WlPlayer {
  id: string;
  name: string;
  color: string;
  teamId: string;
  isBot: boolean;
  connected: boolean;
  score: number;
}

export interface WlTeam {
  id: string;
  name: string;
  color: string;
  score: number;
}

export interface WlDeckInfo {
  id: string;
  name: string;
  emoji: string;
  description: string;
  count: number;
}

export interface WlSettings {
  /** [bullseyePts, closePts, nearPts] — always [4, 3, 2] */
  bands: [number, number, number];
  leftRightBonus: boolean;
  catchupRule: boolean;
  targetScore: number;
  packs: string[];
  customCount: number;
  deckSize: number;
}

export interface WlCoopRating {
  tier: string;
  emoji: string;
  verdict: string;
}

export interface WlCoopInfo {
  score: number;
  cardsRemaining: number;
  bonusCards: number;
  rating: WlCoopRating | null;
}

export interface WlReveal {
  target: number;
  needle?: number;
  points?: number;
  bullseye: boolean;
  teamId?: string;
  bonusVotes?: Record<string, WlBonusDir>;
  bonusPoints?: Record<string, number>;
  extraTurn?: boolean;
  guesses?: Record<string, number>;
  playerPoints?: Record<string, number>;
  psychicId?: string | null;
  psychicPoints?: number;
  bonusCard?: boolean;
}

export interface WlState {
  type: 'state';
  code: string;
  phase: WlPhase;
  mode: WlMode;
  round: number;
  players: WlPlayer[];
  teams: WlTeam[];
  activeTeamId: string | null;
  psychicId: string | null;
  card: [string, string] | null;
  clue: string;
  clueSpoken: boolean;
  needle: number;
  lockedBy: string | null;
  ffaLockedIds: string[];
  bonusVotes: Record<string, WlBonusDir>;
  settings: WlSettings;
  decks: WlDeckInfo[];
  coop: WlCoopInfo;
  reveal: WlReveal | null;
  winners: string[];
  canStart: boolean;
  minPlayers: number;
}

export type WlServerMsg =
  | WlState
  | { type: 'created'; code: string }
  | { type: 'joined'; playerId: string; code: string }
  | { type: 'psychic_secret'; round: number; target: number }
  | { type: 'action_rejected'; reason: string }
  | { type: 'selfie_rejected' }
  | { type: 'avatars'; avatars: Record<string, string> }
  | { type: 'error'; message: string };

export type Photos = Record<string, string>;

// Two-tone physical board game spectrum card colors (like the yellow/blush-pink "Dictatorship | Democracy" card in the photo)
export const CARD_COLORS: readonly [string, string][] = [
  ['#f7d047', '#f7b2c4'], // sunny yellow & blush pink (from the photo)
  ['#8ce0a8', '#f58b60'], // mint green & tangerine coral
  ['#80c8f8', '#f7c268'], // sky blue & warm amber
  ['#f7a399', '#95d5b2'], // coral salmon & sage mint
  ['#c8b6ff', '#ffd166'], // soft lavender & marigold
  ['#90e0ef', '#f4a261'], // powder cyan & sandy orange
  ['#ffcad4', '#a8dadc'], // pastel rose & seafoam blue
  ['#fde282', '#9bf6ff'], // buttercream & ice blue
];

export const BRAND_COLORS: [string, string] = ['#f26430', '#68b5e8'];

function hashStr(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function cardColors(card: [string, string] | null): [string, string] {
  if (!card) return BRAND_COLORS;
  const key = `${card[0].toLowerCase()}|${card[1].toLowerCase()}`;
  return CARD_COLORS[hashStr(key) % CARD_COLORS.length];
}

export function scoreBannerText(pts: number, bullseye: boolean): string {
  if (bullseye) return 'Bullseye!';
  if (pts >= 3) return 'So close!';
  if (pts >= 2) return 'On the target!';
  return 'Missed it!';
}
