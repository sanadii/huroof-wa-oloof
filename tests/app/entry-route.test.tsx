import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../../src/app/ThemeProvider';
import { EntryRoute, normalizeRoomCode } from '../../src/routes/EntryRoute';

describe('EntryRoute', () => {
  it('normalizes a room code to uppercase LTR ASCII and keeps the join action accessible', async () => {
    const user = userEvent.setup();
    render(<ThemeProvider><MemoryRouter><EntryRoute /></MemoryRouter></ThemeProvider>);
    expect(document.title).toBe('الدخول | استوديو الحروف');
    const input = screen.getByLabelText('رمز الغرفة');
    await user.type(input, 'ab-12 عرب c');
    expect(input).toHaveValue('AB12C');
    expect(input).toHaveAttribute('dir', 'ltr');
    await user.click(screen.getByRole('button', { name: 'انضم إلى غرفة' }));
    expect(screen.getByText('سيُتابع الانضمام إلى الغرفة AB12C.')).toBeInTheDocument();
  });

  it('exposes deterministic normalization without accepting non-ASCII input', () => {
    expect(normalizeRoomCode('x!9-بY')).toBe('X9Y');
  });

  it('marks an empty room code with an Arabic recovery message and clears it when edited', async () => {
    const user = userEvent.setup();
    render(<ThemeProvider><MemoryRouter><EntryRoute /></MemoryRouter></ThemeProvider>);
    const input = screen.getByLabelText('رمز الغرفة');
    await user.click(screen.getByRole('button', { name: 'انضم إلى غرفة' }));
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('أدخل رمز الغرفة أولاً.');
    await user.type(input, 'ab');
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('exposes the selected spatial entry journey with working mode, category, and account links', () => {
    render(<ThemeProvider><MemoryRouter><EntryRoute /></MemoryRouter></ThemeProvider>);
    expect(Array.from(document.querySelectorAll('[data-home-region]')).map((node) => node.getAttribute('data-home-region'))).toEqual([
      'header',
      'spatial-stage',
      'create-join-dock',
      'category-chooser',
      'footer',
    ]);
    expect(screen.getByRole('link', { name: /كلاسيكية/ })).toHaveAttribute('href', '/host/new?mode=classic');
    expect(screen.getByRole('link', { name: /سريعة/ })).toHaveAttribute('href', '/host/new?mode=fast');
    expect(screen.getByRole('link', { name: 'تسجيل الدخول' })).toHaveAttribute('href', '/login');
    expect(screen.getByTestId('spatial-board-scene')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /قواعد اللعب/ })).toHaveAttribute('href', '/how-to-play');
    expect(screen.getByRole('button', { name: /عرض كل الفئات/ })).toHaveTextContent('62');
  });

  it('keeps category recovery and the show-all control keyboard-operable', async () => {
    const user = userEvent.setup();
    render(<ThemeProvider><MemoryRouter><EntryRoute /></MemoryRouter></ThemeProvider>);
    await user.click(screen.getByRole('button', { name: /عرض كل الفئات/ }));
    expect(screen.getAllByRole('link', { name: /جاهزية الأسئلة|قيد الإعداد/ })).toHaveLength(62);
    await user.type(screen.getByRole('searchbox', { name: 'تصفية الفئات' }), 'لا تطابق');
    expect(screen.getByText('لا توجد فئات مطابقة للبحث. امسح البحث لعرض الفئات المتاحة.')).toBeInTheDocument();
  });
});
