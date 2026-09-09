import assert from 'node:assert/strict';
import test from 'node:test';
import { initialGameState } from '../../src/features/game/domain/lifecycle.js';
import { authorizeCurrentQuestionMedia } from './question-media.js';
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
  assert.throws(() => authorizeCurrentQuestionMedia('room-media', room({ config: { ...room().config, showQuestionOnAudience: false } }), [host, audience], audience.uid, request), /not-visible/);
  assert.throws(() => authorizeCurrentQuestionMedia('room-media', room({ game: { ...room().game, lifecycle: 'CELL_SELECTION' } }), [host, audience], audience.uid, request), /not-visible/);
  assert.throws(() => authorizeCurrentQuestionMedia('room-media', room({ closedAt: '2026-09-09T00:00:00.000Z' } as Partial<CanonicalRoom>), [host], host.uid, request), /not-visible/);
  assert.throws(() => authorizeCurrentQuestionMedia('room-media', room(), [host], host.uid, { ...request, extra: true }), /invalid-media-request/);
});
