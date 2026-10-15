import { useEffect, useState, type ReactNode } from 'react';
import { GoldMarker, Pawn } from './Pawn';

/** The "How to play" deck: TV overlay (host steps through) and a compact phone version. */
interface Card {
  title: string;
  body: string;
  art: ReactNode;
}

function cards(opinions: boolean, opinionPoints: boolean, target: number): Card[] {
  const list: Card[] = [
    {
      title: 'Two traits, one board',
      body: 'Each turn, two trait cards land on the board, one on each axis. 1 means "not at all" and 10 means "extremely".',
      art: (
        <div className="psy-howto__cards">
          <span className="psy-howto__card psy-howto__card--y">PSYCHO</span>
          <span className="psy-howto__card psy-howto__card--x">LOGICAL</span>
        </div>
      ),
    },
    {
      title: 'Be honest (secretly)',
      body: 'The main player marks where they think they really are, on their phone. Nobody else sees it.',
      art: <GoldMarker className="psy-howto__gold" />,
    },
    {
      title: 'Guess where they put themself',
      body: 'Everyone else takes turns guessing where the main player marked. A square someone already took is blocked, so go early or get creative.',
      art: (
        <div className="psy-howto__pawns">
          <Pawn color="#e8353b" />
          <Pawn color="#1fa34a" />
          <Pawn color="#3cc6d0" />
        </div>
      ),
    },
    {
      title: 'Score by reading them',
      body: `Exact square: 3 points. One step up, down, left, or right: 2. Diagonally next to it: 1. First to ${target} wins.`,
      art: (
        <div className="psy-howto__zones" aria-hidden="true">
          {[1, 2, 1, 2, 3, 2, 1, 2, 1].map((z, i) => (
            <span key={i} className={`psy-howto__zone psy-howto__zone--${z}`}>
              {z}
            </span>
          ))}
        </div>
      ),
    },
  ];
  if (opinions) {
    list.push({
      title: 'Bonus: what you really think',
      body: opinionPoints
        ? 'After your guess, place a small second marker for where YOU think they really are. It can go anywhere, and it scores half points.'
        : 'After your guess, place a small second marker for where YOU think they really are. It can go anywhere, and it’s just for fun.',
      art: (
        <div className="psy-howto__pawns">
          <Pawn color="#1e63c6" />
          <span className="psy-howto__mini">
            <Pawn color="#1e63c6" />
          </span>
        </div>
      ),
    });
  }
  return list;
}

export function HowToOverlay({ opinions, opinionPoints, target, onClose }: { opinions: boolean; opinionPoints: boolean; target: number; onClose: () => void }) {
  const deck = cards(opinions, opinionPoints, target);
  const [i, setI] = useState(0);
  const card = deck[i];
  const last = i === deck.length - 1;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((n) => Math.min(deck.length - 1, n + 1));
      if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deck.length, onClose]);
  return (
    <div className="psy-overlay" role="dialog" aria-modal="true" aria-labelledby="psy-howto-title">
      <div className="psy-panel psy-howto" key={i}>
        <p className="psy-kicker">
          How to play · {i + 1} / {deck.length}
        </p>
        <div className="psy-howto__art">{card.art}</div>
        <h2 className="psy-howto__title" id="psy-howto-title">
          {card.title}
        </h2>
        <p className="psy-howto__body">{card.body}</p>
        <div className="psy-row">
          <button id="psy-howto-back" type="button" className="psy-btn psy-btn--ghost" disabled={i === 0} onClick={() => setI(i - 1)}>
            Back
          </button>
          {last ? (
            <button id="psy-howto-done" type="button" className="psy-btn psy-btn--primary" onClick={onClose}>
              Let’s play
            </button>
          ) : (
            <button id="psy-howto-next" type="button" className="psy-btn psy-btn--primary" onClick={() => setI(i + 1)}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Compact version for a phone (all cards in a scrolling list). */
export function HowToList({ opinions, opinionPoints, target }: { opinions: boolean; opinionPoints: boolean; target: number }) {
  return (
    <ol className="psy-howto-list">
      {cards(opinions, opinionPoints, target).map((c) => (
        <li key={c.title}>
          <strong>{c.title}</strong>
          <span>{c.body}</span>
        </li>
      ))}
    </ol>
  );
}
