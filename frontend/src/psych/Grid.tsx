import { GRID, type Guess, type Photos, type PsyPlayer } from './protocol';
import { GoldMarker, Pawn } from './Pawn';

interface GridProps {
  traits: { x: string; y: string } | null;
  players: PsyPlayer[];
  guesses: Guess[];
  /** Second markers (real opinions): small, may share squares with anything. */
  opinions?: Guess[];
  photos?: Photos;
  /** Shown as the gold marker (the reveal, or the main player's own view). */
  secret?: { x: number; y: number } | null;
  /** Draws the 3/2/1 scoring zones around `secret`. */
  showZones?: boolean;
  points?: Record<string, number>;
  opinionPoints?: Record<string, number>;
  /** Makes squares tappable. Claimed squares stay disabled unless `allowClaimed`. */
  onPick?: (x: number, y: number) => void;
  allowClaimed?: boolean;
  selected?: { x: number; y: number } | null;
  selectedColor?: string;
  /** The player's own pending opinion marker (phone, step 2). */
  pendingOpinion?: { x: number; y: number; color: string } | null;
  /** Tapping a trait card (e.g. to show its definition). */
  onWord?: (word: string) => void;
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

function WordCard({ axis, word, onWord }: { axis: 'x' | 'y'; word: string | undefined; onWord?: (w: string) => void }) {
  const cls = axis === 'x' ? 'psy-xcard' : 'psy-ycard';
  const inner = <span className={`${cls}__word`}>{word ?? '?'}</span>;
  if (onWord && word) {
    return (
      <button type="button" className={`${cls} psy-wordbtn`} onClick={() => onWord(word)} aria-label={`${axis.toUpperCase()} axis: ${word}. Show definition`}>
        {inner}
      </button>
    );
  }
  return (
    <div className={cls} aria-label={word ? `${axis.toUpperCase()} axis: ${word}` : undefined}>
      {inner}
    </div>
  );
}

export function Grid(props: GridProps) {
  const { traits, players, guesses, opinions = [], photos = {}, secret, showZones, points, opinionPoints, onPick, allowClaimed, selected, selectedColor, pendingOpinion, onWord, size } = props;
  const byId = new Map(players.map((p) => [p.id, p]));
  const claimed = new Map(guesses.map((g) => [`${g.x},${g.y}`, g]));
  const opinionsAt = new Map<string, Guess[]>();
  for (const o of opinions) {
    const k = `${o.x},${o.y}`;
    opinionsAt.set(k, [...(opinionsAt.get(k) ?? []), o]);
  }

  return (
    <div className={`psy-board psy-board--${size}`}>
      <WordCard axis="y" word={traits?.y} onWord={onWord} />
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
              const k = `${x},${y}`;
              const g = claimed.get(k);
              const owner = g ? byId.get(g.playerId) : undefined;
              const ops = opinionsAt.get(k) ?? [];
              const isSecret = secret && secret.x === x && secret.y === y;
              const z = showZones && secret ? zone(x, y, secret) : 0;
              const isSel = selected && selected.x === x && selected.y === y;
              const isPending = pendingOpinion && pendingOpinion.x === x && pendingOpinion.y === y;
              const pts = g && points ? points[g.playerId] : undefined;
              const cls = [
                'psy-cell',
                x === 5 ? 'psy-cell--midx' : '',
                y === 6 ? 'psy-cell--midy' : '',
                z ? `psy-cell--z${z}` : '',
                isSel || isPending ? 'psy-cell--selected' : '',
                g ? 'psy-cell--claimed' : '',
              ]
                .filter(Boolean)
                .join(' ');
              const label = `${traits?.x ?? 'X'} ${x}, ${traits?.y ?? 'Y'} ${y}${owner ? `, ${owner.name}` : ''}`;
              const content = (
                <>
                  {isSecret && <GoldMarker className="psy-cell__gold" title="Secret mark" />}
                  {owner && <Pawn color={owner.color} photo={photos[owner.id]} className="psy-cell__pawn" />}
                  {isSel && !owner && selectedColor && <Pawn color={selectedColor} className="psy-cell__pawn psy-cell__pawn--ghost" />}
                  {ops.map((o, i) => {
                    const p = byId.get(o.playerId);
                    if (!p) return null;
                    const op = opinionPoints?.[o.playerId];
                    return (
                      <span key={o.playerId} className={`psy-cell__opinion psy-cell__opinion--${i % 4}`}>
                        <Pawn color={p.color} photo={photos[p.id]} />
                        {op !== undefined && op > 0 && <span className="psy-cell__opts">+{op}</span>}
                      </span>
                    );
                  })}
                  {isPending && (
                    <span className="psy-cell__opinion psy-cell__opinion--pending">
                      <Pawn color={pendingOpinion.color} />
                    </span>
                  )}
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
                    disabled={!!g && !allowClaimed}
                    aria-label={label}
                    aria-pressed={!!(isSel || isPending)}
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
      <WordCard axis="x" word={traits?.x} onWord={onWord} />
    </div>
  );
}
