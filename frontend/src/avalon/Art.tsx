import { useId } from 'react';
import type { Alignment, RoleId } from './protocol';

function useSvgId(): string {
  return 'ava' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
}

/** Player avatar / shield pawn on TV and phones. */
export function KnightPawn({
  color,
  photo,
  className,
  title,
}: {
  color: string;
  photo?: string;
  className?: string;
  title?: string;
}) {
  const clip = useSvgId();
  const a11y = {
    role: title ? 'img' : undefined,
    'aria-label': title,
    'aria-hidden': title ? undefined : true,
  } as const;

  if (photo) {
    return (
      <svg className={`ava-pawn ava-pawn--photo ${className ?? ''}`} viewBox="0 0 44 44" {...a11y}>
        <defs>
          <clipPath id={clip}>
            <circle cx="22" cy="22" r="18" />
          </clipPath>
        </defs>
        <circle cx="22" cy="22" r="20.5" fill="#131926" stroke={color} strokeWidth="3" />
        <image
          href={photo}
          x="4"
          y="4"
          width="36"
          height="36"
          clipPath={`url(#${clip})`}
          preserveAspectRatio="xMidYMid slice"
        />
      </svg>
    );
  }

  return (
    <svg className={`ava-pawn ${className ?? ''}`} viewBox="0 0 44 48" {...a11y}>
      <path
        d="M22 3 L39 10 V24 C39 34.5 31.8 42.2 22 45 C12.2 42.2 5 34.5 5 24 V10 Z"
        fill="#151d2e"
        stroke={color}
        strokeWidth="2.8"
        strokeLinejoin="round"
      />
      <path
        d="M22 8 L34 13 V23.5 C34 31.2 28.8 37.2 22 39.5 C15.2 37.2 10 31.2 10 23.5 V13 Z"
        fill={color}
        fillOpacity="0.24"
      />
      {/* Knight visor helm silhouette */}
      <path
        d="M16 20 C16 14.5 28 14.5 28 20 V29 L22 33 L16 29 Z"
        fill={color}
        stroke="#0b0f19"
        strokeWidth="1.4"
      />
      <path d="M18 22 H26 M22 20 V30" stroke="#0b0f19" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Compact circular player badge for inline names and lists. */
export function Token({
  color,
  photo,
  className,
}: {
  color: string;
  photo?: string;
  className?: string;
}) {
  if (photo) {
    return (
      <img
        className={`ava-token ava-token--photo ${className ?? ''}`}
        src={photo}
        alt=""
        style={{ borderColor: color }}
      />
    );
  }
  return (
    <span
      className={`ava-token ${className ?? ''}`}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}

/** Leader Crown / Seal icon. */
export function LeaderCrown({ className }: { className?: string }) {
  return (
    <svg className={`ava-crown ${className ?? ''}`} viewBox="0 0 36 28" aria-hidden="true">
      <path
        d="M4 23 L2 8 L11 15 L18 4 L25 15 L34 8 L32 23 Z"
        fill="#eab308"
        stroke="#713f12"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="18" cy="4" r="2.2" fill="#fef08a" />
      <circle cx="2.5" cy="8" r="2" fill="#3b82f6" />
      <circle cx="33.5" cy="8" r="2" fill="#ef4444" />
    </svg>
  );
}

/** Grail Crest for the Avalon Hero / Lobby header. */
export function AvalonCrest({ className }: { className?: string }) {
  const grad = useSvgId();
  return (
    <svg className={`ava-crest ${className ?? ''}`} viewBox="0 0 120 128" aria-hidden="true">
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fde047" />
          <stop offset="50%" stopColor="#d4af37" />
          <stop offset="100%" stopColor="#854d0e" />
        </linearGradient>
      </defs>
      {/* Split Arthurian Blue / Mordred Crimson Shield */}
      <path
        d="M60 6 L108 24 V62 C108 92 87 112 60 122 C33 112 12 92 12 62 V24 Z"
        fill="#0f172a"
        stroke={`url(#${grad})`}
        strokeWidth="4"
      />
      <path
        d="M60 11 V117 C36 108 17 89 17 62 V27 Z"
        fill="#1d4ed8"
        fillOpacity="0.45"
      />
      <path
        d="M60 11 L103 27 V62 C103 89 84 108 60 117 Z"
        fill="#b91c1c"
        fillOpacity="0.45"
      />
      {/* Excalibur & Grail */}
      <path d="M60 18 V106" stroke={`url(#${grad})`} strokeWidth="4" strokeLinecap="round" />
      <path d="M40 38 H80" stroke={`url(#${grad})`} strokeWidth="4.5" strokeLinecap="round" />
      <path
        d="M44 52 H76 L71 74 C69 83 51 83 49 74 Z"
        fill={`url(#${grad})`}
        stroke="#422006"
        strokeWidth="2"
      />
      <path d="M50 94 H70" stroke={`url(#${grad})`} strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  );
}

/** Role Emblem SVG for character cards. */
export function RoleEmblem({
  role,
  alignment,
  className,
}: {
  role: RoleId;
  alignment: Alignment;
  className?: string;
}) {
  const stroke = alignment === 'good' ? '#60a5fa' : '#f87171';
  const accent = '#eab308';
  return (
    <svg className={`ava-emblem ${className ?? ''}`} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="28" fill="#0b1120" stroke={stroke} strokeWidth="2.5" />
      {role === 'merlin' && (
        <>
          <path d="M32 12 L46 46 H18 Z" fill="none" stroke={accent} strokeWidth="2.6" />
          <circle cx="32" cy="33" r="6" fill={stroke} />
          <circle cx="32" cy="33" r="2.3" fill="#fff" />
        </>
      )}
      {role === 'percival' && (
        <>
          <path
            d="M32 13 L48 20 V33 C48 43 41 50 32 53 C23 50 16 43 16 33 V20 Z"
            fill="none"
            stroke={accent}
            strokeWidth="2.6"
          />
          <path d="M32 20 V45 M22 31 H42" stroke={stroke} strokeWidth="2.8" strokeLinecap="round" />
        </>
      )}
      {role === 'servant' && (
        <>
          <path d="M32 14 V50 M22 24 H42" stroke={accent} strokeWidth="3.2" strokeLinecap="round" />
          <circle cx="32" cy="32" r="14" fill="none" stroke={stroke} strokeWidth="2" />
        </>
      )}
      {role === 'assassin' && (
        <>
          <path d="M20 46 L44 18 M40 16 L46 22" stroke={stroke} strokeWidth="3.2" strokeLinecap="round" />
          <path d="M18 42 L24 48" stroke={accent} strokeWidth="3" strokeLinecap="round" />
          <circle cx="32" cy="32" r="16" fill="none" stroke={stroke} strokeDasharray="4 4" strokeWidth="1.8" />
        </>
      )}
      {role === 'morgana' && (
        <>
          <path
            d="M24 18 C16 26 16 38 24 46 C32 42 36 32 24 18 Z"
            fill={stroke}
            fillOpacity="0.4"
            stroke={accent}
            strokeWidth="2.4"
          />
          <circle cx="39" cy="28" r="4.5" fill={stroke} />
        </>
      )}
      {role === 'mordred' && (
        <>
          <path
            d="M16 42 L20 22 L28 31 L32 18 L36 31 L44 22 L48 42 Z"
            fill="none"
            stroke={stroke}
            strokeWidth="2.6"
            strokeLinejoin="round"
          />
          <circle cx="27" cy="36" r="2" fill={accent} />
          <circle cx="37" cy="36" r="2" fill={accent} />
        </>
      )}
      {role === 'oberon' && (
        <>
          <path
            d="M16 32 Q32 16 48 32 Q32 48 16 32 Z"
            fill="none"
            stroke={stroke}
            strokeWidth="2.5"
          />
          <line x1="18" y1="46" x2="46" y2="18" stroke={accent} strokeWidth="2.4" />
        </>
      )}
      {role === 'minion' && (
        <>
          <path
            d="M20 22 L32 14 L44 22 V38 L32 50 L20 38 Z"
            fill="none"
            stroke={stroke}
            strokeWidth="2.5"
          />
          <path d="M26 28 L38 40 M38 28 L26 40" stroke={accent} strokeWidth="2.5" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
