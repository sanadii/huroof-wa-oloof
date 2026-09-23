import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '../../src/app/ThemeProvider';
import { EntryRoute, normalizeRoomCode, validateJoinDisplayName } from '../../src/routes/EntryRoute';
import { NameJoinRoute } from '../../src/routes/NameJoinRoute';

function renderJoinJourney(initialEntry = '/') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/" element={<EntryRoute />} />
          <Route path="/room/:roomCode/join" element={<NameJoinRoute />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('EntryRoute', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('normalizes a room code to uppercase LTR ASCII before continuing to the room name step', async () => {
    const user = userEvent.setup();
    renderJoinJourney();
    expect(document.title).toBe('الرئيسية | تحدي الخلية');
    const input = screen.getByLabelText('رمز الغرفة');
    await user.type(input, 'ab-12 عرب c');
    expect(input).toHaveValue('AB12C');
    expect(input).toHaveAttribute('dir', 'ltr');
    await user.click(screen.getByRole('button', { name: 'انضم إلى غرفة' }));
    expect(await screen.findByRole('heading', { name: 'ما اسمك؟' })).toBeInTheDocument();
    expect(screen.getByText('AB12C')).toBeInTheDocument();
  });

  it('exposes deterministic normalization without accepting non-ASCII input', () => {
    expect(normalizeRoomCode('x!9-بY')).toBe('X9Y');
    expect(validateJoinDisplayName(' نور ')).toBe('نور');
    expect(validateJoinDisplayName('   ')).toBeUndefined();
    expect(validateJoinDisplayName(`نور\u0000`)).toBeUndefined();
  });

  it('marks an empty room code with an Arabic recovery message and clears it when edited', async () => {
    const user = userEvent.setup();
    renderJoinJourney();
    const input = screen.getByLabelText('رمز الغرفة');
    await user.click(screen.getByRole('button', { name: 'انضم إلى غرفة' }));
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('أدخل رمز الغرفة أولاً.');
    await user.type(input, 'ab');
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });


  it('requires a player name only after the room-code step', async () => {
    const user = userEvent.setup();
    renderJoinJourney('/room/ab12/join');
    await user.click(screen.getByRole('button', { name: 'دخول الغرفة' }));
    expect(screen.getByLabelText('اسم اللاعب')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('اسم اللاعب')).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('أدخل اسماً من حرف إلى 48 حرفاً');
  });

  it('sends a QR room query directly to the room-specific name step', async () => {
    renderJoinJourney('/?room=qr-12');
    expect(await screen.findByRole('heading', { name: 'ما اسمك؟' })).toBeInTheDocument();
    expect(screen.getByText('QR12')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'تغيير رمز الغرفة' })).toHaveAttribute('href', '/');
  });

  it('keeps the code and direct name-join paths visibly unavailable in an explicit static preview', async () => {
    vi.stubEnv('VITE_STATIC_PREVIEW', 'true');
    renderJoinJourney('/?room=qr-12');
    expect(screen.getByRole('button', { name: 'انضم إلى غرفة' })).toBeDisabled();
    expect(screen.getByText('هذه معاينة منشورة للواجهة فقط. إنشاء الغرف والانضمام وإدارة الأسئلة والبيانات غير متاحة هنا.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ما اسمك؟' })).not.toBeInTheDocument();

    renderJoinJourney('/room/qr-12/join');
    expect(await screen.findByRole('heading', { name: 'ما اسمك؟' })).toBeInTheDocument();
    expect(screen.getByLabelText('اسم اللاعب')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'دخول الغرفة' })).toBeDisabled();
  });

  it('keeps creation separate from joining and sends board selection to setup', () => {
    render(<ThemeProvider><MemoryRouter><EntryRoute /></MemoryRouter></ThemeProvider>);
    expect(Array.from(document.querySelectorAll('[data-home-region]')).map((node) => node.getAttribute('data-home-region'))).toEqual([
      'header',
      'spatial-stage',
      'create-join-dock',
      'category-chooser',
      'footer',
    ]);
    expect(screen.getByRole('region', { name: 'أنشئ مباراة جديدة' })).not.toContainElement(screen.getByLabelText('رمز الغرفة'));
    expect(screen.getByRole('region', { name: 'انضم إلى غرفة' })).toContainElement(screen.getByLabelText('رمز الغرفة'));
    expect(screen.queryByRole('radiogroup', { name: 'اختر نوع اللوح' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'أنشئ مباراة' })).toHaveAttribute('href', '/host/new');
    expect(screen.getByRole('link', { name: 'تسجيل الدخول' })).toHaveAttribute('href', '/login');
    expect(screen.queryByTestId('spatial-board-scene')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'تحدي الخلية' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /قواعد اللعب/ })).toHaveAttribute('href', '/how-to-play');
    expect(screen.getAllByRole('link', { name: /قيد الإعداد/ })).toHaveLength(8);
  });

  it('keeps category recovery keyboard-operable for the documented inventory', async () => {
    const user = userEvent.setup();
    render(<ThemeProvider><MemoryRouter><EntryRoute /></MemoryRouter></ThemeProvider>);
    expect(screen.getAllByRole('link', { name: /قيد الإعداد/ })).toHaveLength(8);
    await user.type(screen.getByRole('searchbox', { name: 'تصفية الفئات' }), 'لا تطابق');
    expect(screen.getByText('لا توجد فئات مطابقة للبحث. امسح البحث لعرض الفئات المتاحة.')).toBeInTheDocument();
  });
});
