import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { AdminQuestionEditorRoute, AdminRecordRoute, AdminRootRedirect, AdminShell, LegacyQuestionRedirect } from '../../src/features/admin/AdminRoutes';

const serviceMocks = vi.hoisted(() => ({
  saveQuestion: vi.fn(async () => ({ operationId: 'op', revision: 1, replayed: false, serverTime: 'now' })),
  getQuestion: vi.fn(),
  listQuestions: vi.fn(async () => ({ items: [{ id: 'q1', headerAr: 'سؤال حقيقي', status: 'draft', revision: 1 }], nextCursor: null })),
}));

vi.mock('../../src/features/auth/AuthProvider', () => ({ useFirebaseAuth: () => ({ status: 'google' }) }));
vi.mock('../../src/features/admin/admin-service', () => ({ getAdminSession: async () => ({ uid: 'uid-1', roles: ['viewer'], authzVersion: 1, capabilities: ['session'], mutationMode: 'staged' }), getAdminOverview: async () => ({ inventory: {}, mutationMode: 'staged' }), saveQuestion: serviceMocks.saveQuestion, listQuestions: serviceMocks.listQuestions, getQuestion: serviceMocks.getQuestion, getReview: vi.fn(), getCategory: vi.fn(), getRelease: vi.fn(), getRoom: vi.fn(), listReviews: vi.fn(async () => ({ items: [], nextCursor: null })), listCategories: vi.fn(async () => ({ items: [], nextCursor: null })), listReleases: vi.fn(async () => ({ items: [], nextCursor: null })), listRooms: vi.fn(async () => ({ items: [], nextCursor: null })), listAudit: vi.fn(async () => ({ items: [], nextCursor: null })), getHealth: vi.fn(async () => ({})), getSettings: vi.fn(async () => ({ runtime: {} })), decideReview: vi.fn(), roomAction: vi.fn(), validateQuestion: vi.fn(async () => ({ valid: true, errors: [] })), submitQuestionReview: vi.fn(), lookupUser: vi.fn(), updateUserRole: vi.fn(), setUserStatus: vi.fn(), revokeUserSessions: vi.fn(), updateSettings: vi.fn() }));

it('redirects /admin to the Arabic-first overview route', async () => {
  render(<MemoryRouter initialEntries={['/admin']}><Routes><Route path="/admin" element={<AdminRootRedirect />} /><Route path="/admin/overview" element={<p>overview</p>} /></Routes></MemoryRouter>);
  expect(await screen.findByText('overview')).toBeVisible();
});
it('shows an Arabic editor action without inventing a successful save result', async () => {
  render(<MemoryRouter initialEntries={['/admin/questions/new']}><Routes><Route path="/admin" element={<AdminShell />}><Route path="questions/new" element={<AdminQuestionEditorRoute />} /></Route></Routes></MemoryRouter>);
  expect(await screen.findByText('سؤال جديد')).toBeVisible();
  expect(screen.getByRole('button', { name: 'حفظ المسودة' })).toBeEnabled();
});

it('submits the v3.3 classic specialist contract through the callable service', async () => {
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={['/admin/questions/new']}><Routes><Route path="/admin" element={<AdminShell />}><Route path="questions/new" element={<AdminQuestionEditorRoute />} /></Route></Routes></MemoryRouter>);
  await user.type(await screen.findByLabelText('معرّف الفئة'), 'tahadani-001');
  await user.type(screen.getByLabelText('العنوان'), 'عنوان');
  await user.type(screen.getByLabelText('نص السؤال'), 'ما الإجابة؟');
  await user.type(screen.getByLabelText('الإجابة المرجعية'), 'جواب');
  await user.click(screen.getByRole('button', { name: 'حفظ المسودة' }));
  expect(serviceMocks.saveQuestion).toHaveBeenCalledWith(expect.objectContaining({ draft: expect.objectContaining({ specialistRoles: ['fact_reviewer', 'language_reviewer'] }) }));
  expect(await screen.findByText('حُفظت المسودة بالخادم.')).toBeVisible();
});

it('preserves existing question fields and provenance after a revisioned save', async () => {
  serviceMocks.getQuestion.mockResolvedValueOnce({
    id: 'q-existing', revision: 3, status: 'draft', categoryId: 'tahadani-001', modality: 'classic',
    headerAr: 'عنوان محفوظ', promptAr: 'نص محفوظ', canonicalAnswer: 'جواب', acceptedAnswers: ['جواب'],
    sources: [{ sourceUrl: 'https://example.com/evidence', publisher: 'ناشر', title: 'مرجع', sourceTier: 'primary', retrievedAt: '2026-09-04T00:00:00.000Z' }],
  });
  serviceMocks.saveQuestion.mockResolvedValueOnce({ operationId: 'op-update', revision: 4, replayed: false, serverTime: 'now' });
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={['/admin/questions/q-existing']}><Routes><Route path="/admin" element={<AdminShell />}><Route path="questions/:questionId" element={<AdminQuestionEditorRoute />} /></Route></Routes></MemoryRouter>);
  expect(await screen.findByDisplayValue('https://example.com/evidence')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'حفظ المسودة' }));
  expect(await screen.findByText('حُفظت المسودة بالخادم.')).toBeVisible();
  expect(screen.getByLabelText('العنوان')).toHaveValue('عنوان محفوظ');
  expect(screen.getByLabelText('رابط HTTPS')).toHaveValue('https://example.com/evidence');
  expect(serviceMocks.saveQuestion).toHaveBeenLastCalledWith(expect.objectContaining({
    expectedRevision: 3,
    draft: expect.objectContaining({ sources: [expect.objectContaining({ sourceUrl: 'https://example.com/evidence', retrievedAt: '2026-09-04T00:00:00.000Z' })] }),
  }));
});

it('loads a real server page for the explicit questions surface', async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><AdminRecordRoute section="questions" /></MemoryRouter>);
  expect(await screen.findByText('سؤال حقيقي')).toBeVisible();
  expect(serviceMocks.listQuestions).toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'سؤال جديد' })).toHaveAttribute('href', '/admin/questions/new');
  const details = screen.getByText('التفاصيل التقنية').closest('details');
  expect(details).not.toHaveAttribute('open');
  expect(details?.querySelector('.admin-json')).toHaveTextContent('سؤال حقيقي');
  await user.click(screen.getByText('التفاصيل التقنية'));
  expect(details).toHaveAttribute('open');
});

it('filters loaded records and consumes the server pagination cursor', async () => {
  serviceMocks.listQuestions
    .mockResolvedValueOnce({ items: [{ id: 'q-page-1', headerAr: 'السؤال الأول', status: 'draft', revision: 1 }], nextCursor: 'q-page-1' })
    .mockResolvedValueOnce({ items: [{ id: 'q-page-2', headerAr: 'السؤال الثاني', status: 'approved', revision: 2 }], nextCursor: null });
  const user = userEvent.setup();
  render(<MemoryRouter><AdminRecordRoute section="questions" /></MemoryRouter>);
  expect(await screen.findByText('السؤال الأول')).toBeVisible();
  await user.type(screen.getByLabelText('تصفية السجلات'), 'غير موجود');
  expect(screen.queryByText('السؤال الأول')).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText('تصفية السجلات'));
  await user.click(screen.getByRole('button', { name: 'تحميل المزيد' }));
  expect(await screen.findByText('السؤال الثاني')).toBeVisible();
  expect(serviceMocks.listQuestions).toHaveBeenLastCalledWith({ limit: 50, cursor: 'q-page-1' });
});

it('preserves the legacy question identifier during compatibility redirect', async () => {
  render(<MemoryRouter initialEntries={['/questions/q-123']}><Routes><Route path="/questions/:questionId" element={<LegacyQuestionRedirect />} /><Route path="/admin/questions/:questionId" element={<p>المعرف محفوظ</p>} /></Routes></MemoryRouter>);
  expect(await screen.findByText('المعرف محفوظ')).toBeVisible();
});
