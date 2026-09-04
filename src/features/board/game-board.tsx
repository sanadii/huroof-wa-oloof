import { type KeyboardEvent, useId } from 'react';

export type BoardCell = { id: string; q: number; r: number; kind: 'letter' | 'surprise'; visibleValue: string; revealedLetter?: string; owner?: 'horizontal' | 'vertical' };

const RADIUS_Y = 42;
const RADIUS_X = 49.4;
const HORIZONTAL = RADIUS_X * 1.5;
const VERTICAL = Math.sqrt(3) * RADIUS_Y;
const FRAME_MIN = 5;
const FRAME_MAX = 435;
// Cells are deliberately wider than a regular hex so the complete 5x5 framed board
// has approximately equal visible width and height. Odd columns remain offset by half a hex.
// q/r identities and domain adjacency stay independent from this rendered layout.
const center = (q: number, r: number) => ({ x: 70 + HORIZONTAL * q, y: 56.5 + VERTICAL * (r + (q % 2) / 2) });
type Point = readonly [number, number];

const vertices = (q: number, r: number): Point[] => Array.from({ length: 6 }, (_, i) => {
  const angle = Math.PI / 180 * (60 * i); const c = center(q, r);
  return [c.x + RADIUS_X * Math.cos(angle), c.y + RADIUS_Y * Math.sin(angle)];
});
const points = (q: number, r: number) => vertices(q, r).map(([x, y]) => `${x},${y}`).join(' ');
const insetPoints = (q: number, r: number) => {
  const c = center(q, r);
  return vertices(q, r).map(([x, y]) => `${c.x + (x - c.x) * .92},${c.y + (y - c.y) * .92 - 2}`).join(' ');
};

function edgePoints(q: number, r: number, indexes: number[]) {
  return indexes.map((index) => {
    const [x, y] = vertices(q, r)[index];
    return `${x},${y - 2}`;
  }).join(' ');
}

function edgeCells(axis: 'horizontal' | 'vertical', edge: 'start' | 'end', cells: BoardCell[]) {
  return cells.filter((cell) => axis === 'horizontal' ? cell.q === (edge === 'start' ? 0 : 4) : cell.r === (edge === 'start' ? 0 : 4));
}
function railBoundary(axis: 'horizontal' | 'vertical', edge: 'start' | 'end', cells: BoardCell[]) {
  const edgeCellsForRail = edgeCells(axis, edge, cells).sort((a, b) => axis === 'horizontal' ? a.r - b.r : a.q - b.q);
  return edgeCellsForRail.flatMap((cell) => {
    const hex = vertices(cell.q, cell.r);
    // Follow the actual exposed hex edges. Adjacent cells share the connecting points,
    // making one fitted zigzag silhouette instead of a thick line plus loose teeth.
    if (axis === 'horizontal') return edge === 'start' ? [hex[4], hex[3], hex[2]] : [hex[5], hex[0], hex[1]];
    return edge === 'start' ? [hex[4], hex[5]] : [hex[2], hex[1]];
  });
}

function pointList(pointsForPath: Point[]) { return pointsForPath.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L'); }

function railPath(axis: 'horizontal' | 'vertical', edge: 'start' | 'end', cells: BoardCell[]) {
  const boundary = railBoundary(axis, edge, cells);
  // Project every exposed boundary point onto one shared outer edge. The inner edge
  // keeps the honeycomb contour while the outer edge becomes a true square frame.
  const outer = boundary.map(([x, y]): Point => axis === 'horizontal'
    ? [edge === 'start' ? FRAME_MIN : FRAME_MAX, y]
    : [x, edge === 'start' ? FRAME_MIN : FRAME_MAX]);
  return `M${pointList(boundary)} L${pointList([...outer].reverse())} Z`;
}

function railDividers(axis: 'horizontal' | 'vertical', edge: 'start' | 'end', cells: BoardCell[]): [Point, Point][] {
  const ordered = edgeCells(axis, edge, cells).sort((a, b) => axis === 'horizontal' ? a.r - b.r : a.q - b.q);
  return ordered.slice(0, -1).map((cell, index) => {
    if (axis === 'horizontal') {
      const boundaryPoint = vertices(cell.q, cell.r)[edge === 'start' ? 2 : 1];
      return [boundaryPoint, [edge === 'start' ? FRAME_MIN : FRAME_MAX, boundaryPoint[1]]];
    }
    const current = vertices(cell.q, cell.r)[edge === 'start' ? 5 : 1];
    const nextCell = ordered[index + 1];
    const next = vertices(nextCell.q, nextCell.r)[edge === 'start' ? 4 : 2];
    const midpoint: Point = [(current[0] + next[0]) / 2, (current[1] + next[1]) / 2];
    return [midpoint, [midpoint[0], edge === 'start' ? FRAME_MIN : FRAME_MAX]];
  });
}

function Rail({ axis, edge, cells }: { axis: 'horizontal' | 'vertical'; edge: 'start' | 'end'; cells: BoardCell[] }) {
  return <g className={`game-board__rail game-board__rail--${axis}`} data-edge={edge} data-rail-shape="half-cell-frame" data-testid={`board-rail-${axis}-${edge}`}>
    <path aria-hidden="true" className="game-board__rail-depth" d={railPath(axis, edge, cells)} transform="translate(0 4)" />
    <path d={railPath(axis, edge, cells)} />
    {railDividers(axis, edge, cells).map(([[x1, y1], [x2, y2]], index) => <line className="game-board__rail-divider" key={index} x1={x1} x2={x2} y1={y1} y2={y2} />)}
  </g>;
}

export function nearestCell(cells: BoardCell[], q: number, r: number, key: string) {
  const delta: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const vector = delta[key];
  return vector ? cells.find((cell) => cell.q === q + vector[0] && cell.r === r + vector[1]) : undefined;
}

export function GameBoard({ cells, activeCellId, winningPath = [], selectable = false, onSelect, className = '' }: {
  cells: BoardCell[]; activeCellId?: string; winningPath?: string[]; selectable?: boolean; onSelect?: (cellId: string) => void; className?: string;
}) {
  const gradientPrefix = `board-material-${useId().replace(/:/g, '')}`;
  const winning = new Set(winningPath);
  const keyMove = (event: KeyboardEvent<HTMLButtonElement>, cell: BoardCell) => {
    const next = nearestCell(cells, cell.q, cell.r, event.key);
    if (!next) return; event.preventDefault(); document.getElementById(`board-${next.id}`)?.focus();
  };
  return <div className={`game-board-wrap ${className}`} dir="ltr">
    <span className="sr-only">لوحة سداسية من 25 خلية. الفريق الأفقي يصل اليسار باليمين والفريق العمودي يصل الأعلى بالأسفل.</span>
    <svg aria-label="لوحة المباراة" className="game-board-svg" data-frame-shape="square" role="img" viewBox="0 0 440 440">
      <defs>
        {(['neutral', 'active', 'horizontal', 'vertical'] as const).map((state) => <linearGradient id={`${gradientPrefix}-${state}`} key={state} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={`var(--material-${state}-top)`} />
          <stop offset="1" stopColor={`var(--material-${state}-bottom)`} />
        </linearGradient>)}
      </defs>
      <g aria-hidden="true"><Rail axis="vertical" cells={cells} edge="start" /><Rail axis="vertical" cells={cells} edge="end" /><Rail axis="horizontal" cells={cells} edge="start" /><Rail axis="horizontal" cells={cells} edge="end" /></g>
      {cells.map((cell) => { const active = cell.id === activeCellId; const won = winning.has(cell.id); const value = cell.revealedLetter ?? cell.visibleValue; const label = `خلية ${cell.q + 1}-${cell.r + 1}: ${value}${cell.owner ? cell.owner === 'horizontal' ? '، ملك الفريق الأفقي' : '، ملك الفريق العمودي' : ''}${active ? '، الخلية النشطة' : ''}${won ? '، ضمن مسار الفوز' : ''}`; const c = center(cell.q, cell.r); const material = cell.owner ?? (active ? 'active' : 'neutral');
        return <g className={`game-board__cell game-cell ${cell.owner ? `game-board__cell--${cell.owner}` : ''} ${active ? 'game-board__cell--active' : ''} ${won ? 'game-board__cell--winning' : ''}`} data-active={active || undefined} data-owned={cell.owner || undefined} data-testid={selectable ? undefined : `cell-${cell.q}-${cell.r}`} data-winning={won || undefined} key={cell.id}>
          <polygon className="game-board__cell-shell" data-material-layer="shell" points={points(cell.q, cell.r)} />
          <polygon className="game-board__cell-face" data-material-layer="face" fill={`url(#${gradientPrefix}-${material})`} points={insetPoints(cell.q, cell.r)} />
          <polyline aria-hidden="true" className="game-board__cell-highlight" points={edgePoints(cell.q, cell.r, [3, 4, 5, 0])} />
          <polyline aria-hidden="true" className="game-board__cell-shade" points={edgePoints(cell.q, cell.r, [0, 1, 2, 3])} />
          {cell.owner && <path aria-hidden="true" className="game-board__pattern" d={cell.owner === 'horizontal' ? `M${c.x - 28} ${c.y - 10}H${c.x + 28}M${c.x - 28} ${c.y + 10}H${c.x + 28}` : `M${c.x - 12} ${c.y - 25}V${c.y + 25}M${c.x + 12} ${c.y - 25}V${c.y + 25}`} />}
          <text aria-hidden="true" dominantBaseline="middle" textAnchor="middle" x={c.x} y={c.y + 4}>{value}</text>
          {cell.owner && <text aria-hidden="true" className="game-board__axis" textAnchor="middle" x={c.x} y={c.y + 27}>{cell.owner === 'horizontal' ? '↔' : '↕'}</text>}
          {!selectable && <title>{label}</title>}
        </g>;
      })}
    </svg>
    {selectable && <div aria-label="اختر خلية" className="game-board__overlays">{cells.map((cell, index) => <button aria-current={cell.id === activeCellId ? 'true' : undefined} aria-label={`اختر ${cell.revealedLetter ?? cell.visibleValue}، ${cell.q + 1}-${cell.r + 1}`} className="game-board__button" data-testid={`cell-${cell.q}-${cell.r}`} disabled={Boolean(cell.owner)} id={`board-${cell.id}`} key={cell.id} onClick={() => onSelect?.(cell.id)} onKeyDown={(event) => keyMove(event, cell)} style={{ left: `${15.91 + cell.q * 16.84}%`, top: `${14 + cell.r * 15.47 + (cell.q % 2) * 7.74}%` }} tabIndex={cell.id === activeCellId || (!activeCellId && !cell.owner && index === cells.findIndex((candidate) => !candidate.owner)) ? 0 : -1} type="button" />)}</div>}
  </div>;
}
