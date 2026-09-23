import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthoritativeGameService, verifyPrivateQuestionMediaBytes } from '../../server/service.js';
import { findWinningPath, withOwner } from '../../src/features/game/domain/board.js';
import { canonicalChallengeJson } from '../../src/features/game/challenges/integration.js';

async function withService(run: (service: AuthoritativeGameService, dbPath: string) => Promise<void>, options: { boardNonce?: () => string } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'huroof-service-')); const dbPath = join(dir, 'rooms.sqlite'); const service = new AuthoritativeGameService({ dbPath, secret: 'test', ...options });
  try { await run(service, dbPath); } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
}
async function readyRoom(service: AuthoritativeGameService) {
  const host = service.create('host', true, { questionSeconds: 10, opponentSeconds: 10 }); const one = await service.join(host.roomCode, 'one'); const two = await service.join(host.roomCode, 'two'); let revision = two.revision;
  for (const player of [one, two]) { const result = await service.intent(host.roomId, player.token, { type: 'LOBBY_SET_READY', intentId: `ready-${revision}`, expectedRevision: revision, payload: { ready: true } }); revision = result.revision; }
  const hostIntent = async (type: string, payload: Record<string, unknown> = {}) => { const result = await service.intent(host.roomId, host.token, { type: type as never, intentId: `${type}-${revision}`, expectedRevision: revision, payload }); revision = result.revision; return result; };
  return { host, one, two, hostIntent, revision: () => revision };
}

test('current image media binds to the active question and excludes players, hidden audience, and stale bindings', async () => withService(async (service) => {
  const room = await readyRoom(service);
  await room.hostIntent('START_MATCH');
  await room.hostIntent('ROUND_READY');
  const board = service.metadata(room.host.roomId, room.host.token).projection.board!;
  await room.hostIntent('SELECT_CELL', { cellId: board.find((cell) => cell.kind === 'letter')!.id });
  const stored = service.store.load(room.host.roomId)!;
  const audience = service.createAudienceCapability(room.host.roomId);
  const mediaFixtures = [
    { mediaId: 'v18-011-001', assetSha256: 'e17ba1a51399bee8f086c41a9c1736543240c206e4e208027641fcbe153e701e', altAr: 'صورة السؤال' },
    { mediaId: 'v18-012-001', assetSha256: 'e181407175327841cca462e8dae064204108ed0234c4d41d71c0d91f3b208b5c', altAr: 'صورة السؤال' },
    { mediaId: 'v18-tahadani-014-001', assetSha256: '1ee18bdcdf48ebef738ff4b85985eaa5a37997c7e1f2f8ab677b048bf397d985', altAr: 'صورة السؤال' },
    { mediaId: 'v18-tahadani-061-001', assetSha256: '37b3fa0bde40f23072a4c98122135226849584f3010d32664c371006a019923b', altAr: 'صورة السؤال' },
  ];
  for (const media of mediaFixtures) {
    service.store.save({ ...stored, activeQuestion: { ...stored.activeQuestion!, modality: 'image', media } });
    assert.deepEqual((service.metadata(room.host.roomId, room.host.token).projection.question as { media?: unknown }).media, media);
    assert.deepEqual((service.metadata(room.host.roomId, audience).projection.question as { media?: unknown }).media, media);
    assert.equal((service.metadata(room.host.roomId, room.one.token).projection.question as { media?: unknown } | undefined)?.media, undefined);
    assert.throws(() => service.authorizeCurrentQuestionMedia(room.host.roomId, room.one.token, { mediaId: media.mediaId, assetSha256: media.assetSha256 }), /FORBIDDEN_ROLE/);
    assert.throws(() => service.authorizeCurrentQuestionMedia(room.host.roomId, audience, { mediaId: media.mediaId, assetSha256: 'a'.repeat(64) }), /MEDIA_BINDING_MISMATCH/);
    const issued = service.issueCurrentQuestionMedia(room.host.roomId, room.host.token, { mediaId: media.mediaId, assetSha256: media.assetSha256 });
    assert.match(issued.ticket, /\./);
    const file = await service.readCurrentQuestionMedia(issued.ticket, room.host.token);
    assert.equal(file.contentType, 'image/png'); assert.ok(file.bytes.length > 100);
    const mutated = Buffer.from(file.bytes); mutated[mutated.length - 1] ^= 1;
    assert.throws(() => verifyPrivateQuestionMediaBytes(mutated, media.assetSha256), /MEDIA_ASSET_HASH_MISMATCH/);
  }
  await room.hostIntent('SET_AUDIENCE_QUESTION_VISIBILITY', { showQuestion: false });
  const lastMedia = mediaFixtures.at(-1)!;
  assert.throws(() => service.authorizeCurrentQuestionMedia(room.host.roomId, audience, { mediaId: lastMedia.mediaId, assetSha256: lastMedia.assetSha256 }), /MEDIA_NOT_VISIBLE/);
}));

test('shared answer reveal is occurrence-bound, exposes only the clear video after reveal, and never restarts a buzzer', async () => withService(async (service) => {
  const room = await readyRoom(service);
  await room.hostIntent('START_MATCH');
  await room.hostIntent('ROUND_READY');
  const cell = service.metadata(room.host.roomId, room.host.token).projection.board!.find((item) => item.kind === 'letter')!;
  await room.hostIntent('SELECT_CELL', { cellId: cell.id });
  const stored = service.store.load(room.host.roomId)!;
  const prompt = { mediaId: 'goal-quiz-2026:001:blur', assetSha256: '761991311fd4d5ee4d9f27c703d867b6d9259b175ff7c3f0f55b91ad4b251d69', altAr: 'مقطع السؤال', type: 'video' as const, contentType: 'video/mp4' };
  const answer = { mediaId: 'goal-quiz-2026:001:clean', assetSha256: '18ff5ba7aa3ab152ac8b20f2210a9753e2e107a4c9e4db23667816ddffdda159', altAr: 'مقطع الإجابة', type: 'video' as const, contentType: 'video/mp4' };
  service.store.save({ ...stored, activeQuestion: { ...stored.activeQuestion!, modality: 'video', media: prompt, answerMedia: answer } });
  const audience = service.createAudienceCapability(room.host.roomId);
  const before = service.metadata(room.host.roomId, audience).projection.question as { occurrence?: string; media?: unknown };
  assert.deepEqual(before.media, prompt);
  assert.equal(JSON.stringify(service.metadata(room.host.roomId, room.one.token).projection).includes(answer.mediaId), false);
  const scoreBefore = service.metadata(room.host.roomId, room.host.token).projection.questionScores;
  await assert.rejects(() => service.intent(room.host.roomId, room.one.token, { type: 'REVEAL_ANSWER', intentId: 'player-reveal', expectedRevision: room.revision(), payload: { occurrence: before.occurrence } }), /FORBIDDEN_ROLE/);
  await assert.rejects(() => service.intent(room.host.roomId, room.host.token, { type: 'REVEAL_ANSWER', intentId: 'stale-reveal', expectedRevision: room.revision(), payload: { occurrence: 'stale-occurrence' } }), /STALE_QUESTION_OCCURRENCE/);
  const revealed = await room.hostIntent('REVEAL_ANSWER', { occurrence: before.occurrence });
  assert.deepEqual((revealed.projection.projection.question as { media?: unknown }).media, answer);
  assert.deepEqual((service.metadata(room.host.roomId, audience).projection.question as { media?: unknown }).media, answer);
  assert.equal((revealed.projection.projection.question as { revealedAnswer?: string }).revealedAnswer, stored.activeQuestion?.canonicalAnswer);
  assert.equal((service.metadata(room.host.roomId, audience).projection.question as { revealedAnswer?: string }).revealedAnswer, stored.activeQuestion?.canonicalAnswer);
  assert.equal((service.metadata(room.host.roomId, room.one.token).projection.question as { revealedAnswer?: string }).revealedAnswer, undefined);
  assert.equal(revealed.projection.projection.buzzOpen, undefined);
  assert.deepEqual(revealed.projection.projection.questionScores, scoreBefore);
  assert.throws(() => service.authorizeCurrentQuestionMedia(room.host.roomId, audience, { mediaId: prompt.mediaId, assetSha256: prompt.assetSha256 }), /MEDIA_BINDING_MISMATCH/);
  const issued = service.issueCurrentQuestionMedia(room.host.roomId, audience, { mediaId: answer.mediaId, assetSha256: answer.assetSha256 });
  assert.equal((await service.readCurrentQuestionMedia(issued.ticket, audience)).contentType, 'video/mp4');
  const replay = await service.intent(room.host.roomId, room.host.token, { type: 'REVEAL_ANSWER', intentId: `REVEAL_ANSWER-${room.revision() - 1}`, expectedRevision: room.revision() - 1, payload: { occurrence: before.occurrence } });
  assert.equal(replay.replayed, true);
  const opened = await room.hostIntent('OPEN_QUESTION');
  assert.equal(opened.projection.projection.buzzOpen, undefined);
  assert.equal(service.store.load(room.host.roomId)?.deadlineAt, undefined);
  await room.hostIntent('HOST_SELECT_TEAM', { team: 'horizontal' });
  const incorrect = await room.hostIntent('JUDGE_INCORRECT');
  assert.equal(incorrect.projection.projection.room.state, 'OPPONENT_CHANCE');
  assert.equal(incorrect.projection.projection.buzzOpen, undefined);
  await room.hostIntent('PAUSE');
  const resumed = await room.hostIntent('RESUME');
  assert.equal(resumed.projection.projection.room.state, 'OPPONENT_CHANCE');
  assert.equal(resumed.projection.projection.buzzOpen, undefined);
  const inactive = { ...service.store.load(room.host.roomId)!, game: { ...service.store.load(room.host.roomId)!.game, lifecycle: 'CELL_SELECTION' as const } };
  service.store.save(inactive);
  assert.throws(() => service.authorizeCurrentQuestionMedia(room.host.roomId, room.host.token, { mediaId: answer.mediaId, assetSha256: answer.assetSha256 }), /MEDIA_NOT_VISIBLE/);
}));

test('legacy local questions with no occurrence are unrevealed and keep clear video bindings private', async () => withService(async (service) => {
  const room = await readyRoom(service);
  await room.hostIntent('START_MATCH'); await room.hostIntent('ROUND_READY');
  const cell = service.metadata(room.host.roomId, room.host.token).projection.board!.find((item) => item.kind === 'letter')!;
  await room.hostIntent('SELECT_CELL', { cellId: cell.id });
  const prompt = { mediaId: 'goal-quiz-2026:001:blur', assetSha256: '761991311fd4d5ee4d9f27c703d867b6d9259b175ff7c3f0f55b91ad4b251d69', altAr: 'مقطع السؤال', type: 'video' as const, contentType: 'video/mp4' };
  const clear = { mediaId: 'goal-quiz-2026:001:clean', assetSha256: '18ff5ba7aa3ab152ac8b20f2210a9753e2e107a4c9e4db23667816ddffdda159', altAr: 'مقطع الإجابة', type: 'video' as const, contentType: 'video/mp4' };
  const stored = service.store.load(room.host.roomId)!;
  service.store.save({ ...stored, activeQuestionOccurrence: undefined, answerRevealedOccurrence: undefined, activeQuestion: { ...stored.activeQuestion!, modality: 'video', canonicalAnswer: 'إجابة سرية', media: prompt, answerMedia: clear } });
  const audience = service.createAudienceCapability(room.host.roomId);
  const projected = service.metadata(room.host.roomId, audience).projection.question as { revealedAnswer?: string; media?: unknown };
  assert.equal(projected.revealedAnswer, undefined);
  assert.deepEqual(projected.media, prompt);
  assert.throws(() => service.authorizeCurrentQuestionMedia(room.host.roomId, audience, { mediaId: clear.mediaId, assetSha256: clear.assetSha256 }), /MEDIA_BINDING_MISMATCH/);
}));

test('host-only demo rooms start, while any partial player roster still requires ready teams', async () => withService(async (service) => {
  assert.throws(() => service.create('host', false), /NO_APPROVED_QUESTION_STOCK/);
  const soloDemo = service.create('host', true); const soloStart = await service.intent(soloDemo.roomId, soloDemo.token, { type: 'START_MATCH', intentId: 'solo-demo', expectedRevision: soloDemo.revision, payload: {} }); assert.equal(soloStart.projection.projection.room.state, 'ROUND_SETUP'); assert.equal(soloStart.projection.projection.room.readyCount, 0); assert.equal(soloStart.projection.projection.room.memberCount, 0);
  const host = service.create('host', true); const one = await service.join(host.roomCode, 'one');
  await assert.rejects(() => service.intent(host.roomId, host.token, { type: 'START_MATCH', intentId: 'early', expectedRevision: one.revision, payload: {} }), /LOBBY_NEEDS_TWO_TEAMS/);
  const two = await service.join(host.roomCode, 'two');
  await assert.rejects(() => service.intent(host.roomId, host.token, { type: 'START_MATCH', intentId: 'unready', expectedRevision: two.revision, payload: {} }), /LOBBY_ALL_MEMBERS_MUST_BE_READY/);
}));

test('only the host can persist the audience-question visibility preference, while legacy/default rooms remain visible', async () => withService(async (service) => {
  const host = service.create('host', true);
  const player = await service.join(host.roomCode, 'player');
  const audienceToken = service.createAudienceCapability(host.roomId);
  assert.equal(service.metadata(host.roomId, audienceToken).projection.room.audienceQuestionVisible, true);

  await assert.rejects(() => service.intent(host.roomId, player.token, { type: 'SET_AUDIENCE_QUESTION_VISIBILITY' as never, intentId: 'player-visibility', expectedRevision: player.revision, payload: { showQuestion: false } }), /FORBIDDEN_ROLE/);
  await assert.rejects(() => service.intent(host.roomId, host.token, { type: 'SET_AUDIENCE_QUESTION_VISIBILITY' as never, intentId: 'bad-visibility', expectedRevision: player.revision, payload: { showQuestion: 'false' } }), /INVALID_INTENT/);
  await assert.rejects(() => service.intent(host.roomId, host.token, { type: 'SET_AUDIENCE_QUESTION_VISIBILITY' as never, intentId: 'extra-visibility', expectedRevision: player.revision, payload: { showQuestion: false, extra: true } }), /INVALID_INTENT/);

  const changed = await service.intent(host.roomId, host.token, { type: 'SET_AUDIENCE_QUESTION_VISIBILITY' as never, intentId: 'host-visibility', expectedRevision: player.revision, payload: { showQuestion: false } });
  assert.equal(changed.projection.projection.room.audienceQuestionVisible, false);
  assert.equal(service.metadata(host.roomId, audienceToken).projection.room.audienceQuestionVisible, false);
}));

test('host assigns active lobby players by UID, resets only changed-team readiness, and keeps roster IDs private', async () => withService(async (service) => {
  const host = service.create('host', true);
  const first = await service.join(host.roomCode, 'اسم مكرر');
  const second = await service.join(host.roomCode, 'اسم مكرر');
  let revision = second.revision;
  const firstUid = service.metadata(host.roomId, first.token).projection.self!.uid;
  const secondUid = service.metadata(host.roomId, second.token).projection.self!.uid;

  const ready = await service.intent(host.roomId, first.token, { type: 'LOBBY_SET_READY', intentId: 'ready-first', expectedRevision: revision, payload: { ready: true } });
  revision = ready.revision;
  await assert.rejects(() => service.intent(host.roomId, first.token, { type: 'LOBBY_ASSIGN_TEAM', intentId: 'player-assign', expectedRevision: revision, payload: { memberUid: secondUid, team: 'horizontal' } }), /FORBIDDEN_ROLE/);
  const moved = await service.intent(host.roomId, host.token, { type: 'LOBBY_ASSIGN_TEAM', intentId: 'move-first', expectedRevision: revision, payload: { memberUid: firstUid, team: 'vertical' } });
  revision = moved.revision;
  const hostMembers = moved.projection.projection.room.members!;
  assert.equal(hostMembers.find((member) => member.uid === firstUid)?.team, 'vertical');
  assert.equal(hostMembers.find((member) => member.uid === firstUid)?.ready, false);
  const playerMembers = service.metadata(host.roomId, first.token).projection.room.members!;
  const audienceMembers = service.metadata(host.roomId, service.createAudienceCapability(host.roomId)).projection.room.members!;
  assert.equal(playerMembers.some((member) => member.uid), false);
  assert.equal(audienceMembers.some((member) => member.uid), false);

  const restored = await service.intent(host.roomId, first.token, { type: 'LOBBY_SET_READY', intentId: 'ready-again', expectedRevision: revision, payload: { ready: true } });
  revision = restored.revision;
  const sameTeamRevision = revision;
  const sameTeam = await service.intent(host.roomId, host.token, { type: 'LOBBY_ASSIGN_TEAM', intentId: 'same-team', expectedRevision: sameTeamRevision, payload: { memberUid: firstUid, team: 'vertical' } });
  revision = sameTeam.revision;
  assert.equal(sameTeam.projection.projection.room.members!.find((member) => member.uid === firstUid)?.ready, true);
  const replay = await service.intent(host.roomId, host.token, { type: 'LOBBY_ASSIGN_TEAM', intentId: 'same-team', expectedRevision: sameTeamRevision, payload: { memberUid: firstUid, team: 'vertical' } });
  assert.equal(replay.replayed, true);
  await assert.rejects(() => service.intent(host.roomId, host.token, { type: 'LOBBY_ASSIGN_TEAM', intentId: 'bad-team', expectedRevision: revision, payload: { memberUid: firstUid, team: 'diagonal' } }), /INVALID_INTENT/);
  await assert.rejects(() => service.intent(host.roomId, host.token, { type: 'LOBBY_ASSIGN_TEAM', intentId: 'extra-field', expectedRevision: revision, payload: { memberUid: firstUid, team: 'vertical', other: true } }), /INVALID_INTENT/);
  await assert.rejects(() => service.intent(host.roomId, host.token, { type: 'LOBBY_ASSIGN_TEAM', intentId: 'missing', expectedRevision: revision, payload: { memberUid: 'missing', team: 'horizontal' } }), /LOBBY_ASSIGNMENT_TARGET_INVALID/);
  const secondAssigned = await service.intent(host.roomId, host.token, { type: 'LOBBY_ASSIGN_TEAM', intentId: 'move-second', expectedRevision: revision, payload: { memberUid: secondUid, team: 'horizontal' } });
  revision = secondAssigned.revision;
  const secondReady = await service.intent(host.roomId, second.token, { type: 'LOBBY_SET_READY', intentId: 'ready-second', expectedRevision: revision, payload: { ready: true } });
  revision = secondReady.revision;
  const started = await service.intent(host.roomId, host.token, { type: 'START_MATCH', intentId: 'start', expectedRevision: revision, payload: {} });
  const boardBeforeLiveMove = started.projection.projection.board;
  const liveMove = await service.intent(host.roomId, host.token, { type: 'LOBBY_ASSIGN_TEAM', intentId: 'after-start', expectedRevision: started.revision, payload: { memberUid: secondUid, team: 'vertical' } });
  assert.equal(liveMove.projection.projection.room.members!.find((member) => member.uid === secondUid)?.team, 'vertical');
  assert.equal(liveMove.projection.projection.room.members!.find((member) => member.uid === secondUid)?.ready, true);
  assert.deepEqual(liveMove.projection.projection.board, boardBeforeLiveMove);
  const question = await service.intent(host.roomId, host.token, { type: 'ROUND_READY', intentId: 'round-ready', expectedRevision: liveMove.revision, payload: {} });
  const answering = await service.intent(host.roomId, host.token, { type: 'SELECT_CELL', intentId: 'select-cell', expectedRevision: question.revision, payload: { cellId: 'cell-0-0' } });
  await assert.rejects(() => service.intent(host.roomId, host.token, { type: 'LOBBY_ASSIGN_TEAM', intentId: 'during-question', expectedRevision: answering.revision, payload: { memberUid: secondUid, team: 'horizontal' } }), /LOBBY_ASSIGNMENT_NOT_ALLOWED/);
  await assert.rejects(() => service.intent(host.roomId, first.token, { type: 'LOBBY_SET_READY', intentId: 'ready-after-start', expectedRevision: answering.revision, payload: { ready: false } }), /READY_NOT_ALLOWED/);
}));

test('room creation rejects a category scope that cannot fill the complete letter board', async () => withService(async (service) => {
  assert.throws(
    () => service.create('host', true, { categories: ['tahadani-001'] }),
    /QUESTION_SCOPE_INSUFFICIENT_COVERAGE/,
  );
  const playable = service.create('host', true, { categories: ['tahadani-006'] });
  const started = await service.intent(playable.roomId, playable.token, { type: 'START_MATCH', intentId: 'start-playable-scope', expectedRevision: playable.revision, payload: {} });
  assert.equal(started.projection.projection.room.state, 'ROUND_SETUP');
}));

test('category rooms use the real demo scope, expose only labels, and reserve a different replacement after failure', async () => withService(async (service) => {
  const created = service.create('host', true, { gameKind: 'categories', categories: ['tahadani-006', 'tahadani-007'] });
  let revision = created.revision;
  const hostIntent = async (type: string, payload: Record<string, unknown> = {}) => {
    const result = await service.intent(created.roomId, created.token, { type: type as never, intentId: `${type}-${revision}`, expectedRevision: revision, payload });
    revision = result.revision;
    return result;
  };
  await hostIntent('START_MATCH'); await hostIntent('ROUND_READY');
  const before = service.metadata(created.roomId, created.token).projection.board![0];
  assert.equal(before.kind, 'category'); assert.ok(before.categoryLabelAr);
  const selected = await hostIntent('SELECT_CELL', { cellId: before.id });
  assert.equal(selected.projection.projection.room.state, 'QUESTION_READING');
  await hostIntent('HOST_SELECT_TEAM', { team: 'horizontal' }); await hostIntent('JUDGE_INCORRECT');
  await hostIntent('HOST_SELECT_TEAM', { team: 'vertical' }); const failed = await hostIntent('JUDGE_INCORRECT');
  assert.equal(failed.projection.projection.room.state, 'QUESTION_FAILED');
  const replacement = await hostIntent('RETURN_CELL');
  const after = replacement.projection.projection.board!.find((cell) => cell.id === before.id)!;
  assert.notEqual(after.categoryId, before.categoryId);
  assert.equal(replacement.projection.projection.room.state, 'CELL_SELECTION');
  assert.equal(JSON.stringify(service.metadata(created.roomId, service.createAudienceCapability(created.roomId)).projection).includes('answerConceptId'), false);
}));

test('host team selection follows buzz lifecycle and keeps its public marker UID-free', async () => withService(async (service) => {
  const host = service.create('host', true); let revision = host.revision;
  const intent = async (type: string, payload: Record<string, unknown> = {}) => { const result = await service.intent(host.roomId, host.token, { type: type as never, intentId: `${type}-${revision}`, expectedRevision: revision, payload }); revision = result.revision; return result; };
  await intent('START_MATCH'); await intent('ROUND_READY'); const cell = service.metadata(host.roomId, host.token).projection.board![0]; await intent('SELECT_CELL', { cellId: cell.id }); const selected = await intent('HOST_SELECT_TEAM', { team: 'horizontal' });
  assert.equal(selected.projection.projection.room.state, 'FIRST_ANSWER'); assert.equal(selected.projection.projection.answeringTeam, 'horizontal'); assert.deepEqual(selected.projection.projection.buzzWinner, { displayName: 'فريق ↔', team: 'horizontal', method: 'host' }); assert.equal(JSON.stringify(selected.projection.projection.buzzWinner).includes('uid'), false);
  await intent('JUDGE_INCORRECT'); await assert.rejects(() => service.intent(host.roomId, host.token, { type: 'HOST_SELECT_TEAM', intentId: 'wrong-team', expectedRevision: revision, payload: { team: 'horizontal' } }), /HOST_TEAM_SELECTION_NOT_ALLOWED/); const opponent = await intent('HOST_SELECT_TEAM', { team: 'vertical' }); assert.equal(opponent.projection.projection.answeringTeam, 'vertical');
}));

test('selecting a regular cell atomically reveals its question and opens the buzzer', async () => withService(async (service) => {
  const room = await readyRoom(service);
  await room.hostIntent('START_MATCH');
  await room.hostIntent('ROUND_READY');
  const cell = service.metadata(room.host.roomId, room.host.token).projection.board!.find((item) => item.kind === 'letter')!;
  const selected = await room.hostIntent('SELECT_CELL', { cellId: cell.id });
  const hostQuestion = (selected.projection.projection as { question?: { headerAr?: string; promptAr?: string; primaryAnswer?: string } }).question;
  assert.ok(hostQuestion?.headerAr?.trim());
  assert.ok(hostQuestion?.promptAr?.trim());
  assert.ok(hostQuestion?.primaryAnswer?.trim());
  assert.equal(selected.projection.projection.room.state, 'QUESTION_READING');
  assert.equal(selected.projection.projection.buzzOpen, true);
  assert.ok(selected.projection.projection.deadlineAt);
  for (const token of [room.one.token, service.createAudienceCapability(room.host.roomId)]) {
    const publicProjection = service.metadata(room.host.roomId, token).projection as { question?: { headerAr?: string } };
    assert.equal(publicProjection.question?.headerAr, hostQuestion?.headerAr);
    assert.equal(JSON.stringify(publicProjection).includes('primaryAnswer'), false);
  }
}));

test('new rooms fix the v2 rule while preserving rematch-safe categories and difficulty', async () => withService(async (service) => {
  const created = service.create('host', true, {
    bestOf: 5,
    questionSeconds: 35,
    opponentSeconds: 15,
    categories: ['tahadani-006', 'tahadani-012'],
    difficulty: 'hard',
    mode: 'custom',
  });
  const projection = service.metadata(created.roomId, created.token).projection;
  assert.deepEqual(projection.room.matchSettings, {
    demo: true,
    gameKind: 'huroof',
    questionSeconds: 35,
    opponentSeconds: 15,
    teams: { horizontal: 'فريق ↔', vertical: 'فريق ↕' },
    categories: ['tahadani-006', 'tahadani-012'],
    modality: 'classic',
    difficulty: 'hard',
    mode: 'custom',
    showQuestionOnAudience: true,
    labelledColours: false,
  });
  assert.deepEqual(projection.matchRule, { ruleSet: 'v2', victoryAr: 'تنتهي المباراة بفوز فريق بجولتين متتاليتين أو بثلاث جولات إجمالاً' });
  assert.equal(JSON.stringify(projection).includes('bestOf'), false);
}));

test('labelled-colour setting is persisted at room creation and remains fixed after start', async () => withService(async (service) => {
  const created = service.create('host', true, { categories: ['tahadani-006', 'tahadani-012'], labelledColours: true });
  assert.equal(service.metadata(created.roomId, created.token).projection.room.matchSettings?.labelledColours, true);
  const started = await service.intent(created.roomId, created.token, { type: 'START_MATCH', intentId: 'labelled-start', expectedRevision: created.revision, payload: {} });
  assert.equal(started.projection.projection.room.matchSettings?.labelledColours, true);
  const defaultRoom = service.create('host', true, { categories: ['tahadani-006', 'tahadani-012'] });
  assert.equal(service.metadata(defaultRoom.roomId, defaultRoom.token).projection.room.matchSettings?.labelledColours, false);
}));

test('JSON persistence upgrades untouched legacy lobbies to v2 and explicitly grandfathers started legacy rooms', async () => withService(async (service) => {
  const created = service.create('host', true); const lobby = service.store.load(created.roomId)!;
  const legacyLobby = lobby as unknown as Record<string, unknown>;
  delete legacyLobby.roomSchemaVersion; delete legacyLobby.ruleSet;
  legacyLobby.config = { ...(lobby.config as object), bestOf: 7 };
  legacyLobby.game = { lifecycle: 'LOBBY', entitledTeam: 'horizontal', attempt: 'initial', points: { horizontal: 0, vertical: 0 }, roundWins: { horizontal: 0, vertical: 0 } };
  service.store.save(legacyLobby as never);
  assert.equal(service.metadata(created.roomId, created.token).projection.matchRule?.ruleSet, 'v2');
  const upgradedLobby = service.store.load(created.roomId)!;
  assert.ok(upgradedLobby.boardNonce); assert.equal(upgradedLobby.boardSequence, 0);

  const started = service.store.load(created.roomId)! as unknown as Record<string, unknown>;
  delete started.roomSchemaVersion; delete started.ruleSet;
  started.game = { lifecycle: 'CELL_SELECTION', entitledTeam: 'horizontal', attempt: 'initial', points: { horizontal: 4, vertical: 2 }, roundWins: { horizontal: 1, vertical: 0 } };
  service.store.save(started as never);
  const projection = service.metadata(created.roomId, created.token).projection;
  assert.equal(projection.matchRule?.ruleSet, 'legacy-v1'); assert.deepEqual(projection.roundResults, []); assert.deepEqual(projection.questionScores, { horizontal: 4, vertical: 2 });
}));

test('local commit rolls back room writes with a duplicate receipt and safely replays exact legacy receipt JSON', async () => withService(async (service) => {
  const created = service.create('host', true);
  const before = service.store.load(created.roomId)!;
  const at = new Date().toISOString();
  service.store.recordReceipt(created.roomId, 'host', 'durable-receipt', 'first-hash', before.revision, at);
  assert.throws(
    () => service.store.commit({ ...before, revision: before.revision + 1 }, { type: 'SHOULD_ROLL_BACK' }, at, { actorUid: 'host', intentId: 'durable-receipt', requestHash: 'second-hash' }),
    /UNIQUE|constraint/i,
  );
  assert.equal(service.store.load(created.roomId)!.revision, before.revision);
  assert.deepEqual(service.store.receipt(created.roomId, 'host', 'durable-receipt'), { requestHash: 'first-hash', revision: before.revision });

  const actor = service.verify(created.token)!.uid;
  const legacyIntent = { type: 'START_MATCH' as const, intentId: 'legacy-replay', expectedRevision: before.revision, payload: {} };
  const legacyJson = JSON.stringify({ type: legacyIntent.type, expectedRevision: legacyIntent.expectedRevision, payload: {} });
  service.store.save({
    ...before,
    intentIds: { [`${actor}:${legacyIntent.intentId}`]: before.revision },
    intentHashes: { [`${actor}:${legacyIntent.intentId}`]: legacyJson },
  });
  const replay = await service.intent(created.roomId, created.token, legacyIntent);
  assert.equal(replay.replayed, true);
  await assert.rejects(
    () => service.intent(created.roomId, created.token, { ...legacyIntent, expectedRevision: before.revision + 1 }),
    /INTENT_ID_REUSED/,
  );
}));

test('pause preserves an open authoritative timer and resume expires only after the saved remainder', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'huroof-paused-timer-')); const dbPath = join(dir, 'rooms.sqlite'); let now = new Date('2026-09-04T00:00:00.000Z'); const service = new AuthoritativeGameService({ dbPath, secret: 'test', clock: () => now });
  try {
    const room = await readyRoom(service); await room.hostIntent('START_MATCH'); await room.hostIntent('ROUND_READY'); await room.hostIntent('SELECT_CELL', { cellId: 'cell-0-0' });
    now = new Date(now.getTime() + 3_000); await room.hostIntent('PAUSE'); const paused = service.store.load(room.host.roomId)!; assert.equal(paused.game.lifecycle, 'PAUSED'); assert.equal(paused.deadlineAt, undefined); assert.equal(paused.buzzOpen, false); assert.deepEqual(paused.pausedTimer, { remainingMs: 7_000, buzzOpen: true });
    now = new Date(now.getTime() + 60_000); assert.deepEqual(await service.tick(), []); await room.hostIntent('RESUME'); const resumed = service.metadata(room.host.roomId, room.host.token).projection; assert.equal(resumed.room.state, 'QUESTION_READING'); assert.equal(resumed.buzzOpen, true); assert.equal(Date.parse(resumed.deadlineAt!), now.getTime() + 7_000);
    now = new Date(now.getTime() + 6_999); assert.deepEqual(await service.tick(), []); now = new Date(now.getTime() + 1); assert.deepEqual(await service.tick(), [room.host.roomId]); assert.equal(service.metadata(room.host.roomId, room.host.token).projection.room.state, 'QUESTION_FAILED');
  } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
});

test('an unanswered question can reveal its answer, return to selection, and open a different unused cell', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'huroof-unanswered-continue-'));
  const dbPath = join(dir, 'rooms.sqlite');
  let now = new Date('2026-09-11T00:00:00.000Z');
  const service = new AuthoritativeGameService({ dbPath, secret: 'test', clock: () => now });
  try {
    const room = await readyRoom(service);
    await room.hostIntent('START_MATCH');
    await room.hostIntent('ROUND_READY');
    const firstCell = service.metadata(room.host.roomId, room.host.token).projection.board!.find((cell) => cell.kind === 'letter')!;
    await room.hostIntent('SELECT_CELL', { cellId: firstCell.id });
    const unanswered = service.store.load(room.host.roomId)!;
    const firstQuestionId = unanswered.activeQuestion!.id;
    const firstOccurrence = unanswered.activeQuestionOccurrence!;

    now = new Date(now.getTime() + 11_000);
    assert.deepEqual(await service.tick(), [room.host.roomId]);
    const failed = service.metadata(room.host.roomId, room.host.token).projection;
    assert.equal(failed.room.state, 'QUESTION_FAILED');
    assert.equal(failed.buzzOpen, undefined);

    const revealed = await room.hostIntent('REVEAL_ANSWER', { occurrence: firstOccurrence });
    assert.ok((revealed.projection.projection.question as { revealedAnswer?: string }).revealedAnswer);
    const continued = await room.hostIntent('RETRY_CELL');
    assert.equal(continued.projection.projection.room.state, 'CELL_SELECTION');
    assert.equal(service.store.load(room.host.roomId)?.activeQuestion, undefined);

    const nextCell = continued.projection.projection.board!.find((cell) => cell.id !== firstCell.id && !cell.owner)!;
    const nextQuestion = await room.hostIntent('SELECT_CELL', { cellId: nextCell.id });
    assert.equal(nextQuestion.projection.projection.room.state, 'QUESTION_READING');
    assert.equal(service.store.load(room.host.roomId)?.game.activeCellId, nextCell.id);
    assert.notEqual(service.store.load(room.host.roomId)?.activeQuestion?.id, firstQuestionId);
  } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
});

test('demo projections permanently mark drafts and keep answer-bearing fields host-only', async () => withService(async (service) => {
  const room = await readyRoom(service); await room.hostIntent('START_MATCH'); await room.hostIntent('ROUND_READY'); await room.hostIntent('SELECT_CELL', { cellId: 'cell-0-0' });
  const hostProjection = service.metadata(room.host.roomId, room.host.token); const playerProjection = service.metadata(room.host.roomId, room.one.token); const audienceProjection = service.metadata(room.host.roomId, service.createAudienceCapability(room.host.roomId));
  for (const projection of [playerProjection, audienceProjection]) for (const privateKey of ['primaryAnswer', 'acceptedAnswers', 'sources', 'moderation', 'canonicalAnswer']) assert.equal(JSON.stringify(projection).includes(privateKey), false, privateKey);
  assert.match(JSON.stringify(hostProjection), /primaryAnswer/); assert.equal(playerProjection.projection.demo, true); assert.equal(audienceProjection.projection.demo, true);
}));

test('surprises reveal a real unused letter; early/racing buzzes, wrong-to-opponent, timeout, pause, and correction remain authoritative', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'huroof-deadline-')); const dbPath = join(dir, 'rooms.sqlite'); let now = new Date('2026-09-03T00:00:00Z'); const service = new AuthoritativeGameService({ dbPath, secret: 'test', clock: () => now });
  try {
    const room = await readyRoom(service); await room.hostIntent('START_MATCH'); await room.hostIntent('ROUND_READY');
    const board = service.metadata(room.host.roomId, room.host.token).projection.board!; const surprise = board.find((cell) => cell.kind === 'surprise')!; const visible = new Set(board.filter((cell) => cell.kind === 'letter').map((cell) => cell.visibleValue));
    const opened = await room.hostIntent('SELECT_CELL', { cellId: surprise.id }); const revealed = service.metadata(room.host.roomId, room.host.token).projection.board!.find((cell) => cell.id === surprise.id)!; assert.ok(revealed.revealedLetter); assert.equal(visible.has(revealed.revealedLetter!), false); assert.equal(opened.projection.projection.buzzOpen, true);
    const revision = room.revision(); const race = await Promise.all([service.intent(room.host.roomId, room.one.token, { type: 'BUZZ', intentId: 'race-one', expectedRevision: revision, payload: {} }), service.intent(room.host.roomId, room.two.token, { type: 'BUZZ', intentId: 'race-two', expectedRevision: revision, payload: {} })]); assert.equal(race.filter((result) => !result.stale).length, 1);
    const winner = race[0].stale ? room.two : room.one; const loser = winner === room.one ? room.two : room.one; let current = service.metadata(room.host.roomId, room.host.token).revision;
    const hostIntent = async (type: string, payload: Record<string, unknown> = {}) => { const result = await service.intent(room.host.roomId, room.host.token, { type: type as never, intentId: `${type}-${current}`, expectedRevision: current, payload }); current = result.revision; return result; };
    await hostIntent('JUDGE_INCORRECT'); const opponent = await service.intent(room.host.roomId, loser.token, { type: 'BUZZ', intentId: 'opponent', expectedRevision: current, payload: {} }); current = opponent.revision; await hostIntent('JUDGE_CORRECT'); assert.equal(service.metadata(room.host.roomId, room.host.token).projection.questionScores?.[loser === room.one ? 'horizontal' : 'vertical'], 1); await hostIntent('PAUSE'); await hostIntent('RESUME'); await hostIntent('BEGIN_CORRECTION', { cellId: surprise.id, owner: undefined, reason: 'حكم' }); await hostIntent('CONFIRM_CORRECTION');
    await hostIntent('SELECT_CELL', { cellId: 'cell-0-1' }); now = new Date(now.getTime() + 11_000); assert.equal((await service.tick()).includes(room.host.roomId), true); assert.equal(service.metadata(room.host.roomId, room.host.token).projection.room.state, 'QUESTION_FAILED'); current = service.metadata(room.host.roomId, room.host.token).revision; const continued = await hostIntent('RETRY_CELL'); assert.equal(continued.projection.projection.room.state, 'CELL_SELECTION'); assert.equal(continued.projection.projection.buzzOpen, undefined);
  } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
});

test('idempotent stale intents and reconnect retain identity and the latest projection', async () => withService(async (service, dbPath) => {
  const room = await readyRoom(service); await room.hostIntent('START_MATCH'); const sameRevision = room.revision(); const first = await service.intent(room.host.roomId, room.host.token, { type: 'ROUND_READY', intentId: 'same', expectedRevision: sameRevision, payload: {} }); const replay = await service.intent(room.host.roomId, room.host.token, { type: 'ROUND_READY', intentId: 'same', expectedRevision: sameRevision, payload: {} }); assert.equal(replay.replayed, true); assert.equal(first.revision, replay.revision);
  const stale = await service.intent(room.host.roomId, room.host.token, { type: 'PAUSE', intentId: 'stale', expectedRevision: 1, payload: {} }); assert.equal(stale.stale, true);
  const recovered = new AuthoritativeGameService({ dbPath, secret: 'test' }); try { assert.equal(recovered.metadata(room.host.roomId, room.one.token).projection.self?.uid, service.metadata(room.host.roomId, room.one.token).projection.self?.uid); } finally { recovered.close(); }
}));

test('a correct judgment finalizes exactly once; replay and stale requests cannot duplicate it', async () => withService(async (service, dbPath) => {
  const room = await readyRoom(service); let revision = room.revision();
  const hostIntent = async (type: string, id: string, payload: Record<string, unknown> = {}) => {
    const result = await service.intent(room.host.roomId, room.host.token, { type: type as never, intentId: id, expectedRevision: revision, payload }); revision = result.revision; return result;
  };
  await hostIntent('START_MATCH', 'start'); await hostIntent('ROUND_READY', 'ready'); await hostIntent('SELECT_CELL', 'select', { cellId: 'cell-0-0' });
  const buzz = await service.intent(room.host.roomId, room.one.token, { type: 'BUZZ', intentId: 'buzz', expectedRevision: revision, payload: {} }); revision = buzz.revision;
  const beforeCorrect = revision;
  const awarded = await hostIntent('JUDGE_CORRECT', 'correct');
  assert.deepEqual(awarded.projection.projection.questionScores, { horizontal: 1, vertical: 0 }); assert.equal(awarded.projection.projection.room.state, 'CELL_SELECTION');
  const replay = await service.intent(room.host.roomId, room.host.token, { type: 'JUDGE_CORRECT', intentId: 'correct', expectedRevision: beforeCorrect, payload: {} });
  assert.equal(replay.replayed, true); assert.deepEqual(replay.projection.projection.questionScores, { horizontal: 1, vertical: 0 });
  const stale = await service.intent(room.host.roomId, room.host.token, { type: 'JUDGE_CORRECT', intentId: 'correct-stale', expectedRevision: beforeCorrect, payload: {} });
  assert.equal(stale.stale, true); assert.deepEqual(stale.projection.projection.questionScores, { horizontal: 1, vertical: 0 });
  const persistedJson = JSON.stringify(service.store.load(room.host.roomId)!);
  assert.equal(persistedJson.includes('intentHashes'), false);
  assert.equal(persistedJson.includes('intentIds'), false);
  const recovered = new AuthoritativeGameService({ dbPath, secret: 'test' });
  try {
    assert.deepEqual(recovered.metadata(room.host.roomId, room.host.token).projection.questionScores, { horizontal: 1, vertical: 0 });
    const replayAfterRestart = await recovered.intent(room.host.roomId, room.host.token, { type: 'JUDGE_CORRECT', intentId: 'correct', expectedRevision: beforeCorrect, payload: {} });
    assert.equal(replayAfterRestart.replayed, true);
    assert.deepEqual(replayAfterRestart.projection.projection.questionScores, { horizontal: 1, vertical: 0 });
  } finally { recovered.close(); }
}));

test('next round receives a fresh diverse board with no inherited ownership', async () => withService(async (service) => {
  const room = await readyRoom(service); await room.hostIntent('START_MATCH'); const before = service.store.load(room.host.roomId)!; const prior = before.game.board!;
  before.game = { ...before.game, lifecycle: 'ROUND_COMPLETE' }; service.store.save(before);
  const result = await service.intent(room.host.roomId, room.host.token, { type: 'START_NEXT_ROUND', intentId: 'fresh-round', expectedRevision: before.revision, payload: {} }); const board = result.projection.projection.board!;
  assert.equal(result.projection.projection.room.state, 'ROUND_SETUP'); assert.notEqual(service.store.load(room.host.roomId)!.game.board?.seed, prior.seed); assert.equal(board.some((cell) => cell.owner), false); assert.equal(new Set(board.filter((cell) => cell.kind === 'letter').map((cell) => cell.visibleValue)).size, 16); assert.deepEqual(board.filter((cell) => cell.kind === 'surprise').map((cell) => cell.visibleValue).sort(), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
}));

test('room entropy gives new games distinct persisted board seeds while reconnects retain the generated board', async () => withService(async (service, dbPath) => {
  const first = await readyRoom(service); const second = await readyRoom(service);
  await first.hostIntent('START_MATCH'); await second.hostIntent('START_MATCH');
  const firstRoom = service.store.load(first.host.roomId)!; const secondRoom = service.store.load(second.host.roomId)!;
  assert.notEqual(firstRoom.boardNonce, secondRoom.boardNonce);
  assert.notEqual(firstRoom.game.board?.seed, secondRoom.game.board?.seed);
  const persisted = firstRoom.game.board;
  const recovered = new AuthoritativeGameService({ dbPath, secret: 'test' });
  try { assert.deepEqual(recovered.store.load(first.host.roomId)!.game.board, persisted); } finally { recovered.close(); }
}, (() => { let sequence = 0; return { boardNonce: () => `test-room-${sequence++}` }; })()));

test('serialized join cannot acknowledge a player that a gated start loses', async () => withService(async (service) => {
  const room = service.create('host', true);
  const mutable = service as unknown as { questions: (...args: unknown[]) => Promise<unknown> };
  const original = mutable.questions.bind(service); let entered!: () => void; const enteredStart = new Promise<void>((resolve) => { entered = resolve; }); let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  mutable.questions = async (...args) => { entered(); await gate; return original(...args); };
  const start = service.intent(room.roomId, room.token, { type: 'START_MATCH', intentId: 'gated-start', expectedRevision: room.revision, payload: {} });
  await enteredStart; const joining = service.join(room.roomCode, 'queued-player'); release(); await start;
  const joined = await joining; assert.ok(joined.token); assert.equal(service.store.load(room.roomId)!.members.some((member) => member.displayName === 'queued-player'), true);
}));

test('legacy policy defaults Huroof while unknown policy and malformed envelopes are rejected', async () => withService(async (service) => {
  const room = service.create('host', true); const stored = service.store.load(room.roomId)!;
  delete stored.config.policyVersion; delete stored.config.gameKind; service.store.save(stored); assert.equal(service.metadata(room.roomId, room.token).projection.room.matchSettings?.gameKind, 'huroof');
  const invalid = { type: 'ROUND_READY', intentId: 12, expectedRevision: 1, payload: {} } as never;
  await assert.rejects(() => service.intent(room.roomId, room.token, invalid), /INVALID_INTENT/);
  const unknown = service.store.load(room.roomId)!; unknown.config.policyVersion = 1; unknown.config.gameKind = 'future' as never; service.store.save(unknown);
  assert.throws(() => service.metadata(room.roomId, room.token), /ROOM_POLICY_UNKNOWN/);
}));

test('ordinary selection exhaustion persists a no-score hold, rejects gameplay, and recovers through a fresh same-settings room', async () => withService(async (service) => {
  const room = service.create('host', true); let revision = room.revision;
  const send = async (type: string, payload: Record<string, unknown> = {}) => { const result = await service.intent(room.roomId, room.token, { type: type as never, intentId: `${type}-${revision}`, expectedRevision: revision, payload }); revision = result.revision; return result; };
  await send('START_MATCH'); await send('ROUND_READY');
  const exhausted = service.store.load(room.roomId)!; exhausted.questionSelection = { ...exhausted.questionSelection!, queues: Object.fromEntries(Object.keys(exhausted.questionSelection!.queues).map((letter) => [letter, []])) }; service.store.save(exhausted);
  const cell = service.metadata(room.roomId, room.token).projection.board!.find((value) => value.kind === 'letter')!;
  const held = await send('SELECT_CELL', { cellId: cell.id }); assert.equal(held.projection.projection.contentHold?.reason, 'CONTENT_EXHAUSTED'); assert.equal(held.projection.projection.contentHold?.cellId, cell.id); assert.deepEqual(held.projection.projection.questionScores, { horizontal: 0, vertical: 0 });
  await assert.rejects(() => service.intent(room.roomId, room.token, { type: 'ROUND_READY' as never, intentId: 'held-ready', expectedRevision: revision, payload: {} }), /CONTENT_HOLD_ACTIVE/);
  await assert.rejects(() => service.intent(room.roomId, room.token, { type: 'END_WITHOUT_WINNER' as never, intentId: 'held-end-unpaused', expectedRevision: revision, payload: {} }), /END_WITHOUT_WINNER_NOT_ALLOWED/);
  await send('PAUSE');
  const ended = await send('END_WITHOUT_WINNER'); assert.equal(ended.projection.projection.room.state, 'MATCH_COMPLETE'); assert.equal(ended.projection.projection.endedWithoutWinner, true); assert.equal(ended.projection.projection.matchWinner, undefined);
  const replacement = service.create('host', true); const fresh = await service.intent(replacement.roomId, replacement.token, { type: 'START_MATCH', intentId: 'fresh-start', expectedRevision: replacement.revision, payload: {} }); assert.equal(fresh.projection.projection.room.state, 'ROUND_SETUP');
}));

test('a host correction previews its reason and audits removal and restoration of a winning path', async () => withService(async (service) => {
  const room = await readyRoom(service); await room.hostIntent('START_MATCH');
  const stored = service.store.load(room.host.roomId)!; let board = stored.game.board!;
  for (let q = 0; q < 5; q++) board = withOwner(board, `cell-${q}-0`, 'horizontal');
  const path = findWinningPath(board, 'horizontal')!;
  stored.game = { ...stored.game, board, lifecycle: 'ROUND_COMPLETE', currentRound: 1, winningPath: path, questionScores: { horizontal: 5, vertical: 0 }, roundOutcomeHistory: [{ round: 1, version: 1, winner: 'horizontal', winningPath: path }] };
  service.store.save(stored);
  let revision = stored.revision;
  const intent = async (type: string, payload: Record<string, unknown> = {}) => {
    const result = await service.intent(room.host.roomId, room.host.token, { type: type as never, intentId: `correction-${type}-${revision}`, expectedRevision: revision, payload }); revision = result.revision; return result;
  };
  await intent('BEGIN_CORRECTION', { cellId: 'cell-2-0', reason: 'خلية احتُسبت بالخطأ' });
  const preview = service.metadata(room.host.roomId, room.host.token).projection;
  assert.deepEqual(preview.correction, { cellId: 'cell-2-0', priorOwner: 'horizontal', reason: 'خلية احتُسبت بالخطأ' });
  await intent('CONFIRM_CORRECTION');
  let corrected = service.metadata(room.host.roomId, room.host.token).projection;
  assert.equal(corrected.room.state, 'CELL_SELECTION'); assert.equal(corrected.roundWins?.horizontal, 0); assert.equal(corrected.questionScores?.horizontal, 4);
  const audit = service.store.load(room.host.roomId)!.audit;
  assert.deepEqual(audit.at(-1)?.payload, {});
  assert.deepEqual(audit.at(-2)?.payload, { cellId: 'cell-2-0', reason: 'خلية احتُسبت بالخطأ' });
  await intent('BEGIN_CORRECTION', { cellId: 'cell-2-0', owner: 'horizontal', reason: 'استعادة المسار الصحيح' }); await intent('CONFIRM_CORRECTION');
  corrected = service.metadata(room.host.roomId, room.host.token).projection;
  assert.equal(corrected.room.state, 'ROUND_COMPLETE'); assert.equal(corrected.roundWins?.horizontal, 1); assert.equal(corrected.questionScores?.horizontal, 5);
  const historyLength = service.store.load(room.host.roomId)!.game.roundOutcomeHistory.length;
  await intent('BEGIN_CORRECTION', { cellId: 'cell-2-0', owner: 'horizontal', reason: 'تأكيد بلا تغيير' }); await intent('CONFIRM_CORRECTION');
  corrected = service.metadata(room.host.roomId, room.host.token).projection;
  assert.equal(corrected.room.state, 'ROUND_COMPLETE'); assert.equal(corrected.questionScores?.horizontal, 5); assert.equal(service.store.load(room.host.roomId)!.game.roundOutcomeHistory.length, historyLength);
}));


test('manual lobby participants are persisted separately, start as ready, and support host team selection', async () => withService(async (service) => {
  const host = service.create('host', true);
  const add = async (intentId: string, expectedRevision: number, displayName: string, team: 'horizontal' | 'vertical') =>
    service.intent(host.roomId, host.token, { type: 'LOBBY_ADD_MANUAL_PLAYER', intentId, expectedRevision, payload: { displayName, team } });
  const first = await add('manual-one', host.revision, 'لاعب يدوي', 'horizontal');
  const second = await add('manual-two', first.revision, 'لاعب يدوي', 'vertical');
  const stored = service.store.load(host.roomId)!;
  assert.equal(stored.members.filter((member) => member.role === 'player').length, 0);
  assert.equal(stored.manualParticipants?.length, 2);
  const hostMembers = second.projection.projection.room.members!;
  const manual = hostMembers.filter((member) => member.participation === 'manual');
  assert.equal(second.projection.projection.room.memberCount, 2);
  assert.equal(second.projection.projection.room.readyCount, 2);
  assert.equal(manual.every((member) => member.manualParticipantId && !member.uid && member.ready), true);
  const audience = service.metadata(host.roomId, service.createAudienceCapability(host.roomId)).projection;
  assert.equal(JSON.stringify(audience).includes(manual[0].manualParticipantId!), false);
  const started = await service.intent(host.roomId, host.token, { type: 'START_MATCH', intentId: 'manual-start', expectedRevision: second.revision, payload: {} });
  assert.equal(started.projection.projection.room.state, 'ROUND_SETUP');
  const ready = await service.intent(host.roomId, host.token, { type: 'ROUND_READY', intentId: 'manual-round', expectedRevision: started.revision, payload: {} });
  const cell = ready.projection.projection.board![0];
  const question = await service.intent(host.roomId, host.token, { type: 'SELECT_CELL', intentId: 'manual-select', expectedRevision: ready.revision, payload: { cellId: cell.id } });
  const selected = await service.intent(host.roomId, host.token, { type: 'HOST_SELECT_TEAM', intentId: 'manual-answer', expectedRevision: question.revision, payload: { team: 'horizontal' } });
  assert.equal(selected.projection.projection.room.state, 'FIRST_ANSWER');
}));

test('a stale DB snapshot cannot interrupt ticks for other local rooms', async () => withService(async (service) => {
  const stale = service.create('stale', true);
  const healthy = service.create('healthy', true);
  const persisted = service.store.load(stale.roomId)! as unknown as { questionSourceSnapshot?: string };
  persisted.questionSourceSnapshot = 'missing-source-snapshot';
  service.store.save(persisted as never);
  await assert.doesNotReject(() => service.tick());
  assert.ok(service.store.load(healthy.roomId));
}));


function syntheticChallengeFixture() {
  const hash = 'a'.repeat(64);
  const categories = ['tahadani-006', 'tahadani-007', 'tahadani-008', 'tahadani-009'];
  const envelopes: Array<{ manifestSha256: string; id: string; schemaVersion: 't36-challenge-definition-v1'; definitionSha256: string; canonicalJson: string }> = [];
  const questions = categories.flatMap((categoryId) => Array.from({ length: 8 }, (_, index) => {
    const id = `local-nav-${categoryId}-${index}`, factFamily = `fact:${categoryId}:${index}`;
    const payload = {
      schemaVersion: 't36-challenge-definition-v1' as const, id, kind: 'navigation' as const,
      categoryId, ordinal: index + 1, disposition: 'ready' as const,
      source: { sourceId: `synthetic:${id}`, sourcePack: 'test', sourcePath: 'private', sourceRawSha256: hash, sourceContextsSha256: hash, mediaArchiveSha256: hash },
      media: [
        { role: 'answer' as const, visibility: 'host_only' as const, originalObjectName: 'private-answer', originalSha256: hash, derivativeObjectName: 'private-answer', derivativeSha256: hash },
        { role: 'question' as const, visibility: 'guide_only' as const, originalObjectName: 'private-guide', originalSha256: hash, derivativeObjectName: 'private-guide', derivativeSha256: hash },
        { role: 'question' as const, visibility: 'player' as const, originalObjectName: 'private-player', originalSha256: hash, derivativeObjectName: 'private-player', derivativeSha256: hash },
      ], publicData: { rows: 5 as const, columns: 5 as const, start: [0, 0] as const, timeLimitSeconds: 60 as const, promptAr: 'اتجه' },
      privateGrading: { goal: [0, 2] as const, blocked: [[1, 0]] as [number, number][], canonicalDirections: ['east', 'east'], canonicalPath: [[0, 0], [0, 1], [0, 2]] as [number, number][] },
      factFamilies: [factFamily], maxPerGameFamily: 1 as const,
    };
    const definitionSha256 = createHash('sha256').update(canonicalChallengeJson(payload)).digest('hex');
    const envelope = { manifestSha256: 'b'.repeat(64), id, schemaVersion: payload.schemaVersion, definitionSha256, canonicalJson: canonicalChallengeJson({ ...payload, definitionSha256 }) };
    envelopes.push(envelope);
    return {
      id: `${categoryId}-${index}`, categoryId, modality: 'classic' as const, answerConceptId: `concept:${categoryId}:${index}`,
      status: 'draft_test_import' as const, sourceContentHash: `source:${categoryId}:${index}`, difficulty: 'mixed',
      challenge: { definition: { manifestSha256: envelope.manifestSha256, id: envelope.id, schemaVersion: envelope.schemaVersion, definitionSha256 }, factFamilies: [factFamily], kind: 'navigation' as const },
    };
  }));
  const source = { snapshotId: 'synthetic-challenge-source', questions, inventory: {
    source: 'local_firestore_import' as const, snapshotId: 'synthetic-challenge-source', bundleSha256: 'c'.repeat(64), boundedReadCount: questions.length, sourceCandidateCount: questions.length, usableQuestionCount: questions.length, heldQuestionCount: 0, huroofAvailable: true,
    categories: categories.map((id) => ({ id, labelAr: id, sourceOnly: false, questionCount: 8, heldQuestionCount: 0, classicQuestionCount: 8, huroofQuestionCount: 8, categoryGameEligible: true, availability: 'ready' as const })),
  }};
  return { envelopes, source: source as never, categories };
}

test('an all-capable client offer does not turn an ordinary room into a challenge match', async () => {
  const fixture = syntheticChallengeFixture();
  const source = structuredClone(fixture.source) as { questions: Array<Record<string, unknown>> };
  source.questions.forEach((question) => delete question.challenge);
  const dir = await mkdtemp(join(tmpdir(), 'huroof-ordinary-capability-'));
  const service = new AuthoritativeGameService({ dbPath: join(dir, 'rooms.sqlite'), secret: 'test', localFirestoreQuestionSource: source as never });
  try {
    const capability = { protocolVersion: 't36-challenge-runtime-v1' as const, mechanics: ['navigation', 'missing_tile', 'memory', 'qatar_map'] as const };
    const created = service.create('host', true, { gameKind: 'categories', categories: fixture.categories, mapPresentation: 'ordinary', challenge: capability });
    const stored = service.store.load(created.roomId)!;
    assert.equal(stored.config.mapPresentation, 'ordinary');
    assert.equal(stored.config.challenge, undefined);
    assert.equal('challengeFamilyState' in (stored.questionSelection ?? {}), false);
  } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
});

test('mixed category 122 keeps ordinary rooms playable while flags-off challenge admission fails closed', async () => {
  const fixture = syntheticChallengeFixture();
  const source = structuredClone(fixture.source) as { questions: Array<Record<string, unknown>>; inventory: { categories: Array<{ id: string }> } };
  const originalCategory = fixture.categories[0]!;
  const categories = ['tahadani-games-122', ...fixture.categories.slice(1)];
  source.questions.forEach((question) => {
    if (question.categoryId === originalCategory) question.categoryId = 'tahadani-games-122';
    else delete question.challenge;
  });
  source.inventory.categories[0]!.id = 'tahadani-games-122';
  for (let index = 0; index < 8; index += 1)
    source.questions.push({
      id: `ordinary-122-${index}`, categoryId: 'tahadani-games-122', modality: 'classic', targetLetter: 'category-only',
      answerConceptId: `ordinary:122:${index}`, headerAr: 'عادي', promptAr: `سؤال عادي ${index}`, canonicalAnswer: `جواب ${index}`,
      acceptedAnswers: [`جواب ${index}`], status: 'draft_test_import', sourceContentHash: `ordinary:122:${index}`, difficulty: 'mixed',
    });
  const dir = await mkdtemp(join(tmpdir(), 'huroof-mixed-122-'));
  const service = new AuthoritativeGameService({ dbPath: join(dir, 'rooms.sqlite'), secret: 'test', localFirestoreQuestionSource: source as never });
  try {
    const created = service.create('host', true, { gameKind: 'categories', categories });
    assert.equal(service.store.load(created.roomId)!.config.challenge, undefined);
    assert.ok(service.resume(created.roomId, created.token));
    let revision = created.revision;
    const send = async (type: string, payload: Record<string, unknown> = {}) => {
      const result = await service.intent(created.roomId, created.token, { type: type as never, intentId: `mixed-122-${type}-${revision}`, expectedRevision: revision, payload });
      revision = result.revision;
      return result;
    };
    await send('START_MATCH'); await send('ROUND_READY');
    const categoryCell = service.metadata(created.roomId, created.token).projection.board!.find((cell) => cell.categoryId === 'tahadani-games-122')!;
    await send('SELECT_CELL', { cellId: categoryCell.id });
    assert.equal(service.store.load(created.roomId)!.activeQuestion?.challenge, undefined);
    await send('HOST_SELECT_TEAM', { team: 'horizontal' }); await send('JUDGE_INCORRECT');
    await send('HOST_SELECT_TEAM', { team: 'vertical' }); await send('JUDGE_INCORRECT');
    await send('RETURN_CELL');
    const replacement = service.metadata(created.roomId, created.token).projection.board!.find((cell) => cell.id === categoryCell.id)!;
    await send('SELECT_CELL', { cellId: replacement.id });
    assert.equal(service.store.load(created.roomId)!.activeQuestion?.challenge, undefined);
    const capability = { protocolVersion: 't36-challenge-runtime-v1' as const, mechanics: ['navigation' as const] };
    assert.throws(() => service.create('challenge-host', true, { gameKind: 'categories', categories, challenge: capability }), /CHALLENGE_MECHANICS_DISABLED/);
  } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
});

test('local challenge category admission creates an explicit family plan and activates a safe projected occurrence', async () => {
  const fixture = syntheticChallengeFixture();
  const dir = await mkdtemp(join(tmpdir(), 'huroof-challenge-service-'));
  const dbPath = join(dir, 'rooms.sqlite');
  const service = new AuthoritativeGameService({ dbPath, secret: 'test', localFirestoreQuestionSource: fixture.source, challengeDefinitions: fixture.envelopes, enabledChallengeMechanics: ['navigation'] });
  try {
    const capability = { protocolVersion: 't36-challenge-runtime-v1' as const, mechanics: ['navigation' as const] };
    const created = service.create('host', true, { gameKind: 'categories', categories: fixture.categories, challenge: capability });
    const guide = await service.join(created.roomCode, 'guide', capability);
    let revision = guide.revision;
    const send = async (type: string, payload: Record<string, unknown> = {}) => {
      const result = await service.intent(created.roomId, created.token, { type: type as never, intentId: `${type}-${revision}`, expectedRevision: revision, payload });
      revision = result.revision; return result;
    };
    await send('LOBBY_ADD_MANUAL_PLAYER', { displayName: 'الفريق الآخر', team: 'vertical' });
    await send('LOBBY_ASSIGN_TEAM', { memberUid: service.verify(guide.token)!.uid, team: 'horizontal' });
    const guideReady = await service.intent(created.roomId, guide.token, { type: 'LOBBY_SET_READY', intentId: `guide-ready-${revision}`, expectedRevision: revision, payload: { ready: true } });
    revision = guideReady.revision;
    await send('START_MATCH'); await send('ROUND_READY');
    const cell = service.metadata(created.roomId, created.token).projection.board![0]!;
    const selected = await send('SELECT_CELL', { cellId: cell.id });
    const stored = service.store.load(created.roomId)!;
    assert.equal('challengeFamilyState' in stored.questionSelection!, true);
    assert.equal((stored.questionSelection as { challengeBoardSlots?: unknown[] }).challengeBoardSlots?.length, 25);
    assert.equal((stored.questionSelection as { challengeReserveSlots?: unknown[] }).challengeReserveSlots?.length, 4);
    assert.equal(selected.projection.projection.question, undefined);
    assert.equal(selected.projection.projection.challenge?.stage, 'setup');
  } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
});

test('local create, join, and resume require the exact T37 definition-schema offer', async () => {
  const fixture = syntheticChallengeFixture();
  const source = structuredClone(fixture.source) as { questions: Array<{ challenge?: { definition: { schemaVersion: string } } }> };
  source.questions.forEach((question) => { if (question.challenge) question.challenge.definition.schemaVersion = 't37-clean70-challenge-definition-v1'; });
  const dir = await mkdtemp(join(tmpdir(), 'huroof-t37-capability-'));
  const service = new AuthoritativeGameService({ dbPath: join(dir, 'rooms.sqlite'), secret: 'test', localFirestoreQuestionSource: source as never, challengeDefinitions: fixture.envelopes, enabledChallengeMechanics: ['navigation'] });
  const legacy = { protocolVersion: 't36-challenge-runtime-v1' as const, mechanics: ['navigation' as const] };
  const t37 = { ...legacy, definitionSchemas: ['t36-challenge-definition-v1', 't37-clean70-challenge-definition-v1'] as const };
  try {
    assert.throws(() => service.create('legacy-host', true, { gameKind: 'categories', categories: fixture.categories, challenge: legacy }), /CHALLENGE_DEFINITION_SCHEMA_UNSUPPORTED/);
    const created = service.create('t37-host', true, { gameKind: 'categories', categories: fixture.categories, challenge: t37 });
    assert.deepEqual(service.store.load(created.roomId)!.config.challenge?.definitionSchemas, ['t37-clean70-challenge-definition-v1']);
    await assert.rejects(() => service.join(created.roomCode, 'legacy-player', legacy), /CHALLENGE_PROTOCOL_REQUIRED/);
    await assert.rejects(() => service.join(created.roomCode, 'malformed-player', { ...legacy, definitionSchemas: 't37-clean70-challenge-definition-v1' } as never), /CHALLENGE_PROTOCOL_REQUIRED/);
    const joined = await service.join(created.roomCode, 't37-player', t37);
    assert.ok(joined.token);
    assert.throws(() => service.resume(created.roomId, created.token, legacy), /CHALLENGE_PROTOCOL_REQUIRED/);
    assert.ok(Number.isFinite(Date.parse(service.resume(created.roomId, created.token, t37).serverTime)));
  } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
});

test('local navigation selection requires an authenticated guide phone and leaves the board recoverable', async () => {
  const fixture = syntheticChallengeFixture();
  const dir = await mkdtemp(join(tmpdir(), 'huroof-challenge-guide-required-'));
  const service = new AuthoritativeGameService({ dbPath: join(dir, 'rooms.sqlite'), secret: 'test', localFirestoreQuestionSource: fixture.source, challengeDefinitions: fixture.envelopes, enabledChallengeMechanics: ['navigation'] });
  try {
    const capability = { protocolVersion: 't36-challenge-runtime-v1' as const, mechanics: ['navigation' as const] };
    const created = service.create('host', true, { gameKind: 'categories', categories: fixture.categories, challenge: capability });
    let revision = created.revision;
    const send = (type: string, payload: Record<string, unknown> = {}) => service.intent(created.roomId, created.token, { type: type as never, intentId: `guide-required-${type}-${revision}`, expectedRevision: revision, payload }).then((result) => { revision = result.revision; return result; });
    await send('START_MATCH'); await send('ROUND_READY');
    const cell = service.metadata(created.roomId, created.token).projection.board![0]!;
    const persistedBefore = structuredClone(service.store.load(created.roomId)!);
    await assert.rejects(() => send('SELECT_CELL', { cellId: cell.id }), /NAVIGATION_PRIVATE_GUIDE_REQUIRED/);
    const projection = service.metadata(created.roomId, created.token).projection;
    assert.equal(projection.room.state, 'CELL_SELECTION');
    assert.equal(projection.activeCellId, undefined);
    assert.equal(projection.challenge, undefined);
    assert.deepEqual(service.store.load(created.roomId), persistedBefore);
  } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
});

test('local navigation supports one guide phone handed across both entitled teams between attempts', async () => {
  const fixture = syntheticChallengeFixture();
  const dir = await mkdtemp(join(tmpdir(), 'huroof-challenge-guide-handoff-'));
  let now = 1_000;
  const service = new AuthoritativeGameService({ dbPath: join(dir, 'rooms.sqlite'), secret: 'test', clock: () => new Date(now), localFirestoreQuestionSource: fixture.source, challengeDefinitions: fixture.envelopes, enabledChallengeMechanics: ['navigation'] });
  try {
    const capability = { protocolVersion: 't36-challenge-runtime-v1' as const, mechanics: ['navigation' as const] };
    const created = service.create('host', true, { gameKind: 'categories', categories: fixture.categories, challenge: capability });
    const guide = await service.join(created.roomCode, 'guide phone', capability);
    const opponentOne = await service.join(created.roomCode, 'opponent one', capability);
    const opponentTwo = await service.join(created.roomCode, 'opponent two', capability);
    let revision = opponentTwo.revision, sequence = 0;
    const sendAs = (token: string, type: string, payload: Record<string, unknown> = {}) => service.intent(created.roomId, token, { type: type as never, intentId: `guide-handoff-${++sequence}`, expectedRevision: revision, payload }).then((result) => { revision = result.revision; return result; });
    const send = (type: string, payload: Record<string, unknown> = {}) => sendAs(created.token, type, payload);
    const guideUid = service.verify(guide.token)!.uid;
    const opponentOneUid = service.verify(opponentOne.token)!.uid;
    const opponentTwoUid = service.verify(opponentTwo.token)!.uid;
    await send('LOBBY_ASSIGN_TEAM', { memberUid: guideUid, team: 'vertical' });
    await send('LOBBY_ASSIGN_TEAM', { memberUid: opponentOneUid, team: 'vertical' });
    await send('LOBBY_ASSIGN_TEAM', { memberUid: opponentTwoUid, team: 'vertical' });
    await send('LOBBY_ADD_MANUAL_PLAYER', { displayName: 'وكيل أفقي', team: 'horizontal' });
    await send('LOBBY_ADD_MANUAL_PLAYER', { displayName: 'وكيل عمودي', team: 'vertical' });
    await sendAs(guide.token, 'LOBBY_SET_READY', { ready: true });
    await sendAs(opponentOne.token, 'LOBBY_SET_READY', { ready: true });
    await sendAs(opponentTwo.token, 'LOBBY_SET_READY', { ready: true });
    await send('START_MATCH'); await send('ROUND_READY');
    const firstCell = service.metadata(created.roomId, created.token).projection.board![0]!;
    await assert.rejects(() => send('SELECT_CELL', { cellId: firstCell.id }), /NAVIGATION_PRIVATE_GUIDE_REQUIRED/);

    // Before the first selection the same guide phone is handed to horizontal.
    await send('LOBBY_ASSIGN_TEAM', { memberUid: guideUid, team: 'horizontal' });
    await send('SELECT_CELL', { cellId: firstCell.id });
    const challenge = () => service.metadata(created.roomId, created.token).projection.challenge!;
    const payload = () => ({ occurrence: challenge().occurrence, challengeRevision: challenge().revision, stage: challenge().stage });
    const manualHorizontal = service.store.load(created.roomId)!.manualParticipants!.find((participant) => participant.team === 'horizontal')!;
    await send('CHALLENGE_ASSIGN', { ...payload(), assignment: 'guide', participantId: `member:${guideUid}` });
    await send('CHALLENGE_ASSIGN', { ...payload(), assignment: 'mover', participantId: `manual:${manualHorizontal.id}` });
    const readiness = () => ({ protocolHash: challenge().readiness.protocolHash, assignmentHash: challenge().readiness.assignmentHash, stimulusHash: challenge().readiness.stimulusHash });
    await sendAs(guide.token, 'CHALLENGE_READY', { ...payload(), participantId: `member:${guideUid}`, readiness: readiness() });
    await send('CHALLENGE_READY', { ...payload(), participantId: `manual:${manualHorizontal.id}`, readiness: readiness() });
    await send('CHALLENGE_START', payload());
    now += 3_001; await service.tick(); revision = service.metadata(created.roomId, created.token).revision;
    await send('CHALLENGE_MOVE', { ...payload(), direction: 'east' });
    await send('CHALLENGE_MOVE', { ...payload(), direction: 'east' });
    assert.equal(challenge().result, 'correct');
    await send('CHALLENGE_CONTINUE', payload());

    // The next ordinary board turn is vertically entitled. Model that already
    // authoritative CELL_SELECTION state, then exercise the same host handoff
    // path used before the next navigation selection.
    const nextTurn = service.store.load(created.roomId)!;
    nextTurn.game = { ...nextTurn.game, entitledTeam: 'vertical' };
    nextTurn.revision += 1;
    service.store.commit(nextTurn, { type: 'TEST_NEXT_TURN_VERTICAL' }, new Date(now).toISOString());
    revision = nextTurn.revision;
    // Between closed occurrences that same authenticated phone is moved to the
    // next entitled team; the host uses the vertical manual mover.
    await send('LOBBY_ASSIGN_TEAM', { memberUid: guideUid, team: 'vertical' });
    await send('LOBBY_ASSIGN_TEAM', { memberUid: opponentOneUid, team: 'horizontal' });
    await send('LOBBY_ASSIGN_TEAM', { memberUid: opponentTwoUid, team: 'horizontal' });
    const secondCell = service.metadata(created.roomId, created.token).projection.board!.find((cell) => cell.id !== firstCell.id && !cell.owner)!;
    await send('SELECT_CELL', { cellId: secondCell.id });
    assert.equal(challenge().entitledTeam, 'vertical');
    const manualVertical = service.store.load(created.roomId)!.manualParticipants!.find((participant) => participant.team === 'vertical')!;
    await send('CHALLENGE_ASSIGN', { ...payload(), assignment: 'guide', participantId: `member:${guideUid}` });
    await send('CHALLENGE_ASSIGN', { ...payload(), assignment: 'mover', participantId: `manual:${manualVertical.id}` });
    await sendAs(guide.token, 'CHALLENGE_READY', { ...payload(), participantId: `member:${guideUid}`, readiness: readiness() });
    await send('CHALLENGE_READY', { ...payload(), participantId: `manual:${manualVertical.id}`, readiness: readiness() });
    await send('CHALLENGE_START', payload());
    now += 3_001; await service.tick();
    assert.equal(challenge().stage, 'answer');
    assert.equal(challenge().entitledTeam, 'vertical');
  } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
});

test('local challenge failure and void continue to a fresh same-cell occurrence without scoring or family reuse', async () => {
  const fixture = syntheticChallengeFixture();
  const dir = await mkdtemp(join(tmpdir(), 'huroof-challenge-continuation-'));
  const dbPath = join(dir, 'rooms.sqlite');
  let now = 1_000;
  const service = new AuthoritativeGameService({
    dbPath,
    secret: 'test',
    clock: () => new Date(now),
    localFirestoreQuestionSource: fixture.source,
    challengeDefinitions: fixture.envelopes,
    enabledChallengeMechanics: ['navigation'],
  });
  try {
    const capability = { protocolVersion: 't36-challenge-runtime-v1' as const, mechanics: ['navigation' as const] };
    const created = service.create('host', true, { gameKind: 'categories', categories: fixture.categories, challenge: capability });
    assert.throws(() => service.resume(created.roomId, created.token, { protocolVersion: capability.protocolVersion, mechanics: [] }), /CHALLENGE_PROTOCOL_REQUIRED/);
    const resumed = service.resume(created.roomId, created.token, capability);
    assert.equal(resumed.revision, created.revision);
    assert.ok(Number.isFinite(Date.parse(resumed.serverTime)));
    const guide = await service.join(created.roomCode, 'guide', capability);
    const opponent = await service.join(created.roomCode, 'opponent', capability);
    let revision = opponent.revision;
    let intentSequence = 0;
    const send = async (token: string, type: string, payload: Record<string, unknown> = {}) => {
      const result = await service.intent(created.roomId, token, { type: type as never, intentId: `${type}-${revision}-${++intentSequence}`, expectedRevision: revision, payload });
      revision = result.revision;
      return result;
    };
    await send(guide.token, 'LOBBY_SET_READY', { ready: true });
    await send(opponent.token, 'LOBBY_SET_READY', { ready: true });
    await send(created.token, 'LOBBY_ADD_MANUAL_PLAYER', { displayName: 'mover', team: 'horizontal' });
    await send(created.token, 'START_MATCH');
    await send(created.token, 'ROUND_READY');
    const cell = service.metadata(created.roomId, created.token).projection.board![0]!;
    await send(created.token, 'SELECT_CELL', { cellId: cell.id });
    const stored = service.store.load(created.roomId)!;
    const manualId = stored.manualParticipants![0]!.id;
    const challenge = () => service.metadata(created.roomId, created.token).projection.challenge!;
    const firstOccurrence = challenge().occurrence;
    const payload = () => ({ occurrence: challenge().occurrence, challengeRevision: challenge().revision, stage: challenge().stage });
    await send(created.token, 'CHALLENGE_ASSIGN', { ...payload(), assignment: 'guide', participantId: `member:${service.verify(guide.token)!.uid}` });
    await send(created.token, 'CHALLENGE_ASSIGN', { ...payload(), assignment: 'mover', participantId: `manual:${manualId}` });
    const ready = () => ({ protocolHash: challenge().readiness.protocolHash, assignmentHash: challenge().readiness.assignmentHash, stimulusHash: challenge().readiness.stimulusHash });
    await send(guide.token, 'CHALLENGE_READY', { ...payload(), participantId: `member:${service.verify(guide.token)!.uid}`, readiness: ready() });
    await send(created.token, 'CHALLENGE_READY', { ...payload(), participantId: `manual:${manualId}`, readiness: ready() });
    await send(created.token, 'CHALLENGE_START', payload());
    now += 3_000;
    await service.tick();
    revision = service.metadata(created.roomId, created.token).revision;
    for (let index = 0; index < 3; index += 1)
      await send(created.token, 'CHALLENGE_MOVE', { ...payload(), direction: 'south' });
    assert.equal(challenge().result, 'failed');
    assert.equal(service.metadata(created.roomId, created.token).projection.questionScores?.horizontal, 0);
    await send(created.token, 'CHALLENGE_REVEAL', payload());
    await send(created.token, 'CHALLENGE_CONTINUE', payload());
    assert.equal(service.metadata(created.roomId, created.token).projection.room.state, 'CELL_SELECTION');
    assert.equal(service.metadata(created.roomId, created.token).projection.board!.find((item) => item.id === cell.id)?.owner, undefined);
    await send(created.token, 'SELECT_CELL', { cellId: cell.id });
    const secondOccurrence = challenge().occurrence;
    assert.notEqual(secondOccurrence, firstOccurrence);
    await send(created.token, 'CHALLENGE_VOID', payload());
    assert.equal(challenge().result, 'void');
    await send(created.token, 'CHALLENGE_CONTINUE', payload());
    await send(created.token, 'SELECT_CELL', { cellId: cell.id });
    assert.notEqual(challenge().occurrence, secondOccurrence);
    assert.equal(service.metadata(created.roomId, created.token).projection.questionScores?.horizontal, 0);
  } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
});
