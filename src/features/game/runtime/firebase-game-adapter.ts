import { httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';
import { getOptionalFirebaseClient, signInAnonymouslyIfNeeded } from '../../../lib/firebase/client';
import type { ClientRole, CreateRoomRequest, GameIntent, GameRuntimeAdapter, JoinRoomRequest, ProjectionEnvelope } from './contracts';

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

  subscribeProjection(roomId: string, role: ClientRole, uid: string, onProjection: (value: ProjectionEnvelope) => void, onError?: (error: Error) => void) {
    let cancelled = false; let unsubscribe: (() => void) | undefined;
    void (async () => {
      try {
        const client = configuredClient();
        const projectionId = await projectionIdAfterAuth(client.auth, role, uid);
        if (cancelled) return;
        unsubscribe = onSnapshot(doc(client.firestore, 'rooms', roomId, 'projections', projectionId), (snapshot) => {
          if (snapshot.exists()) onProjection(snapshot.data() as ProjectionEnvelope);
          else onError?.(new Error('ROOM_PROJECTION_MISSING'));
        }, (error) => onError?.(error));
      } catch (error) { if (!cancelled) onError?.(error instanceof Error ? error : new Error(String(error))); }
    })();
    return () => { cancelled = true; unsubscribe?.(); };
  }
}
