import { GRID, type Guess, type PsyPlayer } from './protocol';
import { GoldMarker, Pawn } from './Pawn';

interface GridProps {
  traits: { x: string; y: string } | null;
  players: PsyPlayer[];
  guesses: Guess[];
  /** Shown as the gold marker (the reveal, or the main player's own view). */
  secret?: { x: number; y: number } | null;
  /** Draws the 3/2/1 scoring zones around `secret`. */
  showZones?: boolean;
  points?: Record<string, number>;
  /** Makes open squares tappable. */
  onPick?: (x: number, y: number) => void;
  selected?: { x: number; y: number } | null;
  selectedColor?: string;
  size: 'tv' | 'phone';
}

const ROWS = Array.from({ length: GRID }, (_, i) => GRID - i); // 10 at the top
const COLS = Array.from({ length: GRID }, (_, i) => i + 1);

function zone(x: number, y: number, s: { x: number; y: number }): number {
  const dx = Math.abs(x - s.x);
  const dy = Math.abs(y - s.y);
  if (dx === 0 && dy === 0) return 3;
  if (dx + dy === 1) return 2;
  if (dx === 1 && dy === 1) return 1;
  return 0;
}

/** Y-axis numbers run teal (1) to orange (10), like the printed board. */
function yHue(y: number): number {
  return Math.round(184 - ((y - 1) * 154) / (GRID - 1));
}

export function Grid({ traits, players, guesses, secret, showZones, points, onPick, selected, selectedColor, size }: GridProps) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const claimed = new Map(guesses.map((g) => [`${g.x},${g.y}`, g]));

  return (
    <div className={`psy-board psy-board--${size}`}>
      <div className="psy-ycard" aria-label={traits ? `Y axis: ${traits.y}` : undefined}>
        <span className="psy-ycard__word">{traits?.y ?? '?'}</span>
      </div>
      <div className="psy-ynums" aria-hidden="true">
        {ROWS.map((y) => (
          <span key={y} style={{ color: `hsl(${yHue(y)} 75% 45%)` }}>
            {y}
          </span>
        ))}
      </div>
      <div className="psy-grid" role="grid" aria-label="10 by 10 board">
        {ROWS.map((y) => (
          <div className="psy-grid__row" role="row" key={y}>
            {COLS.map((x) => {
              const g = claimed.get(`${x},${y}`);
              const owner = g ? byId.get(g.playerId) : undefined;
              const isSecret = secret && secret.x === x && secret.y === y;
              const z = showZones && secret ? zone(x, y, secret) : 0;
              const isSel = selected && selected.x === x && selected.y === y;
              const pts = g && points ? points[g.playerId] : undefined;
              const cls = [
                'psy-cell',
                x === 5 ? 'psy-cell--midx' : '',
                y === 6 ? 'psy-cell--midy' : '',
                z ? `psy-cell--z${z}` : '',
                isSel ? 'psy-cell--selected' : '',
                g ? 'psy-cell--claimed' : '',
              ]
                .filter(Boolean)
                .join(' ');
              const label = `${traits?.x ?? 'X'} ${x}, ${traits?.y ?? 'Y'} ${y}${owner ? `, ${owner.name}` : ''}`;
              const content = (
                <>
                  {isSecret && <GoldMarker className="psy-cell__gold" title="Secret mark" />}
                  {owner && <Pawn color={owner.color} className="psy-cell__pawn" />}
                  {isSel && !owner && selectedColor && <Pawn color={selectedColor} className="psy-cell__pawn psy-cell__pawn--ghost" />}
                  {pts !== undefined && pts > 0 && (
                    <span className="psy-cell__pts" style={{ color: owner?.color }}>
                      +{pts}
                    </span>
                  )}
                </>
              );
              if (onPick) {
                return (
                  <button
                    type="button"
                    role="gridcell"
                    key={x}
                    className={cls}
                    disabled={!!g}
                    aria-label={label}
                    aria-pressed={!!isSel}
                    onClick={() => onPick(x, y)}
                  >
                    {content}
                  </button>
                );
              }
              return (
                <div role="gridcell" key={x} className={cls} aria-label={label}>
                  {content}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="psy-xnums" aria-hidden="true">
        {COLS.map((x) => (
          <span key={x}>{x}</span>
        ))}
      </div>
      <div className="psy-xcard" aria-label={traits ? `X axis: ${traits.x}` : undefined}>
        <span className="psy-xcard__word">{traits?.x ?? '?'}</span>
      </div>
    </div>
  );
}
