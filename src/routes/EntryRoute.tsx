import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { gameRuntime } from '../features/game/runtime';
import { HomeSurface } from './HomeSurface';

export function normalizeRoomCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

export function EntryRoute() {
  useEffect(() => { document.title = 'الدخول | استوديو الحروف'; }, []);
  const [search] = useSearchParams();
  const [roomCode, setRoomCode] = useState(() => normalizeRoomCode(search.get('room') ?? ''));
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [roomCodeError, setRoomCodeError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function joinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roomCode) {
      setRoomCodeError('أدخل رمز الغرفة أولاً.');
      return;
    }
    setRoomCodeError('');
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
    <HomeSurface
      joinForm={
        <form className="join-form" onSubmit={joinRoom}>
          <label htmlFor="room-code">رمز الغرفة</label>
          <input
            autoCapitalize="characters"
            autoComplete="off"
            dir="ltr"
            id="room-code"
            inputMode="text"
            maxLength={8}
            aria-describedby={roomCodeError ? 'room-code-error' : undefined}
            aria-invalid={Boolean(roomCodeError)}
            onChange={(event) => {
              setRoomCode(normalizeRoomCode(event.target.value));
              if (roomCodeError) setRoomCodeError('');
            }}
            pattern="[A-Z0-9]{1,8}"
            placeholder="AB12CD34"
            spellCheck="false"
            value={roomCode}
          />
          <details className="join-form__optional-name">
            <summary>إضافة اسم اللاعب <span aria-hidden="true">(اختياري)</span></summary>
            <label htmlFor="player-name">اسم اللاعب</label>
            <input id="player-name" onChange={(event) => setName(event.target.value)} placeholder="اسمك على لوحة الفريق" value={name} />
          </details>
          <button className="button button--primary" disabled={busy} type="submit">{busy ? 'جارٍ الانضمام…' : 'انضم إلى غرفة'}</button>
        </form>
      }
      joinMessage={roomCodeError ? <p className="form-message" id="room-code-error" role="alert">{roomCodeError}</p> : message ? <p aria-live="polite" className="form-message">{message}</p> : null}
    />
  );
}
