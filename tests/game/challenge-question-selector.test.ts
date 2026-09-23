import assert from "node:assert/strict";
import test from "node:test";
import {
  addChallengeReplacementReserve,
  assertChallengeSelectionCapacity,
  beginNextChallengeSelectionRound,
  createCategoryQuestionSelection,
  createChallengeCategoryQuestionSelection,
  promoteReservedChallengeQuestion,
  releaseReservedChallengeQuestion,
  reserveChallengeQuestionForCell,
  type ChallengeRuntimeQuestion,
} from "../../src/features/game/runtime/challenge-question-selector.js";
import { createCategoryQuestionSelection as createFrozenCategoryQuestionSelection } from "../../src/features/game/runtime/question-selector.js";

const ordinaryCategory = "ordinary";
const mapCategory = "map";
const question = (id: string, categoryId: string, answerConceptId: string, factFamilies?: readonly string[]): ChallengeRuntimeQuestion => ({
  id,
  categoryId,
  modality: "classic",
  answerConceptId,
  headerAr: "عنوان",
  promptAr: "سؤال",
  canonicalAnswer: "إجابة",
  acceptedAnswers: ["إجابة"],
  ...(factFamilies ? { challenge: { kind: "qatar_map", factFamilies } } : {}),
});
const mixedQuestions: ChallengeRuntimeQuestion[] = [
  ...Array.from({ length: 28 }, (_, index) => question(`map-${index}`, mapCategory, index % 3 === 0 ? "A" : index % 3 === 1 ? "B" : "C", [`place-${index}`])),
  ...Array.from({ length: 20 }, (_, index) => question(`ordinary-${index}`, ordinaryCategory, `ordinary-concept-${index}`)),
];
const selectionPlan = (prefix = "round-1") => ({
  boardSlots: [
    ...Array.from({ length: 13 }, (_, index) => ({ slotId: `${prefix}-map-${index + 1}`, categoryId: mapCategory })),
    ...Array.from({ length: 12 }, (_, index) => ({ slotId: `${prefix}-ordinary-${index + 1}`, categoryId: ordinaryCategory })),
  ],
  reserveSlots: [{ slotId: `${prefix}-map-reserve`, categoryId: mapCategory }, { slotId: `${prefix}-ordinary-reserve`, categoryId: ordinaryCategory }],
});
const plan = selectionPlan();
const plannedSlots = [...plan.boardSlots, ...plan.reserveSlots];
const options = { categories: [mapCategory, ordinaryCategory], modality: "classic" as const, seed: 19 };
const remainingAfter = (slotId: string) => plannedSlots.filter((slot) => slot.slotId !== slotId);
const remainingWithout = (...slotIds: string[]) => plannedSlots.filter((slot) => !slotIds.includes(slot.slotId));

test("legacy category selection is exact through the compatibility wrapper", () => {
  const ordinary = mixedQuestions.filter((candidate) => candidate.categoryId === ordinaryCategory || candidate.categoryId === mapCategory).map((candidate) => ({ ...candidate, answerConceptId: candidate.id }));
  assert.deepEqual(createCategoryQuestionSelection(ordinary, options), createFrozenCategoryQuestionSelection(ordinary, options));
});

test("challenge selection uses semantic map facts, reserves/promotes/releases safely, and survives JSON persistence", () => {
  let selection = createChallengeCategoryQuestionSelection(mixedQuestions, options, plan);
  assert.equal(selection.challengeFamilyState.consumedFactFamilies.length, 0);
  assert.throws(() => createChallengeCategoryQuestionSelection(mixedQuestions, options, { boardSlots: [plan.boardSlots[0]!], reserveSlots: [] }), /exactly 25 board slots/);
  const reserved = reserveChallengeQuestionForCell(mixedQuestions, selection, plannedSlots[0]!, remainingAfter(plannedSlots[0]!.slotId), "cell-map");
  assert.ok(reserved.question.challenge?.factFamilies.includes("place-" + reserved.question.id.replace("map-", "")));
  assert.notEqual(reserved.selection.reservedAnswerConceptIds?.[0], reserved.question.answerConceptId);
  const restored = JSON.parse(JSON.stringify(reserved.selection)) as typeof reserved.selection;
  const promoted = promoteReservedChallengeQuestion(mixedQuestions, restored, "cell-map")!;
  assert.ok(promoted.selection.challengeFamilyState.consumedFactFamilies.length === 1);
  assert.ok(promoted.selection.consumedQuestionIds.includes(reserved.question.id));

  const reserveSlot = plannedSlots.find((slot) => slot.categoryId === ordinaryCategory)!;
  const replacement = reserveChallengeQuestionForCell(mixedQuestions, promoted.selection, reserveSlot, remainingWithout(plannedSlots[0]!.slotId, reserveSlot.slotId), "cell-replacement");
  selection = releaseReservedChallengeQuestion(mixedQuestions, replacement.selection, "cell-replacement");
  assert.equal(selection.reservedForCell?.["cell-replacement"], undefined);
  assert.equal(selection.challengeSlotForCell["cell-replacement"], undefined);
  assert.doesNotThrow(() => assertChallengeSelectionCapacity(mixedQuestions, selection, remainingAfter(plannedSlots[0]!.slotId)));
  assert.throws(() => assertChallengeSelectionCapacity(mixedQuestions, selection, plannedSlots), /every remaining planned board and reserve slot/);

  const firstMap = reserveChallengeQuestionForCell(mixedQuestions, createChallengeCategoryQuestionSelection(mixedQuestions, options, plan), plannedSlots[0]!, remainingAfter(plannedSlots[0]!.slotId), "cell-seed");
  const repeatMap = reserveChallengeQuestionForCell(mixedQuestions, createChallengeCategoryQuestionSelection(mixedQuestions, options, plan), plannedSlots[0]!, remainingAfter(plannedSlots[0]!.slotId), "cell-seed");
  assert.equal(repeatMap.question.id, firstMap.question.id);
  const seededIds = new Set(Array.from({ length: 24 }, (_, index) => {
    const seeded = createChallengeCategoryQuestionSelection(mixedQuestions, { ...options, seed: index + 1 }, plan);
    return reserveChallengeQuestionForCell(mixedQuestions, seeded, plannedSlots[0]!, remainingAfter(plannedSlots[0]!.slotId), "cell-seed").question.id;
  }));
  assert.ok(seededIds.size > 1);

  const open = reserveChallengeQuestionForCell(mixedQuestions, selection, plannedSlots[1]!, remainingWithout(plannedSlots[0]!.slotId, plannedSlots[1]!.slotId), "cell-open");
  const secondPlan = selectionPlan("round-2");
  const nextRound = beginNextChallengeSelectionRound(mixedQuestions, open.selection, secondPlan);
  assert.equal(nextRound.reservedQuestionIds?.length, 0);
  assert.ok(nextRound.challengeFamilyState.consumedFactFamilies.includes(reserved.question.challenge!.factFamilies[0]!));
  const secondSlots = [...secondPlan.boardSlots, ...secondPlan.reserveSlots];
  const secondReserved = reserveChallengeQuestionForCell(mixedQuestions, nextRound, secondSlots[0]!, secondSlots.slice(1), "round-2-cell");
  assert.notEqual(secondReserved.question.challenge?.factFamilies[0], reserved.question.challenge?.factFamilies[0]);

  let expanded = promoted.selection;
  let added = 0;
  while (added < 20) {
    try {
      expanded = addChallengeReplacementReserve(mixedQuestions, expanded, { slotId: `extra-map-${added + 1}`, categoryId: mapCategory });
      added += 1;
    } catch (error) {
      assert.match((error as Error).message, /Insufficient family-safe reserve/);
      break;
    }
  }
  assert.ok(added > 1);
  assert.throws(() => addChallengeReplacementReserve(mixedQuestions, expanded, { slotId: `extra-map-${added + 1}`, categoryId: mapCategory }), /Insufficient family-safe reserve/);
});

test("a reservation avoids a greedy map fact collision that would exhaust its explicit future slot", () => {
  const trap: ChallengeRuntimeQuestion[] = [
    { ...question("a-shared", "a", "a-shared"), challenge: { kind: "navigation", factFamilies: ["shared"] } },
    { ...question("a-safe", "a", "a-safe"), challenge: { kind: "navigation", factFamilies: ["safe"] } },
    ...Array.from({ length: 14 }, (_, index) => ({ ...question(`a-fill-${index}`, "a", `a-fill-${index}`), challenge: { kind: "navigation" as const, factFamilies: [`a-fill-${index}`] } })),
    ...Array.from({ length: 13 }, (_, index) => ({ ...question(`b-${index}`, "b", `b-${index}`), challenge: { kind: "navigation" as const, factFamilies: [`b-${index}`] } })),
    { ...question("b-shared", "b", "b-shared"), challenge: { kind: "navigation", factFamilies: ["shared"] } },
  ];
  const trapPlan = {
    boardSlots: [...Array.from({ length: 12 }, (_, index) => ({ slotId: `a-board-${index}`, categoryId: "a" })), ...Array.from({ length: 13 }, (_, index) => ({ slotId: `b-board-${index}`, categoryId: "b" }))],
    reserveSlots: [{ slotId: "a-reserve", categoryId: "a" }, { slotId: "b-reserve", categoryId: "b" }],
  };
  const trapSlots = [...trapPlan.boardSlots, ...trapPlan.reserveSlots];
  const selection = createChallengeCategoryQuestionSelection(trap, { categories: ["a", "b"], modality: "classic", seed: 0 }, trapPlan);
  const reserved = reserveChallengeQuestionForCell(trap, selection, trapSlots[0]!, trapSlots.slice(1), "cell-a");
  assert.notEqual(reserved.question.challenge?.factFamilies[0], "shared");
});

test("charades cannot satisfy a challenge plan or enter a seeded family reservation", () => {
  const insufficient: ChallengeRuntimeQuestion[] = [
    ...Array.from({ length: 13 }, (_, index) => question(`eligible-map-${index}`, mapCategory, `map-${index}`, [`eligible-place-${index}`])),
    ...Array.from({ length: 40 }, (_, index) => ({ ...question(`charades-map-${index}`, mapCategory, `charades-${index}`, [`charades-place-${index}`]), modality: "charades" as const })),
    ...Array.from({ length: 20 }, (_, index) => question(`eligible-ordinary-${index}`, ordinaryCategory, `ordinary-${index}`)),
  ];
  assert.throws(
    () => createChallengeCategoryQuestionSelection(insufficient, options, plan),
    /Insufficient family-safe reserve/,
  );

  const eligible: ChallengeRuntimeQuestion[] = [
    ...mixedQuestions,
    ...Array.from({ length: 40 }, (_, index) => ({ ...question(`charades-eligible-map-${index}`, mapCategory, `charades-eligible-${index}`, [`charades-eligible-place-${index}`]), modality: "charades" as const })),
  ];
  for (let seed = 1; seed <= 24; seed += 1) {
    const selection = createChallengeCategoryQuestionSelection(eligible, { ...options, seed }, plan);
    const reserved = reserveChallengeQuestionForCell(eligible, selection, plannedSlots[0]!, remainingAfter(plannedSlots[0]!.slotId), `charades-${seed}`);
    assert.notEqual(reserved.question.modality, "charades");
  }
});
