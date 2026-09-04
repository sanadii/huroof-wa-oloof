export interface EntryBoardCell {
  id: `cell-${number}-${number}`;
  q: number;
  r: number;
  label: string;
}

const LETTERS = [
  'أ', 'ب', 'ت', 'ث', 'ح',
  'خ', 'د', 'ر', 'س', 'ش',
  'ص', 'ط', 'ج', 'ع', 'ف',
  'ق', 'ك', 'ل', 'م', 'ن',
  'ه', 'و', 'ي', 'ا', 'ب',
];

export const ENTRY_BOARD_CELLS: EntryBoardCell[] = Array.from({ length: 25 }, (_, index) => {
  const r = Math.floor(index / 5);
  const q = index % 5;
  return { id: `cell-${q}-${r}`, q, r, label: LETTERS[index] };
});

const radius = 42;
const horizontal = 1.5 * radius;
const vertical = Math.sqrt(3) * radius;

function center(q: number, r: number) {
  return { x: 84 + horizontal * q, y: 56 + vertical * (r + q / 2) };
}

function hexVertices(q: number, r: number) {
  const { x, y } = center(q, r);
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 180) * (60 * index);
    return [x + radius * Math.cos(angle), y + radius * Math.sin(angle)] as const;
  });
}

function hexPoints(q: number, r: number) {
  return hexVertices(q, r).map(([x, y]) => `${x},${y}`).join(' ');
}

function insetHexPoints(q: number, r: number) {
  const c = center(q, r);
  return hexVertices(q, r).map(([x, y]) => `${c.x + (x - c.x) * .92},${c.y + (y - c.y) * .92 - 2}`).join(' ');
}

type TeamAxis = 'horizontal' | 'vertical';
type Edge = 'start' | 'end';

function edgeCells(axis: TeamAxis, edge: Edge) {
  return ENTRY_BOARD_CELLS.filter((cell) => {
    if (axis === 'horizontal') return edge === 'start' ? cell.q === 0 : cell.q === 4;
    return edge === 'start' ? cell.r === 0 : cell.r === 4;
  });
}

function edgeBasePoints(axis: TeamAxis, edge: Edge) {
  const cells = edgeCells(axis, edge);
  if (axis === 'horizontal') {
    const direction = edge === 'start' ? -1 : 1;
    return cells.flatMap((cell, index) => {
      const { x, y } = center(cell.q, cell.r);
      const first = index === 0 ? [`${x + direction * radius / 2},${y - vertical / 2}`] : [];
      return [...first, `${x + direction * radius},${y}`, `${x + direction * radius / 2},${y + vertical / 2}`];
    }).join(' ');
  }
  const points: string[] = [];
  for (const [index, cell] of cells.entries()) {
    const { x, y } = center(cell.q, cell.r);
    const offset = edge === 'start' ? -vertical / 2 : vertical / 2;
    if (index === 0) points.push(`${x - radius / 2},${y + offset}`);
    points.push(`${x + radius / 2},${y + offset}`);
    if (index < cells.length - 1) {
      const next = center(cells[index + 1].q, cells[index + 1].r);
      points.push(`${next.x - radius / 2},${next.y + offset}`);
    }
  }
  return points.join(' ');
}

function toothPoints(axis: TeamAxis, edge: Edge, cell: EntryBoardCell) {
    const { x, y } = center(cell.q, cell.r);
    if (axis === 'horizontal') {
      const direction = edge === 'start' ? -1 : 1;
      return `${x + direction * radius},${y} ${x + direction * (radius - 18)},${y - 16} ${x + direction * (radius - 18)},${y + 16}`;
    }
    const direction = edge === 'start' ? -1 : 1;
    return `${x - 18},${y + direction * vertical / 2} ${x + 18},${y + direction * vertical / 2} ${x},${y + direction * (vertical / 2 - 20)}`;
}

function GoalBase({ axis, edge }: { axis: TeamAxis; edge: Edge }) {
  const label = axis === 'horizontal' ? 'هدف الفريق الأفقي' : 'هدف الفريق العمودي';
  return (
    <g aria-label={label} data-axis={axis} data-edge={edge} role="img">
      <polyline className={`board-goal__base board-goal__base--${axis}`} data-goal-base={axis} fill="none" points={edgeBasePoints(axis, edge)} />
    </g>
  );
}

function GoalTeeth({ axis, edge }: { axis: TeamAxis; edge: Edge }) {
  return (
    <g aria-hidden="true" className={`board-goal__teeth board-goal__teeth--${axis}`}>
      {edgeCells(axis, edge).map((cell) => (
        <polygon className="board-goal__tooth" data-goal-axis={axis} data-goal-edge={edge} key={`${axis}-${edge}-${cell.id}`} points={toothPoints(axis, edge, cell)} />
      ))}
    </g>
  );
}

export function EntryBoard() {
  return (
    <div className="entry-board" aria-label="لوح الحروف: خمسة وعشرون خلية سداسية متصلة">
      <svg aria-labelledby="entry-board-title entry-board-description" role="img" viewBox="0 0 480 560">
        <title id="entry-board-title">لوح الحروف</title>
        <desc id="entry-board-description">خمسة وعشرون خلية سداسية. هدف الفريق الأفقي من اليسار إلى اليمين، وهدف الفريق العمودي من الأعلى إلى الأسفل.</desc>
        <GoalBase axis="vertical" edge="start" />
        <GoalBase axis="vertical" edge="end" />
        <GoalBase axis="horizontal" edge="start" />
        <GoalBase axis="horizontal" edge="end" />
        {ENTRY_BOARD_CELLS.map((cell) => {
          const active = cell.id === 'cell-2-2';
          return (
            <g className="board-cell" data-cell-id={cell.id} data-q={cell.q} data-r={cell.r} key={cell.id}>
              <polygon className="board-cell__shell" points={hexPoints(cell.q, cell.r)} />
              <polygon className={active ? 'board-cell__face board-cell__face--active' : 'board-cell__face'} points={insetHexPoints(cell.q, cell.r)} />
              <text aria-hidden="true" className="board-cell__letter" dominantBaseline="middle" textAnchor="middle" x={center(cell.q, cell.r).x} y={center(cell.q, cell.r).y + 4}>{cell.label}</text>
              <title>{`${cell.id}: ${cell.label}`}</title>
            </g>
          );
        })}
        <GoalTeeth axis="vertical" edge="start" />
        <GoalTeeth axis="vertical" edge="end" />
        <GoalTeeth axis="horizontal" edge="start" />
        <GoalTeeth axis="horizontal" edge="end" />
      </svg>
    </div>
  );
}
