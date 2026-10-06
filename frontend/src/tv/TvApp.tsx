import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Curse, GameLength, PlanchetteState, Player, RelicEvent, ServerMsg, StateMsg } from '../protocol';
import { useGameSocket } from '../useGameSocket';
import { sound } from './audio';
import { Board, type Bettor } from './Board';
import { Countdown } from './Countdown';
import { QrCode } from './QrCode';
import { useSeanceAudio, useSoundSettings } from './useSeanceAudio';

/** /tv?dev=1 shows testing shortcuts (e.g. hand everyone every Relic). */
const DEV = new URLSearchParams(location.search).get('dev') === '1';

/**
 * This tab's room code, so a refreshed TV gets its room back. The code is public
 * (it's on screen); the server only hands the room back to the browser that made
 * it, checked with its HttpOnly device cookie.
 */
const ROOM_KEY = 'sb-tv-room';
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
    // Without sessionStorage a refresh just makes a new room.
  }
}

const REVEAL_QUIPS = [
  'The spirits are never wrong.',
  'No take-backs.',
  'Somebody check on them.',
  'The board has made its choice.',
  'You heard the dead.',
  'It’s in writing now. Spirit writing.',
];

export function TvApp() {
  const [state, setState] = useState<StateMsg | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retries, setRetries] = useState(0);
  const planchetteRef = useRef<PlanchetteState | null>(null);

  const onMessage = useCallback((msg: ServerMsg) => {
    if (msg.type === 'state') {
      setState(msg);
      planchetteRef.current = msg.planchette;
    } else if (msg.type === 'tick') {
      planchetteRef.current = msg;
    } else if (msg.type === 'created') {
      saveRoom(msg.code);
      setRetries(0);
    } else if (msg.type === 'error') {
      setError(msg.message);
    }
  }, []);

  // Recomputed per attempt (not when the code arrives, which would reconnect).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const firstMessage = useMemo(() => JSON.stringify({ type: 'create', resume: savedRoom() }), [attempt]);
  const { status, send } = useGameSocket('/ws/tv', firstMessage, onMessage, attempt);
  useSeanceAudio(state, planchetteRef);

  // Dropped (Wi-Fi blip, server restart): quietly retry with backoff.
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
      <main className="tv tv--center">
        <h1 className="tv__title">The séance was interrupted</h1>
        <p className="tv__sub">{error ?? 'Lost connection to the spirit realm.'}</p>
        <div className="tv__row">
          {!error && (
            <button
              id="tv-reconnect"
              className="btn btn--primary"
              onClick={() => {
                setRetries(0);
                setAttempt((n) => n + 1);
              }}
            >
              Reconnect
            </button>
          )}
          <button
            id="tv-restart"
            className={error ? 'btn btn--primary' : 'btn btn--ghost'}
            onClick={() => {
              saveRoom(null);
              location.reload();
            }}
          >
            Start a new séance
          </button>
        </div>
      </main>
    );
  } else if (!state) {
    screen = (
      <main className="tv tv--center">
        <p className="tv__sub tv__summoning">Summoning…</p>
      </main>
    );
  } else if (state.phase === 'lobby') screen = <Lobby state={state} send={send} />;
  else if (state.phase === 'results') screen = <Results state={state} send={send} />;
  else screen = <Seance state={state} send={send} planchetteRef={planchetteRef} />;

  return (
    <>
      {screen}
      {lost && retries < MAX_RETRIES && state && (
        <p className="tv__reconnecting" role="status">
          Reconnecting to the spirit realm…
        </p>
      )}
      <SoundBar />
    </>
  );
}

/** Sound + narrator toggles, top-left on every TV screen. */
function SoundBar() {
  useSoundSettings();
  return (
    <div className="soundbar">
      {sound.soundOn && !sound.awake && (
        <button id="tv-wake" className="soundbar__hint" onClick={() => sound.wake()}>
          🔈 Click anywhere for sound
        </button>
      )}
      <button
        id="tv-sound"
        className="soundbar__btn"
        aria-pressed={sound.soundOn}
        aria-label={sound.soundOn ? 'Sound on' : 'Sound off'}
        title={sound.soundOn ? 'Mute' : 'Unmute'}
        onClick={() => {
          sound.wake();
          sound.setSound(!sound.soundOn);
        }}
      >
        {sound.soundOn ? '🔊' : '🔇'}
      </button>
      <button
        id="tv-narrate"
        className="soundbar__btn"
        aria-pressed={sound.narrateOn}
        aria-label={sound.narrateOn ? 'Narrator on' : 'Narrator off'}
        title={sound.narrateOn ? 'The TV reads questions and cards aloud' : 'Narrator off'}
        disabled={!sound.soundOn}
        onClick={() => {
          sound.wake();
          sound.setNarrate(!sound.narrateOn);
        }}
      >
        🗣️
      </button>
    </div>
  );
}

type Send = (msg: object) => void;

function Lobby({ state, send }: { state: StateMsg; send: Send }) {
  const joinUrl = `${location.host}/play`;
  const humans = state.players.filter((p) => !p.isBot).length;
  const bots = state.players.length - humans;
  const needed = Math.max(0, state.minPlayers - state.players.length);
  const hasScores = state.players.some((p) => p.score > 0);

  return (
    <main className="tv lobby">
      <header className="lobby__head">
        <h1 className="tv__title">Spirit Board</h1>
        <p className="tv__sub">Grab your phone. Join the séance.</p>
      </header>

      <section className="lobby__join" aria-label="How to join">
        <div className="lobby__scan">
          <QrCode
            value={`${location.origin}/play?code=${state.code}`}
            className="lobby__qr"
            label={`QR code to join room ${state.code}`}
          />
          <p className="lobby__step">Scan to join</p>
        </div>
        <div className="lobby__manual">
          <p className="lobby__step">
            or go to <strong className="lobby__url">{joinUrl}</strong>
          </p>
          <p className="lobby__step">and enter the code</p>
          <p className="lobby__code" aria-label={`Room code ${state.code.split('').join(' ')}`}>
            {state.code}
          </p>
        </div>
      </section>

      <section className="lobby__players" aria-label="Players">
        <h2 className="lobby__count">
          {state.players.length} / {state.maxPlayers} spirits gathered
        </h2>
        <ul className="roster">
          {state.players.map((p) => (
            <li key={p.id} className="roster__item" data-offline={p.connected ? undefined : ''}>
              <span className="avatar" style={{ backgroundColor: p.color }} aria-hidden="true" />
              <span className="roster__name">{p.name}</span>
              {p.isBot && <span className="roster__tag">bot</span>}
              {!p.connected && <span className="roster__tag">away</span>}
              {hasScores && <span className="roster__score">🍬 {p.score}</span>}
              <button
                id={`kick-${p.id}`}
                className="roster__kick"
                aria-label={`Remove ${p.name}`}
                onClick={() => send({ type: 'kick', playerId: p.id })}
              >
                ×
              </button>
            </li>
          ))}
          {state.players.length === 0 && <li className="roster__empty">Waiting for the first brave soul…</li>}
        </ul>
      </section>

      <footer className="lobby__controls">
        <div className="lobby__dev">
          <button
            id="tv-add-bot"
            className="btn btn--ghost"
            onClick={() => send({ type: 'add_bot' })}
            disabled={state.players.length >= state.maxPlayers}
          >
            + Add a bot
          </button>
          <button id="tv-remove-bot" className="btn btn--ghost" onClick={() => send({ type: 'remove_bot' })} disabled={bots === 0}>
            − Remove a bot
          </button>
        </div>
        <div className="lobby__start">
          {state.game.active ? (
            <button id="tv-start" className="btn btn--primary btn--big" onClick={() => send({ type: 'start_round' })} disabled={!state.canStart}>
              Continue · Round {state.game.round + 1} of {state.game.totalRounds}
            </button>
          ) : (
            <button id="tv-start" className="btn btn--primary btn--big" onClick={() => send({ type: 'new_game' })} disabled={!state.canStart}>
              Begin the Séance
            </button>
          )}
          {needed > 0 && (
            <p className="lobby__hint">
              Need {needed} more {needed === 1 ? 'spirit' : 'spirits'} to begin.
            </p>
          )}
        </div>
        <div className="lobby__settings">
          {state.game.active ? (
            <button id="tv-new-game" className="btn btn--ghost" onClick={() => send({ type: 'new_game' })} disabled={!state.canStart}>
              Start over
            </button>
          ) : (
            <div className="seg" role="radiogroup" aria-label="Game length">
              {(Object.keys(state.game.lengths) as GameLength[]).map((len) => (
                <button
                  key={len}
                  id={`len-${len}`}
                  className="seg__btn"
                  role="radio"
                  aria-checked={state.game.length === len}
                  onClick={() => send({ type: 'set_length', length: len })}
                >
                  <span className="seg__name">{len}</span>
                  <span className="seg__sub">{state.game.lengths[len]} rounds</span>
                </button>
              ))}
            </div>
          )}
          <button
            id="tv-curses"
            className="btn btn--ghost lobby__toggle"
            aria-pressed={state.game.cursesOn}
            onClick={() => send({ type: 'set_curses', on: !state.game.cursesOn })}
          >
            💀 Curses {state.game.cursesOn ? 'on' : 'off'}
          </button>
          <button
            id="tv-starter"
            className="btn btn--ghost lobby__toggle"
            aria-pressed={state.game.starterRelics}
            onClick={() => send({ type: 'set_starter_relics', on: !state.game.starterRelics })}
          >
            🧿 Starter Relics {state.game.starterRelics ? 'on' : 'off'}
          </button>
          <button
            id="tv-catchup"
            className="btn btn--ghost lobby__toggle"
            aria-pressed={state.game.catchupRelics}
            onClick={() => send({ type: 'set_catchup_relics', on: !state.game.catchupRelics })}
            title="Last place after rounds 3 and 6 gets a free Common Relic"
          >
            🕯️ Catch-up Relics {state.game.catchupRelics ? 'on' : 'off'}
          </button>
          {DEV && (
            <button id="tv-dev-relics" className="btn btn--ghost lobby__toggle" onClick={() => send({ type: 'dev_grant_relics' })}>
              🧪 Give everyone all Relics
            </button>
          )}
        </div>
      </footer>
    </main>
  );
}

function Seance({
  state,
  send,
  planchetteRef,
}: {
  state: StateMsg;
  send: Send;
  planchetteRef: RefObject<PlanchetteState | null>;
}) {
  const colorsBySpot = useMemo(() => Object.fromEntries(state.players.map((p) => [p.id, p.color])), [state.players]);
  const result = state.spots.find((s) => s.id === state.resultSpotId);
  const quip = useMemo(() => REVEAL_QUIPS[state.roundNo % REVEAL_QUIPS.length], [state.roundNo]);
  const reveal = state.reveal;
  const kind = state.game.roundKind ?? 'bets';
  const medium = state.players.find((p) => p.id === state.medium?.playerId);
  const mediumAnswer = state.spots.find((s) => s.id === reveal?.mediumAnswer);
  const cursed = state.players.find((p) => p.id === state.curse?.playerId);
  const newCurse = state.curse && state.curse.roundNo === state.roundNo ? state.curse : null;

  const bettors = useMemo(() => {
    if (!reveal) return undefined;
    const bySpot: Record<string, Bettor[]> = {};
    for (const p of state.players) {
      const spot = reveal.bets[p.id];
      if (spot) (bySpot[spot] ??= []).push({ id: p.id, color: p.color, auto: reveal.autoBets.includes(p.id) });
    }
    return bySpot;
  }, [reveal, state.players]);

  const nextIsFinal = state.game.round === state.game.totalRounds - 1;
  const nextLabel = state.game.isLastRound ? 'See the results' : nextIsFinal ? 'The Final Séance' : 'Next question';
  const freshRelics = useFreshRelics(state.relicEvents);
  const scared = freshRelics.some((e) => e.key === 'jumpscare');

  return (
    <main className="tv seance" data-phase={state.phase} data-kind={kind} data-scare={scared ? '' : undefined}>
      <header className="seance__head">
        <p className="seance__round">
          {kind === 'final' ? (
            <>🕯️ The Final Séance · 3× pot</>
          ) : (
            <>
              {kind === 'medium' && '🔮 The Medium · '}Round {state.game.round} of {state.game.totalRounds - 1}
            </>
          )}
        </p>
        <h1 className="seance__question">{state.question?.text}</h1>
        {kind !== 'medium' && state.phase !== 'reveal' && <PotBadge pot={state.pot} bonus={state.potBonus} />}
        {state.phase !== 'reveal' && state.curse && cursed && (
          <p className="cursechip" aria-label={`${cursed.name} is cursed: ${state.curse.text}`}>
            <span className="cursechip__who">
              💀 <strong style={{ color: cursed.color }}>{cursed.name}</strong> is cursed
            </span>
            <span className="cursechip__text">{state.curse.text}</span>
          </p>
        )}
      </header>

      <div className="seance__board">
        <Board
          board={state.board}
          spots={state.spots}
          planchetteRef={planchetteRef}
          resultSpotId={state.resultSpotId}
          colorsBySpot={colorsBySpot}
          bettors={bettors}
          markSpot={mediumAnswer && medium ? { id: mediumAnswer.id, color: medium.color } : undefined}
          salted={state.phase === 'reveal' ? undefined : state.effects.salted}
          magnets={state.phase === 'reveal' ? undefined : state.effects.magnets}
        />
        {state.phase === 'medium' && medium && (
          <div className="seance__overlay seance__overlay--bets" role="status">
            <p className="seance__ready">
              🔮 <strong style={{ color: medium.color }}>{medium.name}</strong> is consulting the spirits…
            </p>
            <Countdown key={`m${state.roundNo}`} seconds={state.phaseEndsIn ?? 0} className="seance__count" />
            <p className="seance__sub">Everyone else: get ready to read their mind.</p>
          </div>
        )}
        {state.phase === 'question' && (
          <div className="seance__overlay seance__overlay--bets" role="status">
            <p className="seance__ready">
              {medium ? (
                <>
                  What did <strong style={{ color: medium.color }}>{medium.name}</strong> answer?
                </>
              ) : (
                'Place your secret bets'
              )}
            </p>
            <Countdown key={`q${state.roundNo}`} seconds={state.phaseEndsIn ?? 0} className="seance__count" />
            <ul className="betters" aria-label="Who has bet">
              {state.players
                .filter((p) => p.id !== medium?.id)
                .map((p) => (
                  <li key={p.id} className="betters__item" data-bet={p.hasBet || p.isBot ? '' : undefined}>
                    <span className="avatar" style={{ backgroundColor: p.color }} aria-hidden="true" />
                    <span className="betters__name">{p.name}</span>
                  </li>
                ))}
            </ul>
          </div>
        )}
        {state.phase === 'reveal' && result && (
          <div className="seance__overlay seance__overlay--reveal" role="status">
            <p className="seance__spoken">The spirits have spoken…</p>
            <p className="seance__answer">{result.label}</p>
          </div>
        )}
        {state.phase === 'reveal' && newCurse && cursed && (
          <CurseCard key={newCurse.roundNo} curse={newCurse} victim={cursed} />
        )}
        <RelicCards state={state} events={freshRelics} />
      </div>

      <footer className="seance__foot">
        {state.phase === 'pull' && (
          <>
            {medium && <p className="seance__sub seance__center">{medium.name} can’t touch the planchette. Pull for what you think they picked.</p>}
            <EffectsLine state={state} />
            <Countdown key={`p${state.roundNo}`} seconds={state.phaseEndsIn ?? 0} bar className="seance__timer" />
          </>
        )}
        {state.phase === 'reveal' && (
          <>
            {kind === 'medium' && medium && mediumAnswer ? (
              <MediumVerdict state={state} medium={medium} answer={mediumAnswer.label} />
            ) : (
              <div className="seance__verdict" role="status">
                <p className="seance__payout">{payoutLine(state)}</p>
                <p className="seance__quip">{autoTease(state) ?? quip}</p>
              </div>
            )}
            <PityLine state={state} />
            <Scoreboard state={state} />
            <div className="seance__actions">
              <button id="tv-back" className="btn btn--ghost" onClick={() => send({ type: 'back_to_lobby' })}>
                Back to lobby
              </button>
              <button id="tv-next" className="btn btn--primary btn--big" onClick={() => send({ type: 'start_round' })} disabled={!state.canStart}>
                {nextLabel}
              </button>
            </div>
          </>
        )}
      </footer>
    </main>
  );
}

function MediumVerdict({ state, medium, answer }: { state: StateMsg; medium: Player; answer: string }) {
  const reveal = state.reveal!;
  const correct = state.players.filter((p) => reveal.correct?.includes(p.id));
  return (
    <div className="seance__verdict" role="status">
      <p className="seance__payout">
        {medium.name} {reveal.mediumAuto ? 'froze, so the spirits answered' : 'answered'}: <strong className="seance__medans">{answer}</strong>
        {reveal.boardMatched ? ' · The board agrees! +100 to everyone' : ''}
      </p>
      <p className="seance__quip">
        {correct.length === 0
          ? `Nobody read ${medium.name}’s mind.`
          : `${names(correct.map((p) => p.name))} read their mind. +100 each`}
        {' · '}
        <span className="seance__explain">
          {medium.name}… explain yourself. <Countdown key={`x${state.roundNo}`} seconds={15} className="seance__xcount" />
        </span>
      </p>
    </div>
  );
}

function Results({ state, send }: { state: StateMsg; send: Send }) {
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  const byId = Object.fromEntries(state.players.map((p) => [p.id, p]));
  const awards = state.awards ?? [];
  const finalCurse = state.finalCurse;
  return (
    <main className="tv results">
      <header className="results__head">
        <p className="seance__round">The séance is over</p>
        <h1 className="tv__title">The spirits have judged you</h1>
      </header>

      <ol className="standings" aria-label="Final standings">
        {ranked.map((p, i) => (
          <li key={p.id} className="standings__item" data-rank={i + 1} style={{ animationDelay: `${(ranked.length - i) * 220}ms` }}>
            <span className="standings__rank">{i + 1}</span>
            <span className="avatar" style={{ backgroundColor: p.color }} aria-hidden="true" />
            <span className="standings__name">{p.name}</span>
            <span className="standings__haunt" aria-label={`${p.haunted} haunted marks`}>
              {'💀'.repeat(Math.min(p.haunted, 5))}
            </span>
            <span className="standings__score">🍬 {p.score}</span>
          </li>
        ))}
      </ol>

      <ul className="awards" aria-label="Awards">
        {awards.map((a, i) => (
          <li key={a.key} className="award" style={{ animationDelay: `${ranked.length * 220 + 400 + i * 350}ms` }}>
            <span className="award__emoji" aria-hidden="true">
              {a.emoji}
            </span>
            <span className="award__title">{a.title}</span>
            <span className="award__who">{names(a.playerIds.map((id) => byId[id]?.name ?? '?'))}</span>
            <span className="award__blurb">{a.blurb}</span>
          </li>
        ))}
      </ul>

      {finalCurse && (
        <p className="results__curse">
          💀 <strong>{names(finalCurse.playerIds.map((id) => byId[id]?.name ?? '?'))}</strong>, the Final Curse is yours:{' '}
          <em>{finalCurse.text}</em>
        </p>
      )}

      <footer className="results__actions">
        <button id="tv-results-lobby" className="btn btn--ghost" onClick={() => send({ type: 'back_to_lobby' })}>
          Back to lobby
        </button>
        <button id="tv-play-again" className="btn btn--primary btn--big" onClick={() => send({ type: 'new_game' })} disabled={state.players.length < state.minPlayers}>
          Play again
        </button>
      </footer>
    </main>
  );
}

/** The board deals a curse: a big card over the board the host reads out. */
function CurseCard({ curse, victim }: { curse: Curse; victim: Player }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div className="seance__overlay cursecard" role="alertdialog" aria-labelledby="curse-title" aria-describedby="curse-text">
      <p id="curse-title" className="cursecard__head">
        💀 The board has cursed <strong style={{ color: victim.color }}>{victim.name}</strong>
      </p>
      <p id="curse-text" className="cursecard__text">
        {curse.drink && (
          <span className="cursecard__drink" aria-label="Drinking card">
            🍺{' '}
          </span>
        )}
        {curse.text}
      </p>
      {curse.drink && curse.alt && (
        <p className="cursecard__alt">
          <span className="cursecard__or">or</span> {curse.alt}
        </p>
      )}
      <p className="cursecard__foot">The curse holds until the next reveal.</p>
      <button id="tv-curse-ok" className="btn btn--primary" onClick={() => setOpen(false)}>
        So it is written
      </button>
    </div>
  );
}

/** How long a Relic card stays up on the TV. Whispers linger so people can read them. */
const RELIC_CARD_MS = { default: 4500, whisper: 7000 };
const cardMs = (e: RelicEvent) => (e.key === 'whisper' ? RELIC_CARD_MS.whisper : RELIC_CARD_MS.default);

/** The Relic events that were cast recently enough to still be on screen. */
function useFreshRelics(events: RelicEvent[]): RelicEvent[] {
  const firstSeen = useRef(new Map<number, number>());
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    const t = performance.now();
    for (const e of events) if (!firstSeen.current.has(e.seq)) firstSeen.current.set(e.seq, t);
    setNow(t);
  }, [events]);

  const fresh = events.filter((e) => {
    const seen = firstSeen.current.get(e.seq);
    return seen === undefined || now - seen < cardMs(e);
  });

  // Re-render when the next card should leave.
  useEffect(() => {
    if (fresh.length === 0) return;
    const ends = fresh.map((e) => (firstSeen.current.get(e.seq) ?? now) + cardMs(e));
    const wait = Math.max(50, Math.min(...ends) - performance.now());
    const id = setTimeout(() => setNow(performance.now()), wait);
    return () => clearTimeout(id);
  });

  return fresh.slice(-3);
}

/** Big announcements when someone uses a Relic: who, on whom, and what it does. */
function RelicCards({ state, events }: { state: StateMsg; events: RelicEvent[] }) {
  if (events.length === 0) return null;
  const player = (id: string | null) => state.players.find((p) => p.id === id);
  const spotLabel = (id: string | null) => state.spots.find((s) => s.id === id)?.label ?? '?';
  const whispers = events.filter((e) => e.key === 'whisper');
  // Everything else goes beside the board, so it doesn't hide the planchette mid-pull.
  const casts = events.filter((e) => e.key !== 'whisper');
  return (
    <>
      {whispers.length > 0 && (
        <ol className="relicfeed relicfeed--center" aria-live="polite" aria-label="Whispers">
          {whispers.map((e) => (
            <li key={e.seq} className="reliccard reliccard--whisper">
              <p className="reliccard__head">
                <span className="reliccard__emoji" aria-hidden="true">
                  👻
                </span>{' '}
                A ghost whispers…
              </p>
              <p className="reliccard__whisper">“{e.text}”</p>
            </li>
          ))}
        </ol>
      )}
      {casts.length > 0 && (
        <ol className="relicfeed relicfeed--side" aria-live="polite" aria-label="Relics">
          {casts.map((e) => {
            const info = state.relicCatalog[e.key];
            if (!info) return null;
            const by = player(e.by);
            const victim = info.target === 'player' ? player(e.target) : undefined;
            return (
              <li key={e.seq} className="reliccard" data-tier={info.tier} data-key={e.key}>
                <p className="reliccard__head">
                  <span className="reliccard__emoji" aria-hidden="true">
                    {info.emoji}
                  </span>{' '}
                  <strong style={{ color: by?.color }}>{by?.name ?? 'Someone'}</strong> {info.target ? 'cast' : 'used'}{' '}
                  <span className="reliccard__name">{info.name}</span>
                  {victim && (
                    <>
                      {' on '}
                      <strong style={{ color: victim.color }}>{victim.name}</strong>
                    </>
                  )}
                  {info.target === 'spot' && e.target && (
                    <>
                      {' on '}
                      <strong>{spotLabel(e.target)}</strong>
                    </>
                  )}
                </p>
                <p className="reliccard__blurb">{info.blurb}</p>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

/** Live Relic effects, under the board during the pull. */
function EffectsLine({ state }: { state: StateMsg }) {
  const name = (id: string) => state.players.find((p) => p.id === id);
  const mirrored = state.effects.mirrored.map(name).filter((p): p is Player => !!p);
  const hexed = Object.entries(state.effects.hexed).filter(([, s]) => s > 0);
  const gripping = Object.entries(state.effects.gripping).filter(([, s]) => s > 0);
  const pacts = Object.entries(state.effects.pacts);
  const shuffleIn = state.effects.shuffleIn;
  const shuffleSeq = [...state.relicEvents].reverse().find((e) => e.key === 'shuffle')?.seq ?? 0;
  if (mirrored.length + hexed.length + gripping.length + pacts.length === 0 && !shuffleIn) return null;
  return (
    <p className="effects">
      {shuffleIn !== null && shuffleIn > 0 && (
        <span className="effects__item effects__item--shuffle">
          🌀 The answers trade places in <Countdown key={shuffleSeq} seconds={shuffleIn} />s
        </span>
      )}
      {gripping.map(([id, secs]) => {
        const p = name(id);
        if (!p) return null;
        return (
          <span key={`g${id}${secs}`} className="effects__item">
            💪 <strong style={{ color: p.color }}>{p.name}</strong> pulls 3× <Countdown seconds={secs} />s
          </span>
        );
      })}
      {pacts.map(([from, to]) => {
        const a = name(from);
        const b = name(to);
        if (!a || !b) return null;
        return (
          <span key={`p${from}`} className="effects__item">
            🩸 <strong style={{ color: a.color }}>{a.name}</strong> feeds on <strong style={{ color: b.color }}>{b.name}</strong>
          </span>
        );
      })}
      {mirrored.map((p) => (
        <span key={`m${p.id}`} className="effects__item">
          🙃 <strong style={{ color: p.color }}>{p.name}</strong> is mirrored
        </span>
      ))}
      {hexed.map(([id, secs]) => {
        const p = name(id);
        if (!p) return null;
        return (
          <span key={`h${id}${secs}`} className="effects__item">
            🧊 <strong style={{ color: p.color }}>{p.name}</strong> frozen <Countdown seconds={secs} />s
          </span>
        );
      })}
    </p>
  );
}

/** Catch-up Relics: the spirits take pity on whoever is in last place. */
function PityLine({ state }: { state: StateMsg }) {
  const pitied = state.players.filter((p) => state.reveal?.catchUp?.includes(p.id));
  if (pitied.length === 0) return null;
  return (
    <p className="seance__pity" role="status">
      🕯️ The spirits take pity on {names(pitied.map((p) => p.name))}: a free Relic for last place.
    </p>
  );
}

function PotBadge({ pot, bonus }: { pot: number; bonus: number }) {
  return (
    <p className="potbadge" aria-label={`Pot: ${pot} candy`}>
      <span className="potbadge__label">Pot</span>
      <span key={pot} className="potbadge__num">🍬 {pot}</span>
      {bonus > 0 && <span className="potbadge__bonus">incl. {bonus} rolled over</span>}
    </p>
  );
}

function names(list: string[]): string {
  if (list.length <= 1) return list.join('');
  if (list.length === 2) return `${list[0]} & ${list[1]}`;
  return `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}`;
}

function payoutLine(state: StateMsg): string {
  const reveal = state.reveal;
  if (!reveal) return '';
  if (reveal.rolledOver)
    return state.game.roundKind === 'final'
      ? `Nobody called it. The spirits keep all 🍬 ${state.carryover}. Forever.`
      : `Nobody called it. The spirits keep the candy. 🍬 ${state.carryover} rolls over!`;
  // Own winnings only: Blood Pact gains don't count as calling it.
  const own = (id: string) => (reveal.payout[id] ?? 0) - (reveal.pactGains?.[id] ?? 0);
  const winners = state.players.filter((p) => own(p.id) > 0);
  const doubled = winners.filter((p) => reveal.doubled.includes(p.id));
  const plain = winners.find((p) => !reveal.doubled.includes(p.id));
  const share = plain ? own(plain.id) : winners.length ? Math.round(own(winners[0].id) / 2) : 0;
  const dd = doubled.length ? ` · ✖️ ${names(doubled.map((p) => p.name))} doubled down: +🍬 ${share * 2}` : '';
  const feeders = state.players.filter((p) => (reveal.pactGains?.[p.id] ?? 0) > 0);
  const pact = feeders.length
    ? ` · 🩸 ${feeders
        .map((p) => `${p.name} feeds on ${state.players.find((q) => q.id === reveal.pacts?.[p.id])?.name ?? '?'}: +🍬 ${reveal.pactGains[p.id]}`)
        .join(', ')}`
    : '';
  if (winners.length === 1) return `${winners[0].name} called it alone. +🍬 ${own(winners[0].id)}${doubled.length ? ' (doubled down!)' : ''}${pact}`;
  if (winners.length === state.players.length) return `Everyone called it. +🍬 ${share} each. Boring.${dd}${pact}`;
  return `${names(winners.map((p) => p.name))} split the pot. +🍬 ${share} each${dd}${pact}`;
}

/** Calls out people who didn't bet and got lucky (or didn't). */
function autoTease(state: StateMsg): string | null {
  const reveal = state.reveal;
  if (!reveal || reveal.autoBets.length === 0) return null;
  const lazy = state.players.filter((p) => reveal.autoBets.includes(p.id));
  const luckyOnes = lazy.filter((p) => reveal.payout[p.id]);
  if (luckyOnes.length) return `${names(luckyOnes.map((p) => p.name))} didn’t even bet. The spirits did it for them. And won.`;
  return `${names(lazy.map((p) => p.name))} forgot to bet. The spirits guessed for them.`;
}

function Scoreboard({ state }: { state: StateMsg }) {
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  const payout = state.reveal?.payout ?? {};
  return (
    <ol className="scores" aria-label="Scores">
      {ranked.map((p) => (
        <li key={p.id} className="scores__item" data-won={payout[p.id] ? '' : undefined}>
          <span className="avatar avatar--sm" style={{ backgroundColor: p.color }} aria-hidden="true" />
          <span className="scores__name">{p.name}</span>
          <span className="scores__num">{p.score}</span>
          {payout[p.id] ? <span className="scores__delta">+{payout[p.id]}</span> : null}
        </li>
      ))}
    </ol>
  );
}
