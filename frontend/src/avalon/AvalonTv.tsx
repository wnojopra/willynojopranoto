import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QrCode } from '../shared/QrCode';
import { ensureSession, loadAvalonFonts, useGameSocket } from '../shared/useGameSocket';
import {
  AvalonCrest,
  KnightPawn,
  LeaderCrown,
  QuestChaliceCard,
  RoleEmblem,
  TableauBoard,
  Token,
  VoteTokenBadge,
} from './Art';
import {
  avalonSound,
  installAvalonWakeOnGesture,
  useAvalonAudioSettings,
  useNightNarrator,
} from './audio';
import { HowToOverlay } from './HowTo';
import {
  OPTIONAL_ROLE_CATALOG,
  type AvaPlayer,
  type AvaServerMsg,
  type AvaState,
  type OptionalRoleId,
  type Photos,
} from './protocol';
import './avalon.css';

const ROOM_KEY = 'ava-tv-room';
const MAX_RETRIES = 8;

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
    // ignore
  }
}

function ConfirmButton({
  id,
  label,
  confirmLabel,
  onConfirm,
  className,
}: {
  id: string;
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
}) {
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
      className={`ava-btn ${armed ? 'ava-btn--danger' : className ?? 'ava-btn--ghost'}`}
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

type Send = (msg: object) => void;

export function AvalonTv() {
  const [state, setState] = useState<AvaState | null>(null);
  const [photos, setPhotos] = useState<Photos>({});
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retries, setRetries] = useState(0);
  const [ready, setReady] = useState(false);
  const [howTo, setHowTo] = useState(false);

  useAvalonAudioSettings();

  useEffect(() => {
    document.title = 'Avalon · The Resistance';
    loadAvalonFonts();
    ensureSession().then(() => setReady(true));
    return installAvalonWakeOnGesture();
  }, []);

  const onMessage = useCallback((msg: AvaServerMsg) => {
    if (msg.type === 'state') setState(msg);
    else if (msg.type === 'avatars') setPhotos(msg.avatars);
    else if (msg.type === 'created') {
      saveRoom(msg.code);
      setRetries(0);
    } else if (msg.type === 'error') setError(msg.message);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const firstMessage = useMemo(() => JSON.stringify({ type: 'create', resume: savedRoom() }), [attempt]);
  const { status, send } = useGameSocket<AvaServerMsg>(
    ready ? '/ws/avalon/tv' : null,
    firstMessage,
    onMessage,
    attempt,
  );

  // Sound effects on phase transitions
  const prevPhase = useRef<string | null>(null);
  useEffect(() => {
    if (!state) return;
    const prev = prevPhase.current;
    prevPhase.current = state.phase;
    if (!prev || prev === state.phase) return;
    if (state.phase === 'team_reveal' && state.lastVoteReveal) {
      avalonSound.voteReveal(state.lastVoteReveal.approved);
    } else if (state.phase === 'quest_reveal' && state.lastQuestReveal) {
      avalonSound.questOutcome(state.lastQuestReveal.succeeded);
    } else if (state.phase === 'assassinate') {
      avalonSound.questOutcome(true);
      void avalonSound.speakLine(
        'Three Quests have succeeded for Camelot! Evil has one final chance: The Assassin may now name Merlin.',
      );
    } else if (state.phase === 'gameover') {
      avalonSound.questOutcome(state.winner === 'good');
      void avalonSound.speakLine(
        state.winner === 'good'
          ? 'Arthur and Goodness prevail! The Loyal Servants of Arthur win the game.'
          : 'Mordred’s dark forces triumph! The agents of Evil win the game.',
      );
    }
  }, [state]);

  const lost = status === 'closed' && !error;
  useEffect(() => {
    if (!lost || retries >= MAX_RETRIES) return;
    const id = setTimeout(() => {
      setRetries((n) => n + 1);
      setAttempt((n) => n + 1);
    }, Math.min(8000, 800 * 2 ** retries));
    return () => clearTimeout(id);
  }, [lost, retries]);

  let content;
  if (error || (lost && retries >= MAX_RETRIES)) {
    content = (
      <main className="ava-center">
        <div className="ava-panel ava-center__box">
          <h1 className="ava-h1">Connection Lost</h1>
          <p className="ava-sub">{error ?? 'Lost connection to the game server.'}</p>
          <div className="ava-row">
            {!error && (
              <button
                id="ava-tv-reconnect"
                type="button"
                className="ava-btn ava-btn--primary"
                onClick={() => {
                  setRetries(0);
                  setAttempt((n) => n + 1);
                }}
              >
                Reconnect
              </button>
            )}
            <button
              id="ava-tv-new"
              type="button"
              className="ava-btn ava-btn--ghost"
              onClick={() => {
                saveRoom(null);
                location.reload();
              }}
            >
              Start a New Room
            </button>
          </div>
        </div>
      </main>
    );
  } else if (!state) {
    content = (
      <main className="ava-center">
        <p className="ava-sub">Unrolling the Quest Tableau…</p>
      </main>
    );
  } else if (state.phase === 'lobby') {
    content = <LobbyScreen state={state} photos={photos} send={send} onHowTo={() => setHowTo(true)} />;
  } else if (state.phase === 'night') {
    content = <NightScreen state={state} photos={photos} send={send} />;
  } else if (state.phase === 'gameover') {
    content = <GameOverScreen state={state} photos={photos} send={send} />;
  } else {
    content = <BoardScreen state={state} photos={photos} send={send} onHowTo={() => setHowTo(true)} />;
  }

  return (
    <div className="ava-root ava-root--tv">
      {content}
      {howTo && <HowToOverlay onClose={() => setHowTo(false)} />}
    </div>
  );
}

function AudioToolbar() {
  useAvalonAudioSettings();
  return (
    <div className="ava-audiobar">
      <button
        id="ava-toggle-sound"
        type="button"
        className={`ava-chip ${avalonSound.soundOn ? 'ava-chip--on' : ''}`}
        onClick={() => {
          avalonSound.wake();
          avalonSound.setSound(!avalonSound.soundOn);
        }}
      >
        {avalonSound.soundOn ? 'Sound: On' : 'Sound: Off'}
      </button>
      <button
        id="ava-toggle-voice"
        type="button"
        className={`ava-chip ${avalonSound.narrateOn ? 'ava-chip--on' : ''}`}
        onClick={() => {
          avalonSound.wake();
          avalonSound.setNarrate(!avalonSound.narrateOn);
        }}
      >
        {avalonSound.narrateOn ? 'Narrator: On' : 'Narrator: Off'}
      </button>
    </div>
  );
}

function LobbyScreen({
  state,
  photos,
  send,
  onHowTo,
}: {
  state: AvaState;
  photos: Photos;
  send: Send;
  onHowTo: () => void;
}) {
  const joinUrl = `${location.origin}/avalon/play?code=${state.code}`;
  const hasBots = state.players.some((p) => p.isBot);
  const n = state.players.length;
  const percivalAloneIn5 =
    n === 5 &&
    state.optionalRoles.includes('percival') &&
    !state.optionalRoles.includes('morgana') &&
    !state.optionalRoles.includes('mordred');

  return (
    <main className="ava-lobby">
      {/* Left Column: Box-Cover Stone Frame */}
      <section className="ava-boxframe">
        <p className="ava-boxframe__eyebrow">don eskridge’s THE RESISTANCE</p>
        <h1 className="ava-logo">AVALON</h1>
        <div className="ava-boxframe__window">
          <AvalonCrest className="ava-boxframe__crest" />
          <div className="ava-joinbox">
            <div className="ava-joinbox__info">
              <span className="ava-kicker">Join on Your Phone</span>
              <p className="ava-joinbox__url">
                {location.host}
                <wbr />
                /avalon/play
              </p>
              <span className="ava-kicker">Room Code</span>
              <p className="ava-code" id="ava-code">
                {state.code}
              </p>
            </div>
            <QrCode value={joinUrl} className="ava-qr" label={`Scan to join room ${state.code}`} />
          </div>
        </div>
        <p className="ava-boxframe__tagline">Secret Identities • Deduction • Deception</p>
        <div className="ava-row ava-row--center">
          <button id="ava-howto" type="button" className="ava-btn ava-btn--ghost" onClick={onHowTo}>
            Rulebook
          </button>
          <a id="ava-to-phone" className="ava-btn ava-btn--ghost" href={`/avalon/play?code=${state.code}`}>
            Join on This Device
          </a>
        </div>
        <AudioToolbar />
      </section>

      {/* Right Column: Dark Parchment Setup Scroll */}
      <section className="ava-panel ava-lobby__config">
        <div className="ava-panel__head">
          <div>
            <h2 className="ava-h2">
              Council of Camelot{' '}
              <span className="ava-muted">
                ({n} / {state.maxPlayers} Knights)
              </span>
            </h2>
            <p className="ava-muted ava-tiny">
              Arrange seats in clockwise order around the table.
            </p>
          </div>
          <div className="ava-row">
            <button
              id="ava-add-bot"
              type="button"
              className="ava-btn ava-btn--ghost ava-btn--small"
              disabled={n >= state.maxPlayers}
              onClick={() => send({ type: 'add_bot' })}
            >
              + Add Bot
            </button>
            {hasBots && (
              <button
                id="ava-remove-bot"
                type="button"
                className="ava-btn ava-btn--ghost ava-btn--small"
                onClick={() => send({ type: 'remove_bot' })}
              >
                − Remove Bot
              </button>
            )}
          </div>
        </div>

        {n === 0 ? (
          <p className="ava-empty">Scan the QR code on your phone to take your seat at the Round Table…</p>
        ) : (
          <ol className="ava-roster">
            {state.players.map((p, i) => (
              <li
                key={p.id}
                className={`ava-roster__item ${p.connected ? '' : 'ava-roster__item--off'}`}
              >
                <span className="ava-roster__seat">{i + 1}</span>
                <KnightPawn color={p.color} photo={photos[p.id]} className="ava-roster__pawn" />
                <span className="ava-roster__name">
                  {p.name}
                  {p.isBot && <span className="ava-muted"> (bot)</span>}
                </span>
                <span className="ava-roster__tools">
                  <button
                    type="button"
                    className="ava-icon"
                    aria-label={`Move ${p.name} earlier`}
                    disabled={i === 0}
                    onClick={() => send({ type: 'move_seat', playerId: p.id, dir: -1 })}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="ava-icon"
                    aria-label={`Move ${p.name} later`}
                    disabled={i === n - 1}
                    onClick={() => send({ type: 'move_seat', playerId: p.id, dir: 1 })}
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    className="ava-icon ava-icon--danger"
                    aria-label={`Remove ${p.name}`}
                    onClick={() => send({ type: 'kick', playerId: p.id })}
                  >
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ol>
        )}

        <div className="ava-splitbar">
          <span className="ava-badge ava-badge--good">
            {state.alignmentCount.good} Loyal Servants of Arthur (includes Merlin)
          </span>
          <span className="ava-badge ava-badge--evil">
            {state.alignmentCount.evil} Minions of Mordred (includes Assassin)
          </span>
        </div>

        <div className="ava-roles-picker">
          <h3 className="ava-h3">Optional Character Cards</h3>
          <div className="ava-roles-grid">
            {OPTIONAL_ROLE_CATALOG.map((item) => {
              const checked = state.optionalRoles.includes(item.id);
              const active = state.activeOptionalRoles.includes(item.id);
              return (
                <button
                  key={item.id}
                  id={`ava-role-${item.id}`}
                  type="button"
                  role="switch"
                  aria-checked={checked}
                  className={`ava-rolecard ava-rolecard--${item.alignment} ${
                    checked ? 'ava-rolecard--on' : ''
                  }`}
                  onClick={() => send({ type: 'toggle_role', role: item.id as OptionalRoleId })}
                >
                  <RoleEmblem role={item.id} alignment={item.alignment} className="ava-rolecard__icon" />
                  <div className="ava-rolecard__body">
                    <div className="ava-rolecard__head">
                      <strong>{item.name}</strong>
                      <span className={`ava-pill ava-pill--${item.alignment}`}>
                        {item.alignment === 'good' ? 'Good' : 'Evil'}
                      </span>
                    </div>
                    <p className="ava-rolecard__desc">{item.summary}</p>
                    {checked && !active && (
                      <p className="ava-rolecard__warn">
                        Requires 7+ players when other Evil roles are active.
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          {n === 5 && percivalAloneIn5 && (
            <p className="ava-tip">
              <em>Note: For games of 5, be sure to add either Mordred or Morgana when playing with Percival.</em>
            </p>
          )}
        </div>

        <button
          id="ava-start"
          type="button"
          className="ava-btn ava-btn--primary ava-btn--big"
          disabled={!state.canStart}
          onClick={() => {
            avalonSound.wake();
            send({ type: 'start' });
          }}
        >
          {state.canStart
            ? `Deal Character Cards (${n} Players)`
            : `Requires ${state.minPlayers}–${state.maxPlayers} Players (${n} Seated)`}
        </button>
      </section>
    </main>
  );
}

function NightScreen({
  state,
  photos,
  send,
}: {
  state: AvaState;
  photos: Photos;
  send: Send;
}) {
  const [runKey, setRunKey] = useState(0);
  const { stepIndex, done } = useNightNarrator(true, state.nightScript, runKey);
  const currentStep = state.nightScript[stepIndex] ?? state.nightScript[state.nightScript.length - 1];
  const readySet = new Set(state.nightReadyIds);

  return (
    <main className="ava-night">
      <div className="ava-panel ava-night__card">
        <div className="ava-row ava-row--spread">
          <span className="ava-kicker">Evil Reveals Itself, and Merlin Looks Into the Future</span>
          <AudioToolbar />
        </div>

        <h1 className="ava-h1">
          {done ? 'Everyone Open Your Eyes' : 'Close Your Eyes & Extend Your Fist'}
        </h1>
        <p className="ava-sub">
          Secretly inspect your Character Card on your phone, then close your eyes and obey the herald’s script:
        </p>

        <div className="ava-scriptbox" aria-live="polite">
          <span className="ava-pill ava-pill--gold">
            Step {Math.min(stepIndex + 1, state.nightScript.length)} of {state.nightScript.length} ·{' '}
            {currentStep?.Cue}
          </span>
          <blockquote className="ava-scriptbox__quote">“{currentStep?.text}”</blockquote>
          <div className="ava-scriptbox__dots">
            {state.nightScript.map((s, idx) => (
              <span
                key={s.id}
                className={`ava-dot ${
                  idx < stepIndex || done
                    ? 'ava-dot--done'
                    : idx === stepIndex
                      ? 'ava-dot--active'
                      : ''
                }`}
              />
            ))}
          </div>
        </div>

        <div className="ava-night__ready">
          <h2 className="ava-h3">
            Knights Ready ({state.nightReadyIds.length} / {state.players.length})
          </h2>
          <ul className="ava-ready-grid">
            {state.players.map((p) => {
              const isReady = readySet.has(p.id);
              return (
                <li
                  key={p.id}
                  className={`ava-ready-chip ${isReady ? 'ava-ready-chip--done' : ''}`}
                >
                  <Token color={p.color} photo={photos[p.id]} />
                  <span>{p.name}</span>
                  <strong>{isReady ? 'Ready' : 'Reviewing…'}</strong>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="ava-row ava-row--spread">
          <button
            id="ava-replay-night"
            type="button"
            className="ava-btn ava-btn--ghost"
            onClick={() => {
              avalonSound.wake();
              setRunKey((k) => k + 1);
            }}
          >
            Replay Night Script
          </button>
          <button
            id="ava-finish-night"
            type="button"
            className="ava-btn ava-btn--primary ava-btn--big"
            onClick={() => send({ type: 'advance' })}
          >
            Begin 1st Quest →
          </button>
        </div>
      </div>
    </main>
  );
}

function BoardScreen({
  state,
  photos,
  send,
  onHowTo,
}: {
  state: AvaState;
  photos: Photos;
  send: Send;
  onHowTo: () => void;
}) {
  const byId = useMemo(() => new Map(state.players.map((p) => [p.id, p])), [state.players]);
  const leader = state.leaderId ? byId.get(state.leaderId) : undefined;
  const activeTeamIds =
    state.phase === 'team_building' ? state.draftTeam : state.proposedTeam;
  const teamSet = new Set(activeTeamIds);
  const votedSet = new Set(state.votedIds);
  const submittedSet = new Set(state.questSubmittedIds);

  return (
    <main className="ava-board">
      <section className="ava-board__main">
        {/* Top Header */}
        <header className="ava-topbar">
          <div className="ava-topbar__brand">
            <strong className="ava-topbar__title">AVALON</strong>
            <span className="ava-badge ava-badge--good">
              {state.alignmentCount.good} Good
            </span>
            <span className="ava-badge ava-badge--evil">
              {state.alignmentCount.evil} Evil
            </span>
            {state.activeOptionalRoles.map((r) => (
              <span key={r} className="ava-pill">
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </span>
            ))}
          </div>
          <div className="ava-topbar__right">
            <AudioToolbar />
            <span className="ava-roompill">
              Room <strong id="ava-room-code">{state.code}</strong>
            </span>
          </div>
        </header>

        {/* Physical Painted Score Tableau Board */}
        <div className="ava-tableau-wrap">
          <TableauBoard
            numPlayers={state.players.length}
            evilCount={state.alignmentCount.evil}
            round={state.round}
            rejectedCount={state.rejectedCount}
            questSpecs={state.questSpecs}
            questResults={state.questResults}
          />
        </div>

        {/* Active Phase Banner */}
        <PhaseStage state={state} byId={byId} leader={leader} photos={photos} send={send} />

        {/* Knights Around the Table */}
        <section className="ava-panel ava-ring-panel">
          <div className="ava-panel__head">
            <h2 className="ava-h3">Knights of the Round Table (Clockwise)</h2>
            <span className="ava-muted ava-tiny">
              Leader Token passes clockwise after every vote or quest
            </span>
          </div>
          <ul className="ava-seats">
            {state.players.map((p) => {
              const isLeader = p.id === state.leaderId;
              const onTeam = teamSet.has(p.id);
              const hasVoted = votedSet.has(p.id);
              const hasPlayedQuest = submittedSet.has(p.id);
              const voteVal =
                state.phase === 'team_reveal' && state.lastVoteReveal
                  ? state.lastVoteReveal.votes[p.id]
                  : undefined;

              return (
                <li
                  key={p.id}
                  className={`ava-seat ${isLeader ? 'ava-seat--leader' : ''} ${
                    onTeam ? 'ava-seat--team' : ''
                  } ${p.connected ? '' : 'ava-seat--off'}`}
                >
                  <div className="ava-seat__badges">
                    {isLeader && (
                      <span className="ava-seat__crown" title="Current Leader">
                        <LeaderCrown /> Leader
                      </span>
                    )}
                    {onTeam && <span className="ava-seat__shield">Team Token</span>}
                  </div>
                  <KnightPawn color={p.color} photo={photos[p.id]} className="ava-seat__pawn" />
                  <strong className="ava-seat__name">{p.name}</strong>

                  {state.phase === 'team_vote' && (
                    <span className={`ava-seat__status ${hasVoted ? 'ava-seat__status--done' : ''}`}>
                      {hasVoted ? 'Vote Ready' : 'Choosing…'}
                    </span>
                  )}
                  {state.phase === 'team_reveal' && voteVal !== undefined && (
                    <VoteTokenBadge approve={voteVal} size="sm" />
                  )}
                  {state.phase === 'quest' && onTeam && (
                    <span
                      className={`ava-seat__status ${hasPlayedQuest ? 'ava-seat__status--done' : ''}`}
                    >
                      {hasPlayedQuest ? 'Card Facedown' : 'On Quest…'}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </section>

      {/* Right Sidebar: Chronicle Scroll + Host Controls */}
      <aside className="ava-side">
        <div className="ava-panel ava-history">
          <h2 className="ava-h3">Chronicle of Votes &amp; Quests</h2>
          {state.history.length === 0 ? (
            <p className="ava-muted ava-tiny">
              Every Team Proposal, Vote Token, and Quest outcome will be inscribed here…
            </p>
          ) : (
            <ol className="ava-history__list">
              {[...state.history].reverse().map((item, idx) => {
                if (item.kind === 'vote') {
                  const lName = item.leaderId ? byId.get(item.leaderId)?.name ?? 'Leader' : 'Leader';
                  const tNames = item.teamIds.map((id) => byId.get(id)?.name ?? '?').join(', ');
                  const approvers = Object.entries(item.votes)
                    .filter(([, v]) => v)
                    .map(([id]) => byId.get(id)?.name ?? '?');
                  const rejecters = Object.entries(item.votes)
                    .filter(([, v]) => !v)
                    .map(([id]) => byId.get(id)?.name ?? '?');
                  return (
                    <li key={`v-${idx}`} className="ava-history__item">
                      <div className="ava-history__row">
                        <strong>
                          Quest {item.round} · Vote {item.proposal} ({lName})
                        </strong>
                        <span
                          className={`ava-pill ${
                            item.approved ? 'ava-pill--good' : 'ava-pill--evil'
                          }`}
                        >
                          {item.approved ? 'Approved' : 'Rejected'} ({item.approves}–{item.rejects})
                        </span>
                      </div>
                      <p className="ava-tiny">
                        <strong>Team:</strong> {tNames}
                      </p>
                      <p className="ava-tiny ava-muted">
                        Approve: {approvers.length ? approvers.join(', ') : 'None'} · Reject:{' '}
                        {rejecters.length ? rejecters.join(', ') : 'None'}
                      </p>
                    </li>
                  );
                }
                const tNames = item.teamIds.map((id) => byId.get(id)?.name ?? '?').join(', ');
                return (
                  <li
                    key={`q-${idx}`}
                    className={`ava-history__item ava-history__item--quest ${
                      item.succeeded ? 'ava-history__item--good' : 'ava-history__item--evil'
                    }`}
                  >
                    <div className="ava-history__row">
                      <strong>Quest {item.quest} Resolved</strong>
                      <span
                        className={`ava-pill ${
                          item.succeeded ? 'ava-pill--good' : 'ava-pill--evil'
                        }`}
                      >
                        {item.succeeded ? 'SUCCESS' : 'FAILED'}
                      </span>
                    </div>
                    <p className="ava-tiny">
                      <strong>Team:</strong> {tNames} ({item.successCount} Success, {item.failCount}{' '}
                      Fail)
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="ava-panel ava-hostbox">
          <h3 className="ava-h3">Table Controls</h3>
          <div className="ava-row">
            <button
              id="ava-skip"
              type="button"
              className="ava-btn ava-btn--ghost ava-btn--small"
              onClick={() => send({ type: 'skip' })}
            >
              Skip / Force Step
            </button>
            <button
              id="ava-howto-ingame"
              type="button"
              className="ava-btn ava-btn--ghost ava-btn--small"
              onClick={onHowTo}
            >
              Rulebook
            </button>
            <ConfirmButton
              id="ava-end"
              label="End Game"
              confirmLabel="Really End?"
              className="ava-btn--ghost ava-btn--small"
              onConfirm={() => send({ type: 'play_again' })}
            />
          </div>
        </div>
      </aside>
    </main>
  );
}

function PhaseStage({
  state,
  byId,
  leader,
  photos,
  send,
}: {
  state: AvaState;
  byId: Map<string, AvaPlayer>;
  leader: AvaPlayer | undefined;
  photos: Photos;
  send: Send;
}) {
  if (state.phase === 'team_building') {
    const names = state.draftTeam.map((id) => byId.get(id)?.name).filter(Boolean);
    return (
      <section className="ava-panel ava-stage">
        <span className="ava-kicker">
          Team Building Phase · Quest {state.round} (Vote Track {state.proposal} of 5)
        </span>
        <h2 className="ava-h2">
          <PlayerInline p={leader} photos={photos} /> Holds the Leader Token
        </h2>
        <p className="ava-sub">
          <em>“Discuss, Discuss, Discuss.”</em> The Leader must assign{' '}
          <strong>{state.questSize} Team Tokens</strong> on their phone and call for a Vote.
        </p>
        <div className="ava-stage__pills">
          {names.length > 0 ? (
            names.map((n) => (
              <span key={n} className="ava-pill ava-pill--gold">
                <LeaderCrown /> {n}
              </span>
            ))
          ) : (
            <span className="ava-muted">Awaiting Team Token assignment…</span>
          )}
        </div>
      </section>
    );
  }

  if (state.phase === 'team_vote') {
    const teamPlayers = state.proposedTeam.map((id) => byId.get(id)).filter(Boolean) as AvaPlayer[];
    return (
      <section className="ava-panel ava-stage">
        <span className="ava-kicker">
          Team Vote · {state.votedIds.length} of {state.players.length} Vote Tokens Ready
        </span>
        <h2 className="ava-h2">Select Your Vote Token on Your Phone</h2>
        <p className="ava-sub">
          <PlayerInline p={leader} photos={photos} /> proposed this Quest Team of {state.questSize}:
        </p>
        <div className="ava-stage__pills">
          {teamPlayers.map((p) => (
            <span key={p.id} className="ava-pill ava-pill--gold">
              <Token color={p.color} photo={photos[p.id]} /> {p.name}
            </span>
          ))}
        </div>
      </section>
    );
  }

  if (state.phase === 'team_reveal' && state.lastVoteReveal) {
    const rev = state.lastVoteReveal;
    return (
      <section className="ava-panel ava-stage">
        <span className="ava-kicker">Vote Tokens Revealed</span>
        <h2 className="ava-h2">
          {rev.approved
            ? `Vote Approved (${rev.approves} Approve, ${rev.rejects} Reject)`
            : `Vote Rejected (${rev.approves} Approve, ${rev.rejects} Reject)`}
        </h2>
        <p className="ava-sub">
          {rev.approved
            ? 'The Quest Team is approved! Play continues in the Quest Phase.'
            : `The Team is rejected. The Leader Token passes clockwise (${5 - state.rejectedCount} rejection${
                5 - state.rejectedCount === 1 ? '' : 's'
              } remaining before Evil wins).`}
        </p>
        <button
          id="ava-tv-advance-vote"
          type="button"
          className="ava-btn ava-btn--primary"
          onClick={() => send({ type: 'advance' })}
        >
          {rev.approved ? 'Proceed to Quest Phase →' : 'Pass Leader Token Clockwise →'}
        </button>
      </section>
    );
  }

  if (state.phase === 'quest') {
    const teamPlayers = state.proposedTeam.map((id) => byId.get(id)).filter(Boolean) as AvaPlayer[];
    return (
      <section className="ava-panel ava-stage">
        <span className="ava-kicker">
          Quest Phase · {state.questSubmittedIds.length} of {state.proposedTeam.length} Quest Cards Played
        </span>
        <h2 className="ava-h2">The Quest is Underway</h2>
        <p className="ava-sub">
          Each player on the Quest selects a Quest Card on their phone (Good must select Success; Evil may select Success or Fail).
        </p>
        <div className="ava-stage__pills">
          {teamPlayers.map((p) => (
            <span key={p.id} className="ava-pill ava-pill--gold">
              <Token color={p.color} photo={photos[p.id]} /> {p.name}
            </span>
          ))}
        </div>
      </section>
    );
  }

  if (state.phase === 'quest_reveal' && state.lastQuestReveal) {
    const q = state.lastQuestReveal;
    return (
      <section className="ava-panel ava-stage">
        <span className="ava-kicker">Shuffled Quest Cards Revealed</span>
        <h2 className={`ava-h2 ${q.succeeded ? 'ava-text--good' : 'ava-text--evil'}`}>
          {q.succeeded ? `Quest ${q.quest} Succeeded!` : `Quest ${q.quest} Failed!`}
        </h2>
        <div className="ava-questcards">
          {q.cards.map((c, idx) => (
            <QuestChaliceCard key={idx} kind={c} />
          ))}
        </div>
        <button
          id="ava-tv-advance-quest"
          type="button"
          className="ava-btn ava-btn--primary"
          onClick={() => send({ type: 'advance' })}
        >
          Advance Round Marker →
        </button>
      </section>
    );
  }

  if (state.phase === 'assassinate') {
    const assassin = state.assassinId ? byId.get(state.assassinId) : undefined;
    const evilTeam = state.evilDiscussIds.map((id) => byId.get(id)).filter(Boolean) as AvaPlayer[];
    return (
      <section className="ava-panel ava-stage ava-stage--assassinate">
        <span className="ava-kicker">Assassinate Merlin — Evil’s Last Chance</span>
        <h2 className="ava-h2 ava-text--evil">Name Merlin!</h2>
        <p className="ava-sub">
          Three Quests have been completed! Without revealing any Character Cards, the Evil players discuss and{' '}
          <PlayerInline p={assassin} photos={photos} /> (the Assassin) names one Good player as Merlin.
        </p>
        <div className="ava-stage__pills">
          {evilTeam.map((p) => (
            <span key={p.id} className="ava-pill ava-pill--evil">
              <Token color={p.color} photo={photos[p.id]} /> {p.name}
              {p.id === state.assassinId ? ' (The Assassin)' : ''}
            </span>
          ))}
        </div>
      </section>
    );
  }

  return null;
}

function GameOverScreen({
  state,
  photos,
  send,
}: {
  state: AvaState;
  photos: Photos;
  send: Send;
}) {
  const goodWon = state.winner === 'good';
  return (
    <main className="ava-gameover">
      <div className="ava-panel ava-gameover__card">
        <span className={`ava-pill ${goodWon ? 'ava-pill--good' : 'ava-pill--evil'}`}>
          {goodWon ? 'Arthur & Goodness Prevail' : 'Mordred’s Dark Forces Triumph'}
        </span>
        <h1 className={`ava-h1 ${goodWon ? 'ava-text--good' : 'ava-text--evil'}`}>
          {goodWon ? 'Loyal Servants of Arthur Win!' : 'Minions of Mordred Win!'}
        </h1>
        <p className="ava-sub">{state.winReason}</p>

        <h2 className="ava-h3">Character Cards Revealed</h2>
        <ul className="ava-reveal-grid">
          {state.players.map((p) => {
            const r = state.revealedRoles?.[p.id];
            const align = r?.alignment ?? 'good';
            const wasTarget = p.id === state.assassinTargetId;
            return (
              <li
                key={p.id}
                className={`ava-reveal-card ava-reveal-card--${align}`}
              >
                <div className="ava-reveal-card__top">
                  <KnightPawn color={p.color} photo={photos[p.id]} className="ava-reveal-card__pawn" />
                  {r && <RoleEmblem role={r.role} alignment={r.alignment} className="ava-reveal-card__emblem" />}
                </div>
                <strong className="ava-reveal-card__player">{p.name}</strong>
                <span className={`ava-pill ava-pill--${align}`}>
                  {r?.name ?? 'Knight'}
                </span>
                {wasTarget && (
                  <span className="ava-pill ava-pill--evil">Assassinated</span>
                )}
              </li>
            );
          })}
        </ul>

        <div className="ava-row ava-row--center">
          <button
            id="ava-play-again"
            type="button"
            className="ava-btn ava-btn--primary ava-btn--big"
            onClick={() => send({ type: 'play_again' })}
          >
            Return to Setup
          </button>
        </div>
      </div>
    </main>
  );
}

function PlayerInline({ p, photos }: { p: AvaPlayer | undefined; photos: Photos }) {
  if (!p) return <strong>Someone</strong>;
  return (
    <strong className="ava-inline-player">
      <Token color={p.color} photo={photos[p.id]} /> {p.name}
    </strong>
  );
}
