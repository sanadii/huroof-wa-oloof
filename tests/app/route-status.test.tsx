import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouteChunkBoundary, RouteLoading } from '../../src/app/App';

function BrokenRoute(): never {
  throw new Error('chunk unavailable');
}

describe('route status surfaces', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders lazy-route loading inside the spatial status panel', () => {
    render(<RouteLoading />);

    expect(screen.getByRole('main')).toHaveClass('app-page', 'spatial-shell');
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('heading', { name: 'جارٍ تحميل الصفحة…' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('يُرجى الانتظار بينما نجهّز الصفحة.');
  });

  it('renders a chunk failure with an alert and retry action inside the spatial status panel', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<RouteChunkBoundary><BrokenRoute /></RouteChunkBoundary>);

    expect(screen.getByRole('main')).toHaveClass('app-page', 'spatial-shell');
    expect(screen.getByRole('heading', { name: 'تعذر تحميل الصفحة' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('تحقق من الاتصال ثم أعد المحاولة.');
    expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeVisible();
  });
});
