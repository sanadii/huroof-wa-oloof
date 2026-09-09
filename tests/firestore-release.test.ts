import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertExactV32ProductionRelease, assertExternalV33TrustRootPath, assertFirestoreDocumentPath, assertProductionReleaseAcceptance, assertReleaseDocumentsExcludeEvidencePayload, assertUniqueReleaseDocuments, buildFirestoreReleasePlan, buildV18MediaUploadPlan, buildV18ReleaseMediaDocuments, canonicalApprovedJsonl, classifyReleaseDocuments, loadV33ProductionReleaseInput, releaseDocumentWriteMode } from '../scripts/build-firestore-release.js';
import type { Question } from '../src/question-bank.js';
import { answerConceptIdV32, validateQuestionBankV32, type CategoryPolicyV32, type QuestionV32 } from '../src/question-bank-v3.2.js';

const root = process.cwd();
const categories = JSON.parse(await readFile(join(root, 'content/categories/categories.json'), 'utf8'));
const v32Policies = JSON.parse(await readFile(join(root, 'content/question-bank-v3/v3.2/category-policies.v3.2.json'), 'utf8')) as { categories: CategoryPolicyV32[] };
const v32Question = (id: string, patch: Partial<QuestionV32> = {}): QuestionV32 => { const canonicalAnswer = 'جواب اختبار'; return { id, schemaVersion: '3.2.0', categoryId: 'tahadani-006', modality: 'classic', headerAr: 'عنوان اختبار', promptAr: `سؤال فريد للاختبار ${id}`, canonicalAnswer, acceptedAnswers: ['إجابة اختبار'], answerConceptId: answerConceptIdV32(canonicalAnswer), targetLetter: 'ا', facetId: `facet:${id}`, claimIds: [`claim:${id}`], evidencePacketIds: [`packet:${id}`], state: 'approved', ...patch }; };
const v32Metadata = (questions: QuestionV32[], dispositions: unknown[] = []) => { const report = validateQuestionBankV32({ questions, policies: v32Policies.categories, dispositions: dispositions as never }); return { report, contentHash: report.contentHash, dispositions }; };
function approvedQuestion(id = 'q-firestore-test'): Question { return { id, schemaVersion: 1, locale: 'ar-KW', categoryId: 'tahadani-006', targetLetter: 'ج', headerAr: 'اختبار', promptAr: 'ما الاسم العربي لجزء النبات الذي يثبت النبات في التربة؟', canonicalAnswer: 'جذر', acceptedAnswers: ['جذر'], acceptDefiniteArticle: true, difficulty: 'easy', questionType: 'text', explanationAr: null, sources: [{ title: 'مصدر', publisher: 'ناشر', url: 'https://example.org/a', accessedAt: '2026-09-03' }], temporal: { kind: 'stable', verifiedAt: '2026-09-03', validUntil: null }, media: null, status: 'approved', authoring: { method: 'human', model: null, createdAt: '2026-09-03T00:00:00Z' }, review: { factReviewer: 'reviewer', languageReviewer: 'reviewer', reviewedAt: '2026-09-03', notes: null } }; }
async function planFor(questions: Question[], categoriesFixture = categories) {
  const folder = join(tmpdir(), `huroof-release-${Date.now()}-${Math.random()}`); await mkdir(folder);
  const canonical = canonicalApprovedJsonl(questions.map((question) => JSON.stringify(question)).join('\n')); const crypto = await import('node:crypto');
  const paths = { approvedPath: join(folder, 'approved.jsonl'), manifestPath: join(folder, 'manifest.json'), categoriesPath: join(folder, 'categories.json') };
  await Promise.all([writeFile(paths.approvedPath, questions.map((question) => JSON.stringify(question)).join('\n')), writeFile(paths.manifestPath, JSON.stringify({ schemaVersion: 1, approvedQuestionCount: questions.length, approvedBankSha256: crypto.createHash('sha256').update(canonical).digest('hex') })), writeFile(paths.categoriesPath, JSON.stringify(categoriesFixture))]);
  return { folder, plan: await buildFirestoreReleasePlan(paths) };
}
const v33TopLevelArtifacts = ['as-of.v3.3.json', 'categories', 'evidence-bodies.v3.3.json', 'evidence.v3.3.jsonl', 'media.v3.3.jsonl', 'policies.v3.3.json', 'receipts.v3.3.jsonl', 'scope.manifest.v3.3.json', 'slots.v3.3.jsonl', 'source-policy-registry.v3.3.json', 'validation-report.v3.3.json'];
async function v33LoaderFixture() {
  const folder = join(tmpdir(), `huroof-v33-loader-${Date.now()}-${Math.random()}`); const corpus = join(folder, 'corpus'); const trustRoot = join(folder, 'trust-root.json'); await mkdir(join(corpus, 'categories'), { recursive: true });
  await Promise.all([writeFile(trustRoot, '{}'), ...v33TopLevelArtifacts.filter((name) => name !== 'categories').map((name) => writeFile(join(corpus, name), '{}'))]);
  const trustRootSha256 = (await import('node:crypto')).createHash('sha256').update('{}').digest('hex');
  return { folder, corpus, trustRoot, trustRootSha256 };
}

test('canonical JSONL sorts keys and IDs and rejects duplicate or unsafe IDs', () => {
  assert.equal(canonicalApprovedJsonl('{"id":"b","z":1,"a":2}\n{"id":"a","b":1}\n'), '{"b":1,"id":"a"}\n{"a":2,"id":"b","z":1}');
  assert.throws(() => canonicalApprovedJsonl('{"id":"a/a"}'), /path-unsafe/i);
  assert.throws(() => canonicalApprovedJsonl('{"id":"same"}\n{"id":"same"}'), /duplicate/i);
});

test('canonical trust-root containment rejects only the corpus and real descendants', () => {
  const root = 'C:\\repo\\content\\question-bank-v3\\v3.3';
  assert.throws(() => assertExternalV33TrustRootPath(root, root), /outside/i); assert.throws(() => assertExternalV33TrustRootPath(root, `${root}\\trust.json`), /outside/i);
  assert.doesNotThrow(() => assertExternalV33TrustRootPath(root, 'C:\\repo\\content\\question-bank-v3\\..evil\\trust.json')); assert.doesNotThrow(() => assertExternalV33TrustRootPath(root, 'C:\\trusted\\trust.json'));
});

test('canonical trust-root containment rejects a symlink alias into the corpus when supported', async (t) => {
  const folder = join(tmpdir(), `huroof-trust-path-${Date.now()}-${Math.random()}`); const corpus = join(folder, 'corpus'); const alias = join(folder, 'outside-alias'); await mkdir(corpus, { recursive: true });
  try {
    try { await symlink(corpus, alias, 'junction'); } catch { t.skip('Symlink/junction creation unavailable on this platform/account.'); return; }
    const [canonicalCorpus, canonicalAlias] = await Promise.all([realpath(corpus), realpath(alias)]); assert.throws(() => assertExternalV33TrustRootPath(canonicalCorpus, canonicalAlias), /outside/i);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('v3.3 production loader rejects any unexpected top-level artifact before consuming corpus content', async () => {
  const fixture = await v33LoaderFixture();
  try {
    await writeFile(join(fixture.corpus, 'candidate-counts.v3.3.json'), '{}');
    await assert.rejects(loadV33ProductionReleaseInput({ root: fixture.corpus, trustRootPath: fixture.trustRoot, trustRootSha256: fixture.trustRootSha256 }), /top-level artifact layout/i);
  } finally { await rm(fixture.folder, { recursive: true, force: true }); }
});

test('v3.3 production loader rejects top-level symlinks before consuming corpus content', async (t) => {
  const fixture = await v33LoaderFixture(); const linkedTarget = join(fixture.folder, 'linked-policies.json');
  try {
    await writeFile(linkedTarget, '{}'); await rm(join(fixture.corpus, 'policies.v3.3.json'));
    try { await symlink(linkedTarget, join(fixture.corpus, 'policies.v3.3.json'), 'file'); } catch { t.skip('Symlink creation unavailable on this platform/account.'); return; }
    await assert.rejects(loadV33ProductionReleaseInput({ root: fixture.corpus, trustRootPath: fixture.trustRoot, trustRootSha256: fixture.trustRootSha256 }), /top-level artifact layout.*link/i);
  } finally { await rm(fixture.folder, { recursive: true, force: true }); }
});

test('normal release plans fail closed on zero approved questions', async () => { await assert.rejects(buildFirestoreReleasePlan(), /zero approved/i); });

test('release plans reject manifest hash drift and unknown category membership', async () => {
  const fixture = await planFor([approvedQuestion('q-hash-drift')]);
  try {
    await writeFile(join(fixture.folder, 'manifest.json'), JSON.stringify({ schemaVersion: 1, approvedQuestionCount: 1, approvedBankSha256: '0'.repeat(64) }));
    await assert.rejects(buildFirestoreReleasePlan({ approvedPath: join(fixture.folder, 'approved.jsonl'), manifestPath: join(fixture.folder, 'manifest.json'), categoriesPath: join(fixture.folder, 'categories.json') }), /SHA-256/i);
    const unknown = { ...approvedQuestion('q-unknown-category'), categoryId: 'not-a-category' }; const canonical = canonicalApprovedJsonl(JSON.stringify(unknown)); const crypto = await import('node:crypto');
    await Promise.all([writeFile(join(fixture.folder, 'approved.jsonl'), JSON.stringify(unknown)), writeFile(join(fixture.folder, 'manifest.json'), JSON.stringify({ schemaVersion: 1, approvedQuestionCount: 1, approvedBankSha256: crypto.createHash('sha256').update(canonical).digest('hex') }))]);
    await assert.rejects(buildFirestoreReleasePlan({ approvedPath: join(fixture.folder, 'approved.jsonl'), manifestPath: join(fixture.folder, 'manifest.json'), categoriesPath: join(fixture.folder, 'categories.json') }), /unknown.*category/i);
  } finally { await rm(fixture.folder, { recursive: true, force: true }); }
});

test('release plans reject duplicate categories and every generated path is a document path', async () => {
  const duplicateCategories = { ...categories, categories: [...categories.categories, { ...categories.categories[0] }] };
  const fixture = await planFor([approvedQuestion('q-duplicate-category')]);
  try { await writeFile(join(fixture.folder, 'categories.json'), JSON.stringify(duplicateCategories)); await assert.rejects(buildFirestoreReleasePlan({ approvedPath: join(fixture.folder, 'approved.jsonl'), manifestPath: join(fixture.folder, 'manifest.json'), categoriesPath: join(fixture.folder, 'categories.json') }), /duplicate IDs/i); }
  finally { await rm(fixture.folder, { recursive: true, force: true }); }
  const valid = await planFor([approvedQuestion('q-valid-paths')]);
  try {
    assert.doesNotThrow(() => assertUniqueReleaseDocuments(valid.plan.documents));
    for (const document of valid.plan.documents) assert.doesNotThrow(() => assertFirestoreDocumentPath(document.path));
    assert.throws(() => assertFirestoreDocumentPath('catalog/categories/id'), /invalid/i);
    assert.throws(() => assertUniqueReleaseDocuments([{ path: 'catalogCategories/a', data: {} }, { path: 'catalogCategories/a', data: {} }]), /duplicate/i);
  } finally { await rm(valid.folder, { recursive: true, force: true }); }
});

test('production acceptance requires completed reviews and a hash-bound report for nonblocking warnings', () => {
  const unreviewed = { ...approvedQuestion('q-unreviewed'), review: { factReviewer: '', languageReviewer: 'language', reviewedAt: '2026-09-03', notes: null } };
  assert.throws(() => assertProductionReleaseAcceptance([unreviewed], []), /factReviewer/i);
  assert.throws(() => assertProductionReleaseAcceptance([approvedQuestion('q-warning')], [{ severity: 'warning', code: 'hard_source_review', message: 'fixture' }]), /hash-bound/i);
  assert.throws(() => assertProductionReleaseAcceptance([approvedQuestion('q-reviewed')], []), /v3\.2/i);
});

test('production v3.2 gate recomputes exact records and rejects adversarial metadata', () => {
  const clean = [v32Question('release-v32')]; const metadata = v32Metadata(clean); assert.equal(v32Policies.categories.length, 66); assert.doesNotThrow(() => assertExactV32ProductionRelease(clean, v32Policies, metadata));
  assert.throws(() => assertExactV32ProductionRelease(clean, v32Policies, {}), /complete v3\.2/i);
  const duplicate = [v32Question('duplicate-a'), { ...v32Question('duplicate-b'), promptAr: v32Question('duplicate-a').promptAr, answerConceptId: v32Question('duplicate-a').answerConceptId }]; const forged = v32Metadata(clean); assert.throws(() => assertExactV32ProductionRelease(duplicate, v32Policies, forged), /fabricated|stale/i);
  assert.throws(() => assertExactV32ProductionRelease(clean, v32Policies, { ...metadata, dispositions: [{ kind: 'alias_reuse', ids: ['gone-a', 'gone-b'], contentHashes: ['0'.repeat(64), '1'.repeat(64)], policyVersion: 'question-bank-duplicate-v3.2', disposition: 'stale' }] }), /fabricated|stale/i);
  assert.throws(() => assertExactV32ProductionRelease(clean, v32Policies, { ...metadata, report: { ...metadata.report, counts: {} } as never }), /schema/i);
  assert.throws(() => assertExactV32ProductionRelease([{ ...clean[0], modality: 'charades', targetLetter: undefined, facetId: undefined, performanceFacetId: 'performance:x' }], v32Policies, metadata), /classic\/image/i);
  assert.throws(() => assertExactV32ProductionRelease([{ ...clean[0], state: 'ready_for_human' }], v32Policies, metadata), /complete approved/i);
  assert.throws(() => assertExactV32ProductionRelease([{ ...clean[0], answerConceptId: '' }], v32Policies, metadata), /complete approved/i);
  assert.throws(() => assertExactV32ProductionRelease([{ ...clean[0], facetId: undefined }], v32Policies, metadata), /complete approved/i);
  assert.throws(() => assertExactV32ProductionRelease(clean, { categories: v32Policies.categories.slice(1) }, metadata), /66-policy/i);
  const warningQuestions = [v32Question('warning-a'), v32Question('warning-b', { categoryId: 'tahadani-007', answerConceptId: answerConceptIdV32('جواب اختبار'), promptAr: 'سؤال فريد للاختبار warning-a بصياغة مشابهة للغاية جدا' })]; const warningMetadata = v32Metadata(warningQuestions); assert.ok(warningMetadata.report.counts.warning > 0); assert.doesNotThrow(() => assertExactV32ProductionRelease(warningQuestions, v32Policies, warningMetadata));
});

test('release plan binds count/hash, uses full derived ID, and excludes the active pointer', async () => {
  const fixture = await planFor([approvedQuestion()]);
  try {
    assert.equal(fixture.plan.approvedCount, 1); assert.equal(fixture.plan.releaseId, `release-${fixture.plan.approvedJsonlSha256}`);
    assert.ok(/^[a-f0-9]{64}$/.test(fixture.plan.catalogSha256)); assert.ok(/^[a-f0-9]{64}$/.test(fixture.plan.documentRootSha256));
    assert.ok(fixture.plan.documents.some((entry) => entry.path.endsWith('/questions/q-firestore-test'))); assert.ok(!fixture.plan.documents.some((entry) => entry.path === 'runtime/activeRelease'));
    assert.deepEqual(classifyReleaseDocuments(fixture.plan.documents).mutable, []);
  } finally { await rm(fixture.folder, { recursive: true, force: true }); }
});

test('demo fixtures retain their emulator-only active pointer', async () => {
  const plan = await buildFirestoreReleasePlan({ allowEmptyDemo: true, demoFixture: true });
  const { immutable, mutable } = classifyReleaseDocuments(plan.documents);
  assert.ok(immutable.length > 0); assert.deepEqual(mutable.map((entry) => entry.path), ['runtime/activeRelease']);
  assert.ok(immutable.every((entry) => releaseDocumentWriteMode(entry.path) === 'create'));
  assert.equal(releaseDocumentWriteMode('runtime/activeRelease'), 'set');
});

test('v18 media dry run preserves private immutable object associations and requires upload generations', async () => {
  const media = await buildV18MediaUploadPlan();
  assert.equal(media.dryRun, true); assert.equal(media.assetCount, 240); assert.match(media.manifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(new Set(media.uploads.map((item) => item.mediaId)).size, 240);
  assert.ok(media.uploads.every((item) => item.createOnly && item.objectName === `question-media/v18/${item.assetSha256}.png` && item.localFile === `originals/${item.assetSha256}.png`));
  const first = media.uploads[0];
  const docs = buildV18ReleaseMediaDocuments('release-0123456789abcdef', [{ ...first, generation: '123456789' }]);
  assert.deepEqual(docs[0], { path: `releases/release-0123456789abcdef/media/${first.mediaId}`, data: { mediaId: first.mediaId, assetSha256: first.assetSha256, objectName: first.objectName, generation: '123456789', immutable: true } });
  assert.throws(() => buildV18ReleaseMediaDocuments('release-0123456789abcdef', [{ ...first, generation: 'pending' }]), /readback/i);
});

test('release documents reject authoring-only evidence body fields and paths recursively', () => {
  assert.throws(() => assertReleaseDocumentsExcludeEvidencePayload([{ path: 'releases/test', data: { nested: { responseBodyBase64: 'secret' } } }]), /evidence-body field/i);
  assert.throws(() => assertReleaseDocumentsExcludeEvidencePayload([{ path: 'releases/test', data: { sourceBodyPath: 'content/question-bank-v3/evidence-bodies/sha256/aa/file.bin' } }]), /evidence-body field/i);
  assert.throws(() => assertReleaseDocumentsExcludeEvidencePayload([{ path: 'releases/test', data: { source: { url: 'evidence-bodies/sha256/aa/file.bin' } } }]), /evidence-body path/i);
  assert.doesNotThrow(() => assertReleaseDocumentsExcludeEvidencePayload([{ path: 'releases/test', data: { sources: [{ title: 'Allowed metadata', url: 'https://example.com/a' }] } }]));
});

test('builder rejects an evidence payload or path even when it appears only in the source manifest', async () => {
  const fixture = await planFor([approvedQuestion('q-manifest-evidence')]);
  try {
    await writeFile(join(fixture.folder, 'manifest.json'), JSON.stringify({ schemaVersion: 1, approvedQuestionCount: 1, approvedBankSha256: fixture.plan.approvedJsonlSha256, provenance: { evidenceBodies: 'evidence-bodies/sha256/aa/example.bin' } }));
    await assert.rejects(buildFirestoreReleasePlan({ approvedPath: join(fixture.folder, 'approved.jsonl'), manifestPath: join(fixture.folder, 'manifest.json'), categoriesPath: join(fixture.folder, 'categories.json') }), /evidence-body/i);
  } finally { await rm(fixture.folder, { recursive: true, force: true }); }
});
