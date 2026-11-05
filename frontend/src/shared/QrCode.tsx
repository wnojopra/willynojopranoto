import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

interface QrCodeProps {
  value: string;
  className?: string;
  label: string;
}

/**
 * A QR code drawn as one SVG path. The library only computes the module grid;
 * rendering stays in React (no innerHTML), so it works under our strict CSP.
 */
export function QrCode({ value, className, label }: QrCodeProps) {
  const { size, d } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let path = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
      }
    }
    return { size: n, d: path };
  }, [value]);

  const quiet = 2; // modules of light margin; the card behind adds more
  const box = size + quiet * 2;
  return (
    <svg
      className={className}
      viewBox={`${-quiet} ${-quiet} ${box} ${box}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect x={-quiet} y={-quiet} width={box} height={box} rx={1.5} className="qr__bg" />
      <path d={d} className="qr__ink" />
    </svg>
  );
}
