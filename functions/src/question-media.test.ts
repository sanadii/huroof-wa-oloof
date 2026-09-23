import assert from 'node:assert/strict';
import test from 'node:test';
import { initialGameState } from '../../src/features/game/domain/lifecycle.js';
import { authorizeCurrentQuestionMedia, emulatorCurrentQuestionMediaUrl, expectedReleaseMediaObjectName, readWithFinalMediaAuthorization } from './question-media.js';
import type { CanonicalMember, CanonicalRoom } from './game.js';

const hash = 'a'.repeat(64);
const media = { mediaId: 'v18-tahadani-014-001', assetSha256: hash, altAr: 'صورة السؤال' };
const room = (patch: Partial<CanonicalRoom> = {}): CanonicalRoom => ({
  schemaVersion: 2, roomCode: 'MEDIA001', revision: 1,
  game: { ...initialGameState(), lifecycle: 'QUESTION_READING' },
  config: { demo: true, questionSeconds: 20, opponentSeconds: 10, teams: { horizontal: 'أحمر', vertical: 'أخضر' }, releaseId: 'release-0123456789abcdef', releaseRootSha256: hash, releaseDemoFixture: true, showQuestionOnAudience: true },
  timer: { deadlineMs: 2_000, buzzOpen: true }, questionCursor: 0,
  activeQuestion: { id: 'image-q', modality: 'image', headerAr: 'عنوان', promptAr: 'سؤال صورة', canonicalAnswer: 'جواب', acceptedAnswers: ['جواب'], media },
  ...patch,
});
const host: CanonicalMember = { uid: 'host', role: 'host', displayName: 'مضيف', ready: true, active: true };
const audience: CanonicalMember = { uid: 'audience', role: 'audience', displayName: 'جمهور', ready: false, active: true };
const player: CanonicalMember = { uid: 'player', role: 'player', displayName: 'لاعب', ready: true, active: true, team: 'horizontal' };
const request = { roomId: 'room-media', mediaId: media.mediaId, assetSha256: hash };

test('current image media authorization is exact, role-safe, and lifecycle-safe', () => {
  assert.deepEqual(authorizeCurrentQuestionMedia('room-media', room(), [host, audience, player], host.uid, request), media);
  assert.deepEqual(authorizeCurrentQuestionMedia('room-media', room(), [host, audience, player], audience.uid, request), media);
  assert.throws(() => authorizeCurrentQuestionMedia('room-media', room(), [host, audience, player], player.uid, request), /role-forbidden/);
  assert.throws(() => authorizeCurrentQuestionMedia('room-media', room(), [host, audience], audience.uid, { ...request, assetSha256: 'b'.repeat(64) }), /binding-mismatch/);
  assert.deepEqual(authorizeCurrentQuestionMedia('room-media', room({ config: { ...room().config, showQuestionOnAudience: false } }), [host, audience], audience.uid, request), media);
  const inactive = room({ game: { ...room().game, lifecycle: 'CELL_SELECTION' } });
  assert.throws(() => authorizeCurrentQuestionMedia('room-media', inactive, [host, audience], audience.uid, request), /not-visible/);
  assert.throws(() => authorizeCurrentQuestionMedia('room-media', inactive, [host, audience], host.uid, request), /not-visible/);
  assert.throws(() => authorizeCurrentQuestionMedia('room-media', room({ closedAt: '2026-09-09T00:00:00.000Z' } as Partial<CanonicalRoom>), [host], host.uid, request), /not-visible/);
  assert.throws(() => authorizeCurrentQuestionMedia('room-media', room(), [host], host.uid, { ...request, extra: true }), /invalid-media-request/);
});

test('a delayed media retrieval is rejected when final authorization is revoked', async () => {
  let finishRead: (() => void) | undefined;
  const delayedRead = new Promise<void>((resolve) => { finishRead = resolve; });
  const result = readWithFinalMediaAuthorization(
    media,
    async () => { await delayedRead; return 'private-bytes'; },
    async () => { throw new Error('media-role-forbidden'); },
  );
  finishRead!();
  await assert.rejects(result, /media-role-forbidden/);
});

test('clear video binding stays private until its exact active occurrence is revealed', () => {
  const prompt = { mediaId: 'goal-quiz-2026:001:blur', assetSha256: hash, altAr: 'مقطع السؤال', type: 'video' as const, contentType: 'video/mp4' };
  const clear = { mediaId: 'goal-quiz-2026:001:clean', assetSha256: 'b'.repeat(64), altAr: 'مقطع الإجابة', type: 'video' as const, contentType: 'video/mp4' };
  const canonical = room({ activeQuestionOccurrence: '3:cell-0-0:goal-quiz-2026-001', activeQuestion: { ...room().activeQuestion!, modality: 'video', media: prompt, answerMedia: clear } });
  const promptRequest = { roomId: 'room-media', mediaId: prompt.mediaId, assetSha256: prompt.assetSha256 };
  const clearRequest = { roomId: 'room-media', mediaId: clear.mediaId, assetSha256: clear.assetSha256 };
  assert.deepEqual(authorizeCurrentQuestionMedia('room-media', canonical, [host, audience], audience.uid, promptRequest), prompt);
  assert.throws(() => authorizeCurrentQuestionMedia('room-media', canonical, [host, audience], audience.uid, clearRequest), /binding-mismatch/);
  const revealed = { ...canonical, answerRevealedOccurrence: canonical.activeQuestionOccurrence };
  assert.deepEqual(authorizeCurrentQuestionMedia('room-media', revealed, [host, audience], host.uid, clearRequest), clear);
  assert.deepEqual(authorizeCurrentQuestionMedia('room-media', revealed, [host, audience], audience.uid, promptRequest), prompt);
  assert.throws(() => authorizeCurrentQuestionMedia('room-media', revealed, [host, audience], audience.uid, clearRequest), /binding-mismatch/);
  assert.throws(() => authorizeCurrentQuestionMedia('room-media', revealed, [host, audience], audience.uid, { ...clearRequest, mediaId: '../clear' }), /invalid-media-request/);
  const legacy = { ...canonical, activeQuestionOccurrence: undefined, answerRevealedOccurrence: undefined };
  assert.deepEqual(authorizeCurrentQuestionMedia('room-media', legacy, [host, audience], audience.uid, promptRequest), prompt);
  assert.throws(() => authorizeCurrentQuestionMedia('room-media', legacy, [host, audience], audience.uid, clearRequest), /binding-mismatch/);
});

test.skip('requires excluded private media fixture: rebuilt JPEG binding', async () => {
  const jpeg = { mediaId: 'rebuild-v2-photo-011-001', assetSha256: '47394f9c06896ca05e99a6d2aedba336bc10447a5c3d93f87f6a8d2888dee1fd', altAr: 'صورة السؤال', type: 'image' as const, contentType: 'image/jpeg' };
  const canonical = room({ activeQuestion: { ...room().activeQuestion!, modality: 'image', media: jpeg } });
  assert.deepEqual(authorizeCurrentQuestionMedia('room-media', canonical, [host, audience], host.uid, { roomId: 'room-media', mediaId: jpeg.mediaId, assetSha256: jpeg.assetSha256 }), jpeg);
  const prior = process.env.FUNCTIONS_EMULATOR;
  process.env.FUNCTIONS_EMULATOR = 'true';
  try {
    const url = await emulatorCurrentQuestionMediaUrl(jpeg);
    assert.match(url, /^data:image\/jpeg;base64,/);
    const bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    assert.deepEqual(bytes.subarray(0, 3), Buffer.from([0xff, 0xd8, 0xff]));
  } finally {
    if (prior === undefined) delete process.env.FUNCTIONS_EMULATOR;
    else process.env.FUNCTIONS_EMULATOR = prior;
  }
});

test.skip('requires excluded private media fixture: goal MP4 binding', async () => {
  const video = { mediaId: 'goal-quiz-2026:001:blur', assetSha256: '761991311fd4d5ee4d9f27c703d867b6d9259b175ff7c3f0f55b91ad4b251d69', altAr: 'مقطع السؤال', type: 'video' as const, contentType: 'video/mp4' };
  const prior = process.env.FUNCTIONS_EMULATOR;
  process.env.FUNCTIONS_EMULATOR = 'true';
  try {
    const url = await emulatorCurrentQuestionMediaUrl(video);
    assert.match(url, /^data:video\/mp4;base64,/);
    const bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    assert.equal(bytes.toString('ascii', 4, 8), 'ftyp');
  } finally {
    if (prior === undefined) delete process.env.FUNCTIONS_EMULATOR;
    else process.env.FUNCTIONS_EMULATOR = prior;
  }
});

test('enumerated public-goal object routing is exact and preserves legacy video routing', () => {
  const v6 = 'public-impossible-goal-2026-v6:073:filtered';
  assert.equal(expectedReleaseMediaObjectName(v6, hash, true, false), `question-media/goal-quiz-2026-impossible-v6/assets/${hash}.mp4`);
  assert.equal(expectedReleaseMediaObjectName('public-impossible-goal-2026-v7:069:clear', hash, true, false), `question-media/goal-quiz-2026-impossible-v7/assets/${hash}.mp4`);
  assert.equal(expectedReleaseMediaObjectName('public-impossible-goal-2026-v8:044:filtered', hash, true, false), `question-media/goal-quiz-2026-impossible-v8/assets/${hash}.mp4`);
  assert.equal(expectedReleaseMediaObjectName('public-impossible-goal-2026-v11:039:filtered', hash, true, false), `question-media/goal-quiz-2026-impossible-v11/assets/${hash}.mp4`);
  assert.equal(expectedReleaseMediaObjectName('public-impossible-goal-2026-v6:73:filtered', hash, true, false), `question-media/goal-quiz-2026/assets/${hash}.mp4`);
  assert.equal(expectedReleaseMediaObjectName('public-impossible-goal-2026-v6:073:blur', hash, true, false), `question-media/goal-quiz-2026/assets/${hash}.mp4`);
  assert.equal(expectedReleaseMediaObjectName('goal-quiz-2026:001:blur', hash, true, false), `question-media/goal-quiz-2026/assets/${hash}.mp4`);
});

test('a reused asset cannot cross an occurrence or disclosure transition during retrieval', async () => {
  await assert.rejects(readWithFinalMediaAuthorization({ ...media, occurrence: 'first', disclosureOccurrence: undefined }, async () => 'private-bytes', async () => ({ ...media, occurrence: 'second', disclosureOccurrence: undefined })), /media-authorization-stale/);
  await assert.rejects(readWithFinalMediaAuthorization({ ...media, occurrence: 'first', disclosureOccurrence: undefined }, async () => 'private-bytes', async () => ({ ...media, occurrence: 'first', disclosureOccurrence: 'first' })), /media-authorization-stale/);
});
