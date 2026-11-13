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
  /** Scoring band labels [bullseye, close, near] — defaults to [4, 3, 2] */
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
  hubColor = '#d62828',
  extraNeedles = [],
}: DialProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef(false);

  const [bullseyePts, closePts, nearPts] = bands;
  const bandPts = [nearPts, closePts, bullseyePts, closePts, nearPts];
  const bandClasses = ['wl-band-2', 'wl-band-3', 'wl-band-4', 'wl-band-3', 'wl-band-2'];
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
  const hubGradId = `${idPrefix}-hub`;

  // Scalloped outer gear bumps along the semicircle (matching the white scalloped wheel of the real board game)
  const scallops = Array.from({ length: 25 }, (_, i) => -90 + i * 7.5);
  // Starry speckles on the dark navy shutter
  const speckles = [
    [-72, 140], [-58, 95], [-44, 165], [-31, 118], [-19, 75], [-8, 152],
    [4, 110], [16, 172], [29, 88], [41, 145], [55, 115], [68, 160],
    [-64, 178], [-24, 182], [12, 184], [48, 179], [76, 130], [-50, 62], [35, 64],
  ];

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
      viewBox="-12 -14 424 238"
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
          <path d="M 10 200 A 190 190 0 0 1 390 200 Z" />
        </clipPath>
        <radialGradient id={faceGradId} cx="200" cy="200" r="190" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fffdf7" />
          <stop offset="0.82" stopColor="#f7f3e6" />
          <stop offset="1" stopColor="#ebe4d1" />
        </radialGradient>
        <linearGradient id={shutterGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8fd3de" />
          <stop offset="1" stopColor="#5eb5c4" />
        </linearGradient>
        <radialGradient id={hubGradId} cx="38%" cy="35%" r="65%">
          <stop offset="0" stopColor="#ff4d4d" />
          <stop offset="0.55" stopColor={hubColor} />
          <stop offset="1" stopColor="#9e1919" />
        </radialGradient>
        {extraNeedles.map((n) => (
          <clipPath key={`clip-${n.id}`} id={`${idPrefix}-av-${n.id}`}>
            <circle cx="200" cy="36" r="12" />
          </clipPath>
        ))}
      </defs>

      {/* White Scalloped Outer Gear Wheel (like the physical Wavelength board game) */}
      <g className="wl-wheel-scallops">
        <path
          d="M -2 200 A 202 202 0 0 1 402 200 Z"
          fill="#fbf8ef"
          stroke="#0d2638"
          strokeWidth="2.5"
        />
        {scallops.map((ang) => {
          const [sx, sy] = polar(ang, 200);
          return <circle key={ang} cx={sx.toFixed(2)} cy={sy.toFixed(2)} r="9" fill="#fbf8ef" />;
        })}
      </g>

      {/* Deep Navy Outer Housing Ring */}
      <path
        className="wl-dial-casing"
        d="M 4 200 A 196 196 0 0 1 396 200 Z"
        fill="#0d2b45"
      />

      <g clipPath={`url(#${clipId})`}>
        {/* Warm Cream / White Wheel Face */}
        <path className="wl-dial-face" d="M 10 200 A 190 190 0 0 1 390 200 Z" fill={`url(#${faceGradId})`} />

        <g className="wl-dial-rings">
          <path d="M 80 200 A 120 120 0 0 1 320 200" />
          <path d="M 140 200 A 60 60 0 0 1 260 200" />
        </g>

        {/* 5 Scoring Wedges: 2 - 3 - 4 - 3 - 2 */}
        {targetAngle !== null && (
          <g className="wl-target" transform={`rotate(${tgt.toFixed(2)} ${CX} ${CY})`}>
            {[0, 1, 2, 3, 4].map((i) => (
              <path
                key={`w-${i}`}
                className={bandClasses[i]}
                d={wedgePath(TARGET_EDGES[i], TARGET_EDGES[i + 1], 190)}
              />
            ))}
            {TARGET_EDGES.map((edge, i) => {
              const [x, y] = polar(edge, 190);
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
              const [x, y] = polar(mid, 162);
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

        {/* Rotating Screen Shutter with Mint Lever Handle */}
        <g className="wl-shutter">
          <path d="M 6 200 A 194 194 0 0 1 394 200 Z" fill={`url(#${shutterGradId})`} />
          <g className="wl-shutter-rays">
            {Array.from({ length: 17 }, (_, idx) => -80 + idx * 10).map((a) => {
              const [x1, y1] = polar(a, 44);
              const [x2, y2] = polar(a, 190);
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
          <path className="wl-shutter-edge" d="M 6 200 A 194 194 0 0 1 394 200" />
        </g>
      </g>

      {/* Subtle degree ticks along the navy rim */}
      <g className="wl-ticks">
        {Array.from({ length: 19 }, (_, idx) => -90 + idx * 10).map((a) => {
          const major = a % 45 === 0;
          const [x1, y1] = polar(a, major ? 181 : 185);
          const [x2, y2] = polar(a, 191);
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

      {/* Starry Navy Base Plate (matches the dark speckled navy housing in the board game) */}
      <path
        d="M 2 197 L 398 197 A 6 6 0 0 1 404 203 L 404 212 A 6 6 0 0 1 398 218 L 2 218 A 6 6 0 0 1 -4 212 L -4 203 A 6 6 0 0 1 2 197 Z"
        fill="#0d2b45"
      />
      {speckles.slice(0, 8).map(([ang, r], idx) => {
        const x = 40 + idx * 45 + (r % 11);
        const y = 203 + (Math.abs(ang) % 10);
        return <circle key={idx} cx={x} cy={y} r="1.1" fill="#d9f0ff" opacity="0.55" />;
      })}

      {/* Left/Right color indicator pips on base */}
      <circle cx="22" cy="207.5" r="4.5" fill={rimColors[0]} />
      <circle cx="378" cy="207.5" r="4.5" fill={rimColors[1]} />

      {/* Extra player needles for Free-for-All reveal */}
      {extraNeedles.map((n) => (
        <g key={n.id} className="wl-extra-needle" transform={`rotate(${n.angle.toFixed(2)} ${CX} ${CY})`}>
          <line x1="200" y1="200" x2="200" y2="48" stroke={n.color} strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="200" cy="36" r="13" fill={n.color} stroke="#0d2b45" strokeWidth="2" />
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
              fill="#0d2b45"
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

      {/* Main Red Pointer Arm & Big Red Central Knob (matching the physical dial) */}
      <g className="wl-needle" transform={`rotate(${needleAngle.toFixed(2)} ${CX} ${CY})`}>
        <line className="wl-needle-shadow" x1="200" y1="200" x2="200" y2="28" />
        <line className="wl-needle-core" x1="200" y1="200" x2="200" y2="28" />
        <circle className="wl-needle-tip" cx="200" cy="28" r="6.5" />
      </g>

      {/* Tactile Red Dial Knob */}
      <circle className="wl-hub-outer" cx="200" cy="200" r="24" fill={`url(#${hubGradId})`} />
      <circle className="wl-hub-ring" cx="200" cy="200" r="17" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="1.8" />
      <circle className="wl-hub-dot" cx="200" cy="200" r="7" fill="#b81d1d" />
    </svg>
  );
}
