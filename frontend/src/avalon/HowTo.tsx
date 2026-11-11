import { useEffect, useState } from 'react';

interface GuideCard {
  title: string;
  kicker: string;
  body: string;
}

const GUIDE_CARDS: GuideCard[] = [
  {
    kicker: '1 · Good vs. Evil',
    title: 'Hidden Loyalties in Camelot',
    body: 'Players are secretly dealt a Character Card: either Loyal Servants of Arthur (Good, in blue) or Minions of Mordred (Evil, in crimson). Good wins by completing 3 Quests. Evil wins if 3 Quests fail, 5 team proposals in a row are rejected, or by assassinating Merlin at the end.',
  },
  {
    kicker: '2 · The Night Phase',
    title: 'Evil Reveals Itself & Merlin Looks On',
    body: 'At the start of the game, everyone closes their eyes while the TV narrates the Night script. Evil players learn who each other are, and Merlin sees the agents of Evil. You can also hold down the secret button on your phone to check your sightings.',
  },
  {
    kicker: '3 · Team Building & Voting',
    title: 'Trust No One',
    body: 'Each round, the Leader proposes a Quest Team. All players discuss and simultaneously vote Approve or Reject on their phones. Majority approves the team; a tie or rejection passes leadership clockwise. Five rejections in one round hands Evil an immediate victory!',
  },
  {
    kicker: '4 · The Quest Phase',
    title: 'One Fail Spoils the Quest',
    body: 'Approved Team members secretly play a Quest card on their phones. Good players must play Success; Evil players may play Success or Fail. If even a single Fail card is played (or 2 Fails on Quest 4 with 7+ players), the Quest fails!',
  },
  {
    kicker: '5 · Evil’s Last Chance',
    title: 'Assassinate Merlin',
    body: 'If Good completes 3 Quests, Evil gets one final chance: without revealing character cards, the Evil players discuss and the Assassin names one Good player as Merlin. If Merlin is named, Evil steals the win!',
  },
];

export function HowToOverlay({ onClose }: { onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const card = GUIDE_CARDS[idx];
  const last = idx === GUIDE_CARDS.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setIdx((n) => Math.min(GUIDE_CARDS.length - 1, n + 1));
      if (e.key === 'ArrowLeft') setIdx((n) => Math.max(0, n - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="ava-overlay" role="dialog" aria-modal="true" aria-labelledby="ava-howto-title">
      <div className="ava-panel ava-howto">
        <p className="ava-kicker">
          {card.kicker} ({idx + 1} / {GUIDE_CARDS.length})
        </p>
        <h2 className="ava-h2" id="ava-howto-title">
          {card.title}
        </h2>
        <p className="ava-howto__body">{card.body}</p>
        <div className="ava-row ava-row--spread">
          <button
            id="ava-howto-back"
            type="button"
            className="ava-btn ava-btn--ghost"
            disabled={idx === 0}
            onClick={() => setIdx((n) => n - 1)}
          >
            Back
          </button>
          <button
            id="ava-howto-close"
            type="button"
            className="ava-btn ava-btn--ghost"
            onClick={onClose}
          >
            Close
          </button>
          {last ? (
            <button
              id="ava-howto-done"
              type="button"
              className="ava-btn ava-btn--primary"
              onClick={onClose}
            >
              Got it
            </button>
          ) : (
            <button
              id="ava-howto-next"
              type="button"
              className="ava-btn ava-btn--primary"
              onClick={() => setIdx((n) => n + 1)}
            >
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function HowToList() {
  return (
    <ol className="ava-howto-list">
      {GUIDE_CARDS.map((c) => (
        <li key={c.title}>
          <strong>{c.title}</strong>
          <span>{c.body}</span>
        </li>
      ))}
    </ol>
  );
}
