import { useEffect, useRef, type RefObject } from 'react';
import type { PlanchetteState, Spot } from '../protocol';

const S = 1000;

interface MiniMapProps {
  board: { w: number; h: number };
  spots: Spot[];
  planchetteRef: RefObject<PlanchetteState | null>;
  /** This player's secret bet, ringed so they know where to drag. */
  betSpotId?: string | null;
  /** Spots the planchette can't land on (Salt Circle). */
  salted?: string[];
  /** Spots with a Cursed Magnet. */
  magnets?: string[];
}

/** Small board on the phone so players don't have to stare at the TV. */
export function MiniMap({ board, spots, planchetteRef, betSpotId = null, salted = [], magnets = [] }: MiniMapProps) {
  const dot = useRef<SVGCircleElement>(null);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const shown = { x: board.w / 2, y: 0.52 };
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const t = planchetteRef.current;
      if (t && dot.current) {
        const k = 1 - Math.exp(-dt * 14);
        shown.x += (t.x - shown.x) * k;
        shown.y += (t.y - shown.y) * k;
        dot.current.setAttribute('cx', (shown.x * S).toFixed(1));
        dot.current.setAttribute('cy', (shown.y * S).toFixed(1));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [board.w, planchetteRef]);

  return (
    <svg className="minimap" viewBox={`0 0 ${board.w * S} ${board.h * S}`} aria-hidden="true">
      <rect width={board.w * S} height={board.h * S} rx="60" className="minimap__bg" />
      {spots.map((s) => (
        <g
          key={s.id}
          transform={`translate(${s.x * S} ${s.y * S})`}
          className="minimap__spotg"
          data-bet={s.id === betSpotId ? '' : undefined}
          data-salted={salted.includes(s.id) ? '' : undefined}
        >
          <circle r="85" className="minimap__spot" />
          <text className="minimap__label" y="20">
            {s.label}
          </text>
          {salted.includes(s.id) && (
            <text className="minimap__icon" y="-100">
              🧂
            </text>
          )}
          {magnets.includes(s.id) && (
            <text className="minimap__icon" y="170">
              🧲
            </text>
          )}
        </g>
      ))}
      <circle ref={dot} r="55" className="minimap__planchette" cx={board.w * S * 0.5} cy={520} />
    </svg>
  );
}
