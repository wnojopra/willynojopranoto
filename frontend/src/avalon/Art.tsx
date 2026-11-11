import { useId } from 'react';
import type { Alignment, QuestResult, QuestSpec, RoleId } from './protocol';

function useSvgId(): string {
  return 'ava' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Physical Score Marker Disc (Arthur's Blue/Gold Star-Burst vs Mordred's Crimson/Silver Star-Burst),
 * matching the cardboard punch-out tokens in the physical Avalon box.
 */
export function ScoreMarkerDisc({
  succeeded,
  size = 128,
}: {
  succeeded: boolean;
  size?: number;
}) {
  const id = useSvgId();
  const points = 8;
  const starPath: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? 52 : 24;
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const x = 64 + Math.cos(angle) * r;
    const y = 64 + Math.sin(angle) * r;
    starPath.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  starPath.push('Z');

  return (
    <svg viewBox="0 0 128 128" width={size} height={size} className="ava-disc" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-bg`} cx="38%" cy="32%" r="70%">
          {succeeded ? (
            <>
              <stop offset="0%" stopColor="#3c4654" />
              <stop offset="65%" stopColor="#232933" />
              <stop offset="100%" stopColor="#14181f" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#94382c" />
              <stop offset="65%" stopColor="#692018" />
              <stop offset="100%" stopColor="#3d0f0a" />
            </>
          )}
        </radialGradient>
        <linearGradient id={`${id}-star`} x1="0" y1="0" x2="1" y2="1">
          {succeeded ? (
            <>
              <stop offset="0%" stopColor="#fff099" />
              <stop offset="50%" stopColor="#e0b236" />
              <stop offset="100%" stopColor="#8c6210" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#f5ebd6" />
              <stop offset="50%" stopColor="#c9b896" />
              <stop offset="100%" stopColor="#7a6a4f" />
            </>
          )}
        </linearGradient>
        <radialGradient id={`${id}-gem`} cx="35%" cy="30%" r="70%">
          {succeeded ? (
            <>
              <stop offset="0%" stopColor="#93c5fd" />
              <stop offset="55%" stopColor="#2563eb" />
              <stop offset="100%" stopColor="#1e3a8a" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#fca5a5" />
              <stop offset="55%" stopColor="#dc2626" />
              <stop offset="100%" stopColor="#7f1d1d" />
            </>
          )}
        </radialGradient>
      </defs>
      {/* Cardboard bevel edge */}
      <circle cx="64" cy="66" r="59" fill="rgba(0,0,0,0.55)" />
      <circle
        cx="64"
        cy="64"
        r="58"
        fill={`url(#${id}-bg)`}
        stroke={succeeded ? '#8a95a5' : '#b87b6a'}
        strokeWidth="2.5"
      />
      <circle
        cx="64"
        cy="64"
        r="53"
        fill="none"
        stroke="rgba(255,255,255,0.14)"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      {/* 8-point compass star */}
      <path
        d={starPath.join(' ')}
        fill={`url(#${id}-star)`}
        stroke={succeeded ? '#5c3d04' : '#4a3525'}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {/* Center medallion */}
      <circle
        cx="64"
        cy="64"
        r="21"
        fill={`url(#${id}-gem)`}
        stroke={`url(#${id}-star)`}
        strokeWidth="3"
      />
      {/* Inner crest silhouette (Arthurian Dragon vs Mordred Double-Headed Eagle) */}
      {succeeded ? (
        <path
          d="M58 72 C55 66 57 57 64 53 C68 56 71 60 69 66 C66 64 63 65 62 72 Z M56 59 L64 50 L72 59"
          fill="#fde047"
          stroke="#713f12"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M54 58 L60 64 L55 71 M74 58 L68 64 L73 71 M64 52 V74 M58 56 H70"
          fill="none"
          stroke="#fee2e2"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

/**
 * Physical Round Marker Token (Gold shield with red/gold cross on an aged bronze token).
 */
export function RoundMarkerToken({ size = 56 }: { size?: number }) {
  const id = useSvgId();
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className="ava-round-token" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-bronze`} cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#d6b265" />
          <stop offset="60%" stopColor="#8c6724" />
          <stop offset="100%" stopColor="#4a330c" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="34" r="28" fill="rgba(0,0,0,0.55)" />
      <circle cx="32" cy="32" r="27" fill={`url(#${id}-bronze)`} stroke="#f3d88c" strokeWidth="2" />
      <path
        d="M32 13 L46 19 V31 C46 41 39.5 47.5 32 50 C24.5 47.5 18 41 18 31 V19 Z"
        fill="#fef08a"
        stroke="#5c3a08"
        strokeWidth="2"
      />
      <path
        d="M32 15 V48 M19.5 29 H44.5"
        stroke="#b91c1c"
        strokeWidth="4.2"
      />
    </svg>
  );
}

/**
 * Physical Vote Track Marker Token (Ivory stone disc with the purple drawstring pouch icon).
 */
export function VoteTrackToken({ size = 56 }: { size?: number }) {
  const id = useSvgId();
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className="ava-vote-marker" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-ivory`} cx="38%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#f5efe0" />
          <stop offset="70%" stopColor="#d1c5ab" />
          <stop offset="100%" stopColor="#8f8268" />
        </radialGradient>
        <linearGradient id={`${id}-pouch`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="55%" stopColor="#7e22ce" />
          <stop offset="100%" stopColor="#4c1d95" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="34" r="28" fill="rgba(0,0,0,0.55)" />
      <circle cx="32" cy="32" r="27" fill={`url(#${id}-ivory)`} stroke="#eee5d3" strokeWidth="2" />
      {/* Purple velvet pouch */}
      <path
        d="M25 18 L39 18 L35 24 L29 24 Z"
        fill={`url(#${id}-pouch)`}
        stroke="#3b0764"
        strokeWidth="1.5"
      />
      <path
        d="M28 24 C20 28 18 40 22 45 C25 48 39 48 42 45 C46 40 44 28 36 24 Z"
        fill={`url(#${id}-pouch)`}
        stroke="#3b0764"
        strokeWidth="1.5"
      />
      <path d="M26 24 H38" stroke="#eab308" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The Physical Avalon Score Tableau Board (SVG).
 * Faithful to the painted board game tableau: autumn forest & stone castle tower,
 * curved "Quest 1..5" text over circular recesses, curved "Two fails required" on Quest 4
 * when 7+ players, small round-marker recesses at the bottom-right of each Quest circle,
 * the "VOTE TRACK" ribbon, and the 1..5 vote track circles (with 5 glowing crimson).
 */
export function TableauBoard({
  numPlayers,
  evilCount,
  round,
  rejectedCount,
  questSpecs,
  questResults,
}: {
  numPlayers: number;
  evilCount: number;
  round: number;
  rejectedCount: number;
  questSpecs: QuestSpec[];
  questResults: (QuestResult | null)[];
}) {
  const id = useSvgId();
  const questCenters = [150, 325, 500, 675, 850];
  const questY = 215;
  const questR = 72;

  const voteCenters = [135, 265, 395, 525, 655];
  const voteY = 420;
  const voteR = 48;

  // Active proposal number is rejectedCount + 1 (clamped 1..5)
  const activeVoteSlot = Math.min(5, Math.max(1, rejectedCount + 1));

  return (
    <svg
      className="ava-tableau-svg"
      viewBox="0 0 1000 520"
      role="img"
      aria-label={`Avalon Quest Tableau: Round ${round} of 5, Vote Track ${activeVoteSlot} of 5`}
    >
      <defs>
        {/* Autumn forest & misty stone background */}
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3d2310" />
          <stop offset="35%" stopColor="#69411e" />
          <stop offset="65%" stopColor="#3a332a" />
          <stop offset="100%" stopColor="#1c211b" />
        </linearGradient>
        <radialGradient id={`${id}-sunbeam`} cx="34%" cy="22%" r="55%">
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.48" />
          <stop offset="50%" stopColor="#d97706" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-ground`} cx="50%" cy="95%" r="65%">
          <stop offset="0%" stopColor="#3d1e12" stopOpacity="0.7" />
          <stop offset="50%" stopColor="#1e2616" stopOpacity="0.82" />
          <stop offset="100%" stopColor="#0e120d" stopOpacity="0.95" />
        </radialGradient>
        <radialGradient id={`${id}-well`} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="rgba(255, 235, 200, 0.16)" />
          <stop offset="70%" stopColor="rgba(15, 12, 8, 0.42)" />
          <stop offset="100%" stopColor="rgba(0, 0, 0, 0.68)" />
        </radialGradient>
        <radialGradient id={`${id}-fifth`} cx="45%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.88" />
          <stop offset="70%" stopColor="#991b1b" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#450a0a" stopOpacity="0.92" />
        </radialGradient>
        <filter id={`${id}-shadow`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#000" floodOpacity="0.75" />
        </filter>

        {/* Curved text paths for "Quest 1..5" and "Two fails required" */}
        {questCenters.map((cx, idx) => (
          <g key={idx}>
            <path
              id={`${id}-qarc-${idx}`}
              d={`M ${cx - 54},${questY - 18} A 56,56 0 0,1 ${cx + 54},${questY - 18}`}
            />
            <path
              id={`${id}-twofail-${idx}`}
              d={`M ${cx - 82},${questY - 22} A 84,84 0 0,1 ${cx + 82},${questY - 22}`}
            />
          </g>
        ))}
      </defs>

      {/* Painted board base */}
      <rect width="1000" height="520" rx="22" fill={`url(#${id}-sky)`} />
      <rect width="1000" height="520" rx="22" fill={`url(#${id}-sunbeam)`} />

      {/* Distant autumn forest trees */}
      <g opacity="0.38" fill="#1c1209">
        <rect x="45" y="0" width="18" height="360" />
        <rect x="95" y="0" width="12" height="340" />
        <rect x="165" y="0" width="28" height="380" />
        <rect x="245" y="0" width="14" height="340" />
        <rect x="390" y="0" width="20" height="350" />
        <rect x="495" y="0" width="24" height="360" />
        <rect x="890" y="0" width="22" height="370" />
        <rect x="945" y="0" width="15" height="350" />
      </g>

      {/* Stone Castle Watchtower behind Quests 4 & 5 (matching the 7-player physical board) */}
      <g transform="translate(615, 78)" opacity="0.58">
        <path
          d="M10,270 L18,32 L0,32 L0,8 L24,8 L24,20 L44,20 L44,8 L68,8 L68,20 L88,20 L88,8 L112,8 L112,20 L132,20 L132,8 L156,8 L156,20 L176,20 L176,8 L200,8 L200,32 L184,32 L192,270 Z"
          fill="#2d2620"
          stroke="#171310"
          strokeWidth="3"
        />
        {/* Arched gothic windows */}
        <path d="M88,65 C88,50 112,50 112,65 V105 H88 Z" fill="#0d0b09" stroke="#574a3d" strokeWidth="2" />
        <path d="M48,185 C48,165 76,165 76,185 V255 H48 Z" fill="#17130e" stroke="#574a3d" strokeWidth="2" />
        <path d="M128,185 C128,165 156,165 156,185 V255 H128 Z" fill="#293024" stroke="#574a3d" strokeWidth="2" />
      </g>

      {/* Mossy forest floor */}
      <path d="M0,330 Q500,305 1000,335 L1000,520 L0,520 Z" fill={`url(#${id}-ground)`} />

      {/* Outer board bevel frame */}
      <rect
        x="6"
        y="6"
        width="988"
        height="508"
        rx="18"
        fill="none"
        stroke="rgba(218, 185, 120, 0.42)"
        strokeWidth="3"
      />

      {/* 5 Quest Circles */}
      {questSpecs.map((spec, idx) => {
        const cx = questCenters[idx];
        const res = questResults[idx];
        const isCurrent = round === spec.quest;
        const subX = cx + 48;
        const subY = questY + 54;

        return (
          <g key={spec.quest}>
            {/* Curved "Two fails required" header above Quest 4 when applicable */}
            {spec.failsRequired > 1 && (
              <text
                fill="#f8fafc"
                fontFamily="Cinzel, Georgia, serif"
                fontSize="15.5"
                fontWeight="700"
                letterSpacing="1.2"
                filter={`url(#${id}-shadow)`}
              >
                <textPath href={`#${id}-twofail-${idx}`} startOffset="50%" textAnchor="middle">
                  Two fails required
                </textPath>
              </text>
            )}

            {/* Main Quest Circle Well */}
            <circle
              cx={cx}
              cy={questY}
              r={questR}
              fill={`url(#${id}-well)`}
              stroke={isCurrent ? '#facc15' : 'rgba(235, 215, 175, 0.55)'}
              strokeWidth={isCurrent ? 3.5 : 2.2}
            />
            <circle
              cx={cx}
              cy={questY}
              r={questR - 5}
              fill="none"
              stroke="rgba(0,0,0,0.45)"
              strokeWidth="2"
            />

            {/* Curved "Quest N" label inside top arc */}
            <text
              fill="#f5efe0"
              fontFamily="Cinzel, Georgia, serif"
              fontSize="17"
              fontWeight="700"
              letterSpacing="1.5"
              filter={`url(#${id}-shadow)`}
            >
              <textPath href={`#${id}-qarc-${idx}`} startOffset="50%" textAnchor="middle">
                Quest {spec.quest}
              </textPath>
            </text>

            {/* Giant carved team size numeral */}
            <text
              x={cx}
              y={questY + 30}
              textAnchor="middle"
              fill="#f8f5ec"
              stroke="#1c1610"
              strokeWidth="2"
              paintOrder="stroke"
              fontFamily="Cinzel Decorative, Cinzel, Georgia, serif"
              fontSize="68"
              fontWeight="900"
              filter={`url(#${id}-shadow)`}
            >
              {spec.teamSize}
            </text>

            {/* Scored Marker Disc overlay if Quest is completed */}
            {res && (
              <g transform={`translate(${cx - 72}, ${questY - 72})`}>
                <ScoreMarkerDisc succeeded={res.succeeded} size={144} />
              </g>
            )}

            {/* Small Round Marker Recess at bottom-right of Quest Circle */}
            <circle
              cx={subX}
              cy={subY}
              r="28"
              fill="rgba(25, 32, 24, 0.72)"
              stroke="rgba(215, 198, 160, 0.5)"
              strokeWidth="2"
            />
            {isCurrent && (
              <g transform={`translate(${subX - 28}, ${subY - 28})`}>
                <RoundMarkerToken size={56} />
              </g>
            )}
          </g>
        );
      })}

      {/* "VOTE TRACK" stone plaque on the left */}
      <g transform="translate(18, 328)">
        <rect
          x="0"
          y="0"
          width="176"
          height="36"
          rx="10"
          fill="rgba(18, 20, 16, 0.88)"
          stroke="rgba(215, 198, 160, 0.55)"
          strokeWidth="2"
        />
        <text
          x="88"
          y="24"
          textAnchor="middle"
          fill="#f5efe0"
          fontFamily="Cinzel, Georgia, serif"
          fontSize="17"
          fontWeight="700"
          letterSpacing="2"
        >
          VOTE TRACK
        </text>
      </g>

      {/* 5 Vote Track Circles */}
      {voteCenters.map((cx, i) => {
        const num = i + 1;
        const isFifth = num === 5;
        const hasToken = activeVoteSlot === num;
        return (
          <g key={num}>
            <circle
              cx={cx}
              cy={voteY}
              r={voteR}
              fill={isFifth ? `url(#${id}-fifth)` : `url(#${id}-well)`}
              stroke={isFifth ? '#f87171' : 'rgba(225, 210, 180, 0.52)'}
              strokeWidth={isFifth ? 3 : 2.2}
            />
            <text
              x={cx}
              y={voteY + 18}
              textAnchor="middle"
              fill="#f8f5ec"
              stroke="#1c1610"
              strokeWidth="1.5"
              paintOrder="stroke"
              fontFamily="Cinzel Decorative, Cinzel, Georgia, serif"
              fontSize="48"
              fontWeight="900"
              filter={`url(#${id}-shadow)`}
            >
              {num}
            </text>
            {hasToken && (
              <g transform={`translate(${cx - 34}, ${voteY - 34})`}>
                <VoteTrackToken size={68} />
              </g>
            )}
          </g>
        );
      })}

      {/* Bottom-right Player Count & Minions plaque (exact match to board corner) */}
      <g transform="translate(725, 396)">
        <rect
          x="0"
          y="0"
          width="255"
          height="68"
          rx="12"
          fill="rgba(16, 14, 12, 0.82)"
          stroke="rgba(215, 198, 160, 0.45)"
          strokeWidth="2"
        />
        <text
          x="22"
          y="28"
          fill="#f5efe0"
          fontFamily="Crimson Pro, Georgia, serif"
          fontSize="21"
          fontWeight="700"
        >
          {numPlayers} Players ••••
        </text>
        <text
          x="38"
          y="53"
          fill="#e7d8b9"
          fontFamily="Crimson Pro, Georgia, serif"
          fontSize="20"
          fontWeight="600"
        >
          {evilCount} Minions of Mordred
        </text>
      </g>
    </svg>
  );
}

/**
 * Physical Vote Token ("APPROVE" ivory/parchment wax-seal disc vs "REJECT" charred obsidian disc).
 */
export function VoteTokenBadge({ approve, size = 'md' }: { approve: boolean; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span
      className={`ava-votetoken ava-votetoken--${approve ? 'approve' : 'reject'} ava-votetoken--${size}`}
    >
      <span className="ava-votetoken__rim">{approve ? 'APPROVE' : 'REJECT'}</span>
    </span>
  );
}

/**
 * Physical Quest Card (Gold Grail Chalice for SUCCESS vs Red Mordred Goblet/Dagger for FAIL).
 */
export function QuestChaliceCard({
  kind,
  interactive,
  disabled,
  onClick,
  id,
}: {
  kind: 'success' | 'fail';
  interactive?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  id?: string;
}) {
  const isSuccess = kind === 'success';
  const svgId = useSvgId();
  const inner = (
    <>
      <svg viewBox="0 0 160 220" className="ava-chalice-svg" aria-hidden="true">
        <defs>
          <radialGradient id={`${svgId}-card`} cx="50%" cy="40%" r="70%">
            {isSuccess ? (
              <>
                <stop offset="0%" stopColor="#423316" />
                <stop offset="65%" stopColor="#261c0a" />
                <stop offset="100%" stopColor="#120d04" />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor="#4c1515" />
                <stop offset="65%" stopColor="#290909" />
                <stop offset="100%" stopColor="#140404" />
              </>
            )}
          </radialGradient>
          <linearGradient id={`${svgId}-metal`} x1="0" y1="0" x2="1" y2="1">
            {isSuccess ? (
              <>
                <stop offset="0%" stopColor="#fef08a" />
                <stop offset="50%" stopColor="#d4af37" />
                <stop offset="100%" stopColor="#784b08" />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor="#fca5a5" />
                <stop offset="45%" stopColor="#b91c1c" />
                <stop offset="100%" stopColor="#450a0a" />
              </>
            )}
          </linearGradient>
        </defs>
        <rect
          x="4"
          y="4"
          width="152"
          height="212"
          rx="12"
          fill={`url(#${svgId}-card)`}
          stroke={`url(#${svgId}-metal)`}
          strokeWidth="3.5"
        />
        <rect
          x="12"
          y="12"
          width="136"
          height="196"
          rx="7"
          fill="none"
          stroke="rgba(235, 205, 140, 0.32)"
          strokeWidth="1.2"
        />
        {/* Radiant halo behind the chalice */}
        <circle
          cx="80"
          cy="92"
          r="46"
          fill="none"
          stroke={`url(#${svgId}-metal)`}
          strokeWidth="1.5"
          strokeDasharray="4 4"
          opacity="0.65"
        />
        {/* Ornate Grail Chalice */}
        <path
          d="M52,52 H108 L100,94 C96,112 64,112 60,94 Z"
          fill={`url(#${svgId}-metal)`}
          stroke="#1c1105"
          strokeWidth="2"
        />
        <rect x="74" y="108" width="12" height="34" fill={`url(#${svgId}-metal)`} />
        <ellipse cx="80" cy="124" rx="14" ry="5" fill={`url(#${svgId}-metal)`} />
        <path d="M56,148 L104,148 L112,158 H48 Z" fill={`url(#${svgId}-metal)`} />
        {isSuccess ? (
          <path d="M80 64 V88 M68 76 H92" stroke="#422006" strokeWidth="3" strokeLinecap="round" />
        ) : (
          <path d="M70 66 L90 86 M90 66 L70 86" stroke="#fee2e2" strokeWidth="3" strokeLinecap="round" />
        )}
        <text
          x="80"
          y="188"
          textAnchor="middle"
          fill={isSuccess ? '#fef08a' : '#fecaca'}
          fontFamily="Cinzel, Georgia, serif"
          fontSize="16"
          fontWeight="800"
          letterSpacing="2"
        >
          {isSuccess ? 'SUCCESS' : 'FAIL'}
        </text>
      </svg>
    </>
  );

  if (interactive) {
    return (
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={`ava-chalice-btn ava-chalice-btn--${kind}`}
      >
        {inner}
      </button>
    );
  }
  return <div className={`ava-chalice-card ava-chalice-card--${kind}`}>{inner}</div>;
}

/** Player Heraldic Shield Pawn on TV and phones. */
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
      <svg className={`ava-pawn ava-pawn--photo ${className ?? ''}`} viewBox="0 0 44 48" {...a11y}>
        <defs>
          <clipPath id={clip}>
            <path d="M22 4 L39 10 V24 C39 34.5 31.8 42.2 22 45 C12.2 42.2 5 34.5 5 24 V10 Z" />
          </clipPath>
        </defs>
        <path
          d="M22 2 L41 9 V24 C41 35.8 33 44 22 47 C11 44 3 35.8 3 24 V9 Z"
          fill="#241c14"
          stroke={color}
          strokeWidth="3"
        />
        <image
          href={photo}
          x="3"
          y="3"
          width="38"
          height="42"
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
        fill="#241c14"
        stroke="#d6b265"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path
        d="M22 7 L35 12 V23.5 C35 31.6 29.3 37.8 22 40.2 C14.7 37.8 9 31.6 9 23.5 V12 Z"
        fill={color}
        fillOpacity="0.82"
      />
      {/* Medieval Great Helm */}
      <path
        d="M16 20 C16 14.5 28 14.5 28 20 V29 L22 33 L16 29 Z"
        fill="#e7dec8"
        stroke="#1c150e"
        strokeWidth="1.5"
      />
      <path d="M18 22 H26 M22 20 V30" stroke="#1c150e" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Compact circular wax-seal token for inline names. */
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

/** Leader Shield Seal Token (matching the physical Leader Token shield). */
export function LeaderCrown({ className }: { className?: string }) {
  return (
    <svg className={`ava-crown ${className ?? ''}`} viewBox="0 0 32 36" aria-hidden="true">
      <path
        d="M16 2 L29 7 V18 C29 26 23.5 31.5 16 34 C8.5 31.5 3 26 3 18 V7 Z"
        fill="#eab308"
        stroke="#5c3a08"
        strokeWidth="2.2"
      />
      <path d="M16 5 V31 M6 16 H26" stroke="#b91c1c" strokeWidth="3.8" />
      <circle cx="16" cy="16" r="4.5" fill="#fef08a" stroke="#5c3a08" strokeWidth="1.2" />
    </svg>
  );
}

/** Box-art inspired Castle & Grail Crest for Lobby Hero. */
export function AvalonCrest({ className }: { className?: string }) {
  const grad = useSvgId();
  return (
    <svg className={`ava-crest ${className ?? ''}`} viewBox="0 0 140 148" aria-hidden="true">
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff3b0" />
          <stop offset="45%" stopColor="#d4a338" />
          <stop offset="100%" stopColor="#6e470b" />
        </linearGradient>
        <radialGradient id={`${grad}-sky`} cx="50%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#e8d5b5" />
          <stop offset="55%" stopColor="#8c6d46" />
          <stop offset="100%" stopColor="#2b2116" />
        </radialGradient>
      </defs>
      {/* Stone & Brass Framed Shield */}
      <path
        d="M70 6 L126 26 V70 C126 106 102 129 70 142 C38 129 14 106 14 70 V26 Z"
        fill={`url(#${grad}-sky)`}
        stroke={`url(#${grad})`}
        strokeWidth="4.5"
      />
      {/* Camelot Castle Silhouette on the Hill */}
      <path
        d="M36 96 L36 62 L42 50 L48 62 L48 70 L56 70 L56 44 L63 30 L70 44 L70 56 L78 56 L78 38 L85 26 L92 38 L92 66 L102 66 L102 96 Z"
        fill="#2b1d10"
        stroke="#d4a338"
        strokeWidth="1.2"
      />
      {/* Mossy hill */}
      <path
        d="M22 94 Q70 76 118 94 C110 116 92 128 70 137 C48 128 30 116 22 94 Z"
        fill="#2d3a1e"
      />
      {/* Excalibur Sword down the center */}
      <path d="M70 16 V128 M50 38 H90" stroke={`url(#${grad})`} strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/** Role Sigil & Portrait Medallion for Character Cards (Arthur's Blue Sigil vs Mordred's Red Sigil). */
export function RoleEmblem({
  role,
  alignment,
  className,
}: {
  role: RoleId;
  alignment: Alignment;
  className?: string;
}) {
  const id = useSvgId();
  const isGood = alignment === 'good';
  return (
    <svg className={`ava-emblem ${className ?? ''}`} viewBox="0 0 72 72" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-sigil`} cx="40%" cy="35%" r="65%">
          {isGood ? (
            <>
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="65%" stopColor="#1e3a8a" />
              <stop offset="100%" stopColor="#0f172a" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#dc2626" />
              <stop offset="65%" stopColor="#7f1d1d" />
              <stop offset="100%" stopColor="#2a0707" />
            </>
          )}
        </radialGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="50%" stopColor="#c8962e" />
          <stop offset="100%" stopColor="#614108" />
        </linearGradient>
      </defs>
      <circle
        cx="36"
        cy="36"
        r="32"
        fill={`url(#${id}-sigil)`}
        stroke={`url(#${id}-rim)`}
        strokeWidth="3.5"
      />
      <circle
        cx="36"
        cy="36"
        r="27"
        fill="none"
        stroke="rgba(255, 235, 180, 0.35)"
        strokeWidth="1"
      />
      {role === 'merlin' && (
        <>
          {/* Wizard's Staff & All-Seeing Eye */}
          <path d="M36 14 L52 50 H20 Z" fill="none" stroke="#fef08a" strokeWidth="2.5" />
          <circle cx="36" cy="36" r="7" fill="#93c5fd" stroke="#fef08a" strokeWidth="2" />
          <circle cx="36" cy="36" r="2.5" fill="#1e3a8a" />
        </>
      )}
      {role === 'percival' && (
        <>
          {/* Grail Knight Shield & Cross */}
          <path
            d="M36 15 L52 22 V36 C52 46 45 53 36 57 C27 53 20 46 20 36 V22 Z"
            fill="none"
            stroke="#fef08a"
            strokeWidth="2.5"
          />
          <path d="M36 21 V50 M25 34 H47" stroke="#93c5fd" strokeWidth="3" strokeLinecap="round" />
        </>
      )}
      {role === 'servant' && (
        <>
          {/* Arthur's Pendragon Crest */}
          <path d="M36 16 V56 M24 27 H48" stroke="#fef08a" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="36" cy="36" r="13" fill="none" stroke="#93c5fd" strokeWidth="2.2" />
        </>
      )}
      {role === 'assassin' && (
        <>
          {/* Crossed Crimson Daggers */}
          <path d="M22 50 L50 20 M45 18 L52 25" stroke="#fecaca" strokeWidth="3.2" strokeLinecap="round" />
          <path d="M20 45 L27 52" stroke="#eab308" strokeWidth="3.2" strokeLinecap="round" />
          <circle cx="36" cy="36" r="16" fill="none" stroke="#fca5a5" strokeDasharray="4 3" strokeWidth="1.8" />
        </>
      )}
      {role === 'morgana' && (
        <>
          {/* Enchantress Crescent & Illusion Veil */}
          <path
            d="M29 19 C19 28 19 44 29 53 C39 48 43 36 29 19 Z"
            fill="#fca5a5"
            fillOpacity="0.45"
            stroke="#fef08a"
            strokeWidth="2.4"
          />
          <circle cx="44" cy="31" r="5" fill="#fef08a" />
        </>
      )}
      {role === 'mordred' && (
        <>
          {/* Iron Jagged Crown of Mordred */}
          <path
            d="M18 47 L22 25 L31 35 L36 20 L41 35 L50 25 L54 47 Z"
            fill="#450a0a"
            stroke="#fef08a"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <circle cx="31" cy="40" r="2.2" fill="#f87171" />
          <circle cx="41" cy="40" r="2.2" fill="#f87171" />
        </>
      )}
      {role === 'oberon' && (
        <>
          {/* Blindfolded Shadow Sigil */}
          <path
            d="M18 36 Q36 20 54 36 Q36 52 18 36 Z"
            fill="none"
            stroke="#fecaca"
            strokeWidth="2.5"
          />
          <line x1="20" y1="52" x2="52" y2="20" stroke="#fef08a" strokeWidth="2.8" />
        </>
      )}
      {role === 'minion' && (
        <>
          {/* Mordred's Skull & Serpents Sigil */}
          <path
            d="M22 25 L36 16 L50 25 V42 L36 55 L22 42 Z"
            fill="none"
            stroke="#fecaca"
            strokeWidth="2.5"
          />
          <path d="M29 30 L43 44 M43 30 L29 44" stroke="#fef08a" strokeWidth="2.8" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
