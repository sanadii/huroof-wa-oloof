import assert from 'node:assert/strict';
import test from 'node:test';
import { adminRoomDto } from './index.js';
import { canonicalAdminHash, isArchivableQuestionStatus, questionReviewBinding, reviewMatchesQuestion, sameAdminAuthorization, validateAdminQuestionDraft, wouldLockOutLastSuperAdmin, wouldOrphanSuperAdmin } from './admin/admin.js';

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
