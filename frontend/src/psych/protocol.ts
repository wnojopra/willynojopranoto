/** Messages for Psychological (`/ws/psych/*`). Separate from Spirit Board's protocol. */

export type Phase = 'lobby' | 'secret' | 'guessing' | 'reveal' | 'gameover';

export interface PsyPlayer {
  id: string;
  name: string;
  color: string;
  isBot: boolean;
  connected: boolean;
  score: number;
}

export interface DeckInfo {
  id: string;
  name: string;
  emoji: string;
  count: number;
}

export interface Guess {
  playerId: string;
  x: number;
  y: number;
}

export interface PsyState {
  type: 'state';
  code: string;
  phase: Phase;
  target: number;
  turn: number;
  /** In seating (turn) order. */
  players: PsyPlayer[];
  mainId: string | null;
  currentId: string | null;
  order: string[];
  queue: string[];
  traits: { x: string; y: string } | null;
  secretMarked: boolean;
  guesses: Guess[];
  /** Second markers (the guesser's real opinion), when that variant is on. */
  opinions: Guess[];
  settings: { opinions: boolean; opinionPoints: boolean; deckX: string; deckY: string };
  /** Every deck the lobby picker can choose from. */
  decks: DeckInfo[];
  reveal: { x: number; y: number; points: Record<string, number>; opinionPoints: Record<string, number> } | null;
  winners: string[];
  canStart: boolean;
  minPlayers: number;
}

export type PsyServerMsg =
  | PsyState
  | { type: 'created'; code: string }
  | { type: 'joined'; playerId: string; code: string }
  | { type: 'secret'; turn: number; x: number; y: number }
  | { type: 'mark_rejected' }
  | { type: 'unmark_rejected' }
  | { type: 'selfie_rejected' }
  | { type: 'avatars'; avatars: Record<string, string> }
  | { type: 'error'; message: string };

export const GRID = 10;

/** Pale pawn colours (white) need a dark outline to show on the white board. */
export function isPale(color: string): boolean {
  return color.toLowerCase() === '#f4f4f4' || color.toLowerCase() === '#f5c518';
}

/** Selfies by player id (validated small JPEG data URLs from the server). */
export type Photos = Record<string, string>;
