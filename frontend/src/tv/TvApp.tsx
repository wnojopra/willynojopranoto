import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import type { GameLength, PlanchetteState, Player, ServerMsg, StateMsg } from '../protocol';
import { useGameSocket } from '../useGameSocket';
import { Board, type Bettor } from './Board';
import { Countdown } from './Countdown';
import { QrCode } from './QrCode';

const CREATE = JSON.stringify({ type: 'create' });

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
  const planchetteRef = useRef<PlanchetteState | null>(null);

  const onMessage = useCallback((msg: ServerMsg) => {
    if (msg.type === 'state') {
      setState(msg);
      planchetteRef.current = msg.planchette;
    } else if (msg.type === 'tick') {
      planchetteRef.current = msg;
    } else if (msg.type === 'error') {
      setError(msg.message);
    }
  }, []);

  const { status, send } = useGameSocket('/ws/tv', CREATE, onMessage);

  if (status === 'closed' || error) {
    return (
      <main className="tv tv--center">
        <h1 className="tv__title">The séance was interrupted</h1>
        <p className="tv__sub">{error ?? 'Lost connection to the spirit realm.'}</p>
        <button id="tv-restart" className="btn btn--primary" onClick={() => location.reload()}>
          Start a new séance
        </button>
      </main>
    );
  }
  if (!state) {
    return (
      <main className="tv tv--center">
        <p className="tv__sub tv__summoning">Summoning…</p>
      </main>
    );
  }
  if (state.phase === 'lobby') return <Lobby state={state} send={send} />;
  if (state.phase === 'results') return <Results state={state} send={send} />;
  return <Seance state={state} send={send} planchetteRef={planchetteRef} />;
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

  return (
    <main className="tv seance" data-phase={state.phase} data-kind={kind}>
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
      </div>

      <footer className="seance__foot">
        {state.phase === 'pull' && (
          <>
            {medium && <p className="seance__sub seance__center">{medium.name} can’t touch the planchette. Pull for what you think they picked.</p>}
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
  const cursed = awards.find((a) => a.key === 'most_haunted');
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

      {cursed && (
        <p className="results__curse">
          💀 {names(cursed.playerIds.map((id) => byId[id]?.name ?? '?'))}: the Final Curse is yours. The host will deliver it.
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
  if (reveal.rolledOver) return `Nobody called it. The spirits keep the candy. 🍬 ${state.carryover} rolls over!`;
  const winners = state.players.filter((p) => reveal.payout[p.id]);
  const share = winners.length ? reveal.payout[winners[0].id] : 0;
  if (winners.length === 1) return `${winners[0].name} called it alone. +🍬 ${share}`;
  if (winners.length === state.players.length) return `Everyone called it. +🍬 ${share} each. Boring.`;
  return `${names(winners.map((p) => p.name))} split the pot. +🍬 ${share} each`;
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
