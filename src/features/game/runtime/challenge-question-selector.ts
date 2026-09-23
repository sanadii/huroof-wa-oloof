/**
 * Freeze-compatible selection boundary for T36. Existing callers continue to
 * use question-selector unchanged; M3 adapters will import this shared API.
 */
import {
  createCategoryQuestionSelection as createLegacyCategoryQuestionSelection,
  createMatchQuestionSelection as createLegacyMatchQuestionSelection,
  promoteReservedQuestion as promoteLegacyReservedQuestion,
  reserveQuestionForCell as reserveLegacyQuestionForCell,
  selectCategoryQuestion as selectLegacyCategoryQuestion,
  selectCharadesQuestion as selectLegacyCharadesQuestion,
  selectMatchQuestion as selectLegacyMatchQuestion,
  type MatchQuestionSelection,
  type RuntimeQuestionV32,
  type RuntimeSelectionOptions,
} from "./question-selector.js";
import {
  assertFutureFamilyCapacity,
  challengeConceptIdFromFactFamilies,
  consumeFamilyReservation,
  initialFamilySelectionState,
  preflightFamilyAllocation,
  releaseFamilyReservation,
  reserveFamilyCandidate,
  type FamilyCandidate,
  type FamilySelectionState,
  type FamilySlot,
} from "../challenges/family-allocation.js";
import type { MapSelectionFacts } from "./map-variant-resolver.js";

export type ChallengeQuestionMetadata = {
  factFamilies: readonly string[];
  kind?: "navigation" | "missing_tile" | "memory" | "qatar_map" | "word_search";
  /** Optional selector-owned concept for non-map challenge definitions. */
  conceptId?: string;
};

export type ChallengeRuntimeQuestion = RuntimeQuestionV32 & {
  challenge?: ChallengeQuestionMetadata;
  /** Sidecar-only facts for a preserved ordinary map; never activate a challenge. */
  selectionFacts?: MapSelectionFacts;
};

/** The caller supplies every 25-cell board slot and every replacement reserve explicitly. */
export type ChallengeSelectionPlan = { boardSlots: readonly FamilySlot[]; reserveSlots: readonly FamilySlot[] };

export type ChallengeCategoryQuestionSelection = MatchQuestionSelection & {
  challengeFamilyState: FamilySelectionState;
  /** Persisted plan receipt for later capacity rechecks; it contains no question text. */
  challengePlannedSlots: readonly FamilySlot[];
  challengeBoardSlots: readonly FamilySlot[];
  challengeReserveSlots: readonly FamilySlot[];
  /** Cell-to-plan-slot binding for release/promote after a terminal replacement. */
  challengeSlotForCell: Readonly<Record<string, string>>;
  /** Completed slot IDs let every later reservation prove its full remaining plan. */
  challengeCompletedSlotIds: readonly string[];
  /**
   * An immutable category board cell can be replaced after a failed challenge.
   * Keep the old completed board slot and the replacement reserve explicitly
   * paired so a later selection can prove why their categories differ.
   */
  challengeReplacementHistory?: Readonly<Record<string, {
    boardSlotId: string;
    reserveSlotId: string;
    originalCategoryId: string;
    replacementCategoryId: string;
  }>>;
};

export type ChallengeSelectionResult = { question: ChallengeRuntimeQuestion; selection: ChallengeCategoryQuestionSelection };

// These compatibility exports deliberately delegate byte-for-byte behavior to
// the frozen selector for every existing room and non-challenge caller.
export const createMatchQuestionSelection = createLegacyMatchQuestionSelection;
export const createCategoryQuestionSelection = createLegacyCategoryQuestionSelection;
export const reserveQuestionForCell = reserveLegacyQuestionForCell;
export const promoteReservedQuestion = promoteLegacyReservedQuestion;
export const selectCategoryQuestion = selectLegacyCategoryQuestion;
export const selectMatchQuestion = selectLegacyMatchQuestion;
export const selectCharadesQuestion = selectLegacyCharadesQuestion;
export type { MatchQuestionSelection, RuntimeQuestionV32, RuntimeSelectionOptions };

/**
 * Builds an additive challenge selection state. The explicit plan is an
 * admission contract: callers cannot invent future capacity from a category
 * count or omit replacement reserves.
 */
export function createChallengeCategoryQuestionSelection(
  questions: readonly ChallengeRuntimeQuestion[],
  options: Omit<RuntimeSelectionOptions, "reservePerLetter">,
  plan: ChallengeSelectionPlan,
): ChallengeCategoryQuestionSelection {
  validateChallengePlan(options, plan);
  const plannedSlots = [...plan.boardSlots, ...plan.reserveSlots];
  const candidates = eligibleFamilyCandidates(questions, options.categories);
  preflightFamilyAllocation(candidates, plannedSlots, initialFamilySelectionState(), { seed: String(options.seed) });
  const legacySelection = createLegacyCategoryQuestionSelection(normalizeForLegacySelection(questions), options);
  return {
    ...legacySelection,
    challengeFamilyState: initialFamilySelectionState(),
    challengePlannedSlots: plannedSlots,
    challengeBoardSlots: [...plan.boardSlots],
    challengeReserveSlots: [...plan.reserveSlots],
    challengeSlotForCell: {},
    challengeCompletedSlotIds: [],
    challengeReplacementHistory: {},
  };
}

/**
 * Starts the next board plan without forgetting facts consumed in prior rounds.
 * Open reservations are deliberately released; consumed selections are never
 * released or reused.
 */
export function beginNextChallengeSelectionRound(
  questions: readonly ChallengeRuntimeQuestion[],
  selection: ChallengeCategoryQuestionSelection,
  plan: ChallengeSelectionPlan,
): ChallengeCategoryQuestionSelection {
  validateChallengePlan({ categories: selection.categories, modality: selection.modality, seed: selection.seed }, plan);
  const released = releaseAllOpenChallengeReservations(questions, selection);
  const plannedSlots = [...plan.boardSlots, ...plan.reserveSlots];
  preflightFamilyAllocation(eligibleFamilyCandidates(questions, selection.categories), plannedSlots, released.challengeFamilyState, { seed: String(selection.seed) });
  return {
    ...released,
    challengePlannedSlots: plannedSlots,
    challengeBoardSlots: [...plan.boardSlots],
    challengeReserveSlots: [...plan.reserveSlots],
    challengeSlotForCell: {},
    challengeCompletedSlotIds: [],
    challengeReplacementHistory: {},
  };
}

/** Adds one more explicit replacement reserve only while the current plan remains feasible. */
export function addChallengeReplacementReserve(
  questions: readonly ChallengeRuntimeQuestion[],
  selection: ChallengeCategoryQuestionSelection,
  reserveSlot: FamilySlot,
): ChallengeCategoryQuestionSelection {
  if (!selection.categories.includes(reserveSlot.categoryId)) throw new Error("Challenge replacement reserve is outside the selected category scope.");
  if (selection.challengePlannedSlots.some((slot) => slot.slotId === reserveSlot.slotId)) throw new Error(`Challenge replacement slot ${reserveSlot.slotId} already exists.`);
  const prospective = { ...selection, challengePlannedSlots: [...selection.challengePlannedSlots, reserveSlot] };
  const futureSlots = remainingPlannedSlots(prospective);
  preflightFamilyAllocation(eligibleFamilyCandidates(questions, selection.categories), futureSlots, selection.challengeFamilyState, { seed: String(selection.seed) });
  return { ...selection, challengePlannedSlots: prospective.challengePlannedSlots, challengeReserveSlots: [...selection.challengeReserveSlots, reserveSlot] };
}

/** Reserves an exact family-safe card for a planned cell without exposing it. */
export function reserveChallengeQuestionForCell(
  questions: readonly ChallengeRuntimeQuestion[],
  selection: ChallengeCategoryQuestionSelection,
  slot: FamilySlot,
  remainingSlots: readonly FamilySlot[],
  cellId: string,
): ChallengeSelectionResult {
  if ((selection.reservedForCell ?? {})[cellId]) throw new Error(`Cell ${cellId} already has a reserved question.`);
  assertExplicitRemainingPlan(selection, slot, remainingSlots);
  const candidates = eligibleFamilyCandidates(questions, selection.categories);
  const familyState = reserveFamilyCandidate(candidates, selection.challengeFamilyState, slot, remainingSlots, { seed: String(selection.seed) });
  const id = familyState.reservedForSlot[slot.slotId]!;
  const question = questionById(questions, id);
  assertLegacyAvailable(question, selection);
  const concept = selectorConcept(question);
  return {
    question,
    selection: {
      ...selection,
      challengeFamilyState: familyState,
      reservedQuestionIds: [...(selection.reservedQuestionIds ?? []), question.id],
      reservedAnswerConceptIds: [...(selection.reservedAnswerConceptIds ?? []), concept],
      reservedForCell: { ...(selection.reservedForCell ?? {}), [cellId]: question.id },
      challengeSlotForCell: { ...selection.challengeSlotForCell, [cellId]: slot.slotId },
    },
  };
}

/** Promotes a reservation when its cell opens and consumes all of its facts. */
export function promoteReservedChallengeQuestion(
  questions: readonly ChallengeRuntimeQuestion[],
  selection: ChallengeCategoryQuestionSelection,
  cellId: string,
): ChallengeSelectionResult | undefined {
  const slotId = selection.challengeSlotForCell[cellId];
  if (!slotId) return undefined;
  const promoted = promoteLegacyReservedQuestion(normalizeForLegacySelection(questions), selection, cellId);
  if (!promoted) return undefined;
  const question = questionById(questions, promoted.question.id);
  const slotForCell = { ...selection.challengeSlotForCell };
  delete slotForCell[cellId];
  return {
    question,
    selection: {
      ...promoted.selection,
      challengeFamilyState: consumeFamilyReservation(eligibleFamilyCandidates(questions, selection.categories), selection.challengeFamilyState, slotId),
      challengePlannedSlots: selection.challengePlannedSlots,
      challengeBoardSlots: selection.challengeBoardSlots,
      challengeReserveSlots: selection.challengeReserveSlots,
      challengeSlotForCell: slotForCell,
      challengeCompletedSlotIds: [...selection.challengeCompletedSlotIds, slotId],
    },
  };
}

/** Releases an unopened reservation, preserving all previously consumed facts. */
export function releaseReservedChallengeQuestion(
  questions: readonly ChallengeRuntimeQuestion[],
  selection: ChallengeCategoryQuestionSelection,
  cellId: string,
): ChallengeCategoryQuestionSelection {
  const slotId = selection.challengeSlotForCell[cellId];
  const id = selection.reservedForCell?.[cellId];
  if (!slotId || !id) throw new Error(`Cell ${cellId} has no challenge reservation.`);
  const question = questionById(questions, id);
  const slotForCell = { ...selection.challengeSlotForCell };
  delete slotForCell[cellId];
  return {
    ...selection,
    challengeFamilyState: releaseFamilyReservation(selection.challengeFamilyState, slotId),
    challengeBoardSlots: selection.challengeBoardSlots,
    challengeReserveSlots: selection.challengeReserveSlots,
    reservedQuestionIds: (selection.reservedQuestionIds ?? []).filter((candidate) => candidate !== question.id),
    reservedAnswerConceptIds: (selection.reservedAnswerConceptIds ?? []).filter((candidate) => candidate !== selectorConcept(question)),
    reservedForCell: Object.fromEntries(Object.entries(selection.reservedForCell ?? {}).filter(([candidate]) => candidate !== cellId)),
    challengeSlotForCell: slotForCell,
  };
}

/** Selects and consumes a family-safe card when no private pre-reservation is needed. */
export function selectChallengeCategoryQuestion(
  questions: readonly ChallengeRuntimeQuestion[],
  selection: ChallengeCategoryQuestionSelection,
  slot: FamilySlot,
  remainingSlots: readonly FamilySlot[],
): ChallengeSelectionResult {
  assertExplicitRemainingPlan(selection, slot, remainingSlots);
  const candidates = eligibleFamilyCandidates(questions, selection.categories);
  const reserved = reserveFamilyCandidate(candidates, selection.challengeFamilyState, slot, remainingSlots, { seed: String(selection.seed) });
  const id = reserved.reservedForSlot[slot.slotId]!;
  const question = questionById(questions, id);
  assertLegacyAvailable(question, selection);
  const concept = selectorConcept(question);
  return {
    question,
    selection: {
      ...selection,
      challengeFamilyState: consumeFamilyReservation(candidates, reserved, slot.slotId),
      consumedQuestionIds: [...selection.consumedQuestionIds, question.id],
      consumedAnswerConceptIds: [...selection.consumedAnswerConceptIds, concept],
      challengeCompletedSlotIds: [...selection.challengeCompletedSlotIds, slot.slotId],
    },
  };
}

export function assertChallengeSelectionCapacity(
  questions: readonly ChallengeRuntimeQuestion[],
  selection: ChallengeCategoryQuestionSelection,
  futureSlots: readonly FamilySlot[],
): void {
  assertExplicitFuturePlan(selection, futureSlots);
  assertFutureFamilyCapacity(eligibleFamilyCandidates(questions, selection.categories), selection.challengeFamilyState, futureSlots);
}

function normalizeForLegacySelection(questions: readonly ChallengeRuntimeQuestion[]): RuntimeQuestionV32[] {
  return questions.map((question) => ({ ...question, answerConceptId: selectorConcept(question) }));
}

function toFamilyCandidate(question: ChallengeRuntimeQuestion): FamilyCandidate {
  const factFamilies = question.challenge?.factFamilies ?? question.selectionFacts?.factFamilies ?? [`ordinary-concept:${question.answerConceptId}`];
  return { id: question.id, categoryId: question.categoryId, answerConceptId: selectorConcept(question), factFamilies };
}

/** Mirrors the frozen category board: only in-scope non-charades cards can fill a board cell. */
function eligibleFamilyCandidates(questions: readonly ChallengeRuntimeQuestion[], categories: readonly string[]): FamilyCandidate[] {
  const selectedCategories = new Set(categories);
  return questions
    .filter((question) => question.modality !== "charades" && selectedCategories.has(question.categoryId))
    .map(toFamilyCandidate);
}

function selectorConcept(question: ChallengeRuntimeQuestion): string {
  if (question.challenge?.kind === "qatar_map") return challengeConceptIdFromFactFamilies(question.challenge.factFamilies);
  if (question.selectionFacts?.kind === "qatar_map") return challengeConceptIdFromFactFamilies(question.selectionFacts.factFamilies);
  return question.challenge?.conceptId ?? question.answerConceptId;
}

function questionById(questions: readonly ChallengeRuntimeQuestion[], id: string): ChallengeRuntimeQuestion {
  const question = questions.find((candidate) => candidate.id === id);
  if (!question) throw new Error("Reserved challenge question is absent from the pinned release.");
  return question;
}

function assertLegacyAvailable(question: ChallengeRuntimeQuestion, selection: ChallengeCategoryQuestionSelection): void {
  const ids = new Set([...selection.consumedQuestionIds, ...(selection.reservedQuestionIds ?? [])]);
  const concepts = new Set([...selection.consumedAnswerConceptIds, ...(selection.reservedAnswerConceptIds ?? [])]);
  if (ids.has(question.id) || concepts.has(selectorConcept(question))) throw new Error("Family reservation conflicts with persisted selector history.");
}

function assertExplicitRemainingPlan(selection: ChallengeCategoryQuestionSelection, slot: FamilySlot, remainingSlots: readonly FamilySlot[]): void {
  const planned = new Map(selection.challengePlannedSlots.map((candidate) => [candidate.slotId, candidate]));
  const expected = planned.get(slot.slotId);
  if (!expected || expected.categoryId !== slot.categoryId) throw new Error(`Challenge slot ${slot.slotId} is not in the persisted plan.`);
  const occupied = occupiedSlotIds(selection);
  if (occupied.has(slot.slotId)) throw new Error(`Challenge slot ${slot.slotId} is already completed or reserved.`);
  const expectedRemaining = remainingPlannedSlots(selection).filter((candidate) => candidate.slotId !== slot.slotId);
  const provided = new Map(remainingSlots.map((candidate) => [candidate.slotId, candidate]));
  if (provided.size !== remainingSlots.length || provided.size !== expectedRemaining.length) throw new Error("Challenge reservation must include every remaining planned board and reserve slot.");
  for (const candidate of expectedRemaining) {
    const providedSlot = provided.get(candidate.slotId);
    if (!providedSlot || providedSlot.categoryId !== candidate.categoryId) throw new Error("Challenge reservation must include every remaining planned board and reserve slot.");
  }
}

function assertExplicitFuturePlan(selection: ChallengeCategoryQuestionSelection, futureSlots: readonly FamilySlot[]): void {
  const expected = remainingPlannedSlots(selection);
  const provided = new Map(futureSlots.map((slot) => [slot.slotId, slot]));
  if (provided.size !== futureSlots.length || provided.size !== expected.length) throw new Error("Challenge capacity check must include every remaining planned board and reserve slot.");
  for (const slot of expected) {
    const future = provided.get(slot.slotId);
    if (!future || future.categoryId !== slot.categoryId) throw new Error("Challenge capacity check must include every remaining planned board and reserve slot.");
  }
}

function validateChallengePlan(options: Pick<RuntimeSelectionOptions, "categories" | "seed" | "modality">, plan: ChallengeSelectionPlan): void {
  const categories = [...new Set(options.categories)].sort();
  if (plan.boardSlots.length !== 25) throw new Error("Challenge plan requires exactly 25 board slots.");
  const allowed = new Set(categories);
  const boardCounts = new Map(categories.map((category) => [category, 0]));
  const reserveCounts = new Map(categories.map((category) => [category, 0]));
  for (const slot of plan.boardSlots) {
    if (!allowed.has(slot.categoryId)) throw new Error("Challenge plan contains a board slot outside the selected category scope.");
    boardCounts.set(slot.categoryId, boardCounts.get(slot.categoryId)! + 1);
  }
  for (const slot of plan.reserveSlots) {
    if (!allowed.has(slot.categoryId)) throw new Error("Challenge plan contains a reserve slot outside the selected category scope.");
    reserveCounts.set(slot.categoryId, reserveCounts.get(slot.categoryId)! + 1);
  }
  const counts = [...boardCounts.values()];
  if (!counts.length || Math.max(...counts) - Math.min(...counts) > 1 || counts.some((count) => count === 0)) throw new Error("Challenge plan requires a balanced 25-cell category allocation.");
  if ([...reserveCounts.values()].some((count) => count < 1)) throw new Error("Challenge plan requires at least one replacement reserve per category.");
  const slotIds = [...plan.boardSlots, ...plan.reserveSlots].map((slot) => slot.slotId);
  if (new Set(slotIds).size !== slotIds.length) throw new Error("Challenge plan has duplicate board or reserve slot IDs.");
}

function occupiedSlotIds(selection: ChallengeCategoryQuestionSelection): Set<string> {
  return new Set([...selection.challengeCompletedSlotIds, ...Object.values(selection.challengeSlotForCell)]);
}

function remainingPlannedSlots(selection: ChallengeCategoryQuestionSelection): FamilySlot[] {
  const occupied = occupiedSlotIds(selection);
  return selection.challengePlannedSlots.filter((slot) => !occupied.has(slot.slotId));
}

function releaseAllOpenChallengeReservations(
  questions: readonly ChallengeRuntimeQuestion[],
  selection: ChallengeCategoryQuestionSelection,
): ChallengeCategoryQuestionSelection {
  let familyState = selection.challengeFamilyState;
  for (const slotId of Object.values(selection.challengeSlotForCell)) familyState = releaseFamilyReservation(familyState, slotId);
  const reservedIds = new Set(Object.values(selection.reservedForCell ?? {}));
  const releasedConcepts = new Set([...reservedIds].map((id) => selectorConcept(questionById(questions, id))));
  return {
    ...selection,
    challengeFamilyState: familyState,
    reservedQuestionIds: (selection.reservedQuestionIds ?? []).filter((id) => !reservedIds.has(id)),
    reservedAnswerConceptIds: (selection.reservedAnswerConceptIds ?? []).filter((concept) => !releasedConcepts.has(concept)),
    reservedForCell: {},
    challengeSlotForCell: {},
  };
}
