import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceChallengeClockFromResume } from '../../src/features/game/runtime/firebase-game-adapter.js';
import type { ProjectionEnvelope } from '../../src/features/game/runtime/contracts.js';

const challengeEnvelope = (serverTime: string): ProjectionEnvelope => ({
  roomId: 'room', revision: 1, serverTime, role: 'player',
  projection: {
    room: { roomCode: 'ROOM0001', state: 'FIRST_ANSWER', readyCount: 2, memberCount: 2 },
    challenge: {
      protocolVersion: 't36-challenge-runtime-v1', kind: 'memory', recipient: 'captain', occurrence: 'occurrence', revision: 2,
      assignmentGeneration: 1, disclosureGeneration: 2, stage: 'observation', entitledTeam: 'horizontal', answeringTeam: 'horizontal', paused: false, strikes: 0,
      readiness: { protocolHash: 'p', assignmentHash: 'a', stimulusHash: 's', required: true, acknowledged: true }, assignments: { captain: 'member:captain' }, legalActions: [], timing: { countdownSeconds: 3, observationSeconds: 6 }, deadlineAt: '2026-01-01T00:00:06.000Z', attemptsClosed: false, solutionRevealed: false,
    },
  },
});

test('delayed challenge snapshot advances from the resume clock instead of restarting observation', () => {
  const delayed = advanceChallengeClockFromResume(challengeEnvelope('2025-12-31T23:00:00.000Z'), '2026-01-01T00:00:00.000Z', 100, 7_100);
  assert.equal(delayed.serverTime, '2026-01-01T00:00:07.000Z');
  assert.ok(Date.parse(delayed.serverTime) > Date.parse(delayed.projection.challenge!.deadlineAt!));
});

test('ordinary projection retains its authoritative write timestamp', () => {
  const ordinary = { ...challengeEnvelope('2025-12-31T23:00:00.000Z'), projection: { room: { roomCode: 'ROOM0001', state: 'LOBBY' as const, readyCount: 0, memberCount: 0 } } };
  assert.equal(advanceChallengeClockFromResume(ordinary, '2026-01-01T00:00:00.000Z', 0, 10_000).serverTime, ordinary.serverTime);
});
