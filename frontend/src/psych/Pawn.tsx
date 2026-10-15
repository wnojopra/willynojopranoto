import { useId } from 'react';

/** useId() output contains characters that break url(#…) references. */
function useSvgId(): string {
  return 'psy' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
}
import { isPale } from './protocol';

interface PawnProps {
  color: string;
  className?: string;
  title?: string;
  /** A selfie: drawn as a big round face on the pawn's body. */
  photo?: string;
}

/** A person-shaped game piece on a square base, like the physical pawns. */
export function Pawn({ color, className, title, photo }: PawnProps) {
  const clip = useSvgId();
  const stroke = isPale(color) ? '#8a8f98' : 'rgba(0,0,0,0.28)';
  const a11y = { role: title ? 'img' : undefined, 'aria-label': title, 'aria-hidden': title ? undefined : true } as const;
  if (photo) {
    return (
      <svg className={`psy-pawn psy-pawn--photo ${className ?? ''}`} viewBox="0 0 40 48" {...a11y}>
        <defs>
          <clipPath id={clip}>
            <circle cx="20" cy="16" r="14" />
          </clipPath>
        </defs>
        <rect x="5" y="38" width="30" height="8" rx="2" fill={color} stroke={stroke} strokeWidth="1.2" />
        <path d="M13 38 L15 28 L25 28 L27 38 Z" fill={color} stroke={stroke} strokeWidth="1.2" strokeLinejoin="round" />
        <circle cx="20" cy="16" r="15.5" fill={color} stroke={stroke} strokeWidth="1" />
        <image href={photo} x="6" y="2" width="28" height="28" clipPath={`url(#${clip})`} preserveAspectRatio="xMidYMid slice" />
      </svg>
    );
  }
  return (
    <svg className={`psy-pawn ${className ?? ''}`} viewBox="0 0 40 48" {...a11y}>
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

/** A deliberately bad, hand-drawn-looking crown for the winner. */
export function Crown({ className }: { className?: string }) {
  return (
    <svg className={`psy-crown ${className ?? ''}`} viewBox="0 0 60 40" aria-hidden="true">
      {/* Wonky outline: uneven points, a lopsided band, scribbled fill. */}
      <path
        d="M6 34 L4 13 L15 23 L21 5 L30 21 L38 3 L44 22 L57 10 L54 35 C40 37 22 38 6 34 Z"
        fill="#f7cf3d"
        stroke="#3b2a05"
        strokeWidth="2.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M9 28 C20 31 38 31 52 27" fill="none" stroke="#3b2a05" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10 18 L14 30 M18 24 L22 31 M28 25 L30 31 M40 24 L41 30 M47 22 L50 29" stroke="#e0a91a" strokeWidth="2" strokeLinecap="round" />
      <circle cx="21" cy="5" r="2.6" fill="#e8353b" stroke="#3b2a05" strokeWidth="1.4" />
      <circle cx="38.5" cy="3.5" r="2.2" fill="#3cc6d0" stroke="#3b2a05" strokeWidth="1.4" />
      <circle cx="56" cy="10" r="2.8" fill="#1fa34a" stroke="#3b2a05" strokeWidth="1.4" />
      <path d="M27 31 l3 -3 l3 3 l-3 2.5 z" fill="#d6338f" stroke="#3b2a05" strokeWidth="1.2" />
    </svg>
  );
}

/** The flat square scoring token in a player's colour (or their selfie). */
export function Token({ color, className, photo }: { color: string; className?: string; photo?: string }) {
  if (photo) {
    return (
      <img
        className={`psy-token psy-token--photo ${className ?? ''}`}
        src={photo}
        alt=""
        style={{ borderColor: color }}
      />
    );
  }
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
  const grad = useSvgId();
  return (
    <svg className={`psy-gold ${className ?? ''}`} viewBox="0 0 40 48" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e6cf86" />
          <stop offset="0.5" stopColor="#c9a64e" />
          <stop offset="1" stopColor="#8f6f22" />
        </linearGradient>
      </defs>
      <rect x="6" y="36" width="28" height="9" rx="2" fill={`url(#${grad})`} stroke="#7a5d1a" strokeWidth="1.2" />
      <path d="M12 36 L12 18 L28 18 L28 36" fill="none" stroke={`url(#${grad})`} strokeWidth="4" strokeLinejoin="round" />
      <rect x="10" y="4" width="20" height="16" rx="3" fill={`url(#${grad})`} stroke="#7a5d1a" strokeWidth="1.2" />
      <path d="M15 12 h10 M20 7 v10" stroke="#fff7d6" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}
