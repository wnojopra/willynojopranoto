// Wire protocol shared with backend/app/rooms.py and backend/app/main.py.

export type Phase = 'lobby' | 'question' | 'pull' | 'reveal';

export interface Player {
  id: string;
  name: string;
  color: string;
  isBot: boolean;
  connected: boolean;
  score: number;
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
}

export interface StateMsg {
  type: 'state';
  code: string;
  phase: Phase;
  roundNo: number;
  players: Player[];
  question: { kind: 'who' | 'yesno'; text: string } | null;
  spots: Spot[];
  phaseEndsIn: number | null;
  resultSpotId: string | null;
  pot: number;
  /** How much of the pot is rollover from earlier rounds. */
  potBonus: number;
  carryover: number;
  reveal: Reveal | null;
  canStart: boolean;
  minPlayers: number;
  maxPlayers: number;
  board: { w: number; h: number };
  planchette: PlanchetteState;
}

export interface TickMsg extends PlanchetteState {
  type: 'tick';
}

export type ServerMsg =
  | StateMsg
  | TickMsg
  | { type: 'created'; code: string }
  | { type: 'joined'; playerId: string; code: string }
  | { type: 'bet_ok'; spotId: string; roundNo: number; auto: boolean }
  | { type: 'error'; message: string };
