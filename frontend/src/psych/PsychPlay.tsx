import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { defineTrait } from './definitions';
import { Grid } from './Grid';
import { HowToList } from './HowTo';
import { Pawn, Token } from './Pawn';
import type { Photos, PsyPlayer, PsyServerMsg, PsyState } from './protocol';
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

const SELFIE_PX = 128;
const MAX_SELFIE_CHARS = 24_000;

/** Center-crops a photo to a small square JPEG data URL (stays well under the server's limit). */
function shrinkSelfie(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode'));
      img.onload = () => {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = SELFIE_PX;
        canvas.height = SELFIE_PX;
        const ctx = canvas.getContext('2d');
        if (!ctx || !side) return reject(new Error('canvas'));
        // Front cameras show a mirror image; flip so it matches what people saw.
        ctx.translate(SELFIE_PX, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, SELFIE_PX, SELFIE_PX);
        for (const q of [0.75, 0.6, 0.45, 0.3]) {
          const url = canvas.toDataURL('image/jpeg', q);
          if (url.length <= MAX_SELFIE_CHARS) return resolve(url);
        }
        reject(new Error('too big'));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
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
  const [opinion, setOpinion] = useState<{ x: number; y: number } | null>(null);
  const [step, setStep] = useState<'guess' | 'opinion'>('guess');
  const [notice, setNotice] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photos>({});
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
      case 'avatars':
        setPhotos(msg.avatars);
        break;
      case 'mark_rejected':
        setSelected(null);
        setStep('guess');
        setNotice('That square is taken. Pick another.');
        vibrate([20, 40, 20]);
        break;
      case 'unmark_rejected':
        setNotice('Too late, someone already guessed!');
        break;
      case 'selfie_rejected':
        setNotice('That photo didn’t work. Try another one.');
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
    setOpinion(null);
    setStep('guess');
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
          <Token color={player.color} photo={photos[player.id]} />
          <strong className="psy-phone__name">{player.name}</strong>
          <span className="psy-phone__score">
            {player.score} / {state.target}
          </span>
        </header>
        {state.phase !== 'lobby' && <ScoresDrawer state={state} me={player} photos={photos} />}
        <PhoneBody
          state={state}
          me={player}
          photos={photos}
          secret={secret && secret.turn === state.turn ? secret : null}
          selected={selected}
          setSelected={setSelected}
          opinion={opinion}
          setOpinion={setOpinion}
          step={step}
          setStep={setStep}
          notice={notice}
          setNotice={setNotice}
          send={send}
        />
        {lost && <p className="psy-muted psy-phone__status">Reconnecting…</p>}
      </main>
    </div>
  );
}

function ScoresDrawer({ state, me, photos }: { state: PsyState; me: PsyPlayer; photos: Photos }) {
  const standings = [...state.players].sort((a, b) => b.score - a.score);
  const rank = standings.findIndex((p) => p.id === me.id) + 1;
  return (
    <details className="psy-drawer">
      <summary className="psy-drawer__summary">
        <span>🏆 Scores</span>
        <span className="psy-muted">
          You’re #{rank} of {standings.length}
        </span>
      </summary>
      <ol className="psy-drawer__list">
        {standings.map((p) => (
          <li key={p.id} className={p.id === me.id ? 'psy-drawer__me' : ''}>
            <Token color={p.color} photo={photos[p.id]} />
            <span className="psy-drawer__name">{p.name}</span>
            <strong>{p.score}</strong>
          </li>
        ))}
      </ol>
      <p className="psy-muted psy-drawer__target">First to {state.target} wins</p>
    </details>
  );
}

function SelfiePicker({ me, photo, send, setNotice }: { me: PsyPlayer; photo?: string; send: (msg: object) => void; setNotice: (s: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      send({ type: 'selfie', data: await shrinkSelfie(file) });
      setNotice(null);
    } catch {
      setNotice('That photo didn’t work. Try another one.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="psy-selfie">
      <Pawn color={me.color} photo={photo} className="psy-phone__bigpawn" />
      {/* capture="user" opens the front camera on phones; no camera permission needed. */}
      <input ref={input} id="psy-selfie-input" type="file" accept="image/*" capture="user" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      <div className="psy-row">
        <button id="psy-selfie" type="button" className="psy-btn psy-btn--primary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Saving…' : photo ? '📸 Retake selfie' : '📸 Take a selfie'}
        </button>
        {photo && (
          <button id="psy-selfie-remove" type="button" className="psy-btn psy-btn--ghost" onClick={() => send({ type: 'selfie', data: null })}>
            Remove
          </button>
        )}
      </div>
      <p className="psy-muted psy-selfie__hint">Your face becomes your game piece. Only kept until the game ends.</p>
    </div>
  );
}

type Sq = { x: number; y: number };

interface BodyProps {
  state: PsyState;
  me: PsyPlayer;
  photos: Photos;
  secret: Sq | null;
  selected: Sq | null;
  setSelected: (s: Sq | null) => void;
  opinion: Sq | null;
  setOpinion: (s: Sq | null) => void;
  step: 'guess' | 'opinion';
  setStep: (s: 'guess' | 'opinion') => void;
  notice: string | null;
  setNotice: (s: string | null) => void;
  send: (msg: object) => void;
}

function PhoneBody({ state, me, photos, secret, selected, setSelected, opinion, setOpinion, step, setStep, notice, setNotice, send }: BodyProps) {
  const [word, setWord] = useState<string | null>(null);
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const main = state.mainId ? byId.get(state.mainId) : undefined;
  const current = state.currentId ? byId.get(state.currentId) : undefined;
  const isMain = state.mainId === me.id;
  const myTurn = state.currentId === me.id;
  const opinionsOn = state.settings.opinions;

  useEffect(() => setWord(null), [state.turn]);

  if (state.phase === 'lobby') {
    const seat = state.players.findIndex((p) => p.id === me.id) + 1;
    return (
      <section className="psy-phone__wait">
        <SelfiePicker me={me} photo={photos[me.id]} send={send} setNotice={setNotice} />
        {notice && (
          <p className="psy-error" role="alert">
            {notice}
          </p>
        )}
        <p className="psy-sub">You're in! Seat {seat}.</p>
        <p className="psy-muted">Waiting for the host to start…</p>
        <details className="psy-drawer psy-drawer--howto">
          <summary className="psy-drawer__summary">
            <span>📖 How to play</span>
          </summary>
          <HowToList opinions={opinionsOn} opinionPoints={state.settings.opinionPoints} target={state.target} />
        </details>
      </section>
    );
  }

  if (state.phase === 'gameover') {
    const winners = state.winners.map((id) => byId.get(id)?.name).filter(Boolean);
    const won = state.winners.includes(me.id);
    return (
      <section className="psy-phone__wait">
        <Pawn color={me.color} photo={photos[me.id]} className="psy-phone__bigpawn" />
        <p className="psy-sub">{won ? 'You win! 🎉' : `${winners.join(' & ')} won.`}</p>
        <p className="psy-muted">You finished with {me.score} points.</p>
      </section>
    );
  }

  const guessing = state.phase === 'guessing' && myTurn;
  const choosingOpinion = guessing && opinionsOn && step === 'opinion';

  const confirm = () => {
    if (!selected) return;
    if (guessing && opinionsOn) {
      if (step === 'guess') {
        setStep('opinion');
        return;
      }
      if (!opinion) return;
      send({ type: 'mark', x: selected.x, y: selected.y, ox: opinion.x, oy: opinion.y });
      return;
    }
    send({ type: 'mark', x: selected.x, y: selected.y });
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
      interactive = true;
      prompt = choosingOpinion
        ? `Step 2: where do YOU think ${main?.name ?? 'they'} really is? ${state.settings.opinionPoints ? '(half points)' : '(just for fun)'}`
        : `${opinionsOn ? 'Step 1: ' : ''}Where did ${main?.name ?? 'they'} put themself?`;
    } else if (isMain) prompt = `They're guessing. ${current?.name ?? ''} is up.`;
    else {
      const ahead = state.queue.indexOf(me.id);
      const done = state.guesses.some((g) => g.playerId === me.id);
      prompt = done ? `Locked in. ${current?.name ?? ''} is guessing…` : ahead > 0 ? `${current?.name ?? ''} is guessing. You're up in ${ahead}.` : `${current?.name ?? ''} is guessing…`;
    }
  } else {
    const pts = (state.reveal?.points[me.id] ?? 0) + (state.reveal?.opinionPoints[me.id] ?? 0);
    prompt = isMain ? 'Revealed! See the TV.' : pts ? `+${pts} point${pts === 1 ? '' : 's'}! 🎉` : 'No points this time.';
  }

  const revealing = state.phase === 'reveal';
  const shownSecret = revealing ? state.reveal : isMain && state.phase !== 'secret' ? secret : null;
  const canUndo = isMain && state.phase === 'guessing' && state.guesses.length === 0;
  const definition = word ? defineTrait(word) : null;

  let buttonLabel = 'Tap a square';
  if (choosingOpinion) buttonLabel = opinion ? `Lock in both` : 'Tap where you really think';
  else if (selected) buttonLabel = guessing && opinionsOn ? `Next: your real opinion →` : `Lock in ${selected.x}, ${selected.y}`;

  return (
    <section className="psy-phone__play">
      <p className={`psy-phone__prompt ${interactive ? 'psy-phone__prompt--go' : ''}`} aria-live="polite">
        {prompt}
      </p>
      <Grid
        size="phone"
        traits={state.traits}
        players={state.players}
        photos={photos}
        guesses={state.guesses}
        opinions={state.opinions}
        secret={shownSecret}
        showZones={revealing}
        points={revealing ? state.reveal?.points : undefined}
        opinionPoints={revealing ? state.reveal?.opinionPoints : undefined}
        onPick={interactive ? (x, y) => (choosingOpinion ? setOpinion({ x, y }) : setSelected({ x, y })) : undefined}
        allowClaimed={choosingOpinion}
        selected={interactive ? selected : null}
        selectedColor={state.phase === 'secret' ? '#c9a64e' : me.color}
        pendingOpinion={choosingOpinion && opinion ? { ...opinion, color: me.color } : null}
        onWord={(w) => setWord((cur) => (cur === w ? null : w))}
      />
      {word && (
        <button type="button" className="psy-define psy-define--phone" onClick={() => setWord(null)}>
          <span className="psy-define__word">{word}</span>
          <span className="psy-define__text">{definition ?? 'No definition yet. Use your imagination!'}</span>
        </button>
      )}
      {notice && (
        <p className="psy-error" role="alert">
          {notice}
        </p>
      )}
      {interactive && (
        <div className="psy-phone__actions">
          {choosingOpinion && (
            <button id="psy-back-step" type="button" className="psy-btn psy-btn--ghost" onClick={() => setStep('guess')}>
              ← Back
            </button>
          )}
          <button
            id="psy-confirm"
            type="button"
            className="psy-btn psy-btn--primary psy-btn--big"
            disabled={choosingOpinion ? !opinion : !selected}
            onClick={confirm}
          >
            {buttonLabel}
          </button>
        </div>
      )}
      {canUndo && (
        <button id="psy-undo" type="button" className="psy-btn psy-btn--ghost" onClick={() => send({ type: 'unmark' })}>
          ↩ Change my answer
        </button>
      )}
    </section>
  );
}
