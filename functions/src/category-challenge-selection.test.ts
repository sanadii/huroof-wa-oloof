import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { generateCategoryBoard } from "../../src/features/game/domain/board.js";
import {
  categoryChallengePlanForBoard,
  isContentDepleted,
  releaseCategorySelection,
  updateChallengeRetryLineage,
} from "./index.js";
import {
  addChallengeReplacementReserve,
  promoteReservedChallengeQuestion,
  reserveChallengeQuestionForCell,
  selectChallengeCategoryQuestion,
  type ChallengeCategoryQuestionSelection,
  type ChallengeRuntimeQuestion,
} from "../../src/features/game/runtime/challenge-question-selector.js";
import type { CanonicalQuestion, CanonicalRoom } from "./game.js";

const categories = [
  { id: "category-006", labelAr: "عامة" },
  { id: "category-120", labelAr: "توجيه" },
  { id: "category-127", labelAr: "بلاطة" },
  { id: "category-132", labelAr: "ذاكرة" },
  { id: "category-326", labelAr: "خريطة" },
] as const;
const protocol = { protocolVersion: "t36-challenge-runtime-v1" as const, mechanics: ["navigation", "missing_tile", "memory", "qatar_map"] as const };
const questions: CanonicalQuestion[] = categories.flatMap(({ id }) => Array.from({ length: 16 }, (_, index) => ({
  id: `${id}-question-${index}`,
  categoryId: id,
  modality: "classic" as const,
  answerConceptId: `${id}-concept-${index}`,
  headerAr: "اختبار",
  promptAr: "اختبار",
  canonicalAnswer: "اختبار",
  acceptedAnswers: ["اختبار"],
})));

function roomForBoard(board = generateCategoryBoard(0x9e3779b1, categories)): CanonicalRoom {
  return {
    schemaVersion: 2,
    roomCode: "T36PLAN",
    revision: 1,
    questionCursor: 0,
    game: { lifecycle: "CELL_SELECTION", ruleSet: "v2", board, entitledTeam: "horizontal", questionScores: { horizontal: 0, vertical: 0 }, currentRound: 1, roundOutcomeHistory: [], attempt: "initial" },
    config: { policyVersion: 1, demo: true, questionSeconds: 20, opponentSeconds: 10, teams: { horizontal: "أفقي", vertical: "عمودي" }, releaseId: "test", releaseRootSha256: "a".repeat(64), releaseDemoFixture: true, gameKind: "categories", categories: categories.map(({ id }) => id), categorySnapshot: categories.map(({ id, labelAr }) => ({ id, labelAr })), modality: "classic", challenge: protocol },
  };
}

function remaining(selection: ChallengeCategoryQuestionSelection, slotId: string) {
  const occupied = new Set([...selection.challengeCompletedSlotIds, ...Object.values(selection.challengeSlotForCell), slotId]);
  return selection.challengePlannedSlots.filter((slot) => !occupied.has(slot.slotId));
}

function selectCurrentCell(room: CanonicalRoom, cellId: string) {
  room.game = { ...room.game, activeCellId: cellId as `cell-${number}-${number}` };
  const selection = releaseCategorySelection(questions, room) as ChallengeCategoryQuestionSelection;
  const slot = selection.challengeBoardSlots.find((candidate) => candidate.slotId.endsWith(`:${cellId}`));
  assert.ok(slot);
  const selected = selectChallengeCategoryQuestion(questions as ChallengeRuntimeQuestion[], selection, slot, remaining(selection, slot.slotId));
  const expected = room.game.board!.cells.find((cell) => cell.id === cellId)!.categoryId;
  assert.equal(selected.question.categoryId, expected);
  room.questionSelection = selected.selection;
  room.questionCursor += 1;
}

test("current challenge selections remain bound to an immutable board across three cursor advances", () => {
  const room = roomForBoard();
  selectCurrentCell(room, "cell-0-0");
  const afterFirst = room.questionSelection as ChallengeCategoryQuestionSelection;
  selectCurrentCell(room, "cell-3-0");
  assert.equal((room.questionSelection as ChallengeCategoryQuestionSelection).challengeCompletedSlotIds.length, afterFirst.challengeCompletedSlotIds.length + 1);
  selectCurrentCell(room, "cell-4-0");
  const selection = room.questionSelection as ChallengeCategoryQuestionSelection;
  assert.equal(selection.challengeCompletedSlotIds.length, 3);
  const expected = categoryChallengePlanForBoard(room.game.board!);
  assert.deepEqual(selection.challengeBoardSlots.map((slot) => slot.categoryId), expected.boardSlots.map((slot) => slot.categoryId));

  const consumed = [...selection.challengeFamilyState.consumedIds];
  const next = releaseCategorySelection(questions, room, true) as ChallengeCategoryQuestionSelection;
  assert.deepEqual(next.challengeFamilyState.consumedIds, consumed);
  assert.deepEqual(next.challengeCompletedSlotIds, []);
  const nextBoard = generateCategoryBoard((room.questionCursor + 1) * 0x9e3779b1, categories);
  assert.deepEqual(next.challengeBoardSlots.map((slot) => slot.categoryId), categoryChallengePlanForBoard(nextBoard).boardSlots.map((slot) => slot.categoryId));
});

test("current-board reconciliation rejects an incompatible active reservation", () => {
  const room = roomForBoard();
  const selection = releaseCategorySelection(questions, room) as ChallengeCategoryQuestionSelection;
  const cellId = "cell-0-0";
  const slot = selection.challengeBoardSlots.find((candidate) => candidate.slotId.endsWith(`:${cellId}`))!;
  const reserved = {
    ...selection,
    reservedForCell: { [cellId]: questions.find((question) => question.categoryId !== slot.categoryId)!.id },
    challengeSlotForCell: { [cellId]: slot.slotId },
    challengeFamilyState: { ...selection.challengeFamilyState, reservedForSlot: { [slot.slotId]: questions.find((question) => question.categoryId !== slot.categoryId)!.id } },
  };
  room.questionSelection = reserved;
  assert.throws(() => releaseCategorySelection(questions, room), /RESERVATION_CATEGORY_CONFLICT/);
});

test("genuine remaining-plan exhaustion is classified for SELECT and START_NEXT_ROUND without mutating the selection", () => {
  const room = roomForBoard();
  releaseCategorySelection(questions, room);
  const sparse = categories.map(({ id }) => questions.find((question) => question.categoryId === id)!);
  for (const nextRound of [false, true]) {
    const trial = structuredClone(room);
    const before = structuredClone(trial.questionSelection);
    assert.throws(
      () => releaseCategorySelection(sparse, trial, nextRound),
      (reason) => isContentDepleted(reason),
    );
    assert.deepEqual(trial.questionSelection, before);
  }
});

test("failed challenge replacement preserves the completed original slot through promotion and later selection", () => {
  const room = roomForBoard();
  const replacedCellId = "cell-0-0";
  selectCurrentCell(room, replacedCellId);
  const beforeReplacement = room.questionSelection as ChallengeCategoryQuestionSelection;
  const originalBoardSlot = beforeReplacement.challengeBoardSlots.find((slot) => slot.slotId.endsWith(`:${replacedCellId}`))!;
  const replacementCategory = categories.find(({ id }) => id !== originalBoardSlot.categoryId)!.id;
  const reserveSlot = beforeReplacement.challengeReserveSlots.find((slot) => slot.categoryId === replacementCategory)!;
  const prepared = reserveChallengeQuestionForCell(
    questions as ChallengeRuntimeQuestion[],
    beforeReplacement,
    reserveSlot,
    remaining(beforeReplacement, reserveSlot.slotId),
    replacedCellId,
  );
  room.game = {
    ...room.game,
    board: {
      ...room.game.board!,
      cells: room.game.board!.cells.map((cell) => cell.id === replacedCellId
        ? { ...cell, categoryId: replacementCategory, categoryLabelAr: "بديل", categoryOccurrence: 99 }
        : cell),
    },
  };
  room.questionSelection = {
    ...prepared.selection,
    challengeReplacementHistory: {
      [replacedCellId]: {
        boardSlotId: originalBoardSlot.slotId,
        reserveSlotId: reserveSlot.slotId,
        originalCategoryId: originalBoardSlot.categoryId,
        replacementCategoryId: replacementCategory,
      },
    },
  };
  const forged = structuredClone(room);
  const forgedHistory = (forged.questionSelection as ChallengeCategoryQuestionSelection).challengeReplacementHistory!;
  forged.questionSelection = {
    ...(forged.questionSelection as ChallengeCategoryQuestionSelection),
    challengeReplacementHistory: {
      ...forgedHistory,
      [replacedCellId]: { ...forgedHistory[replacedCellId]!, originalCategoryId: replacementCategory },
    },
  };
  const beforeForged = structuredClone(forged.questionSelection);
  assert.throws(() => releaseCategorySelection(questions, forged), /REPLACEMENT_LINEAGE_INVALID/);
  assert.deepEqual(forged.questionSelection, beforeForged);
  const reconciled = releaseCategorySelection(questions, room) as ChallengeCategoryQuestionSelection;
  assert.equal(reconciled.challengeBoardSlots.find((slot) => slot.slotId === originalBoardSlot.slotId)!.categoryId, originalBoardSlot.categoryId);
  const promoted = promoteReservedChallengeQuestion(questions as ChallengeRuntimeQuestion[], reconciled, replacedCellId)!;
  assert.equal(promoted.question.categoryId, replacementCategory);
  assert.ok(promoted.selection.challengeCompletedSlotIds.includes(originalBoardSlot.slotId));
  assert.ok(promoted.selection.challengeCompletedSlotIds.includes(reserveSlot.slotId));
  const retrySlot = { slotId: `retry:replacement:${replacedCellId}`, categoryId: replacementCategory };
  const withRetrySlot = addChallengeReplacementReserve(questions as ChallengeRuntimeQuestion[], promoted.selection, retrySlot);
  const retryReserved = reserveChallengeQuestionForCell(
    questions as ChallengeRuntimeQuestion[],
    withRetrySlot,
    retrySlot,
    remaining(withRetrySlot, retrySlot.slotId),
    replacedCellId,
  );
  const retried = updateChallengeRetryLineage(retryReserved.selection, replacedCellId, originalBoardSlot, retrySlot);
  assert.equal(retried.challengeReplacementHistory![replacedCellId]!.reserveSlotId, retrySlot.slotId);
  assert.equal(retried.challengeReplacementHistory![replacedCellId]!.originalCategoryId, originalBoardSlot.categoryId);
  const retryReconciled = releaseCategorySelection(questions, { ...room, questionSelection: retried }) as ChallengeCategoryQuestionSelection;
  const retryPromoted = promoteReservedChallengeQuestion(questions as ChallengeRuntimeQuestion[], retryReconciled, replacedCellId)!;
  assert.equal(retryPromoted.question.categoryId, replacementCategory);
  room.questionSelection = retryPromoted.selection;
  room.questionCursor += 1;
  room.game = { ...room.game, activeCellId: "cell-1-0" };
  const afterLaterSelect = releaseCategorySelection(questions, room) as ChallengeCategoryQuestionSelection;
  assert.equal(afterLaterSelect.challengeBoardSlots.find((slot) => slot.slotId === originalBoardSlot.slotId)!.categoryId, originalBoardSlot.categoryId);
});

test("same-category retry reserve needs no replacement lineage and survives promotion plus a later cell", () => {
  const room = roomForBoard();
  const retriedCellId = "cell-0-0";
  selectCurrentCell(room, retriedCellId);
  const beforeRetry = room.questionSelection as ChallengeCategoryQuestionSelection;
  const originalBoardSlot = beforeRetry.challengeBoardSlots.find((slot) => slot.slotId.endsWith(`:${retriedCellId}`))!;
  const retryReserve = beforeRetry.challengeReserveSlots.find((slot) => slot.categoryId === originalBoardSlot.categoryId)!;
  const reserved = reserveChallengeQuestionForCell(
    questions as ChallengeRuntimeQuestion[],
    beforeRetry,
    retryReserve,
    remaining(beforeRetry, retryReserve.slotId),
    retriedCellId,
  );
  room.questionSelection = reserved.selection;
  const reconciled = releaseCategorySelection(questions, room) as ChallengeCategoryQuestionSelection;
  const promoted = promoteReservedChallengeQuestion(questions as ChallengeRuntimeQuestion[], reconciled, retriedCellId)!;
  assert.equal(promoted.question.categoryId, originalBoardSlot.categoryId);
  room.questionSelection = promoted.selection;
  room.questionCursor += 1;
  room.game = { ...room.game, activeCellId: "cell-1-0" };
  assert.doesNotThrow(() => releaseCategorySelection(questions, room));
});
