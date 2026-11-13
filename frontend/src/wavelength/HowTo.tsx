import { useState } from 'react';

interface HowToProps {
  bands: [number, number, number];
  onClose?: () => void;
}

const STEPS = [
  {
    title: '1. The Psychic Peeks',
    body: 'Each round draws a spectrum card with two opposites (like Cold ↔ Hot). One player is the Psychic—they see where the hidden target sits on their phone dial.',
  },
  {
    title: '2. Give One Clue',
    body: 'The Psychic gives a single concept, word, or phrase that lands right on that spot between the two ends (for example, "Warm Soup" for slightly toward Hot). No numbers or percentages!',
  },
  {
    title: '3. Turn the Red Dial',
    body: 'The guessers debate where the clue sits and drag the red pointer on their phones (or on the TV) to lock in their guess.',
  },
  {
    title: '4. Left/Right Bonus & Reveal',
    body: 'In Teams mode, the opposing team can score +1 bonus point by calling whether the true 4-point center is Left or Right of the needle before the screen opens!',
  },
];

export function HowToList({ bands }: { bands: [number, number, number] }) {
  const [bullseye, close, near] = bands;
  return (
    <div className="wl-howto-list">
      <ol className="wl-steps">
        {STEPS.map((s) => (
          <li key={s.title} className="wl-step">
            <strong>{s.title}</strong>
            <p>{s.body}</p>
          </li>
        ))}
      </ol>
      <div className="wl-legend">
        <div className="wl-legend-item">
          <span className="wl-swatch wl-swatch--4" />
          <strong>{bullseye} pts</strong> Bullseye
        </div>
        <div className="wl-legend-item">
          <span className="wl-swatch wl-swatch--3" />
          <strong>{close} pts</strong> Close
        </div>
        <div className="wl-legend-item">
          <span className="wl-swatch wl-swatch--2" />
          <strong>{near} pts</strong> Near
        </div>
      </div>
    </div>
  );
}

export function HowToOverlay({ bands, onClose }: HowToProps) {
  const [idx, setIdx] = useState(0);
  const [bullseye, close, near] = bands;

  return (
    <div className="wl-modal-backdrop" onClick={onClose}>
      <div className="wl-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="How to play Wavelength">
        <header className="wl-modal-header">
          <h2>How to Play Wavelength</h2>
          <button type="button" className="wl-icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="wl-modal-body">
          <div className="wl-howto-card">
            <span className="wl-howto-step-badge">
              Step {idx + 1} of {STEPS.length}
            </span>
            <h3>{STEPS[idx].title}</h3>
            <p>{STEPS[idx].body}</p>
          </div>
          <div className="wl-legend">
            <div className="wl-legend-item">
              <span className="wl-swatch wl-swatch--4" />
              <strong>{bullseye}</strong> Bullseye
            </div>
            <div className="wl-legend-item">
              <span className="wl-swatch wl-swatch--3" />
              <strong>{close}</strong> Close
            </div>
            <div className="wl-legend-item">
              <span className="wl-swatch wl-swatch--2" />
              <strong>{near}</strong> Near
            </div>
            <div className="wl-legend-item">
              <span className="wl-swatch wl-swatch--0" />
              <strong>0</strong> Miss
            </div>
          </div>
        </div>
        <footer className="wl-modal-footer">
          <button
            type="button"
            className="wl-btn wl-btn--secondary"
            disabled={idx === 0}
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
          >
            ← Back
          </button>
          <div className="wl-dots">
            {STEPS.map((_, i) => (
              <button
                key={i}
                type="button"
                className={`wl-dot-btn ${i === idx ? 'is-active' : ''}`}
                onClick={() => setIdx(i)}
                aria-label={`Step ${i + 1}`}
              />
            ))}
          </div>
          {idx < STEPS.length - 1 ? (
            <button
              type="button"
              className="wl-btn wl-btn--primary"
              onClick={() => setIdx((i) => Math.min(STEPS.length - 1, i + 1))}
            >
              Next →
            </button>
          ) : (
            <button type="button" className="wl-btn wl-btn--primary" onClick={onClose}>
              Let’s Play!
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
