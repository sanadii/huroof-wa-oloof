import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpatialBoardScene } from '../../src/features/board/SpatialBoardScene';

describe('SpatialBoardScene', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
  });

  it('keeps the board static when reduced motion is requested', () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockReturnValue({ matches: true }) });
    render(<SpatialBoardScene />);
    const scene = screen.getByTestId('spatial-board-scene');
    Object.defineProperty(scene, 'getBoundingClientRect', { value: () => ({ width: 300, height: 300, left: 0, top: 0 }) });
    fireEvent.pointerMove(scene, { clientX: 300, clientY: 0, pointerType: 'mouse' });
    expect(scene.querySelector('.spatial-board-scene__tilt')).toHaveStyle({ '--spatial-tilt-x': '0deg', '--spatial-tilt-y': '0deg' });
  });
});
