/**
 * Decorative watercolour rainbow in the shape of a head in profile (facing
 * right), like the physical board. Pure SVG, so it works under our strict CSP.
 */
const HEAD =
  'M30 100 C26 88 13 80 9 62 C3 36 20 7 50 5 C74 3 88 19 88 35 L95 51 C96 55 93 56 90 56 L91 63 C92 66 88 67 88 68 C90 72 88 76 84 77 C78 78 74 80 72 86 L70 100 Z';

// Blobs around the ring, clockwise from the back of the neck.
const BLOBS: Array<[number, number, number, string]> = [
  [22, 92, 18, '#3b6fd8'],
  [8, 70, 18, '#2fb5c9'],
  [8, 44, 18, '#36b24a'],
  [18, 18, 18, '#8ccf3a'],
  [40, 4, 18, '#3b6fd8'],
  [62, 4, 18, '#8a4fd0'],
  [82, 14, 16, '#e24a8d'],
  [92, 34, 15, '#e8353b'],
  [96, 54, 14, '#f28c28'],
  [92, 72, 14, '#f5c518'],
  [78, 90, 16, '#36b24a'],
  [50, 100, 18, '#2fb5c9'],
];

// Faint activity figures along the band: [x, y, rotation, pose].
const FIGURES: Array<[number, number, number, number]> = [
  [14, 30, -20, 0],
  [30, 10, 10, 1],
  [56, 7, -8, 2],
  [78, 16, 18, 0],
  [90, 42, -12, 1],
  [86, 66, 8, 2],
  [12, 58, 14, 2],
  [26, 86, -10, 1],
  [70, 92, 6, 0],
];

const POSES = [
  // runner
  'M0 -6 a2 2 0 1 0 0.01 0 M0 -3 L-1 2 L-4 6 M-1 2 L2 5 L3 8 M0 -2 L-4 0 M0 -2 L4 -3',
  // star jump
  'M0 -6 a2 2 0 1 0 0.01 0 M0 -3 L0 3 L-3 8 M0 3 L3 8 M0 -2 L-4 -6 M0 -2 L4 -6',
  // sitting / meditating
  'M0 -6 a2 2 0 1 0 0.01 0 M0 -3 L0 2 M-5 4 L5 4 M0 -1 L-4 2 M0 -1 L4 2',
];

export function HeadArt({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <clipPath id="psy-head-clip">
          <path d={HEAD} />
        </clipPath>
        <filter id="psy-watercolor" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      <g clipPath="url(#psy-head-clip)">
        <rect x="0" y="0" width="100" height="100" fill="#ffffff" />
        <g filter="url(#psy-watercolor)" opacity="0.85">
          {BLOBS.map(([cx, cy, r, c], i) => (
            <circle key={i} cx={cx} cy={cy} r={r} fill={c} />
          ))}
        </g>
        <g stroke="#ffffff" strokeWidth="1.1" strokeLinecap="round" fill="none" opacity="0.8">
          {FIGURES.map(([x, y, rot, pose], i) => (
            <path key={i} d={POSES[pose]} transform={`translate(${x} ${y}) rotate(${rot}) scale(0.55)`} />
          ))}
        </g>
      </g>
    </svg>
  );
}
