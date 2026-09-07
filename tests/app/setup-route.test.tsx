import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../src/app/ThemeProvider';
import { HostNewRoute, QuestionsRoute } from '../../src/routes/GameRoutes';

afterEach(() => vi.restoreAllMocks());

it('shows each category cover and title without readiness copy, with an explicit selected state', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  await waitFor(() => expect(document.title).toBe('إنشاء مباراة | استوديو الحروف'));
  const category = screen.getAllByRole('button', { pressed: false })[0];
  expect(screen.getAllByRole('img')).toHaveLength(62);
  expect(category).toHaveTextContent('من أنا / دول');
  expect(category).not.toHaveTextContent('جاهزية الأسئلة');
  await user.click(category);
  expect(category).toHaveAttribute('aria-pressed', 'true');
  expect(category).toHaveClass('is-selected');
  expect(screen.getByRole('complementary', { name: 'الفئات المختارة' })).toHaveTextContent('1 / 10');
});

it('replaces a missing category cover with the default image', () => {
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  fireEvent.error(screen.getByRole('img', { name: 'غلاف فئة من أنا / دول' }));
  expect(screen.getByRole('img', { name: 'صورة افتراضية لفئة من أنا / دول' }))
    .toHaveAttribute('src', '/assets/categories/320/category-006.webp');
});

it('keeps selected categories in a removable floating tray and caps the selection at ten', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  const categoryButtons = screen.getAllByRole('button', { pressed: false });
  for (const category of categoryButtons.slice(0, 10)) await user.click(category);

  expect(screen.getByRole('complementary', { name: 'الفئات المختارة' })).toHaveTextContent('10 / 10');
  expect(screen.getAllByRole('listitem')).toHaveLength(10);

  await user.click(categoryButtons[10]);
  expect(categoryButtons[10]).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByText('يمكن اختيار 10 فئات كحد أقصى.')).toBeVisible();

  await user.click(screen.getByRole('button', { name: 'إزالة من أنا / دول' }));
  expect(screen.getByRole('complementary', { name: 'الفئات المختارة' })).toHaveTextContent('9 / 10');
});

it('filters setup categories by Arabic name without clearing the selected categories', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  const firstCategory = screen.getAllByRole('button', { pressed: false })[0];
  await user.click(firstCategory);
  await user.type(screen.getByRole('searchbox', { name: 'تصفية الفئات' }), 'تكنولوجيا');
  expect(screen.getByRole('button', { name: /تكنولوجيا/ })).toBeVisible();
  expect(screen.queryByRole('button', { name: /من أنا \/ دول/, pressed: true })).not.toBeInTheDocument();
  await user.clear(screen.getByRole('searchbox', { name: 'تصفية الفئات' }));
  expect(firstCategory).toHaveAttribute('aria-pressed', 'true');
});

it('uses every catalog category by default and can return to that complete set', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  const allCategories = screen.getByRole('button', { name: 'كل الفئات' });
  const firstCategory = screen.getAllByRole('button', { pressed: false })[0];

  expect(allCategories).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('كل الفئات (62) ستدخل في ترشيح الأسئلة.')).toBeVisible();

  await user.click(firstCategory);
  expect(screen.getByText('سيجري ترشيح الأسئلة من 1 فئة مختارة.')).toBeVisible();

  await user.click(allCategories);
  expect(allCategories).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('كل الفئات (62) ستدخل في ترشيح الأسئلة.')).toBeVisible();
});

it('shows a clear Arabic recovery message when a selected scope cannot fill the board', async () => {
  const user = userEvent.setup();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ error: 'QUESTION_SCOPE_INSUFFICIENT_COVERAGE' }), { status: 400 }),
  );
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  await user.click(screen.getAllByRole('button', { pressed: false })[0]);
  await user.click(screen.getByRole('button', { name: 'أنشئ الغرفة التجريبية' }));
  expect(await screen.findByText('لا تكفي الأسئلة في الفئات المختارة لتجهيز لوحة المباراة. اختر «كل الفئات» أو أضف «معلومات عامة».')).toBeVisible();
});

it('uses the fixed Arabic match rule and does not expose a best-of selector', async () => {
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  expect(screen.getAllByText('تنتهي المباراة بفوز فريق بجولتين متتاليتين أو بثلاث جولات إجمالاً')).toHaveLength(2);
  expect(screen.queryByRole('radiogroup', { name: 'عدد الجولات' })).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain('الأفضل من');
});

it('seeds only supported mode and category queries once, preserving query order and user edits', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter initialEntries={['/host/new?mode=custom&category=tahadani-002&category=tahadani-001&category=tahadani-002']}><HostNewRoute /></MemoryRouter></ThemeProvider>);
  expect(screen.getByRole('radio', { name: 'مخصصة' })).toHaveAttribute('aria-checked', 'true');
  const first = screen.getByRole('button', { name: /من أنا \/ دول/, pressed: true });
  const second = screen.getByRole('button', { name: /من أنا \/ لاعبين كرة قدم/, pressed: true });
  expect(second).toHaveAttribute('aria-pressed', 'true');
  expect(first).toHaveAttribute('aria-pressed', 'true');
  await user.click(screen.getByRole('radio', { name: 'سريعة' }));
  await user.click(first);
  expect(screen.getByRole('radio', { name: 'سريعة' })).toHaveAttribute('aria-checked', 'true');
  expect(first).toHaveAttribute('aria-pressed', 'false');
});

it('falls back safely when setup query values are unsupported', () => {
  render(<ThemeProvider><MemoryRouter initialEntries={['/host/new?mode=unknown&category=missing&category=tahadani-001']}><HostNewRoute /></MemoryRouter></ThemeProvider>);
  expect(screen.getByRole('radio', { name: 'كلاسيكية' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByTestId('setup-query-notice')).toHaveTextContent('تجاهلنا اختيارات غير مدعومة');
  expect(screen.getByRole('button', { name: /من أنا \/ دول/, pressed: true })).toHaveAttribute('aria-pressed', 'true');
});

it('filters local inventory by review status, use count, and objections', async () => {
  const user = userEvent.setup();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([
    { id: 'used-objection', targetLetter: 'أ', headerAr: 'سؤال مع اعتراض', status: 'draft', useCount: 2, objectionCount: 1 },
    { id: 'unused', targetLetter: 'ب', headerAr: 'سؤال هادئ', status: 'approved', useCount: 0, objectionCount: 0 },
  ]), { status: 200 }));
  render(<ThemeProvider><MemoryRouter initialEntries={['/questions']}><QuestionsRoute /></MemoryRouter></ThemeProvider>);
  await screen.findByText('سؤال مع اعتراض');
  expect(screen.getByRole('link', { name: 'مسودة جديدة' }).closest('.admin-page__header')).not.toBeNull();
  expect(screen.getByText('سؤال مع اعتراض').closest('.table-row')).toHaveTextContent('مسودة');
  expect(screen.queryByText('draft')).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('حالة المراجعة'), 'draft');
  await user.selectOptions(screen.getByLabelText('عدد الاستخدام'), 'used');
  await user.selectOptions(screen.getByLabelText('الاعتراضات'), 'has');
  expect(screen.getByText('سؤال مع اعتراض')).toBeVisible();
  expect(screen.queryByText('سؤال هادئ')).not.toBeInTheDocument();
});

it('loads an existing read-only question and makes a review error visible', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const question = { id: 'approved-1', targetLetter: 'ت', headerAr: 'عنوان السؤال', promptAr: 'نص السؤال المحفوظ', canonicalAnswer: 'الإجابة', acceptedAnswers: ['بديل'], status: 'approved', categoryId: 'language', difficulty: 'سهل', sourceUrl: 'https://example.test/source', reviewError: 'يلزم توثيق المصدر' };
    return new Response(JSON.stringify(url.endsWith('/approved-1') ? question : [question]), { status: 200 });
  });
  render(<ThemeProvider><MemoryRouter initialEntries={['/questions/approved-1']}><Routes><Route path="/questions/:questionId" element={<QuestionsRoute />} /></Routes></MemoryRouter></ThemeProvider>);
  await screen.findByTestId('read-only-question');
  expect(screen.getByTestId('review-error')).toHaveTextContent('يلزم توثيق المصدر');
  await waitFor(() => expect(screen.getByLabelText('السؤال')).toHaveValue('نص السؤال المحفوظ'));
  expect(screen.getByLabelText('السؤال')).toBeDisabled();
});
