/**
 * Pure multi-fact reservation helper for the frozen legacy selector's eventual
 * M2 integration. It has no selector side effects and preserves the selector's
 * existing concept rule alongside the stronger fact-family rule.
 */
export interface FamilyCandidate {
  id: string;
  categoryId: string;
  /** Legacy semantic concept; marker labels and raw answer-label hashes must never be put here. */
  answerConceptId: string;
  /** Every listed fact is consumed together when this card is consumed. */
  factFamilies: readonly string[];
}

export interface FamilySlot { slotId: string; categoryId: string; }
export interface FamilyPreflightOptions {
  searchBudget?: number;
  /** Optional stable match seed; omitted keeps the historical lexical order. */
  seed?: string;
}

export interface FamilySelectionState {
  reservedForSlot: Readonly<Record<string, string>>;
  consumedIds: readonly string[];
  consumedConceptIds: readonly string[];
  consumedFactFamilies: readonly string[];
}

export const initialFamilySelectionState = (): FamilySelectionState => ({
  reservedForSlot: {}, consumedIds: [], consumedConceptIds: [], consumedFactFamilies: [],
});

/**
 * Map A/B/C answers are presentation labels, not semantic identities. When a
 * challenge definition has no selector-owned concept, derive its stable
 * challenge concept from the complete sorted fact set instead.
 */
export function challengeConceptIdFromFactFamilies(factFamilies: readonly string[]): string {
  if (!factFamilies.length || factFamilies.some((family) => !family.trim())) throw new Error("Challenge fact families need non-empty IDs.");
  return `challenge-facts:${JSON.stringify([...factFamilies].sort())}`;
}

/**
 * Finds a complete allocation before anything is reserved. Dynamic scarcity
 * ordering and a hard budget keep an adversarial impossible scope bounded.
 */
export function preflightFamilyAllocation(
  candidates: readonly FamilyCandidate[], slots: readonly FamilySlot[], state: FamilySelectionState = initialFamilySelectionState(), options: FamilyPreflightOptions = {},
): Readonly<Record<string, string>> {
  const byId = indexCandidates(candidates);
  validateSlots(slots);
  const unavailable = unavailableFrom(state, byId);
  const capacity = new Map<string, number>();
  for (const slot of slots) capacity.set(slot.categoryId, (capacity.get(slot.categoryId) ?? 0) + 1);
  for (const [categoryId, needed] of capacity) {
    const available = candidatesForSlot(candidates, categoryId, unavailable, new Set(), new Set(), new Set(), options.seed, "feasibility").length;
    if (available < needed) throw new Error(`Insufficient family-safe reserve for category ${categoryId}: need ${needed}, have ${available}.`);
    assertCategoryFactFloor(candidates, categoryId, needed, unavailable);
  }

  const assignment: Record<string, string> = {};
  const budget = options.searchBudget ?? 50_000;
  let explored = 0;
  const visit = (remaining: readonly FamilySlot[], usedIds: Set<string>, usedConcepts: Set<string>, usedFacts: Set<string>): boolean => {
    if (!remaining.length) return true;
    if (++explored > budget) throw new Error(`Family allocation search budget exhausted after ${budget} branches; reduce scope or provide more disjoint facts.`);
    const ranked = remaining.map((slot) => ({ slot, options: candidatesForSlot(candidates, slot.categoryId, unavailable, usedIds, usedConcepts, usedFacts, options.seed, "feasibility") }))
      .sort((left, right) => left.options.length - right.options.length || left.slot.categoryId.localeCompare(right.slot.categoryId) || left.slot.slotId.localeCompare(right.slot.slotId));
    const current = ranked[0]!;
    if (!current.options.length) return false;
    const after = remaining.filter((slot) => slot.slotId !== current.slot.slotId);
    for (const candidate of current.options) {
      assignment[current.slot.slotId] = candidate.id;
      const nextIds = new Set(usedIds).add(candidate.id);
      const nextConcepts = new Set(usedConcepts).add(candidate.answerConceptId);
      const nextFacts = new Set(usedFacts); candidate.factFamilies.forEach((family) => nextFacts.add(family));
      if (visit(after, nextIds, nextConcepts, nextFacts)) return true;
      delete assignment[current.slot.slotId];
    }
    return false;
  };

  if (!visit(slots, new Set(), new Set(), new Set())) throw new Error("Insufficient family-safe reserve for requested match slots.");
  return assignment;
}

/**
 * Reserves one card only when the supplied remaining match slots stay feasible.
 * Calling code must supply every unreserved future slot, including replacement
 * reserves; this prevents a greedy early reservation from breaking admission.
 */
export function reserveFamilyCandidate(
  candidates: readonly FamilyCandidate[], state: FamilySelectionState, slot: FamilySlot, remainingSlots: readonly FamilySlot[], options: FamilyPreflightOptions = {},
): FamilySelectionState {
  validateSlots([slot, ...remainingSlots]);
  if (state.reservedForSlot[slot.slotId]) throw new Error(`Slot ${slot.slotId} already has a reservation.`);
  const byId = indexCandidates(candidates);
  const unavailable = unavailableFrom(state, byId);
  const optionsForSlot = candidatesForSlot(candidates, slot.categoryId, unavailable, new Set(), new Set(), new Set(), options.seed, "reservation");
  for (const candidate of optionsForSlot) {
    const planned = { ...state, reservedForSlot: { ...state.reservedForSlot, [slot.slotId]: candidate.id } };
    try {
      preflightFamilyAllocation(candidates, remainingSlots, planned, options);
      return planned;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("Insufficient family-safe reserve")) throw error;
    }
  }
  throw new Error(`No family-safe reservation for ${slot.slotId}; remaining slot reserve would be exhausted.`);
}

/** A consumed card and all of its fact families remain unavailable for the match. */
export function consumeFamilyReservation(candidates: readonly FamilyCandidate[], state: FamilySelectionState, slotId: string): FamilySelectionState {
  const id = state.reservedForSlot[slotId];
  const candidate = id ? indexCandidates(candidates).get(id) : undefined;
  if (!candidate) throw new Error(`Slot ${slotId} has no valid reservation to consume.`);
  const reservedForSlot = { ...state.reservedForSlot }; delete reservedForSlot[slotId];
  return {
    reservedForSlot,
    consumedIds: [...state.consumedIds, candidate.id],
    consumedConceptIds: [...state.consumedConceptIds, candidate.answerConceptId],
    consumedFactFamilies: [...state.consumedFactFamilies, ...candidate.factFamilies],
  };
}

/** Releases an unopened reservation; consumed facts are intentionally irreversible. */
export function releaseFamilyReservation(state: FamilySelectionState, slotId: string): FamilySelectionState {
  if (!state.reservedForSlot[slotId]) throw new Error(`Slot ${slotId} has no reservation to release.`);
  const reservedForSlot = { ...state.reservedForSlot }; delete reservedForSlot[slotId];
  return { ...state, reservedForSlot };
}

/** Rechecks future-round feasibility after any consume/release transition. */
export function assertFutureFamilyCapacity(candidates: readonly FamilyCandidate[], state: FamilySelectionState, futureSlots: readonly FamilySlot[]): void {
  preflightFamilyAllocation(candidates, futureSlots, state);
}

function indexCandidates(candidates: readonly FamilyCandidate[]): Map<string, FamilyCandidate> {
  const result = new Map<string, FamilyCandidate>();
  for (const candidate of candidates) {
    if (!candidate.id.trim() || !candidate.categoryId.trim() || !candidate.answerConceptId.trim() || !candidate.factFamilies.length || candidate.factFamilies.some((family) => !family.trim()) || new Set(candidate.factFamilies).size !== candidate.factFamilies.length) throw new Error(`Invalid family candidate ${candidate.id || "(missing id)"}.`);
    if (result.has(candidate.id)) throw new Error(`Duplicate family candidate ${candidate.id}.`);
    result.set(candidate.id, candidate);
  }
  return result;
}

function validateSlots(slots: readonly FamilySlot[]): void {
  const seen = new Set<string>();
  for (const slot of slots) {
    if (!slot.slotId.trim() || !slot.categoryId.trim()) throw new Error("Family slots need non-empty IDs and categories.");
    if (seen.has(slot.slotId)) throw new Error(`Duplicate family slot ${slot.slotId}.`);
    seen.add(slot.slotId);
  }
}

function unavailableFrom(state: FamilySelectionState, byId: Map<string, FamilyCandidate>) {
  const ids = new Set(state.consumedIds);
  const concepts = new Set(state.consumedConceptIds);
  const facts = new Set(state.consumedFactFamilies);
  for (const reservedId of Object.values(state.reservedForSlot)) {
    const candidate = byId.get(reservedId);
    if (!candidate) throw new Error(`Reservation references unknown candidate ${reservedId}.`);
    ids.add(candidate.id); concepts.add(candidate.answerConceptId); candidate.factFamilies.forEach((family) => facts.add(family));
  }
  return { ids, concepts, facts };
}

function candidatesForSlot(
  candidates: readonly FamilyCandidate[],
  categoryId: string,
  unavailable: { ids: Set<string>; concepts: Set<string>; facts: Set<string> },
  usedIds: Set<string>,
  usedConcepts: Set<string>,
  usedFacts: Set<string>,
  seed?: string,
  strategy: "feasibility" | "reservation" = "feasibility",
): FamilyCandidate[] {
  return candidates
    .filter((candidate) => candidate.categoryId === categoryId && !unavailable.ids.has(candidate.id) && !unavailable.concepts.has(candidate.answerConceptId) && !overlaps(unavailable.facts, candidate.factFamilies) && !usedIds.has(candidate.id) && !usedConcepts.has(candidate.answerConceptId) && !overlaps(usedFacts, candidate.factFamilies))
    .sort((left, right) => {
      if (!seed) return left.id.localeCompare(right.id);
      if (strategy === "feasibility" && left.factFamilies.length !== right.factFamilies.length) return left.factFamilies.length - right.factFamilies.length;
      return seededRank(seed, left.id) - seededRank(seed, right.id) || left.id.localeCompare(right.id);
    });
}

function overlaps(values: Set<string>, candidates: readonly string[]): boolean { return candidates.some((candidate) => values.has(candidate)); }

/** A deterministic 32-bit rank; it is stable across processes and JSON persistence. */
function seededRank(seed: string, id: string): number {
  let hash = 0x811c9dc5;
  for (const character of `${seed}\u0000${id}`) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * A cheap necessary-condition check before DFS. It handles inventories such as
 * the held map set, where only three one-fact answer concepts exist and all
 * remaining cards consume three place facts. Without this, an impossible
 * 26-slot reserve request wastes the full bounded search budget.
 */
function assertCategoryFactFloor(
  candidates: readonly FamilyCandidate[],
  categoryId: string,
  needed: number,
  unavailable: { ids: Set<string>; concepts: Set<string>; facts: Set<string> },
): void {
  const available = candidatesForSlot(candidates, categoryId, unavailable, new Set(), new Set(), new Set());
  const minimumFactsByConcept = new Map<string, number>();
  for (const candidate of available) {
    const current = minimumFactsByConcept.get(candidate.answerConceptId);
    if (current === undefined || candidate.factFamilies.length < current) minimumFactsByConcept.set(candidate.answerConceptId, candidate.factFamilies.length);
  }
  const minimumFactUse = [...minimumFactsByConcept.values()].sort((left, right) => left - right).slice(0, needed).reduce((sum, count) => sum + count, 0);
  const distinctFacts = new Set(available.flatMap((candidate) => candidate.factFamilies)).size;
  if (minimumFactsByConcept.size < needed || minimumFactUse > distinctFacts) {
    throw new Error(`Insufficient family-safe reserve for category ${categoryId}: ${needed} slots require at least ${minimumFactUse} distinct facts, but only ${distinctFacts} remain.`);
  }
}
