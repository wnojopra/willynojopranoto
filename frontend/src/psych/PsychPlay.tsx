import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Grid } from './Grid';
import { Pawn, Token } from './Pawn';
import type { PsyPlayer, PsyServerMsg, PsyState } from './protocol';
import { ensureSession, loadPsychFonts, usePsychSocket } from './usePsychSocket';
import './psych.css';

interface JoinInfo {
  code: string;
  name: string;
}

/** This tab's room + name, so a refreshed phone rejoins on its own. Not secret. */
const JOIN_KEY = 'psy-join';
const MAX_RETRIES = 6;

function savedJoin(): JoinInfo | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(JOIN_KEY) ?? 'null');
    return raw && typeof raw.code === 'string' && typeof raw.name === 'string' ? { code: raw.code, name: raw.name } : null;
  } catch {
    return null;
  }
}

function saveJoin(j: JoinInfo | null) {
  try {
    if (j) sessionStorage.setItem(JOIN_KEY, JSON.stringify(j));
    else sessionStorage.removeItem(JOIN_KEY);
  } catch {
    // No sessionStorage: a refresh shows the join form again.
  }
}

function vibrate(pattern: number | number[]) {
  const active = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? true;
  if ('vibrate' in navigator && active) navigator.vibrate(pattern);
}

export function PsychPlay() {
  const initialCode = new URLSearchParams(location.search).get('code') ?? '';
  const resume = useMemo(() => {
    const j = savedJoin();
    return j && (!initialCode || initialCode.toUpperCase() === j.code) ? j : null;
  }, [initialCode]);
  const [code, setCode] = useState(resume?.code ?? initialCode.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4));
  const [name, setName] = useState(resume?.name ?? '');
  const [join, setJoin] = useState<JoinInfo | null>(resume);
  const [attempt, setAttempt] = useState(resume ? 1 : 0);
  const [retries, setRetries] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [state, setState] = useState<PsyState | null>(null);
  const [secret, setSecret] = useState<{ turn: number; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<{ x: number; y: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    document.title = 'Psychological';
    loadPsychFonts();
    ensureSession().then(() => setReady(true));
  }, []);

  const onMessage = useCallback((msg: PsyServerMsg) => {
    switch (msg.type) {
      case 'joined':
        setMe(msg.playerId);
        setError(null);
        vibrate(30);
        break;
      case 'state':
        setState(msg);
        break;
      case 'secret':
        setSecret({ turn: msg.turn, x: msg.x, y: msg.y });
        break;
      case 'mark_rejected':
        setSelected(null);
        setNotice('That square is taken. Pick another.');
        vibrate([20, 40, 20]);
        break;
      case 'error':
        setError(msg.message);
        setJoin(null);
        setMe(null);
        setState(null);
        saveJoin(null);
        break;
    }
  }, []);

  const firstMessage = join ? JSON.stringify({ type: 'join', code: join.code, name: join.name }) : null;
  const { status, send } = usePsychSocket(join && ready ? '/ws/psych/play' : null, firstMessage, onMessage, attempt);

  // Clear the pick whenever the turn or who's up changes.
  const turnKey = state ? `${state.turn}-${state.phase}-${state.currentId}` : '';
  useEffect(() => {
    setSelected(null);
    setNotice(null);
  }, [turnKey]);

  // Buzz when it becomes our turn.
  const myTurn = !!state && !!me && state.currentId === me;
  useEffect(() => {
    if (myTurn) vibrate([40, 60, 40]);
  }, [myTurn, turnKey]);

  // Dropped (screen locked, Wi-Fi blip): rejoin on our own, a few times.
  const lost = status === 'closed' && join !== null;
  useEffect(() => {
    if (status === 'open') setRetries(0);
  }, [status]);
  useEffect(() => {
    if (!lost || retries >= MAX_RETRIES) return;
    const id = setTimeout(() => {
      setRetries((n) => n + 1);
      setAttempt((n) => n + 1);
    }, Math.min(6000, 700 * 2 ** retries));
    return () => clearTimeout(id);
  }, [lost, retries]);
  useEffect(() => {
    if (!lost) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setRetries(0);
        setAttempt((n) => n + 1);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [lost]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const j = { code: code.trim().toUpperCase(), name: name.trim() };
    saveJoin(j);
    setJoin(j);
    setRetries(0);
    setAttempt((n) => n + 1);
  };

  const leave = () => {
    saveJoin(null);
    location.href = '/psychological/play';
  };

  if (!join) {
    return (
      <div className="psy-root psy-root--phone">
        <main className="psy-phone psy-phone--join">
          <h1 className="psy-logo psy-logo--small">
            <span className="psy-logo__psycho">Psycho</span>
            <span className="psy-logo__logical">logical</span>
            <span className="psy-byline">by Willy Nojopranoto</span>
          </h1>
          <form className="psy-panel psy-joinform" onSubmit={onSubmit}>
            <label className="psy-field">
              <span className="psy-kicker">Room code</span>
              <input
                id="psy-join-code"
                className="psy-input psy-input--code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                required
                minLength={4}
                maxLength={4}
                pattern="[A-Za-z]{4}"
                placeholder="ABCD"
              />
            </label>
            <label className="psy-field">
              <span className="psy-kicker">Your name</span>
              <input
                id="psy-join-name"
                className="psy-input"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 14))}
                autoComplete="nickname"
                required
                maxLength={14}
                placeholder="Your name"
              />
            </label>
            {error && (
              <p className="psy-error" role="alert">
                {error}
              </p>
            )}
            <button id="psy-join" type="submit" className="psy-btn psy-btn--primary psy-btn--big">
              Join
            </button>
          </form>
        </main>
      </div>
    );
  }

  const player = state && me ? state.players.find((p) => p.id === me) : undefined;
  if (!state || !player) {
    return (
      <div className="psy-root psy-root--phone">
        <main className="psy-phone psy-center">
          <p className="psy-sub">{lost && retries >= MAX_RETRIES ? 'Lost connection.' : 'Joining…'}</p>
          {lost && retries >= MAX_RETRIES && (
            <button
              id="psy-rejoin"
              type="button"
              className="psy-btn psy-btn--primary"
              onClick={() => {
                setRetries(0);
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </button>
          )}
          <button id="psy-leave-joining" type="button" className="psy-btn psy-btn--ghost" onClick={leave}>
            Leave
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="psy-root psy-root--phone">
      <main className="psy-phone">
        <header className="psy-phone__head">
          <Token color={player.color} />
          <strong className="psy-phone__name">{player.name}</strong>
          <span className="psy-phone__score">
            {player.score} / {state.target}
          </span>
        </header>
        <PhoneBody state={state} me={player} secret={secret && secret.turn === state.turn ? secret : null} selected={selected} setSelected={setSelected} notice={notice} send={send} />
        {lost && <p className="psy-muted psy-phone__status">Reconnecting…</p>}
      </main>
    </div>
  );
}

interface BodyProps {
  state: PsyState;
  me: PsyPlayer;
  secret: { x: number; y: number } | null;
  selected: { x: number; y: number } | null;
  setSelected: (s: { x: number; y: number } | null) => void;
  notice: string | null;
  send: (msg: object) => void;
}

function PhoneBody({ state, me, secret, selected, setSelected, notice, send }: BodyProps) {
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const main = state.mainId ? byId.get(state.mainId) : undefined;
  const current = state.currentId ? byId.get(state.currentId) : undefined;
  const isMain = state.mainId === me.id;
  const myTurn = state.currentId === me.id;

  if (state.phase === 'lobby') {
    const seat = state.players.findIndex((p) => p.id === me.id) + 1;
    return (
      <section className="psy-phone__wait">
        <Pawn color={me.color} className="psy-phone__bigpawn" />
        <p className="psy-sub">You're in! Seat {seat}.</p>
        <p className="psy-muted">Waiting for the host to start…</p>
      </section>
    );
  }

  if (state.phase === 'gameover') {
    const winners = state.winners.map((id) => byId.get(id)?.name).filter(Boolean);
    const won = state.winners.includes(me.id);
    return (
      <section className="psy-phone__wait">
        <Pawn color={me.color} className="psy-phone__bigpawn" />
        <p className="psy-sub">{won ? 'You win! 🎉' : `${winners.join(' & ')} won.`}</p>
        <p className="psy-muted">You finished with {me.score} points.</p>
      </section>
    );
  }

  const confirm = () => {
    if (selected) send({ type: 'mark', x: selected.x, y: selected.y });
  };

  let prompt: string;
  let interactive = false;
  if (state.phase === 'secret') {
    if (isMain) {
      prompt = 'Where do you see yourself? Only you can see this.';
      interactive = true;
    } else prompt = `${main?.name ?? 'Someone'} is marking in secret…`;
  } else if (state.phase === 'guessing') {
    if (myTurn) {
      prompt = `Where did ${main?.name ?? 'they'} put themself?`;
      interactive = true;
    } else if (isMain) prompt = `They're guessing. ${current?.name ?? ''} is up.`;
    else {
      const ahead = state.queue.indexOf(me.id);
      const done = state.guesses.some((g) => g.playerId === me.id);
      prompt = done ? `Locked in. ${current?.name ?? ''} is guessing…` : ahead > 0 ? `${current?.name ?? ''} is guessing. You're up in ${ahead}.` : `${current?.name ?? ''} is guessing…`;
    }
  } else {
    const pts = state.reveal?.points[me.id];
    prompt = isMain ? 'Revealed! See the TV.' : pts ? `+${pts} point${pts === 1 ? '' : 's'}! 🎉` : 'No points this time.';
  }

  const revealing = state.phase === 'reveal';
  const shownSecret = revealing ? state.reveal : isMain ? secret : null;

  return (
    <section className="psy-phone__play">
      <p className={`psy-phone__prompt ${interactive ? 'psy-phone__prompt--go' : ''}`} aria-live="polite">
        {prompt}
      </p>
      <Grid
        size="phone"
        traits={state.traits}
        players={state.players}
        guesses={state.guesses}
        secret={shownSecret}
        showZones={revealing}
        points={revealing ? state.reveal?.points : undefined}
        onPick={interactive ? (x, y) => setSelected({ x, y }) : undefined}
        selected={interactive ? selected : null}
        selectedColor={state.phase === 'secret' ? '#c9a64e' : me.color}
      />
      {notice && (
        <p className="psy-error" role="alert">
          {notice}
        </p>
      )}
      {interactive && (
        <button id="psy-confirm" type="button" className="psy-btn psy-btn--primary psy-btn--big" disabled={!selected} onClick={confirm}>
          {selected ? `Lock in ${selected.x}, ${selected.y}` : 'Tap a square'}
        </button>
      )}
    </section>
  );
}
