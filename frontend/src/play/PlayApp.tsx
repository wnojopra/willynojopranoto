import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { PlanchetteState, ServerMsg, StateMsg } from '../protocol';
import { useGameSocket } from '../useGameSocket';
import { MiniMap } from './MiniMap';
import { Touchpad } from './Touchpad';

interface JoinInfo {
  code: string;
  name: string;
}

function vibrate(pattern: number | number[]) {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
}

export function PlayApp() {
  const initialCode = new URLSearchParams(location.search).get('code') ?? '';
  const [code, setCode] = useState(initialCode.toUpperCase().slice(0, 4));
  const [name, setName] = useState('');
  const [join, setJoin] = useState<JoinInfo | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [state, setState] = useState<StateMsg | null>(null);
  // Our own secret bet. Only this phone (and the server) knows it before the reveal.
  const [myBet, setMyBet] = useState<{ spotId: string; roundNo: number; auto: boolean } | null>(null);
  const planchetteRef = useRef<PlanchetteState | null>(null);

  const onMessage = useCallback((msg: ServerMsg) => {
    switch (msg.type) {
      case 'joined':
        setMe(msg.playerId);
        setError(null);
        vibrate(30);
        break;
      case 'bet_ok':
        setMyBet({ spotId: msg.spotId, roundNo: msg.roundNo, auto: msg.auto });
        break;
      case 'state':
        setState(msg);
        planchetteRef.current = msg.planchette;
        break;
      case 'tick':
        planchetteRef.current = msg;
        break;
      case 'error':
        setError(msg.message);
        setJoin(null);
        setMe(null);
        setState(null);
        break;
    }
  }, []);

  const firstMessage = join ? JSON.stringify({ type: 'join', code: join.code, name: join.name }) : null;
  const { status, send } = useGameSocket(join ? '/ws/play' : null, firstMessage, onMessage, attempt);

  useWakeLock(me !== null);
  useRevealBuzz(state, me);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setJoin({ code: code.trim().toUpperCase(), name: name.trim() });
    setAttempt((n) => n + 1);
  };

  if (!join) {
    return (
      <main className="phone phone--join">
        <h1 className="phone__title">Spirit Board</h1>
        <form className="joinform" onSubmit={onSubmit}>
          <label className="field">
            <span className="field__label">Room code</span>
            <input
              id="join-code"
              className="field__input field__input--code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              inputMode="text"
              required
              minLength={4}
              maxLength={4}
              pattern="[A-Za-z]{4}"
              placeholder="ABCD"
            />
          </label>
          <label className="field">
            <span className="field__label">Your name</span>
            <input
              id="join-name"
              className="field__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="nickname"
              required
              maxLength={14}
              placeholder="Kevin"
            />
          </label>
          {error && (
            <p className="joinform__error" role="alert">
              {error}
            </p>
          )}
          <button id="join-submit" className="btn btn--primary btn--big" type="submit">
            Join the séance
          </button>
        </form>
      </main>
    );
  }

  if (status === 'closed') {
    return (
      <main className="phone phone--center">
        <p className="phone__big">The connection to the other side was lost.</p>
        <button id="rejoin" className="btn btn--primary btn--big" onClick={() => setAttempt((n) => n + 1)}>
          Rejoin as {join.name}
        </button>
        <button id="leave" className="btn btn--ghost" onClick={() => setJoin(null)}>
          Use a different name
        </button>
      </main>
    );
  }

  if (!state || !me) {
    return (
      <main className="phone phone--center">
        <p className="phone__big phone__summoning">Joining…</p>
      </main>
    );
  }

  const self = state.players.find((p) => p.id === me);
  const result = state.spots.find((s) => s.id === state.resultSpotId);
  const liveBet = myBet && myBet.roundNo === state.roundNo ? myBet : null;
  const betSpot = state.spots.find((s) => s.id === (state.reveal?.bets[me] ?? liveBet?.spotId));
  const betLabel = (id: string | undefined) => (id === me ? 'Yourself' : state.spots.find((s) => s.id === id)?.label);

  const placeBet = (spotId: string) => {
    setMyBet({ spotId, roundNo: state.roundNo, auto: false });
    send({ type: 'bet', spotId });
    vibrate(15);
  };

  return (
    <main className="phone" data-phase={state.phase}>
      <header className="phone__bar">
        <span className="avatar avatar--sm" style={{ backgroundColor: self?.color }} aria-hidden="true" />
        <span className="phone__me">{self?.name ?? join.name}</span>
        <span className="phone__score" aria-label={`${self?.score ?? 0} candy`}>
          🍬 {self?.score ?? 0}
        </span>
        <span className="phone__code">{state.code}</span>
      </header>

      {state.phase === 'lobby' && (
        <section className="phone__panel phone--center">
          <p className="phone__big">You’re in.</p>
          <p className="phone__sub">Eyes on the TV. The séance begins soon.</p>
          <p className="phone__sub">{state.players.length} spirits gathered</p>
        </section>
      )}

      {state.phase === 'question' && (
        <section className="phone__panel phone__bet">
          <p className="phone__question">{state.question?.text}</p>
          <p className="phone__pot">
            Pot <strong>🍬 {state.pot}</strong>
          </p>
          <p className="phone__sub">Secretly bet on where the board will land.</p>
          <div className="betgrid" role="group" aria-label="Your bet">
            {state.spots.map((s) => (
              <button
                key={s.id}
                id={`bet-${s.id}`}
                className="betgrid__btn"
                aria-pressed={liveBet?.spotId === s.id}
                onClick={() => placeBet(s.id)}
              >
                {s.id === me ? `${s.label} (you)` : s.label}
              </button>
            ))}
          </div>
          <p className="phone__sub phone__betnote" aria-live="polite">
            {liveBet ? 'Locked in… until you change your mind.' : 'No bet? The spirits will pick for you.'}
          </p>
        </section>
      )}

      {state.phase === 'pull' && (
        <section className="phone__pull">
          <p className="phone__question phone__question--small">{state.question?.text}</p>
          <p className="phone__betchip" data-auto={liveBet?.auto ? '' : undefined}>
            {liveBet
              ? `${liveBet.auto ? 'The spirits bet for you' : 'Your bet'}: ${betLabel(liveBet.spotId) ?? '?'}`
              : 'Pull for what you believe.'}
            <span className="phone__betpot">🍬 {state.pot}</span>
          </p>
          <MiniMap board={state.board} spots={state.spots} planchetteRef={planchetteRef} betSpotId={liveBet?.spotId ?? null} />
          <Touchpad onPull={(dx, dy) => send({ type: 'pull', dx, dy })} color={self?.color ?? '#e8a33d'} />
        </section>
      )}

      {state.phase === 'reveal' && result && (
        <section className="phone__panel phone--center">
          <p className="phone__sub">The spirits have spoken…</p>
          <p className="phone__answer">{result.id === me ? 'YOU' : result.label}</p>
          {result.id === me && <p className="phone__sub">The board has chosen you. Sorry.</p>}
          <RevealOutcome state={state} me={me} betLabel={betLabel(betSpot?.id)} />
        </section>
      )}
    </main>
  );
}

function RevealOutcome({ state, me, betLabel }: { state: StateMsg; me: string; betLabel: string | undefined }) {
  const reveal = state.reveal;
  if (!reveal) return null;
  const won = reveal.payout[me];
  const auto = reveal.autoBets.includes(me);
  const winners = Object.keys(reveal.payout).length;
  return (
    <div className="outcome" data-won={won ? '' : undefined}>
      {won ? (
        <>
          <p className="outcome__big">+🍬 {won}</p>
          <p className="phone__sub">
            {winners === 1 ? 'You called it alone. The whole pot is yours.' : `Split ${winners} ways.`}
            {auto && ' (The spirits bet for you. Lucky.)'}
          </p>
        </>
      ) : (
        <>
          <p className="outcome__miss">
            {auto ? 'The spirits bet' : 'You bet'} <strong>{betLabel ?? '?'}</strong>.
          </p>
          <p className="phone__sub">
            {reveal.rolledOver ? 'Nobody called it. The spirits keep the candy. Pot rolls over!' : 'No candy for you.'}
          </p>
        </>
      )}
    </div>
  );
}

/** Keeps the phone screen awake while in a game (where supported). */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
        if (cancelled) await lock.release();
      } catch {
        // Not allowed (e.g. low battery); the game still works.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request();
    };
    void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}

/** Buzzes when the round locks in, extra hard if the board picked you. */
function useRevealBuzz(state: StateMsg | null, me: string | null) {
  const lastRound = useRef(0);
  useEffect(() => {
    if (!state || state.phase !== 'reveal' || state.roundNo === lastRound.current) return;
    lastRound.current = state.roundNo;
    vibrate(state.resultSpotId === me ? [120, 60, 120, 60, 300] : me && state.reveal?.payout[me] ? [40, 40, 40, 40, 160] : 60);
  }, [state, me]);
}
