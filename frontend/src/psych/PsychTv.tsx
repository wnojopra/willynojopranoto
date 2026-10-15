import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { QrCode } from '../tv/QrCode';
import { defineTrait } from './definitions';
import { Grid } from './Grid';
import { HeadArt } from './HeadArt';
import { HowToOverlay } from './HowTo';
import { Crown, GoldMarker, Pawn, Token } from './Pawn';
import type { Photos, PsyPlayer, PsyServerMsg, PsyState } from './protocol';
import { pickStrikeVariant, Strike, type StrikeBag } from './Strike';
import { ensureSession, loadPsychFonts, usePsychSocket } from './usePsychSocket';
import './psych.css';

/** This tab's room code, so a refreshed TV gets its room back (checked server-side by device cookie). */
const ROOM_KEY = 'psy-tv-room';
const MAX_RETRIES = 8;
const STRIKE_DELAY_MS = 700; // let the gold marker land first
const STRIKE_MS = 3400;

const WINNER_LINES = ['Reads people like a book.', 'Basically a licensed therapist now.', 'Knows you better than your mom.', 'Has seen into your soul. Sorry.'];
const LOSER_LINES = [
  'Reads people like a terms-of-service agreement.',
  'Couldn’t read the room if it came in large print.',
  'Has met these people before. Allegedly.',
  'Thinks everyone is a closed book. Everyone disagrees.',
  'Should maybe start listening when people talk.',
];

function savedRoom(): string | null {
  try {
    return sessionStorage.getItem(ROOM_KEY);
  } catch {
    return null;
  }
}

function saveRoom(code: string | null) {
  try {
    if (code) sessionStorage.setItem(ROOM_KEY, code);
    else sessionStorage.removeItem(ROOM_KEY);
  } catch {
    // Without sessionStorage a refresh just makes a new room.
  }
}

/** A button that needs a second click within a few seconds (no blocking confirm()). */
function ConfirmButton({ id, label, confirmLabel, onConfirm, className }: { id: string; label: string; confirmLabel: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      id={id}
      type="button"
      className={`psy-btn ${armed ? 'psy-btn--danger' : className ?? 'psy-btn--ghost'}`}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

function Toggle({ id, label, hint, on, disabled, onChange }: { id: string; label: string; hint: string; on: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className={`psy-toggle ${disabled ? 'psy-toggle--disabled' : ''}`} htmlFor={id}>
      <input id={id} type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="psy-toggle__track" aria-hidden="true" />
      <span className="psy-toggle__text">
        <strong>{label}</strong>
        <span className="psy-muted">{hint}</span>
      </span>
    </label>
  );
}

export function PsychTv() {
  const [state, setState] = useState<PsyState | null>(null);
  const [photos, setPhotos] = useState<Photos>({});
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retries, setRetries] = useState(0);
  const [ready, setReady] = useState(false);
  const [howTo, setHowTo] = useState(false);
  const strikeBag = useRef<StrikeBag>({ remaining: [] });

  useEffect(() => {
    document.title = 'Psychological';
    loadPsychFonts();
    ensureSession().then(() => setReady(true));
  }, []);

  const onMessage = useCallback((msg: PsyServerMsg) => {
    if (msg.type === 'state') setState(msg);
    else if (msg.type === 'avatars') setPhotos(msg.avatars);
    else if (msg.type === 'created') {
      saveRoom(msg.code);
      setRetries(0);
    } else if (msg.type === 'error') setError(msg.message);
  }, []);

  // Recomputed per attempt (not when the code arrives, which would reconnect).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const firstMessage = useMemo(() => JSON.stringify({ type: 'create', resume: savedRoom() }), [attempt]);
  const { status, send } = usePsychSocket(ready ? '/ws/psych/tv' : null, firstMessage, onMessage, attempt);

  const lost = status === 'closed' && !error;
  useEffect(() => {
    if (!lost || retries >= MAX_RETRIES) return;
    const id = setTimeout(() => {
      setRetries((n) => n + 1);
      setAttempt((n) => n + 1);
    }, Math.min(8000, 800 * 2 ** retries));
    return () => clearTimeout(id);
  }, [lost, retries]);

  let screen;
  if (error || (lost && retries >= MAX_RETRIES)) {
    screen = (
      <main className="psy-center">
        <div className="psy-panel">
          <h1 className="psy-title">Connection lost</h1>
          <p className="psy-sub">{error ?? 'Lost connection to the game server.'}</p>
          <div className="psy-row">
            {!error && (
              <button
                id="psy-tv-reconnect"
                type="button"
                className="psy-btn psy-btn--primary"
                onClick={() => {
                  setRetries(0);
                  setAttempt((n) => n + 1);
                }}
              >
                Reconnect
              </button>
            )}
            <button
              id="psy-tv-new"
              type="button"
              className="psy-btn psy-btn--ghost"
              onClick={() => {
                saveRoom(null);
                location.reload();
              }}
            >
              Start a new game
            </button>
          </div>
        </div>
      </main>
    );
  } else if (!state) {
    screen = (
      <main className="psy-center">
        <p className="psy-sub">Setting up the board…</p>
      </main>
    );
  } else if (state.phase === 'lobby') {
    screen = <Lobby state={state} photos={photos} send={send} onHowTo={() => setHowTo(true)} />;
  } else if (state.phase === 'gameover') {
    screen = <GameOver state={state} photos={photos} send={send} />;
  } else {
    screen = <Play state={state} photos={photos} send={send} onHowTo={() => setHowTo(true)} strikeBag={strikeBag} />;
  }
  return (
    <div className="psy-root psy-root--tv">
      {screen}
      {howTo && state && (
        <HowToOverlay opinions={state.settings.opinions} opinionPoints={state.settings.opinionPoints} target={state.target} onClose={() => setHowTo(false)} />
      )}
    </div>
  );
}

type Send = (msg: object) => void;

function Lobby({ state, photos, send, onHowTo }: { state: PsyState; photos: Photos; send: Send; onHowTo: () => void }) {
  const joinUrl = `${location.origin}/psychological/play?code=${state.code}`;
  const hasBots = state.players.some((p) => p.isBot);
  return (
    <main className="psy-lobby">
      <section className="psy-lobby__art">
        <HeadArt className="psy-lobby__head" />
        <h1 className="psy-logo">
          <span className="psy-logo__psycho">Psycho</span>
          <span className="psy-logo__logical">logical</span>
          <span className="psy-byline">by Willy Nojopranoto</span>
        </h1>
        <p className="psy-sub psy-sub--light">How well do your friends really know you?</p>
        <button id="psy-howto" type="button" className="psy-btn psy-btn--light" onClick={onHowTo}>
          📖 How to play
        </button>
      </section>
      <section className="psy-panel psy-lobby__panel">
        <div className="psy-lobby__join">
          <div>
            <p className="psy-kicker">Join on your phone</p>
            <p className="psy-url">
              {location.host}
              <wbr />
              /psychological/play
            </p>
            <p className="psy-kicker">Room code</p>
            <p className="psy-code" id="psy-code">
              {state.code}
            </p>
          </div>
          <QrCode value={joinUrl} className="psy-qr" label={`Scan to join room ${state.code}`} />
        </div>

        <h2 className="psy-h2">
          Players <span className="psy-muted">(turn order)</span>
        </h2>
        {state.players.length === 0 ? (
          <p className="psy-muted">Waiting for players…</p>
        ) : (
          <ol className="psy-roster">
            {state.players.map((p, i) => (
              <li key={p.id} className={`psy-roster__item ${p.connected ? '' : 'psy-roster__item--off'}`}>
                <Pawn color={p.color} photo={photos[p.id]} className="psy-roster__pawn" />
                <span className="psy-roster__name">
                  {p.name}
                  {p.isBot && <span className="psy-muted"> (bot)</span>}
                </span>
                <span className="psy-roster__tools">
                  <button type="button" className="psy-icon" aria-label={`Move ${p.name} earlier`} disabled={i === 0} onClick={() => send({ type: 'move_seat', playerId: p.id, dir: -1 })}>
                    ▲
                  </button>
                  <button
                    type="button"
                    className="psy-icon"
                    aria-label={`Move ${p.name} later`}
                    disabled={i === state.players.length - 1}
                    onClick={() => send({ type: 'move_seat', playerId: p.id, dir: 1 })}
                  >
                    ▼
                  </button>
                  <button type="button" className="psy-icon psy-icon--x" aria-label={`Remove ${p.name}`} onClick={() => send({ type: 'kick', playerId: p.id })}>
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ol>
        )}

        <div className="psy-lobby__settings">
          <span className="psy-kicker">First to</span>
          <button type="button" className="psy-icon" aria-label="Lower target score" disabled={state.target <= 5} onClick={() => send({ type: 'set_target', target: state.target - 1 })}>
            −
          </button>
          <strong className="psy-target" id="psy-target">
            {state.target}
          </strong>
          <button type="button" className="psy-icon" aria-label="Raise target score" disabled={state.target >= 20} onClick={() => send({ type: 'set_target', target: state.target + 1 })}>
            +
          </button>
          <span className="psy-kicker">points</span>
          <span className="psy-spacer" />
          <button id="psy-add-bot" type="button" className="psy-btn psy-btn--ghost psy-btn--small" onClick={() => send({ type: 'add_bot' })}>
            + Bot
          </button>
          {hasBots && (
            <button id="psy-remove-bot" type="button" className="psy-btn psy-btn--ghost psy-btn--small" onClick={() => send({ type: 'remove_bot' })}>
              − Bot
            </button>
          )}
        </div>

        <div className="psy-lobby__toggles">
          <Toggle
            id="psy-opt-opinions"
            label="Second marker"
            hint="Guessers also mark what they really think"
            on={state.settings.opinions}
            onChange={(on) => send({ type: 'set_opinions', on })}
          />
          <Toggle
            id="psy-opt-opinion-points"
            label="Half points"
            hint="Second markers score half (1.5 / 1 / 0.5)"
            on={state.settings.opinionPoints}
            disabled={!state.settings.opinions}
            onChange={(on) => send({ type: 'set_opinion_points', on })}
          />
        </div>

        <button id="psy-start" type="button" className="psy-btn psy-btn--primary psy-btn--big" disabled={!state.canStart} onClick={() => send({ type: 'start' })}>
          {state.canStart ? 'Start the game' : `Need ${state.minPlayers} players`}
        </button>
      </section>
    </main>
  );
}

function Play({
  state,
  photos,
  send,
  onHowTo,
  strikeBag,
}: {
  state: PsyState;
  photos: Photos;
  send: Send;
  onHowTo: () => void;
  strikeBag: React.RefObject<StrikeBag>;
}) {
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const main = state.mainId ? byId.get(state.mainId) : undefined;
  const current = state.currentId ? byId.get(state.currentId) : undefined;
  const revealing = state.phase === 'reveal';
  const guessed = new Set(state.guesses.map((g) => g.playerId));
  const standings = [...state.players].sort((a, b) => b.score - a.score);
  const [editing, setEditing] = useState(false);
  const [word, setWord] = useState<string | null>(null);
  const step = state.settings.opinionPoints ? 0.5 : 1;

  // Definition card closes on its own after a while.
  useEffect(() => {
    if (!word) return;
    const t = setTimeout(() => setWord(null), 9000);
    return () => clearTimeout(t);
  }, [word]);
  useEffect(() => setWord(null), [state.turn]);

  // Bullseye celebration: once per turn, picked at random without repeats.
  const celebrated = useRef(0);
  const [strike, setStrike] = useState<{ variant: number; player: PsyPlayer } | null>(null);
  const bullseyeId = revealing && state.reveal ? Object.keys(state.reveal.points).find((id) => state.reveal!.points[id] === 3) : undefined;
  useEffect(() => {
    if (!bullseyeId || celebrated.current === state.turn) return;
    const p = byId.get(bullseyeId);
    if (!p) return;
    celebrated.current = state.turn;
    const variant = pickStrikeVariant(strikeBag.current);
    const show = setTimeout(() => setStrike({ variant, player: p }), STRIKE_DELAY_MS);
    const hide = setTimeout(() => setStrike(null), STRIKE_DELAY_MS + STRIKE_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bullseyeId, state.turn]);

  let banner: ReactNode;
  if (state.phase === 'secret') {
    banner = (
      <>
        <Name p={main} photos={photos} /> is marking where they see themself…
        <span className="psy-banner__hint">Secretly, on their phone. No peeking.</span>
      </>
    );
  } else if (state.phase === 'guessing') {
    banner = (
      <>
        <Name p={current} photos={photos} />, where did <Name p={main} photos={photos} /> put themself?
        <span className="psy-banner__hint">
          {state.settings.opinions ? 'Then add a small marker for what you really think. ' : ''}Taken squares are blocked.
        </span>
      </>
    );
  } else {
    const winners = state.winners.map((id) => byId.get(id)).filter(Boolean) as PsyPlayer[];
    banner = winners.length ? (
      <>
        {winners.map((w, i) => (
          <span key={w.id}>
            {i > 0 && ' & '}
            <Name p={w} photos={photos} />
          </span>
        ))}{' '}
        reached {state.target}!
      </>
    ) : (
      <>
        Here's where <Name p={main} photos={photos} /> put themself.
      </>
    );
  }

  const definition = word ? defineTrait(word) : null;

  return (
    <main className="psy-game">
      <section className="psy-stage">
        <div className="psy-boardcard">
          <HeadArt className="psy-boardcard__head" />
          <Grid
            size="tv"
            traits={state.traits}
            players={state.players}
            photos={photos}
            guesses={state.guesses}
            opinions={state.opinions}
            secret={revealing ? state.reveal : null}
            showZones={revealing}
            points={revealing ? state.reveal?.points : undefined}
            opinionPoints={revealing ? state.reveal?.opinionPoints : undefined}
            onWord={(w) => setWord((cur) => (cur === w ? null : w))}
          />
          {word && (
            <button type="button" className="psy-define" onClick={() => setWord(null)} aria-live="polite">
              <span className="psy-define__word">{word}</span>
              <span className="psy-define__text">{definition ?? 'No definition yet. Use your imagination!'}</span>
              <span className="psy-define__close psy-muted">Tap to close</span>
            </button>
          )}
        </div>
        {strike && <Strike variant={strike.variant} name={strike.player.name} color={strike.player.color} photo={photos[strike.player.id]} />}
      </section>

      <aside className="psy-side">
        <div className="psy-roomtag">
          <span>
            Room <strong id="psy-room-code">{state.code}</strong>
          </span>
          <span className="psy-roomtag__url">{location.host}/psychological/play</span>
        </div>

        <div className="psy-panel psy-banner" key={`${state.turn}-${state.phase}-${state.currentId}`}>
          <p className="psy-kicker">
            Turn {state.turn} · <Name p={main} photos={photos} />
            ’s turn
          </p>
          <p className="psy-banner__text">{banner}</p>
        </div>

        <div className="psy-panel">
          <h2 className="psy-h2">Guessing order</h2>
          <ol className="psy-order">
            <li className={`psy-order__item ${state.phase === 'secret' ? 'psy-order__item--now' : ''}`}>
              <GoldMarker className="psy-order__gold" />
              <span>{main?.name ?? '—'}</span>
              <span className="psy-order__state">{state.secretMarked ? '✓ marked' : 'marking…'}</span>
            </li>
            {state.order.map((id) => {
              const p = byId.get(id);
              if (!p) return null;
              const now = id === state.currentId;
              const pts = (state.reveal?.points[id] ?? 0) + (state.reveal?.opinionPoints[id] ?? 0);
              const stateText = guessed.has(id)
                ? revealing
                  ? `+${pts}`
                  : '✓'
                : now
                  ? 'guessing…'
                  : state.queue.includes(id)
                    ? ''
                    : 'skipped';
              return (
                <li key={id} className={`psy-order__item ${now ? 'psy-order__item--now' : ''} ${p.connected ? '' : 'psy-order__item--off'}`}>
                  <Token color={p.color} photo={photos[p.id]} />
                  <span>{p.name}</span>
                  <span className="psy-order__state">{stateText}</span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="psy-panel">
          <div className="psy-panel__head">
            <h2 className="psy-h2">
              Scores <span className="psy-muted">· first to {state.target}</span>
            </h2>
            <button id="psy-edit-scores" type="button" className="psy-icon psy-icon--wide" aria-pressed={editing} onClick={() => setEditing(!editing)}>
              {editing ? 'Done' : '✎ Edit'}
            </button>
          </div>
          <ul className="psy-scores">
            {standings.map((p) => (
              <li key={p.id} className={`psy-scores__item ${editing ? 'psy-scores__item--edit' : ''}`}>
                <Token color={p.color} photo={photos[p.id]} />
                <span className="psy-scores__name">{p.name}</span>
                {editing ? (
                  <span className="psy-scores__edit">
                    <button type="button" className="psy-icon" aria-label={`Take ${step} from ${p.name}`} disabled={p.score <= 0} onClick={() => send({ type: 'adjust_score', playerId: p.id, delta: -step })}>
                      −
                    </button>
                    <button type="button" className="psy-icon" aria-label={`Give ${step} to ${p.name}`} onClick={() => send({ type: 'adjust_score', playerId: p.id, delta: step })}>
                      +
                    </button>
                  </span>
                ) : (
                  <span className="psy-scores__bar" aria-hidden="true">
                    <span className="psy-scores__fill" style={{ width: `${Math.min(100, (p.score / state.target) * 100)}%`, backgroundColor: p.color }} />
                  </span>
                )}
                <strong className="psy-scores__num">{p.score}</strong>
              </li>
            ))}
          </ul>
        </div>

        <div className="psy-row psy-host">
          {revealing ? (
            <button id="psy-next" type="button" className="psy-btn psy-btn--primary psy-btn--big" onClick={() => send({ type: 'next_turn' })}>
              {state.winners.length ? 'See the winner' : 'Next turn'}
            </button>
          ) : (
            <>
              <button id="psy-skip" type="button" className="psy-btn psy-btn--ghost" onClick={() => send({ type: 'skip' })}>
                Skip {current?.name ?? ''}
              </button>
              {state.phase === 'secret' && (
                <button id="psy-redraw" type="button" className="psy-btn psy-btn--ghost" onClick={() => send({ type: 'redraw' })}>
                  New cards
                </button>
              )}
            </>
          )}
          <ConfirmButton id="psy-end" label="End game" confirmLabel="Really end?" onConfirm={() => send({ type: 'play_again' })} />
        </div>
        <button id="psy-howto-ingame" type="button" className="psy-linkbtn" onClick={onHowTo}>
          📖 How to play
        </button>
        <p className="psy-byline psy-byline--side">Psychological · by Willy Nojopranoto</p>
      </aside>
    </main>
  );
}

function GameOver({ state, photos, send }: { state: PsyState; photos: Photos; send: Send }) {
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const winners = state.winners.map((id) => byId.get(id)).filter(Boolean) as PsyPlayer[];
  const standings = [...state.players].sort((a, b) => b.score - a.score);
  const low = standings.length ? standings[standings.length - 1].score : 0;
  const losers = standings.length > 1 ? standings.filter((p) => p.score === low && !state.winners.includes(p.id)) : [];
  const winnerLine = WINNER_LINES[state.turn % WINNER_LINES.length];
  const loserLine = LOSER_LINES[state.turn % LOSER_LINES.length];
  return (
    <main className="psy-center">
      <div className="psy-panel psy-over">
        <p className="psy-kicker">{winners.length > 1 ? "It's a tie!" : 'Winner'}</p>
        <div className="psy-podium">
          {winners.map((w) => (
            <div key={w.id} className="psy-podium__spot">
              <div className="psy-podium__royal">
                <Crown className="psy-podium__crown" />
                <Pawn color={w.color} photo={photos[w.id]} className="psy-podium__pawn" title={w.name} />
              </div>
              <div className="psy-podium__block">{w.name}</div>
            </div>
          ))}
        </div>
        <p className="psy-sub">{winners.length > 1 ? 'They know each other a little too well.' : winnerLine}</p>
        {losers.length > 0 && (
          <div className="psy-loser">
            <span className="psy-loser__pawns">
              {losers.map((l) => (
                <Pawn key={l.id} color={l.color} photo={photos[l.id]} className="psy-loser__pawn" />
              ))}
            </span>
            <p>
              <strong>{losers.map((l) => l.name).join(' & ')}</strong>
              <span className="psy-muted"> (last place): </span>
              {loserLine}
            </p>
          </div>
        )}
        <ol className="psy-scores psy-scores--final">
          {standings.map((p) => (
            <li key={p.id} className="psy-scores__item">
              <Token color={p.color} photo={photos[p.id]} />
              <span className="psy-scores__name">{p.name}</span>
              <strong className="psy-scores__num">{p.score}</strong>
            </li>
          ))}
        </ol>
        <p className="psy-byline psy-byline--ink">Psychological · by Willy Nojopranoto</p>
        <button id="psy-again" type="button" className="psy-btn psy-btn--primary psy-btn--big" onClick={() => send({ type: 'play_again' })}>
          Play again
        </button>
      </div>
    </main>
  );
}

function Name({ p, photos }: { p: PsyPlayer | undefined; photos: Photos }) {
  if (!p) return <strong>someone</strong>;
  return (
    <strong className="psy-name">
      <Token color={p.color} photo={photos[p.id]} className="psy-name__token" />
      {p.name}
    </strong>
  );
}
