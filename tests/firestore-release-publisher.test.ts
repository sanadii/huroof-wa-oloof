import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { buildFirestoreReleasePlan, canonicalApprovedJsonl, type FirestoreReleasePlan, type ReleaseDocument } from '../scripts/build-firestore-release.js';
import { activateProductionRelease, assertProductionTarget, chunkReleaseDocuments, prepareProductionRelease, type ActivationRequest, type FirestorePublicationAdapter } from '../scripts/firestore-release-publisher.js';
import { canonicalJson } from '../scripts/firestore-release-canonical.js';
import type { Question } from '../src/question-bank.js';

const root = process.cwd();
const categories = JSON.parse(await readFile(join(root, 'content/categories/categories.json'), 'utf8'));
const equal = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
function question(id = 'q-publisher-test'): Question { return { id, schemaVersion: 1, locale: 'ar-KW', categoryId: 'tahadani-006', targetLetter: 'ج', headerAr: 'اختبار', promptAr: 'ما الاسم العربي لجزء النبات الذي يثبت النبات في التربة؟', canonicalAnswer: 'جذر', acceptedAnswers: ['جذر'], acceptDefiniteArticle: true, difficulty: 'easy', questionType: 'text', explanationAr: null, sources: [{ title: 'مصدر', publisher: 'ناشر', url: 'https://example.org/a', accessedAt: '2026-09-03' }], temporal: { kind: 'stable', verifiedAt: '2026-09-03', validUntil: null }, media: null, status: 'approved', authoring: { method: 'human', model: null, createdAt: '2026-09-03T00:00:00Z' }, review: { factReviewer: 'reviewer', languageReviewer: 'reviewer', reviewedAt: '2026-09-03', notes: null } }; }
async function planFor(): Promise<{ folder: string; plan: FirestoreReleasePlan }> {
  const folder = join(tmpdir(), `huroof-publisher-${Date.now()}-${Math.random()}`); await mkdir(folder); const item = question(); const canonical = canonicalApprovedJsonl(JSON.stringify(item));
  const hash = createHash('sha256').update(canonical).digest('hex'); const paths = { approvedPath: join(folder, 'approved.jsonl'), manifestPath: join(folder, 'manifest.json'), categoriesPath: join(folder, 'categories.json') };
  await Promise.all([writeFile(paths.approvedPath, JSON.stringify(item)), writeFile(paths.manifestPath, JSON.stringify({ schemaVersion: 1, approvedQuestionCount: 1, approvedBankSha256: hash })), writeFile(paths.categoriesPath, JSON.stringify(categories))]);
  return { folder, plan: await buildFirestoreReleasePlan(paths) };
}

class FakeAdapter implements FirestorePublicationAdapter {
  readonly docs = new Map<string, Record<string, unknown>>(); readonly batches: number[] = []; corruptNextCreate = false;
  async getProjectId() { return 'huroof-a3ee7'; }
  async getDatabaseMetadata() { return { locationId: 'me-central2', type: 'FIRESTORE_NATIVE' }; }
  async read(paths: string[]) { return paths.map((path) => ({ path, exists: this.docs.has(path), data: this.docs.get(path) })); }
  async create(documents: ReleaseDocument[]) {
    this.batches.push(documents.length); for (const document of documents) { if (this.docs.has(document.path)) throw new Error(`already exists: ${document.path}`); this.docs.set(document.path, this.corruptNextCreate ? { corrupt: true } : structuredClone(document.data)); } this.corruptNextCreate = false;
  }
  async activate(request: ActivationRequest) {
    if (!equal(this.docs.get(request.releaseRoot.path), request.releaseRoot.data) || !equal(this.docs.get(request.publicationReceipt.path), request.publicationReceipt.data)) throw new Error('missing verified release');
    const pointer = this.docs.get('runtime/activeRelease')?.releaseId ?? null;
    if (pointer !== request.expectedPreviousReleaseId) throw new Error('CAS mismatch');
    if (this.docs.has(request.activationReceipt.path)) throw new Error('activation receipt exists');
    this.docs.set(request.activationReceipt.path, structuredClone(request.activationReceipt.data)); this.docs.set(request.activeRelease.path, structuredClone(request.activeRelease.data));
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

test('activation creates an immutable receipt and compare-and-swaps the active pointer', async () => {
  const fixture = await planFor(); const adapter = new FakeAdapter();
  try {
    await prepareProductionRelease(fixture.plan, adapter); await activateProductionRelease(fixture.plan, adapter, null, 'CHG-123');
    assert.equal(adapter.docs.get('runtime/activeRelease')?.releaseId, fixture.plan.releaseId); assert.ok([...adapter.docs.keys()].some((path) => path.startsWith(`activationReceipts/${fixture.plan.releaseId}-`)));
    await assert.rejects(activateProductionRelease(fixture.plan, adapter, null, 'CHG-124'), /CAS/i);
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
