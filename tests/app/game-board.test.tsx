import { fireEvent, render, screen } from '@testing-library/react';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { GameBoard, nearestCell, type BoardCell } from '../../src/features/board/game-board';
import { previewBoardCells } from '../../src/routes/GameRoutes';

const cells: BoardCell[] = Array.from({ length: 25 }, (_, index) => ({ id: `cell-${index % 5}-${Math.floor(index / 5)}`, q: index % 5, r: Math.floor(index / 5), kind: 'letter', visibleValue: 'أ' }));

it('keeps axial keyboard adjacency in the SVG board', () => {
  expect(nearestCell(cells, 2, 2, 'ArrowLeft')?.id).toBe('cell-1-2');
  expect(nearestCell(cells, 2, 2, 'ArrowUp')?.id).toBe('cell-2-1');
  expect(nearestCell(cells, 0, 0, 'ArrowLeft')).toBeUndefined();
});

it('exposes exactly one keyboard-operable cell overlay in its initial roving state', () => {
  render(<GameBoard cells={cells} selectable />);
  const first = screen.getByTestId('cell-0-0');
  expect(first).toHaveAttribute('tabindex', '0');
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  expect(document.activeElement?.id).toBe('board-cell-1-0');
});

it('renders four segmented half-cell rails on a square outer frame', () => {
  const { container } = render(<GameBoard cells={cells} />);
  expect(container.querySelector('.game-board-svg')).toHaveAttribute('viewBox', '0 0 440 440');
  expect(container.querySelector('.game-board-svg')).toHaveAttribute('data-frame-shape', 'square');
  for (const rail of ['horizontal-start', 'horizontal-end', 'vertical-start', 'vertical-end']) {
    const element = screen.getByTestId(`board-rail-${rail}`);
    expect(element).toHaveAttribute('data-rail-shape', 'half-cell-frame');
    expect(element.querySelectorAll('path')).toHaveLength(2);
    expect(element.querySelectorAll('.game-board__rail-depth')).toHaveLength(1);
    expect(element.querySelectorAll('line')).toHaveLength(4);
    expect(element.querySelector('polyline')).toBeNull();
  }
});

it('adds a token-material shell and inset face to every cell without changing overlay centres', () => {
  const { container } = render(<GameBoard cells={cells} selectable />);
  expect(container.querySelectorAll('[data-material-layer="shell"]')).toHaveLength(25);
  expect(container.querySelectorAll('[data-material-layer="face"]')).toHaveLength(25);
  expect(container.querySelectorAll('.game-board__cell-highlight')).toHaveLength(25);
  expect(container.querySelectorAll('.game-board__cell-shade')).toHaveLength(25);
  expect(screen.getByTestId('cell-0-0')).toHaveStyle({ left: '15.91%', top: '14%' });
  expect(screen.getByTestId('cell-4-4')).toHaveStyle({ left: '83.27%', top: '75.88%' });
});

it('keeps SVG material definitions unique across multiple board instances', () => {
  const { container } = render(<><GameBoard cells={cells} /><GameBoard cells={cells} /></>);
  const gradientIds = [...container.querySelectorAll('linearGradient')].map((gradient) => gradient.id);
  expect(gradientIds).toHaveLength(8);
  expect(new Set(gradientIds).size).toBe(8);
  expect([...container.querySelectorAll('.game-board__cell-face')].every((face) => face.getAttribute('fill')?.startsWith('url(#board-material-'))).toBe(true);
});

it('keeps both generated background fields at their recorded dimensions and production weights', async () => {
  for (const name of ['studio-field-light.webp', 'studio-field-dark.webp']) {
    const asset = join(process.cwd(), 'public', 'assets', 'backgrounds', name);
    const [metadata, details] = await Promise.all([sharp(asset).metadata(), stat(asset)]);
    expect(metadata.width).toBe(1254);
    expect(metadata.height).toBe(1254);
    expect(details.size).toBeGreaterThan(90_000);
    expect(details.size).toBeLessThan(150_000);
  }
});

it('uses a rule-generated fallback preview with 16 distinct letters and all surprise numbers once', () => {
  const letters = previewBoardCells.filter((cell) => cell.kind === 'letter').map((cell) => cell.visibleValue);
  const surpriseNumbers = previewBoardCells.filter((cell) => cell.kind === 'surprise').map((cell) => cell.visibleValue);
  expect(previewBoardCells).toHaveLength(25);
  expect(new Set(letters).size).toBe(16);
  expect([...surpriseNumbers].sort()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  expect(new Set(previewBoardCells.map((cell) => cell.visibleValue)).size).toBe(25);
});
