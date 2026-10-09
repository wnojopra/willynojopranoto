import type { StateMsg } from '../protocol';

/** "Kevin, Priya & Dave"; past `max` names it says "& 3 others". */
export function names(list: string[], { max = 5, and = '&' }: { max?: number; and?: string } = {}): string {
  if (list.length <= 1) return list.join('');
  if (list.length > max) {
    const shown = list.slice(0, max - 1);
    return `${shown.join(', ')} ${and} ${list.length - shown.length} others`;
  }
  return `${list.slice(0, -1).join(', ')} ${and} ${list[list.length - 1]}`;
}

/**
 * The reveal's gossip, design doc §3: "4 of you bet Kevin. Kevin bet Dave."
 *
 * The payout line already names the winners, so this tells on everyone else:
 * where the person the board chose had put their own candy, who bet on
 * themselves and lost, and the biggest bloc that lost. Bets the spirits placed
 * for stragglers don't count as gossip (the auto-bet tease covers those).
 *
 * Null for Medium rounds (guesses aren't bets), practice, or when there's no
 * story to tell. Pass `and: 'and'` for the narrator.
 */
export function betrayalLine(state: StateMsg, opts: { and?: string } = {}): string | null {
  const reveal = state.reveal;
  const result = state.resultSpotId;
  const kind = state.game.roundKind;
  if (!reveal || !result || kind === 'medium' || kind === 'practice') return null;

  const list = (people: string[]) => names(people, opts);
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const label = (spotId: string) => byId.get(spotId)?.name ?? state.spots.find((s) => s.id === spotId)?.label ?? '?';
  const chose = (id: string) => !reveal.autoBets.includes(id);
  const told = new Set<string>();
  const out: string[] = [];

  // On "who" boards the result is a player: where was their own money?
  const chosen = byId.get(result);
  const chosenBet = chosen && chose(chosen.id) ? reveal.bets[chosen.id] : undefined;
  if (chosen && chosenBet) {
    told.add(chosen.id);
    out.push(chosenBet === chosen.id ? `${chosen.name} bet on themselves. Committed.` : `${chosen.name} bet on ${label(chosenBet)}.`);
  }

  // Self-bets that didn't pay off.
  const vain = state.players.filter((p) => !told.has(p.id) && p.id !== result && chose(p.id) && reveal.bets[p.id] === p.id);
  if (vain.length) {
    for (const p of vain) told.add(p.id);
    out.push(`${list(vain.map((p) => p.name))} bet on themselves.`);
  }

  // The biggest bloc that lost (or whoever sided with the chosen one's bet).
  const blocs = new Map<string, string[]>();
  for (const p of state.players) {
    const bet = reveal.bets[p.id];
    if (!bet || bet === result || told.has(p.id) || !chose(p.id)) continue;
    blocs.set(bet, [...(blocs.get(bet) ?? []), p.name]);
  }
  const biggest = [...blocs.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (biggest) {
    const [spot, bettors] = biggest;
    const too = chosenBet !== undefined && chosenBet === spot;
    if (bettors.length >= 2 || too) out.push(`${list(bettors)} bet on ${label(spot)}${too ? ' too' : ''}.`);
  }

  return out.length ? out.join(' ') : null;
}
