import assert from 'node:assert/strict';
import test from 'node:test';
import { findNearWinningCandidate, findNearWinningCandidates, generateBoard, neighbors, findWinningPath, withOwner } from '../../src/features/game/domain/board.js';
import { deriveMatch, effectiveRoundResults, initialGameState, reduceGame, type GameState, type RoundOutcomeRecord } from '../../src/features/game/domain/lifecycle.js';

const board = () => generateBoard(42, Array.from({ length: 16 }, (_, index) => `ح${index}`));
const outcomes = (...winners: Array<'horizontal' | 'vertical'>): RoundOutcomeRecord[] => winners.map((winner, index) => ({ round: index + 1, version: 1, winner }));

test('board has 25 cells, stable surprises, and visible odd-q honeycomb neighbors', () => {
  const first = board(); assert.equal(first.cells.length, 25); assert.equal(first.cells.filter((cell) => cell.kind === 'letter').length, 16); assert.equal(first.cells.filter((cell) => cell.kind === 'surprise').length, 9); assert.deepEqual(first, board());
  const letters = first.cells.filter((cell) => cell.kind === 'letter').map((cell) => cell.visibleValue);
  const surpriseNumbers = first.cells.filter((cell) => cell.kind === 'surprise').map((cell) => cell.visibleValue);
  assert.equal(new Set(letters).size, 16); assert.deepEqual([...surpriseNumbers].sort(), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  assert.deepEqual(neighbors({ q: 2, r: 2 }), [{ q: 2, r: 1 }, { q: 2, r: 3 }, { q: 1, r: 2 }, { q: 3, r: 2 }, { q: 1, r: 1 }, { q: 3, r: 1 }]);
  let horizontal = board(); for (let q = 0; q < 5; q++) horizontal = withOwner(horizontal, `cell-${q}-2`, 'horizontal'); assert.deepEqual(findWinningPath(horizontal, 'horizontal'), ['cell-0-2', 'cell-1-2', 'cell-2-2', 'cell-3-2', 'cell-4-2']);
});

test('near-win candidates derive independently for both team axes from one neutral gap', () => {
  let near = board();
  for (const q of [0, 1, 3, 4]) near = withOwner(near, `cell-${q}-2`, 'horizontal');
  for (const r of [0, 1, 3, 4]) near = withOwner(near, `cell-2-${r}`, 'vertical');
  const candidates = findNearWinningCandidates(near);
  assert.deepEqual(candidates.horizontal, {
    candidateId: 'cell-2-2',
    path: ['cell-0-2', 'cell-1-2', 'cell-2-2', 'cell-3-2', 'cell-4-2'],
  });
  assert.deepEqual(candidates.vertical, {
    candidateId: 'cell-2-2',
    path: ['cell-2-0', 'cell-2-1', 'cell-2-2', 'cell-2-3', 'cell-2-4'],
  });
});

test('near-win candidates honor winding odd-q adjacency and block opponent or two-neutral paths', () => {
  let winding = board();
  for (const id of ['cell-0-2', 'cell-1-2', 'cell-3-3', 'cell-4-4']) winding = withOwner(winding, id, 'horizontal');
  assert.equal(findNearWinningCandidate(winding, 'horizontal')?.candidateId, 'cell-2-3');
  winding = withOwner(winding, 'cell-2-3', 'vertical');
  assert.equal(findNearWinningCandidate(winding, 'horizontal'), undefined);

  let twoNeutral = board();
  for (const q of [0, 1, 4]) twoNeutral = withOwner(twoNeutral, `cell-${q}-0`, 'horizontal');
  assert.equal(findNearWinningCandidate(twoNeutral, 'horizontal'), undefined);
});

test('near-win candidates suppress existing wins and select the shortest then r/q/id candidate', () => {
  let alreadyWon = board();
  for (let q = 0; q < 5; q++) alreadyWon = withOwner(alreadyWon, `cell-${q}-0`, 'horizontal');
  assert.equal(findNearWinningCandidate(alreadyWon, 'horizontal'), undefined);

  let tied = board();
  for (const r of [1, 3]) for (const q of [0, 1, 3, 4]) tied = withOwner(tied, `cell-${q}-${r}`, 'horizontal');
  assert.equal(findNearWinningCandidate(tied, 'horizontal')?.candidateId, 'cell-2-1');
});

test('AWARD_CELL is the sole normal scoring mutation: one finalized owner earns exactly one point', () => {
  const initial = initialGameState();
  const state: GameState = { ...initial, board: board(), lifecycle: 'CELL_AWARDED', activeCellId: 'cell-0-0', answeringTeam: 'horizontal' };
  const awarded = reduceGame(state, { type: 'AWARD_CELL' });
  assert.deepEqual(awarded.questionScores, { horizontal: 1, vertical: 0 });
  assert.equal(awarded.board?.cells.find((cell) => cell.id === 'cell-0-0')?.owner, 'horizontal');
  assert.throws(() => reduceGame(awarded, { type: 'AWARD_CELL' }));
});

test('wrong answers, timeout, and retry do not score before an accepted answer is finalized', () => {
  let state: GameState = { ...initialGameState(), board: board(), lifecycle: 'QUESTION_READING', activeCellId: 'cell-0-0' };
  state = reduceGame(state, { type: 'BUZZ_ACCEPTED', team: 'horizontal' });
  state = reduceGame(state, { type: 'JUDGE_INCORRECT' });
  state = reduceGame(state, { type: 'TIME_EXPIRED' });
  state = reduceGame(state, { type: 'RETRY_CELL' });
  assert.equal(state.lifecycle, 'QUESTION_READING');
  assert.deepEqual(state.questionScores, { horizontal: 0, vertical: 0 });
});

test('effective round history folds only its latest version and the v2 winner predicate is exact', () => {
  const match = (history: RoundOutcomeRecord[]) => deriveMatch({ ...initialGameState(), roundOutcomeHistory: history });
  assert.equal(match(outcomes('horizontal', 'horizontal')).matchWinner, 'horizontal', 'H,H completes');
  assert.equal(match(outcomes('horizontal', 'vertical', 'horizontal')).matchWinner, undefined, 'H,V,H does not complete');
  const total = match(outcomes('horizontal', 'vertical', 'horizontal', 'vertical', 'horizontal'));
  assert.equal(total.matchWinner, 'horizontal', 'H,V,H,V,H completes'); assert.equal(total.matchWinReason, 'three_total_round_wins');
  assert.equal(match(outcomes('horizontal')).matchWinner, undefined, 'no premature match');
  const corrected = [...outcomes('horizontal', 'vertical'), { round: 2, version: 2, winner: 'horizontal' as const }];
  assert.deepEqual(effectiveRoundResults(corrected).map((result) => result.winner), ['horizontal', 'horizontal']);
  assert.equal(match(corrected).matchWinner, 'horizontal');
});

test('CHECK_PATH records one current-round result and derives ROUND_COMPLETE or MATCH_COMPLETE without a manual match event', () => {
  let winning = board(); for (let q = 0; q < 5; q++) winning = withOwner(winning, `cell-${q}-0`, 'horizontal');
  let state: GameState = { ...initialGameState(), board: winning, lifecycle: 'PATH_CHECK', currentRound: 1, answeringTeam: 'horizontal' };
  state = reduceGame(state, { type: 'CHECK_PATH' });
  assert.equal(state.lifecycle, 'ROUND_COMPLETE'); assert.equal(deriveMatch(state).roundWins.horizontal, 1);
  state = { ...state, lifecycle: 'PATH_CHECK', currentRound: 2, answeringTeam: 'horizontal' };
  state = reduceGame(state, { type: 'CHECK_PATH' });
  assert.equal(state.lifecycle, 'MATCH_COMPLETE'); assert.equal(deriveMatch(state).matchWinner, 'horizontal');
});

test('corrections recompute ownership-score deltas and can reopen a terminal match without changing a no-op score', () => {
  let owned = board(); for (let q = 0; q < 5; q++) owned = withOwner(owned, `cell-${q}-0`, 'horizontal');
  const path = findWinningPath(owned, 'horizontal')!;
  let state: GameState = { ...initialGameState(), board: owned, lifecycle: 'MATCH_COMPLETE', currentRound: 2, winningPath: path, questionScores: { horizontal: 5, vertical: 0 }, roundOutcomeHistory: [...outcomes('horizontal'), { round: 2, version: 1, winner: 'horizontal', winningPath: path }] };
  state = reduceGame(state, { type: 'BEGIN_CORRECTION', cellId: 'cell-2-0', owner: undefined, reason: 'تصحيح' });
  state = reduceGame(state, { type: 'CONFIRM_CORRECTION' });
  assert.equal(state.lifecycle, 'CELL_SELECTION'); assert.deepEqual(state.questionScores, { horizontal: 4, vertical: 0 }); assert.equal(deriveMatch(state).matchWinner, undefined);
  state = reduceGame(state, { type: 'BEGIN_CORRECTION', cellId: 'cell-2-0', owner: 'horizontal', reason: 'استعادة' });
  state = reduceGame(state, { type: 'CONFIRM_CORRECTION' });
  assert.equal(state.lifecycle, 'MATCH_COMPLETE'); assert.deepEqual(state.questionScores, { horizontal: 5, vertical: 0 });
  state = reduceGame(state, { type: 'BEGIN_CORRECTION', cellId: 'cell-2-0', owner: 'vertical', reason: 'نقل الملكية' });
  state = reduceGame(state, { type: 'CONFIRM_CORRECTION' });
  assert.equal(state.lifecycle, 'CELL_SELECTION'); assert.deepEqual(state.questionScores, { horizontal: 4, vertical: 1 });
  state = reduceGame(state, { type: 'BEGIN_CORRECTION', cellId: 'cell-2-0', owner: 'horizontal', reason: 'إرجاع الملكية' });
  state = reduceGame(state, { type: 'CONFIRM_CORRECTION' });
  assert.deepEqual(state.questionScores, { horizontal: 5, vertical: 0 });
  state = reduceGame(state, { type: 'BEGIN_CORRECTION', cellId: 'cell-2-0', owner: 'horizontal', reason: 'لا تغيير' });
  state = reduceGame(state, { type: 'CONFIRM_CORRECTION' });
  assert.deepEqual(state.questionScores, { horizontal: 5, vertical: 0 });
});

test('corrections retain surviving paths, preserve no-op terminal outcomes, and transfer the current round deterministically', () => {
  let horizontal = board(); for (let q = 0; q < 5; q++) horizontal = withOwner(horizontal, `cell-${q}-0`, 'horizontal');
  const winningPath = findWinningPath(horizontal, 'horizontal')!;
  const terminal = (): GameState => ({ ...initialGameState(), board: horizontal, lifecycle: 'MATCH_COMPLETE', currentRound: 2, winningPath, questionScores: { horizontal: 5, vertical: 0 }, roundOutcomeHistory: [...outcomes('horizontal'), { round: 2, version: 1, winner: 'horizontal', winningPath }] });
  const correct = (state: GameState, cellId: string, owner: 'horizontal' | 'vertical' | undefined) => reduceGame(reduceGame(state, { type: 'BEGIN_CORRECTION', cellId, owner, reason: 'اختبار' }), { type: 'CONFIRM_CORRECTION' });

  const historyLength = terminal().roundOutcomeHistory.length;
  const unownedNoop = correct(terminal(), 'cell-4-4', undefined);
  assert.equal(unownedNoop.lifecycle, 'MATCH_COMPLETE'); assert.equal(unownedNoop.roundOutcomeHistory.length, historyLength); assert.deepEqual(unownedNoop.questionScores, { horizontal: 5, vertical: 0 });
  const sameOwnerNoop = correct(terminal(), 'cell-2-0', 'horizontal');
  assert.equal(sameOwnerNoop.lifecycle, 'MATCH_COMPLETE'); assert.equal(sameOwnerNoop.roundOutcomeHistory.length, historyLength); assert.deepEqual(sameOwnerNoop.questionScores, { horizontal: 5, vertical: 0 });

  let alternate = horizontal; for (let q = 0; q < 5; q++) alternate = withOwner(alternate, `cell-${q}-1`, 'horizontal');
  const alternateState = { ...terminal(), board: alternate, questionScores: { horizontal: 10, vertical: 0 } };
  const survives = correct(alternateState, 'cell-2-0', undefined);
  assert.equal(survives.lifecycle, 'MATCH_COMPLETE'); assert.equal(deriveMatch(survives).roundWins.horizontal, 2); assert.deepEqual(survives.questionScores, { horizontal: 9, vertical: 0 });
  assert.ok(survives.winningPath?.includes('cell-2-1'));

  let transferBoard = horizontal; for (let r = 1; r < 5; r++) transferBoard = withOwner(transferBoard, `cell-2-${r}`, 'vertical');
  const transferred = correct({ ...terminal(), board: transferBoard, questionScores: { horizontal: 5, vertical: 4 } }, 'cell-2-0', 'vertical');
  assert.equal(transferred.lifecycle, 'ROUND_COMPLETE'); assert.deepEqual(transferred.questionScores, { horizontal: 4, vertical: 5 });
  assert.deepEqual(deriveMatch(transferred).roundResults.map((round) => round.winner), ['horizontal', 'vertical']);
});
