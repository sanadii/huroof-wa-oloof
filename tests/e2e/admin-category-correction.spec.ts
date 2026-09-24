import { expect, test } from '@playwright/test';
import { deleteApp as deleteAdminApp, getApps, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';

const projectId = 'demo-huroof-wa-oloof';
const categoryId = 'correction-cat';
const releaseA = 'correction-release-a';
const releaseB = 'correction-release-b';
const rootA = 'a'.repeat(64);
const rootB = 'b'.repeat(64);

test('category correction transaction binds the active release, revision, scope, and operation receipt', async () => {
  const adminApp = initializeAdminApp({ projectId }, `correction-admin-${Date.now()}`);
  const database = getFirestore(adminApp); const adminAuth = getAdminAuth(adminApp);
  const email = `correction-${Date.now()}@example.test`; const password = 'correction-pass';
  const user = await adminAuth.createUser({ email, password, emailVerified: true });
  const releaseAData = { immutable: true, approvedCount: 1, documentRootSha256: rootA };
  const categoryAData = { labelAr: 'الفئة المنشورة' };
  await adminAuth.setCustomUserClaims(user.uid, { adminRoles: ['content_admin'], authzVersion: 1 });
  await Promise.all([
    database.doc('runtime/activeRelease').set({ releaseId: releaseA }),
    database.doc(`releases/${releaseA}`).set(releaseAData),
    database.doc(`releases/${releaseA}/catalogCategories/${categoryId}`).set(categoryAData),
    database.doc(`adminPrincipals/${user.uid}`).set({ enabled: true, identityReady: true, roles: ['content_admin'], authzVersion: 1, categoryScopes: [categoryId] }),
  ]);
  const clientApp = initializeApp({ apiKey: 'demo-api-key', authDomain: `${projectId}.firebaseapp.com`, projectId, appId: `1:1234567890:web:correction-${Date.now()}` }, `correction-client-${Date.now()}`);
  const clientAuth = getAuth(clientApp); connectAuthEmulator(clientAuth, 'http://127.0.0.1:19099', { disableWarnings: true });
  const functions = getFunctions(clientApp, 'me-central1'); connectFunctionsEmulator(functions, '127.0.0.1', 15001);
  try {
    await signInWithEmailAndPassword(clientAuth, email, password);
    const save = httpsCallable<{ categoryId: string; releaseId: string; operationId: string; expectedRevision: number; draft: { proposedLabelAr: string; internalNote: string } }, { operationId: string; revision: number; replayed: boolean }>(functions, 'adminSaveCategoryCorrection');
    const input = { categoryId, releaseId: releaseA, operationId: 'correction-op-1', expectedRevision: 0, draft: { proposedLabelAr: 'الفئة المصححة', internalNote: 'ملاحظة خاصة لا تدخل التدقيق.' } };
    const first = await save(input);
    expect(first.data).toMatchObject({ operationId: 'correction-op-1', revision: 1, replayed: false });
    const correctionRef = database.doc(`adminCategoryCorrections/${categoryId}/releases/${releaseA}`);
    const correction = await correctionRef.get();
    expect(correction.data()).toMatchObject({ categoryId, baseReleaseId: releaseA, baseReleaseRootSha256: rootA, publishedLabelAr: 'الفئة المنشورة', proposedLabelAr: 'الفئة المصححة', status: 'draft', revision: 1, authorUid: user.uid });
    expect((await correctionRef.collection('revisions').doc('00000001').get()).data()).toMatchObject({ immutable: true, revision: 1, internalNote: input.draft.internalNote });
    const operation = await database.doc('adminOperations/correction-op-1').get();
    expect(operation.data()).toMatchObject({ action: 'category.correction-draft.save', target: `${categoryId}:${releaseA}`, revision: 1, baseReleaseId: releaseA });
    expect(JSON.stringify(operation.data())).not.toContain(input.draft.internalNote);
    const audits = await database.collection('adminAudit').where('operationId', '==', 'correction-op-1').get();
    expect(audits.size).toBe(1);
    expect(JSON.stringify(audits.docs[0].data())).not.toContain(input.draft.internalNote);
    expect((await database.doc(`releases/${releaseA}`).get()).data()).toEqual(releaseAData);
    expect((await database.doc(`releases/${releaseA}/catalogCategories/${categoryId}`).get()).data()).toEqual(categoryAData);

    const replay = await save(input);
    expect(replay.data).toMatchObject({ revision: 1, replayed: true });
    await expect(save({ ...input, draft: { ...input.draft, proposedLabelAr: 'تغيير مختلف' } })).rejects.toMatchObject({ code: 'functions/already-exists' });
    await expect(save({ ...input, operationId: 'correction-op-stale', expectedRevision: 0 })).rejects.toMatchObject({ code: 'functions/aborted' });

    // principal() has already completed when rate limiting writes this document.
    // Revoking scope on that observable boundary forces the correction
    // transaction to see the live registry change (or retry after its read).
    const rateLimitRef = database.doc(`adminRateLimits/${user.uid}_${Math.floor(Date.now() / 60_000)}`);
    let sawInitialRateLimit = false; let readyForRace!: () => void; let revokeScope!: () => void;
    const rateLimitReady = new Promise<void>(resolve => { readyForRace = resolve; });
    const scopeRevoked = new Promise<void>(resolve => { revokeScope = resolve; });
    const unsubscribeRateLimit = rateLimitRef.onSnapshot(snapshot => {
      if (!sawInitialRateLimit) { sawInitialRateLimit = true; readyForRace(); return; }
      void database.doc(`adminPrincipals/${user.uid}`).update({ categoryScopes: [] }).then(() => revokeScope());
    });
    await rateLimitReady;
    const race = save({ ...input, operationId: 'correction-op-scope-race', expectedRevision: 1 });
    await scopeRevoked;
    await expect(race).rejects.toMatchObject({ code: 'functions/permission-denied' });
    unsubscribeRateLimit();
    expect((await correctionRef.get()).data()?.revision).toBe(1);
    await database.doc(`adminPrincipals/${user.uid}`).update({ categoryScopes: [categoryId] });

    let sawInitialRoleRateLimit = false; let readyForRoleRace!: () => void; let revokeRole!: () => void;
    const roleRateLimitReady = new Promise<void>(resolve => { readyForRoleRace = resolve; });
    const roleRevoked = new Promise<void>(resolve => { revokeRole = resolve; });
    const unsubscribeRoleRateLimit = rateLimitRef.onSnapshot(() => {
      if (!sawInitialRoleRateLimit) { sawInitialRoleRateLimit = true; readyForRoleRace(); return; }
      void database.doc(`adminPrincipals/${user.uid}`).update({ roles: ['viewer'] }).then(() => revokeRole());
    });
    await roleRateLimitReady;
    const roleRace = save({ ...input, operationId: 'correction-op-role-race', expectedRevision: 1 });
    await roleRevoked;
    await expect(roleRace).rejects.toMatchObject({ code: 'functions/permission-denied' });
    unsubscribeRoleRateLimit();
    expect((await correctionRef.get()).data()?.revision).toBe(1);
    await database.doc(`adminPrincipals/${user.uid}`).update({ roles: ['content_admin'] });

    await database.doc(`adminPrincipals/${user.uid}`).update({ categoryScopes: [] });
    await expect(save({ ...input, operationId: 'correction-op-out-of-scope', expectedRevision: 1 })).rejects.toMatchObject({ code: 'functions/permission-denied' });
    await database.doc(`adminPrincipals/${user.uid}`).update({ categoryScopes: [categoryId] });
    await Promise.all([
      database.doc('runtime/activeRelease').set({ releaseId: releaseB }),
      database.doc(`releases/${releaseB}`).set({ immutable: true, approvedCount: 1, documentRootSha256: rootB }),
      database.doc(`releases/${releaseB}/catalogCategories/${categoryId}`).set({ labelAr: 'فئة أساس جديدة' }),
    ]);
    await expect(save({ ...input, operationId: 'correction-op-release-changed', expectedRevision: 1 })).rejects.toMatchObject({ code: 'functions/aborted' });
    expect((await database.doc(`adminCategoryCorrections/${categoryId}/releases/${releaseB}`).get()).exists).toBe(false);
  } finally {
    await Promise.all([deleteApp(clientApp), deleteAdminApp(adminApp)]);
  }
});
