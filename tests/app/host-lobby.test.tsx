import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { expect, it, vi } from 'vitest';
import { applyLocalIntentResponse, audienceQuestionBandVisible, canManageTeamsInState, CorrectionDialog, createGameIntentId, HostActions, HostJoinDialog, HostLobbyControls, HostPauseAction, HostVisibilityControls, isReadOnlyFixtureRoom, playerJoinUrl, shouldShowHostAnswers } from '../../src/routes/GameRoutes';


it('treats an HTTP-successful stale local intent as a failed action after refreshing its projection', () => {
  const projection = { roomId: 'room', revision: 4, serverTime: new Date().toISOString(), role: 'host' as const, projection: { room: { roomCode: 'ABC123', state: 'LOBBY', readyCount: 0, memberCount: 0 } } };
  const setProjection = vi.fn();
  expect(() => applyLocalIntentResponse({ stale: true, projection }, setProjection)).toThrow('STALE_REVISION');
  expect(setProjection).toHaveBeenCalledWith(projection);
});

it('keeps real local fallback rooms operable while preserving a synthetic fixture as read-only', () => {
  expect(isReadOnlyFixtureRoom('fixture', 'fixture-room')).toBe(true);
  expect(isReadOnlyFixtureRoom('fixture', 'local-room')).toBe(false);
  expect(isReadOnlyFixtureRoom('local', 'local-room')).toBe(false);
});

it('builds only a LAN or public player join URL and keeps active questions locked', () => {
  expect(playerJoinUrl('http://localhost:5173', 'AB12CD34')).toBeUndefined();
  expect(playerJoinUrl('http://localhost.:5173', 'AB12CD34')).toBeUndefined();
  expect(playerJoinUrl('http://[::ffff:127.0.0.1]:5173', 'AB12CD34')).toBeUndefined();
  expect(playerJoinUrl('http://[::]:5173', 'AB12CD34')).toBeUndefined();
  expect(playerJoinUrl('http://192.168.1.10:5173', 'AB12CD34')).toBe('http://192.168.1.10:5173/?room=AB12CD34');
  expect(playerJoinUrl('https://play.example.test', 'AB12CD34')).toBe('https://play.example.test/?room=AB12CD34');
  expect(canManageTeamsInState('CELL_SELECTION')).toBe(true);
  expect(canManageTeamsInState('QUESTION_READING')).toBe(false);
  expect(canManageTeamsInState('PAUSED')).toBe(false);
});

it('creates a version-4 intent ID with Web Crypto when an HTTP LAN origin lacks randomUUID', () => {
  const id = createGameIntentId({
    getRandomValues(bytes) {
      bytes.set(Array.from({ length: 16 }, (_, index) => index));
      return bytes;
    },
  });

  expect(id).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
});

it('keeps an unassigned roster member visible and assignment unavailable without a host-only ID', () => {
  render(
    <HostLobbyControls
      action={async () => undefined}
      busy={false}
      canStart={false}
      connection="connected"
      error=""
      fixture={false}
      room={{
        roomCode: 'ABC123',
        state: 'LOBBY',
        memberCount: 1,
        readyCount: 0,
        teams: { horizontal: 'الأحمر', vertical: 'الأخضر' },
        members: [{ displayName: 'لاعب قديم', ready: false, role: 'player' }],
        canStart: false,
        startBlockedReason: 'READY_TEAMS_REQUIRED',
      }}
    />,
  );

  expect(screen.getByRole('heading', { name: /غير موزعين/ })).toBeVisible();
  expect(screen.getByText('لاعب قديم')).toBeVisible();
  expect(screen.getByRole('button', { name: /لاعب قديم.*انقل إلى فريق الأحمر/ })).toBeDisabled();
  expect(screen.getByTestId('host-lobby-member-count')).toHaveTextContent('1 لاعبون منضمون');
});

it('keeps identified roster capsules unavailable while offline or busy', () => {
  const action = vi.fn().mockResolvedValue(undefined);
  const room = {
    roomCode: 'ABC123', state: 'LOBBY' as const, memberCount: 1, readyCount: 0,
    teams: { horizontal: 'الأحمر', vertical: 'الأخضر' },
    members: [{ uid: 'member-1', displayName: 'نور', ready: false, role: 'player' as const, team: 'horizontal' as const }],
    canStart: false, startBlockedReason: 'READY_TEAMS_REQUIRED',
  };
  const { rerender } = render(<HostLobbyControls action={action} busy={false} canStart={false} connection="offline" error="" fixture={false} room={room} />);
  expect(screen.getByTestId('host-player-capsule')).toBeDisabled();

  rerender(<HostLobbyControls action={action} busy canStart={false} connection="connected" error="" fixture={false} room={room} />);
  const capsule = screen.getByTestId('host-player-capsule');
  expect(capsule).toBeDisabled();
  fireEvent.click(capsule, { detail: 0 });
  expect(action).not.toHaveBeenCalled();
});

it('opens and dismisses the host QR join dialog used from the waiting room', () => {
  const onDismiss = vi.fn();
  render(<HostJoinDialog onDismiss={onDismiss} open roomCode="ABC123" />);

  expect(screen.getByRole('dialog')).toHaveAttribute('open');
  expect(screen.getByRole('heading', { name: 'امسح رمز QR للانضمام' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'إغلاق رمز الانضمام' }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

it('renders the two host visibility controls with an available local answer switch and a disabled shared setting state', () => {
  const setAnswer = vi.fn();
  const setAudienceQuestion = vi.fn();
  render(<HostVisibilityControls audienceQuestionVisible={true} disabled onAudienceQuestionChange={setAudienceQuestion} onHostAnswerChange={setAnswer} showHostAnswer={true} />);
  expect(screen.getByLabelText('إظهار الإجابة للمضيف')).toBeChecked();
  expect(screen.getByLabelText('إظهار السؤال على شاشة العرض')).toBeChecked();
  expect(screen.getByLabelText('إظهار السؤال على شاشة العرض')).toBeDisabled();
  fireEvent.click(screen.getByLabelText('إظهار الإجابة للمضيف'));
  expect(setAnswer).toHaveBeenCalledWith(false);
});

it('hides both private answer fields locally and reserves the audience question area when its shared setting is off', () => {
  const question = { headerAr: 'العنوان', promptAr: 'السؤال', primaryAnswer: 'الإجابة', acceptedAnswers: ['الإجابة', 'بديل'] };
  expect(shouldShowHostAnswers(false, question)).toBe(false);
  expect(shouldShowHostAnswers(true, question)).toBe(true);
  expect(audienceQuestionBandVisible(false, 'QUESTION_READING', 'السؤال')).toBe(false);
  expect(audienceQuestionBandVisible(true, 'QUESTION_READING', 'السؤال')).toBe(true);
  expect(audienceQuestionBandVisible(true, 'QUESTION_READING')).toBe(false);
  expect(audienceQuestionBandVisible(true, 'MATCH_COMPLETE')).toBe(true);
});

it('shows connection and lobby readiness as separate factual device statuses', () => {
  const room = {
    roomCode: 'ABC123', state: 'LOBBY' as const, memberCount: 2, readyCount: 1,
    teams: { horizontal: 'الأحمر', vertical: 'الأخضر' },
    members: [
      { uid: 'connected-player', displayName: 'نور', ready: true, role: 'player' as const, team: 'horizontal' as const },
      { uid: 'unknown-player', displayName: 'هدى', ready: false, role: 'player' as const, team: 'vertical' as const },
    ],
    canStart: false, startBlockedReason: 'READY_TEAMS_REQUIRED',
  };
  render(
    <HostLobbyControls
      action={async () => undefined}
      busy={false}
      canStart={false}
      connection="connected"
      error=""
      fixture={false}
      presence={{
        'connected-player': { state: 'connected' },
        'unknown-player': { state: 'unknown' },
      }}
      room={room}
    />,
  );

  expect(screen.getAllByText('متصل')).toHaveLength(2);
  expect(screen.getAllByText('حالة الاتصال غير معروفة')).toHaveLength(1);
  expect(screen.getByText('جاهز')).toBeVisible();
  expect(screen.getByText('بانتظار الجاهزية')).toBeVisible();
});

it('uses UID capsules for keyboard moves after a cancelled drag and restores focus after reassignment', () => {
  const action = vi.fn().mockResolvedValue(undefined);
  const room = {
    roomCode: 'ABC123', state: 'LOBBY', memberCount: 1, readyCount: 0,
    teams: { horizontal: 'الأحمر', vertical: 'الأخضر' },
    members: [{ uid: 'member-1', displayName: 'اسم طويل مكرر', ready: false, role: 'player' as const, team: 'horizontal' as const }],
    canStart: false, startBlockedReason: 'READY_TEAMS_REQUIRED',
  };
  const { rerender } = render(<HostLobbyControls action={action} busy={false} canStart={false} connection="connected" error="" fixture={false} room={room} />);
  const capsule = screen.getByTestId('host-player-capsule');
  expect(capsule).toHaveAttribute('data-member-uid', 'member-1');
  fireEvent.dragEnd(capsule);
  fireEvent.click(capsule, { detail: 0 });
  expect(action).toHaveBeenCalledWith('LOBBY_ASSIGN_TEAM', { memberUid: 'member-1', team: 'vertical' });
  rerender(<HostLobbyControls action={action} busy={false} canStart={false} connection="connected" error="" fixture={false} room={{ ...room, members: [{ ...room.members[0], team: 'vertical' }] }} />);
  expect(document.activeElement).toBe(screen.getByTestId('host-player-capsule'));
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});

it('dispatches a dragged host roster member by UID and leaves the projection unchanged on a failed assignment', async () => {
  const action = vi.fn().mockRejectedValueOnce(new Error('STALE'));
  const room = {
    roomCode: 'ABC123', state: 'LOBBY' as const, memberCount: 1, readyCount: 1,
    teams: { horizontal: 'الأحمر', vertical: 'الأخضر' },
    members: [{ uid: 'player-42', displayName: 'نور', ready: true, role: 'player' as const, team: 'horizontal' as const }],
    canStart: false, startBlockedReason: 'READY_TEAMS_REQUIRED',
  };
  const dataTransfer = {
    effectAllowed: '',
    getData: vi.fn(() => 'player-42'),
    setData: vi.fn(),
  };
  const { rerender } = render(<HostLobbyControls action={action} busy={false} canStart={false} connection="connected" error="" fixture={false} room={room} />);

  fireEvent.dragStart(screen.getByText('نور').closest('li')!, { dataTransfer });
  fireEvent.drop(screen.getByTestId('host-lobby-team-vertical'), { dataTransfer });
  expect(action).toHaveBeenCalledWith('LOBBY_ASSIGN_TEAM', { memberUid: 'player-42', team: 'vertical' });
  await Promise.resolve();
  expect(screen.getByTestId('host-lobby-team-horizontal-count')).toHaveTextContent('1');
  expect(screen.getByTestId('host-lobby-team-vertical-count')).toHaveTextContent('0');

  rerender(<HostLobbyControls action={action} busy canStart={false} connection="connected" error="" fixture={false} room={room} />);
  fireEvent.drop(screen.getByTestId('host-lobby-team-vertical'), { dataTransfer });
  rerender(<HostLobbyControls action={action} busy={false} canStart={false} connection="connected" error="" fixture={false} room={{ ...room, state: 'QUESTION_READING' }} />);
  fireEvent.drop(screen.getByTestId('host-lobby-team-vertical'), { dataTransfer });
  expect(action).toHaveBeenCalledTimes(1);
});


it('adds manual players only after validation and retains their form after an authority failure', async () => {
  const user = (await import('@testing-library/user-event')).default.setup();
  const action = vi.fn().mockResolvedValue(false);
  const room = {
    roomCode: 'ABC123', state: 'LOBBY' as const, memberCount: 1, readyCount: 1,
    teams: { horizontal: 'الأحمر', vertical: 'الأخضر' },
    members: [{ manualParticipantId: 'manual-1', participation: 'manual' as const, displayName: 'لاعب يدوي', ready: true, role: 'player' as const, team: 'horizontal' as const }],
    canStart: false, startBlockedReason: 'READY_TEAMS_REQUIRED',
  };
  render(<HostLobbyControls action={action} busy={false} canStart={false} connection="connected" error="" fixture={false} room={room} />);
  const capsule = screen.getByTestId('host-player-capsule');
  expect(capsule).toHaveAttribute('data-manual-participant-id', 'manual-1');
  expect(capsule).toHaveTextContent('بدون بازر');
  await user.click(screen.getByTestId('manual-player-toggle'));
  await user.click(screen.getByTestId('add-manual-player'));
  expect(screen.getByRole('alert')).toHaveTextContent('أدخل اسماً');
  await user.type(screen.getByTestId('manual-player-name'), 'اسم جديد');
  await user.click(screen.getByTestId('manual-player-team-vertical'));
  await user.click(screen.getByTestId('add-manual-player'));
  expect(action).toHaveBeenLastCalledWith('LOBBY_ADD_MANUAL_PLAYER', { displayName: 'اسم جديد', team: 'vertical' });
  await Promise.resolve();
  expect(screen.getByTestId('manual-player-name')).toHaveValue('اسم جديد');
  expect(screen.getByRole('alert')).toHaveTextContent('تعذر إضافة اللاعب');
});

it('opens the question and buzzer from cell selection without manual host actions and keeps pause separate', () => {
  const action = () => undefined;
  const { container } = render(
    <>
      <HostActions
        action={action}
        playerCount={2}
        state="QUESTION_READING"
        teams={{ horizontal: 'الأحمر', vertical: 'الأخضر' }}
      />
      <HostActions
        action={action}
        playerCount={2}
        state="CELL_AWARDED"
        teams={{ horizontal: 'الأحمر', vertical: 'الأخضر' }}
      />
      <HostActions
        action={action}
        playerCount={2}
        state="PATH_CHECK"
        teams={{ horizontal: 'الأحمر', vertical: 'الأخضر' }}
      />
      <HostPauseAction action={action} state="QUESTION_READING" />
    </>,
  );

  expect(screen.queryByRole('button', { name: 'افتح البازر' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'اكشف الحرف' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /ثبّت الخلية/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'تحقق من المسار' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'إيقاف مؤقت' })).toHaveClass('host-controls__pause');
  expect(container.querySelector('.control-grid .host-controls__pause')).toBeNull();
});

it('makes terminal failure a single safe replacement decision and makes exhaustion a truthful end-only hold', () => {
  const action = vi.fn();
  const teams = { horizontal: 'الأحمر', vertical: 'الأخضر' };
  const { rerender } = render(<HostActions action={action} playerCount={2} state="QUESTION_FAILED" teams={teams} />);

  expect(screen.getByRole('status')).toHaveTextContent('لن تعيد السؤال المكشوف');
  fireEvent.click(screen.getByRole('button', { name: 'متابعة واستبدال الخلية' }));
  expect(action).toHaveBeenCalledWith('RETRY_CELL');
  expect(screen.queryByRole('button', { name: 'أعد الخلية' })).not.toBeInTheDocument();

  rerender(<HostActions action={action} contentHold={{ reason: 'CONTENT_EXHAUSTED', operation: 'SELECT_CELL' }} playerCount={2} state="CELL_SELECTION" teams={teams} />);
  expect(screen.getByRole('status')).toHaveTextContent('لا تتغير ملكية الخلية');
  expect(screen.queryByRole('button', { name: 'اختر حرفًا من اللوحة' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'إنهاء المباراة بلا فائز' }));
  expect(action).toHaveBeenLastCalledWith('END_WITHOUT_WINNER');
});

it('uses category-specific selection wording without changing the Huroof host prompt', () => {
  const teams = { horizontal: 'الأحمر', vertical: 'الأخضر' };
  const { rerender } = render(<HostActions action={() => undefined} gameKind="categories" playerCount={2} state="CELL_SELECTION" teams={teams} />);
  expect(screen.getByRole('button', { name: 'اختر فئة من اللوحة' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'اختر حرفًا من اللوحة' })).not.toBeInTheDocument();

  rerender(<HostActions action={() => undefined} playerCount={2} state="CELL_SELECTION" teams={teams} />);
  expect(screen.getByRole('button', { name: 'اختر حرفًا من اللوحة' })).toBeVisible();
});

it('uses an owned correction board cell and named team controls without restoring a cell select', () => {
  const begin = vi.fn().mockResolvedValue(true);
  const triggerRef = createRef<HTMLButtonElement>();
  render(
    <>
      <button ref={triggerRef} type="button">تصحيح وسجل التدقيق</button>
      <CorrectionDialog
        audit={[]}
        cells={[{ id: 'cell-0-0', q: 0, r: 0, kind: 'letter', visibleValue: 'أ', owner: 'horizontal' }]}
        correction={undefined}
        error=""
        onBegin={begin}
        onCancel={vi.fn().mockResolvedValue(true)}
        onConfirm={vi.fn().mockResolvedValue(true)}
        onDismiss={vi.fn()}
        open
        pending={false}
        teams={{ horizontal: 'الفريق الأحمر', vertical: 'الفريق الأخضر' }}
        triggerRef={triggerRef}
      />
    </>,
  );

  expect(screen.getByTestId('correction-dialog')).toHaveAttribute('open');
  expect(screen.getByTestId('cell-0-0')).toBeEnabled();
  fireEvent.click(screen.getByTestId('cell-0-0'));
  fireEvent.click(screen.getByTestId('correction-owner-vertical'));
  fireEvent.change(screen.getByLabelText('سبب التصحيح'), { target: { value: 'نقل الملكية' } });
  fireEvent.click(screen.getByRole('button', { name: 'معاينة التصحيح' }));
  expect(begin).toHaveBeenCalledWith({ cellId: 'cell-0-0', owner: 'vertical', reason: 'نقل الملكية' });
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});
