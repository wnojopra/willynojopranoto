import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ensureSession, loadWavelengthFonts, useGameSocket } from '../shared/useGameSocket';
import { Dial } from './Dial';
import { HowToList } from './HowTo';
import {
  BRAND_COLORS,
  cardColors,
  type Photos,
  type WlServerMsg,
  type WlState,
} from './protocol';
import './wavelength.css';

const JOIN_STORAGE_KEY = 'wl-join';
const MAX_RETRIES = 6;

interface SavedJoin {
  code: string;
  name: string;
}

function loadSavedJoin(): SavedJoin | null {
  try {
    const raw = sessionStorage.getItem(JOIN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.code === 'string' && typeof parsed?.name === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function saveJoin(code: string, name: string) {
  try {
    sessionStorage.setItem(JOIN_STORAGE_KEY, JSON.stringify({ code, name }));
  } catch {
    // ignore
  }
}

function vibrate(pattern: number | number[]) {
  try {
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    navigator.vibrate?.(pattern);
  } catch {
    // ignore
  }
}

async function shrinkSelfie(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  ctx.translate(size, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  for (const q of [0.75, 0.6, 0.45, 0.3]) {
    const url = canvas.toDataURL('image/jpeg', q);
    if (url.length <= 24_000) return url;
  }
  return null;
}

export function WavelengthPlay() {
  const urlCode = useMemo(() => {
    const c = new URLSearchParams(location.search).get('code') ?? '';
    return c.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  }, []);

  const initialSaved = useMemo(() => loadSavedJoin(), []);
  const [codeInput, setCodeInput] = useState(urlCode || initialSaved?.code || '');
  const [nameInput, setNameInput] = useState(initialSaved?.name || '');
  const [activeJoin, setActiveJoin] = useState<SavedJoin | null>(() => {
    if (initialSaved && (!urlCode || initialSaved.code === urlCode)) {
      return initialSaved;
    }
    return null;
  });

  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [retries, setRetries] = useState(0);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [state, setState] = useState<WlState | null>(null);
  const [avatars, setAvatars] = useState<Photos>({});
  const [secret, setSecret] = useState<{ round: number; target: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Local UI state
  const [peeking, setPeeking] = useState(true);
  const [clueInput, setClueInput] = useState('');
  const [localAngle, setLocalAngle] = useState(0);
  const [showHowTo, setShowHowTo] = useState(false);
  const [showScores, setShowScores] = useState(false);

  const lastRoundRef = useRef<number>(0);

  useEffect(() => {
    document.title = 'Wavelength — Play';
    loadWavelengthFonts();
    ensureSession().then(() => setReady(true));
  }, []);

  const firstMessage = useMemo(() => {
    if (!activeJoin) return null;
    return JSON.stringify({ type: 'join', code: activeJoin.code, name: activeJoin.name });
  }, [activeJoin]);

  const handleMessage = useCallback((msg: WlServerMsg) => {
    if (msg.type === 'joined') {
      setPlayerId(msg.playerId);
      setError(null);
      setRetries(0);
      vibrate(25);
    } else if (msg.type === 'state') {
      setState(msg);
      if (msg.round !== lastRoundRef.current) {
        lastRoundRef.current = msg.round;
        setLocalAngle(0);
        setClueInput('');
        setPeeking(true);
      } else if (msg.mode !== 'ffa') {
        setLocalAngle(msg.needle);
      }
    } else if (msg.type === 'psychic_secret') {
      setSecret({ round: msg.round, target: msg.target });
    } else if (msg.type === 'avatars') {
      setAvatars(msg.avatars);
    } else if (msg.type === 'action_rejected') {
      setNotice(msg.reason);
      vibrate([25, 40, 25]);
    } else if (msg.type === 'selfie_rejected') {
      setNotice('Could not use that photo. Try another selfie.');
    } else if (msg.type === 'error') {
      setError(msg.message);
      setActiveJoin(null);
    }
  }, []);

  const { status, send } = useGameSocket<WlServerMsg>(
    ready && activeJoin ? '/ws/wavelength/play' : null,
    firstMessage,
    handleMessage,
    attempt,
  );

  // Auto-reconnect
  useEffect(() => {
    if (!activeJoin || status !== 'closed' || error) return;
    if (retries >= MAX_RETRIES) return;
    const delay = Math.min(4000, 500 * 2 ** retries);
    const t = setTimeout(() => {
      setRetries((r) => r + 1);
      setAttempt((a) => a + 1);
    }, delay);
    return () => clearTimeout(t);
  }, [activeJoin, status, error, retries]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3200);
    return () => clearTimeout(t);
  }, [notice]);

  function handleJoinSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanCode = codeInput.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    const cleanName = nameInput.trim().slice(0, 14);
    if (cleanCode.length !== 4 || !cleanName) return;
    setError(null);
    saveJoin(cleanCode, cleanName);
    setActiveJoin({ code: cleanCode, name: cleanName });
    setAttempt((a) => a + 1);
  }

  async function handleSelfieChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await shrinkSelfie(file);
    if (dataUrl) {
      send({ type: 'selfie', data: dataUrl });
    } else {
      setNotice('Could not process that photo.');
    }
  }

  // Not yet joined
  if (!activeJoin || !state || !playerId) {
    return (
      <div className="wl-root">
        <div className="wl-phone-shell">
          <header className="wl-phone-header">
            <a className="wl-brand" href="/">
              <span className="wl-brand-name">Wavelength</span>
              <span className="wl-brand-byline">By Willy Nojopranoto</span>
            </a>
          </header>

          <form className="wl-join-card" onSubmit={handleJoinSubmit}>
            <h1>Join Wavelength</h1>
            <p className="wl-muted">Enter the 4-letter code on the TV screen.</p>

            {error && <div className="wl-alert wl-alert--danger">{error}</div>}

            <label className="wl-field">
              <span>Room Code</span>
              <input
                type="text"
                className="wl-input wl-input--code"
                value={codeInput}
                onChange={(e) =>
                  setCodeInput(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))
                }
                placeholder="BCDF"
                maxLength={4}
                autoCapitalize="characters"
                autoComplete="off"
                required
              />
            </label>

            <label className="wl-field">
              <span>Your Name</span>
              <input
                type="text"
                className="wl-input"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value.slice(0, 14))}
                placeholder="Alex"
                maxLength={14}
                required
              />
            </label>

            <button
              type="submit"
              className="wl-btn wl-btn--primary wl-btn--lg wl-btn--block"
              disabled={codeInput.length !== 4 || !nameInput.trim() || status === 'connecting'}
            >
              {status === 'connecting' ? 'Joining…' : 'Join Game →'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const me = state.players.find((p) => p.id === playerId) ?? null;
  const myTeam = state.teams.find((t) => t.id === me?.teamId) ?? null;
  const activeTeam = state.teams.find((t) => t.id === state.activeTeamId) ?? null;
  const psychic = state.players.find((p) => p.id === state.psychicId) ?? null;
  const isPsychic = state.psychicId === playerId;
  const [cardLeftColor, cardRightColor] = state.card ? cardColors(state.card) : BRAND_COLORS;
  const myPhoto = avatars[playerId];

  const activeTeamMembers =
    state.mode === 'teams' && activeTeam
      ? state.players.filter((p) => p.teamId === activeTeam.id)
      : [];

  const canMoveDial =
    state.phase === 'guessing' &&
    !isPsychic &&
    (state.mode !== 'teams' ||
      me?.teamId === state.activeTeamId ||
      activeTeamMembers.length <= 1);

  const isOpposingInBonus =
    state.phase === 'bonus' &&
    state.mode === 'teams' &&
    me?.teamId !== state.activeTeamId;

  const hasLockedFfa = state.mode === 'ffa' && state.ffaLockedIds.includes(playerId);

  return (
    <div
      className="wl-root"
      style={
        {
          '--wl-team': myTeam?.color ?? me?.color ?? '#ff5d8f',
          '--wl-card-a': cardLeftColor,
          '--wl-card-b': cardRightColor,
        } as React.CSSProperties
      }
    >
      <div className="wl-phone-shell">
        <header className="wl-phone-header">
          <div className="wl-phone-me">
            <span
              className="wl-dot"
              style={{ background: myTeam?.color ?? me?.color ?? '#ff5d8f' }}
            />
            <strong>{me?.name ?? activeJoin.name}</strong>
            <span className="wl-room-pill">{state.code}</span>
          </div>
          <div className="wl-row-gap">
            <button
              type="button"
              className="wl-tb-btn wl-tb-btn--sm"
              onClick={() => setShowScores((s) => !s)}
            >
              🏆 Scores
            </button>
            <button
              type="button"
              className="wl-tb-btn wl-tb-btn--sm"
              onClick={() => setShowHowTo((h) => !h)}
            >
              📖 Rules
            </button>
          </div>
        </header>

        {notice && <div className="wl-alert">{notice}</div>}

        {showScores && (
          <div className="wl-phone-drawer">
            <h3>Scoreboard</h3>
            {state.mode === 'teams' ? (
              <ul className="wl-drawer-scores">
                {state.teams.map((t) => (
                  <li key={t.id}>
                    <span className="wl-dot" style={{ background: t.color }} />
                    <span>{t.name}</span>
                    <strong>{t.score} pts</strong>
                  </li>
                ))}
              </ul>
            ) : state.mode === 'ffa' ? (
              <ul className="wl-drawer-scores">
                {state.players.map((p) => (
                  <li key={p.id}>
                    <span className="wl-dot" style={{ background: p.color }} />
                    <span>{p.name}</span>
                    <strong>{p.score} pts</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                Co-op Score: <strong>{state.coop.score} pts</strong> ({state.coop.cardsRemaining}{' '}
                cards left)
              </p>
            )}
          </div>
        )}

        {showHowTo && (
          <div className="wl-phone-drawer">
            <HowToList bands={state.settings.bands} />
          </div>
        )}

        {/* LOBBY ON PHONE */}
        {state.phase === 'lobby' && (
          <main className="wl-phone-main">
            <div className="wl-phone-card">
              <h2>You’re in the Lobby!</h2>
              <p className="wl-muted">
                Waiting for the host to start on the TV…
              </p>

              {/* Selfie Picker */}
              <div className="wl-selfie-box">
                <div
                  className="wl-selfie-preview"
                  style={{ borderColor: me?.color ?? '#ff5d8f' }}
                >
                  {myPhoto ? (
                    <img src={myPhoto} alt="Your selfie" />
                  ) : (
                    <span>{(me?.name ?? 'P').slice(0, 2).toUpperCase()}</span>
                  )}
                </div>
                <div className="wl-selfie-actions">
                  <label className="wl-btn wl-btn--secondary wl-btn--sm">
                    📷 {myPhoto ? 'Retake Selfie' : 'Add Selfie Pawn'}
                    <input
                      type="file"
                      accept="image/*"
                      capture="user"
                      hidden
                      onChange={handleSelfieChange}
                    />
                  </label>
                  {myPhoto && (
                    <button
                      type="button"
                      className="wl-btn wl-btn--ghost wl-btn--sm"
                      onClick={() => send({ type: 'selfie', data: null })}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              {state.mode === 'teams' && (
                <div className="wl-phone-team-picker">
                  <span className="wl-eyebrow">Your Team (Tap to Switch)</span>
                  <div className="wl-phone-teams-grid">
                    {state.teams.map((t) => {
                      const mine = me?.teamId === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          className={`wl-phone-team-btn ${mine ? 'is-mine' : ''}`}
                          style={{ '--c': t.color } as React.CSSProperties}
                          onClick={() => send({ type: 'set_team', teamId: t.id })}
                        >
                          <span className="wl-dot" />
                          <span>{t.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </main>
        )}

        {/* PSYCHIC PHASE */}
        {state.phase === 'psychic' && (
          <main className="wl-phone-main">
            {isPsychic ? (
              <div className="wl-phone-card">
                <div className="wl-turn-eyebrow">🔮 You are the Psychic!</div>
                <h2>Give One Clue for the Target</h2>
                <p className="wl-muted wl-small">
                  Keep your screen hidden from your teammates!
                </p>

                <Dial
                  idPrefix="wl-play-psychic"
                  isOpen={peeking}
                  targetAngle={secret?.round === state.round ? secret.target : 0}
                  needleAngle={0}
                  showNeedle={false}
                  bands={state.settings.bands}
                  rimColors={[cardLeftColor, cardRightColor]}
                />

                <div className="wl-row-gap wl-center-row">
                  <button
                    type="button"
                    className="wl-btn wl-btn--secondary wl-btn--sm"
                    onClick={() => setPeeking((p) => !p)}
                  >
                    {peeking ? '🙈 Hide Target' : '👁️ Show Target'}
                  </button>
                  <button
                    type="button"
                    className="wl-btn wl-btn--secondary wl-btn--sm"
                    onClick={() => send({ type: 'redraw' })}
                  >
                    🔀 New Card
                  </button>
                </div>

                {state.card && (
                  <div className="wl-card wl-card--compact">
                    <div className="wl-card-inner">
                      <div className="wl-card-side wl-card-left">
                        <span className="wl-card-dir">←</span>
                        <strong>{state.card[0]}</strong>
                      </div>
                      <div className="wl-card-mid">
                        <span className="wl-card-perf" />
                      </div>
                      <div className="wl-card-side wl-card-right">
                        <span className="wl-card-dir">→</span>
                        <strong>{state.card[1]}</strong>
                      </div>
                    </div>
                  </div>
                )}

                <form
                  className="wl-clue-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!clueInput.trim()) return;
                    send({ type: 'clue', clue: clueInput.trim(), spoken: false });
                  }}
                >
                  <input
                    type="text"
                    className="wl-input"
                    placeholder="Type your clue (e.g. Warm soup)…"
                    maxLength={60}
                    value={clueInput}
                    onChange={(e) => setClueInput(e.target.value)}
                  />
                  <button
                    type="submit"
                    className="wl-btn wl-btn--primary wl-btn--lg wl-btn--block"
                    disabled={!clueInput.trim()}
                  >
                    Send Clue to TV →
                  </button>
                  <button
                    type="button"
                    className="wl-btn wl-btn--secondary wl-btn--block"
                    onClick={() => send({ type: 'clue', clue: '', spoken: true })}
                  >
                    🗣️ I Said My Clue Out Loud
                  </button>
                </form>
              </div>
            ) : (
              <div className="wl-phone-card">
                <div className="wl-turn-eyebrow">Round {state.round}</div>
                <h2>{psychic?.name ?? 'The Psychic'} is thinking of a clue…</h2>
                <p className="wl-muted">
                  Look at the spectrum card and get ready to turn the dial!
                </p>
                {state.card && (
                  <div className="wl-card wl-card--compact">
                    <div className="wl-card-inner">
                      <div className="wl-card-side wl-card-left">
                        <span className="wl-card-dir">←</span>
                        <strong>{state.card[0]}</strong>
                      </div>
                      <div className="wl-card-mid">
                        <span className="wl-card-perf" />
                      </div>
                      <div className="wl-card-side wl-card-right">
                        <span className="wl-card-dir">→</span>
                        <strong>{state.card[1]}</strong>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </main>
        )}

        {/* GUESSING PHASE */}
        {state.phase === 'guessing' && (
          <main className="wl-phone-main">
            <div className="wl-phone-card">
              <div className="wl-turn-eyebrow">
                {state.clue ? `Clue: “${state.clue}”` : 'Listen to the Psychic’s Clue'}
              </div>

              {isPsychic ? (
                <>
                  <h2>Keep a Poker Face! 😶</h2>
                  <p className="wl-muted">
                    Watch your teammates debate where your clue lands on the spectrum.
                  </p>
                </>
              ) : canMoveDial ? (
                <>
                  <h2>
                    {hasLockedFfa
                      ? 'Needle Locked In! ✓'
                      : 'Drag the Needle to Your Guess'}
                  </h2>
                  <Dial
                    idPrefix="wl-play-guess"
                    isOpen={false}
                    targetAngle={null}
                    needleAngle={state.mode === 'ffa' ? localAngle : state.needle}
                    showNeedle={true}
                    canDrag={!hasLockedFfa}
                    onAngleChange={(angle) => {
                      setLocalAngle(angle);
                      send({ type: 'aim', angle });
                    }}
                    bands={state.settings.bands}
                    rimColors={[cardLeftColor, cardRightColor]}
                  />

                  {state.card && (
                    <div className="wl-card wl-card--compact">
                      <div className="wl-card-inner">
                        <div className="wl-card-side wl-card-left">
                          <span className="wl-card-dir">←</span>
                          <strong>{state.card[0]}</strong>
                        </div>
                        <div className="wl-card-mid">
                          <span className="wl-card-perf" />
                        </div>
                        <div className="wl-card-side wl-card-right">
                          <span className="wl-card-dir">→</span>
                          <strong>{state.card[1]}</strong>
                        </div>
                      </div>
                    </div>
                  )}

                  {!hasLockedFfa && (
                    <button
                      type="button"
                      className="wl-btn wl-btn--primary wl-btn--lg wl-btn--block"
                      onClick={() => {
                        vibrate(30);
                        send({
                          type: 'lock',
                          angle: state.mode === 'ffa' ? localAngle : state.needle,
                        });
                      }}
                    >
                      🎯 Lock In Dial Guess
                    </button>
                  )}
                </>
              ) : (
                <>
                  <h2>{activeTeam?.name ?? 'The Active Team'} is Guessing…</h2>
                  <p className="wl-muted">
                    Watch the needle on the TV! Next up, your team will vote whether the true target is Left or Right.
                  </p>
                </>
              )}
            </div>
          </main>
        )}

        {/* BONUS LEFT / RIGHT PHASE */}
        {state.phase === 'bonus' && (
          <main className="wl-phone-main">
            <div className="wl-phone-card">
              <div className="wl-turn-eyebrow">Left / Right Bonus (+1 pt)</div>
              {isOpposingInBonus ? (
                <>
                  <h2>Where is the Bullseye Center?</h2>
                  <p className="wl-muted">
                    Is the true target center to the <strong>Left</strong> or <strong>Right</strong> of {activeTeam?.name ?? 'their'} needle?
                  </p>
                  <div className="wl-bonus-btns">
                    <button
                      type="button"
                      className="wl-btn wl-btn--primary wl-btn--lg"
                      onClick={() => {
                        vibrate(25);
                        send({ type: 'bonus', direction: 'left' });
                      }}
                    >
                      ◀ Left of Needle
                    </button>
                    <button
                      type="button"
                      className="wl-btn wl-btn--primary wl-btn--lg"
                      onClick={() => {
                        vibrate(25);
                        send({ type: 'bonus', direction: 'right' });
                      }}
                    >
                      Right of Needle ▶
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h2>Opposing Team is Voting…</h2>
                  <p className="wl-muted">
                    They are guessing whether the target is Left or Right of your needle!
                  </p>
                </>
              )}
            </div>
          </main>
        )}

        {/* REVEAL & GAMEOVER ON PHONE */}
        {(state.phase === 'reveal' || state.phase === 'gameover') && (
          <main className="wl-phone-main">
            <div className="wl-phone-card">
              <div className="wl-turn-eyebrow">
                {state.phase === 'gameover' ? 'Game Over!' : `Round ${state.round} Result`}
              </div>
              <h2>Check the TV Screen! 📺</h2>
              {state.reveal && (
                <p className="wl-muted">
                  {state.reveal.bullseye
                    ? '🎯 BULLSEYE!'
                    : state.mode === 'ffa'
                      ? `You scored +${state.reveal.playerPoints?.[playerId] ?? (isPsychic ? state.reveal.psychicPoints ?? 0 : 0)} pts!`
                      : `+${state.reveal.points ?? 0} points scored!`}
                </p>
              )}
            </div>
          </main>
        )}
      </div>
    </div>
  );
}
