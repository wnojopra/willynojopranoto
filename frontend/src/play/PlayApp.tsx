import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { getMe } from '../hunt/api';
import type { PlanchetteState, Player, PrivatePick, RelicKey, ServerMsg, StateMsg } from '../protocol';
import { useGameSocket } from '../useGameSocket';
import { MiniMap } from './MiniMap';
import { RelicEffects, RelicTray, type MyRelics } from './RelicTray';
import { Touchpad } from './Touchpad';

interface JoinInfo {
  code: string;
  name: string;
}

/** What our Crystal Ball shows: live bet counts, or (Medium rounds) crossed-out wrong answers. */
interface CrystalVision {
  roundNo: number;
  counts: Record<string, number> | null;
  crossed: string[] | null;
}

function vibrate(pattern: number | number[]) {
  // Browsers block vibration until the user has tapped the page (e.g. right after a refresh).
  const active = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? true;
  if ('vibrate' in navigator && active) navigator.vibrate(pattern);
}

/** This tab's room + name, so a refreshed phone rejoins on its own. Not secret. */
const JOIN_KEY = 'sb-join';
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

export function PlayApp() {
  const initialCode = new URLSearchParams(location.search).get('code') ?? '';
  const resume = useMemo(() => {
    const j = savedJoin();
    return j && (!initialCode || initialCode.toUpperCase() === j.code) ? j : null;
  }, [initialCode]);
  const [code, setCode] = useState(resume?.code ?? initialCode.toUpperCase().slice(0, 4));
  const [name, setName] = useState(resume?.name ?? '');
  const [join, setJoin] = useState<JoinInfo | null>(resume);
  const [attempt, setAttempt] = useState(resume ? 1 : 0);
  const [retries, setRetries] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [state, setState] = useState<StateMsg | null>(null);
  // Our own secret bet. Only this phone (and the server) knows it before the reveal.
  const [myBet, setMyBet] = useState<PrivatePick | null>(null);
  // Our secret answer, when we're the Medium.
  const [myAnswer, setMyAnswer] = useState<PrivatePick | null>(null);
  const planchetteRef = useRef<PlanchetteState | null>(null);
  // Private: our Relics, Crystal Ball vision, and the last cast error.
  const [myRelics, setMyRelics] = useState<MyRelics>({ relics: [], usedRound: 0 });
  const prevRelicsRef = useRef<RelicKey[] | null>(null);
  const [spotlight, setSpotlight] = useState<RelicKey[]>([]);
  const [crystal, setCrystal] = useState<CrystalVision | null>(null);
  const [relicError, setRelicError] = useState<string | null>(null);
  // Hunt Relics this phone carries (they load server-side when we join).
  const [huntCount, setHuntCount] = useState(0);

  useEffect(() => {
    getMe().then(
      (m) => {
        if (m.name) setName((n) => n || m.name || '');
        setHuntCount(m.relics.length);
      },
      () => {},
    );
  }, []);

  useEffect(() => {
    if (!relicError) return;
    const t = setTimeout(() => setRelicError(null), 3500);
    return () => clearTimeout(t);
  }, [relicError]);

  const onMessage = useCallback((msg: ServerMsg) => {
    switch (msg.type) {
      case 'joined':
        setMe(msg.playerId);
        setError(null);
        vibrate(30);
        break;
      case 'bet_ok':
        setMyBet({ spotId: msg.spotId, roundNo: msg.roundNo, auto: msg.auto });
        break;
      case 'answer_ok':
        setMyAnswer({ spotId: msg.spotId, roundNo: msg.roundNo, auto: msg.auto });
        break;
      case 'relics': {
        const before = prevRelicsRef.current;
        prevRelicsRef.current = msg.relics;
        setMyRelics({ relics: msg.relics, usedRound: msg.usedRound });
        if (before === null) {
          if (msg.relics.length > 0) setSpotlight([...new Set(msg.relics)]);
        } else {
          const oldCounts = new Map<RelicKey, number>();
          for (const k of before) oldCounts.set(k, (oldCounts.get(k) ?? 0) + 1);
          const newCounts = new Map<RelicKey, number>();
          for (const k of msg.relics) newCounts.set(k, (newCounts.get(k) ?? 0) + 1);
          const added: RelicKey[] = [];
          for (const [k, n] of newCounts) {
            if (n > (oldCounts.get(k) ?? 0)) added.push(k);
          }
          if (added.length > 0) setSpotlight(added);
          else if (msg.relics.length === 0) setSpotlight([]);
        }
        break;
      }
      case 'crystal':
        setCrystal({ roundNo: msg.roundNo, counts: msg.counts ?? null, crossed: msg.crossed ?? null });
        break;
      case 'relic_error':
        setRelicError(msg.message);
        vibrate([20, 40, 20]);
        break;
      case 'state':
        setState(msg);
        planchetteRef.current = msg.planchette;
        break;
      case 'tick':
        planchetteRef.current = msg;
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
  const { status, send } = useGameSocket(join ? '/ws/play' : null, firstMessage, onMessage, attempt);

  useWakeLock(me !== null);
  useRevealBuzz(state, me);

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
  // Coming back to the tab (phone unlocked): try right away.
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

  if (!join) {
    return (
      <main className="phone phone--join">
        <h1 className="phone__title">
          Spirit Board <span className="byline">by Willy Nojopranoto</span>
        </h1>
        <form className="joinform" onSubmit={onSubmit}>
          <label className="field">
            <span className="field__label">Room code</span>
            <input
              id="join-code"
              className="field__input field__input--code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              inputMode="text"
              required
              minLength={4}
              maxLength={4}
              pattern="[A-Za-z]{4}"
              placeholder="ABCD"
            />
          </label>
          <label className="field">
            <span className="field__label">Your name</span>
            <input
              id="join-name"
              className="field__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="nickname"
              required
              maxLength={14}
              placeholder="Kevin"
            />
          </label>
          {error && (
            <p className="joinform__error" role="alert">
              {error}
            </p>
          )}
          {huntCount > 0 && (
            <p className="joinform__hunt" id="join-hunt">
              ✨ {huntCount} hunt Relic{huntCount === 1 ? '' : 's'} will come with you. <a href="/relics">See them</a>
            </p>
          )}
          <button id="join-submit" className="btn btn--primary btn--big" type="submit">
            Join the séance
          </button>
        </form>
      </main>
    );
  }

  if (status === 'closed') {
    const trying = retries < MAX_RETRIES;
    return (
      <main className="phone phone--center">
        <p className={`phone__big${trying ? ' phone__summoning' : ''}`} role="status">
          {trying ? 'Reconnecting to the other side…' : 'The connection to the other side was lost.'}
        </p>
        {!trying && (
          <button
            id="rejoin"
            className="btn btn--primary btn--big"
            onClick={() => {
              setRetries(0);
              setAttempt((n) => n + 1);
            }}
          >
            Rejoin as {join.name}
          </button>
        )}
        <button
          id="leave"
          className="btn btn--ghost"
          onClick={() => {
            saveJoin(null);
            setJoin(null);
          }}
        >
          Use a different name
        </button>
      </main>
    );
  }

  if (!state || !me) {
    return (
      <main className="phone phone--center">
        <p className="phone__big phone__summoning">Joining…</p>
      </main>
    );
  }

  const self = state.players.find((p) => p.id === me);
  const result = state.spots.find((s) => s.id === state.resultSpotId);
  const liveBet = myBet && myBet.roundNo === state.roundNo ? myBet : null;
  const liveAnswer = myAnswer && myAnswer.roundNo === state.roundNo ? myAnswer : null;
  const betSpot = state.spots.find((s) => s.id === (state.reveal?.bets[me] ?? liveBet?.spotId));
  const betLabel = (id: string | undefined) => (id === me ? 'Yourself' : state.spots.find((s) => s.id === id)?.label);
  const kind = state.game.roundKind ?? 'bets';
  const medium = state.players.find((p) => p.id === state.medium?.playerId);
  const iAmMedium = medium?.id === me;

  const placeBet = (spotId: string) => {
    setMyBet({ spotId, roundNo: state.roundNo, auto: false });
    send({ type: 'bet', spotId });
    vibrate(15);
  };
  const answer = (spotId: string) => {
    setMyAnswer({ spotId, roundNo: state.roundNo, auto: false });
    send({ type: 'answer', spotId });
    vibrate(15);
  };
  const castRelic = (key: RelicKey, target: string | null, text: string | null) => {
    setRelicError(null);
    setSpotlight((prev) => prev.filter((k) => k !== key));
    send({ type: 'relic', key, target, text });
    vibrate([30, 30, 60]);
  };
  const vision = crystal && crystal.roundNo === state.roundNo ? crystal : null;
  const practice = kind === 'practice';
  const showTray = state.phase !== 'results';
  const activeSpotlight = spotlight.filter((k) => myRelics.relics.includes(k));

  const roundTag =
    state.game.roundKind === 'final'
      ? '🕯️ Final Séance'
      : practice
        ? '🎓 Practice · nothing counts'
        : state.game.roundKind
        ? `${kind === 'medium' ? '🔮 ' : ''}Round ${state.game.round}/${state.game.totalRounds - 1}`
        : null;

  return (
    <main className="phone" data-phase={state.phase}>
      <header className="phone__bar">
        <span className="avatar avatar--sm" style={{ backgroundColor: self?.color }} aria-hidden="true" />
        <span className="phone__me">{self?.name ?? join.name}</span>
        <span className="phone__score" aria-label={`${self?.score ?? 0} candy`}>
          🍬 {self?.score ?? 0}
        </span>
        <span className="phone__code">{state.code}</span>
      </header>
      {roundTag && <p className="phone__round">{roundTag}</p>}
      {state.curse?.playerId === me && state.phase !== 'reveal' && (
        <p className="phone__cursechip">
          💀 <strong>Cursed:</strong> {state.curse.text}
        </p>
      )}
      <RelicEffects state={state} me={me} />

      {state.phase === 'lobby' && (
        <section className="phone__panel phone--center">
          <p className="phone__big">You’re in.</p>
          <p className="phone__sub">
            Eyes on the TV. The séance begins soon · {state.players.length}{' '}
            {state.players.length === 1 ? 'spirit' : 'spirits'} gathered
          </p>
          <aside className="phone__howto" aria-label="How to play">
            <h2 className="phone__howtotitle">📜 How to play</h2>
            <ol className="phone__howtolist">
              <li>
                <span aria-hidden="true">🍬</span>
                <div>
                  <strong>Bet in secret</strong> — Each question, secretly pick where you think the planchette will land.
                </div>
              </li>
              <li>
                <span aria-hidden="true">👻</span>
                <div>
                  <strong>Pull together</strong> — Everyone drags on their phone at once to move the same planchette on the TV.
                </div>
              </li>
              <li>
                <span aria-hidden="true">🤝</span>
                <div>
                  <strong>Split the pot</strong> — Everyone who bet on the spot it lands on splits the candy.
                </div>
              </li>
              <li>
                <span aria-hidden="true">🧿</span>
                <div>
                  <strong>Relics &amp; Curses</strong> — Tap your Relics below to see how they cheat the board. If the board lands on your name, you’re Haunted!
                </div>
              </li>
            </ol>
          </aside>
        </section>
      )}

      {state.phase === 'medium' &&
        (iAmMedium ? (
          <section className="phone__panel phone__bet">
            <p className="phone__medium">🔮 You are the Medium</p>
            <p className="phone__question">{state.question?.text}</p>
            <p className="phone__sub">Answer honestly. Everyone else will try to guess it.</p>
            <SpotButtons state={state} me={me} selected={liveAnswer?.spotId} onPick={answer} label="Your answer" />
          </section>
        ) : (
          <section className="phone__panel phone--center">
            <p className="phone__big phone__summoning">
              🔮 {medium?.name ?? 'The Medium'} is consulting the spirits…
            </p>
            <p className="phone__question phone__question--small">{state.question?.text}</p>
            <p className="phone__sub">Get ready to guess what they pick.</p>
          </section>
        ))}

      {state.phase === 'question' &&
        (iAmMedium ? (
          <section className="phone__panel phone--center">
            <p className="phone__medium">🔮 You answered</p>
            <p className="phone__answer">{betLabel(liveAnswer?.spotId) ?? '…'}</p>
            <p className="phone__sub">
              {liveAnswer?.auto ? 'You froze, so the spirits answered for you. ' : ''}Now they’re guessing. Keep a straight face.
            </p>
          </section>
        ) : (
          <section className="phone__panel phone__bet">
            <p className="phone__question">{state.question?.text}</p>
            {medium ? (
              <p className="phone__pot">
                What did <strong style={{ color: medium.color }}>{medium.name}</strong> answer?
              </p>
            ) : (
              <p className="phone__pot">
                Pot <strong>🍬 {state.pot}</strong>
              </p>
            )}
            <p className="phone__sub">
              {medium
                ? 'Guess right for +100. Then pull the board there for +100 more.'
                : practice
                  ? 'Step 1: tap where you think the board will land. Nobody else can see your pick.'
                  : 'Secretly bet on where the board will land.'}
            </p>
            <SpotButtons
              state={state}
              me={me}
              selected={liveBet?.spotId}
              onPick={placeBet}
              label={medium ? 'Your guess' : 'Your bet'}
              counts={vision?.counts ?? null}
              crossed={vision?.crossed ?? null}
            />
            <p className="phone__sub phone__betnote" aria-live="polite">
              {liveBet ? 'Locked in… until you change your mind.' : 'No pick? The spirits will pick for you.'}
            </p>
          </section>
        ))}

      {state.phase === 'pull' && (
        <section className="phone__pull">
          <p className="phone__question phone__question--small">{state.question?.text}</p>
          {iAmMedium ? (
            <>
              <p className="phone__betchip">
                Your answer: {betLabel(liveAnswer?.spotId) ?? '?'}
              </p>
              <MiniMap board={state.board} spots={state.spots} planchetteRef={planchetteRef} salted={state.effects.salted} magnets={state.effects.magnets} betSpotId={liveAnswer?.spotId ?? null} />
              <p className="phone__big phone--center phone__watch">Hands off. You can’t touch the planchette. Just watch.</p>
            </>
          ) : (
            <>
              <p className="phone__betchip" data-auto={liveBet?.auto ? '' : undefined}>
                {liveBet
                  ? `${liveBet.auto ? 'The spirits picked for you' : medium ? 'Your guess' : 'Your bet'}: ${betLabel(liveBet.spotId) ?? '?'}`
                  : 'Pull for what you believe.'}
                {!medium && <span className="phone__betpot">🍬 {state.pot}</span>}
              </p>
              {practice && (
                <p className="phone__practice">Step 2: drag in the box below. Everyone moves the same planchette, so watch the TV.</p>
              )}
              {vision?.counts && <CrystalLine state={state} me={me} counts={vision.counts} />}
              <MiniMap board={state.board} spots={state.spots} planchetteRef={planchetteRef} salted={state.effects.salted} magnets={state.effects.magnets} betSpotId={liveBet?.spotId ?? null} />
              <Touchpad onPull={(dx, dy) => send({ type: 'pull', dx, dy })} color={self?.color ?? '#e8a33d'} />
            </>
          )}
        </section>
      )}

      {state.phase === 'reveal' && result && (
        <section className="phone__panel phone--center">
          <p className="phone__sub">The spirits have spoken…</p>
          <p className="phone__answer">{result.id === me ? 'YOU' : result.label}</p>
          {result.id === me && !practice && <p className="phone__sub">The board has chosen you. 💀 Haunted.</p>}
          {state.curse?.playerId === me && state.curse.roundNo === state.roundNo && (
            <div className="phone__cursed" role="alert">
              <p className="phone__cursedhead">💀 You’ve been cursed. Look at the TV.</p>
              <p>
                {state.curse.drink ? '🍺 ' : ''}
                {state.curse.text}
              </p>
              {state.curse.alt && <p className="phone__sub">or: {state.curse.alt}</p>}
            </div>
          )}
          {practice ? (
            <p className="phone__practice">
              {(state.reveal?.payout[me] ?? 0) > 0
                ? `You called it! In a real round that’s +🍬 ${state.reveal?.payout[me]}.`
                : 'Not this time. It was practice, so nothing counted.'}{' '}
              Next up: the real thing.
            </p>
          ) : kind === 'medium' && medium ? (
            <MediumOutcome state={state} me={me} medium={medium} />
          ) : (
            <RevealOutcome state={state} me={me} betLabel={betLabel(betSpot?.id)} />
          )}
          <PityNote state={state} me={me} />
        </section>
      )}

      {state.phase === 'results' && <PhoneResults state={state} me={me} />}
      {activeSpotlight.length > 0 && state.phase !== 'pull' && state.phase !== 'results' && (
        <aside className="relicspot" aria-label="Your Relic details">
          <div className="relicspot__head">
            <span className="relicspot__kicker">
              ✨ {activeSpotlight.length === 1 ? 'New Relic in your tray' : `Your Relics (${activeSpotlight.length})`}
            </span>
            <button id="relicspot-dismiss" className="relicspot__close" onClick={() => setSpotlight([])}>
              Got it ×
            </button>
          </div>
          {activeSpotlight.map((k) => {
            const info = state.relicCatalog[k];
            if (!info) return null;
            return (
              <div key={k} className="relicspot__item" data-tier={info.tier}>
                <span className="relicspot__emoji" aria-hidden="true">
                  {info.emoji}
                </span>
                <div className="relicspot__body">
                  <strong className="relicspot__name">{info.name}</strong>
                  <p className="relicspot__help">{info.help ?? info.blurb}</p>
                </div>
              </div>
            );
          })}
        </aside>
      )}
      {showTray && (
        <RelicTray
          state={state}
          me={me}
          mine={myRelics}
          error={relicError}
          myBet={liveBet?.spotId ?? null}
          onCast={castRelic}
          onInspect={(k) => setSpotlight((prev) => prev.filter((x) => x !== k))}
        />
      )}
    </main>
  );
}

function SpotButtons({
  state,
  me,
  selected,
  onPick,
  label,
  counts = null,
  crossed = null,
}: {
  state: StateMsg;
  me: string;
  selected: string | undefined;
  onPick: (spotId: string) => void;
  label: string;
  counts?: Record<string, number> | null;
  crossed?: string[] | null;
}) {
  return (
    <div className="betgrid" role="group" aria-label={label} data-many={state.spots.length > 10 ? '' : undefined}>
      {state.spots.map((s) => {
        const out = crossed?.includes(s.id) ?? false;
        const n = counts ? (counts[s.id] ?? 0) : null;
        return (
          <button
            key={s.id}
            id={`bet-${s.id}`}
            className="betgrid__btn"
            aria-pressed={selected === s.id}
            disabled={out}
            data-crossed={out ? '' : undefined}
            onClick={() => onPick(s.id)}
          >
            {s.id === me ? `${s.label} (you)` : s.label}
            {n !== null && (
              <span className="betgrid__count" aria-label={`${n} bets`}>
                🔮{n}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Crystal Ball, during the pull: where everyone's money is. */
function CrystalLine({ state, me, counts }: { state: StateMsg; me: string; counts: Record<string, number> }) {
  const parts = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `${id === me ? 'You' : (state.spots.find((s) => s.id === id)?.label ?? '?')} ×${n}`);
  return <p className="phone__crystal">🔮 {parts.length ? parts.join(' · ') : 'No bets yet'}</p>;
}

function MediumOutcome({ state, me, medium }: { state: StateMsg; me: string; medium: Player }) {
  const reveal = state.reveal;
  if (!reveal) return null;
  const answer = state.spots.find((s) => s.id === reveal.mediumAnswer)?.label ?? '?';
  const won = reveal.payout[me] ?? 0;
  const iAmMedium = medium.id === me;
  const correct = reveal.correct?.includes(me);
  return (
    <div className="outcome" data-won={won ? '' : undefined}>
      <p className="outcome__miss">
        {iAmMedium ? 'You' : medium.name} answered <strong>{answer}</strong>.
      </p>
      {won > 0 && <p className="outcome__big">+🍬 {won}</p>}
      <p className="phone__sub">
        {iAmMedium
          ? `${reveal.correct?.length ?? 0} read your mind.${reveal.boardMatched ? ' The board agreed!' : ''} Now explain yourself.`
          : `${correct ? 'You read their mind!' : 'Wrong guess.'}${reveal.boardMatched ? ' The board agreed: +100 for everyone.' : ''}`}
      </p>
      {(reveal.pactGains?.[me] ?? 0) > 0 && (
        <p className="phone__sub">
          🩸 +🍬 {reveal.pactGains[me]} from your Blood Pact with {state.players.find((p) => p.id === reveal.pacts?.[me])?.name ?? 'someone'}.
        </p>
      )}
    </div>
  );
}

function PhoneResults({ state, me }: { state: StateMsg; me: string }) {
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  const rank = ranked.findIndex((p) => p.id === me) + 1;
  const mine = (state.awards ?? []).filter((a) => a.playerIds.includes(me));
  return (
    <section className="phone__panel phone--center">
      <p className="phone__sub">The séance is over</p>
      <p className="phone__answer">#{rank}</p>
      <p className="phone__big">of {ranked.length} spirits</p>
      {mine.length > 0 ? (
        <ul className="phone__awards">
          {mine.map((a) => (
            <li key={a.key}>
              <span aria-hidden="true">{a.emoji}</span> {a.title}
            </li>
          ))}
        </ul>
      ) : (
        <p className="phone__sub">No awards. The spirits barely noticed you.</p>
      )}
      {state.finalCurse?.playerIds.includes(me) && (
        <p className="phone__curse">
          💀 The Final Curse is yours: <em>{state.finalCurse.text}</em>
        </p>
      )}
    </section>
  );
}

/** Catch-up Relic notice (design doc §6.6). The Relic itself shows up in the tray. */
function PityNote({ state, me }: { state: StateMsg; me: string }) {
  if (!state.reveal?.catchUp?.includes(me)) return null;
  return <p className="phone__pity">🕯️ The spirits pity you. A free Relic is in your tray.</p>;
}

function RevealOutcome({ state, me, betLabel }: { state: StateMsg; me: string; betLabel: string | undefined }) {
  const reveal = state.reveal;
  if (!reveal) return null;
  const won = reveal.payout[me];
  const auto = reveal.autoBets.includes(me);
  const pactGain = reveal.pactGains?.[me] ?? 0;
  const partner = state.players.find((p) => p.id === reveal.pacts?.[me]);
  // Bettors who won on their own (Blood Pact gains don't count as calling it).
  const winners = Object.entries(reveal.payout).filter(([id, n]) => n - (reveal.pactGains?.[id] ?? 0) > 0).length;
  const ownWin = (won ?? 0) - pactGain > 0;
  const pactNote = pactGain > 0 && partner && (
    <p className="phone__sub">
      🩸 +🍬 {pactGain} from your Blood Pact with {partner.name}.
    </p>
  );
  return (
    <div className="outcome" data-won={won ? '' : undefined}>
      {won ? (
        <>
          <p className="outcome__big">+🍬 {won}</p>
          {ownWin && (
            <p className="phone__sub">
              {winners === 1 ? 'You called it alone. The whole pot is yours.' : `Split ${winners} ways.`}
              {auto && ' (The spirits bet for you. Lucky.)'}
            </p>
          )}
          {pactNote}
        </>
      ) : (
        <>
          <p className="outcome__miss">
            {auto ? 'The spirits bet' : 'You bet'} <strong>{betLabel ?? '?'}</strong>.
          </p>
          <p className="phone__sub">
            {reveal.rolledOver
              ? state.game.roundKind === 'final'
                ? 'Nobody called it. The spirits keep it all.'
                : 'Nobody called it. The spirits keep the candy. Pot rolls over!'
              : 'No candy for you.'}
          </p>
        </>
      )}
    </div>
  );
}

/** Keeps the phone screen awake while in a game (where supported). */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
        if (cancelled) await lock.release();
      } catch {
        // Not allowed (e.g. low battery); the game still works.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request();
    };
    void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}

/** Buzzes when the round locks in, extra hard if the board picked you. */
function useRevealBuzz(state: StateMsg | null, me: string | null) {
  const lastRound = useRef(0);
  useEffect(() => {
    if (!state || state.phase !== 'reveal' || state.roundNo === lastRound.current) return;
    lastRound.current = state.roundNo;
    vibrate(state.resultSpotId === me ? [120, 60, 120, 60, 300] : me && state.reveal?.payout[me] ? [40, 40, 40, 40, 160] : 60);
  }, [state, me]);
}
