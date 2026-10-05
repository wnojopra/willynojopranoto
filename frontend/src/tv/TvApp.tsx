import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import type { PlanchetteState, ServerMsg, StateMsg } from '../protocol';
import { useGameSocket } from '../useGameSocket';
import { Board } from './Board';
import { Countdown } from './Countdown';

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
  return <Seance state={state} send={send} planchetteRef={planchetteRef} />;
}

type Send = (msg: object) => void;

function Lobby({ state, send }: { state: StateMsg; send: Send }) {
  const joinUrl = `${location.host}/play`;
  const humans = state.players.filter((p) => !p.isBot).length;
  const bots = state.players.length - humans;
  const needed = Math.max(0, state.minPlayers - state.players.length);

  return (
    <main className="tv lobby">
      <header className="lobby__head">
        <h1 className="tv__title">Spirit Board</h1>
        <p className="tv__sub">Grab your phone. Join the séance.</p>
      </header>

      <section className="lobby__join" aria-label="How to join">
        <p className="lobby__step">
          Go to <strong className="lobby__url">{joinUrl}</strong>
        </p>
        <p className="lobby__step">and enter the code</p>
        <p className="lobby__code" aria-label={`Room code ${state.code.split('').join(' ')}`}>
          {state.code}
        </p>
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
        <button id="tv-start" className="btn btn--primary btn--big" onClick={() => send({ type: 'start_round' })} disabled={!state.canStart}>
          Begin the Séance
        </button>
        {needed > 0 && (
          <p className="lobby__hint">
            Need {needed} more {needed === 1 ? 'spirit' : 'spirits'} to begin.
          </p>
        )}
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

  return (
    <main className="tv seance" data-phase={state.phase}>
      <header className="seance__head">
        <p className="seance__round">Round {state.roundNo}</p>
        <h1 className="seance__question">{state.question?.text}</h1>
      </header>

      <div className="seance__board">
        <Board
          board={state.board}
          spots={state.spots}
          planchetteRef={planchetteRef}
          resultSpotId={state.resultSpotId}
          colorsBySpot={colorsBySpot}
        />
        {state.phase === 'question' && (
          <div className="seance__overlay" role="status">
            <p className="seance__ready">Fingers on the planchette…</p>
            <Countdown key={`q${state.roundNo}`} seconds={state.phaseEndsIn ?? 0} className="seance__count" />
          </div>
        )}
        {state.phase === 'reveal' && result && (
          <div className="seance__overlay seance__overlay--reveal" role="status">
            <p className="seance__spoken">The spirits have spoken…</p>
            <p className="seance__answer">{result.label}</p>
            <p className="seance__quip">{quip}</p>
          </div>
        )}
      </div>

      <footer className="seance__foot">
        {state.phase === 'pull' && (
          <Countdown key={`p${state.roundNo}`} seconds={state.phaseEndsIn ?? 0} bar className="seance__timer" />
        )}
        {state.phase === 'reveal' && (
          <div className="seance__actions">
            <button id="tv-back" className="btn btn--ghost" onClick={() => send({ type: 'back_to_lobby' })}>
              Back to lobby
            </button>
            <button id="tv-next" className="btn btn--primary btn--big" onClick={() => send({ type: 'start_round' })} disabled={!state.canStart}>
              Next question
            </button>
          </div>
        )}
      </footer>
    </main>
  );
}
