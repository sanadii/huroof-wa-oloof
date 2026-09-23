import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { createFirebaseE2EConfig, firebaseE2EPorts } from '../scripts/test-firebase-e2e.js';

test('Firebase E2E config isolates every emulator port and resolves local rule paths', () => {
  const root = 'D:/projects/huroof_wa_oloof';
  const config = createFirebaseE2EConfig(root, { hosting: { public: 'dist' } }, `${root}/output/firebase-e2e-test`) as {
    firestore: { rules: string; indexes: string };
    storage: { rules: string };
    functions: Array<{ source: string; codebase: string }>;
    emulators: Record<string, { port?: number; enabled?: boolean }>;
  };

  assert.equal(config.firestore.rules, resolve(root, 'firestore.rules'));
  assert.equal(config.firestore.indexes, resolve(root, 'firestore.indexes.json'));
  assert.equal(config.storage.rules, resolve(root, 'storage.rules'));
  assert.deepEqual(config.functions, [{ source: '../../functions', codebase: 'default' }]);
  assert.equal(config.emulators.auth.port, firebaseE2EPorts.auth);
  assert.equal(config.emulators.firestore.port, firebaseE2EPorts.firestore);
  assert.equal(config.emulators.functions.port, firebaseE2EPorts.functions);
  assert.equal(config.emulators.storage.port, firebaseE2EPorts.storage);
  assert.equal(config.emulators.hub.port, firebaseE2EPorts.hub);
  assert.equal(config.emulators.logging.port, firebaseE2EPorts.logging);
  assert.equal(config.emulators.ui.enabled, false);
});
