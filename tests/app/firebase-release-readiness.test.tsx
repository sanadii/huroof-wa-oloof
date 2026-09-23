import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../src/app/ThemeProvider';

const runtime = vi.hoisted(() => ({
  kind: 'firebase' as const,
  getApprovedReleaseCatalog: vi.fn(),
  createRoom: vi.fn(),
}));

vi.mock('../../src/features/game/runtime', () => ({ gameRuntime: runtime }));

import { HostNewRoute } from '../../src/routes/GameRoutes';
import { HomeSurface } from '../../src/routes/HomeSurface';

const approvedCatalog = {
  releaseId: 'release-approved', releaseRootSha256: 'a'.repeat(64), demoFixture: false,
  categories: [{ id: 'category-a', labelAr: 'فئة أ', playable: { huroof: true, categories: true, charades: false } }, { id: 'category-b', labelAr: 'فئة ب', playable: { huroof: true, categories: true, charades: false } }],
  boardCapabilities: { huroof: true, categories: true, charades: false },
};

beforeEach(() => {
  runtime.getApprovedReleaseCatalog.mockReset();
  runtime.createRoom.mockReset();
  runtime.createRoom.mockResolvedValue({ roomId: 'room-1', roomCode: 'LIVE0001', revision: 1 });
});

it('keeps Firebase room creation disabled when approved release discovery is unavailable', async () => {
  runtime.getApprovedReleaseCatalog.mockRejectedValue(new Error('No active immutable release.'));
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  await waitFor(() => expect(screen.getAllByText('لا توجد حزمة أسئلة معتمدة ونشطة لإنشاء غرفة مباشرة. راجع النشر أو جرّب لاحقاً.').length).toBeGreaterThan(0));
  expect(screen.getByTestId('create-room')).toBeDisabled();
  expect(runtime.createRoom).not.toHaveBeenCalled();
});

it('submits demo false only after the approved Firebase catalog is ready', async () => {
  runtime.getApprovedReleaseCatalog.mockResolvedValue(approvedCatalog);
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId('create-room')).toBeEnabled());
  expect(screen.getByRole('button', { name: 'أنشئ الغرفة المباشرة' })).toBeEnabled();
  await user.click(screen.getByTestId('create-room'));
  await waitFor(() => expect(runtime.createRoom).toHaveBeenCalledWith(expect.objectContaining({ demo: false, categories: ['category-a', 'category-b'], expectedRelease: { releaseId: 'release-approved', releaseRootSha256: 'a'.repeat(64) } })));
});

it('keeps a board mode disabled when the approved catalog says its exact selector cannot fill it', async () => {
  runtime.getApprovedReleaseCatalog.mockResolvedValue({
    ...approvedCatalog,
    boardCapabilities: { huroof: false, categories: false, charades: true },
    categories: approvedCatalog.categories.map((category) => ({ ...category, playable: { huroof: false, categories: false, charades: true } })),
  });
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  await waitFor(() => expect(screen.getAllByText('الأسئلة المعتمدة الحالية لا تكفي لهذا النمط. اختر نمطاً متاحاً أو حدّث الحزمة.').length).toBeGreaterThan(0));
  expect(screen.getByTestId('create-room')).toBeDisabled();
  expect(runtime.createRoom).not.toHaveBeenCalled();
});
it('refreshes the Firebase catalog when room creation detects a stale release identity', async () => {
  runtime.getApprovedReleaseCatalog
    .mockResolvedValueOnce(approvedCatalog)
    .mockResolvedValueOnce({ ...approvedCatalog, releaseRootSha256: 'b'.repeat(64) });
  runtime.createRoom.mockRejectedValueOnce(new Error('ACTIVE_RELEASE_CHANGED'));
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId('create-room')).toBeEnabled());
  await user.click(screen.getByTestId('create-room'));
  await waitFor(() => expect(runtime.getApprovedReleaseCatalog).toHaveBeenCalledTimes(2));
  expect(await screen.findByText('تغيّرت الحزمة المعتمدة. حدّث الإعدادات للتحقق من الفهرس الجديد.')).toBeVisible();
});
it('uses the approved Firebase catalog on home instead of the local eight-category fallback', async () => {
  runtime.getApprovedReleaseCatalog.mockResolvedValue(approvedCatalog);
  render(<ThemeProvider><MemoryRouter><HomeSurface joinForm={<div />} joinMessage={null} /></MemoryRouter></ThemeProvider>);
  expect(await screen.findByText('فئة أ')).toBeVisible();
  expect(screen.queryByText('معلومات عامة')).not.toBeInTheDocument();
});

it('hides Firebase categories whose exact category selector is not playable on home', async () => {
  runtime.getApprovedReleaseCatalog.mockResolvedValue({
    ...approvedCatalog,
    categories: [
      approvedCatalog.categories[0],
      { ...approvedCatalog.categories[1], playable: { huroof: true, categories: false, charades: false } },
    ],
  });
  render(<ThemeProvider><MemoryRouter><HomeSurface joinForm={<div />} joinMessage={null} /></MemoryRouter></ThemeProvider>);
  expect(await screen.findByRole('link', { name: /فئة أ/ })).toHaveAttribute('href', '/host/new?kind=categories&category=category-a');
  expect(screen.queryByRole('link', { name: /فئة ب/ })).not.toBeInTheDocument();
  expect(screen.queryByText('فئة ب')).not.toBeInTheDocument();
});

it('filters Firebase categories by the selected board and prunes a mismatched deep link', async () => {
  runtime.getApprovedReleaseCatalog.mockResolvedValue({
    ...approvedCatalog,
    categories: [
      approvedCatalog.categories[0],
      { ...approvedCatalog.categories[1], playable: { huroof: false, categories: true, charades: false } },
    ],
  });
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter initialEntries={['/host/new?category=category-b']}><HostNewRoute /></MemoryRouter></ThemeProvider>);

  expect(await screen.findByRole('button', { name: 'فئة أ — أضف إلى الاختيار' })).toBeVisible();
  expect(screen.queryByText('فئة ب')).not.toBeInTheDocument();
  expect(screen.queryByRole('complementary', { name: 'الفئات المختارة' })).not.toBeInTheDocument();

  await user.click(screen.getByRole('radio', { name: 'الفئات' }));
  expect(screen.getByRole('button', { name: 'فئة ب — أضف إلى الاختيار' })).toBeVisible();
});
