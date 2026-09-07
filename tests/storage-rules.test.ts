import { deleteApp, initializeApp } from 'firebase/app';
import { connectStorageEmulator, getStorage, listAll, ref, uploadBytes } from 'firebase/storage';
import assert from 'node:assert/strict';

const projectId = 'demo-huroof-wa-oloof';
const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199';
const [hostname, portText] = host.split(':');

function createStorage(name: string, uid?: string) {
  const app = initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` }, name);
  const storage = getStorage(app);
  connectStorageEmulator(storage, hostname, Number(portText), uid ? { mockUserToken: { sub: uid, user_id: uid, adminRoles: ['super_admin'] } } : undefined);
  return { app, storage };
}

async function expectDenied(operation: Promise<unknown>) {
  await assert.rejects(operation, (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'storage/unauthorized',
  );
}

const anonymous = createStorage('storage-rules-anonymous');
const claimedAdmin = createStorage('storage-rules-claimed-admin', 'admin-uid');

try {
  await expectDenied(listAll(ref(anonymous.storage, 'admin-question-media')));
  await expectDenied(uploadBytes(ref(anonymous.storage, 'admin-question-media/anonymous.txt'), new TextEncoder().encode('denied')));
  await expectDenied(listAll(ref(claimedAdmin.storage, 'admin-question-media')));
  await expectDenied(uploadBytes(ref(claimedAdmin.storage, 'admin-question-media/admin.txt'), new TextEncoder().encode('denied')));
} finally {
  await Promise.all([deleteApp(anonymous.app), deleteApp(claimedAdmin.app)]);
}
