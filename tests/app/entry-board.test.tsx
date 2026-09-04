import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EntryBoard } from '../../src/features/board/entry-board';

describe('EntryBoard', () => {
  it('renders exactly 25 stable axial cells and fixed goal-edge semantics', () => {
    const { container } = render(<EntryBoard />);
    const cells = container.querySelectorAll('[data-cell-id]');
    expect(cells).toHaveLength(25);
    expect(cells[0]).toHaveAttribute('data-cell-id', 'cell-0-0');
    expect(cells[24]).toHaveAttribute('data-cell-id', 'cell-4-4');
    for (const axis of ['horizontal', 'vertical']) {
      for (const edge of ['start', 'end']) {
        expect(container.querySelectorAll(`[data-axis="${axis}"][data-edge="${edge}"]`)).toHaveLength(1);
        expect(container.querySelectorAll(`[data-goal-base="${axis}"]`)).toHaveLength(2);
        expect(container.querySelectorAll(`[data-goal-axis="${axis}"][data-goal-edge="${edge}"]`)).toHaveLength(5);
      }
    }
    expect(screen.getByLabelText('لوح الحروف: خمسة وعشرون خلية سداسية متصلة')).toBeInTheDocument();
  });
});
