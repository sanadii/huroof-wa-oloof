import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../src/app/ThemeProvider';
import { HostNewRoute, QuestionsRoute, readableError } from '../../src/routes/GameRoutes';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify({ error: 'LOCAL_DB_SOURCE_DISABLED' }), { status: 400 }));
});

it('shows only available categories and excludes unavailable content from browsing', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  await waitFor(() => expect(document.title).toBe('إنشاء مباراة | تحدي الخلية'));
  const category = screen.getAllByRole('button', { pressed: false })[0];
  expect(screen.getAllByRole('img')).toHaveLength(8);
  expect(screen.queryByRole('button', { name: /غير متاحة للعب بعد/ })).not.toBeInTheDocument();
  expect(category).toHaveTextContent('معلومات عامة');
  expect(category).not.toHaveTextContent('جاهزية الأسئلة');
  expect(screen.getByRole('option', { name: 'جغرافيا ودول (3)' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'علوم وطبيعة (3)' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'ثقافة وألغاز (2)' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /رياضة/ })).not.toBeInTheDocument();
  await user.click(category);
  expect(category).toHaveAttribute('aria-pressed', 'true');
  expect(category).toHaveClass('is-selected');
  expect(screen.getByRole('complementary', { name: 'الفئات المختارة' })).toHaveTextContent('1 / 10');
});

it('replaces legacy setup cards with the metadata-only local DB inventory', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    source: 'local_firestore_import',
    huroofAvailable: true,
    categories: [
      { id: 'huroof-068', labelAr: 'منتخب الكويت', sourceOnly: true, questionCount: 14, heldQuestionCount: 0, huroofQuestionCount: 14, availability: 'ready', categoryGameEligible: true },
      { id: 'tahadani-015', labelAr: 'أمثال وغطاوي', sourceOnly: false, questionCount: 14, heldQuestionCount: 0, huroofQuestionCount: 14, availability: 'ready', categoryGameEligible: true },
    ],
  })));
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  await waitFor(() => expect(screen.getByRole('button', { name: /منتخب الكويت/ })).toBeVisible());
  expect(screen.getByRole('option', { name: 'كل الموضوعات (2)' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /معلومات عامة/ })).not.toBeInTheDocument();
});

it('shows held-only local categories with a disabled Arabic availability state', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    source: 'local_sqlite_import',
    huroofAvailable: true,
    categories: [
      { id: 'tahadani-ready', labelAr: 'فئة جاهزة', sourceOnly: true, questionCount: 14, heldQuestionCount: 0, huroofQuestionCount: 14, availability: 'ready', categoryGameEligible: true },
      { id: 'tahadani-held', labelAr: 'فئة مؤجلة', sourceOnly: true, questionCount: 0, heldQuestionCount: 6, huroofQuestionCount: 0, availability: 'held_only', categoryGameEligible: false },
    ],
  })));
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  const held = await screen.findByRole('button', { name: 'فئة مؤجلة — غير متاحة للعب بعد' });
  expect(held).toBeDisabled();
  expect(held).toHaveTextContent('أسئلة هذه الفئة قيد المراجعة وليست متاحة للعب بعد.');
  await userEvent.click(screen.getByRole('radio', { name: 'الفئات' }));
  expect(screen.getByRole('button', { name: 'فئة جاهزة — أضف إلى الاختيار' })).toBeEnabled();
});

it('does not silently show fixture categories after a DB inventory error and can retry', async () => {
  vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'LOCAL_DB_ORIGIN_REQUIRED' }), { status: 400 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      source: 'local_firestore_import', huroofAvailable: true,
      categories: [{ id: 'huroof-068', labelAr: 'منتخب الكويت', sourceOnly: true, categoryGameEligible: true }],
    })));
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: /معلومات عامة/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
  expect(await screen.findByRole('button', { name: /منتخب الكويت/ })).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('disables room creation before transport in an explicit static preview', async () => {
  vi.stubEnv('VITE_STATIC_PREVIEW', 'true');
  const fetchMock = vi.spyOn(globalThis, 'fetch');
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  await waitFor(() => expect(screen.getByText('هذه معاينة منشورة للواجهة فقط. إنشاء الغرف والانضمام وإدارة الأسئلة والبيانات غير متاحة هنا.')).toBeInTheDocument());
  expect(screen.getByTestId('create-room')).toBeDisabled();
  expect(screen.getByTestId('create-room')).toHaveTextContent('إنشاء الغرفة غير متاح في المعاينة');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('replaces a missing category cover with the default image', () => {
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  fireEvent.error(screen.getByRole('img', { name: 'غلاف فئة معلومات عامة' }));
  expect(screen.getByRole('img', { name: 'صورة افتراضية لفئة معلومات عامة' }))
    .toHaveAttribute('src', '/assets/categories/320/category-006.webp');
});

it('keeps the current available categories in a removable floating tray', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  const categoryButtons = screen.getAllByRole('button', { pressed: false });
  for (const category of categoryButtons) await user.click(category);

  expect(screen.getByRole('complementary', { name: 'الفئات المختارة' })).toHaveTextContent('8 / 10');
  expect(screen.getAllByRole('listitem')).toHaveLength(8);

  await user.click(screen.getByRole('button', { name: 'إزالة معلومات عامة' }));
  expect(screen.getByRole('complementary', { name: 'الفئات المختارة' })).toHaveTextContent('7 / 10');
});

it('keeps keyboard focus in the selection tray after removing a category', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  const categories = screen.getAllByRole('button', { pressed: false });
  await user.click(categories[0]);
  await user.click(categories[1]);

  const firstRemoval = screen.getByRole('button', { name: 'إزالة معلومات عامة' });
  const nextRemoval = screen.getByRole('button', { name: 'إزالة عالم الحيوان' });
  firstRemoval.focus();
  await user.keyboard('{Enter}');

  await waitFor(() => expect(nextRemoval).toHaveFocus());
  expect(screen.queryByRole('button', { name: 'إزالة معلومات عامة' })).not.toBeInTheDocument();

  await user.keyboard('{Enter}');
  await waitFor(() => expect(screen.getByRole('searchbox', { name: 'تصفية الفئات' })).toHaveFocus());
});

it('filters setup categories by Arabic name without clearing the selected categories', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  const firstCategory = screen.getAllByRole('button', { pressed: false })[0];
  await user.click(firstCategory);
  await user.type(screen.getByRole('searchbox', { name: 'تصفية الفئات' }), 'تكنولوجيا');
  expect(screen.getByRole('button', { name: /تكنولوجيا/ })).toBeVisible();
  expect(screen.queryByRole('button', { name: /معلومات عامة/, pressed: true })).not.toBeInTheDocument();
  await user.clear(screen.getByRole('searchbox', { name: 'تصفية الفئات' }));
  expect(firstCategory).toHaveAttribute('aria-pressed', 'true');
});

it('intersects browse filters and resets them without clearing the game selection', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  const selected = screen.getAllByRole('button', { pressed: false })[0];
  await user.click(selected);

  await user.selectOptions(screen.getByLabelText('الموضوع'), 'geography');
  await user.click(screen.getByLabelText('الفئات المختارة فقط'));
  expect(screen.getByText('لا توجد فئات مطابقة. أعد ضبط التصفية لعرض كل الفئات.')).toBeVisible();

  await user.click(screen.getByRole('button', { name: 'إعادة ضبط التصفية' }));
  expect(screen.getByRole('button', { name: /معلومات عامة/, pressed: true })).toBeVisible();
  expect(screen.getByRole('complementary', { name: 'الفئات المختارة' })).toHaveTextContent('1 / 10');
});

it('explains selected-only filtering before a category is selected', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);

  await user.click(screen.getByLabelText('الفئات المختارة فقط'));
  expect(screen.getByText('لا توجد فئات مختارة بعد. اختر فئة ثم فعّل هذا الخيار.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'إعادة ضبط التصفية' })).toBeEnabled();
});

it('uses every catalog category by default and can return to that complete set', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  const firstCategory = screen.getAllByRole('button', { pressed: false })[0];

  expect(screen.getByText('كل الفئات المتاحة (8) ستدخل في ترشيح الأسئلة.')).toBeVisible();

  await user.click(firstCategory);
  expect(screen.getByText('سيجري ترشيح الأسئلة من 1 فئة مختارة.')).toBeVisible();

  await user.click(screen.getByRole('button', { name: 'استخدام كل الفئات' }));
  expect(screen.getByText('كل الفئات المتاحة (8) ستدخل في ترشيح الأسئلة.')).toBeVisible();
});

it('maps an insufficient selected-question scope to clear Arabic recovery copy', () => {
  expect(readableError(new Error('QUESTION_SCOPE_INSUFFICIENT_COVERAGE'))).toBe(
    'لا تكفي الأسئلة في الفئات المختارة لتجهيز لوحة المباراة. اختر «استخدام كل الفئات» أو أضف «معلومات عامة».',
  );
});

it('uses the fixed Arabic match rule and does not expose a best-of selector', async () => {
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  expect(screen.getAllByText('تنتهي المباراة بفوز فريق بجولتين متتاليتين أو بثلاث جولات إجمالاً')).toHaveLength(2);
  expect(screen.queryByRole('radiogroup', { name: 'عدد الجولات' })).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain('الأفضل من');
});

it('uses a roving tab stop and arrow-key navigation for match modes', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  const classic = screen.getByRole('radio', { name: 'كلاسيكية' });
  const fast = screen.getByRole('radio', { name: 'سريعة' });
  const custom = screen.getByRole('radio', { name: 'مخصصة' });

  expect(classic).toHaveAttribute('tabindex', '0');
  expect(fast).toHaveAttribute('tabindex', '-1');
  classic.focus();
  await user.keyboard('{ArrowLeft}');
  expect(fast).toHaveFocus();
  expect(fast).toHaveAttribute('aria-checked', 'true');
  expect(fast).toHaveAttribute('tabindex', '0');

  await user.keyboard('{End}');
  expect(custom).toHaveFocus();
  expect(custom).toHaveAttribute('aria-checked', 'true');
});

it('keeps board kind separate from pace and blocks a category board until two categories are selected', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  const huroof = screen.getByRole('radio', { name: 'الحروف' });
  const categories = screen.getByRole('radio', { name: 'الفئات' });
  expect(huroof).toHaveAttribute('aria-checked', 'true');
  expect(huroof).toHaveAttribute('aria-describedby', 'setup-kind-huroof-description');
  expect(screen.getByText('إجابات تبدأ بحرف الخلية')).toBeVisible();
  expect(screen.getByText('أسئلة من الفئات التي تختارها')).toBeVisible();
  expect(screen.getByRole('radio', { name: 'كلاسيكية' })).toHaveAttribute('aria-checked', 'true');

  huroof.focus();
  await user.keyboard('{ArrowLeft}');
  expect(categories).toHaveFocus();
  expect(categories).toHaveAttribute('aria-checked', 'true');
  await user.click(screen.getByTestId('create-room'));
  expect(screen.getByText('لإنشاء لعبة الفئات، اختر فئتين مختلفتين على الأقل من الفئات المختارة.')).toBeVisible();
  expect(screen.getByRole('searchbox', { name: 'تصفية الفئات' })).toHaveFocus();
});

it('seeds a supported category-board URL and keeps its selected categories', () => {
  render(<ThemeProvider><MemoryRouter initialEntries={['/host/new?kind=categories&mode=fast&category=tahadani-006&category=tahadani-007']}><HostNewRoute /></MemoryRouter></ThemeProvider>);
  expect(screen.getByRole('radio', { name: 'الفئات' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('radio', { name: 'سريعة' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('button', { name: /معلومات عامة/, pressed: true })).toBeVisible();
  expect(screen.getByRole('button', { name: /عالم الحيوان/, pressed: true })).toBeVisible();
});

it('restores valid editable setup settings from a shared URL', () => {
  render(<ThemeProvider><MemoryRouter initialEntries={['/host/new?kind=categories&mode=custom&category=tahadani-006&category=tahadani-007&horizontal=فريق%20أ&vertical=فريق%20ب&questionSeconds=35&opponentSeconds=15&demo=0']}><HostNewRoute /></MemoryRouter></ThemeProvider>);
  expect(screen.getByLabelText('اسم الفريق الأحمر ↔ الأحمر')).toHaveValue('فريق أ');
  expect(screen.getByLabelText('اسم الفريق الأخضر ↕ الأخضر')).toHaveValue('فريق ب');
  expect(screen.getByLabelText('وقت السؤال')).toHaveValue(35);
  expect(screen.getByLabelText('فرصة الخصم')).toHaveValue(15);
  expect(screen.getByRole('checkbox', { name: /استخدم مسودات تجريبية/ })).not.toBeChecked();
});

it('seeds only supported mode and category queries once, preserving query order and user edits', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter initialEntries={['/host/new?mode=custom&category=tahadani-007&category=tahadani-006&category=tahadani-007']}><HostNewRoute /></MemoryRouter></ThemeProvider>);
  expect(screen.getByRole('radio', { name: 'مخصصة' })).toHaveAttribute('aria-checked', 'true');
  const first = screen.getByRole('button', { name: /معلومات عامة/, pressed: true });
  const second = screen.getByRole('button', { name: /عالم الحيوان/, pressed: true });
  expect(second).toHaveAttribute('aria-pressed', 'true');
  expect(first).toHaveAttribute('aria-pressed', 'true');
  await user.click(screen.getByRole('radio', { name: 'سريعة' }));
  await user.click(first);
  expect(screen.getByRole('radio', { name: 'سريعة' })).toHaveAttribute('aria-checked', 'true');
  expect(first).toHaveAttribute('aria-pressed', 'false');
});

it('falls back safely when setup query values are unsupported', () => {
  render(<ThemeProvider><MemoryRouter initialEntries={['/host/new?mode=unknown&category=missing&category=tahadani-001&category=tahadani-006']}><HostNewRoute /></MemoryRouter></ThemeProvider>);
  expect(screen.getByRole('radio', { name: 'كلاسيكية' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByTestId('setup-query-notice')).toHaveTextContent('تجاهلنا اختيارات غير مدعومة');
  expect(screen.getByRole('button', { name: /معلومات عامة/, pressed: true })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('button', { name: /من أنا \/ دول/, pressed: true })).not.toBeInTheDocument();
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
