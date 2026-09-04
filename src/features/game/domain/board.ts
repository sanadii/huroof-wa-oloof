export type TeamAxis = 'horizontal' | 'vertical';
export type CellKind = 'letter' | 'surprise';
export type CellOwner = TeamAxis | undefined;

export interface BoardCell {
  id: `cell-${number}-${number}`;
  q: number;
  r: number;
  kind: CellKind;
  /** A letter for visible cells; a stable 1–9 number for surprises. */
  visibleValue: string;
  revealedLetter?: string;
  owner?: TeamAxis;
}

export interface GameBoard { seed: number; cells: BoardCell[]; }
export const BOARD_SIZE = 5;

export function cellId(q: number, r: number): `cell-${number}-${number}` { return `cell-${q}-${r}`; }
export function isCoordinate(q: number, r: number): boolean { return q >= 0 && q < BOARD_SIZE && r >= 0 && r < BOARD_SIZE; }
export function neighbors(cell: Pick<BoardCell, 'q' | 'r'>): Array<{ q: number; r: number }> {
  // The compact renderer uses odd-q columns, offset down by half a hex. Keep this
  // graph in the domain so ownership/path checks exactly match the visible board.
  const adjacentRows = cell.q % 2 === 0 ? [0, -1] : [0, 1];
  return [
    { q: cell.q, r: cell.r - 1 }, { q: cell.q, r: cell.r + 1 },
    ...adjacentRows.flatMap((offset) => [{ q: cell.q - 1, r: cell.r + offset }, { q: cell.q + 1, r: cell.r + offset }]),
  ].filter(({ q, r }) => isCoordinate(q, r));
}

/** A small deterministic PRNG shared by browser and service. */
function random(seed: number): () => number {
  let value = seed >>> 0;
  return () => { value += 0x6D2B79F5; let t = value; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffled<T>(values: readonly T[], seed: number): T[] {
  const result = [...values]; const next = random(seed);
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}

/** Exactly 25 contiguous odd-q honeycomb cells. RTL never participates in this calculation. */
export function generateBoard(seed: number, letters: readonly string[]): GameBoard {
  const distinctLetters = [...new Set(letters.map((letter) => letter.trim()).filter(Boolean))];
  if (distinctLetters.length < 16) throw new Error('A board requires at least 16 distinct visible letters.');
  const positions = shuffled(Array.from({ length: 25 }, (_, i) => i), seed);
  const surpriseAt = new Set(positions.slice(0, 9));
  const surpriseNumbers = shuffled(Array.from({ length: 9 }, (_, i) => String(i + 1)), seed ^ 0x5f3759df);
  const visibleLetters = shuffled(distinctLetters, seed ^ 0x9e3779b9).slice(0, 16);
  let surpriseIndex = 0; let letterIndex = 0;
  const cells: BoardCell[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) for (let q = 0; q < BOARD_SIZE; q++) {
    const index = r * BOARD_SIZE + q;
    const kind: CellKind = surpriseAt.has(index) ? 'surprise' : 'letter';
    cells.push({ id: cellId(q, r), q, r, kind, visibleValue: kind === 'surprise' ? surpriseNumbers[surpriseIndex++] : visibleLetters[letterIndex++ % visibleLetters.length] });
  }
  return { seed, cells };
}

export function withOwner(board: GameBoard, id: string, owner?: TeamAxis): GameBoard {
  return { ...board, cells: board.cells.map((cell) => cell.id === id ? { ...cell, owner } : cell) };
}
export function revealSurprise(board: GameBoard, id: string, letter: string): GameBoard {
  const cell = board.cells.find((value) => value.id === id);
  if (!cell || cell.kind !== 'surprise' || cell.revealedLetter || !letter.trim()) throw new Error('A surprise may only reveal one unused letter.');
  return { ...board, cells: board.cells.map((value) => value.id === id ? { ...value, revealedLetter: letter } : value) };
}

/** Returns a deterministic BFS path from the stable start edge to the end edge. */
export function findWinningPath(board: GameBoard, team: TeamAxis): string[] | undefined {
  const owned = new Map(board.cells.filter((cell) => cell.owner === team).map((cell) => [cell.id, cell]));
  const starts = [...owned.values()].filter((cell) => team === 'horizontal' ? cell.q === 0 : cell.r === 0);
  const queue = starts.map((cell) => cell.id); const previous = new Map<string, string | undefined>(starts.map((cell) => [cell.id, undefined]));
  while (queue.length) {
    const id = queue.shift()!; const cell = owned.get(id)!;
    if (team === 'horizontal' ? cell.q === BOARD_SIZE - 1 : cell.r === BOARD_SIZE - 1) {
      const path: string[] = []; for (let cursor: string | undefined = id; cursor; cursor = previous.get(cursor)) path.unshift(cursor); return path;
    }
    for (const coordinate of neighbors(cell)) {
      const next = cellId(coordinate.q, coordinate.r);
      if (owned.has(next) && !previous.has(next)) { previous.set(next, id); queue.push(next); }
    }
  }
  return undefined;
}
