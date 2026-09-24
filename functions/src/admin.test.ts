import assert from 'node:assert/strict';
import test from 'node:test';
import { adminRoomDto } from './index.js';
import { canonicalAdminHash, canInspectPublishedQuestion, canManageCategoryCorrection, categoryCorrectionDraftInput, categoryCorrectionDraftsEnabled, categoryCorrectionDto, isArchivableQuestionStatus, isVerifiedAdminProvider, publishedQuestionContentDigest, publishedQuestionDto, publishedQuestionInspectionsEnabled, publishedQuestionMediaBinding, questionReviewBinding, reviewMatchesQuestion, sameAdminAuthorization, validateAdminQuestionDraft, validateLiveCategoryCorrectionPrincipal, validateLivePublishedQuestionInspectionPrincipal, wouldLockOutLastSuperAdmin, wouldOrphanSuperAdmin } from './admin/admin.js';

test('game-ops room DTO remains answer-free even if a canonical room has active question data', () => {
  const dto = adminRoomDto('room_1', {
    revision: 4, roomCode: 'ABCD1234', game: { lifecycle: 'QUESTION_READING' }, config: { releaseId: 'release_1' },
    members: [{ uid: 'private-uid', displayName: 'لاعب خاص', role: 'player', active: true }],
    activeQuestion: { canonicalAnswer: 'سر', sources: [{ token: 'secret' }] },
  });
  assert.equal(dto.id, 'room_1');
  assert.equal(dto.revision, 4);
  assert.equal(dto.lifecycle, 'QUESTION_READING');
  assert.equal(dto.releaseId, 'release_1');
  assert.equal(dto.paused, false);
  assert.equal(JSON.stringify(dto).match(/canonicalAnswer|sources|secret|private-uid|لاعب خاص/), null);
  const operationsDto = adminRoomDto('room_1', { revision: 4, lifecycle: 'LOBBY', config: {}, members: [{ uid: 'ops-uid', displayName: 'لاعب', role: 'player', active: true }] }, true);
  assert.equal(JSON.stringify(operationsDto).includes('ops-uid'), true);
});

test('idempotency hashes are canonical and bind the complete payload', () => {
  assert.equal(canonicalAdminHash({ b: 2, a: { y: 2, x: 1 } }), canonicalAdminHash({ a: { x: 1, y: 2 }, b: 2 }));
  assert.notEqual(canonicalAdminHash({ draft: { promptAr: 'أ' } }), canonicalAdminHash({ draft: { promptAr: 'ب' } }));
});

test('authorization parity rejects stale versions and role mismatches', () => {
  assert.equal(sameAdminAuthorization(['viewer'], ['viewer'], 4, 4), true);
  assert.equal(sameAdminAuthorization(['viewer'], ['viewer'], 4, 3), false);
  assert.equal(sameAdminAuthorization(['viewer'], ['super_admin'], 4, 4), false);
});

test('category correction drafts use a dedicated gate and a two-field allowlist', () => {
  assert.equal(categoryCorrectionDraftsEnabled({ FUNCTIONS_EMULATOR: 'true' } as NodeJS.ProcessEnv), true);
  assert.equal(categoryCorrectionDraftsEnabled({ ADMIN_CATEGORY_CORRECTION_DRAFTS_ENABLED: 'true' } as NodeJS.ProcessEnv), true);
  assert.equal(categoryCorrectionDraftsEnabled({ ADMIN_MUTATIONS_ENABLED: 'true' } as NodeJS.ProcessEnv), false);
  assert.deepEqual(categoryCorrectionDraftInput({ proposedLabelAr: ' عنوان مصحح ', internalNote: ' ملاحظة داخلية ' }), { proposedLabelAr: 'عنوان مصحح', internalNote: 'ملاحظة داخلية' });
  assert.throws(() => categoryCorrectionDraftInput({ proposedLabelAr: 'عنوان', internalNote: 'ملاحظة', publishedLabelAr: 'محاولة تجاوز' }), /Unsupported field/);
});

test('published question inspections use a dedicated gate and role/scope boundary', () => {
  assert.equal(publishedQuestionInspectionsEnabled({ FUNCTIONS_EMULATOR: 'true' } as NodeJS.ProcessEnv), true);
  assert.equal(publishedQuestionInspectionsEnabled({ ADMIN_PUBLISHED_QUESTION_INSPECTIONS_ENABLED: 'true' } as NodeJS.ProcessEnv), true);
  assert.equal(publishedQuestionInspectionsEnabled({ ADMIN_MUTATIONS_ENABLED: 'true' } as NodeJS.ProcessEnv), false);
  assert.equal(canInspectPublishedQuestion({ roles: ['content_admin'], categoryScopes: ['cat-1'] }, 'cat-1'), true);
  assert.equal(canInspectPublishedQuestion({ roles: ['reviewer'], categoryScopes: ['cat-1'] }, 'cat-1'), true);
  assert.equal(canInspectPublishedQuestion({ roles: ['viewer'], categoryScopes: ['cat-1'] }, 'cat-1'), false);
  assert.equal(canInspectPublishedQuestion({ roles: ['game_ops'], categoryScopes: ['cat-1'] }, 'cat-1'), false);
  assert.equal(canInspectPublishedQuestion({ roles: ['reviewer'], categoryScopes: ['cat-2'] }, 'cat-1'), false);
});

test('transaction-time inspection authorization rejects revoked roles, versions, and scopes', () => {
  const actor = { claimRoles: ['reviewer'] as const, claimAuthzVersion: 7 };
  const current = { enabled: true, identityReady: true, roles: ['reviewer'], authzVersion: 7, categoryScopes: ['cat-1'] };
  assert.deepEqual(validateLivePublishedQuestionInspectionPrincipal(actor, current, 'cat-1'), { roles: ['reviewer'], categoryScopes: ['cat-1'] });
  assert.throws(() => validateLivePublishedQuestionInspectionPrincipal(actor, { ...current, categoryScopes: ['cat-2'] }, 'cat-1'), /scope changed/);
  assert.throws(() => validateLivePublishedQuestionInspectionPrincipal(actor, { ...current, roles: ['viewer'] }, 'cat-1'), /authorization changed/);
  assert.throws(() => validateLivePublishedQuestionInspectionPrincipal(actor, { ...current, authzVersion: 8 }, 'cat-1'), /authorization changed/);
});

test('category correction DTO excludes internal notes unless a current writer may read them', () => {
  const stored = { categoryId: 'cat-1', baseReleaseId: 'release-1', baseReleaseRootSha256: 'a'.repeat(64), publishedLabelAr: 'منشور', proposedLabelAr: 'مقترح', internalNote: 'خاص', status: 'draft', revision: 4 };
  const reader = categoryCorrectionDto(stored, false);
  assert.equal('internalNote' in reader, false);
  assert.equal(categoryCorrectionDto(stored, true).internalNote, 'خاص');
  assert.equal(canManageCategoryCorrection({ roles: ['content_admin'], categoryScopes: ['cat-1'] }, 'cat-1'), true);
  assert.equal(canManageCategoryCorrection({ roles: ['content_admin'], categoryScopes: ['cat-2'] }, 'cat-1'), false);
});

test('transaction-time category correction authorization rejects revoked roles, versions, and scopes', () => {
  const actor = { claimRoles: ['content_admin'] as const, claimAuthzVersion: 7 };
  const current = { enabled: true, identityReady: true, roles: ['content_admin'], authzVersion: 7, categoryScopes: ['cat-1'] };
  assert.deepEqual(validateLiveCategoryCorrectionPrincipal(actor, current, 'cat-1'), { roles: ['content_admin'], categoryScopes: ['cat-1'] });
  assert.throws(() => validateLiveCategoryCorrectionPrincipal(actor, { ...current, categoryScopes: ['cat-2'] }, 'cat-1'), /scope changed/);
  assert.throws(() => validateLiveCategoryCorrectionPrincipal(actor, { ...current, roles: ['viewer'] }, 'cat-1'), /authorization changed/);
  assert.throws(() => validateLiveCategoryCorrectionPrincipal(actor, { ...current, authzVersion: 8 }, 'cat-1'), /authorization changed/);
});

test('admin access accepts only verified Google or email/password identities', () => {
  assert.equal(isVerifiedAdminProvider('google.com', true), true);
  assert.equal(isVerifiedAdminProvider('password', true), true);
  assert.equal(isVerifiedAdminProvider('password', false), false);
  assert.equal(isVerifiedAdminProvider('anonymous', true), false);
});

test('published media preview binds only the stored question or answer media record', () => {
  const hash = 'a'.repeat(64);
  assert.deepEqual(publishedQuestionMediaBinding({ media: { mediaId: 'asset_1', assetSha256: hash, type: 'image', altAr: 'صورة' } }, 'question'), { mediaId: 'asset_1', assetSha256: hash, type: 'image', altAr: 'صورة' });
  assert.deepEqual(publishedQuestionMediaBinding({ media: { mediaId: 'goal-quiz-2026:092:blur', assetSha256: hash, type: 'video' } }, 'question'), { mediaId: 'goal-quiz-2026:092:blur', assetSha256: hash, type: 'video', altAr: null });
  assert.deepEqual(publishedQuestionMediaBinding({ answerMedia: { mediaId: 'asset_2', assetSha256: hash, type: 'video' } }, 'answer'), { mediaId: 'asset_2', assetSha256: hash, type: 'video', altAr: null });
  assert.throws(() => publishedQuestionMediaBinding({ media: { mediaId: '../outside', assetSha256: hash } }, 'question'));
  assert.throws(() => publishedQuestionMediaBinding({}, 'answer'));
  assert.throws(() => publishedQuestionMediaBinding({}, 'objectName'));
});

test('published question inspection DTO exposes only approved fields and normalizes missing optional values', () => {
  const hash = 'b'.repeat(64);
  const dto = publishedQuestionDto('published-1', {
    categoryId: 'tahadani-001', modality: 'image', headerAr: 'عنوان', promptAr: 'سؤال', targetLetter: 'أ', canonicalAnswer: 'جواب', acceptedAnswers: ['جواب', 'الجواب', 42], points: 400, difficulty: 'متوسط',
    media: { mediaId: 'asset_1', assetSha256: hash, type: 'image', contentType: 'image/png', altAr: 'صورة', objectName: 'private/path.png' },
    answerMedia: { mediaId: '../bad', assetSha256: hash, type: 'video', contentType: 'video/mp4' },
    internalReview: { authorUid: 'private-user' }, objectName: 'never-returned', signedUrl: 'never-returned',
  }, true);
  assert.deepEqual(dto, {
    id: 'published-1', categoryId: 'tahadani-001', modality: 'image', headerAr: 'عنوان', promptAr: 'سؤال', targetLetter: 'أ', canonicalAnswer: 'جواب', acceptedAnswers: ['جواب', 'الجواب'],
    media: { mediaId: 'asset_1', assetSha256: hash, type: 'image', contentType: 'image/png', altAr: 'صورة' }, answerMedia: null, points: 400, difficulty: 'متوسط',
  });
  const unavailable = publishedQuestionDto('published-2', { categoryId: 'tahadani-001', modality: 'classic', headerAr: 'عنوان', promptAr: 'سؤال', canonicalAnswer: 'جواب', acceptedAnswers: [], points: Number.NaN }, true);
  assert.equal(unavailable.points, null);
  assert.equal(unavailable.difficulty, null);
});

test('published question inspection digest binds the immutable detail projection', () => {
  const question = { categoryId: 'cat-1', modality: 'classic', headerAr: 'عنوان', promptAr: 'سؤال', canonicalAnswer: 'جواب', acceptedAnswers: ['جواب'] };
  assert.equal(publishedQuestionContentDigest('q-1', question), publishedQuestionContentDigest('q-1', { ...question }));
  assert.notEqual(publishedQuestionContentDigest('q-1', question), publishedQuestionContentDigest('q-1', { ...question, promptAr: 'سؤال جديد' }));
});

test('question validator enforces modality reviewers and safe HTTPS sources', () => {
  const valid = { modality: 'classic', specialistRoles: ['fact_reviewer', 'language_reviewer'], sources: [{ sourceUrl: 'https://example.com/fact', publisher: 'ناشر', title: 'مرجع', sourceTier: 'primary', retrievedAt: '2026-09-04T00:00:00Z' }] };
  assert.doesNotThrow(() => validateAdminQuestionDraft(valid));
  assert.throws(() => validateAdminQuestionDraft({ ...valid, specialistRoles: ['fact_reviewer'] }), /specialistRoles/);
  assert.throws(() => validateAdminQuestionDraft({ ...valid, sources: [{ ...valid.sources[0], sourceUrl: 'javascript:alert(1)' }] }), /HTTPS/);
  assert.throws(() => validateAdminQuestionDraft({ ...valid, sources: [{ ...valid.sources[0], token: 'secret' }] }), /Unsupported field/);
});

test('last-super-admin policy covers role removal and disable transitions', () => {
  assert.equal(wouldOrphanSuperAdmin(true, false, 0), true);
  assert.equal(wouldOrphanSuperAdmin(true, false, 1), false);
  assert.equal(wouldOrphanSuperAdmin(true, true, 0), false);
  assert.equal(wouldOrphanSuperAdmin(false, false, 0), false);
  assert.equal(wouldLockOutLastSuperAdmin(true, 0), true);
  assert.equal(wouldLockOutLastSuperAdmin(true, 1), false);
});

test('review decisions bind one immutable submitted revision', () => {
  const question = { status: 'in_review', revision: 7, authorUid: 'author', categoryId: 'cat', modality: 'classic', headerAr: 'عنوان', promptAr: 'سؤال', canonicalAnswer: 'جواب', acceptedAnswers: ['جواب'], specialistRoles: ['fact_reviewer', 'language_reviewer'], sources: [] };
  const review = { status: 'in_review', questionRevision: 7, questionHash: questionReviewBinding(question, 7) };
  assert.equal(reviewMatchesQuestion(review, question), true);
  assert.equal(reviewMatchesQuestion(review, { ...question, promptAr: 'تغيير' }), false);
  assert.equal(reviewMatchesQuestion({ ...review, status: 'changes_requested' }, question), false);
});

test('only mutable draft workflow states may be archived', () => {
  for (const status of ['draft', 'ready_for_review', 'changes_requested']) assert.equal(isArchivableQuestionStatus(status), true);
  for (const status of ['in_review', 'approved', 'exported', 'released', 'archived']) assert.equal(isArchivableQuestionStatus(status), false);
});
