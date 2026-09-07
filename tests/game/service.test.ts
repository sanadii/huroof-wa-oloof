import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthoritativeGameService } from '../../server/service.js';
import { findWinningPath, withOwner } from '../../src/features/game/domain/board.js';

async function withService(run: (service: AuthoritativeGameService, dbPath: string) => Promise<void>, options: { boardNonce?: () => string } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'huroof-service-')); const dbPath = join(dir, 'rooms.sqlite'); const service = new AuthoritativeGameService({ dbPath, secret: 'test', ...options });
  try { await run(service, dbPath); } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
}
async function readyRoom(service: AuthoritativeGameService) {
  const host = service.create('host', true, { questionSeconds: 10, opponentSeconds: 10 }); const one = service.join(host.roomCode, 'one'); const two = service.join(host.roomCode, 'two'); let revision = two.revision;
  for (const player of [one, two]) { const result = await service.intent(host.roomId, player.token, { type: 'LOBBY_SET_READY', intentId: `ready-${revision}`, expectedRevision: revision, payload: { ready: true } }); revision = result.revision; }
  const hostIntent = async (type: string, payload: Record<string, unknown> = {}) => { const result = await service.intent(host.roomId, host.token, { type: type as never, intentId: `${type}-${revision}`, expectedRevision: revision, payload }); revision = result.revision; return result; };
  return { host, one, two, hostIntent, revision: () => revision };
}

test('host-only demo rooms start, while any partial player roster still requires ready teams', async () => withService(async (service) => {
  assert.throws(() => service.create('host', false), /NO_APPROVED_QUESTION_STOCK/);
  const soloDemo = service.create('host', true); const soloStart = await service.intent(soloDemo.roomId, soloDemo.token, { type: 'START_MATCH', intentId: 'solo-demo', expectedRevision: soloDemo.revision, payload: {} }); assert.equal(soloStart.projection.projection.room.state, 'ROUND_SETUP'); assert.equal(soloStart.projection.projection.room.readyCount, 0); assert.equal(soloStart.projection.projection.room.memberCount, 0);
  const host = service.create('host', true); const one = service.join(host.roomCode, 'one');
  await assert.rejects(() => service.intent(host.roomId, host.token, { type: 'START_MATCH', intentId: 'early', expectedRevision: one.revision, payload: {} }), /LOBBY_NEEDS_TWO_TEAMS/);
  const two = service.join(host.roomCode, 'two');
  await assert.rejects(() => service.intent(host.roomId, host.token, { type: 'START_MATCH', intentId: 'unready', expectedRevision: two.revision, payload: {} }), /LOBBY_ALL_MEMBERS_MUST_BE_READY/);
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

test('host team selection follows buzz lifecycle and keeps its public marker UID-free', async () => withService(async (service) => {
  const host = service.create('host', true); let revision = host.revision;
  const intent = async (type: string, payload: Record<string, unknown> = {}) => { const result = await service.intent(host.roomId, host.token, { type: type as never, intentId: `${type}-${revision}`, expectedRevision: revision, payload }); revision = result.revision; return result; };
  await intent('START_MATCH'); await intent('ROUND_READY'); const cell = service.metadata(host.roomId, host.token).projection.board![0]; await intent('SELECT_CELL', { cellId: cell.id }); await intent('LETTER_REVEALED'); const selected = await intent('HOST_SELECT_TEAM', { team: 'horizontal' });
  assert.equal(selected.projection.projection.room.state, 'FIRST_ANSWER'); assert.equal(selected.projection.projection.answeringTeam, 'horizontal'); assert.deepEqual(selected.projection.projection.buzzWinner, { displayName: 'فريق ↔', team: 'horizontal', method: 'host' }); assert.equal(JSON.stringify(selected.projection.projection.buzzWinner).includes('uid'), false);
  await intent('JUDGE_INCORRECT'); await assert.rejects(() => service.intent(host.roomId, host.token, { type: 'HOST_SELECT_TEAM', intentId: 'wrong-team', expectedRevision: revision, payload: { team: 'horizontal' } }), /HOST_TEAM_SELECTION_NOT_ALLOWED/); const opponent = await intent('HOST_SELECT_TEAM', { team: 'vertical' }); assert.equal(opponent.projection.projection.answeringTeam, 'vertical');
}));

test('a regular first cell gives the host its question immediately without exposing it before reveal', async () => withService(async (service) => {
  const room = await readyRoom(service);
  await room.hostIntent('START_MATCH');
  await room.hostIntent('ROUND_READY');
  const cell = service.metadata(room.host.roomId, room.host.token).projection.board!.find((item) => item.kind === 'letter')!;
  const selected = await room.hostIntent('SELECT_CELL', { cellId: cell.id });
  const hostQuestion = (selected.projection.projection as { question?: { headerAr?: string; promptAr?: string; primaryAnswer?: string } }).question;
  assert.ok(hostQuestion?.headerAr?.trim());
  assert.ok(hostQuestion?.promptAr?.trim());
  assert.ok(hostQuestion?.primaryAnswer?.trim());
  for (const token of [room.one.token, service.createAudienceCapability(room.host.roomId)]) {
    const publicProjection = service.metadata(room.host.roomId, token).projection as { question?: unknown };
    assert.equal(publicProjection.question, undefined);
    assert.equal(JSON.stringify(publicProjection).includes('primaryAnswer'), false);
  }
  const revealed = await room.hostIntent('LETTER_REVEALED');
  assert.deepEqual((revealed.projection.projection as { question?: unknown }).question, hostQuestion);
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
    questionSeconds: 35,
    opponentSeconds: 15,
    teams: { horizontal: 'فريق ↔', vertical: 'فريق ↕' },
    categories: ['tahadani-006', 'tahadani-012'],
    modality: 'classic',
    difficulty: 'hard',
    mode: 'custom',
  });
  assert.deepEqual(projection.matchRule, { ruleSet: 'v2', victoryAr: 'تنتهي المباراة بفوز فريق بجولتين متتاليتين أو بثلاث جولات إجمالاً' });
  assert.equal(JSON.stringify(projection).includes('bestOf'), false);
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

test('pause preserves an open authoritative timer and resume expires only after the saved remainder', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'huroof-paused-timer-')); const dbPath = join(dir, 'rooms.sqlite'); let now = new Date('2026-09-04T00:00:00.000Z'); const service = new AuthoritativeGameService({ dbPath, secret: 'test', clock: () => now });
  try {
    const room = await readyRoom(service); await room.hostIntent('START_MATCH'); await room.hostIntent('ROUND_READY'); await room.hostIntent('SELECT_CELL', { cellId: 'cell-0-0' }); await room.hostIntent('LETTER_REVEALED'); await room.hostIntent('OPEN_QUESTION');
    now = new Date(now.getTime() + 3_000); await room.hostIntent('PAUSE'); const paused = service.store.load(room.host.roomId)!; assert.equal(paused.game.lifecycle, 'PAUSED'); assert.equal(paused.deadlineAt, undefined); assert.equal(paused.buzzOpen, false); assert.deepEqual(paused.pausedTimer, { remainingMs: 7_000, buzzOpen: true });
    now = new Date(now.getTime() + 60_000); assert.deepEqual(await service.tick(), []); await room.hostIntent('RESUME'); const resumed = service.metadata(room.host.roomId, room.host.token).projection; assert.equal(resumed.room.state, 'QUESTION_READING'); assert.equal(resumed.buzzOpen, true); assert.equal(Date.parse(resumed.deadlineAt!), now.getTime() + 7_000);
    now = new Date(now.getTime() + 6_999); assert.deepEqual(await service.tick(), []); now = new Date(now.getTime() + 1); assert.deepEqual(await service.tick(), [room.host.roomId]); assert.equal(service.metadata(room.host.roomId, room.host.token).projection.room.state, 'QUESTION_FAILED');
  } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
});

test('demo projections permanently mark drafts and keep answer-bearing fields host-only', async () => withService(async (service) => {
  const room = await readyRoom(service); await room.hostIntent('START_MATCH'); await room.hostIntent('ROUND_READY'); await room.hostIntent('SELECT_CELL', { cellId: 'cell-0-0' }); await room.hostIntent('LETTER_REVEALED'); await room.hostIntent('OPEN_QUESTION');
  const hostProjection = service.metadata(room.host.roomId, room.host.token); const playerProjection = service.metadata(room.host.roomId, room.one.token); const audienceProjection = service.metadata(room.host.roomId, service.createAudienceCapability(room.host.roomId));
  for (const projection of [playerProjection, audienceProjection]) for (const privateKey of ['primaryAnswer', 'acceptedAnswers', 'sources', 'moderation', 'canonicalAnswer']) assert.equal(JSON.stringify(projection).includes(privateKey), false, privateKey);
  assert.match(JSON.stringify(hostProjection), /primaryAnswer/); assert.equal(playerProjection.projection.demo, true); assert.equal(audienceProjection.projection.demo, true);
}));

test('surprises reveal a real unused letter; early/racing buzzes, wrong-to-opponent, timeout, pause, and correction remain authoritative', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'huroof-deadline-')); const dbPath = join(dir, 'rooms.sqlite'); let now = new Date('2026-09-03T00:00:00Z'); const service = new AuthoritativeGameService({ dbPath, secret: 'test', clock: () => now });
  try {
    const room = await readyRoom(service); await room.hostIntent('START_MATCH'); await room.hostIntent('ROUND_READY');
    const board = service.metadata(room.host.roomId, room.host.token).projection.board!; const surprise = board.find((cell) => cell.kind === 'surprise')!; const visible = new Set(board.filter((cell) => cell.kind === 'letter').map((cell) => cell.visibleValue));
    await room.hostIntent('SELECT_CELL', { cellId: surprise.id }); await room.hostIntent('LETTER_REVEALED'); const revealed = service.metadata(room.host.roomId, room.host.token).projection.board!.find((cell) => cell.id === surprise.id)!; assert.ok(revealed.revealedLetter); assert.equal(visible.has(revealed.revealedLetter!), false);
    await assert.rejects(() => service.intent(room.host.roomId, room.one.token, { type: 'BUZZ', intentId: 'before-open', expectedRevision: room.revision(), payload: {} }), /BUZZ_NOT_OPEN/);
    await room.hostIntent('OPEN_QUESTION'); const revision = room.revision(); const race = await Promise.all([service.intent(room.host.roomId, room.one.token, { type: 'BUZZ', intentId: 'race-one', expectedRevision: revision, payload: {} }), service.intent(room.host.roomId, room.two.token, { type: 'BUZZ', intentId: 'race-two', expectedRevision: revision, payload: {} })]); assert.equal(race.filter((result) => !result.stale).length, 1);
    const winner = race[0].stale ? room.two : room.one; const loser = winner === room.one ? room.two : room.one; let current = service.metadata(room.host.roomId, room.host.token).revision;
    const hostIntent = async (type: string, payload: Record<string, unknown> = {}) => { const result = await service.intent(room.host.roomId, room.host.token, { type: type as never, intentId: `${type}-${current}`, expectedRevision: current, payload }); current = result.revision; return result; };
    await hostIntent('JUDGE_INCORRECT'); const opponent = await service.intent(room.host.roomId, loser.token, { type: 'BUZZ', intentId: 'opponent', expectedRevision: current, payload: {} }); current = opponent.revision; await hostIntent('JUDGE_CORRECT'); await hostIntent('AWARD_CELL'); assert.equal(service.metadata(room.host.roomId, room.host.token).projection.questionScores?.[loser === room.one ? 'horizontal' : 'vertical'], 1); await hostIntent('CHECK_PATH'); await hostIntent('PAUSE'); await hostIntent('RESUME'); await hostIntent('BEGIN_CORRECTION', { cellId: surprise.id, owner: undefined, reason: 'حكم' }); await hostIntent('CONFIRM_CORRECTION');
    await hostIntent('SELECT_CELL', { cellId: 'cell-0-1' }); await hostIntent('LETTER_REVEALED'); await hostIntent('OPEN_QUESTION'); now = new Date(now.getTime() + 11_000); assert.equal((await service.tick()).includes(room.host.roomId), true); assert.equal(service.metadata(room.host.roomId, room.host.token).projection.room.state, 'QUESTION_FAILED');
  } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
});

test('idempotent stale intents and reconnect retain identity and the latest projection', async () => withService(async (service, dbPath) => {
  const room = await readyRoom(service); await room.hostIntent('START_MATCH'); const first = await service.intent(room.host.roomId, room.host.token, { type: 'ROUND_READY', intentId: 'same', expectedRevision: room.revision(), payload: {} }); const replay = await service.intent(room.host.roomId, room.host.token, { type: 'ROUND_READY', intentId: 'same', expectedRevision: room.revision(), payload: {} }); assert.equal(replay.replayed, true); assert.equal(first.revision, replay.revision);
  const stale = await service.intent(room.host.roomId, room.host.token, { type: 'PAUSE', intentId: 'stale', expectedRevision: 1, payload: {} }); assert.equal(stale.stale, true);
  const recovered = new AuthoritativeGameService({ dbPath, secret: 'test' }); try { assert.equal(recovered.metadata(room.host.roomId, room.one.token).projection.self?.uid, service.metadata(room.host.roomId, room.one.token).projection.self?.uid); } finally { recovered.close(); }
}));

test('accepted finalization scores exactly once; replay and stale award intents cannot duplicate it', async () => withService(async (service, dbPath) => {
  const room = await readyRoom(service); let revision = room.revision();
  const hostIntent = async (type: string, id: string, payload: Record<string, unknown> = {}) => {
    const result = await service.intent(room.host.roomId, room.host.token, { type: type as never, intentId: id, expectedRevision: revision, payload }); revision = result.revision; return result;
  };
  await hostIntent('START_MATCH', 'start'); await hostIntent('ROUND_READY', 'ready'); await hostIntent('SELECT_CELL', 'select', { cellId: 'cell-0-0' }); await hostIntent('LETTER_REVEALED', 'letter'); await hostIntent('OPEN_QUESTION', 'open');
  const buzz = await service.intent(room.host.roomId, room.one.token, { type: 'BUZZ', intentId: 'buzz', expectedRevision: revision, payload: {} }); revision = buzz.revision;
  await hostIntent('JUDGE_CORRECT', 'correct');
  const beforeAward = revision;
  const awarded = await hostIntent('AWARD_CELL', 'award-once');
  assert.deepEqual(awarded.projection.projection.questionScores, { horizontal: 1, vertical: 0 });
  const replay = await service.intent(room.host.roomId, room.host.token, { type: 'AWARD_CELL', intentId: 'award-once', expectedRevision: revision, payload: {} });
  assert.equal(replay.replayed, true); assert.deepEqual(replay.projection.projection.questionScores, { horizontal: 1, vertical: 0 });
  const stale = await service.intent(room.host.roomId, room.host.token, { type: 'AWARD_CELL', intentId: 'award-stale', expectedRevision: beforeAward, payload: {} });
  assert.equal(stale.stale, true); assert.deepEqual(stale.projection.projection.questionScores, { horizontal: 1, vertical: 0 });
  const recovered = new AuthoritativeGameService({ dbPath, secret: 'test' });
  try { assert.deepEqual(recovered.metadata(room.host.roomId, room.host.token).projection.questionScores, { horizontal: 1, vertical: 0 }); } finally { recovered.close(); }
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
