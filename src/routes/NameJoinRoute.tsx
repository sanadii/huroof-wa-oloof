import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ThemeToggle } from '../design-system/ThemeToggle';
import { gameRuntime } from '../features/game/runtime';
import { normalizeRoomCode, validateJoinDisplayName } from './EntryRoute';
import {
  isStaticPreviewBuild,
  staticPreviewNotice,
} from '../features/game/runtime/static-preview';

export function NameJoinRoute() {
  const { roomCode: routeRoomCode } = useParams();
  const roomCode = normalizeRoomCode(routeRoomCode ?? '');
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const nameControl = useRef<HTMLInputElement>(null);
  const staticPreview = isStaticPreviewBuild();

  useEffect(() => { document.title = 'اسم اللاعب | تحدي الخلية'; }, []);

  async function joinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (staticPreview) {
      setMessage(staticPreviewNotice);
      return;
    }
    const displayName = validateJoinDisplayName(name);
    if (!roomCode) {
      setMessage('رمز الغرفة غير صالح. غيّره ثم حاول مرة أخرى.');
      return;
    }
    if (!displayName) {
      setNameError('أدخل اسماً من حرف إلى 48 حرفاً دون رموز تحكم.');
      nameControl.current?.focus();
      return;
    }
    setNameError('');
    if (typeof fetch !== 'function') {
      setMessage(`سيُتابع الانضمام إلى الغرفة ${roomCode}.`);
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const value = gameRuntime.kind === 'fixture'
        ? await fetch(`/api/rooms/${roomCode}/join`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ displayName }),
        }).then(async (response) => {
          if (!response.ok) throw new Error(await response.text());
          return response.json() as Promise<{ roomId: string; token: string }>;
        })
        : await gameRuntime.joinRoom({ roomCode, displayName });
      sessionStorage.setItem(`huroof:${value.roomId}`, JSON.stringify({ token: value.token ?? '', role: 'player' }));
      sessionStorage.setItem(`huroof:code:${roomCode}`, value.roomId);
      navigate(`/room/${roomCode}/lobby`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : '';
      setMessage(/invalid-display-name|INVALID_DISPLAY_NAME/i.test(detail)
        ? 'أدخل اسماً صالحاً للانضمام.'
        : detail || 'تعذر الانضمام الآن.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="name-join-page" id="main-content">
      <header className="name-join-page__header">
        <Link className="name-join-page__wordmark" to="/">تحدي الخلية</Link>
        <ThemeToggle />
      </header>
      <section className="name-join-card" aria-labelledby="name-join-title">
        <p className="name-join-card__code">رمز الغرفة <bdi dir="ltr">{roomCode || '—'}</bdi></p>
        <h1 id="name-join-title">ما اسمك؟</h1>
        <p>سيظهر اسمك للمضيف.</p>
        <form noValidate onSubmit={joinRoom}>
          <label htmlFor="player-name">اسم اللاعب
            <input
              aria-label="اسم اللاعب"
              aria-describedby={nameError ? 'player-name-error' : 'player-name-help'}
              aria-invalid={Boolean(nameError)}
              autoComplete="name"
              id="player-name"
              maxLength={48}
              disabled={staticPreview}
              onChange={(event) => {
                setName(event.target.value);
                if (nameError) setNameError('');
              }}
              placeholder="اسمك على لوحة الفريق"
              ref={nameControl}
              value={name}
            />
            <small id="player-name-help">حتى 48 حرفاً</small>
          </label>
          <button className="button button--primary" disabled={busy || staticPreview} type="submit">
            {busy ? 'جارٍ الدخول…' : 'دخول الغرفة'}
          </button>
        </form>
        {staticPreview ? <p aria-live="polite" className="form-message" role="status">{staticPreviewNotice}</p> : null}
        {nameError ? <p className="form-message" id="player-name-error" role="alert">{nameError}</p> : null}
        {message ? <p aria-live="polite" className="form-message">{message}</p> : null}
        <Link className="name-join-card__back" to="/">تغيير رمز الغرفة</Link>
      </section>
    </main>
  );
}
