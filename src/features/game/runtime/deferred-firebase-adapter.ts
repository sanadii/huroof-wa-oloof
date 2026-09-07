import type { ClientRole, CreateRoomRequest, GameIntent, GameRuntimeAdapter, JoinRoomRequest, ProjectionEnvelope, SafeProjection } from './contracts.js';

/** Loads Firebase only when a Firebase-configured route first needs it. */
export class DeferredFirebaseGameAdapter implements GameRuntimeAdapter {
  readonly kind = 'firebase' as const;
  private adapterPromise: Promise<GameRuntimeAdapter> | undefined;

  constructor(private readonly loadAdapter: () => Promise<GameRuntimeAdapter> = () => import('./firebase-game-adapter.js').then(({ FirebaseGameAdapter }) => new FirebaseGameAdapter())) {}

  private adapter() {
    this.adapterPromise ??= this.loadAdapter();
    return this.adapterPromise;
  }

  createRoom(request: CreateRoomRequest) { return this.adapter().then((adapter) => adapter.createRoom(request)); }
  joinRoom(request: JoinRoomRequest) { return this.adapter().then((adapter) => adapter.joinRoom(request)); }
  joinAudience(roomCode: string) { return this.adapter().then((adapter) => adapter.joinAudience?.(roomCode) ?? Promise.reject(new Error('انضمام الجمهور غير متاح حالياً.'))); }
  syncDeadline(roomId: string) { return this.adapter().then((adapter) => adapter.syncDeadline?.(roomId) ?? Promise.resolve({ revision: 0, expired: false })); }
  submitGameIntent(roomId: string, intent: GameIntent) { return this.adapter().then((adapter) => adapter.submitGameIntent(roomId, intent)); }
  subscribeProjection(roomId: string, role: ClientRole, uid: string, onProjection: (value: ProjectionEnvelope<SafeProjection>) => void, onError?: (error: Error) => void) {
    let stopped = false;
    let unsubscribe: () => void = () => undefined;
    void this.adapter().then((adapter) => {
      if (stopped) return;
      unsubscribe = adapter.subscribeProjection(roomId, role, uid, onProjection, onError);
    }).catch((error) => { if (!stopped) onError?.(error instanceof Error ? error : new Error('تعذر الاتصال بالغرفة.')); });
    return () => { stopped = true; unsubscribe(); };
  }
}
