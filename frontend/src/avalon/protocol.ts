/** Messages and types for The Resistance: Avalon (`/ws/avalon/*`). */

export type AvaPhase =
  | 'lobby'
  | 'night'
  | 'team_building'
  | 'team_vote'
  | 'team_reveal'
  | 'quest'
  | 'quest_reveal'
  | 'assassinate'
  | 'gameover';

export type Alignment = 'good' | 'evil';

export type RoleId =
  | 'merlin'
  | 'percival'
  | 'servant'
  | 'assassin'
  | 'morgana'
  | 'mordred'
  | 'oberon'
  | 'minion';

export type OptionalRoleId = 'percival' | 'mordred' | 'morgana' | 'oberon';

export interface AvaPlayer {
  id: string;
  name: string;
  color: string;
  isBot: boolean;
  connected: boolean;
}

export interface QuestSpec {
  quest: number;
  teamSize: number;
  failsRequired: number;
}

export interface VoteReveal {
  round: number;
  proposal: number;
  leaderId: string | null;
  teamIds: string[];
  votes: Record<string, boolean>;
  approves: number;
  rejects: number;
  approved: boolean;
}

export interface QuestResult {
  quest: number;
  leaderId: string | null;
  teamIds: string[];
  cards: ('success' | 'fail')[];
  successCount: number;
  failCount: number;
  failsRequired: number;
  succeeded: boolean;
}

export type HistoryEntry =
  | ({ kind: 'vote' } & VoteReveal)
  | ({ kind: 'quest' } & QuestResult);

export interface NightStep {
  id: string;
  Cue: string;
  text: string;
  pauseAfterMs: number;
}

export interface RevealedRole {
  role: RoleId;
  name: string;
  alignment: Alignment;
  title: string;
}

export interface AvaState {
  type: 'state';
  code: string;
  phase: AvaPhase;
  players: AvaPlayer[];
  leaderId: string | null;
  round: number;
  proposal: number;
  rejectedCount: number;
  questSize: number;
  alignmentCount: { good: number; evil: number };
  optionalRoles: OptionalRoleId[];
  activeOptionalRoles: OptionalRoleId[];
  nightScript: NightStep[];
  nightReadyIds: string[];
  questSpecs: QuestSpec[];
  questResults: (QuestResult | null)[];
  draftTeam: string[];
  proposedTeam: string[];
  votedIds: string[];
  questSubmittedIds: string[];
  lastVoteReveal: VoteReveal | null;
  lastQuestReveal: QuestResult | null;
  history: HistoryEntry[];
  assassinId: string | null;
  evilDiscussIds: string[];
  assassinTargetId: string | null;
  winner: Alignment | null;
  winReason: string | null;
  revealedRoles: Record<string, RevealedRole> | null;
  canStart: boolean;
  minPlayers: number;
  maxPlayers: number;
}

export interface RoleSecretMsg {
  type: 'role_secret';
  role: RoleId;
  name: string;
  alignment: Alignment;
  title: string;
  power: string;
  seenIds: string[];
  seenLabel: string;
  seenNote: string;
  myVote: boolean | null | undefined;
  myQuestCard: boolean | null | undefined;
}

export type AvaServerMsg =
  | AvaState
  | RoleSecretMsg
  | { type: 'created'; code: string }
  | { type: 'joined'; playerId: string; code: string }
  | { type: 'action_rejected'; reason: string }
  | { type: 'selfie_rejected' }
  | { type: 'avatars'; avatars: Record<string, string> }
  | { type: 'error'; message: string };

export type Photos = Record<string, string>;

export interface CharacterCardCatalogItem {
  id: RoleId;
  name: string;
  alignment: Alignment;
  summary: string;
  locked?: boolean;
}

export const CHARACTER_CARD_CATALOG: CharacterCardCatalogItem[] = [
  {
    id: 'merlin',
    name: 'Merlin',
    alignment: 'good',
    summary: 'Knows who the Minions of Mordred are (except Mordred).',
    locked: true,
  },
  {
    id: 'percival',
    name: 'Percival',
    alignment: 'good',
    summary: 'Knows who Merlin is at the start (helps protect Merlin’s identity).',
  },
  {
    id: 'mordred',
    name: 'Mordred',
    alignment: 'evil',
    summary: 'His identity is hidden from Merlin during the Night reveal.',
    locked: true,
  },
  {
    id: 'morgana',
    name: 'Morgana',
    alignment: 'evil',
    summary: 'Appears as Merlin to Percival during the Night reveal.',
  },
  {
    id: 'oberon',
    name: 'Oberon',
    alignment: 'evil',
    summary: 'Does not reveal himself to other Evil players, nor see who they are.',
  },
];

export interface OptionalRoleCatalogItem {
  id: OptionalRoleId;
  name: string;
  alignment: Alignment;
  summary: string;
}

export const OPTIONAL_ROLE_CATALOG: OptionalRoleCatalogItem[] = [
  {
    id: 'percival',
    name: 'Percival',
    alignment: 'good',
    summary: 'Knows who Merlin is at the start (helps protect Merlin’s identity).',
  },
  {
    id: 'morgana',
    name: 'Morgana',
    alignment: 'evil',
    summary: 'Appears as Merlin to Percival during the Night reveal.',
  },
  {
    id: 'mordred',
    name: 'Mordred',
    alignment: 'evil',
    summary: 'His identity is hidden from Merlin during the Night reveal.',
  },
  {
    id: 'oberon',
    name: 'Oberon',
    alignment: 'evil',
    summary: 'Does not reveal himself to other Evil players, nor see who they are.',
  },
];
