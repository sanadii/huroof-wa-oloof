import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../src/app/ThemeProvider';
import { HostNewRoute, QuestionsRoute } from '../../src/routes/GameRoutes';

afterEach(() => vi.restoreAllMocks());

it('keeps imported category covers neutral and selection is explicit', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  await waitFor(() => expect(document.title).toBe('إنشاء مباراة | استوديو الحروف'));
  const category = screen.getAllByRole('button', { pressed: false })[0];
  await user.click(category);
  expect(category).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText(/حقوق النشر غير مؤكدة/)).toBeVisible();
});

it('uses the fixed Arabic match rule and does not expose a best-of selector', async () => {
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  expect(screen.getAllByText('تنتهي المباراة بفوز فريق بجولتين متتاليتين أو بثلاث جولات إجمالاً')).toHaveLength(2);
  expect(screen.queryByRole('radiogroup', { name: 'عدد الجولات' })).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain('الأفضل من');
});

it('filters local inventory by review status, use count, and objections', async () => {
  const user = userEvent.setup();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([
    { id: 'used-objection', targetLetter: 'أ', headerAr: 'سؤال مع اعتراض', status: 'draft', useCount: 2, objectionCount: 1 },
    { id: 'unused', targetLetter: 'ب', headerAr: 'سؤال هادئ', status: 'approved', useCount: 0, objectionCount: 0 },
  ]), { status: 200 }));
  render(<ThemeProvider><MemoryRouter initialEntries={['/questions']}><QuestionsRoute /></MemoryRouter></ThemeProvider>);
  await screen.findByText('سؤال مع اعتراض');
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
