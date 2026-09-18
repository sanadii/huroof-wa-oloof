import assert from 'node:assert/strict';
import test from 'node:test';
import { DeferredFirebaseGameAdapter } from '../../src/features/game/runtime/deferred-firebase-adapter.js';
import type { GameRuntimeAdapter } from '../../src/features/game/runtime/contracts.js';

test('unsubscribing before the Firebase adapter chunk resolves never opens a projection subscription', async () => {
  let resolveAdapter: (adapter: GameRuntimeAdapter) => void = () => undefined;
  const pending = new Promise<GameRuntimeAdapter>((resolve) => { resolveAdapter = resolve; });
  let subscribed = false;
  const subscribeProjection = () => { subscribed = true; return () => undefined; };
  const adapter = new DeferredFirebaseGameAdapter(() => pending);

  const stop = adapter.subscribeProjection('room-1', 'player', 'player-1', () => undefined);
  stop();
  resolveAdapter({ kind: 'firebase', createRoom: async () => ({ roomId: '', roomCode: '', revision: 0 }), joinRoom: async () => ({ roomId: '', revision: 0 }), submitGameIntent: async () => ({ revision: 0, replayed: false }), subscribeProjection } as GameRuntimeAdapter);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(subscribed, false);
});

test('approved release catalog discovery forwards through the deferred Firebase boundary', async () => {
  const expected = {
    releaseId: 'release-approved', releaseRootSha256: 'a'.repeat(64), demoFixture: false,
    categories: [{ id: 'category-a', labelAr: 'فئة أ', playable: { huroof: true, categories: false, charades: false } }], boardCapabilities: { huroof: true, categories: false, charades: false },
  };
  const adapter = new DeferredFirebaseGameAdapter(async () => ({
    kind: 'firebase', createRoom: async () => ({ roomId: '', roomCode: '', revision: 0 }),
    getApprovedReleaseCatalog: async () => expected,
    joinRoom: async () => ({ roomId: '', revision: 0 }), submitGameIntent: async () => ({ revision: 0, replayed: false }), subscribeProjection: () => () => undefined,
  }));
  assert.deepEqual(await adapter.getApprovedReleaseCatalog(), expected);
});
