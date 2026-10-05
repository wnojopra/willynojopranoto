// Wire protocol shared with backend/app/rooms.py and backend/app/main.py.

export type Phase = 'lobby' | 'medium' | 'question' | 'pull' | 'reveal' | 'results';
export type RoundKind = 'bets' | 'medium' | 'final';
export type GameLength = 'short' | 'standard' | 'long';

export interface Player {
  id: string;
  name: string;
  color: string;
  isBot: boolean;
  connected: boolean;
  score: number;
  haunted: number;
  /** Whether they've placed a bet; only set during the question phase. */
  hasBet: boolean | null;
}

export interface Spot {
  id: string;
  label: string;
  x: number;
  y: number;
}

export interface PlanchetteState {
  x: number;
  y: number;
  fx: number;
  fy: number;
  hoverSpot: string | null;
  lockProgress: number;
  timeLeft: number | null;
}

/** Everyone's bets, published only once the board has spoken. */
export interface Reveal {
  bets: Record<string, string>;
  autoBets: string[];
  payout: Record<string, number>;
  rolledOver: boolean;
  // Medium rounds only.
  mediumAnswer?: string;
  mediumAuto?: boolean;
  correct?: string[];
  boardMatched?: boolean;
}

export interface GameInfo {
  length: GameLength;
  lengths: Record<GameLength, number>;
  active: boolean;
  round: number;
  totalRounds: number;
  roundKind: RoundKind | null;
  isLastRound: boolean;
  cursesOn: boolean;
}

/** A curse card the board dealt. In force until the next reveal. */
export interface Curse {
  playerId: string;
  /** The round it was dealt in (it's "new" while roundNo matches). */
  roundNo: number;
  text: string;
  drink: boolean;
  /** Non-drinking option; always present on 🍺 cards. */
  alt: string | null;
}

export interface Award {
  key: string;
  emoji: string;
  title: string;
  blurb: string;
  playerIds: string[];
  value: number;
}

export interface StateMsg {
  type: 'state';
  code: string;
  phase: Phase;
  roundNo: number;
  players: Player[];
  question: { kind: 'who' | 'yesno' | 'pick'; text: string } | null;
  spots: Spot[];
  phaseEndsIn: number | null;
  resultSpotId: string | null;
  pot: number;
  /** How much of the pot is rollover from earlier rounds. */
  potBonus: number;
  carryover: number;
  reveal: Reveal | null;
  game: GameInfo;
  medium: { playerId: string; answered: boolean } | null;
  curse: Curse | null;
  awards: Award[] | null;
  finalCurse: { playerIds: string[]; text: string } | null;
  canStart: boolean;
  minPlayers: number;
  maxPlayers: number;
  board: { w: number; h: number };
  planchette: PlanchetteState;
}

export interface TickMsg extends PlanchetteState {
  type: 'tick';
}

export interface PrivatePick {
  spotId: string;
  roundNo: number;
  auto: boolean;
}

export type ServerMsg =
  | StateMsg
  | TickMsg
  | { type: 'created'; code: string }
  | { type: 'joined'; playerId: string; code: string }
  | ({ type: 'bet_ok' } & PrivatePick)
  | ({ type: 'answer_ok' } & PrivatePick)
  | { type: 'error'; message: string };
