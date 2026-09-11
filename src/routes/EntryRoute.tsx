import { FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { HomeSurface } from './HomeSurface';
import {
  isStaticPreviewBuild,
  staticPreviewNotice,
} from '../features/game/runtime/static-preview';

export function normalizeRoomCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

export function validateJoinDisplayName(value: unknown) {
  const name = typeof value === 'string' ? value.trim() : '';
  return name && name.length <= 48 && !/\p{Cc}/u.test(name) ? name : undefined;
}

export function EntryRoute() {
  useEffect(() => { document.title = 'الرئيسية | تحدي الخلية'; }, []);
  const [search] = useSearchParams();
  const queryRoomCode = normalizeRoomCode(search.get('room') ?? '');
  const [roomCode, setRoomCode] = useState(queryRoomCode);
  const [roomCodeError, setRoomCodeError] = useState('');
  const roomCodeControl = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const staticPreview = isStaticPreviewBuild();

  useEffect(() => {
    if (queryRoomCode && !staticPreview)
      navigate(`/room/${queryRoomCode}/join`, { replace: true });
  }, [navigate, queryRoomCode, staticPreview]);

  function continueToName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (staticPreview) {
      setRoomCodeError(staticPreviewNotice);
      return;
    }
    if (!roomCode) {
      setRoomCodeError('أدخل رمز الغرفة أولاً.');
      roomCodeControl.current?.focus();
      return;
    }
    setRoomCodeError('');
    navigate(`/room/${roomCode}/join`);
  }

  return (
    <HomeSurface
      staticPreview={staticPreview}
      joinForm={
        <form className="join-form join-form--code" noValidate onSubmit={continueToName}>
          <label className="join-form__field" htmlFor="room-code">رمز الغرفة
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
              ref={roomCodeControl}
              spellCheck="false"
              value={roomCode}
            />
          </label>
          <button className="button button--primary" disabled={staticPreview} type="submit">انضم إلى غرفة</button>
        </form>
      }
      joinMessage={staticPreview ? <p className="form-message" id="static-preview-notice" role="status">{staticPreviewNotice}</p> : roomCodeError ? <p className="form-message" id="room-code-error" role="alert">{roomCodeError}</p> : null}
    />
  );
}
