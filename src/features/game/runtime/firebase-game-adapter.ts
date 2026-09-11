import { httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';
import { getOptionalFirebaseClient, signInAnonymouslyIfNeeded } from '../../../lib/firebase/client.js';
import type { ClientRole, CreateRoomRequest, GameIntent, GameRuntimeAdapter, HostPresenceSnapshot, JoinRoomRequest, ProjectionEnvelope } from './contracts.js';

const PRESENCE_SNAPSHOT_FRESHNESS_MS = 30_000;

export const acceptsFreshHostPresence = (
  startedAt: number,
  requestGeneration: number,
  currentGeneration: number,
  currentTime = performance.now(),
) =>
  requestGeneration === currentGeneration &&
  currentTime - startedAt <= PRESENCE_SNAPSHOT_FRESHNESS_MS;

/** Callable media is intentionally a small authenticated data URL, never a Storage URL. */
export function authenticatedMediaDataUrlToBlob(url: string): Blob {
  const match = /^data:(image\/(?:png|jpeg)|video\/mp4);base64,([A-Za-z0-9+/]*={0,2})$/u.exec(url);
  if (!match || match[2].length === 0 || match[2].length % 4 !== 0) throw new Error('MEDIA_INVALID_DATA_URL');
  let bytes: Uint8Array;
  try {
    const decoded = atob(match[2]);
    bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch { throw new Error('MEDIA_INVALID_DATA_URL'); }
  return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: match[1] });
}

function configuredClient() {
  const client = getOptionalFirebaseClient();
  if (!client) throw new Error('Firebase runtime is not configured; fixture mode remains active.');
  return client;
}

/** Resolves the cold Auth restore before constructing a private player document id. */
export async function projectionIdAfterAuth(auth: { authStateReady(): Promise<void>; currentUser: { uid: string } | null }, role: ClientRole, fallbackUid: string): Promise<string> {
  await auth.authStateReady();
  if (role === 'audience') return 'audience';
  if (role === 'host') return 'host';
  const uid = auth.currentUser?.uid ?? fallbackUid;
  if (!uid) throw new Error('FIREBASE_AUTH_NOT_READY');
  return `player_${uid}`;
}

export class FirebaseGameAdapter implements GameRuntimeAdapter {
  readonly kind = 'firebase' as const;

  async createRoom(request: CreateRoomRequest) {
    await signInAnonymouslyIfNeeded();
    const result = await httpsCallable<CreateRoomRequest, { roomId: string; roomCode: string; revision: number }>(configuredClient().functions, 'createRoom')(request);
    return result.data;
  }

  async joinRoom(request: JoinRoomRequest) {
    await signInAnonymouslyIfNeeded();
    const result = await httpsCallable<JoinRoomRequest, { roomId: string; revision: number }>(configuredClient().functions, 'joinRoom')(request);
    return result.data;
  }

  async submitGameIntent(roomId: string, intent: GameIntent) {
    await signInAnonymouslyIfNeeded();
    const result = await httpsCallable<{ roomId: string; intent: GameIntent }, { revision: number; replayed: boolean }>(configuredClient().functions, 'submitGameIntent')({ roomId, intent });
    return result.data;
  }

  async joinAudience(roomCode: string) {
    await signInAnonymouslyIfNeeded();
    return (await httpsCallable<{ roomCode: string }, { roomId: string; revision: number }>(configuredClient().functions, 'joinAudience')({ roomCode })).data;
  }

  async syncDeadline(roomId: string) {
    await signInAnonymouslyIfNeeded();
    return (await httpsCallable<{ roomId: string }, { revision: number; expired: boolean }>(configuredClient().functions, 'syncRoomDeadline')({ roomId })).data;
  }

  async getCurrentQuestionMedia(request: { roomId: string; mediaId: string; assetSha256: string }) {
    await signInAnonymouslyIfNeeded();
    const grant = (await httpsCallable<typeof request, { mediaId: string; assetSha256: string; url: string; expiresAt: string }>(configuredClient().functions, 'getCurrentQuestionMedia')(request)).data;
    if (grant.mediaId !== request.mediaId || grant.assetSha256 !== request.assetSha256 || !grant.url.startsWith('data:')) throw new Error('MEDIA_BINDING_MISMATCH');
    const blob = authenticatedMediaDataUrlToBlob(grant.url);
    return { ...grant, url: URL.createObjectURL(blob) };
  }

  subscribeProjection(roomId: string, role: ClientRole, uid: string, onProjection: (value: ProjectionEnvelope) => void, onError?: (error: Error) => void) {
    let cancelled = false; let unsubscribe: (() => void) | undefined;
    void (async () => {
      try {
        const client = configuredClient();
        const projectionId = await projectionIdAfterAuth(client.auth, role, uid);
        if (cancelled) return;
        unsubscribe = onSnapshot(doc(client.firestore, 'rooms', roomId, 'projections', projectionId), { includeMetadataChanges: true }, (snapshot) => {
          if (snapshot.exists()) onProjection({
            ...(snapshot.data() as ProjectionEnvelope),
            authoritative: !snapshot.metadata.fromCache,
          });
          else onError?.(new Error('ROOM_PROJECTION_MISSING'));
        }, (error) => onError?.(error));
      } catch (error) { if (!cancelled) onError?.(error instanceof Error ? error : new Error(String(error))); }
    })();
    return () => { cancelled = true; unsubscribe?.(); };
  }

  subscribeHostPresence(roomId: string, onPresence: (value: HostPresenceSnapshot) => void, onError?: (error: Error) => void) {
    let stopped = false;
    let generation = 0;
    let inFlightGeneration: number | undefined;
    const read = async () => {
      const requestGeneration = generation;
      if (stopped || inFlightGeneration === requestGeneration) return;
      inFlightGeneration = requestGeneration;
      const startedAt = performance.now();
      try {
        await signInAnonymouslyIfNeeded();
        const result = await httpsCallable<{ roomId: string }, HostPresenceSnapshot>(configuredClient().functions, 'getRoomPresence')({ roomId });
        if (!stopped && acceptsFreshHostPresence(startedAt, requestGeneration, generation))
          onPresence(result.data);
      } catch (error) {
        if (!stopped && requestGeneration === generation)
          onError?.(error instanceof Error ? error : new Error(String(error)));
      } finally {
        if (inFlightGeneration === requestGeneration) inFlightGeneration = undefined;
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), 10_000);
    const refresh = () => void read();
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    const visible = () => {
      if (document.visibilityState !== 'visible') return;
      generation += 1;
      void read();
    };
    document.addEventListener('visibilitychange', visible);
    return () => { stopped = true; window.clearInterval(timer); window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible); };
  }

  startPlayerPresence(roomId: string, onError?: (error: Error) => void) {
    let stopped = false;
    let inFlight = false;
    const renew = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        await signInAnonymouslyIfNeeded();
        await httpsCallable<{ roomId: string }, { expiresAtMs: number }>(configuredClient().functions, 'renewPresence')({ roomId });
      } catch (error) {
        if (!stopped) onError?.(error instanceof Error ? error : new Error(String(error)));
      } finally { inFlight = false; }
    };
    void renew();
    const timer = window.setInterval(() => void renew(), 15_000);
    const refresh = () => void renew();
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    const visible = () => { if (document.visibilityState === 'visible') void renew(); };
    document.addEventListener('visibilitychange', visible);
    return () => { stopped = true; window.clearInterval(timer); window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible); };
  }
}
