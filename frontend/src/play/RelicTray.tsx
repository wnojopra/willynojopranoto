import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import type { RelicInfo, RelicKey, StateMsg } from '../protocol';
import { Countdown } from '../tv/Countdown';

export interface MyRelics {
  relics: RelicKey[];
  usedRound: number;
}

const ROUND_PHASES = new Set(['medium', 'question', 'pull', 'reveal']);
const WHISPER_MAX = 40;

/**
 * Why a Relic can't be used right now, or null if it can.
 * Mirrors Room.use_relic on the server (which has the final say).
 */
export function relicBlocked(info: RelicInfo, state: StateMsg, me: string, usedRound: number): string | null {
  const isMedium = state.medium?.playerId === me;
  const kind = state.game.roundKind;
  if (!ROUND_PHASES.has(state.phase)) return 'Only during a round';
  if (usedRound === state.roundNo && kind !== 'final') return 'One per round';
  if (info.timing === 'pull' && (state.phase !== 'pull' || isMedium)) return isMedium ? 'Not for the Medium' : 'During the pull';
  if (info.timing === 'bet') {
    if (isMedium) return 'Not for the Medium';
    if (state.phase !== 'question' && state.phase !== 'pull') return 'While betting';
  }
  if (info.key === 'double' && kind === 'medium') return 'Spirit Bets only';
  if (info.key === 'crystal' && kind === 'medium' && state.phase !== 'question') return 'While guessing';
  return null;
}

/** Your Relics, as a strip of buttons. Tapping one opens a sheet to aim it. */
export function RelicTray({
  state,
  me,
  mine,
  error,
  onCast,
}: {
  state: StateMsg;
  me: string;
  mine: MyRelics;
  error: string | null;
  onCast: (key: RelicKey, target: string | null, text: string | null) => void;
}) {
  const [aiming, setAiming] = useState<RelicKey | null>(null);
  if (mine.relics.length === 0) return null;

  const counts = new Map<RelicKey, number>();
  for (const k of mine.relics) counts.set(k, (counts.get(k) ?? 0) + 1);
  const cast = (key: RelicKey, target: string | null = null, text: string | null = null) => {
    setAiming(null);
    onCast(key, target, text);
  };

  return (
    <section className="relics" aria-label="Your Relics">
      <div className="relics__row">
        {[...counts].map(([key, n]) => {
          const info = state.relicCatalog[key];
          if (!info) return null;
          const blocked = relicBlocked(info, state, me, mine.usedRound);
          return (
            <button
              key={key}
              id={`relic-${key}`}
              className="relic"
              data-tier={info.tier}
              disabled={blocked !== null}
              onClick={() => setAiming(key)}
              aria-label={`${info.name}${n > 1 ? ` ×${n}` : ''}${blocked ? ` (${blocked})` : ''}`}
            >
              <span className="relic__emoji" aria-hidden="true">
                {info.emoji}
              </span>
              <span className="relic__name">{info.name}</span>
              {n > 1 && <span className="relic__count">×{n}</span>}
              {blocked && <span className="relic__why">{blocked}</span>}
            </button>
          );
        })}
      </div>
      {error && (
        <p className="relics__error" role="alert">
          {error}
        </p>
      )}
      {aiming && state.relicCatalog[aiming] && relicBlocked(state.relicCatalog[aiming], state, me, mine.usedRound) === null && (
        <RelicSheet info={state.relicCatalog[aiming]} state={state} me={me} onCast={cast} onClose={() => setAiming(null)} />
      )}
    </section>
  );
}

function RelicSheet({
  info,
  state,
  me,
  onCast,
  onClose,
}: {
  info: RelicInfo;
  state: StateMsg;
  me: string;
  onCast: (key: RelicKey, target?: string | null, text?: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState('');
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    const closed = () => onCloseRef.current();
    dialog.addEventListener('close', closed);
    return () => {
      dialog.removeEventListener('close', closed);
      if (dialog.open) dialog.close();
    };
  }, []);

  // Safari doesn't support closedby yet: close on a tap outside the sheet.
  const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    if ('closedBy' in HTMLDialogElement.prototype) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.currentTarget.close();
  };

  const sendWhisper = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) onCast(info.key, null, text.trim());
  };

  const targets = state.players.filter((p) => p.id !== me && p.id !== state.medium?.playerId);
  const spots = state.spots.filter((s) => !(info.key === 'salt' && state.effects.salted.includes(s.id)));
  const closedBy = { closedby: 'any' } as const;

  return (
    <dialog ref={ref} className="sheet" aria-labelledby="relic-sheet-title" onClick={onBackdrop} {...closedBy}>
      <h2 id="relic-sheet-title" className="sheet__title">
        <span aria-hidden="true">{info.emoji}</span> {info.name}
      </h2>
      <p className="sheet__blurb">{info.blurb}</p>

      {info.target === 'player' && (
        <div className="sheet__grid" role="group" aria-label="Pick a victim">
          {targets.map((p) => (
            <button key={p.id} id={`relic-target-${p.id}`} className="betgrid__btn" onClick={() => onCast(info.key, p.id)}>
              <span className="avatar avatar--sm" style={{ backgroundColor: p.color }} aria-hidden="true" /> {p.name}
            </button>
          ))}
        </div>
      )}

      {info.target === 'spot' && (
        <div className="sheet__grid" role="group" aria-label="Pick a spot">
          {spots.map((s) => (
            <button key={s.id} id={`relic-target-${s.id}`} className="betgrid__btn" onClick={() => onCast(info.key, s.id)}>
              {s.id === me ? `${s.label} (you)` : s.label}
            </button>
          ))}
        </div>
      )}

      {info.target === 'text' && (
        <form className="sheet__whisper" onSubmit={sendWhisper}>
          <label className="field">
            <span className="field__label">Your anonymous whisper</span>
            <input
              id="relic-text"
              className="field__input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={WHISPER_MAX}
              autoComplete="off"
              required
              placeholder="I know what you did…"
            />
          </label>
          <button id="relic-send" className="btn btn--primary" type="submit" disabled={!text.trim()}>
            Whisper it
          </button>
        </form>
      )}

      {info.target === null && (
        <button id="relic-confirm" className="btn btn--primary btn--big" onClick={() => onCast(info.key)}>
          Use it
        </button>
      )}

      <button id="relic-cancel" className="btn btn--ghost" onClick={() => ref.current?.close()}>
        Never mind
      </button>
    </dialog>
  );
}

/** Banners for Relics cast on you this round: mirrored, or frozen with a countdown. */
export function RelicEffects({ state, me }: { state: StateMsg; me: string }) {
  if (state.phase !== 'pull') return null;
  const nameOf = (id: string | null) => state.players.find((p) => p.id === id)?.name ?? 'Someone';
  const lastBy = (key: RelicKey) => [...state.relicEvents].reverse().find((e) => e.key === key && e.target === me);
  const hexLeft = state.effects.hexed[me];
  const hexEvent = lastBy('hex');
  return (
    <>
      {state.effects.mirrored.includes(me) && (
        <p className="phone__effect" role="alert">
          🙃 {nameOf(lastBy('mirror')?.by ?? null)} mirrored you. Your controls are reversed!
        </p>
      )}
      {hexLeft !== undefined && hexLeft > 0 && (
        <p className="phone__effect phone__effect--hex" role="alert">
          🧊 {nameOf(hexEvent?.by ?? null)} froze you!{' '}
          <Countdown key={hexEvent?.seq ?? 0} seconds={hexLeft} className="phone__effectnum" />s
        </p>
      )}
    </>
  );
}
