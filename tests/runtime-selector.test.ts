import assert from 'node:assert/strict';
import test from 'node:test';
import { selectGameRuntimeKind } from '../src/features/game/runtime/runtime-selector.js';
import { acceptsFreshHostPresence, authenticatedMediaDataUrlToBlob, projectionIdAfterAuth } from '../src/features/game/runtime/firebase-game-adapter.js';

test('only explicit local runtime selects the local adapter', () => {
  assert.equal(selectGameRuntimeKind('local'), 'local');
  assert.equal(selectGameRuntimeKind(undefined), 'fixture');
  assert.equal(selectGameRuntimeKind('unknown'), 'fixture');
  assert.equal(selectGameRuntimeKind('firebase'), 'firebase');
});

test('cold Firebase auth resolves before selecting a private player projection', async () => {
  let ready = false; const auth = { currentUser: null as { uid: string } | null, async authStateReady() { ready = true; this.currentUser = { uid: 'restored-user' }; } };
  assert.equal(await projectionIdAfterAuth(auth, 'player', ''), 'player_restored-user'); assert.equal(ready, true);
});

test('a delayed or foreground-invalidated presence read cannot restore a fresh status', () => {
  assert.equal(acceptsFreshHostPresence(1_000, 4, 4, 30_999), true);
  assert.equal(acceptsFreshHostPresence(1_000, 4, 5, 1_001), false);
  assert.equal(acceptsFreshHostPresence(1_000, 4, 4, 31_001), false);
});

test('authenticated callable media decodes PNG, JPEG, and MP4 data URLs without a network fetch', async () => {
  for (const [type, bytes] of [['image/png', [137, 80, 78, 71]], ['image/jpeg', [255, 216, 255, 0]], ['video/mp4', [0, 0, 0, 8, 102, 116, 121, 112]]] as const) {
    const blob = authenticatedMediaDataUrlToBlob(`data:${type};base64,${Buffer.from(bytes).toString('base64')}`);
    assert.equal(blob.type, type); assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], bytes);
  }
  assert.throws(() => authenticatedMediaDataUrlToBlob('data:image/png;base64,bad!'), /DATA_URL/);
});
