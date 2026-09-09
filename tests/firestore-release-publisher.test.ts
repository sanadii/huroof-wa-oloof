import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { buildFirestoreReleasePlan, canonicalApprovedJsonl, type FirestoreReleasePlan, type ReleaseDocument } from '../scripts/build-firestore-release.js';
import { activateProductionRelease, assertProductionTarget, assertVerificationReceipt, auditProductionRelease, chunkReleaseDocuments, prepareProductionRelease, reviewNonceClaimDocuments, rollbackProductionRelease, verificationReceipt, verifyPreparedProductionRelease, type ActivationRequest, type FirestorePublicationAdapter, type RollbackRequest } from '../scripts/firestore-release-publisher.js';
import { canonicalJson } from '../scripts/firestore-release-canonical.js';
import type { Question } from '../src/question-bank.js';

const root = process.cwd();
const categories = JSON.parse(await readFile(join(root, 'content/categories/categories.json'), 'utf8'));
const equal = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
function question(id = 'q-publisher-test'): Question { return { id, schemaVersion: 1, locale: 'ar-KW', categoryId: 'tahadani-006', targetLetter: 'ج', headerAr: 'اختبار', promptAr: 'ما الاسم العربي لجزء النبات الذي يثبت النبات في التربة؟', canonicalAnswer: 'جذر', acceptedAnswers: ['جذر'], acceptDefiniteArticle: true, difficulty: 'easy', questionType: 'text', explanationAr: null, sources: [{ title: 'مصدر', publisher: 'ناشر', url: 'https://example.org/a', accessedAt: '2026-09-03' }], temporal: { kind: 'stable', verifiedAt: '2026-09-03', validUntil: null }, media: null, status: 'approved', authoring: { method: 'human', model: null, createdAt: '2026-09-03T00:00:00Z' }, review: { factReviewer: 'reviewer', languageReviewer: 'reviewer', reviewedAt: '2026-09-03', notes: null } }; }
async function planFor(id = 'q-publisher-test'): Promise<{ folder: string; plan: FirestoreReleasePlan }> {
  const folder = join(tmpdir(), `huroof-publisher-${Date.now()}-${Math.random()}`); await mkdir(folder); const item = question(id); const canonical = canonicalApprovedJsonl(JSON.stringify(item));
  const hash = createHash('sha256').update(canonical).digest('hex'); const paths = { approvedPath: join(folder, 'approved.jsonl'), manifestPath: join(folder, 'manifest.json'), categoriesPath: join(folder, 'categories.json') };
  await Promise.all([writeFile(paths.approvedPath, JSON.stringify(item)), writeFile(paths.manifestPath, JSON.stringify({ schemaVersion: 1, approvedQuestionCount: 1, approvedBankSha256: hash })), writeFile(paths.categoriesPath, JSON.stringify(categories))]);
  return { folder, plan: await buildFirestoreReleasePlan(paths) };
}

class FakeAdapter implements FirestorePublicationAdapter {
  readonly docs = new Map<string, Record<string, unknown>>(); readonly batches: number[] = []; corruptNextCreate = false;
  async getProjectId() { return 'huroof-a3ee7'; }
  async getDatabaseMetadata() { return { locationId: 'me-central2', type: 'FIRESTORE_NATIVE' }; }
  async read(paths: string[]) { return paths.map((path) => ({ path, exists: this.docs.has(path), data: this.docs.get(path) })); }
  async listPrefix(prefix: string) {
    if (prefix === 'releases/') return [...this.docs.entries()].filter(([path]) => /^releases\/[^/]+$/.test(path)).map(([path, data]) => ({ path, exists: true, data }));
    const root = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix; return [...this.docs.entries()].filter(([path]) => path === root || path.startsWith(prefix)).map(([path, data]) => ({ path, exists: true, data }));
  }
  async claimReviewNonceClaims(documents: ReleaseDocument[]) {
    const existing = documents.map((document) => this.docs.get(document.path));
    for (let index = 0; index < documents.length; index += 1)
      if (existing[index] && !equal(existing[index], documents[index].data)) throw new Error(`Review-nonce claim already belongs to another release: ${documents[index].path}`);
    for (let index = 0; index < documents.length; index += 1)
      if (!existing[index]) this.docs.set(documents[index].path, structuredClone(documents[index].data));
  }
  async create(documents: ReleaseDocument[]) {
    this.batches.push(documents.length); for (const document of documents) { if (this.docs.has(document.path)) throw new Error(`already exists: ${document.path}`); this.docs.set(document.path, this.corruptNextCreate ? { corrupt: true } : structuredClone(document.data)); } this.corruptNextCreate = false;
  }
  async activate(request: ActivationRequest) {
    if (!equal(this.docs.get(request.releaseRoot.path), request.releaseRoot.data) || !equal(this.docs.get(request.publicationReceipt.path), request.publicationReceipt.data)) throw new Error('missing verified release');
    if (!equal(this.docs.get(request.verificationReceipt.path), request.verificationReceipt.data)) throw new Error('missing verification barrier');
    const pointer = this.docs.get('runtime/activeRelease')?.releaseId ?? null;
    if (pointer !== request.expectedPreviousReleaseId) throw new Error('CAS mismatch');
    if (this.docs.has(request.activationReceipt.path)) throw new Error('activation receipt exists');
    if (this.docs.has(request.verificationUseReceipt.path)) throw new Error('verification barrier was already used');
    this.docs.set(request.verificationUseReceipt.path, structuredClone(request.verificationUseReceipt.data)); this.docs.set(request.activationReceipt.path, structuredClone(request.activationReceipt.data)); this.docs.set(request.activeRelease.path, structuredClone(request.activeRelease.data));
  }
  async rollback(request: RollbackRequest) {
    if (this.docs.get('runtime/activeRelease')?.releaseId !== request.expectedActiveReleaseId) throw new Error('CAS mismatch');
    if (this.docs.has(request.rollbackReceipt.path)) throw new Error('immutable rollback receipt exists');
    if (request.restoreReleaseId) this.docs.set('runtime/activeRelease', structuredClone(request.activeRelease!.data)); else this.docs.delete('runtime/activeRelease');
    this.docs.set(request.rollbackReceipt.path, structuredClone(request.rollbackReceipt.data));
  }
}

test('production guards reject anything except the exact cloud target and no emulator', () => {
  const valid = { project: 'huroof-a3ee7', database: '(default)', location: 'me-central2' };
  assert.doesNotThrow(() => assertProductionTarget(valid, {}));
  assert.throws(() => assertProductionTarget({ ...valid, project: 'other' }, {}), /--project/i);
  assert.throws(() => assertProductionTarget(valid, { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }), /emulator/i);
});

test('chunking honors 399/400/401 documents and byte caps', () => {
  const documents = (count: number) => Array.from({ length: count }, (_, index) => ({ path: `x/${index}`, data: { index } }));
  assert.deepEqual(chunkReleaseDocuments(documents(399)).map((chunk) => chunk.length), [399]);
  assert.deepEqual(chunkReleaseDocuments(documents(400)).map((chunk) => chunk.length), [400]);
  assert.deepEqual(chunkReleaseDocuments(documents(401)).map((chunk) => chunk.length), [400, 1]);
  const byteDocuments = [{ path: 'x/a', data: { value: 'x'.repeat(50) } }, { path: 'x/b', data: { value: 'x'.repeat(50) } }];
  assert.deepEqual(chunkReleaseDocuments(byteDocuments, 400, 100).map((chunk) => chunk.length), [1, 1]);
  assert.throws(() => chunkReleaseDocuments([{ path: 'x/huge', data: { value: 'x'.repeat(200) } }], 400, 100), /exceeds/i);
});

test('prepare is resumable for equal documents, preserves catalog entries, and writes a receipt', async () => {
  const fixture = await planFor(); const adapter = new FakeAdapter();
  try {
    const first = await prepareProductionRelease(fixture.plan, adapter); assert.ok(first.created > 1); assert.ok(adapter.docs.has('catalogCategories/tahadani-006')); assert.ok(adapter.docs.has(first.receipt.path));
    const second = await prepareProductionRelease(fixture.plan, adapter); assert.equal(second.created, 0); assert.equal(second.skipped, fixture.plan.documents.length);
  } finally { await rm(fixture.folder, { recursive: true, force: true }); }
});

test('prepare aborts conflicts before writes and readback detects a corrupt batch', async () => {
  const fixture = await planFor(); const conflict = new FakeAdapter(); const corrupt = new FakeAdapter();
  try {
    const path = fixture.plan.documents[0].path; conflict.docs.set(path, { changed: true });
    await assert.rejects(prepareProductionRelease(fixture.plan, conflict), /conflict/i); assert.equal(conflict.docs.has('runtime/activeRelease'), false); assert.equal(conflict.batches.length, 0);
    corrupt.corruptNextCreate = true; await assert.rejects(prepareProductionRelease(fixture.plan, corrupt), /readback/i);
  } finally { await rm(fixture.folder, { recursive: true, force: true }); }
});

test('verification barriers require the exact object shape, not merely matching expected values', async () => {
  const fixture = await planFor();
  try {
    const now = new Date('2026-09-04T12:00:00.000Z'); const receipt = verificationReceipt(fixture.plan, now);
    assert.doesNotThrow(() => assertVerificationReceipt(fixture.plan, receipt, now));
    assert.throws(() => assertVerificationReceipt(fixture.plan, { ...receipt, data: { ...receipt.data, unexpected: true } }, now), /barrier/i);
    const missingImmutable = { ...receipt.data }; delete missingImmutable.immutable;
    assert.throws(() => assertVerificationReceipt(fixture.plan, { ...receipt, data: missingImmutable }, now), /barrier/i);
  } finally { await rm(fixture.folder, { recursive: true, force: true }); }
});

test('authenticated review-nonce commitments reject cross-release replay through prepare and remain required for verify', async () => {
  const [first, second] = await Promise.all([planFor('q-nonce-first'), planFor('q-nonce-second')]); const adapter = new FakeAdapter();
  const nonceCommitment = createHash('sha256').update('authenticated-review-nonce').digest('hex');
  const firstPlan = { ...first.plan, reviewNonceClaimHashes: [nonceCommitment] };
  const secondPlan = { ...second.plan, reviewNonceClaimHashes: [nonceCommitment] };
  try {
    await prepareProductionRelease(firstPlan, adapter);
    const [claim] = reviewNonceClaimDocuments(firstPlan);
    assert.equal(JSON.stringify(claim.data).includes('authenticated-review-nonce'), false);
    await assert.rejects(prepareProductionRelease(secondPlan, adapter), /nonce.*another release/i);
    adapter.docs.delete(claim.path);
    await assert.rejects(verifyPreparedProductionRelease(firstPlan, adapter), /readback/i);
  } finally { await Promise.all([rm(first.folder, { recursive: true, force: true }), rm(second.folder, { recursive: true, force: true })]); }
});

test('activation requires a fresh exact verification barrier, consumes it once, and compare-and-swaps the active pointer', async () => {
  const fixture = await planFor(); const adapter = new FakeAdapter();
  try {
    await prepareProductionRelease(fixture.plan, adapter);
    await assert.rejects(activateProductionRelease(fixture.plan, adapter, null, 'CHG-missing', { path: 'releaseVerificationReceipts/missing', data: {} }), /barrier/i);
    const barrier = await verifyPreparedProductionRelease(fixture.plan, adapter);
    await activateProductionRelease(fixture.plan, adapter, null, 'CHG-123', barrier);
    assert.equal(adapter.docs.get('runtime/activeRelease')?.releaseId, fixture.plan.releaseId); assert.ok([...adapter.docs.keys()].some((path) => path.startsWith(`activationReceipts/${fixture.plan.releaseId}-`)));
    await assert.rejects(activateProductionRelease(fixture.plan, adapter, null, 'CHG-124', barrier), /barrier.*used|CAS/i);
  } finally { await rm(fixture.folder, { recursive: true, force: true }); }
});

test('audit enumerates exact stored release documents and CAS rollback-to-none records an immutable receipt', async () => {
  const fixture = await planFor(); const adapter = new FakeAdapter();
  try {
    await prepareProductionRelease(fixture.plan, adapter); const clean = await auditProductionRelease(fixture.plan, adapter); assert.deepEqual(clean.missing, []); assert.deepEqual(clean.extra, []); assert.deepEqual(clean.mismatched, []);
    adapter.docs.set(`releases/${fixture.plan.releaseId}/questions/unexpected`, { bad: true }); assert.deepEqual((await auditProductionRelease(fixture.plan, adapter)).extra, [`releases/${fixture.plan.releaseId}/questions/unexpected`]); adapter.docs.delete(`releases/${fixture.plan.releaseId}/questions/unexpected`);
    const barrier = await verifyPreparedProductionRelease(fixture.plan, adapter); await activateProductionRelease(fixture.plan, adapter, null, 'CHG-rollback', barrier); await rollbackProductionRelease(fixture.plan, null, adapter, 'CHG-rollback-none'); assert.equal(adapter.docs.has('runtime/activeRelease'), false); assert.ok([...adapter.docs.keys()].some((path) => path.startsWith(`rollbackReceipts/${fixture.plan.releaseId}-`)));
  } finally { await rm(fixture.folder, { recursive: true, force: true }); }
});

test('publisher rechecks recursive authoring-only evidence exclusion before any Firestore work', async () => {
  const fixture = await planFor(); const adapter = new FakeAdapter();
  try {
    const poisoned: FirestoreReleasePlan = { ...fixture.plan, documents: fixture.plan.documents.map((document, index) => index === 0 ? { ...document, data: { ...document.data, nested: { responseBody: { sha256: 'a'.repeat(64) } } } } : document) };
    await assert.rejects(prepareProductionRelease(poisoned, adapter), /evidence-body field/i);
    assert.equal(adapter.batches.length, 0);
  } finally { await rm(fixture.folder, { recursive: true, force: true }); }
});
