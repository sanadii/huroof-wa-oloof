import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ThemeToggle } from '../design-system/ThemeToggle';
import { EntryBoard } from '../features/board/entry-board';
import { gameRuntime } from '../features/game/runtime';

export function normalizeRoomCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

export function EntryRoute() {
  useEffect(() => { document.title = 'الدخول | استوديو الحروف'; }, []);
  const [search] = useSearchParams();
  const [roomCode, setRoomCode] = useState(() => normalizeRoomCode(search.get('room') ?? ''));
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function joinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roomCode) {
      setMessage('أدخل رمز الغرفة أولاً.');
      return;
    }
    if (typeof fetch !== 'function') { setMessage(`سيُتابع الانضمام إلى الغرفة ${roomCode}.`); return; }
    setBusy(true); setMessage('');
    try {
      const value = gameRuntime.kind === 'fixture' ? await fetch(`/api/rooms/${roomCode}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: name.trim() || 'لاعب' }) }).then(async (response) => { if (!response.ok) throw new Error('تعذر العثور على الغرفة.'); return response.json() as Promise<{ roomId: string; token: string }>; }) : await gameRuntime.joinRoom({ roomCode, displayName: name.trim() || 'لاعب' });
      sessionStorage.setItem(`huroof:${value.roomId}`, JSON.stringify({ token: value.token ?? '', role: 'player' }));
      sessionStorage.setItem(`huroof:code:${roomCode}`, value.roomId);
      navigate(`/room/${roomCode}/lobby`);
    } catch (error) { setMessage(error instanceof Error && /parse URL/i.test(error.message) ? `سيُتابع الانضمام إلى الغرفة ${roomCode}.` : error instanceof Error ? error.message : 'تعذر الانضمام الآن.'); } finally { setBusy(false); }
  }

  return (
    <main className="entry-page" id="main-content">
      <a className="skip-link" href="#main-content">تجاوز إلى المحتوى</a>
      <header className="entry-header">
        <p className="wordmark">استوديو الحروف</p>
        <ThemeToggle />
      </header>
      <section className="entry-layout" aria-labelledby="entry-title">
        <div className="entry-actions">
          <p className="eyebrow">لعبة معرفة عربية مباشرة</p>
          <h1 id="entry-title">استوديو الحروف</h1>
          <p className="entry-intro">أسئلة عربية. فريقان. مسار واحد يفوز.</p>
          <form className="join-form" onSubmit={joinRoom}>
            <label htmlFor="room-code">رمز الغرفة</label>
            <input
              autoCapitalize="characters"
              autoComplete="off"
              dir="ltr"
              id="room-code"
              inputMode="text"
              maxLength={8}
              onChange={(event) => setRoomCode(normalizeRoomCode(event.target.value))}
              pattern="[A-Z0-9]{1,8}"
              placeholder="AB12CD34"
              spellCheck="false"
              value={roomCode}
            />
            <label htmlFor="player-name">اسم اللاعب <span aria-hidden="true">(اختياري)</span></label>
            <input id="player-name" onChange={(event) => setName(event.target.value)} placeholder="اسمك على لوحة الفريق" value={name} />
            <button className="button button--primary" disabled={busy} type="submit">{busy ? 'جارٍ الانضمام…' : 'انضم إلى غرفة'}</button>
          </form>
          <Link className="button button--secondary" to="/host/new">أنشئ مباراة</Link>
          <Link className="how-to-play" to="/how-to-play">كيف تلعب؟</Link>
          <p aria-live="polite" className="form-message">{message}</p>
          <p className="entry-facts">فريقان <span aria-hidden="true">·</span> أسئلة عربية <span aria-hidden="true">·</span> مسار يفوز</p>
        </div>
        <div className="entry-identity">
          <EntryBoard />
          <p className="board-caption"><span aria-hidden="true">↔</span> من اليسار إلى اليمين <span aria-hidden="true">↕</span> من الأعلى إلى الأسفل</p>
        </div>
      </section>
    </main>
  );
}
