import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { canRenderCurrentQuestionMedia, CurrentQuestionMedia } from '../../src/routes/GameRoutes';

const media = { mediaId: 'v18-011-001', assetSha256: 'a'.repeat(64), altAr: 'صورة السؤال' };

it('loads the bound image, retries HTTP/image failures, and revokes a late blob response', async () => {
  const first = vi.fn()
    .mockRejectedValueOnce(new Error('expired'))
    .mockResolvedValueOnce({ ...media, url: 'blob:retry', expiresAt: new Date(Date.now() + 60_000).toISOString() });
  const view = render(<CurrentQuestionMedia roomId="room-a" media={media} load={first} />);
  expect(await screen.findByTestId('question-media-error')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'أعد المحاولة' }));
  const image = (await screen.findByTestId('question-media')).querySelector('img')!;
  expect(image).toHaveAttribute('src', 'blob:retry');
  fireEvent.error(image);
  expect(await screen.findByTestId('question-media-error')).toBeVisible();
  let resolveLate: ((value: { url: string; expiresAt: string }) => void) | undefined;
  const late = vi.fn(() => new Promise<{ url: string; expiresAt: string }>((resolve) => { resolveLate = resolve; }));
  const revoke = vi.fn();
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
  view.rerender(<CurrentQuestionMedia roomId="room-a" media={{ ...media, mediaId: 'v18-011-002' }} load={late} />);
  view.unmount();
  await act(async () => resolveLate?.({ ...media, mediaId: 'v18-011-002', url: 'blob:late', expiresAt: new Date(Date.now() + 60_000).toISOString() }));
  await waitFor(() => expect(late).toHaveBeenCalledTimes(1));
  expect(revoke).toHaveBeenCalledWith('blob:late');
  delete (URL as typeof URL & { revokeObjectURL?: () => void }).revokeObjectURL;
});

it('refreshes a valid image grant shortly before expiry', async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-09-09T12:00:00.000Z'));
    const load = vi.fn()
      .mockResolvedValueOnce({ ...media, url: 'blob:first', expiresAt: new Date(Date.now() + 1_500).toISOString() })
      .mockResolvedValueOnce({ ...media, url: 'blob:second', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    render(<CurrentQuestionMedia roomId="room-a" media={media} load={load} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(load).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});

it('rejects expired or mismatched grants without displaying or rapidly refreshing them', async () => {
  const load = vi.fn().mockResolvedValue({ mediaId: 'v18-011-002', assetSha256: 'b'.repeat(64), url: 'blob:wrong', expiresAt: new Date(Date.now() - 1).toISOString() });
  render(<CurrentQuestionMedia roomId="room-a" media={media} load={load} />);
  expect(await screen.findByTestId('question-media-error')).toBeVisible();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(load).toHaveBeenCalledTimes(1);
});

it('requires a current authoritative host/audience surface before rendering image media', () => {
  expect(canRenderCurrentQuestionMedia({ audienceQuestionVisible: true, authoritative: true, connection: 'connected', role: 'host', state: 'PAUSED', surface: 'host' })).toBe(true);
  expect(canRenderCurrentQuestionMedia({ audienceQuestionVisible: true, authoritative: true, connection: 'connected', role: 'audience', state: 'QUESTION_READING', surface: 'display' })).toBe(true);
  for (const patch of [
    { authoritative: false },
    { connection: 'offline' },
    { role: 'player' as const },
    { audienceQuestionVisible: false },
    { state: 'CELL_SELECTION' },
  ]) expect(canRenderCurrentQuestionMedia({ audienceQuestionVisible: true, authoritative: true, connection: 'connected', role: 'audience', state: 'QUESTION_READING', surface: 'display', ...patch })).toBe(false);
});
