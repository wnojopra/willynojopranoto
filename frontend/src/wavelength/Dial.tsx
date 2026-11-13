import { useRef } from 'react';
import { BRAND_COLORS } from './protocol';

const CX = 200;
const CY = 200;
const TARGET_EDGES = [-22.5, -13.5, -4.5, 4.5, 13.5, 22.5] as const;

function polar(angleDeg: number, r: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)];
}

function wedgePath(a1: number, a2: number, r: number): string {
  const [x1, y1] = polar(a1, r);
  const [x2, y2] = polar(a2, r);
  return `M ${CX} ${CY} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export interface ExtraNeedle {
  id: string;
  name: string;
  color: string;
  angle: number;
  avatarUrl?: string;
}

export interface DialProps {
  /** Unique prefix for SVG defs so multiple dials on one page don't collide */
  idPrefix?: string;
  /** Whether the shutter is rotated open to show the target wedges */
  isOpen: boolean;
  /** Target center angle (-90..+90), or null if hidden */
  targetAngle: number | null;
  /** Main needle angle (-90..+90) */
  needleAngle: number;
  /** Whether to show the main needle */
  showNeedle: boolean;
  /** Whether the user can drag the needle on this dial */
  canDrag?: boolean;
  /** Called while dragging or adjusting via keyboard */
  onAngleChange?: (angle: number) => void;
  /** Scoring band labels [bullseye, close, near] */
  bands: [number, number, number];
  /** Gradient rim colors [leftColor, rightColor] */
  rimColors?: [string, string];
  /** Hub dot accent color */
  hubColor?: string;
  /** Optional multiple player needles (for Free-for-All reveal) */
  extraNeedles?: ExtraNeedle[];
}

export function Dial({
  idPrefix = 'wl-dial',
  isOpen,
  targetAngle,
  needleAngle,
  showNeedle,
  canDrag = false,
  onAngleChange,
  bands,
  rimColors = BRAND_COLORS,
  hubColor = '#ff5d8f',
  extraNeedles = [],
}: DialProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef(false);

  const [bullseyePts, closePts, nearPts] = bands;
  const bandPts = [nearPts, closePts, bullseyePts, closePts, nearPts];
  const bandClasses = ['wl-band-1', 'wl-band-3', 'wl-band-5', 'wl-band-3', 'wl-band-1'];
  const tgt = targetAngle ?? 0;

  function angleFromPointer(clientX: number, clientY: number): number {
    const svg = svgRef.current;
    if (!svg) return needleAngle;
    const rect = svg.getBoundingClientRect();
    const scale = rect.width / 400;
    const cx = rect.left + CX * scale;
    const cy = rect.top + CY * scale;
    const dx = clientX - cx;
    const dy = Math.max(cy - clientY, 0.0001);
    const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
    return Math.round(clamp(deg, -90, 90) * 10) / 10;
  }

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (!canDrag || !onAngleChange) return;
    e.preventDefault();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onAngleChange(angleFromPointer(e.clientX, e.clientY));
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!canDrag || !draggingRef.current || !onAngleChange) return;
    onAngleChange(angleFromPointer(e.clientX, e.clientY));
  }

  function handlePointerUp() {
    draggingRef.current = false;
  }

  function handleKeyDown(e: React.KeyboardEvent<SVGSVGElement>) {
    if (!canDrag || !onAngleChange) return;
    const step = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onAngleChange(clamp(needleAngle - step, -90, 90));
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onAngleChange(clamp(needleAngle + step, -90, 90));
    }
  }

  const clipId = `${idPrefix}-clip`;
  const faceGradId = `${idPrefix}-face`;
  const shutterGradId = `${idPrefix}-shutter`;
  const rimGradId = `${idPrefix}-rim`;

  return (
    <svg
      ref={svgRef}
      className={[
        'wl-dial',
        isOpen ? 'wl-dial--open' : '',
        !showNeedle ? 'wl-dial--no-needle' : '',
        canDrag ? 'wl-dial--can-drag' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      viewBox="0 0 400 220"
      role="slider"
      tabIndex={canDrag ? 0 : -1}
      aria-label="Spectrum guess dial"
      aria-valuemin={-90}
      aria-valuemax={90}
      aria-valuenow={Math.round(needleAngle)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      <defs>
        <clipPath id={clipId}>
          <path d="M 8 200 A 192 192 0 0 1 392 200 Z" />
        </clipPath>
        <radialGradient id={faceGradId} cx="200" cy="200" r="192" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2a2268" />
          <stop offset="1" stopColor="#16123d" />
        </radialGradient>
        <linearGradient id={shutterGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5a46d6" />
          <stop offset="1" stopColor="#2f2491" />
        </linearGradient>
        <linearGradient id={rimGradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={rimColors[0]} />
          <stop offset="1" stopColor={rimColors[1]} />
        </linearGradient>
        {extraNeedles.map((n) => (
          <clipPath key={`clip-${n.id}`} id={`${idPrefix}-av-${n.id}`}>
            <circle cx="200" cy="36" r="12" />
          </clipPath>
        ))}
      </defs>

      <g clipPath={`url(#${clipId})`}>
        <path className="wl-dial-face" d="M 8 200 A 192 192 0 0 1 392 200 Z" fill={`url(#${faceGradId})`} />
        <g className="wl-dial-rings">
          <path d="M 80 200 A 120 120 0 0 1 320 200" />
          <path d="M 140 200 A 60 60 0 0 1 260 200" />
        </g>

        {targetAngle !== null && (
          <g className="wl-target" transform={`rotate(${tgt.toFixed(2)} ${CX} ${CY})`}>
            {[0, 1, 2, 3, 4].map((i) => (
              <path
                key={`w-${i}`}
                className={bandClasses[i]}
                d={wedgePath(TARGET_EDGES[i], TARGET_EDGES[i + 1], 196)}
              />
            ))}
            {TARGET_EDGES.slice(1, -1).map((edge, i) => {
              const [x, y] = polar(edge, 196);
              return (
                <line
                  key={`l-${i}`}
                  className="wl-band-line"
                  x1={CX}
                  y1={CY}
                  x2={x.toFixed(2)}
                  y2={y.toFixed(2)}
                />
              );
            })}
            {[0, 1, 2, 3, 4].map((i) => {
              const mid = (TARGET_EDGES[i] + TARGET_EDGES[i + 1]) / 2;
              const [x, y] = polar(mid, 160);
              return (
                <text
                  key={`t-${i}`}
                  x={x.toFixed(2)}
                  y={y.toFixed(2)}
                  transform={`rotate(${(-tgt).toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)})`}
                >
                  {bandPts[i]}
                </text>
              );
            })}
          </g>
        )}

        <g className="wl-shutter">
          <path d="M 4 200 A 196 196 0 0 1 396 200 Z" fill={`url(#${shutterGradId})`} />
          <g className="wl-shutter-rays">
            {Array.from({ length: 17 }, (_, idx) => -80 + idx * 10).map((a) => {
              const [x1, y1] = polar(a, 44);
              const [x2, y2] = polar(a, 200);
              return (
                <line
                  key={a}
                  x1={x1.toFixed(2)}
                  y1={y1.toFixed(2)}
                  x2={x2.toFixed(2)}
                  y2={y2.toFixed(2)}
                />
              );
            })}
          </g>
          <path className="wl-shutter-edge" d="M 4 200 A 196 196 0 0 1 396 200" />
        </g>
      </g>

      <path className="wl-dial-rim" d="M 6 200 A 194 194 0 0 1 394 200" stroke={`url(#${rimGradId})`} />

      <g className="wl-ticks">
        {Array.from({ length: 19 }, (_, idx) => -90 + idx * 10).map((a) => {
          const major = a % 45 === 0;
          const [x1, y1] = polar(a, major ? 172 : 179);
          const [x2, y2] = polar(a, 187);
          return (
            <line
              key={a}
              className={major ? 'wl-tick-major' : ''}
              x1={x1.toFixed(2)}
              y1={y1.toFixed(2)}
              x2={x2.toFixed(2)}
              y2={y2.toFixed(2)}
            />
          );
        })}
      </g>

      <rect className="wl-dial-base" x="0" y="199" width="400" height="14" rx="7" />

      {/* Extra player needles for Free-for-All reveal */}
      {extraNeedles.map((n) => (
        <g key={n.id} className="wl-extra-needle" transform={`rotate(${n.angle.toFixed(2)} ${CX} ${CY})`}>
          <line x1="200" y1="200" x2="200" y2="48" stroke={n.color} strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="200" cy="36" r="13" fill={n.color} stroke="#120e2e" strokeWidth="2" />
          {n.avatarUrl ? (
            <image
              href={n.avatarUrl}
              x="188"
              y="24"
              width="24"
              height="24"
              clipPath={`url(#${idPrefix}-av-${n.id})`}
              preserveAspectRatio="xMidYMid slice"
            />
          ) : (
            <text
              x="200"
              y="36"
              fill="#120e2e"
              fontSize="10"
              fontWeight="800"
              textAnchor="middle"
              dominantBaseline="central"
              transform={`rotate(${(-n.angle).toFixed(2)} 200 36)`}
            >
              {n.name.slice(0, 2).toUpperCase()}
            </text>
          )}
        </g>
      ))}

      {/* Main needle */}
      <g className="wl-needle" transform={`rotate(${needleAngle.toFixed(2)} ${CX} ${CY})`}>
        <line className="wl-needle-glow" x1="200" y1="200" x2="200" y2="30" />
        <line className="wl-needle-core" x1="200" y1="200" x2="200" y2="30" />
        <circle className="wl-needle-tip" cx="200" cy="30" r="7" />
      </g>

      <circle className="wl-hub" cx="200" cy="200" r="17" />
      <circle className="wl-hub-dot" cx="200" cy="200" r="7" style={{ fill: hubColor }} />
    </svg>
  );
}
