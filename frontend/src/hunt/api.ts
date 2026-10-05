import type { RelicInfo, RelicKey } from '../protocol';

/** Scavenger-hunt HTTP API. Auth is cookie-based (HttpOnly device + admin cookies); nothing goes in localStorage. */

export type Tier = 'common' | 'rare' | 'cursed' | 'any';
export type ClaimStatus = 'claimed' | 'yours' | 'taken' | 'invalid' | 'need_name' | 'full' | 'unclaimed';

export interface ClaimResult {
  status: ClaimStatus;
  relic: RelicKey | null;
}

export interface Me {
  name: string | null;
  relics: RelicKey[];
}

export interface AdminCode {
  token: string;
  label: string;
  relic: RelicKey | null;
  tier: Tier | null;
  createdAt: number;
  claimed: boolean;
  claimedName: string | null;
  claimedRelic: RelicKey | null;
  claimedAt: number | null;
}

export type Catalog = Record<RelicKey, RelicInfo>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function csrfToken(): string {
  for (const part of document.cookie.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === '__Host-sb_csrf') return v.join('=');
  }
  return '';
}

async function parse<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let message = res.status === 429 ? 'Slow down a little and try again.' : 'The spirits are confused. Try again.';
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') message = body.detail;
  } catch {
    /* keep the generic message */
  }
  throw new ApiError(res.status, message);
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  return parse<T>(res);
}

export async function postJson<T>(path: string, body: unknown = {}): Promise<T> {
  await ensureSession();
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrfToken() },
    body: JSON.stringify(body),
  });
  return parse<T>(res);
}

/** Pages served by the backend already set the device + CSRF cookies; this covers the Vite dev server. */
export async function ensureSession(): Promise<void> {
  if (csrfToken()) return;
  await fetch('/api/session', { credentials: 'same-origin' });
}

let catalogPromise: Promise<Catalog> | null = null;
export function getCatalog(): Promise<Catalog> {
  catalogPromise ??= getJson<{ relics: Catalog }>('/api/catalog').then((r) => r.relics);
  catalogPromise.catch(() => (catalogPromise = null));
  return catalogPromise;
}

export async function getMe(): Promise<Me> {
  await ensureSession();
  return getJson<Me>('/api/me');
}

export const TIER_EMOJI: Record<Tier, string> = { common: '🕯️', rare: '🔮', cursed: '💀', any: '✨' };
