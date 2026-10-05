import { useEffect, useRef, type RefObject } from 'react';
import type { PlanchetteState, Spot } from '../protocol';

const S = 1000; // board units -> SVG units
const SPOT_R = 0.085 * S;

export interface Bettor {
  id: string;
  color: string;
  auto: boolean;
}

interface BoardProps {
  board: { w: number; h: number };
  spots: Spot[];
  planchetteRef: RefObject<PlanchetteState | null>;
  resultSpotId: string | null;
  colorsBySpot: Record<string, string>;
  /** Revealed bets, keyed by spot id. */
  bettors?: Record<string, Bettor[]>;
  /** A spot to ring (the Medium's real answer), in the Medium's color. */
  markSpot?: { id: string; color: string };
}

/**
 * The Ouija board. Static parts render with React; the planchette, pull aura,
 * and lock ring are animated imperatively at display refresh rate from the
 * latest server tick, so 30Hz network updates still look smooth.
 */
export function Board({ board, spots, planchetteRef, resultSpotId, colorsBySpot, bettors, markSpot }: BoardProps) {
  const planchetteEl = useRef<SVGGElement>(null);
  const auraEl = useRef<SVGLineElement>(null);
  const ringEl = useRef<SVGCircleElement>(null);
  const spotEls = useRef(new Map<string, SVGGElement>());

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const shown = { x: planchetteRef.current?.x ?? board.w / 2, y: planchetteRef.current?.y ?? 0.52 };
    let hovered: string | null = null;

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const target = planchetteRef.current;
      if (target) {
        // Exponential smoothing toward the latest authoritative position.
        const k = 1 - Math.exp(-dt * 18);
        shown.x += (target.x - shown.x) * k;
        shown.y += (target.y - shown.y) * k;
        const px = shown.x * S;
        const py = shown.y * S;
        planchetteEl.current?.setAttribute('transform', `translate(${px.toFixed(1)} ${py.toFixed(1)})`);

        const mag = Math.hypot(target.fx, target.fy);
        const aura = auraEl.current;
        if (aura) {
          const len = Math.min(1, mag / 2.5) * 260;
          const ux = mag > 0 ? target.fx / mag : 0;
          const uy = mag > 0 ? target.fy / mag : 0;
          aura.setAttribute('x1', px.toFixed(1));
          aura.setAttribute('y1', py.toFixed(1));
          aura.setAttribute('x2', (px + ux * len).toFixed(1));
          aura.setAttribute('y2', (py + uy * len).toFixed(1));
          aura.style.opacity = String(Math.min(0.85, mag / 2));
        }

        if (target.hoverSpot !== hovered) {
          if (hovered) spotEls.current.get(hovered)?.removeAttribute('data-hover');
          hovered = target.hoverSpot;
          if (hovered) spotEls.current.get(hovered)?.setAttribute('data-hover', '');
        }
        const ring = ringEl.current;
        const spot = hovered ? spots.find((s) => s.id === hovered) : undefined;
        if (ring) {
          if (spot) {
            ring.setAttribute('cx', String(spot.x * S));
            ring.setAttribute('cy', String(spot.y * S));
            ring.style.strokeDashoffset = String(1 - target.lockProgress);
            ring.style.opacity = '1';
          } else {
            ring.style.opacity = '0';
          }
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [board.w, planchetteRef, spots]);

  const W = board.w * S;
  const H = board.h * S;

  return (
    <svg className="board" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Spirit board">
      <defs>
        <radialGradient id="wood" cx="50%" cy="45%" r="75%">
          <stop offset="0%" stopColor="#6b4527" />
          <stop offset="55%" stopColor="#4a2d18" />
          <stop offset="100%" stopColor="#1f1209" />
        </radialGradient>
        <filter id="grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.003 0.09" numOctaves="3" seed="7" />
          <feColorMatrix values="0 0 0 0 0.12  0 0 0 0 0.06  0 0 0 0 0.02  0 0 0 0.35 0" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <radialGradient id="candle" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffcf7a" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#ffcf7a" stopOpacity="0" />
        </radialGradient>
        <filter id="lift" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="18" stdDeviation="16" floodColor="#000" floodOpacity="0.6" />
        </filter>
        <linearGradient id="bone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f3e6c8" />
          <stop offset="100%" stopColor="#c9b089" />
        </linearGradient>
      </defs>

      <rect width={W} height={H} rx="48" fill="url(#wood)" />
      <rect width={W} height={H} rx="48" fill="#000" filter="url(#grain)" />
      <rect x="22" y="22" width={W - 44} height={H - 44} rx="34" className="board__inlay" />
      <rect x="36" y="36" width={W - 72} height={H - 72} rx="26" className="board__inlay board__inlay--thin" />
      <ellipse cx={W / 2} cy={H * 0.52} rx={W * 0.48} ry={H * 0.5} fill="url(#candle)" className="board__glow" />

      <Sun x={170} y={150} />
      <Moon x={W - 170} y={150} />
      <text x={W / 2} y={H - 62} className="board__goodbye">
        GOODBYE
      </text>

      <line ref={auraEl} className="board__aura" x1="0" y1="0" x2="0" y2="0" />

      {spots.map((s) => (
        <g
          key={s.id}
          ref={(el) => {
            if (el) spotEls.current.set(s.id, el);
            else spotEls.current.delete(s.id);
          }}
          className="spot"
          data-result={resultSpotId === s.id ? '' : undefined}
          data-dim={resultSpotId && resultSpotId !== s.id ? '' : undefined}
          transform={`translate(${s.x * S} ${s.y * S})`}
        >
          <circle className="spot__well" r={SPOT_R} />
          {colorsBySpot[s.id] && <circle className="spot__pip" r={10} cy={-SPOT_R + 22} fill={colorsBySpot[s.id]} />}
          <text className="spot__label" y="12">
            {s.label}
          </text>
        </g>
      ))}

      <circle ref={ringEl} className="board__lockring" r={SPOT_R + 16} pathLength={1} />

      <g ref={planchetteEl} className="planchette" filter="url(#lift)">
        <path
          d="M0,-118 C62,-118 108,-52 104,22 C100,92 52,128 0,128 C-52,128 -100,92 -104,22 C-108,-52 -62,-118 0,-118 Z"
          fill="url(#bone)"
          stroke="#7a5a35"
          strokeWidth="5"
        />
        <circle r="40" className="planchette__lens" />
        <circle r="40" fill="none" stroke="#7a5a35" strokeWidth="6" />
        <path d="M-60,70 Q0,96 60,70" fill="none" stroke="#9c7a4f" strokeWidth="4" opacity="0.6" />
        <circle cx="0" cy="-86" r="7" fill="#7a5a35" />
      </g>

      {/* Revealed bets sit above the planchette so the winning spot's are visible. */}
      {markSpot &&
        spots
          .filter((s) => s.id === markSpot.id)
          .map((s) => (
            <g key="mark" className="spot__mark" transform={`translate(${s.x * S} ${s.y * S})`}>
              <circle r={SPOT_R + 34} fill="none" stroke={markSpot.color} strokeWidth={9} strokeDasharray="22 14" />
              <text y={-SPOT_R - 46} className="spot__marklabel">
                🔮
              </text>
            </g>
          ))}
      {bettors &&
        spots.map((s) => (
          <g key={s.id} transform={`translate(${s.x * S} ${s.y * S})`}>
            {bettors[s.id]?.map((b, i, all) => {
              // Fan the bettors' tokens along the bottom of the well.
              const spread = Math.min(0.46, 2.4 / Math.max(1, all.length - 1));
              const a = Math.PI / 2 + (i - (all.length - 1) / 2) * spread;
              const r = SPOT_R + 28;
              return (
                <circle
                  key={b.id}
                  className="spot__bettor"
                  data-auto={b.auto ? '' : undefined}
                  cx={Math.cos(a) * r}
                  cy={Math.sin(a) * r}
                  r={24}
                  fill={b.color}
                  style={{ animationDelay: `${3500 + i * 120}ms` }}
                />
              );
            })}
          </g>
        ))}
    </svg>
  );
}

function Sun({ x, y }: { x: number; y: number }) {
  const rays = Array.from({ length: 12 }, (_, i) => (i * Math.PI) / 6);
  return (
    <g className="board__ornament" transform={`translate(${x} ${y})`}>
      <circle r="46" />
      {rays.map((a) => (
        <line key={a} x1={Math.cos(a) * 62} y1={Math.sin(a) * 62} x2={Math.cos(a) * 88} y2={Math.sin(a) * 88} />
      ))}
    </g>
  );
}

function Moon({ x, y }: { x: number; y: number }) {
  return (
    <g className="board__ornament" transform={`translate(${x} ${y})`}>
      <path d="M20,-58 A62,62 0 1,0 20,58 A48,48 0 1,1 20,-58 Z" />
    </g>
  );
}
