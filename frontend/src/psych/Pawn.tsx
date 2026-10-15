import { isPale } from './protocol';

interface PawnProps {
  color: string;
  className?: string;
  title?: string;
}

/** A person-shaped game piece on a square base, like the physical pawns. */
export function Pawn({ color, className, title }: PawnProps) {
  const stroke = isPale(color) ? '#8a8f98' : 'rgba(0,0,0,0.28)';
  return (
    <svg className={`psy-pawn ${className ?? ''}`} viewBox="0 0 40 48" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <rect x="5" y="38" width="30" height="8" rx="2" fill={color} stroke={stroke} strokeWidth="1.2" />
      <rect x="5" y="38" width="30" height="3" rx="1.5" fill="rgba(255,255,255,0.25)" />
      <circle cx="20" cy="9" r="6.5" fill={color} stroke={stroke} strokeWidth="1.2" />
      <path
        d="M11 38 L13 22 Q13 17 18 17 L22 17 Q27 17 27 22 L29 38 Z"
        fill={color}
        stroke={stroke}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M13 22 L7 30 M27 22 L33 30" stroke={color} strokeWidth="4.5" strokeLinecap="round" />
      <ellipse cx="17.5" cy="7" rx="2.2" ry="1.4" fill="rgba(255,255,255,0.45)" />
    </svg>
  );
}

/** The flat square scoring token in a player's colour. */
export function Token({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={`psy-token ${isPale(color) ? 'psy-token--pale' : ''} ${className ?? ''}`}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}

/** The main player's gold secret marker. */
export function GoldMarker({ className, title }: { className?: string; title?: string }) {
  return (
    <svg className={`psy-gold ${className ?? ''}`} viewBox="0 0 40 48" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <linearGradient id="psy-gold-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e6cf86" />
          <stop offset="0.5" stopColor="#c9a64e" />
          <stop offset="1" stopColor="#8f6f22" />
        </linearGradient>
      </defs>
      <rect x="6" y="36" width="28" height="9" rx="2" fill="url(#psy-gold-grad)" stroke="#7a5d1a" strokeWidth="1.2" />
      <path d="M12 36 L12 18 L28 18 L28 36" fill="none" stroke="url(#psy-gold-grad)" strokeWidth="4" strokeLinejoin="round" />
      <rect x="10" y="4" width="20" height="16" rx="3" fill="url(#psy-gold-grad)" stroke="#7a5d1a" strokeWidth="1.2" />
      <path d="M15 12 h10 M20 7 v10" stroke="#fff7d6" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}
