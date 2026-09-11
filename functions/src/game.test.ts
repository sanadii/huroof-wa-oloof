import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveMatch, initialGameState } from '../../src/features/game/domain/lifecycle.js';
import { generateBoard, revealSurprise } from '../../src/features/game/domain/board.js';
import { approvedReleaseCatalogProjection, expectedReleaseMatches, prepareLetterReveal, selectQuestionForActiveCell, validateQuestionScope } from './index.js';
import { createMatchQuestionSelection, selectCharadesQuestion } from '../../src/features/game/runtime/question-selector.js';
import { intentHash, intentReceiptId, isRoomClosed, preflightContentPreparation, projectRoom, reduceIntent, roomGameKind, validIntent, type CanonicalMember, type CanonicalQuestion, type CanonicalRoom } from './game.js';

const room = (): CanonicalRoom => ({ schemaVersion: 2, roomCode: 'A1B2C3D4', revision: 2, game: { ...initialGameState(), lifecycle: 'QUESTION_READING' }, config: { demo: true, questionSeconds: 20, opponentSeconds: 10, teams: { horizontal: 'أفقي', vertical: 'عمودي' }, releaseId: 'demo-drafts', releaseRootSha256: 'hash', releaseDemoFixture: true }, timer: { deadlineMs: 2_000, buzzOpen: true }, questionCursor: 0 });
const player: CanonicalMember = { uid: 'p1', role: 'player', displayName: 'P', ready: false, active: true, team: 'horizontal' };
const readyReleaseQuestions: CanonicalQuestion[] = Array.from({ length: 25 }, (_, letter) => Array.from({ length: 3 }, (_, copy) => ({ id: `ready-${letter}-${copy}`, categoryId: 'category-a', modality: 'classic' as const, targetLetter: `ح${letter}`, answerConceptId: `concept-${letter}-${copy}`, headerAr: 'عنوان', promptAr: 'سؤال', canonicalAnswer: 'جواب', acceptedAnswers: ['جواب'] }))).flat();

test('approved release catalog projection exposes only immutable identity, category labels, and board capability', () => {
  const value = approvedReleaseCatalogProjection(
    { releaseId: 'release-approved' },
    { immutable: true, approvedCount: 7, documentRootSha256: 'a'.repeat(64), canonicalAnswer: 'private', sources: ['private'] },
    [
      { id: 'category-b', data: { id: 'category-b', labelAr: 'فئة ب', media: { objectName: 'private' } } },
      { id: 'category-a', data: { id: 'category-a', labelAr: 'فئة أ', promptAr: 'private' } },
    ],
    readyReleaseQuestions,
  );
  assert.deepEqual(value, {
    releaseId: 'release-approved', releaseRootSha256: 'a'.repeat(64), demoFixture: false,
    categories: [{ id: 'category-a', labelAr: 'فئة أ', playable: { huroof: true, categories: false, charades: false } }, { id: 'category-b', labelAr: 'فئة ب', playable: { huroof: false, categories: false, charades: false } }],
    boardCapabilities: { huroof: true, categories: false, charades: false },
  });
  assert.doesNotMatch(JSON.stringify(value), /private|answer|source|media|prompt/i);
  assert.equal(expectedReleaseMatches({ releaseId: 'release-approved', releaseRootSha256: 'a'.repeat(64) }, 'release-approved', 'a'.repeat(64)), true);
  assert.equal(expectedReleaseMatches({ releaseId: 'release-approved', releaseRootSha256: 'b'.repeat(64) }, 'release-approved', 'a'.repeat(64)), false);
  assert.throws(() => approvedReleaseCatalogProjection({ releaseId: 'release-too-large' }, { immutable: true, approvedCount: 25_001, documentRootSha256: 'a'.repeat(64) }, [{ id: 'category-a', data: { id: 'category-a', labelAr: 'فئة أ' } }], readyReleaseQuestions), /Production requires/);
  assert.throws(() => approvedReleaseCatalogProjection({ releaseId: 'release-demo' }, { immutable: true, demoFixture: true, approvedCount: 1, documentRootSha256: 'a'.repeat(64) }, [{ id: 'category-a', data: { id: 'category-a', labelAr: 'فئة أ' } }], readyReleaseQuestions), /Production requires/);
  assert.equal(approvedReleaseCatalogProjection({ releaseId: 'release-demo' }, { immutable: true, demoFixture: true, approvedCount: 1, documentRootSha256: 'a'.repeat(64) }, [{ id: 'category-a', data: { id: 'category-a', labelAr: 'فئة أ' } }], readyReleaseQuestions, { allowDemoFixture: true }).demoFixture, true);
  assert.throws(() => approvedReleaseCatalogProjection({ releaseId: 'release-empty' }, { immutable: true, approvedCount: 1, documentRootSha256: 'a'.repeat(64) }, [], readyReleaseQuestions), /no eligible categories/);
  assert.throws(() => approvedReleaseCatalogProjection({ releaseId: 'release-mismatch' }, { immutable: true, approvedCount: 1, documentRootSha256: 'a'.repeat(64) }, [{ id: 'category-a', data: { id: 'other-category', labelAr: 'فئة أ' } }], readyReleaseQuestions), /invalid category catalog/);
  const underfilled = approvedReleaseCatalogProjection({ releaseId: 'release-underfilled' }, { immutable: true, approvedCount: 1, documentRootSha256: 'a'.repeat(64) }, [{ id: 'category-a', data: { id: 'category-a', labelAr: 'فئة أ' } }], readyReleaseQuestions.slice(0, 2));
  assert.equal(underfilled.boardCapabilities.huroof, false);
  const charadesOnly = approvedReleaseCatalogProjection(
    { releaseId: 'release-charades' }, { immutable: true, approvedCount: 1, documentRootSha256: 'a'.repeat(64) },
    [{ id: 'category-a', data: { id: 'category-a', labelAr: 'فئة أ' } }],
    [{ id: 'charades-1', categoryId: 'category-a', modality: 'charades', answerConceptId: 'mime-1', headerAr: 'مثّل', promptAr: 'مثّل', canonicalAnswer: 'جواب', acceptedAnswers: ['جواب'] }],
  );
  assert.deepEqual(charadesOnly.boardCapabilities, { huroof: false, categories: false, charades: true });
  const sharedConcepts: CanonicalQuestion[] = ['category-a', 'category-b'].flatMap((categoryId) => Array.from({ length: 14 }, (_, index) => ({
    id: `${categoryId}-${index}`, categoryId, modality: 'classic' as const, targetLetter: 'ا', answerConceptId: `shared-${index}`, headerAr: 'عنوان', promptAr: 'سؤال', canonicalAnswer: 'جواب', acceptedAnswers: ['جواب'],
  })));
  const sharedCatalog = approvedReleaseCatalogProjection(
    { releaseId: 'release-shared' }, { immutable: true, approvedCount: sharedConcepts.length, documentRootSha256: 'a'.repeat(64) },
    [{ id: 'category-a', data: { id: 'category-a', labelAr: 'فئة أ' } }, { id: 'category-b', data: { id: 'category-b', labelAr: 'فئة ب' } }], sharedConcepts,
  );
  assert.equal(sharedCatalog.boardCapabilities.categories, false);
});

test('closed rooms are terminal for shared join and intent guards', () => {
  const closed = { ...room(), closedAt: new Date().toISOString() } as CanonicalRoom;
  assert.equal(isRoomClosed(closed), true);
  assert.throws(() => reduceIntent(closed, player, { type: 'BUZZ', intentId: 'closed-buzz', expectedRevision: 2, payload: {} }, 1_000), /room-closed/);
});

test('content preparation preflight rejects every unauthorized or illegal depleted-selection path', () => {
  const host: CanonicalMember = { ...player, uid: 'host', role: 'host', team: undefined };
  const board = generateBoard(9, [...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي']);
  const cell = board.cells[0]!;
  const selecting = { ...room(), game: { ...room().game, lifecycle: 'CELL_SELECTION' as const, board } };
  const intent = { type: 'SELECT_CELL' as const, intentId: 'depleted-cell', expectedRevision: 2, payload: { cellId: cell.id } };
  const cases: Array<[string, CanonicalRoom, CanonicalMember, RegExp]> = [
    ['player', selecting, player, /host-only/],
    ['audience', selecting, { ...player, role: 'audience' }, /host-only/],
    ['inactive host', selecting, { ...host, active: false }, /inactive-member/],
    ['stale host', selecting, host, /stale-revision/],
    ['closed room', { ...selecting, closedAt: 'now' } as CanonicalRoom, host, /room-closed/],
    ['already-held room', { ...selecting, game: { ...selecting.game, contentHold: { reason: 'CONTENT_EXHAUSTED', operation: 'SELECT_CELL', heldAtRevision: 3 } } }, host, /content-hold-active/],
    ['illegal phase', { ...selecting, game: { ...selecting.game, lifecycle: 'MATCH_COMPLETE' } }, host, /Illegal transition/],
    ['owned cell', { ...selecting, game: { ...selecting.game, board: { ...board, cells: board.cells.map((item) => item.id === cell.id ? { ...item, owner: 'horizontal' as const } : item) } } }, host, /Illegal transition/],
  ];
  for (const [label, canonical, actor, expected] of cases) {
    const attempted = label === 'stale host' ? { ...intent, expectedRevision: 1 } : intent;
    assert.throws(() => preflightContentPreparation(canonical, actor, attempted, [host, player]), expected, label);
  }
  assert.doesNotThrow(() => preflightContentPreparation(selecting, host, intent, [host, player]));
});

test('private fields remain absent from player/audience projections while host gets answer/source', () => {
  const canonical = { ...room(), activeQuestion: { id: 'q', targetLetter: 'ا', headerAr: 'عنوان', promptAr: 'سؤال', canonicalAnswer: 'جواب', acceptedAnswers: ['جواب'], sources: [{ title: 'مصدر' }], review: { secret: true } } };
  const host = projectRoom('r1', canonical, [{ ...player, role: 'host' }], 'host', 'p1', 1_000); const publicValue = projectRoom('r1', canonical, [player], 'player', 'p1', 1_000); const audience = projectRoom('r1', canonical, [player], 'audience', undefined, 1_000);
  for (const value of [publicValue, audience]) assert.equal(JSON.stringify(value).match(/canonicalAnswer|acceptedAnswers|sources|review|moderation|primaryAnswer/), null);
  assert.match(JSON.stringify(host), /primaryAnswer/); assert.match(JSON.stringify(host), /مصدر/);
});
test('policy version defaults only legacy Huroof rooms and malformed envelopes fail closed', () => {
  assert.equal(roomGameKind(room()), 'huroof');
  assert.throws(() => roomGameKind({ ...room(), config: { ...room().config, gameKind: 'categories' } }), /unknown-room-policy/);
  assert.throws(() => roomGameKind({ ...room(), config: { ...room().config, policyVersion: 1, gameKind: 'future' as never } }), /unknown-room-policy/);
  const valid = { type: 'ROUND_READY', intentId: 'safe-1', expectedRevision: 2, payload: {} };
  assert.equal(validIntent(valid), true);
  assert.equal(validIntent({ ...valid, intentId: undefined }), false);
  assert.equal(validIntent({ ...valid, expectedRevision: Number.MAX_SAFE_INTEGER + 1 }), false);
  assert.equal(validIntent({ ...valid, extra: true }), false);
});
test('shared reveal requires the active occurrence and freezes a video question without scoring', () => {
  const host: CanonicalMember = { ...player, uid: 'host', role: 'host', team: undefined };
  const videoRoom = { ...room(), activeQuestionOccurrence: '2:cell-0-0:video-q', activeQuestion: { id: 'video-q', modality: 'video' as const, headerAr: 'عنوان', promptAr: 'سؤال', canonicalAnswer: 'جواب', acceptedAnswers: ['جواب'], media: { mediaId: 'goal-quiz-2026:001:blur', assetSha256: 'a'.repeat(64), altAr: 'مقطع', type: 'video' as const }, answerMedia: { mediaId: 'goal-quiz-2026:001:clean', assetSha256: 'b'.repeat(64), altAr: 'الإجابة', type: 'video' as const } } };
  const reveal = { type: 'REVEAL_ANSWER' as const, intentId: 'reveal-video', expectedRevision: 2, payload: { occurrence: videoRoom.activeQuestionOccurrence } };
  assert.equal(validIntent(reveal), true);
  assert.equal(validIntent({ ...reveal, payload: { occurrence: 'bad/path' } }), false);
  assert.throws(() => reduceIntent(videoRoom, host, { ...reveal, payload: { occurrence: 'old' } }, 1_000, undefined, [host]), /stale-question-occurrence/);
  const revealed = reduceIntent(videoRoom, host, reveal, 1_000, undefined, [host]);
  assert.equal(revealed.room.answerRevealedOccurrence, videoRoom.activeQuestionOccurrence);
  assert.equal(revealed.room.timer, undefined);
  assert.equal(revealed.room.game.questionScores.horizontal, videoRoom.game.questionScores.horizontal);
  const audience = projectRoom('media-room', revealed.room, [host], 'audience', undefined, 1_000).projection as { question?: { occurrence?: string; media?: { mediaId: string }; revealedAnswer?: string } };
  assert.equal(audience.question?.occurrence, videoRoom.activeQuestionOccurrence);
  assert.equal(audience.question?.media?.mediaId, 'goal-quiz-2026:001:clean');
  assert.equal(audience.question?.revealedAnswer, 'جواب');
  const classic = projectRoom('classic-room', { ...room(), activeQuestionOccurrence: '2:cell-0-0:classic-q', activeQuestion: { id: 'classic-q', modality: 'classic', headerAr: 'عنوان', promptAr: 'سؤال', canonicalAnswer: 'جواب', acceptedAnswers: ['جواب'] } }, [host], 'host', host.uid, 1_000).projection as { question?: { occurrence?: string } };
  assert.equal(classic.question?.occurrence, '2:cell-0-0:classic-q');
});
test('legacy Firebase questions without an occurrence never treat absent fields as a reveal', () => {
  const host: CanonicalMember = { ...player, uid: 'host', role: 'host', team: undefined };
  for (const modality of ['image', 'video'] as const) {
    const legacy = { ...room(), activeQuestion: { id: `${modality}-legacy`, modality, headerAr: 'عنوان', promptAr: 'سؤال', canonicalAnswer: `سر-${modality}`, acceptedAnswers: [`سر-${modality}`], media: { mediaId: modality === 'video' ? 'goal-quiz-2026:001:blur' : 'v18-011-001', assetSha256: 'a'.repeat(64), altAr: 'وسيط', type: modality }, ...(modality === 'video' ? { answerMedia: { mediaId: 'goal-quiz-2026:001:clean', assetSha256: 'b'.repeat(64), altAr: 'إجابة', type: 'video' as const } } : {}) } };
    const audience = projectRoom('legacy', legacy, [host], 'audience', undefined, 1_000).projection as { question?: { revealedAnswer?: string; media?: { mediaId?: string } } };
    assert.equal(audience.question?.revealedAnswer, undefined);
    assert.equal(audience.question?.media?.mediaId, legacy.activeQuestion.media?.mediaId);
  }
});
test('content hold is projected and host end leaves the original match intact without a fabricated winner', () => {
  const host: CanonicalMember = { ...player, uid: 'host', role: 'host', team: undefined };
  const held = { ...room(), game: { ...room().game, contentHold: { reason: 'CONTENT_EXHAUSTED' as const, operation: 'SELECT_CELL' as const, cellId: 'cell-0-0', heldAtRevision: 3 } } };
  assert.throws(() => reduceIntent(held, host, { type: 'ROUND_READY', intentId: 'held-ready', expectedRevision: 2, payload: {} }, 1_000, undefined, [host]), /content-hold-active/);
  const ended = reduceIntent(held, host, { type: 'END_WITHOUT_WINNER', intentId: 'end-held', expectedRevision: 2, payload: {} }, 1_000, undefined, [host]);
  assert.equal(ended.room.game.lifecycle, 'MATCH_COMPLETE'); assert.equal(ended.room.game.endedWithoutWinner, true); assert.equal(deriveMatch(ended.room.game).matchWinner, undefined);
  assert.throws(() => reduceIntent(ended.room, host, { type: 'ROUND_READY', intentId: 'held-resume', expectedRevision: 3, payload: {} }, 1_000, undefined, [host]), /Illegal transition/);
});
test('audience-question visibility defaults on, validates strictly, and remains host-only', () => {
  const host: CanonicalMember = { ...player, uid: 'host', role: 'host', team: undefined };
  const intent = { type: 'SET_AUDIENCE_QUESTION_VISIBILITY' as const, intentId: 'hide-audience-question', expectedRevision: 2, payload: { showQuestion: false } };
  assert.equal(validIntent(intent), true);
  assert.equal(validIntent({ ...intent, payload: { showQuestion: 'false' } }), false);
  assert.equal(validIntent({ ...intent, payload: { showQuestion: false, extra: true } }), false);
  const defaultAudience = projectRoom('r1', room(), [host], 'audience', undefined, 1_000).projection as { room: { audienceQuestionVisible?: boolean } };
  assert.equal(defaultAudience.room.audienceQuestionVisible, true);
  const changed = reduceIntent(room(), host, intent, 1_000, undefined, [host]);
  const audience = projectRoom('r1', changed.room, [host], 'audience', undefined, 1_000).projection as { room: { audienceQuestionVisible?: boolean } };
  assert.equal(audience.room.audienceQuestionVisible, false);
  assert.throws(() => reduceIntent(room(), player, intent, 1_000, undefined, [host, player]), /host-only/);
});
test('host lobby assignment updates only its target and host roster IDs stay private', () => {
  const host: CanonicalMember = { uid: 'host', role: 'host', displayName: 'مضيف', ready: true, active: true };
  const first: CanonicalMember = { ...player, uid: 'first', displayName: 'اسم مكرر', ready: true, team: 'horizontal' };
  const second: CanonicalMember = { ...player, uid: 'second', displayName: 'اسم مكرر', ready: true, team: 'vertical' };
  const members = [host, first, second];
  const lobby = { ...room(), game: initialGameState() };
  const intent = { type: 'LOBBY_ASSIGN_TEAM' as const, intentId: 'assign-first', expectedRevision: 2, payload: { memberUid: first.uid, team: 'vertical' } };
  assert.equal(validIntent(intent), true);
  assert.equal(validIntent({ ...intent, payload: { memberUid: first.uid, team: 'diagonal' } }), false);
  assert.equal(validIntent({ ...intent, payload: { memberUid: first.uid, team: 'vertical', extra: true } }), false);
  const result = reduceIntent(lobby, host, intent, 1_000, undefined, members);
  assert.equal(result.member.uid, host.uid);
  assert.equal(result.targetMember?.uid, first.uid);
  assert.equal(result.targetMember?.team, 'vertical');
  assert.equal(result.targetMember?.ready, false);
  const nextMembers = members.map((member) => member.uid === result.targetMember?.uid ? result.targetMember! : member);
  assert.equal(nextMembers.find((member) => member.uid === second.uid)?.ready, true);
  const hostProjection = projectRoom('room', result.room, nextMembers, 'host', host.uid, 1_000).projection as { room: { members: Array<{ uid?: string }> } };
  const playerProjection = projectRoom('room', result.room, nextMembers, 'player', first.uid, 1_000).projection as { room: { members: Array<{ uid?: string }> } };
  const audienceProjection = projectRoom('room', result.room, nextMembers, 'audience', undefined, 1_000).projection as { room: { members: Array<{ uid?: string }> } };
  assert.equal(hostProjection.room.members.every((member) => typeof member.uid === 'string'), true);
  assert.equal(playerProjection.room.members.some((member) => member.uid), false);
  assert.equal(audienceProjection.room.members.some((member) => member.uid), false);
  const readyFirst = reduceIntent(result.room, result.targetMember!, { type: 'LOBBY_SET_READY', intentId: 'ready-first', expectedRevision: 3, payload: { ready: true } }, 1_000, undefined, nextMembers);
  const readyMembers = nextMembers.map((member) => member.uid === first.uid ? readyFirst.member : member);
  const sameTeam = reduceIntent(readyFirst.room, host, { ...intent, intentId: 'same-team', expectedRevision: 4 }, 1_000, undefined, readyMembers);
  assert.equal(sameTeam.targetMember?.ready, true);
  assert.throws(() => reduceIntent(lobby, first, intent, 1_000, undefined, members), /host-only/);
  assert.throws(() => reduceIntent(room(), host, intent, 1_000, undefined, members), /lobby-assignment-not-allowed/);
  assert.throws(() => reduceIntent(lobby, host, { ...intent, payload: { memberUid: 'missing', team: 'vertical' } }, 1_000, undefined, members), /lobby-assignment-target-invalid/);
  assert.throws(() => reduceIntent(lobby, host, { ...intent, payload: { memberUid: host.uid, team: 'vertical' } }, 1_000, undefined, members), /lobby-assignment-target-invalid/);
  assert.throws(() => reduceIntent(lobby, host, { ...intent, payload: { memberUid: 'audience', team: 'vertical' } }, 1_000, undefined, [...members, { uid: 'audience', role: 'audience', displayName: 'جمهور', ready: false, active: true }]), /lobby-assignment-target-invalid/);
  assert.throws(() => reduceIntent(lobby, host, { ...intent, payload: { memberUid: 'inactive', team: 'vertical' } }, 1_000, undefined, [...members, { ...first, uid: 'inactive', active: false }]), /lobby-assignment-target-invalid/);
});
test('safe live team moves preserve game state and readiness, while answer and stop states remain locked', () => {
  const host: CanonicalMember = { uid: 'host', role: 'host', displayName: 'مضيف', ready: true, active: true };
  const target: CanonicalMember = { ...player, uid: 'target', ready: true, team: 'horizontal' };
  const intent = { type: 'LOBBY_ASSIGN_TEAM' as const, intentId: 'live-move', expectedRevision: 2, payload: { memberUid: target.uid, team: 'vertical' } };
  for (const lifecycle of ['ROUND_SETUP', 'CELL_SELECTION', 'QUESTION_FAILED', 'ROUND_COMPLETE'] as const) {
    const current = { ...room(), game: { ...room().game, lifecycle } };
    const result = reduceIntent(current, host, intent, 1_000, undefined, [host, target]);
    assert.equal(result.targetMember?.team, 'vertical', lifecycle);
    assert.equal(result.targetMember?.ready, true, lifecycle);
    assert.deepEqual(result.room.game, current.game, lifecycle);
  }
  for (const lifecycle of ['QUESTION_READING', 'FIRST_ANSWER', 'OPPONENT_CHANCE', 'PAUSED', 'CORRECTION', 'MATCH_COMPLETE'] as const) {
    const current = { ...room(), game: { ...room().game, lifecycle } };
    assert.throws(() => reduceIntent(current, host, intent, 1_000, undefined, [host, target]), /lobby-assignment-not-allowed/, lifecycle);
  }
});
test('Firebase projections preserve match settings for a same-settings rematch', () => {
  const canonical = { ...room(), config: { ...room().config, categories: ['tahadani-006', 'tahadani-007'], modality: 'image' as const, difficulty: 'hard', mode: 'custom' as const } };
  const value = projectRoom('r1', canonical, [{ ...player, role: 'host' }], 'host', 'p1', 1_000).projection as { room: { matchSettings: unknown } };
  assert.deepEqual(value.room.matchSettings, { demo: true, gameKind: 'huroof', questionSeconds: 20, opponentSeconds: 10, teams: { horizontal: 'أفقي', vertical: 'عمودي' }, categories: ['tahadani-006', 'tahadani-007'], modality: 'image', difficulty: 'hard', mode: 'custom', showQuestionOnAudience: true, expectedRelease: { releaseId: 'demo-drafts', releaseRootSha256: 'hash' } });
});
test('only first eligible player buzz wins and player sees self winner only', () => {
  const first = reduceIntent(room(), player, { type: 'BUZZ', intentId: 'a', expectedRevision: 2, payload: {} }, 1_000); assert.equal(first.room.game.lifecycle, 'FIRST_ANSWER'); assert.equal(first.room.buzzWinner?.uid, 'p1'); assert.equal(first.room.buzzWinner?.method, 'player'); assert.throws(() => reduceIntent(first.room, { ...player, uid: 'p2', team: 'vertical' }, { type: 'BUZZ', intentId: 'b', expectedRevision: 3, payload: {} }, 1_000)); const winner = projectRoom('r', first.room, [player], 'player', 'p1', 1_000); const host = projectRoom('r', first.room, [player], 'host', 'p1', 1_000); assert.match(JSON.stringify(winner), /isBuzzWinner/); assert.match(JSON.stringify(host), /displayName/);
});
test('zero-player host mode starts and host selection is public without a UID', () => {
  const host: CanonicalMember = { uid: 'host', role: 'host', displayName: 'مضيف', ready: true, active: true }; const letters = [...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي'].slice(0, 25); const lobby = { ...room(), game: initialGameState() };
  const started = reduceIntent(lobby, host, { type: 'START_MATCH', intentId: 'start', expectedRevision: 2, payload: {} }, 1_000, undefined, [host], letters); assert.equal(started.room.game.lifecycle, 'ROUND_SETUP'); const startedSummary = (projectRoom('r', started.room, [host], 'host', host.uid, 1_000).projection as { room: { readyCount: number; memberCount: number } }).room; assert.equal(startedSummary.readyCount, 0); assert.equal(startedSummary.memberCount, 0);
  const selected = reduceIntent(room(), host, { type: 'HOST_SELECT_TEAM', intentId: 'host-horizontal', expectedRevision: 2, payload: { team: 'horizontal' } }, 1_000, undefined, [host]); assert.equal(selected.room.game.lifecycle, 'FIRST_ANSWER'); assert.equal(selected.room.game.answeringTeam, 'horizontal'); assert.deepEqual(selected.room.buzzWinner, { displayName: 'أفقي', team: 'horizontal', method: 'host' }); assert.equal(selected.room.timer, undefined);
  const audience = projectRoom('r', selected.room, [host], 'audience', undefined, 1_000); const playerView = projectRoom('r', selected.room, [{ ...player, active: true }], 'player', player.uid, 1_000); assert.match(JSON.stringify(audience), /"method":"host"/); assert.equal(JSON.stringify(playerView).includes('buzzWinner'), false);
  const opponent = { ...room(), game: { ...room().game, lifecycle: 'OPPONENT_CHANCE' as const, entitledTeam: 'vertical' as const } }; assert.throws(() => reduceIntent(opponent, host, { type: 'HOST_SELECT_TEAM', intentId: 'wrong', expectedRevision: 2, payload: { team: 'horizontal' } }, 1_000, undefined, [host])); assert.equal(reduceIntent(opponent, host, { type: 'HOST_SELECT_TEAM', intentId: 'right', expectedRevision: 2, payload: { team: 'vertical' } }, 1_000, undefined, [host]).room.game.answeringTeam, 'vertical');
});
test('a partial player roster cannot bypass the two-ready-team start gate', () => {
  const host: CanonicalMember = { uid: 'host', role: 'host', displayName: 'مضيف', ready: true, active: true }; const onePlayer: CanonicalMember = { ...player, ready: true, active: true }; const letters = [...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي'].slice(0, 25); assert.throws(() => reduceIntent({ ...room(), game: initialGameState() }, host, { type: 'START_MATCH', intentId: 'partial', expectedRevision: 2, payload: {} }, 1_000, undefined, [host, onePlayer], letters), /teams-not-ready/);
});
test('late, audience, and wrong-team buzzes are rejected', () => {
  assert.throws(() => reduceIntent(room(), { ...player, role: 'audience' }, { type: 'BUZZ', intentId: 'a', expectedRevision: 2, payload: {} }, 1_000)); assert.throws(() => reduceIntent(room(), player, { type: 'BUZZ', intentId: 'a', expectedRevision: 2, payload: {} }, 2_001)); const opponent = { ...room(), game: { ...room().game, lifecycle: 'OPPONENT_CHANCE' as const, entitledTeam: 'vertical' as const } }; assert.throws(() => reduceIntent(opponent, player, { type: 'BUZZ', intentId: 'a', expectedRevision: 2, payload: {} }, 1_000));
});
test('receipt ids are collision-resistant and request hash detects semantic reuse', () => { const prefix = 'a'.repeat(119); assert.notEqual(intentReceiptId('p', `${prefix}a`), intentReceiptId('p', `${prefix}b`)); assert.notEqual(intentHash({ type: 'BUZZ', intentId: 'same', expectedRevision: 1, payload: {} }), intentHash({ type: 'BUZZ', intentId: 'same', expectedRevision: 2, payload: {} })); });
test('OPEN_QUESTION remains compatible without resetting an already-open buzzer', () => { const host: CanonicalMember = { ...player, uid: 'h', role: 'host', team: undefined }; const result = reduceIntent(room(), host, { type: 'OPEN_QUESTION', intentId: 'open', expectedRevision: 2, payload: {} }, 1_000); assert.equal(result.room.game.lifecycle, 'QUESTION_READING'); assert.deepEqual(result.room.timer, { deadlineMs: 2_000, buzzOpen: true }); });
test('non-charades retry and return clear disclosed state before returning to cell selection', () => { const host: CanonicalMember = { ...player, uid: 'h', role: 'host', team: undefined }; for (const type of ['RETRY_CELL', 'RETURN_CELL'] as const) { const failed = { ...room(), game: { ...room().game, lifecycle: 'QUESTION_FAILED' as const, activeCellId: 'cell-0-0' }, activeQuestion: { id: 'disclosed', headerAr: 'عنوان', promptAr: 'سؤال', canonicalAnswer: 'جواب', acceptedAnswers: ['جواب'] }, timer: { deadlineMs: 21_000, buzzOpen: true }, buzzWinner: { uid: 'p1', displayName: 'لاعب', team: 'horizontal' as const, method: 'player' as const } }; const result = reduceIntent(failed, host, { type, intentId: `continue-${type}`, expectedRevision: 2, payload: {} }, 1_000); assert.equal(result.room.game.lifecycle, 'CELL_SELECTION'); assert.equal(result.room.game.activeCellId, undefined); assert.equal(result.room.activeQuestion, undefined); assert.equal(result.room.timer, undefined); assert.equal(result.room.buzzWinner, undefined); } });
test('selecting a regular or surprise cell atomically reveals its question and opens one timer', () => {
  const letters = [...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي']; const board = generateBoard(4, letters); const regular = board.cells.find((cell) => cell.kind === 'letter')!; const surprise = board.cells.find((cell) => cell.kind === 'surprise')!; const host: CanonicalMember = { ...player, uid: 'host', role: 'host', team: undefined }; const stale = { id: 'stale', targetLetter: 'ا', headerAr: 'قديم', promptAr: 'سؤال قديم', canonicalAnswer: 'جواب قديم', acceptedAnswers: ['جواب قديم'] }; const question = { id: 'fresh', targetLetter: regular.visibleValue, headerAr: 'عنوان جديد', promptAr: 'سؤال جديد', canonicalAnswer: 'جواب جديد', acceptedAnswers: ['جواب جديد'] }; const selecting = { ...room(), game: { ...room().game, lifecycle: 'CELL_SELECTION' as const, board }, activeQuestion: stale };
  const selected = reduceIntent(selecting, host, { type: 'SELECT_CELL', intentId: 'regular', expectedRevision: 2, payload: { cellId: regular.id } }, 1_000, question, [host]);
  assert.equal(selected.room.game.lifecycle, 'QUESTION_READING'); assert.equal(selected.room.activeQuestion?.id, question.id); assert.equal(selected.room.questionCursor, 1); assert.deepEqual(selected.room.timer, { deadlineMs: 21_000, buzzOpen: true }); const hostProjection = projectRoom('r', selected.room, [host], 'host', host.uid, 1_000).projection as { question?: { occurrence?: string; headerAr?: string; promptAr?: string; primaryAnswer?: string } }; assert.deepEqual(hostProjection.question, { occurrence: selected.room.activeQuestionOccurrence, headerAr: question.headerAr, promptAr: question.promptAr, primaryAnswer: question.canonicalAnswer, acceptedAnswers: question.acceptedAnswers, sources: [] });
  for (const role of ['player', 'audience'] as const) { const publicProjection = projectRoom('r', selected.room, [player], role, role === 'player' ? player.uid : undefined, 1_000).projection as { question?: { headerAr?: string } }; assert.equal(publicProjection.question?.headerAr, question.headerAr); assert.equal(JSON.stringify(publicProjection).includes('جواب جديد'), false); }
  const surpriseLetter = letters.find((letter) => !board.cells.some((cell) => cell.kind === 'letter' && cell.visibleValue === letter))!; const surpriseQuestion = { ...question, id: 'surprise', targetLetter: surpriseLetter }; const surpriseSelection = reduceIntent(selecting, host, { type: 'SELECT_CELL', intentId: 'surprise', expectedRevision: 2, payload: { cellId: surprise.id } }, 1_000, surpriseQuestion, [host], undefined, surpriseLetter); assert.equal(surpriseSelection.room.game.lifecycle, 'QUESTION_READING'); assert.equal(surpriseSelection.room.activeQuestion?.id, surpriseQuestion.id); assert.equal(surpriseSelection.room.game.board?.cells.find((cell) => cell.id === surprise.id)?.revealedLetter, surpriseLetter); assert.equal(surpriseSelection.room.questionCursor, 1); assert.deepEqual(surpriseSelection.room.timer, { deadlineMs: 21_000, buzzOpen: true });
});
test('pinned question selection uses the active cell revealed/visible letter', () => { const board = generateBoard(1, [...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي']); const active = board.cells.find((cell) => cell.kind === 'letter')!; const canonical = { ...room(), game: { ...room().game, board, activeCellId: active.id } }; const matching = { id: 'match', targetLetter: active.visibleValue, headerAr: 'عنوان', promptAr: 'سؤال', canonicalAnswer: 'جواب', acceptedAnswers: ['جواب'] }; const other = { ...matching, id: 'other', targetLetter: '؟' }; assert.equal(selectQuestionForActiveCell(canonical, [other, matching]).id, 'match'); });
test('a classic correct judgment awards and checks the path in one authoritative intent', () => {
  const board = generateBoard(7, [...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي']);
  const cell = board.cells.find((value) => value.kind === 'letter')!;
  const host: CanonicalMember = { ...player, uid: 'host', role: 'host', team: undefined };
  const answering = { ...room(), game: { ...room().game, board, lifecycle: 'FIRST_ANSWER' as const, activeCellId: cell.id, answeringTeam: 'horizontal' as const }, timer: undefined };
  const result = reduceIntent(answering, host, { type: 'JUDGE_CORRECT', intentId: 'correct', expectedRevision: 2, payload: {} }, 1_000, undefined, [host, player]);
  assert.equal(result.room.game.lifecycle, 'CELL_SELECTION');
  assert.equal(result.room.game.questionScores.horizontal, 1);
  assert.equal(result.room.game.board?.cells.find((value) => value.id === cell.id)?.owner, 'horizontal');
  assert.equal(result.room.timer, undefined);
});
test('surprise reveal atomically selects an unused pinned-release letter and question', () => {
  const letters = [...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي']; let board = generateBoard(3, letters); const active = board.cells.find((cell) => cell.kind === 'surprise')!; const priorSurprise = board.cells.find((cell) => cell.kind === 'surprise' && cell.id !== active.id)!; const priorLetter = letters.find((letter) => !board.cells.some((cell) => cell.kind === 'letter' && cell.visibleValue === letter))!; board = revealSurprise(board, priorSurprise.id, priorLetter);
  const canonical = { ...room(), game: { ...room().game, lifecycle: 'LETTER_REVEAL' as const, board, activeCellId: active.id } };
  const questions = letters.map((targetLetter, index) => ({ id: `q-${index}`, targetLetter, headerAr: 'عنوان', promptAr: 'سؤال', canonicalAnswer: 'جواب', acceptedAnswers: ['جواب'] }));
  const reveal = prepareLetterReveal(canonical, questions); assert.ok(reveal.surpriseLetter); assert.notEqual(reveal.surpriseLetter, priorLetter); assert.equal(reveal.question.targetLetter, reveal.surpriseLetter);
  const host: CanonicalMember = { ...player, uid: 'host', role: 'host', team: undefined }; const result = reduceIntent(canonical, host, { type: 'LETTER_REVEALED', intentId: 'reveal', expectedRevision: 2, payload: {} }, 1_000, reveal.question, [host], undefined, reveal.surpriseLetter);
  const nextActive = result.room.game.board!.cells.find((cell) => cell.id === active.id)!; assert.equal(nextActive.revealedLetter, reveal.surpriseLetter); assert.deepEqual(result.room.timer, { deadlineMs: 21_000, buzzOpen: true });
  const revealedOrVisibleLetters = result.room.game.board!.cells.flatMap((cell) => cell.kind === 'letter' ? [cell.visibleValue] : cell.revealedLetter ? [cell.revealedLetter] : []); assert.equal(new Set(revealedOrVisibleLetters).size, revealedOrVisibleLetters.length);
  const surpriseDigits = result.room.game.board!.cells.filter((cell) => cell.kind === 'surprise').map((cell) => cell.visibleValue); assert.equal(new Set(surpriseDigits).size, surpriseDigits.length);
});
test('host correction projection carries correction and prior owner without exposing it publicly', () => { const board = generateBoard(2, [...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي']); const cell = board.cells[0]; cell.owner = 'horizontal'; const canonical = { ...room(), game: { ...room().game, board, lifecycle: 'CORRECTION' as const, correction: { cellId: cell.id, owner: 'vertical' as const, reason: 'تصحيح' } } }; const host = projectRoom('r', canonical, [{ ...player, role: 'host' }], 'host', 'p1', 1_000); const audience = projectRoom('r', canonical, [player], 'audience', undefined, 1_000); assert.deepEqual((host.projection as { correction: unknown }).correction, { cellId: cell.id, owner: 'vertical', reason: 'تصحيح', priorOwner: 'horizontal' }); assert.equal(JSON.stringify(audience).includes('تصحيح'), false); });
test('Firebase request scope accepts a separate charades lifecycle and selection never uses a letter board', () => { assert.deepEqual(validateQuestionScope({ categories: ['tahadani-007', 'tahadani-006', 'tahadani-006'], modality: 'classic' }), { categories: ['tahadani-006', 'tahadani-007'], modality: 'classic', gameKind: 'huroof' }); assert.deepEqual(validateQuestionScope({ categories: ['tahadani-016'], modality: 'charades' }), { categories: ['tahadani-016'], modality: 'charades', gameKind: 'huroof' }); assert.throws(() => validateQuestionScope({ categories: [], modality: 'classic' }), /scope/i); assert.throws(() => validateQuestionScope({ categories: ['tahadani-006'], modality: 'classic', gameKind: 'categories' }), /scope/i); const charades = { id: 'charades-1', categoryId: 'tahadani-016', modality: 'charades' as const, answerConceptId: 'concept:act', headerAr: 'تمثيل', promptAr: 'مثّل العبارة', canonicalAnswer: 'بحر', acceptedAnswers: ['بحر'] }; assert.equal(selectCharadesQuestion([charades], { categories: ['tahadani-016'], cursor: 0 }).id, 'charades-1'); assert.throws(() => createMatchQuestionSelection([charades], { categories: ['tahadani-016'], modality: 'charades', seed: 1 }), /separate-mode/i); const letters = [...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي'].slice(0, 25); const onePerLetter = letters.map((targetLetter) => ({ id: targetLetter, categoryId: 'tahadani-006', modality: 'classic' as const, targetLetter, answerConceptId: `concept:${targetLetter}`, headerAr: 'h', promptAr: 'p', canonicalAnswer: 'a', acceptedAnswers: ['b'] })); assert.throws(() => createMatchQuestionSelection(onePerLetter, { categories: ['tahadani-006'], modality: 'classic', seed: 1 }), /reserve/i); });
test('charades start, answer, complete, and rematch without a board or letter selectors', () => {
  const host: CanonicalMember = { uid: 'host', role: 'host', displayName: 'مضيف', ready: true, active: true };
  const question = { id: 'charades-1', categoryId: 'tahadani-016', modality: 'charades' as const, answerConceptId: 'concept:act', headerAr: 'تمثيل', promptAr: 'مثّل العبارة', canonicalAnswer: 'بحر', acceptedAnswers: ['بحر'] };
  const lobby = { ...room(), game: initialGameState(), config: { ...room().config, modality: 'charades' as const, categories: ['tahadani-016'] } };
  const started = reduceIntent(lobby, host, { type: 'START_MATCH', intentId: 'charades-start', expectedRevision: 2, payload: {} }, 1_000, question, [host]);
  assert.equal(started.room.game.lifecycle, 'QUESTION_READING'); assert.equal(started.room.game.board, undefined); assert.equal(started.room.game.activeCellId, undefined); assert.equal(started.room.activeQuestion?.id, question.id); assert.equal(JSON.stringify(projectRoom('r', started.room, [host], 'player', undefined, 1_000)).includes('canonicalAnswer'), false);
  assert.throws(() => reduceIntent(started.room, host, { type: 'SELECT_CELL', intentId: 'forbidden-cell', expectedRevision: 3, payload: { cellId: 'cell-0-0' } }, 1_000), /charades-no-letter-board/);
  const buzzed = reduceIntent(started.room, { ...player, ready: true, active: true }, { type: 'BUZZ', intentId: 'charades-buzz', expectedRevision: 3, payload: {} }, 1_001, undefined, [host, { ...player, ready: true, active: true }]);
  const completed = reduceIntent(buzzed.room, host, { type: 'JUDGE_CORRECT', intentId: 'charades-correct', expectedRevision: 4, payload: {} }, 1_002, undefined, [host, player]);
  assert.equal(completed.room.game.lifecycle, 'ROUND_COMPLETE'); assert.equal(completed.room.game.questionScores.horizontal, 1); assert.equal(completed.room.game.board, undefined);
  const rematchQuestion = { ...question, id: 'charades-2', answerConceptId: 'concept:other' };
  const rematch = reduceIntent(completed.room, host, { type: 'START_NEXT_ROUND', intentId: 'charades-next', expectedRevision: 5, payload: {} }, 1_004, rematchQuestion, [host]);
  assert.equal(rematch.room.game.lifecycle, 'QUESTION_READING'); assert.equal(rematch.room.game.currentRound, 2); assert.equal(rematch.room.game.board, undefined); assert.equal(rematch.room.activeQuestion?.id, 'charades-2');
});


test('manual lobby participants are host-managed, count toward readiness, and never expose manual IDs to players', () => {
  const host: CanonicalMember = { uid: 'host', role: 'host', displayName: 'مضيف', ready: true, active: true };
  const lobby = { ...room(), game: initialGameState() };
  const firstIntent = { type: 'LOBBY_ADD_MANUAL_PLAYER' as const, intentId: 'manual-one', expectedRevision: lobby.revision, payload: { displayName: 'لاعب يدوي', team: 'horizontal' } };
  assert.equal(validIntent(firstIntent), true);
  assert.equal(validIntent({ ...firstIntent, payload: { displayName: 'x', team: 'horizontal', extra: true } }), false);
  const first = reduceIntent(lobby, host, firstIntent, 1_000, undefined, [host], undefined, undefined, 'manual-one');
  assert.deepEqual(first.room.manualParticipants, [{ id: 'manual-one', displayName: 'لاعب يدوي', team: 'horizontal' }]);
  const secondIntent = { type: 'LOBBY_ADD_MANUAL_PLAYER' as const, intentId: 'manual-two', expectedRevision: first.room.revision, payload: { displayName: 'لاعب ثانٍ', team: 'vertical' } };
  const second = reduceIntent(first.room, host, secondIntent, 1_000, undefined, [host], undefined, undefined, 'manual-two');
  const hostProjection = projectRoom('room', second.room, [host], 'host', host.uid, 1_000).projection as { room: { memberCount: number; readyCount: number; canStart: boolean; members: Array<{ manualParticipantId?: string; participation?: string }> } };
  const playerProjection = projectRoom('room', second.room, [host], 'player', undefined, 1_000).projection;
  assert.equal(hostProjection.room.memberCount, 2);
  assert.equal(hostProjection.room.readyCount, 2);
  assert.equal(hostProjection.room.canStart, true);
  assert.deepEqual(hostProjection.room.members.filter((member) => member.participation === 'manual').map((member) => member.manualParticipantId), ['manual-one', 'manual-two']);
  assert.equal(JSON.stringify(playerProjection).includes('manual-one'), false);
  const moved = reduceIntent(second.room, host, { type: 'LOBBY_ASSIGN_TEAM', intentId: 'manual-move', expectedRevision: second.room.revision, payload: { manualParticipantId: 'manual-one', team: 'vertical' } }, 1_000, undefined, [host]);
  assert.equal(moved.room.manualParticipants?.find((participant) => participant.id === 'manual-one')?.team, 'vertical');
});
