import type { GameIntent, GameRuntimeAdapter, ProjectionEnvelope } from './contracts';

/** Deterministic local fallback. It never pretends to be multiplayer authority. */
export class FixtureGameAdapter implements GameRuntimeAdapter {
  readonly kind = 'fixture' as const;
  private revision = 0;

  async createRoom() {
    this.revision += 1;
    return { roomId: 'fixture-room', roomCode: 'FIXTURE1', revision: this.revision };
  }

  async joinRoom() {
    this.revision += 1;
    return { roomId: 'fixture-room', revision: this.revision };
  }

  async submitGameIntent(_roomId: string, intent: GameIntent) {
    if (intent.expectedRevision !== this.revision) throw new Error('stale fixture intent');
    this.revision += 1;
    return { revision: this.revision, replayed: false };
  }

  subscribeProjection(_roomId: string, role: 'host' | 'player' | 'audience', uid: string, onProjection: (value: ProjectionEnvelope) => void) {
    onProjection({
      roomId: 'fixture-room', revision: this.revision, serverTime: new Date(0).toISOString(), role,
      projection: { room: { roomCode: 'FIXTURE1', state: 'LOBBY', readyCount: 0, memberCount: 1 }, self: role === 'audience' ? undefined : { uid, ready: false, canBuzz: false } },
    });
    return () => undefined;
  }
}
