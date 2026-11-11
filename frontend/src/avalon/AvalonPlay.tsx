import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ensureSession, loadAvalonFonts, useGameSocket } from '../shared/useGameSocket';
import {
  AvalonCrest,
  KnightPawn,
  LeaderCrown,
  QuestChaliceCard,
  RoleEmblem,
  Token,
  VoteTokenBadge,
} from './Art';
import { HowToList } from './HowTo';
import type {
  AvaPlayer,
  AvaServerMsg,
  AvaState,
  Photos,
  RoleSecretMsg,
} from './protocol';
import './avalon.css';

interface JoinInfo {
  code: string;
  name: string;
}

const JOIN_KEY = 'ava-join';
const MAX_RETRIES = 6;
const SELFIE_PX = 128;
const MAX_SELFIE_CHARS = 24_000;

function savedJoin(): JoinInfo | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(JOIN_KEY) ?? 'null');
    return raw && typeof raw.code === 'string' && typeof raw.name === 'string'
      ? { code: raw.code, name: raw.name }
      : null;
  } catch {
    return null;
  }
}

function saveJoin(j: JoinInfo | null) {
  try {
    if (j) sessionStorage.setItem(JOIN_KEY, JSON.stringify(j));
    else sessionStorage.removeItem(JOIN_KEY);
  } catch {
    // ignore
  }
}

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
        ctx.translate(SELFIE_PX, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(
          img,
          (img.naturalWidth - side) / 2,
          (img.naturalHeight - side) / 2,
          side,
          side,
          0,
          0,
          SELFIE_PX,
          SELFIE_PX,
        );
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
  const active =
    (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation
      ?.hasBeenActive ?? true;
  if ('vibrate' in navigator && active) navigator.vibrate(pattern);
}

export function AvalonPlay() {
  const initialCode = new URLSearchParams(location.search).get('code') ?? '';
  const resume = useMemo(() => {
    const j = savedJoin();
    return j && (!initialCode || initialCode.toUpperCase() === j.code) ? j : null;
  }, [initialCode]);

  const [code, setCode] = useState(
    resume?.code ?? initialCode.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4),
  );
  const [name, setName] = useState(resume?.name ?? '');
  const [join, setJoin] = useState<JoinInfo | null>(resume);
  const [attempt, setAttempt] = useState(resume ? 1 : 0);
  const [retries, setRetries] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [state, setState] = useState<AvaState | null>(null);
  const [secret, setSecret] = useState<RoleSecretMsg | null>(null);
  const [photos, setPhotos] = useState<Photos>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    document.title = 'Avalon · Phone Controller';
    loadAvalonFonts();
    ensureSession().then(() => setReady(true));
  }, []);

  const onMessage = useCallback((msg: AvaServerMsg) => {
    switch (msg.type) {
      case 'joined':
        setMe(msg.playerId);
        setError(null);
        vibrate(30);
        break;
      case 'state':
        setState(msg);
        if (msg.phase === 'lobby') setSecret(null);
        break;
      case 'role_secret':
        setSecret(msg);
        break;
      case 'avatars':
        setPhotos(msg.avatars);
        break;
      case 'action_rejected':
        setNotice(msg.reason);
        vibrate([25, 45, 25]);
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
  const { status, send } = useGameSocket<AvaServerMsg>(
    join && ready ? '/ws/avalon/play' : null,
    firstMessage,
    onMessage,
    attempt,
  );

  const phaseKey = state ? `${state.phase}-${state.round}-${state.proposal}` : '';
  useEffect(() => {
    setNotice(null);
  }, [phaseKey]);

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
    location.href = '/avalon/play';
  };

  if (!join) {
    return (
      <div className="ava-root ava-root--phone">
        <main className="ava-phone ava-phone--join">
          <div className="ava-phone__hero">
            <AvalonCrest className="ava-phone__crest" />
            <p className="ava-boxframe__eyebrow">don eskridge’s THE RESISTANCE</p>
            <h1 className="ava-logo ava-logo--phone">AVALON</h1>
          </div>
          <form className="ava-panel ava-joinform" onSubmit={onSubmit}>
            <label className="ava-field" htmlFor="ava-join-code">
              <span className="ava-kicker">Room Code</span>
              <input
                id="ava-join-code"
                className="ava-input ava-input--code"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))
                }
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                required
                minLength={4}
                maxLength={4}
                pattern="[A-Za-z]{4}"
                placeholder="BCDF"
              />
            </label>
            <label className="ava-field" htmlFor="ava-join-name">
              <span className="ava-kicker">Your Name</span>
              <input
                id="ava-join-name"
                className="ava-input"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 14))}
                autoComplete="nickname"
                required
                maxLength={14}
                placeholder="Knight’s name"
              />
            </label>
            {error && (
              <p className="ava-error" role="alert">
                {error}
              </p>
            )}
            <button id="ava-join" type="submit" className="ava-btn ava-btn--primary ava-btn--big">
              Take Your Seat
            </button>
            <p className="ava-muted ava-tiny ava-text-center">
              Hosting on a monitor? <a href="/avalon">Open the TV Tableau</a>
            </p>
          </form>
        </main>
      </div>
    );
  }

  const player = state && me ? state.players.find((p) => p.id === me) : undefined;
  if (!state || !player) {
    return (
      <div className="ava-root ava-root--phone">
        <main className="ava-phone ava-center">
          <p className="ava-sub">
            {lost && retries >= MAX_RETRIES ? 'Lost connection to Camelot.' : 'Entering the Great Hall…'}
          </p>
          {lost && retries >= MAX_RETRIES && (
            <button
              id="ava-rejoin"
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
            id="ava-leave-joining"
            type="button"
            className="ava-btn ava-btn--ghost"
            onClick={leave}
          >
            Leave
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="ava-root ava-root--phone">
      <main className="ava-phone">
        <header className="ava-phone__head">
          <div className="ava-phone__me">
            <Token color={player.color} photo={photos[player.id]} />
            <strong>{player.name}</strong>
            {state.leaderId === player.id && state.phase !== 'lobby' && (
              <span className="ava-pill ava-pill--gold">
                <LeaderCrown /> Leader
              </span>
            )}
          </div>
          <span className="ava-phone__room">Room {state.code}</span>
        </header>

        {/* Secret Character Card (Hold to Reveal) */}
        {secret && state.phase !== 'lobby' && (
          <RolePeekCard state={state} secret={secret} photos={photos} defaultPrompt={state.phase === 'night'} />
        )}

        {notice && (
          <p className="ava-error" role="alert">
            {notice}
          </p>
        )}

        <PhoneStage
          state={state}
          me={player}
          secret={secret}
          photos={photos}
          send={send}
          setNotice={setNotice}
        />

        {lost && <p className="ava-muted ava-tiny ava-text-center">Reconnecting…</p>}
      </main>
    </div>
  );
}

function RolePeekCard({
  state,
  secret,
  photos,
  defaultPrompt,
}: {
  state: AvaState;
  secret: RoleSecretMsg;
  photos: Photos;
  defaultPrompt: boolean;
}) {
  const [peeking, setPeeking] = useState(false);
  const byId = useMemo(() => new Map(state.players.map((p) => [p.id, p])), [state.players]);
  const seenPlayers = secret.seenIds.map((id) => byId.get(id)).filter(Boolean) as AvaPlayer[];

  useEffect(() => {
    if (!peeking) return;
    const stop = () => setPeeking(false);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
    };
  }, [peeking]);

  return (
    <section className="ava-peek">
      <button
        id="ava-hold-reveal"
        type="button"
        className={`ava-peek__btn ${peeking ? 'ava-peek__btn--active' : ''} ${
          defaultPrompt ? 'ava-peek__btn--pulse' : ''
        }`}
        onPointerDown={() => setPeeking(true)}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') setPeeking(true);
        }}
        onKeyUp={() => setPeeking(false)}
      >
        <span>
          {peeking ? 'Release to Conceal Character Card' : 'Press & Hold to Inspect Character Card'}
        </span>
      </button>

      {peeking && (
        <div
          className={`ava-secret-card ava-secret-card--${secret.alignment}`}
          role="region"
          aria-label="Your Secret Character Card"
        >
          <div className="ava-secret-card__header">
            <RoleEmblem role={secret.role} alignment={secret.alignment} className="ava-secret-card__emblem" />
            <div>
              <span className={`ava-pill ava-pill--${secret.alignment}`}>
                {secret.alignment === 'good'
                  ? 'Loyal Servant of Arthur (Good)'
                  : 'Minion of Mordred (Evil)'}
              </span>
              <h2 className="ava-secret-card__name">{secret.name}</h2>
            </div>
          </div>
          <p className="ava-secret-card__power">{secret.power}</p>

          <div className="ava-secret-card__sightings">
            <span className="ava-kicker">{secret.seenLabel}</span>
            {seenPlayers.length > 0 ? (
              <ul className="ava-seen-list">
                {seenPlayers.map((p) => (
                  <li key={p.id} className="ava-seen-chip">
                    <Token color={p.color} photo={photos[p.id]} />
                    <strong>{p.name}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ava-tiny ava-muted">{secret.seenNote}</p>
            )}
            {seenPlayers.length > 0 && <p className="ava-tiny ava-muted">{secret.seenNote}</p>}
          </div>
        </div>
      )}
    </section>
  );
}

function SelfiePicker({
  me,
  photo,
  send,
  setNotice,
}: {
  me: AvaPlayer;
  photo?: string;
  send: (msg: object) => void;
  setNotice: (s: string | null) => void;
}) {
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
    <div className="ava-selfie">
      <KnightPawn color={me.color} photo={photo} className="ava-selfie__pawn" />
      <input
        ref={input}
        id="ava-selfie-input"
        type="file"
        accept="image/*"
        capture="user"
        hidden
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <div className="ava-row">
        <button
          id="ava-selfie-btn"
          type="button"
          className="ava-btn ava-btn--ghost ava-btn--small"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? 'Saving…' : photo ? 'Retake Portrait' : 'Add Portrait to Shield'}
        </button>
        {photo && (
          <button
            id="ava-selfie-remove"
            type="button"
            className="ava-btn ava-btn--ghost ava-btn--small"
            onClick={() => send({ type: 'selfie', data: null })}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function PhoneStage({
  state,
  me,
  secret,
  photos,
  send,
  setNotice,
}: {
  state: AvaState;
  me: AvaPlayer;
  secret: RoleSecretMsg | null;
  photos: Photos;
  send: (msg: object) => void;
  setNotice: (s: string | null) => void;
}) {
  const byId = useMemo(() => new Map(state.players.map((p) => [p.id, p])), [state.players]);
  const isLeader = state.leaderId === me.id;
  const [assassinPick, setAssassinPick] = useState<string | null>(null);

  if (state.phase === 'lobby') {
    const seatNum = state.players.findIndex((p) => p.id === me.id) + 1;
    return (
      <section className="ava-panel ava-phone-card">
        <SelfiePicker me={me} photo={photos[me.id]} send={send} setNotice={setNotice} />
        <p className="ava-sub ava-text-center">
          Seated at <strong>Seat #{seatNum}</strong> ({state.players.length} / {state.maxPlayers} Knights).
        </p>
        <p className="ava-muted ava-tiny ava-text-center">
          Waiting for the host to deal Character Cards on the TV…
        </p>
        <details className="ava-drawer">
          <summary className="ava-drawer__summary">Rulebook Summary</summary>
          <HowToList />
        </details>
      </section>
    );
  }

  if (state.phase === 'night') {
    const amReady = state.nightReadyIds.includes(me.id);
    return (
      <section className="ava-panel ava-phone-card">
        <span className="ava-kicker">Night Reveal Ceremony</span>
        <h2 className="ava-h2">Inspect Your Loyalty &amp; Close Your Eyes</h2>
        <p className="ava-sub">
          1. Press and hold the button above to secretly view your Character Card.
          <br />
          2. Close your eyes and extend your hand into a fist while the TV reads the script.
          <br />
          3. Tap <strong>Ready</strong> when the ceremony concludes.
        </p>
        <button
          id="ava-night-ready"
          type="button"
          className="ava-btn ava-btn--primary ava-btn--big"
          disabled={amReady}
          onClick={() => {
            vibrate(25);
            send({ type: 'ready' });
          }}
        >
          {amReady
            ? `Ready (${state.nightReadyIds.length}/${state.players.length})`
            : 'I Know My Loyalty · Ready'}
        </button>
      </section>
    );
  }

  if (state.phase === 'team_building') {
    const leader = state.leaderId ? byId.get(state.leaderId) : undefined;
    if (!isLeader) {
      const draftNames = state.draftTeam.map((id) => byId.get(id)?.name).filter(Boolean);
      return (
        <section className="ava-panel ava-phone-card">
          <span className="ava-kicker">
            Quest {state.round} · Vote Track {state.proposal} of 5
          </span>
          <h2 className="ava-h2">{leader?.name ?? 'The Leader'} Holds the Leader Token</h2>
          <p className="ava-sub">
            The Leader is assigning <strong>{state.questSize} Team Tokens</strong> for this Quest.
          </p>
          {draftNames.length > 0 && (
            <div className="ava-stage__pills">
              {draftNames.map((n) => (
                <span key={n} className="ava-pill ava-pill--gold">
                  {n}
                </span>
              ))}
            </div>
          )}
        </section>
      );
    }

    const toggleMember = (pid: string) => {
      const cur = new Set(state.draftTeam);
      if (cur.has(pid)) cur.delete(pid);
      else {
        if (cur.size >= state.questSize) return;
        cur.add(pid);
      }
      send({ type: 'select_team', teamIds: Array.from(cur) });
    };

    const exact = state.draftTeam.length === state.questSize;

    return (
      <section className="ava-panel ava-phone-card">
        <span className="ava-kicker">
          You Hold the Leader Token · Quest {state.round}
        </span>
        <h2 className="ava-h2">
          Assign {state.questSize} Team Tokens ({state.draftTeam.length}/{state.questSize})
        </h2>
        <div className="ava-pick-grid">
          {state.players.map((p) => {
            const picked = state.draftTeam.includes(p.id);
            return (
              <button
                key={p.id}
                id={`ava-pick-${p.id}`}
                type="button"
                aria-pressed={picked}
                className={`ava-pick-btn ${picked ? 'ava-pick-btn--on' : ''}`}
                onClick={() => toggleMember(p.id)}
              >
                <Token color={p.color} photo={photos[p.id]} />
                <span>{p.name}</span>
                <strong>{picked ? '✓' : '+'}</strong>
              </button>
            );
          })}
        </div>
        <button
          id="ava-propose-team"
          type="button"
          className="ava-btn ava-btn--primary ava-btn--big"
          disabled={!exact}
          onClick={() => {
            vibrate(35);
            send({ type: 'propose_team', teamIds: state.draftTeam });
          }}
        >
          {exact
            ? `Call for Team Vote (${state.questSize} Knights)`
            : `Assign ${state.questSize - state.draftTeam.length} More`}
        </button>
      </section>
    );
  }

  if (state.phase === 'team_vote') {
    const myVote = secret?.myVote;
    const teamNames = state.proposedTeam.map((id) => byId.get(id)?.name).filter(Boolean);
    return (
      <section className="ava-panel ava-phone-card">
        <span className="ava-kicker">
          Quest {state.round} · Vote Track {state.proposal} of 5
        </span>
        <h2 className="ava-h2">Choose Your Vote Token</h2>
        <p className="ava-sub">
          Proposed Team: <strong>{teamNames.join(', ')}</strong>
        </p>
        <div className="ava-vote-buttons">
          <button
            id="ava-vote-approve"
            type="button"
            aria-pressed={myVote === true}
            className={`ava-vote-card ava-vote-card--approve ${
              myVote === true ? 'ava-vote-card--selected' : ''
            }`}
            onClick={() => {
              vibrate(25);
              send({ type: 'vote', approve: true });
            }}
          >
            <VoteTokenBadge approve={true} size="lg" />
            <span className="ava-tiny">Accept this Quest Team</span>
          </button>
          <button
            id="ava-vote-reject"
            type="button"
            aria-pressed={myVote === false}
            className={`ava-vote-card ava-vote-card--reject ${
              myVote === false ? 'ava-vote-card--selected' : ''
            }`}
            onClick={() => {
              vibrate(25);
              send({ type: 'vote', approve: false });
            }}
          >
            <VoteTokenBadge approve={false} size="lg" />
            <span className="ava-tiny">Reject &amp; pass Leader Token</span>
          </button>
        </div>
        {myVote !== null && myVote !== undefined && (
          <p className="ava-muted ava-tiny ava-text-center">
            Vote Token placed facedown ({state.votedIds.length}/{state.players.length} ready).
          </p>
        )}
      </section>
    );
  }

  if (state.phase === 'team_reveal' && state.lastVoteReveal) {
    const rev = state.lastVoteReveal;
    return (
      <section className="ava-panel ava-phone-card">
        <span className="ava-kicker">Vote Tokens Revealed</span>
        <h2 className="ava-h2">
          {rev.approved
            ? `Vote Approved (${rev.approves}–${rev.rejects})`
            : `Vote Rejected (${rev.approves}–${rev.rejects})`}
        </h2>
        <p className="ava-sub">
          {rev.approved
            ? 'The Quest Team embarks on the Quest!'
            : 'The Leader Token passes clockwise.'}
        </p>
        {isLeader && (
          <button
            id="ava-phone-advance-vote"
            type="button"
            className="ava-btn ava-btn--primary ava-btn--big"
            onClick={() => send({ type: 'advance' })}
          >
            {rev.approved ? 'Begin Quest Phase →' : 'Pass Leader Token →'}
          </button>
        )}
      </section>
    );
  }

  if (state.phase === 'quest') {
    const onTeam = state.proposedTeam.includes(me.id);
    const played = state.questSubmittedIds.includes(me.id);
    const isEvil = secret?.alignment === 'evil';

    if (!onTeam) {
      return (
        <section className="ava-panel ava-phone-card">
          <span className="ava-kicker">Quest {state.round} Phase</span>
          <h2 className="ava-h2">Quest Cards Being Played…</h2>
          <p className="ava-sub">
            The Quest Team is secretly placing their Quest Cards ({state.questSubmittedIds.length}/
            {state.proposedTeam.length} played).
          </p>
        </section>
      );
    }

    if (played) {
      return (
        <section className="ava-panel ava-phone-card">
          <span className="ava-kicker">Quest {state.round}</span>
          <h2 className="ava-h2">Quest Card Placed Facedown</h2>
          <p className="ava-sub">
            Waiting for the remaining Quest members ({state.questSubmittedIds.length}/
            {state.proposedTeam.length})…
          </p>
        </section>
      );
    }

    return (
      <section className="ava-panel ava-phone-card">
        <span className="ava-kicker">You Hold a Team Token · Quest {state.round}</span>
        <h2 className="ava-h2">Select Your Quest Card</h2>
        <p className="ava-sub">
          {isEvil
            ? 'As an agent of Evil, you may play either Quest Success or Quest Fail.'
            : 'Note: The Good players must select the Quest Success card.'}
        </p>
        <div className="ava-vote-buttons">
          <QuestChaliceCard
            id="ava-quest-success"
            kind="success"
            interactive
            onClick={() => {
              vibrate(35);
              send({ type: 'quest_card', success: true });
            }}
          />
          <QuestChaliceCard
            id="ava-quest-fail"
            kind="fail"
            interactive
            disabled={!isEvil}
            onClick={() => {
              vibrate(35);
              send({ type: 'quest_card', success: false });
            }}
          />
        </div>
      </section>
    );
  }

  if (state.phase === 'quest_reveal' && state.lastQuestReveal) {
    const q = state.lastQuestReveal;
    return (
      <section className="ava-panel ava-phone-card">
        <span className="ava-kicker">Quest {q.quest} Resolved</span>
        <h2 className={`ava-h2 ${q.succeeded ? 'ava-text--good' : 'ava-text--evil'}`}>
          {q.succeeded ? 'Quest Succeeded!' : 'Quest Failed!'}
        </h2>
        <p className="ava-sub">
          {q.successCount} Success · {q.failCount} Fail
        </p>
        {isLeader && (
          <button
            id="ava-phone-advance-quest"
            type="button"
            className="ava-btn ava-btn--primary ava-btn--big"
            onClick={() => send({ type: 'advance' })}
          >
            Next Round →
          </button>
        )}
      </section>
    );
  }

  if (state.phase === 'assassinate') {
    const amAssassin = state.assassinId === me.id;
    const candidates = state.players.filter(
      (p) => p.id !== me.id && !state.evilDiscussIds.includes(p.id),
    );
    if (!amAssassin) {
      const assassinName = state.assassinId ? byId.get(state.assassinId)?.name : 'The Assassin';
      return (
        <section className="ava-panel ava-phone-card">
          <span className="ava-kicker">Assassinate Merlin — Evil’s Last Chance</span>
          <h2 className="ava-h2 ava-text--evil">The Assassin Hunts Merlin</h2>
          <p className="ava-sub">
            <strong>{assassinName}</strong> is naming one Good player as Merlin!
          </p>
        </section>
      );
    }

    return (
      <section className="ava-panel ava-phone-card">
        <span className="ava-kicker">You Hold the Assassin Card</span>
        <h2 className="ava-h2 ava-text--evil">Name Merlin</h2>
        <p className="ava-sub">
          Consult with your fellow Minions of Mordred, then select one Good player to assassinate:
        </p>
        <div className="ava-pick-grid">
          {candidates.map((p) => {
            const picked = assassinPick === p.id;
            return (
              <button
                key={p.id}
                id={`ava-assassinate-${p.id}`}
                type="button"
                aria-pressed={picked}
                className={`ava-pick-btn ${picked ? 'ava-pick-btn--danger' : ''}`}
                onClick={() => setAssassinPick(p.id)}
              >
                <Token color={p.color} photo={photos[p.id]} />
                <span>{p.name}</span>
                <strong>{picked ? '✓' : ''}</strong>
              </button>
            );
          })}
        </div>
        <button
          id="ava-confirm-assassinate"
          type="button"
          className="ava-btn ava-btn--danger ava-btn--big"
          disabled={!assassinPick}
          onClick={() => {
            if (!assassinPick) return;
            vibrate([40, 60, 40]);
            send({ type: 'assassinate', targetId: assassinPick });
          }}
        >
          {assassinPick
            ? `Assassinate ${byId.get(assassinPick)?.name ?? ''}`
            : 'Choose a Player'}
        </button>
      </section>
    );
  }

  if (state.phase === 'gameover') {
    const myAlignment = secret?.alignment ?? 'good';
    const won = state.winner === myAlignment;
    return (
      <section className="ava-panel ava-phone-card">
        <span className={`ava-pill ava-pill--${state.winner ?? 'good'}`}>
          {won ? 'Victory' : 'Defeat'}
        </span>
        <h2 className="ava-h2">
          {state.winner === 'good'
            ? 'Loyal Servants of Arthur Win!'
            : 'Minions of Mordred Win!'}
        </h2>
        <p className="ava-sub">{state.winReason}</p>
      </section>
    );
  }

  return null;
}
