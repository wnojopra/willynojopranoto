import type { ReactNode } from 'react';
import { Pawn } from './Pawn';

/**
 * Bowling-alley "STRIKE!" style celebrations for a 3-point bullseye on the TV.
 * They take turns (variant = number of bullseyes so far, mod 5). Pure SVG/CSS.
 */
export const STRIKE_VARIANTS = 5;

interface StrikeProps {
  variant: number;
  name: string;
  color: string;
  photo?: string;
}

const PIN_COLORS = ['#e8353b', '#1fa34a', '#3cc6d0', '#1e63c6', '#f4f4f4', '#d6338f', '#f28c28', '#7d4cc9', '#f5c518', '#9bcf2e'];

export function Strike({ variant, name, color, photo }: StrikeProps) {
  const v = ((variant % STRIKE_VARIANTS) + STRIKE_VARIANTS) % STRIKE_VARIANTS;
  return (
    <div className={`psy-strike psy-strike--v${v}`} role="status" aria-live="assertive">
      <div className="psy-strike__flash" />
      <div className="psy-strike__rays" />
      <div className="psy-strike__art">{ART[v]()}</div>
      <p className="psy-strike__title">{TITLES[v]}</p>
      <p className="psy-strike__who">
        <span className="psy-strike__pawn">
          <Pawn color={color} photo={photo} />
        </span>
        {name} · +3
      </p>
    </div>
  );
}

const TITLES = ['STRIKE!', 'MIND READER!', 'GET OUT OF MY HEAD!', 'ARE YOU IN MY WALLS?', 'ONE SHARED BRAIN CELL'];

const ART: Array<() => ReactNode> = [
  // 0: a bowling ball smashes through pawns-as-pins.
  () => (
    <div className="psy-art-bowl">
      <div className="psy-art-bowl__ball">
        <span />
        <span />
        <span />
      </div>
      {PIN_COLORS.map((c, i) => (
        <span key={i} className={`psy-art-bowl__pin psy-art-bowl__pin--${i}`}>
          <Pawn color={c} />
        </span>
      ))}
    </div>
  ),
  // 1: a giant pulsing brain shooting psychic rings.
  () => (
    <div className="psy-art-brain">
      <span className="psy-art-brain__ring" />
      <span className="psy-art-brain__ring" />
      <span className="psy-art-brain__ring" />
      <span className="psy-art-brain__emoji" aria-hidden="true">
        🧠
      </span>
      <span className="psy-art-brain__bolt psy-art-brain__bolt--l" aria-hidden="true">
        ⚡
      </span>
      <span className="psy-art-brain__bolt psy-art-brain__bolt--r" aria-hidden="true">
        ⚡
      </span>
    </div>
  ),
  // 2: an x-ray head with a tiny pawn inside, waving.
  () => (
    <svg className="psy-art-xray" viewBox="0 0 120 120" aria-hidden="true">
      <path
        d="M40 115 C37 104 26 98 22 84 C15 58 30 22 62 20 C86 19 100 35 100 52 L107 66 C108 69 105 70 102 70 L103 77 C104 80 100 81 100 82 C102 86 100 90 96 91 C90 92 86 94 84 100 L82 115 Z"
        fill="#0f2a44"
        stroke="#7fe3ff"
        strokeWidth="3"
      />
      <g className="psy-art-xray__scan">
        <rect x="10" y="20" width="100" height="6" fill="#7fe3ff" opacity="0.55" />
      </g>
      <g className="psy-art-xray__tiny" transform="translate(52 44)">
        <circle cx="8" cy="4" r="4" fill="#ffe066" />
        <path d="M3 22 L4 11 L12 11 L13 22 Z" fill="#ffe066" />
        <path className="psy-art-xray__wave" d="M12 12 L19 4" stroke="#ffe066" strokeWidth="3" strokeLinecap="round" />
        <path d="M4 12 L-2 18" stroke="#ffe066" strokeWidth="3" strokeLinecap="round" />
      </g>
    </svg>
  ),
  // 3: a brick wall with eyes peeking out of the cracks.
  () => (
    <div className="psy-art-wall">
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className={`psy-art-wall__eyes psy-art-wall__eyes--${i}`}>
          <i />
          <i />
        </span>
      ))}
    </div>
  ),
  // 4: two heads passing one brain cell back and forth.
  () => (
    <div className="psy-art-cell">
      <span className="psy-art-cell__head" aria-hidden="true">
        🙂
      </span>
      <span className="psy-art-cell__cell" />
      <span className="psy-art-cell__head" aria-hidden="true">
        🙂
      </span>
    </div>
  ),
];
