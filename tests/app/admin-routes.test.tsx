import { act, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../src/app/ThemeProvider';
import { AdminOverviewRoute, AdminPublishedCategoriesRoute, AdminPublishedQuestionsRoute, AdminQuestionEditorRoute, AdminRecordRoute, AdminRootRedirect, AdminShell, LegacyQuestionRedirect, PublishedQuestionDetail } from '../../src/features/admin/AdminRoutes';

const editorSession = { uid: 'editor-1', roles: ['content_admin'], authzVersion: 1, capabilities: ['session', 'questions.read', 'questions.inspect', 'questions.write', 'reviews.read', 'categories.read', 'categories.write', 'releases.read', 'releases.stage', 'audit.read', 'health.read', 'settings.read'], mutationMode: 'enabled', categoryCorrectionDraftMode: 'enabled', publishedQuestionInspectionMode: 'enabled' } as const;
const viewerSession = { uid: 'viewer-1', roles: ['viewer'], authzVersion: 1, capabilities: ['session', 'questions.read', 'reviews.read', 'categories.read', 'releases.read', 'rooms.read', 'audit.read', 'health.read', 'settings.read'], mutationMode: 'staged', categoryCorrectionDraftMode: 'staged' } as const;
const reviewerSession = { uid: 'reviewer-1', roles: ['reviewer'], authzVersion: 1, capabilities: ['session', 'questions.read', 'questions.inspect', 'reviews.read', 'reviews.decide', 'categories.read', 'audit.read', 'health.read'], mutationMode: 'enabled', categoryCorrectionDraftMode: 'staged', publishedQuestionInspectionMode: 'enabled' } as const;
const serviceMocks = vi.hoisted(() => ({ session: null as unknown, getAdminSession: vi.fn(), saveQuestion: vi.fn(), saveCategoryCorrection: vi.fn(), markPublishedQuestionInspected: vi.fn(), getQuestion: vi.fn(), listQuestions: vi.fn(), listCategories: vi.fn(), listPublishedQuestions: vi.fn(), getPublishedQuestion: vi.fn(), getPublishedQuestionMedia: vi.fn(), listPublishedCategories: vi.fn(), getPublishedCategoryQuestionTypes: vi.fn(), getPublishedCategory: vi.fn(), getCategoryCorrection: vi.fn(), listReviews: vi.fn(), decideReview: vi.fn(), getReview: vi.fn(), getCategory: vi.fn(), getRelease: vi.fn(), getRoom: vi.fn(), listReleases: vi.fn(), listRooms: vi.fn(), listAudit: vi.fn(), getAdminOverview: vi.fn(), getHealth: vi.fn(), getSettings: vi.fn(), roomAction: vi.fn(), releaseStage: vi.fn(), validateQuestion: vi.fn(), submitQuestionReview: vi.fn(), lookupUser: vi.fn(), updateUserRole: vi.fn(), setUserStatus: vi.fn(), revokeUserSessions: vi.fn(), updateSettings: vi.fn() }));

vi.mock('../../src/features/auth/AuthProvider', () => ({ useFirebaseAuth: () => ({ status: 'google' }) }));
vi.mock('../../src/features/admin/admin-service', () => ({ getAdminSession: serviceMocks.getAdminSession, getAdminOverview: serviceMocks.getAdminOverview, saveQuestion: serviceMocks.saveQuestion, saveCategoryCorrection: serviceMocks.saveCategoryCorrection, markPublishedQuestionInspected: serviceMocks.markPublishedQuestionInspected, listQuestions: serviceMocks.listQuestions, getQuestion: serviceMocks.getQuestion, listCategories: serviceMocks.listCategories, listPublishedQuestions: serviceMocks.listPublishedQuestions, getPublishedQuestion: serviceMocks.getPublishedQuestion, getPublishedQuestionMedia: serviceMocks.getPublishedQuestionMedia, listPublishedCategories: serviceMocks.listPublishedCategories, getPublishedCategoryQuestionTypes: serviceMocks.getPublishedCategoryQuestionTypes, getPublishedCategory: serviceMocks.getPublishedCategory, getCategoryCorrection: serviceMocks.getCategoryCorrection, listReviews: serviceMocks.listReviews, decideReview: serviceMocks.decideReview, getReview: serviceMocks.getReview, getCategory: serviceMocks.getCategory, getRelease: serviceMocks.getRelease, getRoom: serviceMocks.getRoom, listReleases: serviceMocks.listReleases, listRooms: serviceMocks.listRooms, listAudit: serviceMocks.listAudit, getHealth: serviceMocks.getHealth, getSettings: serviceMocks.getSettings, roomAction: serviceMocks.roomAction, releaseStage: serviceMocks.releaseStage, validateQuestion: serviceMocks.validateQuestion, submitQuestionReview: serviceMocks.submitQuestionReview, lookupUser: serviceMocks.lookupUser, updateUserRole: serviceMocks.updateUserRole, setUserStatus: serviceMocks.setUserStatus, revokeUserSessions: serviceMocks.revokeUserSessions, updateSettings: serviceMocks.updateSettings }));
function LocationProbe() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output>; }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void; const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; }); return { promise, resolve, reject }; }
function EditorWithNextLink() { return <><Link to="/admin/questions/q-b">السجل التالي</Link><AdminQuestionEditorRoute /></>; }
function PublishedWithNextCategory() { return <><Link to="/admin/questions?categoryId=tahadani-002">الفئة التالية</Link><AdminPublishedQuestionsRoute /></>; }
function renderAdmin(path: string, element: ReactNode) { return render(<ThemeProvider><MemoryRouter initialEntries={[path]}><LocationProbe /><Routes><Route path="/" element={<p>الرئيسية</p>} /><Route path="/admin" element={<AdminShell />}>{element}</Route></Routes></MemoryRouter></ThemeProvider>); }
function HistoryControls() { const navigate = useNavigate(); const location = useLocation(); const openSecondForTest = () => { const next = new URLSearchParams(location.search); next.set('questionId', 'published-q2'); navigate({ pathname: location.pathname, search: `?${next.toString()}` }, { replace: true, state: location.state }); }; return <><button type="button" onClick={() => navigate(-1)}>رجوع المتصفح</button><button type="button" onClick={() => navigate(1)}>تقدم المتصفح</button><button type="button" onClick={openSecondForTest}>تغيير السؤال للاختبار</button></>; }
function renderAdminHistory(entries: string[], index: number, element: ReactNode) { return render(<ThemeProvider><MemoryRouter initialEntries={entries} initialIndex={index}><LocationProbe /><Routes><Route path="/" element={<p>الرئيسية</p>} /><Route path="/admin" element={<AdminShell />}>{element}</Route></Routes></MemoryRouter></ThemeProvider>); }
function renderAdminStrict(path: string, element: ReactNode) { return render(<StrictMode><ThemeProvider><MemoryRouter initialEntries={[path]}><LocationProbe /><Routes><Route path="/" element={<p>الرئيسية</p>} /><Route path="/admin" element={<AdminShell />}>{element}</Route></Routes></MemoryRouter></ThemeProvider></StrictMode>); }

beforeEach(() => { vi.clearAllMocks(); serviceMocks.getAdminSession.mockImplementation(async () => serviceMocks.session); serviceMocks.session = editorSession; serviceMocks.getAdminOverview.mockResolvedValue({ inventory: {}, mutationMode: 'staged' }); serviceMocks.listCategories.mockResolvedValue({ items: [{ id: 'tahadani-001', titleAr: 'تحدي المعرفة' }], nextCursor: null }); serviceMocks.listPublishedCategories.mockResolvedValue({ releaseId: 'release-01', items: [{ id: 'tahadani-001', labelAr: 'تحدي المعرفة', approvedCount: 1 }], nextCursor: null }); serviceMocks.listPublishedQuestions.mockResolvedValue({ releaseId: 'release-01', items: [{ id: 'published-q1', headerAr: 'سؤال منشور', promptAr: 'ما الإجابة؟', categoryId: 'tahadani-001', modality: 'classic' }], nextCursor: null }); serviceMocks.getPublishedQuestion.mockResolvedValue({ releaseId: 'release-01', id: 'published-q1', categoryId: 'tahadani-001', categoryLabelAr: 'تحدي المعرفة', headerAr: 'سؤال منشور', promptAr: 'ما الإجابة؟', canonicalAnswer: 'الإجابة', modality: 'classic', previousQuestionId: null, nextQuestionId: null, inspection: { reviewed: false, reviewedAt: null } }); serviceMocks.getPublishedCategory.mockResolvedValue({ releaseId: 'release-01', id: 'tahadani-001', labelAr: 'تحدي المعرفة', approvedCount: 1, runtimeReadiness: {} }); serviceMocks.getCategoryCorrection.mockResolvedValue({ releaseId: 'release-01', draft: null, canEdit: true, correctionDraftMode: 'enabled' }); serviceMocks.listQuestions.mockResolvedValue({ items: [{ id: 'q1', headerAr: 'سؤال حقيقي', status: 'draft', categoryId: 'tahadani-001', modality: 'classic', revision: 1 }], nextCursor: null }); serviceMocks.listReviews.mockResolvedValue({ items: [], nextCursor: null }); serviceMocks.listReleases.mockResolvedValue({ items: [], nextCursor: null }); serviceMocks.listRooms.mockResolvedValue({ items: [], nextCursor: null }); serviceMocks.listAudit.mockResolvedValue({ items: [], nextCursor: null }); serviceMocks.getQuestion.mockResolvedValue({ id: 'q-existing', revision: 3, status: 'draft', categoryId: 'tahadani-001', modality: 'classic', headerAr: 'عنوان محفوظ', promptAr: 'نص محفوظ', canonicalAnswer: 'جواب', acceptedAnswers: ['جواب'], sources: [] }); serviceMocks.saveQuestion.mockResolvedValue({ operationId: 'op', revision: 1, replayed: false, serverTime: 'now' }); serviceMocks.saveCategoryCorrection.mockResolvedValue({ operationId: 'correction-op', revision: 1, replayed: false, serverTime: 'now' }); serviceMocks.markPublishedQuestionInspected.mockResolvedValue({ operationId: 'inspection-op', revision: 1, replayed: false, serverTime: 'now' }); serviceMocks.decideReview.mockResolvedValue({ operationId: 'review-op', revision: 2, replayed: false, serverTime: 'now' }); });

beforeEach(() => { serviceMocks.getPublishedCategoryQuestionTypes.mockResolvedValue({ releaseId: 'release-01', categories: [{ id: 'tahadani-001' }] }); });

it('shows the stored category identity, keeps category-local navigation bounded, and marks before advancing', async () => {
  serviceMocks.getPublishedQuestion.mockImplementation((id: string) => Promise.resolve({ releaseId: 'release-01', id, categoryId: 'tahadani-001', categoryLabelAr: 'تحدي المعرفة', headerAr: id === 'published-q2' ? 'السؤال التالي' : 'السؤال الحالي', promptAr: 'نص السؤال', canonicalAnswer: 'جواب', modality: 'classic', previousQuestionId: id === 'published-q2' ? 'published-q1' : null, nextQuestionId: id === 'published-q1' ? 'published-q2' : null, inspection: { reviewed: false, reviewedAt: null } }));
  const user = userEvent.setup();
  renderAdmin('/admin/questions/published-q1?releaseId=release-01', <Route path="questions/:id" element={<AdminPublishedQuestionsRoute />} />);
  expect(await screen.findByRole('heading', { name: 'تحدي المعرفة' })).toBeVisible();
  expect(screen.getByText('هذا أول سؤال في الفئة.')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'تسجيل الفحص والانتقال' }));
  await waitFor(() => expect(serviceMocks.markPublishedQuestionInspected).toHaveBeenCalledWith(expect.objectContaining({ id: 'published-q1', releaseId: 'release-01' })));
  expect(await screen.findByTestId('location')).toHaveTextContent('/admin/questions/published-q2?releaseId=release-01');
});

it('uses the published category as the question-page heading with its reviewed cover and return action', async () => {
  serviceMocks.getPublishedQuestion.mockResolvedValue({ releaseId: 'release-01', id: 'missing-1', categoryId: 'tahadani-014', categoryLabelAr: 'الجزء المفقود', headerAr: 'أكمل النمط', promptAr: 'أي قطعة تكمل الشكل؟', canonicalAnswer: 'أ', modality: 'classic', previousQuestionId: null, nextQuestionId: null, inspection: { reviewed: false } });
  renderAdmin('/admin/questions/missing-1?releaseId=release-01', <Route path="questions/:id" element={<AdminPublishedQuestionsRoute />} />);
  expect(await screen.findByRole('heading', { level: 1, name: 'الجزء المفقود' })).toBeVisible();
  expect(screen.getByText('إدارة الخلية - تفاصيل السؤال المنشور')).toBeVisible();
  expect(screen.getByText('قراءة من الإصدار المنشور الثابت. لا يمكن تحرير هذا السجل من لوحة الإدارة.')).toBeVisible();
  expect(screen.getByRole('img', { name: /غلاف فئة الجزء المفقود/ })).toHaveAttribute('src', '/assets/categories/generated/tahadani-014.webp');
  expect(screen.getByRole('link', { name: 'العودة إلى أسئلة الفئة' })).toHaveAttribute('href', '/admin/questions?categoryId=tahadani-014&releaseId=release-01');
});

it('does not let a deferred inspection mark navigate away from a manually selected neighbor', async () => {
  const pending = deferred<{ operationId: string; revision: number; replayed: boolean; serverTime: string }>();
  serviceMocks.markPublishedQuestionInspected.mockReturnValue(pending.promise);
  serviceMocks.getPublishedQuestion.mockImplementation((id: string) => Promise.resolve({ releaseId: 'release-01', id, categoryId: 'tahadani-001', categoryLabelAr: 'تحدي المعرفة', headerAr: id === 'published-q2' ? 'السؤال التالي' : 'السؤال الحالي', promptAr: 'نص السؤال', canonicalAnswer: 'جواب', modality: 'classic', previousQuestionId: id === 'published-q2' ? 'published-q1' : null, nextQuestionId: id === 'published-q1' ? 'published-q2' : null, inspection: { reviewed: false, reviewedAt: null } }));
  const user = userEvent.setup();
  renderAdmin('/admin/questions/published-q1?releaseId=release-01', <Route path="questions/:id" element={<AdminPublishedQuestionsRoute />} />);
  await screen.findByRole('button', { name: 'تسجيل الفحص والانتقال' });
  await user.click(screen.getByRole('button', { name: 'تسجيل الفحص والانتقال' }));
  await user.click(screen.getByRole('button', { name: 'جارٍ الحفظ…' }));
  expect(serviceMocks.markPublishedQuestionInspected).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('link', { name: 'السؤال التالي' }));
  expect(await screen.findByTestId('location')).toHaveTextContent('/admin/questions/published-q2?releaseId=release-01');
  pending.resolve({ operationId: 'late-inspection', revision: 1, replayed: false, serverTime: 'now' });
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/admin/questions/published-q2?releaseId=release-01'));
});

it('keeps a viewer inspection detail read-only while still showing the shared status', async () => {
  serviceMocks.session = viewerSession;
  serviceMocks.getPublishedQuestion.mockResolvedValue({ releaseId: 'release-01', id: 'published-q1', categoryId: 'tahadani-001', categoryLabelAr: 'تحدي المعرفة', headerAr: 'سؤال', promptAr: 'نص', canonicalAnswer: 'جواب', modality: 'classic', previousQuestionId: null, nextQuestionId: null, inspection: { reviewed: true, reviewedAt: 'now' } });
  renderAdmin('/admin/questions/published-q1?releaseId=release-01', <Route path="questions/:id" element={<AdminPublishedQuestionsRoute />} />);
  expect(await screen.findByText('تم فحص هذا السؤال')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'تسجيل الفحص والانتقال' })).not.toBeInTheDocument();
  expect(serviceMocks.markPublishedQuestionInspected).not.toHaveBeenCalled();
});

it('uses one in-app dialog history entry across next, close, Back, and Forward while retaining the list', async () => {
  const user = userEvent.setup();
  serviceMocks.listPublishedQuestions.mockResolvedValue({ releaseId: 'release-01', items: [
    { id: 'published-q1', headerAr: 'سؤال منشور', promptAr: 'ما الإجابة؟', categoryId: 'tahadani-001', modality: 'classic', inspection: { reviewed: true, reviewedAt: { seconds: 1 } } },
    { id: 'published-q2', headerAr: 'سؤال آخر', promptAr: 'السؤال الثاني', categoryId: 'tahadani-001', modality: 'image', inspection: { reviewed: false, reviewedAt: null } },
    { id: 'published-q3', headerAr: 'سؤال قديم', promptAr: 'حالة قديمة', categoryId: 'tahadani-001', modality: 'classic' },
  ], nextCursor: 'cursor-2' });
  serviceMocks.listPublishedCategories.mockResolvedValue({ releaseId: 'release-01', items: [{ id: 'tahadani-001', labelAr: 'تحدي المعرفة', approvedCount: 12 }], nextCursor: null });
  serviceMocks.getPublishedQuestion.mockImplementation((id: string) => Promise.resolve({ releaseId: 'release-01', id, categoryId: 'tahadani-001', categoryLabelAr: 'تحدي المعرفة', headerAr: id === 'published-q2' ? 'السؤال الثاني' : 'السؤال الأول', promptAr: id === 'published-q2' ? 'تفاصيل السؤال الثاني' : 'تفاصيل السؤال الأول', canonicalAnswer: 'الإجابة', modality: 'classic', previousQuestionId: id === 'published-q2' ? 'published-q1' : null, nextQuestionId: id === 'published-q1' ? 'published-q2' : null, inspection: { reviewed: false, reviewedAt: null } }));
  const base = '/admin/questions?categoryId=tahadani-001&modality=classic&releaseId=release-01';
  renderAdminHistory([base], 0, <Route path="questions" element={<><HistoryControls /><AdminPublishedQuestionsRoute /></>} />);
  const trigger = await screen.findByRole('link', { name: 'ما الإجابة؟' });
  await user.click(trigger);
  expect(await screen.findByRole('dialog')).toBeVisible();
  expect(screen.getByText('إجمالي الفئة المنشور: 12 سؤالاً')).toBeVisible();
  expect(screen.getByText('المحمّل الآن: 3 سؤالاً؛ هذا ليس إجمالياً مصفّى.')).toBeVisible();
  expect(screen.getByRole('status', { name: 'تم فحص السؤال' })).toBeVisible();
  expect(screen.getByRole('status', { name: 'لم يسجل فحص بعد' })).toBeVisible();
  expect(screen.getByRole('status', { name: 'حالة الفحص غير متاحة من هذا الإصدار' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'السؤال التالي' }));
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('questionId=published-q2'));
  expect(await screen.findByText('تفاصيل السؤال الثاني')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'إغلاق تفاصيل السؤال' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByText('ما الإجابة؟')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'تقدم المتصفح' }));
  expect(await screen.findByRole('dialog')).toBeVisible();
  expect(screen.getByText('تفاصيل السؤال الثاني')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'رجوع المتصفح' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('keeps an actual-click dialog open through StrictMode effect replay', async () => {
  const dialogPrototype = HTMLDialogElement.prototype;
  const showModalDescriptor = Object.getOwnPropertyDescriptor(dialogPrototype, 'showModal');
  const closeDescriptor = Object.getOwnPropertyDescriptor(dialogPrototype, 'close');
  Object.defineProperty(dialogPrototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(dialogPrototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute('open'); window.setTimeout(() => this.dispatchEvent(new Event('close')), 0); } });
  const user = userEvent.setup();
  try {
    renderAdminStrict('/admin/questions?categoryId=tahadani-001&releaseId=release-01', <Route path="questions" element={<AdminPublishedQuestionsRoute />} />);
    await user.click(await screen.findByRole('link', { name: 'ما الإجابة؟' }));
    await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    expect(await screen.findByRole('dialog', { name: 'تفاصيل السؤال المنشور' })).toBeVisible();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('questionId=published-q1'));
  } finally {
    if (showModalDescriptor) Object.defineProperty(dialogPrototype, 'showModal', showModalDescriptor); else delete (dialogPrototype as { showModal?: unknown }).showModal;
    if (closeDescriptor) Object.defineProperty(dialogPrototype, 'close', closeDescriptor); else delete (dialogPrototype as { close?: unknown }).close;
  }
});

it('dismisses the native dialog cancel event and restores its trigger focus', async () => {
  const user = userEvent.setup();
  renderAdmin('/admin/questions?categoryId=tahadani-001&releaseId=release-01', <Route path="questions" element={<AdminPublishedQuestionsRoute />} />);
  const trigger = await screen.findByRole('link', { name: 'ما الإجابة؟' });
  await user.click(trigger);
  act(() => { screen.getByRole('dialog').dispatchEvent(new Event('cancel', { cancelable: true })); });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
});

it('does not render a prior dialog detail or its media while the selected question identity changes', async () => {
  const first = deferred<Row>(); const second = deferred<Row>();
  serviceMocks.getPublishedQuestion.mockImplementation((id: string) => id === 'published-q1' ? first.promise : second.promise);
  serviceMocks.getPublishedQuestionMedia.mockResolvedValue({ url: 'data:image/png;base64,old', type: 'image' });
  const user = userEvent.setup();
  renderAdminHistory(['/admin/questions?categoryId=tahadani-001&releaseId=release-01'], 0, <Route path="questions" element={<><HistoryControls /><AdminPublishedQuestionsRoute /></>} />);
  await user.click(await screen.findByRole('link', { name: 'ما الإجابة؟' }));
  first.resolve({ releaseId: 'release-01', id: 'published-q1', categoryId: 'tahadani-001', categoryLabelAr: 'تحدي المعرفة', headerAr: 'الأول', promptAr: 'تفاصيل قديمة يجب إخفاؤها', canonicalAnswer: 'جواب', modality: 'image', previousQuestionId: null, nextQuestionId: 'published-q2', inspection: { reviewed: false, reviewedAt: null }, media: { mediaId: 'old-media', type: 'image', altAr: 'وسيط قديم' } });
  expect(await screen.findByText('تفاصيل قديمة يجب إخفاؤها')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'تغيير السؤال للاختبار' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).queryByText('تفاصيل قديمة يجب إخفاؤها')).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('img', { name: 'وسيط قديم' })).not.toBeInTheDocument();
  second.resolve({ releaseId: 'release-01', id: 'published-q2', categoryId: 'tahadani-001', categoryLabelAr: 'تحدي المعرفة', headerAr: 'الثاني', promptAr: 'تفاصيل السؤال الجديد', canonicalAnswer: 'جواب جديد', modality: 'classic', previousQuestionId: 'published-q1', nextQuestionId: null, inspection: { reviewed: false, reviewedAt: null } });
  expect(await screen.findByText('تفاصيل السؤال الجديد')).toBeVisible();
});

it('shows a dialog load failure and retries the same requested question', async () => {
  const pending = deferred<Row>();
  serviceMocks.getPublishedQuestion.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ releaseId: 'release-01', id: 'published-q1', categoryId: 'tahadani-001', categoryLabelAr: 'تحدي المعرفة', headerAr: 'استعادة', promptAr: 'تفاصيل بعد إعادة المحاولة', canonicalAnswer: 'جواب', modality: 'classic', previousQuestionId: null, nextQuestionId: null, inspection: { reviewed: false, reviewedAt: null } });
  const user = userEvent.setup();
  renderAdmin('/admin/questions?categoryId=tahadani-001&releaseId=release-01', <Route path="questions" element={<AdminPublishedQuestionsRoute />} />);
  await user.click(await screen.findByRole('link', { name: 'ما الإجابة؟' }));
  expect(await screen.findByRole('dialog', { name: 'تفاصيل السؤال المنشور' })).toBeVisible();
  pending.reject(new Error('unavailable'));
  expect(await screen.findByRole('alert')).toHaveTextContent('تعذر تحميل السؤال المنشور أو تغيّر الإصدار النشط.');
  expect(screen.getByRole('dialog', { name: 'تفاصيل السؤال المنشور' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
  expect(await screen.findByText('تفاصيل بعد إعادة المحاولة')).toBeVisible();
  expect(serviceMocks.getPublishedQuestion).toHaveBeenCalledTimes(2);
});

it('does not reopen or navigate a dialog after it is closed while its inspection mark is pending', async () => {
  const pending = deferred<{ operationId: string; revision: number; replayed: boolean; serverTime: string }>();
  serviceMocks.markPublishedQuestionInspected.mockReturnValue(pending.promise);
  serviceMocks.getPublishedQuestion.mockResolvedValue({ releaseId: 'release-01', id: 'published-q1', categoryId: 'tahadani-001', categoryLabelAr: 'تحدي المعرفة', headerAr: 'سؤال منشور', promptAr: 'ما الإجابة؟', canonicalAnswer: 'الإجابة', modality: 'classic', previousQuestionId: null, nextQuestionId: 'published-q2', inspection: { reviewed: false, reviewedAt: null } });
  const user = userEvent.setup();
  renderAdmin('/admin/questions?categoryId=tahadani-001&releaseId=release-01', <Route path="questions" element={<AdminPublishedQuestionsRoute />} />);
  const trigger = await screen.findByRole('link', { name: 'ما الإجابة؟' });
  await user.click(trigger);
  await screen.findByRole('dialog');
  await user.click(screen.getByRole('button', { name: 'تسجيل الفحص والانتقال' }));
  await user.click(screen.getByRole('button', { name: 'إغلاق تفاصيل السؤال' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
  pending.resolve({ operationId: 'inspection-op', revision: 1, replayed: false, serverTime: 'now' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByTestId('location')).not.toHaveTextContent('questionId=');
});

it('shows verified images automatically inside their respective question and answer sections', async () => {
  serviceMocks.getPublishedQuestionMedia.mockImplementation(async (_id: string, _release: string, variant: string) => ({ url: `data:image/png;base64,${variant}`, type: 'image' }));
  render(<PublishedQuestionDetail value={{ id: 'q-image', releaseId: 'release-01', headerAr: 'عنوان الصورة', categoryId: 'tahadani-001', modality: 'image', promptAr: 'ما في الصورة؟', canonicalAnswer: 'الإجابة المصورة', media: { mediaId: 'question-image', type: 'image', altAr: 'وصف صورة السؤال' }, answerMedia: { mediaId: 'answer-image', type: 'image', altAr: 'وصف صورة الإجابة' } }} />);
  const question = screen.getByRole('region', { name: 'السؤال' });
  const answer = screen.getByRole('region', { name: 'الإجابة' });
  expect(within(question).getByText('ما في الصورة؟')).toBeVisible();
  expect(within(answer).getByText('الإجابة المصورة')).toBeVisible();
  expect(await within(question).findByRole('img', { name: 'وصف صورة السؤال' })).toHaveAttribute('src', 'data:image/png;base64,question');
  expect(await within(answer).findByRole('img', { name: 'وصف صورة الإجابة' })).toHaveAttribute('src', 'data:image/png;base64,answer');
  expect(serviceMocks.getPublishedQuestionMedia).toHaveBeenCalledWith('q-image', 'release-01', 'question');
  expect(serviceMocks.getPublishedQuestionMedia).toHaveBeenCalledWith('q-image', 'release-01', 'answer');
});

it('plays each verified video inline only when requested in its section', async () => {
  serviceMocks.getPublishedQuestionMedia.mockImplementation(async (_id: string, _release: string, variant: string) => ({ url: `data:video/mp4;base64,${variant}`, type: 'video' }));
  const user = userEvent.setup();
  render(<PublishedQuestionDetail value={{ id: 'q-video', releaseId: 'release-01', headerAr: 'عنوان الفيديو', categoryId: 'tahadani-001', modality: 'video', promptAr: 'من اللاعب؟', canonicalAnswer: 'اللاعب', media: { mediaId: 'question-video', type: 'video' }, answerMedia: { mediaId: 'answer-video', type: 'video' } }} />);
  const question = screen.getByRole('region', { name: 'السؤال' });
  const answer = screen.getByRole('region', { name: 'الإجابة' });
  expect(serviceMocks.getPublishedQuestionMedia).not.toHaveBeenCalled();
  await user.click(within(question).getByRole('button', { name: /شاهد فيديو السؤال/ }));
  expect(await within(question).findByLabelText('فيديو السؤال')).toHaveAttribute('src', 'data:video/mp4;base64,question');
  expect(within(answer).queryByLabelText('فيديو الإجابة')).not.toBeInTheDocument();
  await user.click(within(answer).getByRole('button', { name: /شاهد فيديو الإجابة/ }));
  expect(await within(answer).findByLabelText('فيديو الإجابة')).toHaveAttribute('src', 'data:video/mp4;base64,answer');
  expect(serviceMocks.getPublishedQuestionMedia).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(/تحميل معاينة/)).not.toBeInTheDocument();
});

it('redirects /admin to the Arabic-first overview route', async () => { render(<MemoryRouter initialEntries={['/admin']}><Routes><Route path="/admin" element={<AdminRootRedirect />} /><Route path="/admin/overview" element={<p>overview</p>} /></Routes></MemoryRouter>); expect(await screen.findByText('overview')).toBeVisible(); });
it('keeps a category deep link in the URL, resets it, and sends the filter to the published server query', async () => { const user = userEvent.setup(); renderAdmin('/admin/questions?categoryId=tahadani-001&releaseId=release-01', <Route path="questions" element={<AdminPublishedQuestionsRoute />} />); expect(await screen.findByText('سؤال منشور')).toBeVisible(); expect(serviceMocks.listPublishedQuestions).toHaveBeenCalledWith({ limit: 50, releaseId: 'release-01', categoryId: 'tahadani-001' }); await user.click(screen.getByRole('button', { name: 'مسح المرشحات' })); await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/admin/questions?releaseId=release-01')); await waitFor(() => expect(serviceMocks.listPublishedQuestions).toHaveBeenLastCalledWith({ limit: 50, releaseId: 'release-01' })); });
it('narrows published categories by parent topic and waits for a category before querying questions', async () => {
  const user = userEvent.setup();
  serviceMocks.listPublishedCategories.mockResolvedValue({ releaseId: 'release-01', items: [
    { id: 'tahadani-001', labelAr: 'تحدي المعرفة', approvedCount: 1 },
    { id: 'tahadani-002', labelAr: 'كرة القدم', approvedCount: 1 },
  ], nextCursor: null });
  renderAdmin('/admin/questions?releaseId=release-01', <Route path="questions" element={<AdminPublishedQuestionsRoute />} />);
  const topic = await screen.findByRole('combobox', { name: 'موضوع الفئة المنشورة' });
  const category = screen.getByRole('combobox', { name: 'فئة منشورة' });
  await waitFor(() => expect(topic).toBeEnabled());
  await user.selectOptions(topic, 'sports');
  expect(screen.getByText('اختر فئة من موضوع رياضة لعرض أسئلتها.')).toBeVisible();
  expect(within(category).getByRole('option', { name: 'كرة القدم' })).toBeVisible();
  expect(within(category).queryByRole('option', { name: 'تحدي المعرفة' })).not.toBeInTheDocument();
  expect(screen.getByTestId('location')).toHaveTextContent('topicId=sports');
  const queriesBeforeCategory = serviceMocks.listPublishedQuestions.mock.calls.length;
  await user.selectOptions(category, 'tahadani-002');
  await waitFor(() => expect(serviceMocks.listPublishedQuestions).toHaveBeenCalledWith({ limit: 50, releaseId: 'release-01', categoryId: 'tahadani-002' }));
  expect(serviceMocks.listPublishedQuestions.mock.calls.length).toBe(queriesBeforeCategory + 1);
  await user.selectOptions(topic, 'geography');
  expect(category).toHaveValue('');
  expect(screen.getByText('اختر فئة من موضوع جغرافيا ودول لعرض أسئلتها.')).toBeVisible();
  expect(screen.getByTestId('location')).not.toHaveTextContent('categoryId=');
});
it('selects the parent topic for a category deep link', async () => {
  renderAdmin('/admin/questions?categoryId=tahadani-001&releaseId=release-01', <Route path="questions" element={<AdminPublishedQuestionsRoute />} />);
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'موضوع الفئة المنشورة' })).toHaveValue('geography'));
  expect(screen.getByRole('combobox', { name: 'فئة منشورة' })).toHaveValue('tahadani-001');
});
it('does not render a stale published-category response after the URL filter changes', async () => { const first = deferred<{ releaseId: string; items: Record<string, unknown>[]; nextCursor: null }>(); const second = deferred<{ releaseId: string; items: Record<string, unknown>[]; nextCursor: null }>(); serviceMocks.listPublishedQuestions.mockImplementation((data: { categoryId?: string }) => data.categoryId === 'tahadani-001' ? first.promise : second.promise); const user = userEvent.setup(); renderAdmin('/admin/questions?categoryId=tahadani-001', <Route path="questions" element={<PublishedWithNextCategory />} />); await waitFor(() => expect(serviceMocks.listPublishedQuestions).toHaveBeenCalledWith({ limit: 50, categoryId: 'tahadani-001' })); await user.click(screen.getByRole('link', { name: 'الفئة التالية' })); await waitFor(() => expect(serviceMocks.listPublishedQuestions).toHaveBeenCalledWith({ limit: 50, categoryId: 'tahadani-002' })); second.resolve({ releaseId: 'release-01', items: [{ id: 'q-new', headerAr: 'السؤال الجديد', promptAr: 'نص جديد', categoryId: 'tahadani-002', modality: 'classic' }], nextCursor: null }); expect(await screen.findByText('السؤال الجديد')).toBeVisible(); first.resolve({ releaseId: 'release-01', items: [{ id: 'q-old', headerAr: 'السؤال القديم', promptAr: 'نص قديم', categoryId: 'tahadani-001', modality: 'classic' }], nextCursor: null }); await waitFor(() => expect(screen.queryByText('السؤال القديم')).not.toBeInTheDocument()); });
it('gives category rows distinct view-category and view-questions actions and an honest zero state', async () => { const user = userEvent.setup(); serviceMocks.listPublishedCategories.mockResolvedValue({ releaseId: 'release-01', items: [{ id: 'tahadani-001', labelAr: 'تحدي المعرفة', approvedCount: 0 }], nextCursor: null }); serviceMocks.getPublishedCategory.mockResolvedValue({ releaseId: 'release-01', id: 'tahadani-001', labelAr: 'تحدي المعرفة', approvedCount: 0, runtimeReadiness: {} }); renderAdmin('/admin/categories', <><Route path="categories" element={<AdminPublishedCategoriesRoute />} /><Route path="categories/:id" element={<AdminPublishedCategoriesRoute />} /></>); expect(await screen.findByRole('link', { name: 'عرض الفئة' })).toHaveAttribute('href', '/admin/categories/tahadani-001?releaseId=release-01'); expect(screen.getByRole('link', { name: 'عرض الأسئلة' })).toHaveAttribute('href', '/admin/questions?categoryId=tahadani-001&releaseId=release-01'); await user.click(screen.getByRole('link', { name: 'عرض الفئة' })); expect(await screen.findByText('لا توجد أسئلة منشورة في هذه الفئة ضمن هذا الإصدار.')).toBeVisible(); expect(screen.getByText('جغرافيا ودول')).toBeVisible(); });

it('filters published categories across unloaded pages using the release-bound question type index', async () => {
  const user = userEvent.setup();
  const textCounts = { text: 2, image: 0, video: 0, audio: 0, interactive: 0, other: 0 };
  const videoCounts = { text: 0, image: 0, video: 3, audio: 0, interactive: 0, other: 0 };
  serviceMocks.getPublishedCategoryQuestionTypes.mockResolvedValue({ releaseId: 'release-01', categories: [{ id: 'cat-text', questionTypeCounts: textCounts }, { id: 'cat-video', questionTypeCounts: videoCounts }] });
  serviceMocks.listPublishedCategories.mockImplementation(async (input: { cursor?: string }) => input.cursor
    ? { releaseId: 'release-01', items: [{ id: 'cat-video', labelAr: 'فئة الفيديو', approvedCount: 3 }], nextCursor: null }
    : { releaseId: 'release-01', items: [{ id: 'cat-text', labelAr: 'فئة النص', approvedCount: 2 }], nextCursor: 'cat-text' });
  renderAdmin('/admin/categories', <Route path="categories" element={<AdminPublishedCategoriesRoute />} />);
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'نمط السؤال في الفئات' })).toBeEnabled());
  await user.selectOptions(screen.getByRole('combobox', { name: 'نمط السؤال في الفئات' }), 'video');
  expect(await screen.findByText('فئة الفيديو')).toBeVisible();
  expect(screen.queryByText('فئة النص')).not.toBeInTheDocument();
  expect(serviceMocks.listPublishedCategories).toHaveBeenCalledWith({ limit: 100, cursor: 'cat-text', releaseId: 'release-01' });
  await user.click(screen.getByRole('button', { name: 'مسح التصفية' }));
  expect(screen.getByText('فئة النص')).toBeVisible();
  expect(screen.queryByText('فئة الفيديو')).not.toBeInTheDocument();
});

it('keeps the admin category type filter unavailable for a stale release index', async () => {
  serviceMocks.getPublishedCategoryQuestionTypes.mockResolvedValue({ releaseId: 'other-release', categories: [] });
  renderAdmin('/admin/categories', <Route path="categories" element={<AdminPublishedCategoriesRoute />} />);
  expect(await screen.findByText('تصنيف أنماط الأسئلة غير متاح لهذا الإصدار حالياً؛ تبقى كل الفئات ظاهرة.')).toBeVisible();
  expect(screen.getByRole('combobox', { name: 'نمط السؤال في الفئات' })).toBeDisabled();
  expect(screen.getByText('تحدي المعرفة')).toBeVisible();
});
it('saves only the proposed Arabic label and internal correction note as a release-bound draft', async () => { const user = userEvent.setup(); renderAdmin('/admin/categories/tahadani-001?releaseId=release-01', <Route path="categories/:id" element={<AdminPublishedCategoriesRoute />} />); expect(await screen.findByRole('heading', { name: 'مسودة تصحيح الفئة' })).toBeVisible(); expect(screen.getByText('هذه مسودة تصحيح داخلية؛ لا يراها اللاعبون. يلزم إصدار لاحق ومراجعة منفصلة قبل أن يظهر أي تغيير في اللعب.')).toBeVisible(); await user.clear(screen.getByLabelText('الاسم العربي المقترح')); await user.type(screen.getByLabelText('الاسم العربي المقترح'), 'تحدي مصحح'); await user.type(screen.getByLabelText('ملاحظة التصحيح الداخلية'), 'تدقيق تسمية المصدر.'); await user.click(screen.getByRole('button', { name: 'حفظ مسودة التصحيح' })); await waitFor(() => expect(serviceMocks.saveCategoryCorrection).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 'tahadani-001', releaseId: 'release-01', expectedRevision: 0, draft: { proposedLabelAr: 'تحدي مصحح', internalNote: 'تدقيق تسمية المصدر.' } }))); expect(await screen.findByText('حُفظت مسودة التصحيح. لا يتغير الإصدار المنشور أو اللاعبون بهذا الحفظ.')).toBeVisible(); });
it('requires both correction fields and explains why they are needed', async () => { renderAdmin('/admin/categories/tahadani-001', <Route path="categories/:id" element={<AdminPublishedCategoriesRoute />} />); expect(await screen.findByLabelText('الاسم العربي المقترح')).toBeRequired(); expect(screen.getByLabelText('ملاحظة التصحيح الداخلية')).toBeRequired(); expect(screen.getByText('يلزم اسم عربي مقترح قبل حفظ مسودة التصحيح.')).toBeVisible(); expect(screen.getByText('يلزم وصف داخلي موجز لسبب التصحيح؛ لا يظهر للاعبين.')).toBeVisible(); });
it('keeps an unsaved correction open when its questions link is cancelled', async () => { const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false); const user = userEvent.setup(); renderAdmin('/admin/categories/tahadani-001', <><Route path="categories/:id" element={<AdminPublishedCategoriesRoute />} /><Route path="questions" element={<p>questions</p>} /></>); expect(await screen.findByLabelText('الاسم العربي المقترح')).toBeVisible(); await user.type(screen.getByLabelText('ملاحظة التصحيح الداخلية'), 'سبب غير محفوظ'); await user.click(screen.getByRole('link', { name: /عرض أسئلة هذه الفئة/ })); expect(confirm).toHaveBeenCalled(); expect(screen.getByLabelText('ملاحظة التصحيح الداخلية')).toHaveValue('سبب غير محفوظ'); expect(screen.queryByText('questions')).not.toBeInTheDocument(); confirm.mockRestore(); });
it('keeps a correction draft read-only for viewers and never exposes its internal note', async () => { serviceMocks.session = viewerSession; serviceMocks.getCategoryCorrection.mockResolvedValue({ releaseId: 'release-01', draft: { categoryId: 'tahadani-001', baseReleaseId: 'release-01', baseReleaseRootSha256: 'a'.repeat(64), publishedLabelAr: 'تحدي المعرفة', proposedLabelAr: 'عنوان مقترح', status: 'draft', revision: 2 }, canEdit: false, correctionDraftMode: 'staged' }); renderAdmin('/admin/categories/tahadani-001', <Route path="categories/:id" element={<AdminPublishedCategoriesRoute />} />); expect(await screen.findByText('عنوان مقترح')).toBeVisible(); expect(screen.getByText('هذه الجلسة للقراءة فقط؛ لا تملك صلاحية عرض الملاحظة الداخلية أو حفظ تصحيح الفئة.')).toBeVisible(); expect(screen.queryByLabelText('ملاحظة التصحيح الداخلية')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'حفظ مسودة التصحيح' })).not.toBeInTheDocument(); expect(serviceMocks.saveCategoryCorrection).not.toHaveBeenCalled(); });
it('does not restore a stale category correction after route identity changes', async () => { const first = deferred<Record<string, unknown>>(); serviceMocks.getPublishedCategory.mockImplementation((categoryId: string) => Promise.resolve({ releaseId: 'release-01', id: categoryId, labelAr: categoryId === 'tahadani-001' ? 'الفئة الأولى' : 'الفئة الثانية', approvedCount: 1, runtimeReadiness: {} })); serviceMocks.getCategoryCorrection.mockImplementation((categoryId: string) => categoryId === 'tahadani-001' ? first.promise : Promise.resolve({ releaseId: 'release-01', draft: { categoryId, proposedLabelAr: 'اقتراح ثان', status: 'draft', revision: 1 }, canEdit: true, correctionDraftMode: 'enabled' })); function CategoryWithNextLink() { return <><Link to="/admin/categories/tahadani-002">الفئة التالية</Link><AdminPublishedCategoriesRoute /></>; } const user = userEvent.setup(); renderAdmin('/admin/categories/tahadani-001', <Route path="categories/:id" element={<CategoryWithNextLink />} />); await waitFor(() => expect(serviceMocks.getCategoryCorrection).toHaveBeenCalledWith('tahadani-001', 'release-01')); await user.click(screen.getByRole('link', { name: 'الفئة التالية' })); expect(await screen.findByText('الفئة الثانية')).toBeVisible(); first.resolve({ releaseId: 'release-01', draft: { categoryId: 'tahadani-001', proposedLabelAr: 'اقتراح قديم', status: 'draft', revision: 1 }, canEdit: true, correctionDraftMode: 'enabled' }); await waitFor(() => expect(screen.queryByText('اقتراح قديم')).not.toBeInTheDocument()); });
it('does not let a deferred save overwrite the next category after a confirmed route change', async () => { const pendingSave = deferred<{ operationId: string; revision: number; replayed: boolean; serverTime: string }>(); serviceMocks.getPublishedCategory.mockImplementation((categoryId: string) => Promise.resolve({ releaseId: 'release-01', id: categoryId, labelAr: categoryId === 'tahadani-001' ? 'الفئة الأولى' : 'الفئة الثانية', approvedCount: 1, runtimeReadiness: {} })); serviceMocks.getCategoryCorrection.mockResolvedValue({ releaseId: 'release-01', draft: null, canEdit: true, correctionDraftMode: 'enabled' }); serviceMocks.saveCategoryCorrection.mockReturnValue(pendingSave.promise); function CategoryWithNextLink() { return <><Link to="/admin/categories/tahadani-002">الفئة التالية</Link><AdminPublishedCategoriesRoute /></>; } const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true); const user = userEvent.setup(); renderAdmin('/admin/categories/tahadani-001', <Route path="categories/:id" element={<CategoryWithNextLink />} />); expect(await screen.findByText('الفئة الأولى')).toBeVisible(); await user.clear(screen.getByLabelText('الاسم العربي المقترح')); await user.type(screen.getByLabelText('الاسم العربي المقترح'), 'تصحيح أول'); await user.type(screen.getByLabelText('ملاحظة التصحيح الداخلية'), 'سبب أول'); await user.click(screen.getByRole('button', { name: 'حفظ مسودة التصحيح' })); await waitFor(() => expect(serviceMocks.saveCategoryCorrection).toHaveBeenCalled()); await user.click(screen.getByRole('link', { name: 'الفئة التالية' })); expect(await screen.findByText('الفئة الثانية')).toBeVisible(); pendingSave.resolve({ operationId: 'late-save', revision: 1, replayed: false, serverTime: 'now' }); await waitFor(() => expect(screen.getByLabelText('الاسم العربي المقترح')).toHaveValue('الفئة الثانية')); expect(screen.queryByText('حُفظت مسودة التصحيح. لا يتغير الإصدار المنشور أو اللاعبون بهذا الحفظ.')).not.toBeInTheDocument(); confirm.mockRestore(); });
it('keeps a viewer direct-link editor read-only and never calls mutation services', async () => { serviceMocks.session = viewerSession; renderAdmin('/admin/questions/new', <Route path="questions/new" element={<AdminQuestionEditorRoute />} />); expect(await screen.findByText('هذه الجلسة للقراءة فقط؛ لا تملك صلاحية تعديل الأسئلة أو إرسالها للمراجعة.')).toBeVisible(); expect(screen.queryByRole('button', { name: 'حفظ المسودة' })).not.toBeInTheDocument(); expect(serviceMocks.saveQuestion).not.toHaveBeenCalled(); expect(serviceMocks.submitQuestionReview).not.toHaveBeenCalled(); });
it('keeps saving unavailable when category metadata is empty', async () => { serviceMocks.listCategories.mockResolvedValueOnce({ items: [], nextCursor: null }); renderAdmin('/admin/questions/new', <Route path="questions/new" element={<AdminQuestionEditorRoute />} />); expect(await screen.findByText('لا توجد بيانات فئات متاحة. أضف بيانات الفئة أو حدّث الصفحة قبل الحفظ.')).toBeVisible(); expect(screen.getByRole('button', { name: 'حفظ المسودة' })).toBeDisabled(); expect(serviceMocks.saveQuestion).not.toHaveBeenCalled(); });
it('submits the v3.3 classic specialist contract and replaces a new URL with its stable record URL', async () => { const user = userEvent.setup(); renderAdmin('/admin/drafts/new', <><Route path="drafts/new" element={<AdminQuestionEditorRoute />} /><Route path="drafts/:questionId" element={<AdminQuestionEditorRoute />} /></>); await screen.findByRole('option', { name: 'تحدي المعرفة' }); await user.selectOptions(screen.getByLabelText('الفئة'), 'tahadani-001'); await user.type(screen.getByLabelText('العنوان'), 'عنوان'); await user.type(screen.getByLabelText('نص السؤال'), 'ما الإجابة؟'); await user.type(screen.getByLabelText('الإجابة المرجعية'), 'جواب'); await user.click(screen.getByRole('button', { name: 'حفظ المسودة' })); expect(serviceMocks.saveQuestion).toHaveBeenCalledWith(expect.objectContaining({ draft: expect.objectContaining({ specialistRoles: ['fact_reviewer', 'language_reviewer'], categoryId: 'tahadani-001' }) })); await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/admin\/drafts\/[0-9a-f-]{36}$/)); });
it('preserves typed fields after a Functions conflict instead of discarding the draft', async () => { serviceMocks.saveQuestion.mockRejectedValueOnce({ code: 'functions/aborted' }); const user = userEvent.setup(); renderAdmin('/admin/questions/q-existing', <Route path="questions/:questionId" element={<AdminQuestionEditorRoute />} />); expect(await screen.findByDisplayValue('عنوان محفوظ')).toBeVisible(); await user.clear(screen.getByLabelText('العنوان')); await user.type(screen.getByLabelText('العنوان'), 'عنوان محلي جديد'); await user.click(screen.getByRole('button', { name: 'حفظ المسودة' })); expect(await screen.findByText('تعارض مراجعة: بقي نصك كما هو. افتح السجل المحدث ثم أعد الحفظ.')).toBeVisible(); expect(screen.getByLabelText('العنوان')).toHaveValue('عنوان محلي جديد'); });
it('keeps a dirty editor open when the wordmark navigation is cancelled', async () => { const user = userEvent.setup(); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false); renderAdmin('/admin/questions/q-existing', <Route path="questions/:questionId" element={<AdminQuestionEditorRoute />} />); expect(await screen.findByDisplayValue('عنوان محفوظ')).toBeVisible(); await user.clear(screen.getByLabelText('العنوان')); await user.type(screen.getByLabelText('العنوان'), 'تعديل لا يغادر'); await user.click(screen.getByRole('link', { name: 'الخلية' })); expect(confirm).toHaveBeenCalled(); expect(screen.getByLabelText('العنوان')).toHaveValue('تعديل لا يغادر'); confirm.mockRestore(); });
it('requires an operator-entered changes reason and preserves it after server denial', async () => { serviceMocks.session = reviewerSession; serviceMocks.listReviews.mockResolvedValue({ items: [{ id: 'review-1', questionId: 'q1', categoryId: 'tahadani-001', status: 'in_review', revision: 1 }], nextCursor: null }); serviceMocks.decideReview.mockRejectedValueOnce({ code: 'permission-denied' }); const user = userEvent.setup(); renderAdmin('/admin/reviews', <Route path="reviews" element={<AdminRecordRoute section="reviews" />} />); expect(await screen.findByText('q1')).toBeVisible(); await user.click(screen.getByRole('button', { name: 'طلب تعديلات' })); expect(serviceMocks.decideReview).not.toHaveBeenCalled(); expect(await screen.findByText('اكتب سبب طلب التعديلات قبل الإرسال.')).toBeVisible(); await user.type(screen.getByLabelText('سبب طلب التعديلات'), 'يرجى توثيق المرجع الأولي.'); await user.click(screen.getByRole('button', { name: 'طلب تعديلات' })); expect(await screen.findByText('تعذر إرسال القرار أو لا تملك صلاحية المراجعة.')).toBeVisible(); expect(screen.getByLabelText('سبب طلب التعديلات')).toHaveValue('يرجى توثيق المرجع الأولي.'); await user.click(screen.getByRole('button', { name: 'طلب تعديلات' })); expect(serviceMocks.decideReview).toHaveBeenLastCalledWith(expect.objectContaining({ decision: 'changes_requested', reason: 'يرجى توثيق المرجع الأولي.' })); });
it('shows loaded-page filter counts, Arabic category labels, clear reset, and cursor pagination without claiming global search', async () => { serviceMocks.listQuestions.mockResolvedValueOnce({ items: [{ id: 'q-page-1', headerAr: 'السؤال الأول', status: 'draft', categoryId: 'tahadani-001', modality: 'classic', revision: 1 }], nextCursor: 'q-page-1' }).mockResolvedValueOnce({ items: [{ id: 'q-page-2', headerAr: 'السؤال الثاني', status: 'approved', categoryId: 'tahadani-001', modality: 'classic', revision: 2 }], nextCursor: null }); const user = userEvent.setup(); renderAdmin('/admin/drafts', <Route path="drafts" element={<AdminRecordRoute section="drafts" />} />); expect(await screen.findByText('السؤال الأول')).toBeVisible(); expect((await screen.findAllByText('تحدي المعرفة')).length).toBeGreaterThan(0); expect(screen.getByText('1 من 1 سجل محمّل')).toBeVisible(); await user.type(screen.getByLabelText('تصفية السجلات'), 'غير موجود'); expect(screen.queryByText('السؤال الأول')).not.toBeInTheDocument(); await user.click(screen.getByRole('button', { name: 'مسح التصفية' })); await user.click(screen.getByRole('button', { name: 'تحميل الصفحة التالية' })); expect(await screen.findByText('السؤال الثاني')).toBeVisible(); expect(serviceMocks.listQuestions).toHaveBeenLastCalledWith({ limit: 50, cursor: 'q-page-1' }); await user.selectOptions(screen.getByLabelText('حالة السؤال'), 'approved'); expect(screen.queryByText('السؤال الأول')).not.toBeInTheDocument(); expect(screen.getByText('السؤال الثاني')).toBeVisible(); await user.click(screen.getByRole('button', { name: 'مسح التصفية' })); await user.type(screen.getByLabelText('تصفية السجلات'), 'مسودة'); expect(screen.getByText('السؤال الأول')).toBeVisible(); expect(screen.queryByText('السؤال الثاني')).not.toBeInTheDocument(); await user.click(screen.getByRole('button', { name: 'مسح التصفية' })); await user.selectOptions(screen.getByLabelText('فئة السؤال'), 'tahadani-001'); await user.selectOptions(screen.getByLabelText('نمط السؤال'), 'classic'); expect(screen.getByText('السؤال الأول')).toBeVisible(); expect(screen.getByRole('columnheader', { name: 'الحالة' })).toBeVisible(); expect(screen.getAllByText('مسودة').some(element => element.tagName === 'SPAN')).toBe(true); });
it('preserves the legacy question identifier during compatibility redirect', async () => { render(<MemoryRouter initialEntries={['/questions/q-123']}><Routes><Route path="/questions/:questionId" element={<LegacyQuestionRedirect />} /><Route path="/admin/drafts/:questionId" element={<p>المعرف محفوظ</p>} /></Routes></MemoryRouter>); expect(await screen.findByText('المعرف محفوظ')).toBeVisible(); });

it('load-gates a reused editor so a deferred next record cannot receive the previous record draft', async () => { const next = deferred<Record<string, unknown>>(); serviceMocks.getQuestion.mockImplementation((id: string) => id === 'q-a' ? Promise.resolve({ id: 'q-a', revision: 3, status: 'draft', categoryId: 'tahadani-001', modality: 'classic', headerAr: 'عنوان ألف', promptAr: 'نص ألف', canonicalAnswer: 'جواب ألف', acceptedAnswers: ['جواب ألف'], sources: [] }) : next.promise); const user = userEvent.setup(); renderAdmin('/admin/questions/q-a', <Route path="questions/:questionId" element={<EditorWithNextLink />} />); expect(await screen.findByDisplayValue('عنوان ألف')).toBeVisible(); await user.click(screen.getByRole('link', { name: 'السجل التالي' })); expect(screen.getByRole('button', { name: 'جارٍ تحميل السؤال…' })).toBeDisabled(); expect(screen.getByLabelText('العنوان')).toBeDisabled(); expect(serviceMocks.saveQuestion).not.toHaveBeenCalled(); next.resolve({ id: 'q-b', revision: 7, status: 'draft', categoryId: 'tahadani-001', modality: 'classic', headerAr: 'عنوان باء', promptAr: 'نص باء', canonicalAnswer: 'جواب باء', acceptedAnswers: ['جواب باء'], sources: [] }); expect(await screen.findByDisplayValue('عنوان باء')).toBeVisible(); await user.clear(screen.getByLabelText('العنوان')); await user.type(screen.getByLabelText('العنوان'), 'عنوان باء محلي'); await user.click(screen.getByRole('button', { name: 'حفظ المسودة' })); expect(serviceMocks.saveQuestion).toHaveBeenCalledWith(expect.objectContaining({ id: 'q-b', expectedRevision: 7, draft: expect.objectContaining({ headerAr: 'عنوان باء محلي' }) })); });
it('never re-enables stale editor data after the next record load fails', async () => { serviceMocks.getQuestion.mockImplementation((id: string) => id === 'q-a' ? Promise.resolve({ id: 'q-a', revision: 3, status: 'draft', categoryId: 'tahadani-001', modality: 'classic', headerAr: 'عنوان ألف', promptAr: 'نص ألف', canonicalAnswer: 'جواب ألف', acceptedAnswers: ['جواب ألف'], sources: [] }) : Promise.reject(new Error('denied'))); const user = userEvent.setup(); renderAdmin('/admin/questions/q-a', <Route path="questions/:questionId" element={<EditorWithNextLink />} />); expect(await screen.findByDisplayValue('عنوان ألف')).toBeVisible(); await user.click(screen.getByRole('link', { name: 'السجل التالي' })); expect(await screen.findByText('تعذر تحميل السؤال أو لا تملك نطاقه.')).toBeVisible(); expect(screen.getByRole('button', { name: 'جارٍ تحميل السؤال…' })).toBeDisabled(); expect(screen.getByLabelText('العنوان')).toBeDisabled(); expect(serviceMocks.saveQuestion).not.toHaveBeenCalled(); });
it('holds every editor mutation and field while a review submission is pending', async () => { const review = deferred<{ revision: number }>(); serviceMocks.getQuestion.mockResolvedValue({ id: 'q-existing', revision: 3, status: 'ready_for_review', categoryId: 'tahadani-001', modality: 'classic', headerAr: 'عنوان محفوظ', promptAr: 'نص محفوظ', canonicalAnswer: 'جواب', acceptedAnswers: ['جواب'], sources: [] }); serviceMocks.submitQuestionReview.mockReturnValue(review.promise); const user = userEvent.setup(); renderAdmin('/admin/questions/q-existing', <Route path="questions/:questionId" element={<AdminQuestionEditorRoute />} />); expect(await screen.findByDisplayValue('عنوان محفوظ')).toBeVisible(); await user.click(screen.getByRole('button', { name: 'إرسال للمراجعة' })); await waitFor(() => expect(serviceMocks.submitQuestionReview).toHaveBeenCalledWith(expect.objectContaining({ id: 'q-existing', expectedRevision: 3 }))); expect(screen.getByRole('button', { name: 'حفظ المسودة' })).toBeDisabled(); expect(screen.getByLabelText('العنوان')).toBeDisabled(); expect(screen.getByRole('button', { name: 'جارٍ الإرسال…' })).toBeDisabled(); expect(serviceMocks.saveQuestion).not.toHaveBeenCalled(); review.resolve({ revision: 4 }); expect(await screen.findByText('أُرسل السؤال للمراجعة.')).toBeVisible(); });
it('does not validate or submit a dirty saved record', async () => { serviceMocks.getQuestion.mockResolvedValue({ id: 'q-existing', revision: 3, status: 'ready_for_review', categoryId: 'tahadani-001', modality: 'classic', headerAr: 'عنوان محفوظ', promptAr: 'نص محفوظ', canonicalAnswer: 'جواب', acceptedAnswers: ['جواب'], sources: [] }); const user = userEvent.setup(); renderAdmin('/admin/questions/q-existing', <Route path="questions/:questionId" element={<AdminQuestionEditorRoute />} />); expect(await screen.findByDisplayValue('عنوان محفوظ')).toBeVisible(); await user.type(screen.getByLabelText('العنوان'), ' محلي'); expect(screen.getByRole('button', { name: 'تحقق' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'إرسال للمراجعة' })).toBeDisabled(); await user.click(screen.getByRole('button', { name: 'تحقق' })); await user.click(screen.getByRole('button', { name: 'إرسال للمراجعة' })); expect(serviceMocks.validateQuestion).not.toHaveBeenCalled(); expect(serviceMocks.submitQuestionReview).not.toHaveBeenCalled(); });
it('clears global dirty state after a confirmed editor exit', async () => { const user = userEvent.setup(); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true); renderAdmin('/admin/questions/q-existing', <><Route path="questions/:questionId" element={<AdminQuestionEditorRoute />} /><Route path="overview" element={<AdminOverviewRoute />} /></>); expect(await screen.findByDisplayValue('عنوان محفوظ')).toBeVisible(); await user.type(screen.getByLabelText('العنوان'), ' تعديل'); await user.click(screen.getByRole('link', { name: 'النظرة العامة' })); expect(await screen.findByRole('heading', { name: 'النظرة العامة' })).toBeVisible(); await user.click(screen.getByRole('link', { name: 'الخلية' })); await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/')); expect(confirm).toHaveBeenCalledTimes(1); confirm.mockRestore(); });
