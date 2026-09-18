import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QuestionReadingShield } from '../../src/routes/GameRoutes';

afterEach(() => { cleanup(); vi.useRealTimers(); });

it('covers the text for the answering team and restores it at zero', () => {
  vi.useFakeTimers();
  const { container } = render(<QuestionReadingShield state="FIRST_ANSWER" team="horizontal" serverTime="2026-09-18T09:00:00Z" deadlineAt="2026-09-18T09:00:20Z">السؤال</QuestionReadingShield>);
  expect(container.firstChild).toHaveClass('is-covered');
  expect(container.firstChild).toHaveAttribute('data-team', 'horizontal');
  expect(screen.getByText('السؤال')).not.toHaveAttribute('aria-hidden');
  act(() => { vi.advanceTimersByTime(20000); });
  expect(container.firstChild).not.toHaveClass('is-covered');
  expect(screen.getByText('السؤال')).not.toHaveAttribute('aria-hidden');
});

it('leaves untimed reading and expired answers readable', () => {
  const view = render(<QuestionReadingShield state="QUESTION_READING" team="vertical" serverTime="2026-09-18T09:00:00Z">السؤال</QuestionReadingShield>);
  expect(view.container.firstChild).not.toHaveClass('is-covered');
  view.rerender(<QuestionReadingShield state="FIRST_ANSWER" team="vertical" serverTime="2026-09-18T09:00:21Z" deadlineAt="2026-09-18T09:00:20Z">السؤال</QuestionReadingShield>);
  expect(view.container.firstChild).not.toHaveClass('is-covered');
});
