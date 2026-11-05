import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

const RADIUS_PX = 70; // drag this far from your touch point for full strength
const SEND_MS = 50; // 20 updates per second

interface TouchpadProps {
  onPull: (dx: number, dy: number) => void;
  color: string;
}

/**
 * Floating joystick: wherever you put your finger becomes the center, and
 * dragging away from it pulls the planchette in that direction.
 */
export function Touchpad({ onPull, color }: TouchpadProps) {
  const padEl = useRef<HTMLDivElement>(null);
  const baseEl = useRef<HTMLDivElement>(null);
  const knobEl = useRef<HTMLDivElement>(null);
  const origin = useRef<{ x: number; y: number; id: number } | null>(null);
  const vec = useRef({ dx: 0, dy: 0 });
  const onPullRef = useRef(onPull);

  useEffect(() => {
    onPullRef.current = onPull;
  }, [onPull]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (origin.current) onPullRef.current(vec.current.dx, vec.current.dy);
    }, SEND_MS);
    return () => {
      window.clearInterval(timer);
      onPullRef.current(0, 0);
    };
  }, []);

  const place = (el: HTMLElement | null, x: number, y: number) => {
    if (el) el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  };

  const localPoint = (e: ReactPointerEvent) => {
    const r = padEl.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (origin.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = localPoint(e);
    origin.current = { ...p, id: e.pointerId };
    vec.current = { dx: 0, dy: 0 };
    place(baseEl.current, p.x, p.y);
    place(knobEl.current, p.x, p.y);
    padEl.current?.setAttribute('data-active', '');
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const o = origin.current;
    if (!o || o.id !== e.pointerId) return;
    const p = localPoint(e);
    let dx = (p.x - o.x) / RADIUS_PX;
    let dy = (p.y - o.y) / RADIUS_PX;
    const mag = Math.hypot(dx, dy);
    if (mag > 1) {
      dx /= mag;
      dy /= mag;
    }
    vec.current = { dx, dy };
    place(knobEl.current, o.x + dx * RADIUS_PX, o.y + dy * RADIUS_PX);
  };

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const o = origin.current;
    if (!o || o.id !== e.pointerId) return;
    origin.current = null;
    vec.current = { dx: 0, dy: 0 };
    onPullRef.current(0, 0);
    padEl.current?.removeAttribute('data-active');
  };

  return (
    <div
      id="touchpad"
      ref={padEl}
      className="touchpad"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      role="application"
      aria-label="Touch and drag to pull the planchette"
    >
      <p className="touchpad__hint">Touch &amp; drag to pull</p>
      <div ref={baseEl} className="touchpad__base" />
      <div ref={knobEl} className="touchpad__knob" style={{ backgroundColor: color }} />
    </div>
  );
}
