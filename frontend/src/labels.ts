/**
 * Fitting spot labels into the room between neighbouring spots.
 *
 * Shared by the TV board and the phone minimap. With up to 16 names on the
 * ring, a long name at the default size runs into its neighbours, so labels
 * shrink to fit, and names with a space break onto two lines first.
 */

/** Average glyph advance of the board's bold uppercase serif, as a fraction of font size (incl. tracking). Measured. */
const GLYPH = 0.82;

export interface FittedLabel {
  lines: string[];
  fontSize: number;
}

/**
 * Picks a font size (and maybe a line break) so `label` fits in `maxWidth`.
 *
 * Args:
 *   maxWidth: room for the label, in the same units as `base`/`min`.
 *   base: the size short labels get.
 *   min: never smaller than this, even if it then overflows a little.
 */
export function fitLabel(label: string, maxWidth: number, base: number, min: number): FittedLabel {
  const width = (text: string, size: number) => text.length * size * GLYPH;
  if (width(label, base) <= maxWidth) return { lines: [label], fontSize: base };
  const oneLine = Math.max(min, Math.min(base, maxWidth / (label.length * GLYPH)));
  // Two lines at a space, if that reads clearly bigger than squeezing one line.
  const split = breakAtSpace(label);
  if (split) {
    const longest = Math.max(split[0].length, split[1].length);
    const twoLines = Math.max(min, Math.min(base, maxWidth / (longest * GLYPH)));
    if (twoLines > oneLine * 1.15) return { lines: split, fontSize: twoLines };
  }
  return { lines: [label], fontSize: oneLine };
}

/** Splits at the space nearest the middle, or null if there isn't one. */
function breakAtSpace(label: string): [string, string] | null {
  let best = -1;
  for (let i = label.indexOf(' '); i !== -1; i = label.indexOf(' ', i + 1)) {
    if (best === -1 || Math.abs(i - label.length / 2) < Math.abs(best - label.length / 2)) best = i;
  }
  return best === -1 ? null : [label.slice(0, best), label.slice(best + 1)];
}

/**
 * Horizontal room for each spot's label: the distance to the nearest spot in
 * the same row (within `rowHeight` vertically) minus `gap`, or Infinity when
 * nothing shares its row. Spots stacked up the sides of the ring don't
 * compete for width, so their names can stay big.
 */
export function labelRoom(spots: { x: number; y: number }[], rowHeight: number, gap: number): number[] {
  return spots.map((s, i) => {
    let room = Infinity;
    spots.forEach((o, j) => {
      if (i !== j && Math.abs(o.y - s.y) < rowHeight) room = Math.min(room, Math.abs(o.x - s.x) - gap);
    });
    return room;
  });
}
