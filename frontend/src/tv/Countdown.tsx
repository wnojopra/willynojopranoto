import { useEffect, useRef, useState } from 'react';

interface CountdownProps {
  seconds: number;
  bar?: boolean;
  className?: string;
}

/** Counts down locally from the server-provided remaining time. */
export function Countdown({ seconds, bar = false, className }: CountdownProps) {
  const deadline = useRef(performance.now() + seconds * 1000);
  const total = useRef(Math.max(0.001, seconds));
  const fillEl = useRef<HTMLDivElement>(null);
  const [whole, setWhole] = useState(Math.ceil(seconds));

  useEffect(() => {
    let raf = 0;
    const frame = (now: number) => {
      const left = Math.max(0, (deadline.current - now) / 1000);
      setWhole(Math.ceil(left));
      if (fillEl.current) fillEl.current.style.transform = `scaleX(${left / total.current})`;
      if (left > 0) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (bar) {
    return (
      <div className={`timerbar ${className ?? ''}`} data-urgent={whole <= 5 ? '' : undefined} role="timer" aria-label={`${whole} seconds left`}>
        <div ref={fillEl} className="timerbar__fill" />
        <span className="timerbar__num">{whole}</span>
      </div>
    );
  }
  return (
    <span className={className} role="timer" data-urgent={whole <= 5 ? '' : undefined}>
      {whole}
    </span>
  );
}
