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
  type WlServerMsg,
  type WlState,
} from './protocol';
import './wavelength.css';

const TV_ROOM_KEY = 'wl-tv-room';
const MAX_RETRIES = 6;

function savedRoom(): string | null {
  try {
    return sessionStorage.getItem(TV_ROOM_KEY);
  } catch {
    return null;
  }
}

function saveRoom(code: string) {
  try {
    sessionStorage.setItem(TV_ROOM_KEY, code);
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

  // Suspense pause when entering reveal phase (like mikeck1's 850ms shutter open)
  const [suspense, setSuspense] = useState(false);
  const lastPhaseRef = useRef<string | null>(null);

  useWlAudioState();

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

  // Sync saved custom cards once room is created
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
          <h2>Connection Issue</h2>
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
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="wl-root">
        <div className="wl-center-box">
          <div className="wl-spinner" />
          <p className="wl-muted">Tuning into Wavelength…</p>
        </div>
      </div>
    );
  }

  const joinUrl = `${location.origin}/wavelength/play?code=${state.code}`;
  const activeTeam = state.teams.find((t) => t.id === state.activeTeamId) ?? state.teams[0];
  const psychic = state.players.find((p) => p.id === state.psychicId) ?? null;
  const [cardLeftColor, cardRightColor] = state.card ? cardColors(state.card) : BRAND_COLORS;
  const accentColor =
    state.mode === 'teams' && activeTeam
      ? activeTeam.color
      : psychic
        ? psychic.color
        : '#ff5d8f';

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
      <div className="wl-tv-shell">
        {/* Top Bar */}
        <header className="wl-topbar">
          <div className="wl-brand-group">
            <a className="wl-brand" href="/">
              <span className="wl-brand-mark" aria-hidden="true">
                〰️
              </span>
              <span className="wl-brand-name">Wavelength</span>
            </a>
            <span className="wl-room-pill" title="Join at /wavelength/play">
              CODE: <strong>{state.code}</strong>
            </span>
          </div>

          <nav className="wl-topbar-actions" aria-label="Host controls">
            {!wlSound.awake && wlSound.soundOn && (
              <button
                type="button"
                className="wl-tb-btn wl-tb-btn--warn"
                onClick={() => wlSound.wake()}
              >
                🔇 Tap for Sound
              </button>
            )}
            <button
              type="button"
              className="wl-tb-btn"
              onClick={() => wlSound.setSound(!wlSound.soundOn)}
              title="Toggle sound effects"
            >
              {wlSound.soundOn ? '🔊 Sound' : '🔇 Muted'}
            </button>
            <button
              type="button"
              className="wl-tb-btn"
              onClick={() => setShowDeckModal(true)}
            >
              🗂️ Deck <span className="wl-tb-badge">{state.settings.deckSize}</span>
            </button>
            {state.phase !== 'lobby' && (
              <button
                type="button"
                className={`wl-tb-btn ${editingScores ? 'is-active' : ''}`}
                onClick={() => setEditingScores((e) => !e)}
              >
                ✎ Scores
              </button>
            )}
            <button
              type="button"
              className="wl-tb-btn"
              onClick={() => setShowHowTo(true)}
            >
              📖 How to Play
            </button>
            {state.phase !== 'lobby' && (
              <>
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
              </>
            )}
          </nav>
        </header>

        {/* LOBBY PHASE */}
        {state.phase === 'lobby' && (
          <main className="wl-lobby-grid">
            {/* Left Column: QR & Join */}
            <section className="wl-panel wl-lobby-qr-panel">
              <div className="wl-qr-box">
                <QrCode
                  value={joinUrl}
                  className="wl-qr-svg"
                  label={`Join room ${state.code} at ${joinUrl}`}
                />
              </div>
              <div className="wl-join-meta">
                <span className="wl-eyebrow">Scan or visit on your phone</span>
                <div className="wl-big-code">{state.code}</div>
                <p className="wl-join-url">
                  {location.host}/wavelength/play
                </p>
              </div>
              <div className="wl-lobby-cta">
                <button
                  type="button"
                  className="wl-btn wl-btn--primary wl-btn--lg wl-btn--block"
                  disabled={!state.canStart}
                  onClick={() => send({ type: 'start' })}
                >
                  {state.canStart
                    ? `Start Wavelength (${state.players.length} Players) →`
                    : `Waiting for ${state.minPlayers - state.players.length} more…`}
                </button>
              </div>
            </section>

            {/* Center Column: Mode & Settings */}
            <section className="wl-panel wl-lobby-settings">
              <h2 className="wl-panel-title">Game Mode &amp; Rules</h2>

              <div className="wl-mode-tabs" role="radiogroup" aria-label="Game mode">
                {(
                  [
                    {
                      id: 'teams',
                      title: '⚡ Teams',
                      desc: '2–6 teams take turns guessing + optional Left/Right bonus',
                    },
                    {
                      id: 'ffa',
                      title: '🎯 Free-for-All',
                      desc: 'Everyone locks in their own needle; Psychic scores for hits',
                    },
                    {
                      id: 'coop',
                      title: '🤝 Co-op',
                      desc: 'Work together across 7 cards for a cosmic mind-meld rating',
                    },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`wl-mode-card ${state.mode === m.id ? 'is-selected' : ''}`}
                    onClick={() => send({ type: 'set_mode', mode: m.id })}
                  >
                    <strong>{m.title}</strong>
                    <span>{m.desc}</span>
                  </button>
                ))}
              </div>

              <div className="wl-settings-rows">
                <div className="wl-setting-row">
                  <div>
                    <strong>Scoring Wedges</strong>
                    <p className="wl-muted wl-small">Points for Bullseye / Close / Near</p>
                  </div>
                  <div className="wl-pill-group">
                    <button
                      type="button"
                      className={`wl-pill-btn ${state.settings.preset === 'classic' ? 'is-on' : ''}`}
                      onClick={() => send({ type: 'set_preset', preset: 'classic' })}
                    >
                      5 · 3 · 1 (mikeck1)
                    </button>
                    <button
                      type="button"
                      className={`wl-pill-btn ${state.settings.preset === 'board' ? 'is-on' : ''}`}
                      onClick={() => send({ type: 'set_preset', preset: 'board' })}
                    >
                      4 · 3 · 2 (Board Game)
                    </button>
                  </div>
                </div>

                {state.mode !== 'coop' && (
                  <div className="wl-setting-row">
                    <div>
                      <strong>Target Score</strong>
                      <p className="wl-muted wl-small">First to reach this wins</p>
                    </div>
                    <div className="wl-stepper">
                      <button
                        type="button"
                        className="wl-icon-btn"
                        onClick={() =>
                          send({ type: 'set_target', target: Math.max(5, state.settings.targetScore - 1) })
                        }
                      >
                        −
                      </button>
                      <span className="wl-stepper-val">{state.settings.targetScore}</span>
                      <button
                        type="button"
                        className="wl-icon-btn"
                        onClick={() =>
                          send({ type: 'set_target', target: Math.min(25, state.settings.targetScore + 1) })
                        }
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}

                {state.mode === 'teams' && (
                  <>
                    <div className="wl-setting-row">
                      <div>
                        <strong>Left / Right Opposing Bonus</strong>
                        <p className="wl-muted wl-small">
                          Opposing team votes whether target is Left or Right for +1 pt
                        </p>
                      </div>
                      <button
                        type="button"
                        className={`wl-toggle-btn ${state.settings.leftRightBonus ? 'is-on' : ''}`}
                        onClick={() =>
                          send({ type: 'set_left_right', on: !state.settings.leftRightBonus })
                        }
                      >
                        {state.settings.leftRightBonus ? 'ON' : 'OFF'}
                      </button>
                    </div>

                    <div className="wl-setting-row">
                      <div>
                        <strong>Catch-Up Bonus Turn</strong>
                        <p className="wl-muted wl-small">
                          Bullseye while trailing by 4+ pts grants an immediate extra turn
                        </p>
                      </div>
                      <button
                        type="button"
                        className={`wl-toggle-btn ${state.settings.catchupRule ? 'is-on' : ''}`}
                        onClick={() =>
                          send({ type: 'set_catchup', on: !state.settings.catchupRule })
                        }
                      >
                        {state.settings.catchupRule ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  </>
                )}

                <div className="wl-setting-row">
                  <div>
                    <strong>Active Card Packs ({state.settings.deckSize} cards)</strong>
                    <p className="wl-muted wl-small">Tap packs to toggle, or add your own custom cards</p>
                  </div>
                  <button
                    type="button"
                    className="wl-btn wl-btn--secondary wl-btn--sm"
                    onClick={() => setShowDeckModal(true)}
                  >
                    ✍️ Custom Deck ({state.settings.customCount})
                  </button>
                </div>

                <div className="wl-pack-chips">
                  {state.decks.map((d) => {
                    const on = state.settings.packs.includes(d.id);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        className={`wl-pack-chip ${on ? 'is-on' : ''}`}
                        onClick={() => send({ type: 'toggle_pack', pack: d.id })}
                      >
                        <span>{d.emoji}</span>
                        <span>{d.name}</span>
                        <span className="wl-pack-chip-cnt">{d.count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Right Column: Players & Teams */}
            <section className="wl-panel wl-lobby-players">
              <div className="wl-panel-head">
                <h2 className="wl-panel-title">
                  Players ({state.players.length}/16)
                </h2>
                <div className="wl-row-gap">
                  <button
                    type="button"
                    className="wl-btn wl-btn--secondary wl-btn--sm"
                    onClick={() => send({ type: 'add_bot' })}
                  >
                    + Bot
                  </button>
                  {state.players.some((p) => p.isBot) && (
                    <button
                      type="button"
                      className="wl-btn wl-btn--ghost wl-btn--sm"
                      onClick={() => send({ type: 'remove_bot' })}
                    >
                      − Bot
                    </button>
                  )}
                </div>
              </div>

              {state.mode === 'teams' && (
                <div className="wl-teams-bar">
                  <div className="wl-teams-chips">
                    {state.teams.map((t) => (
                      <div
                        key={t.id}
                        className="wl-team-lobby-pill"
                        style={{ '--c': t.color } as React.CSSProperties}
                      >
                        <span className="wl-dot" />
                        <input
                          type="text"
                          className="wl-team-name-input"
                          value={t.name}
                          maxLength={24}
                          aria-label="Team name"
                          onChange={(e) =>
                            send({ type: 'rename_team', teamId: t.id, name: e.target.value })
                          }
                        />
                        {state.teams.length > 2 && (
                          <button
                            type="button"
                            className="wl-team-del"
                            onClick={() => send({ type: 'remove_team', teamId: t.id })}
                            title="Remove team"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="wl-row-gap">
                    {state.teams.length < 6 && (
                      <button
                        type="button"
                        className="wl-btn wl-btn--ghost wl-btn--sm"
                        onClick={() => send({ type: 'add_team' })}
                      >
                        + Team
                      </button>
                    )}
                    {state.players.length >= 2 && (
                      <button
                        type="button"
                        className="wl-btn wl-btn--ghost wl-btn--sm"
                        onClick={() => send({ type: 'shuffle_teams' })}
                      >
                        🔀 Shuffle
                      </button>
                    )}
                  </div>
                </div>
              )}

              {state.players.length === 0 ? (
                <p className="wl-empty-players">
                  Scan the QR code on your phone or add a few Bots to start!
                </p>
              ) : (
                <ul className="wl-player-list">
                  {state.players.map((p) => {
                    const pTeam = state.teams.find((t) => t.id === p.teamId);
                    return (
                      <li key={p.id} className="wl-player-row">
                        <div className="wl-player-avatar" style={{ borderColor: p.color }}>
                          {avatars[p.id] ? (
                            <img src={avatars[p.id]} alt={p.name} />
                          ) : (
                            <span style={{ background: p.color }}>
                              {p.name.slice(0, 2).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <span className="wl-player-name">
                          {p.name}
                          {!p.connected && <em className="wl-offline"> (offline)</em>}
                        </span>

                        {state.mode === 'teams' && pTeam && (
                          <button
                            type="button"
                            className="wl-player-team-btn"
                            style={{ '--c': pTeam.color } as React.CSSProperties}
                            title="Click to switch team"
                            onClick={() => {
                              const idx = state.teams.findIndex((t) => t.id === p.teamId);
                              const next = state.teams[(idx + 1) % state.teams.length];
                              if (next) {
                                send({ type: 'set_team', playerId: p.id, teamId: next.id });
                              }
                            }}
                          >
                            <span className="wl-dot" />
                            {pTeam.name}
                          </button>
                        )}

                        <div className="wl-seat-btns">
                          <button
                            type="button"
                            className="wl-icon-btn wl-icon-btn--sm"
                            onClick={() => send({ type: 'move_seat', playerId: p.id, dir: -1 })}
                            aria-label="Move up"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            className="wl-icon-btn wl-icon-btn--sm"
                            onClick={() => send({ type: 'move_seat', playerId: p.id, dir: 1 })}
                            aria-label="Move down"
                          >
                            ▼
                          </button>
                          <button
                            type="button"
                            className="wl-icon-btn wl-icon-btn--sm wl-danger-text"
                            onClick={() => send({ type: 'kick', playerId: p.id })}
                            aria-label={`Remove ${p.name}`}
                          >
                            ✕
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </main>
        )}

        {/* ACTIVE GAMEPLAY & GAMEOVER */}
        {state.phase !== 'lobby' && (
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
                  <div className="wl-team-chip is-current" style={{ '--c': '#5ef0c4' } as React.CSSProperties}>
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
                  <div className="wl-team-chip" style={{ '--c': '#ffc94a' } as React.CSSProperties}>
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
                      : 'Debate where the clue sits and drag the dial needle on your phones (or right here on the TV)!'}
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
                hubColor={accentColor}
                extraNeedles={extraNeedles}
              />

              {!suspense && state.phase === 'reveal' && state.reveal?.bullseye && (
                <div className="wl-bullseye-badge" aria-live="polite">
                  🎯 BULLSEYE!
                </div>
              )}
            </section>

            {/* Spectrum Card */}
            {state.card && (
              <section className="wl-card" aria-label="Spectrum card">
                <div className="wl-card-inner">
                  <div className="wl-card-side wl-card-left">
                    <span className="wl-card-dir">◀ LEFT</span>
                    <strong>{state.card[0]}</strong>
                  </div>
                  <div className="wl-card-mid" aria-hidden="true">
                    ↔
                  </div>
                  <div className="wl-card-side wl-card-right">
                    <span className="wl-card-dir">RIGHT ▶</span>
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
        )}
      </div>

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
