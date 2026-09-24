import { expect, test } from '@playwright/test';
import { deleteApp as deleteAdminApp, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getFirestore as getClientFirestore, setDoc } from 'firebase/firestore';
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
    const unsubscribeRateLimit = rateLimitRef.onSnapshot(() => {
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

test('published-question inspection is release-bound, create-once, scope-checked, and inaccessible through Firestore rules', async () => {
  const adminApp = initializeAdminApp({ projectId }, `inspection-admin-${Date.now()}`);
  const database = getFirestore(adminApp); const adminAuth = getAdminAuth(adminApp);
  const suffix = Date.now(); const categoryId = `inspection-cat-${suffix}`; const releaseId = `inspection-release-${suffix}`; const root = 'c'.repeat(64);
  const first = await adminAuth.createUser({ email: `inspection-first-${suffix}@example.test`, password: 'inspection-pass', emailVerified: true });
  const second = await adminAuth.createUser({ email: `inspection-second-${suffix}@example.test`, password: 'inspection-pass', emailVerified: true });
  const questions = ['question-a', 'question-b', 'question-c'];
  await Promise.all([
    adminAuth.setCustomUserClaims(first.uid, { adminRoles: ['content_admin'], authzVersion: 1 }), adminAuth.setCustomUserClaims(second.uid, { adminRoles: ['reviewer'], authzVersion: 1 }),
    database.doc('runtime/activeRelease').set({ releaseId }), database.doc(`releases/${releaseId}`).set({ immutable: true, approvedCount: questions.length, documentRootSha256: root }), database.doc(`releases/${releaseId}/catalogCategories/${categoryId}`).set({ labelAr: 'فئة الفحص' }),
    database.doc(`adminPrincipals/${first.uid}`).set({ enabled: true, identityReady: true, roles: ['content_admin'], authzVersion: 1, categoryScopes: [categoryId] }), database.doc(`adminPrincipals/${second.uid}`).set({ enabled: true, identityReady: true, roles: ['reviewer'], authzVersion: 1, categoryScopes: [categoryId] }),
    ...questions.map((id) => database.doc(`releases/${releaseId}/questions/${id}`).set({ categoryId, modality: 'classic', headerAr: id, promptAr: `نص ${id}`, canonicalAnswer: 'جواب', acceptedAnswers: ['جواب'] })),
  ]);
  const makeClient = (name: string) => {
    const app = initializeApp({ apiKey: 'demo-api-key', authDomain: `${projectId}.firebaseapp.com`, projectId, appId: `1:1234567890:web:${name}-${suffix}` }, `inspection-${name}-${suffix}`);
    const clientAuth = getAuth(app); connectAuthEmulator(clientAuth, 'http://127.0.0.1:19099', { disableWarnings: true });
    const functions = getFunctions(app, 'me-central1'); connectFunctionsEmulator(functions, '127.0.0.1', 15001);
    const clientDb = getClientFirestore(app); connectFirestoreEmulator(clientDb, '127.0.0.1', 18080);
    return { app, clientAuth, functions, clientDb };
  };
  const firstClient = makeClient('first'); const secondClient = makeClient('second');
  try {
    await Promise.all([signInWithEmailAndPassword(firstClient.clientAuth, first.email!, 'inspection-pass'), signInWithEmailAndPassword(secondClient.clientAuth, second.email!, 'inspection-pass')]);
    const inspect = (functions: ReturnType<typeof getFunctions>, operationId: string) => httpsCallable<{ id: string; releaseId: string; operationId: string }, { operationId: string; revision: number; replayed: boolean; alreadyInspected?: boolean }>(functions, 'adminMarkPublishedQuestionInspected')({ id: 'question-b', releaseId, operationId });
    await expect(setDoc(doc(firstClient.clientDb, `adminPublishedQuestionInspections/${releaseId}/questions/question-b`), { forged: true })).rejects.toBeDefined();
    const [one, two] = await Promise.all([inspect(firstClient.functions, 'inspection-op-1'), inspect(secondClient.functions, 'inspection-op-2')]);
    expect([one.data.alreadyInspected, two.data.alreadyInspected].filter(Boolean)).toHaveLength(1);
    const marker = await database.doc(`adminPublishedQuestionInspections/${releaseId}/questions/question-b`).get();
    expect(marker.data()).toMatchObject({ releaseId, questionId: 'question-b', categoryId, releaseRootSha256: root, status: 'reviewed' });
    expect([first.uid, second.uid]).toContain(marker.data()?.reviewedByUid);
    const replay = await inspect(firstClient.functions, 'inspection-op-1'); expect(replay.data.replayed).toBe(true);
    await expect(httpsCallable<{ id: string; releaseId: string; operationId: string }, unknown>(firstClient.functions, 'adminMarkPublishedQuestionInspected')({ id: 'question-a', releaseId, operationId: 'inspection-op-1' })).rejects.toMatchObject({ code: 'functions/already-exists' });
    const detail = await httpsCallable<{ id: string; releaseId: string }, { previousQuestionId: string | null; nextQuestionId: string | null; categoryLabelAr: string; inspection: { reviewed: boolean } }>(firstClient.functions, 'adminGetPublishedQuestion')({ id: 'question-b', releaseId });
    expect(detail.data).toMatchObject({ categoryLabelAr: 'فئة الفحص', previousQuestionId: 'question-a', nextQuestionId: 'question-c', inspection: { reviewed: true } });
    await database.doc(`adminPrincipals/${first.uid}`).update({ categoryScopes: [] });
    await expect(inspect(firstClient.functions, 'inspection-op-scope-revoked')).rejects.toMatchObject({ code: 'functions/permission-denied' });
    await database.doc('runtime/activeRelease').set({ releaseId: `${releaseId}-successor` }); await database.doc(`releases/${releaseId}-successor`).set({ immutable: true, approvedCount: 0, documentRootSha256: 'd'.repeat(64) });
    await expect(inspect(secondClient.functions, 'inspection-op-release-changed')).rejects.toMatchObject({ code: 'functions/aborted' });
  } finally { await Promise.all([deleteApp(firstClient.app), deleteApp(secondClient.app), deleteAdminApp(adminApp)]); }
});
