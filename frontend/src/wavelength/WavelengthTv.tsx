import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QrCode } from '../shared/QrCode';
import { ensureSession, loadWavelengthFonts, useGameSocket } from '../shared/useGameSocket';
import { installWlWakeOnGesture, useWlAudioState, wlSound } from './audio';
import { DeckModal, loadSavedCustomCards } from './DeckModal';
import { Dial, type ExtraNeedle } from './Dial';
import { HowToOverlay } from './HowTo';
import {
  BRAND_COLORS,
  cardColors,
  scoreBannerText,
  type Photos,
  type WlMode,
  type WlServerMsg,
  type WlState,
} from './protocol';
import './wavelength.css';

const TV_ROOM_KEY = 'wl-tv-room';
const MAX_RETRIES = 6;
const BIG_ROOM = 10;

function savedRoom(): string | null {
  try {
    return sessionStorage.getItem(TV_ROOM_KEY);
  } catch {
    return null;
  }
}

function saveRoom(code: string | null) {
  try {
    if (code) sessionStorage.setItem(TV_ROOM_KEY, code);
    else sessionStorage.removeItem(TV_ROOM_KEY);
  } catch {
    // ignore
  }
}

function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className = 'wl-btn wl-btn--ghost wl-btn--sm',
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <button
      type="button"
      className={`${className} ${armed ? 'wl-btn--danger' : ''}`}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

/** Floating sound toggle in top-left corner, matching Spirit Board's SoundBar. */
function SoundBar() {
  useWlAudioState();
  return (
    <div className="wl-soundbar">
      {wlSound.soundOn && !wlSound.awake && (
        <button
          type="button"
          className="wl-soundbar__hint"
          onClick={() => wlSound.wake()}
        >
          🔈 Click anywhere for sound
        </button>
      )}
      <button
        type="button"
        className="wl-soundbar__btn"
        aria-pressed={wlSound.soundOn}
        aria-label={wlSound.soundOn ? 'Sound on' : 'Sound off'}
        title={wlSound.soundOn ? 'Mute sound effects' : 'Unmute sound effects'}
        onClick={() => {
          wlSound.wake();
          wlSound.setSound(!wlSound.soundOn);
        }}
      >
        {wlSound.soundOn ? '🔊' : '🔇'}
      </button>
    </div>
  );
}

export function WavelengthTv() {
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [retries, setRetries] = useState(0);
  const [state, setState] = useState<WlState | null>(null);
  const [avatars, setAvatars] = useState<Photos>({});
  const [error, setError] = useState<string | null>(null);

  const [showHowTo, setShowHowTo] = useState(false);
  const [showDeckModal, setShowDeckModal] = useState(false);
  const [editingScores, setEditingScores] = useState(false);
  const [customCards, setCustomCards] = useState<[string, string][]>(() => loadSavedCustomCards());

  // Pass-and-play TV peek support
  const [tvSecret, setTvSecret] = useState<{ round: number; target: number } | null>(null);
  const [tvPeeking, setTvPeeking] = useState(false);
  const [tvClueInput, setTvClueInput] = useState('');

  // Suspense pause when entering reveal phase
  const [suspense, setSuspense] = useState(false);
  const lastPhaseRef = useRef<string | null>(null);

  useEffect(() => {
    document.title = 'Wavelength — TV Host';
    loadWavelengthFonts();
    installWlWakeOnGesture();
    ensureSession().then(() => setReady(true));
  }, []);

  const firstMessage = useMemo(
    () => JSON.stringify({ type: 'create', resume: savedRoom() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attempt],
  );

  const handleMessage = useCallback((msg: WlServerMsg) => {
    if (msg.type === 'created') {
      saveRoom(msg.code);
      setError(null);
      setRetries(0);
    } else if (msg.type === 'state') {
      setState(msg);
      setError(null);
    } else if (msg.type === 'avatars') {
      setAvatars(msg.avatars);
    } else if (msg.type === 'psychic_secret') {
      setTvSecret({ round: msg.round, target: msg.target });
      setTvPeeking(true);
    } else if (msg.type === 'error') {
      setError(msg.message);
    }
  }, []);

  const { status, send } = useGameSocket<WlServerMsg>(
    ready ? '/ws/wavelength/tv' : null,
    firstMessage,
    handleMessage,
    attempt,
  );

  const syncedCustomRef = useRef(false);
  useEffect(() => {
    if (status === 'open' && !syncedCustomRef.current && customCards.length > 0) {
      syncedCustomRef.current = true;
      send({ type: 'custom_deck', cards: customCards, replacePacks: false });
    }
  }, [status, customCards, send]);

  // Auto-reconnect on unexpected close
  useEffect(() => {
    if (status !== 'closed' || error) return;
    if (retries >= MAX_RETRIES) return;
    const delay = Math.min(4000, 500 * 2 ** retries);
    const t = setTimeout(() => {
      setRetries((r) => r + 1);
      setAttempt((a) => a + 1);
    }, delay);
    return () => clearTimeout(t);
  }, [status, error, retries]);

  // Phase transition sound & reveal suspense
  useEffect(() => {
    if (!state) return;
    const prev = lastPhaseRef.current;
    lastPhaseRef.current = `${state.phase}:${state.round}`;

    if (state.phase !== 'psychic') {
      setTvPeeking(false);
    }

    if (prev && prev !== `${state.phase}:${state.round}`) {
      if (state.phase === 'guessing') {
        wlSound.shutter(false);
      } else if (state.phase === 'reveal' && state.reveal) {
        setSuspense(true);
        wlSound.shutter(true);
        wlSound.drumroll();
        const pts =
          state.mode === 'ffa'
            ? Math.max(0, ...Object.values(state.reveal.playerPoints ?? {}))
            : (state.reveal.points ?? 0);
        const bull = state.reveal.bullseye;
        const timer = setTimeout(() => {
          setSuspense(false);
          wlSound.revealScore(pts, bull);
        }, 850);
        return () => clearTimeout(timer);
      }
    }
  }, [state]);

  if (error) {
    return (
      <div className="wl-root">
        <div className="wl-center-box">
          <h2>Signal Interrupted</h2>
          <p className="wl-muted">{error}</p>
          <button
            type="button"
            className="wl-btn wl-btn--primary"
            onClick={() => {
              setError(null);
              setRetries(0);
              setAttempt((a) => a + 1);
            }}
          >
            Reconnect
          </button>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="wl-root">
        <div className="wl-center-box">
          <p className="wl-muted">Tuning into Wavelength…</p>
        </div>
      </div>
    );
  }

  const joinDisplayUrl = `${location.host}/wavelength/play`;
  const joinQrUrl = `${location.origin}/wavelength/play?code=${state.code}`;
  const activeTeam = state.teams.find((t) => t.id === state.activeTeamId) ?? state.teams[0];
  const psychic = state.players.find((p) => p.id === state.psychicId) ?? null;
  const [cardLeftColor, cardRightColor] = state.card ? cardColors(state.card) : BRAND_COLORS;
  const accentColor =
    state.mode === 'teams' && activeTeam
      ? activeTeam.color
      : psychic
        ? psychic.color
        : '#f26430';

  const botsCount = state.players.filter((p) => p.isBot).length;
  const needed = Math.max(0, state.minPlayers - state.players.length);

  // Build extra needles for Free-for-All reveal
  const extraNeedles: ExtraNeedle[] = [];
  if (state.mode === 'ffa' && state.phase === 'reveal' && state.reveal?.guesses) {
    for (const p of state.players) {
      if (p.id === state.psychicId) continue;
      const ang = state.reveal.guesses[p.id];
      if (typeof ang === 'number') {
        extraNeedles.push({
          id: p.id,
          name: p.name,
          color: p.color,
          angle: ang,
          avatarUrl: avatars[p.id],
        });
      }
    }
  }

  const visibleTarget =
    state.phase === 'reveal' && state.reveal
      ? state.reveal.target
      : state.phase === 'psychic' && tvPeeking && tvSecret?.round === state.round
        ? tvSecret.target
        : null;

  const isDialOpen =
    state.phase === 'reveal' ||
    (state.phase === 'psychic' && tvPeeking && tvSecret?.round === state.round);

  return (
    <div
      className="wl-root"
      style={
        {
          '--wl-team': accentColor,
          '--wl-card-a': cardLeftColor,
          '--wl-card-b': cardRightColor,
        } as React.CSSProperties
      }
    >
      <SoundBar />

      {/* ====================================================================
         LOBBY PHASE (Modeled directly after Spirit Board's uncluttered layout)
         ==================================================================== */}
      {state.phase === 'lobby' && (
        <main className="wl-lobby">
          <header className="wl-lobby__head">
            <div className="wl-spectrum-ribbon" aria-hidden="true" />
            <h1 className="wl-tv-title">
              Wavelength <span className="wl-byline">By Willy Nojopranoto</span>
            </h1>
            <p className="wl-tv-sub">Grab your phone. Tune into the same frequency.</p>
          </header>

          {/* Left Column: Scan QR & Big Room Code */}
          <section className="wl-lobby__join" aria-label="How to join">
            <div className="wl-lobby__scan">
              <QrCode
                value={joinQrUrl}
                className="wl-lobby__qr"
                label={`QR code to join room ${state.code}`}
              />
              <p className="wl-lobby__step">Scan to join</p>
            </div>
            <div className="wl-lobby__manual">
              <p className="wl-lobby__step">
                or go to <strong className="wl-lobby__url">{joinDisplayUrl}</strong>
              </p>
              <p className="wl-lobby__step">and enter the code</p>
              <p className="wl-lobby__code" aria-label={`Room code ${state.code.split('').join(' ')}`}>
                {state.code}
              </p>
            </div>
          </section>

          {/* Right Column: Players Roster */}
          <section className="wl-lobby__players" aria-label="Players">
            <div className="wl-lobby__players-head">
              <h2 className="wl-lobby__count">
                {state.players.length} / 16 telepaths tuned in
              </h2>
              {state.mode === 'teams' && state.players.length >= 2 && (
                <button
                  type="button"
                  className="wl-btn wl-btn--ghost wl-btn--sm"
                  onClick={() => send({ type: 'shuffle_teams' })}
                >
                  🔀 Shuffle teams
                </button>
              )}
            </div>

            {state.mode === 'teams' ? (
              <div className="wl-team-columns">
                {state.teams.map((t, tIdx) => {
                  const members = state.players.filter((p) => p.teamId === t.id);
                  const nextTeam = state.teams[(tIdx + 1) % state.teams.length];
                  return (
                    <div
                      key={t.id}
                      className="wl-team-col"
                      style={{ '--c': t.color } as React.CSSProperties}
                    >
                      <header className="wl-team-col__head">
                        <span className="wl-dot" />
                        <input
                          type="text"
                          className="wl-team-col__title"
                          value={t.name}
                          maxLength={20}
                          aria-label="Team name"
                          onChange={(e) =>
                            send({ type: 'rename_team', teamId: t.id, name: e.target.value })
                          }
                        />
                        <span className="wl-team-col__badge">{members.length}</span>
                      </header>
                      <ul className="wl-team-col__list">
                        {members.map((p) => (
                          <li
                            key={p.id}
                            className="wl-roster__item"
                            data-offline={p.connected ? undefined : ''}
                          >
                            <span
                              className="wl-roster__avatar"
                              style={{ backgroundColor: p.color }}
                            >
                              {avatars[p.id] ? (
                                <img src={avatars[p.id]} alt="" />
                              ) : (
                                p.name.slice(0, 2).toUpperCase()
                              )}
                            </span>
                            <span className="wl-roster__name" title={p.name}>
                              {p.name}
                            </span>
                            {p.isBot && <span className="wl-roster__tag">bot</span>}
                            {!p.connected && <span className="wl-roster__tag">away</span>}
                            {nextTeam && (
                              <button
                                type="button"
                                className="wl-roster__swap"
                                title={`Move ${p.name} to ${nextTeam.name}`}
                                aria-label={`Move ${p.name} to ${nextTeam.name}`}
                                onClick={() =>
                                  send({ type: 'set_team', playerId: p.id, teamId: nextTeam.id })
                                }
                              >
                                ⇄
                              </button>
                            )}
                            <button
                              type="button"
                              className="wl-roster__kick"
                              aria-label={`Remove ${p.name}`}
                              onClick={() => send({ type: 'kick', playerId: p.id })}
                            >
                              ×
                            </button>
                          </li>
                        ))}
                        {members.length === 0 && (
                          <li className="wl-team-col__empty">No players yet</li>
                        )}
                      </ul>
                    </div>
                  );
                })}
              </div>
            ) : (
              <ul
                className="wl-roster"
                data-many={state.players.length > BIG_ROOM ? '' : undefined}
              >
                {state.players.map((p) => (
                  <li
                    key={p.id}
                    className="wl-roster__item"
                    data-offline={p.connected ? undefined : ''}
                  >
                    <span className="wl-roster__avatar" style={{ backgroundColor: p.color }}>
                      {avatars[p.id] ? (
                        <img src={avatars[p.id]} alt="" />
                      ) : (
                        p.name.slice(0, 2).toUpperCase()
                      )}
                    </span>
                    <span className="wl-roster__name" title={p.name}>
                      {p.name}
                    </span>
                    {p.isBot && <span className="wl-roster__tag">bot</span>}
                    {!p.connected && <span className="wl-roster__tag">away</span>}
                    <button
                      type="button"
                      className="wl-roster__kick"
                      aria-label={`Remove ${p.name}`}
                      onClick={() => send({ type: 'kick', playerId: p.id })}
                    >
                      ×
                    </button>
                  </li>
                ))}
                {state.players.length === 0 && (
                  <li className="wl-roster__empty">Waiting for the first telepath to join…</li>
                )}
              </ul>
            )}
          </section>

          {/* Bottom Controls Bar (Left: Bots | Center: Big Start CTA | Right: Compact Segmented Mode + Toggles) */}
          <footer className="wl-lobby__controls">
            <div className="wl-lobby__dev">
              <button
                id="wl-add-bot"
                type="button"
                className="wl-btn wl-btn--ghost"
                disabled={state.players.length >= 16}
                onClick={() => send({ type: 'add_bot' })}
              >
                + Add a bot
              </button>
              <button
                id="wl-remove-bot"
                type="button"
                className="wl-btn wl-btn--ghost"
                disabled={botsCount === 0}
                onClick={() => send({ type: 'remove_bot' })}
              >
                − Remove a bot
              </button>
            </div>

            <div className="wl-lobby__start">
              <button
                id="wl-start"
                type="button"
                className="wl-btn wl-btn--primary wl-btn--big"
                disabled={!state.canStart}
                onClick={() => send({ type: 'start' })}
              >
                Begin Wavelength
              </button>
              <button
                id="wl-howto"
                type="button"
                className="wl-btn wl-btn--ghost"
                onClick={() => setShowHowTo(true)}
              >
                📖 How to play
              </button>
              <a id="wl-to-phone" className="wl-btn wl-btn--ghost" href={`/wavelength/play?code=${state.code}`}>
                📱 Join on this device
              </a>
              {needed > 0 && (
                <p className="wl-lobby__hint">
                  Need {needed} more {needed === 1 ? 'player' : 'players'} to begin.
                </p>
              )}
            </div>

            <div className="wl-lobby__settings">
              <div className="wl-seg" role="radiogroup" aria-label="Game mode">
                {(
                  [
                    { id: 'teams', name: 'Teams', sub: 'Left vs Right' },
                    { id: 'ffa', name: 'Free-for-All', sub: 'Solo needles' },
                    { id: 'coop', name: 'Co-op', sub: '7 cards' },
                  ] as { id: WlMode; name: string; sub: string }[]
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="wl-seg__btn"
                    role="radio"
                    aria-checked={state.mode === m.id}
                    onClick={() => send({ type: 'set_mode', mode: m.id })}
                  >
                    <span className="wl-seg__name">{m.name}</span>
                    <span className="wl-seg__sub">{m.sub}</span>
                  </button>
                ))}
              </div>

              {state.mode !== 'coop' && (
                <button
                  type="button"
                  className="wl-btn wl-btn--ghost wl-lobby__toggle"
                  onClick={() => {
                    const targets = [10, 15, 20, 7];
                    const curIdx = targets.indexOf(state.settings.targetScore);
                    const nextTarget = targets[(curIdx + 1) % targets.length];
                    send({ type: 'set_target', target: nextTarget });
                  }}
                  title="Click to cycle winning target score"
                >
                  🏆 First to {state.settings.targetScore} pts
                </button>
              )}

              {state.mode === 'teams' && (
                <button
                  type="button"
                  className="wl-btn wl-btn--ghost wl-lobby__toggle"
                  aria-pressed={state.settings.leftRightBonus}
                  onClick={() =>
                    send({ type: 'set_left_right', on: !state.settings.leftRightBonus })
                  }
                >
                  ◀▶ Left/Right bonus {state.settings.leftRightBonus ? 'on' : 'off'}
                </button>
              )}

              <button
                type="button"
                className="wl-btn wl-btn--ghost wl-lobby__toggle"
                onClick={() => setShowDeckModal(true)}
              >
                🗂️ Decks ({state.settings.deckSize} cards)
              </button>
            </div>
          </footer>
        </main>
      )}

      {/* ====================================================================
         ACTIVE GAMEPLAY & GAMEOVER
         ==================================================================== */}
      {state.phase !== 'lobby' && (
        <div className="wl-tv-shell">
          <header className="wl-topbar">
            <div className="wl-brand-group">
              <a className="wl-brand" href="/">
                <span className="wl-brand-name">Wavelength</span>
                <span className="wl-brand-byline">By Willy Nojopranoto</span>
              </a>
              <span className="wl-room-pill" title="Join at /wavelength/play">
                CODE: <strong>{state.code}</strong>
              </span>
            </div>

            <nav className="wl-topbar-actions" aria-label="Host controls">
              <button
                type="button"
                className="wl-tb-btn"
                onClick={() => setShowDeckModal(true)}
              >
                🗂️ Deck <span className="wl-tb-badge">{state.settings.deckSize}</span>
              </button>
              <button
                type="button"
                className={`wl-tb-btn ${editingScores ? 'is-active' : ''}`}
                onClick={() => setEditingScores((e) => !e)}
              >
                ✎ Scores
              </button>
              <button
                type="button"
                className="wl-tb-btn"
                onClick={() => setShowHowTo(true)}
              >
                📖 Rules
              </button>
              <button
                type="button"
                className="wl-tb-btn"
                onClick={() => send({ type: 'skip' })}
                title="Skip current step"
              >
                ⏭ Skip
              </button>
              <ConfirmButton
                label="↺ Lobby"
                confirmLabel="End Game?"
                className="wl-tb-btn"
                onConfirm={() => send({ type: 'play_again' })}
              />
            </nav>
          </header>

          <main className="wl-stage">
            {/* Scoreboard */}
            <section className="wl-scoreboard" aria-label="Scoreboard">
              {state.mode === 'teams' &&
                state.teams.map((t) => {
                  const isCurrent = t.id === state.activeTeamId;
                  const ptsEarned =
                    state.phase === 'reveal' && state.reveal?.teamId === t.id
                      ? (state.reveal.points ?? 0)
                      : 0;
                  const shownScore =
                    suspense && isCurrent ? Math.max(0, t.score - ptsEarned) : t.score;
                  return (
                    <div
                      key={t.id}
                      className={`wl-team-chip ${isCurrent ? 'is-current' : ''}`}
                      style={{ '--c': t.color } as React.CSSProperties}
                    >
                      <span className="wl-dot" />
                      <span className="wl-chip-name">{t.name}</span>
                      <span className="wl-chip-pts">{shownScore}</span>
                      {editingScores && (
                        <span className="wl-chip-edit">
                          <button
                            type="button"
                            onClick={() =>
                              send({ type: 'adjust_score', targetId: t.id, delta: -1 })
                            }
                          >
                            −
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              send({ type: 'adjust_score', targetId: t.id, delta: 1 })
                            }
                          >
                            +
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })}

              {state.mode === 'ffa' &&
                state.players.map((p) => {
                  const isPsychic = p.id === state.psychicId;
                  const locked = state.ffaLockedIds.includes(p.id);
                  return (
                    <div
                      key={p.id}
                      className={`wl-team-chip ${isPsychic ? 'is-current' : ''}`}
                      style={{ '--c': p.color } as React.CSSProperties}
                    >
                      <span className="wl-dot" />
                      <span className="wl-chip-name">
                        {isPsychic ? '🔮 ' : locked ? '✓ ' : ''}
                        {p.name}
                      </span>
                      <span className="wl-chip-pts">{p.score}</span>
                      {editingScores && (
                        <span className="wl-chip-edit">
                          <button
                            type="button"
                            onClick={() =>
                              send({ type: 'adjust_score', targetId: p.id, delta: -1 })
                            }
                          >
                            −
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              send({ type: 'adjust_score', targetId: p.id, delta: 1 })
                            }
                          >
                            +
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })}

              {state.mode === 'coop' && (
                <div className="wl-coop-bar">
                  <div className="wl-team-chip is-current" style={{ '--c': '#82d682' } as React.CSSProperties}>
                    <span className="wl-dot" />
                    <span className="wl-chip-name">Team Score</span>
                    <span className="wl-chip-pts">{state.coop.score}</span>
                    {editingScores && (
                      <span className="wl-chip-edit">
                        <button
                          type="button"
                          onClick={() =>
                            send({ type: 'adjust_score', targetId: 'coop', delta: -1 })
                          }
                        >
                          −
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            send({ type: 'adjust_score', targetId: 'coop', delta: 1 })
                          }
                        >
                          +
                        </button>
                      </span>
                    )}
                  </div>
                  <div className="wl-team-chip" style={{ '--c': '#f7c942' } as React.CSSProperties}>
                    <span>🃏 Cards Left:</span>
                    <span className="wl-chip-pts">{state.coop.cardsRemaining}</span>
                  </div>
                </div>
              )}
            </section>

            {/* Turn Banner */}
            <section className="wl-turn" aria-live="polite">
              {state.phase === 'psychic' && (
                <>
                  <div className="wl-turn-eyebrow">
                    Round {state.round} · {activeTeam && state.mode === 'teams' ? `${activeTeam.name} · ` : ''}
                    Psychic: {psychic?.name ?? 'Psychic'}
                  </div>
                  <h1 className="wl-turn-title">
                    {psychic?.name ?? 'The Psychic'} is choosing a clue…
                  </h1>
                  <p className="wl-turn-hint">
                    {psychic?.name ?? 'Psychic'}, check your phone to see the hidden target and give one clue between the two ends!
                  </p>
                </>
              )}

              {state.phase === 'guessing' && (
                <>
                  <div className="wl-turn-eyebrow">
                    Round {state.round} · {state.mode === 'teams' && activeTeam ? `${activeTeam.name} Guessing` : 'Turn the Dial'}
                  </div>
                  <h1 className="wl-turn-title">
                    {state.clue ? (
                      <>
                        Clue: <span className="wl-hl">“{state.clue}”</span>
                      </>
                    ) : (
                      'Where does the clue land?'
                    )}
                  </h1>
                  <p className="wl-turn-hint">
                    {state.mode === 'ffa'
                      ? `Everyone lock in your needle on your phone (${state.ffaLockedIds.length}/${Math.max(0, state.players.length - 1)} locked in)`
                      : 'Debate where the clue sits and drag the red pointer on your phones (or right here on the TV)!'}
                  </p>
                </>
              )}

              {state.phase === 'bonus' && (
                <>
                  <div className="wl-turn-eyebrow">
                    Left / Right Bonus Vote
                  </div>
                  <h1 className="wl-turn-title">
                    Is the true target <span className="wl-hl">◀ Left</span> or <span className="wl-hl">Right ▶</span> of the needle?
                  </h1>
                  <p className="wl-turn-hint">
                    Opposing team: vote on your phones for +1 bonus point!
                  </p>
                </>
              )}

              {state.phase === 'reveal' && state.reveal && (
                <>
                  <div className="wl-turn-eyebrow">
                    Round {state.round} Reveal {state.clue ? `· “${state.clue}”` : ''}
                  </div>
                  {suspense ? (
                    <>
                      <h1 className="wl-turn-title">And the target is…</h1>
                      <p className="wl-turn-hint">&nbsp;</p>
                    </>
                  ) : state.mode === 'ffa' ? (
                    <>
                      <h1 className="wl-turn-title">
                        {state.reveal.bullseye ? (
                          <>
                            <span className="wl-hl">Bullseye!</span> Mind Readers!
                          </>
                        ) : (
                          'Target Revealed!'
                        )}
                      </h1>
                      <p className="wl-turn-hint">
                        {psychic?.name ?? 'Psychic'} earned +{state.reveal.psychicPoints ?? 0} Psychic bonus pts!
                      </p>
                    </>
                  ) : (
                    <>
                      <h1 className="wl-turn-title">
                        {(state.reveal.points ?? 0) > 0 ? (
                          <>
                            <span className="wl-hl">+{state.reveal.points}</span>{' '}
                            {scoreBannerText(state.reveal.points ?? 0, state.reveal.bullseye)}
                          </>
                        ) : (
                          scoreBannerText(0, false)
                        )}
                      </h1>
                      <p className="wl-turn-hint">
                        {state.mode === 'teams' && activeTeam && (
                          <>
                            {activeTeam.name} now has {activeTeam.score} pts.
                            {Object.entries(state.reveal.bonusPoints ?? {}).map(([tid, bpts]) => {
                              if (!bpts) return null;
                              const bt = state.teams.find((t) => t.id === tid);
                              return bt ? ` · ${bt.name} +1 Left/Right bonus!` : null;
                            })}
                            {state.reveal.extraTurn ? ' · 🔥 Catch-up Bullseye: Extra Turn!' : ''}
                          </>
                        )}
                        {state.mode === 'coop' && (
                          <>
                            Team total: {state.coop.score} pts
                            {state.reveal.bonusCard ? ' · 🎯 Bullseye! +1 Bonus Card earned!' : ''}
                          </>
                        )}
                      </p>
                    </>
                  )}
                </>
              )}

              {state.phase === 'gameover' && (
                <>
                  <div className="wl-turn-eyebrow">Game Over</div>
                  {state.mode === 'coop' && state.coop.rating ? (
                    <>
                      <h1 className="wl-turn-title">
                        {state.coop.rating.emoji} {state.coop.rating.tier} ({state.coop.score} pts)
                      </h1>
                      <p className="wl-turn-hint">{state.coop.rating.verdict}</p>
                    </>
                  ) : (
                    <>
                      <h1 className="wl-turn-title">
                        🏆{' '}
                        {state.mode === 'teams'
                          ? state.teams
                              .filter((t) => state.winners.includes(t.id))
                              .map((t) => t.name)
                              .join(' & ')
                          : state.players
                              .filter((p) => state.winners.includes(p.id))
                              .map((p) => p.name)
                              .join(' & ')}{' '}
                        Wins!
                      </h1>
                      <p className="wl-turn-hint">
                        Tuned into the exact same frequency!
                      </p>
                    </>
                  )}
                </>
              )}
            </section>

            {/* Central SVG Semicircle Dial */}
            <section className={`wl-dial-wrap ${!suspense && state.phase === 'reveal' && state.reveal?.bullseye ? 'wl-dial-wrap--bullseye' : ''}`}>
              <Dial
                idPrefix="wl-tv-dial"
                isOpen={isDialOpen}
                targetAngle={visibleTarget}
                needleAngle={state.needle}
                showNeedle={
                  state.mode !== 'ffa' &&
                  (state.phase === 'guessing' || state.phase === 'bonus' || state.phase === 'reveal')
                }
                canDrag={state.phase === 'guessing' && state.mode !== 'ffa'}
                onAngleChange={(angle) => {
                  wlSound.tickForAngle(angle);
                  send({ type: 'aim', angle });
                }}
                bands={state.settings.bands}
                rimColors={[cardLeftColor, cardRightColor]}
                hubColor="#d62828"
                extraNeedles={extraNeedles}
              />

              {!suspense && state.phase === 'reveal' && state.reveal?.bullseye && (
                <div className="wl-bullseye-badge" aria-live="polite">
                  🎯 4 PTS · BULLSEYE!
                </div>
              )}
            </section>

            {/* Spectrum Card */}
            {state.card && (
              <section className="wl-card" aria-label="Spectrum card">
                <div className="wl-card-inner">
                  <div className="wl-card-side wl-card-left">
                    <span className="wl-card-dir">←</span>
                    <strong>{state.card[0]}</strong>
                  </div>
                  <div className="wl-card-mid" aria-hidden="true">
                    <span className="wl-card-perf" />
                  </div>
                  <div className="wl-card-side wl-card-right">
                    <span className="wl-card-dir">→</span>
                    <strong>{state.card[1]}</strong>
                  </div>
                </div>
              </section>
            )}

            {/* Host / Pass-and-Play Action Bar */}
            <section className="wl-actions">
              {state.phase === 'psychic' && (
                <div className="wl-tv-psychic-controls">
                  <div className="wl-row-gap">
                    <button
                      type="button"
                      className="wl-btn wl-btn--secondary"
                      onClick={() => send({ type: 'redraw' })}
                    >
                      🔀 New Card
                    </button>
                    <button
                      type="button"
                      className="wl-btn wl-btn--secondary"
                      onClick={() => {
                        if (tvPeeking) {
                          setTvPeeking(false);
                        } else {
                          send({ type: 'tv_peek' });
                        }
                      }}
                    >
                      {tvPeeking ? '🙈 Hide Target on TV' : '👁️ Peek on TV (Pass-and-Play)'}
                    </button>
                    <button
                      type="button"
                      className="wl-btn wl-btn--primary"
                      onClick={() => {
                        setTvPeeking(false);
                        send({
                          type: 'clue',
                          clue: tvClueInput.trim(),
                          spoken: !tvClueInput.trim(),
                        });
                        setTvClueInput('');
                      }}
                    >
                      🗣️ Clue Given — Start Guessing →
                    </button>
                  </div>
                </div>
              )}

              {state.phase === 'guessing' && (
                <button
                  type="button"
                  className="wl-btn wl-btn--primary wl-btn--lg"
                  onClick={() => send({ type: 'lock', angle: state.needle })}
                >
                  🎯 Lock In &amp; Reveal
                </button>
              )}

              {state.phase === 'bonus' && (
                <div className="wl-row-gap">
                  <button
                    type="button"
                    className="wl-btn wl-btn--secondary wl-btn--lg"
                    onClick={() => send({ type: 'bonus', direction: 'left' })}
                  >
                    ◀ Target is Left
                  </button>
                  <button
                    type="button"
                    className="wl-btn wl-btn--secondary wl-btn--lg"
                    onClick={() => send({ type: 'bonus', direction: 'right' })}
                  >
                    Target is Right ▶
                  </button>
                  <button
                    type="button"
                    className="wl-btn wl-btn--ghost"
                    onClick={() => send({ type: 'skip' })}
                  >
                    Skip Bonus →
                  </button>
                </div>
              )}

              {state.phase === 'reveal' && (
                <button
                  type="button"
                  className="wl-btn wl-btn--primary wl-btn--lg"
                  disabled={suspense}
                  onClick={() => send({ type: 'next_turn' })}
                >
                  Next Round →
                </button>
              )}

              {state.phase === 'gameover' && (
                <button
                  type="button"
                  className="wl-btn wl-btn--primary wl-btn--lg"
                  onClick={() => send({ type: 'play_again' })}
                >
                  Play Again →
                </button>
              )}
            </section>
          </main>
        </div>
      )}

      {showHowTo && (
        <HowToOverlay
          bands={state.settings.bands}
          onClose={() => setShowHowTo(false)}
        />
      )}

      {showDeckModal && (
        <DeckModal
          decks={state.decks}
          settings={state.settings}
          customCards={customCards}
          onTogglePack={(pack) => send({ type: 'toggle_pack', pack })}
          onUpdateCustomCards={(cards, replacePacks) => {
            setCustomCards(cards);
            send({ type: 'custom_deck', cards, replacePacks });
          }}
          onClose={() => setShowDeckModal(false)}
        />
      )}
    </div>
  );
}
