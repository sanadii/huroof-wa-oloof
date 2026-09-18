import assert from 'node:assert/strict';
import test from 'node:test';
import { initialGameState } from '../../src/features/game/domain/lifecycle.js';
import { expireRoom, projectRoom, reduceIntent, type CanonicalRoom, type CanonicalMember } from './game.js';

test('reading is untimed; host selection and player buzz start answer clocks', () => {
  const room: CanonicalRoom = { schemaVersion: 2, roomCode: 'ABCDEFGH', revision: 1,
    game: { ...initialGameState(), lifecycle: 'QUESTION_READING' }, questionCursor: 0,
    config: { demo: true, questionSeconds: 20, opponentSeconds: 10, teams: { horizontal: 'A', vertical: 'B' }, releaseId: 'demo', releaseRootSha256: 'hash', releaseDemoFixture: true } };
  const host: CanonicalMember = { uid: 'host', role: 'host', displayName: 'Host', active: true, ready: true };
  const player: CanonicalMember = { ...host, uid: 'player', role: 'player', team: 'horizontal' };
  assert.equal(expireRoom(room, 100_000), room);
  const revealed = { ...room, activeQuestionOccurrence: 'question:1', answerRevealedOccurrence: 'question:1' };
  const judgedAfterReveal = reduceIntent(revealed, host, { type: 'HOST_SELECT_TEAM', intentId: 'revealed', expectedRevision: 1, payload: { team: 'horizontal' } }, 100_000).room;
  assert.equal(judgedAfterReveal.timer, undefined);
  assert.equal(expireRoom(judgedAfterReveal, 200_000), judgedAfterReveal);
  const revealedOpponent = { ...revealed, game: { ...revealed.game, lifecycle: 'OPPONENT_CHANCE' as const, entitledTeam: 'vertical' as const } };
  const selectedAfterReveal = reduceIntent(revealedOpponent, host, { type: 'HOST_SELECT_TEAM', intentId: 'revealed-opponent', expectedRevision: 1, payload: { team: 'vertical' } }, 100_000).room;
  assert.equal(selectedAfterReveal.timer, undefined);
  assert.equal(expireRoom(selectedAfterReveal, 200_000), selectedAfterReveal);
  assert.equal((projectRoom('r', room, [player], 'player', player.uid, 100_000).projection as any).self.canBuzz, true);
  assert.equal((projectRoom('r', room, [player], 'audience', undefined, 100_000).projection as any).deadlineAt, undefined);
  for (const type of ['BUZZ', 'HOST_SELECT_TEAM'] as const) {
    const answering = reduceIntent(room, type === 'BUZZ' ? player : host,
      { type, intentId: type, expectedRevision: 1, payload: type === 'BUZZ' ? {} : { team: 'horizontal' } }, 100_000).room;
    assert.deepEqual(answering.timer, { deadlineMs: 120_000, buzzOpen: false });
    assert.equal(expireRoom(answering, 119_999), answering);
    assert.equal(expireRoom(answering, 120_000), answering);
    assert.equal(expireRoom(answering, 180_000).game.answeringTeam, 'horizontal');
    const opponent = reduceIntent(answering, host, { type: 'JUDGE_INCORRECT', intentId: 'wrong', expectedRevision: answering.revision, payload: {} }, 180_000).room;
    assert.equal(opponent.game.lifecycle, 'OPPONENT_CHANCE');
    assert.equal(opponent.timer, undefined);
    const second = reduceIntent(opponent, host, { type: 'HOST_SELECT_TEAM', intentId: 'second', expectedRevision: opponent.revision, payload: { team: 'vertical' } }, 200_000).room;
    assert.deepEqual(second.timer, { deadlineMs: 210_000, buzzOpen: false });
    assert.equal(expireRoom(second, 210_000), second);
    assert.equal(reduceIntent(second, host, { type: 'JUDGE_INCORRECT', intentId: 'wrong-second', expectedRevision: second.revision, payload: {} }, 220_000).room.game.lifecycle, 'QUESTION_FAILED');
  }
});
