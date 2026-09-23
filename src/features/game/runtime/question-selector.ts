export type RuntimeQuestionV32 = {
  id: string;
  categoryId: string;
  modality: "classic" | "image" | "video" | "charades";
  targetLetter?: string;
  answerConceptId: string;
  headerAr: string;
  promptAr: string;
  canonicalAnswer: string;
  acceptedAnswers: string[];
};
export type RuntimeSelectionOptions = {
  categories: string[];
  modality: RuntimeQuestionV32["modality"];
  seed: number;
  reservePerLetter?: number;
};
export type MatchQuestionSelection = {
  queues: Record<string, string[]>;
  consumedQuestionIds: string[];
  consumedAnswerConceptIds: string[];
  seed: number;
  categories: string[];
  modality: RuntimeQuestionV32["modality"];
  /** Category queues use the same monotonic consumed histories as letter queues. */
  gameKind?: "huroof" | "categories";
  reservedQuestionIds?: string[];
  reservedAnswerConceptIds?: string[];
  /** A reserved question is unavailable to every other cell until that cell opens. */
  reservedForCell?: Record<string, string>;
};
const rand = (seed: number) => {
  let n = seed >>> 0;
  return () => {
    n += 0x6d2b79f5;
    let t = n;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const shuffled = <T>(values: T[], seed: number) => {
  const result = [...values];
  const next = rand(seed);
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
/** Finds a distinct global concept assignment for every category allocation slot. */
function planCategoryAllocation(
  questions: RuntimeQuestionV32[], categories: string[], slotsPerCategory: number,
): Map<string, Set<string>> | undefined {
  const slots = categories.flatMap((category) => Array.from({ length: slotsPerCategory }, () => category));
  const conceptsFor = new Map(categories.map((category) => [category, [...new Set(questions.filter((question) => question.categoryId === category && question.modality !== "charades").map((question) => question.answerConceptId))].sort()]));
  const owner = new Map<string, number>();
  const visit = (slot: number, seen: Set<string>): boolean => {
    for (const concept of conceptsFor.get(slots[slot]) ?? []) {
      if (seen.has(concept)) continue;
      seen.add(concept);
      const occupied = owner.get(concept);
      if (occupied === undefined || visit(occupied, seen)) { owner.set(concept, slot); return true; }
    }
    return false;
  };
  if (!slots.every((_, slot) => visit(slot, new Set()))) return undefined;
  const planned = new Map(categories.map((category) => [category, new Set<string>()]));
  for (const [concept, slot] of owner) planned.get(slots[slot])!.add(concept);
  return planned;
}
export function createMatchQuestionSelection(
  questions: RuntimeQuestionV32[],
  options: RuntimeSelectionOptions,
): MatchQuestionSelection {
  const categorySet = new Set(options.categories);
  if (!categorySet.size)
    throw new Error("Question selection requires an explicit category scope.");
  const eligible = questions.filter(
    (question) =>
      question.modality === options.modality &&
      categorySet.has(question.categoryId) &&
      typeof question.targetLetter === "string" &&
      question.targetLetter.trim(),
  );
  if (options.modality === "charades")
    throw new Error(
      "Separate-mode charades cannot supply classic-board questions.",
    );
  const queues: Record<string, string[]> = {};
  const reserve = options.reservePerLetter ?? 3;
  for (const question of eligible)
    queues[question.targetLetter!.trim()] = [
      ...(queues[question.targetLetter!.trim()] ?? []),
      question.id,
    ];
  if (Object.keys(queues).length < 25)
    throw new Error("Insufficient 16 visible + 9 surprise letter coverage.");
  for (const [letter, queue] of Object.entries(queues))
    if (
      queue.length < reserve ||
      new Set(
        queue.map((id) => eligible.find((q) => q.id === id)?.answerConceptId),
      ).size < reserve
    )
      throw new Error(`Insufficient concept reserve for letter ${letter}.`);
  for (const [letter, queue] of Object.entries(queues))
    queues[letter] = shuffled(
      queue,
      options.seed ^ [...letter].reduce((v, c) => v + c.charCodeAt(0), 0),
    );
  return {
    queues,
    consumedQuestionIds: [],
    consumedAnswerConceptIds: [],
    seed: options.seed,
    categories: [...categorySet].sort(),
    modality: options.modality,
  };
}

export function createCategoryQuestionSelection(
  questions: RuntimeQuestionV32[],
  options: Omit<RuntimeSelectionOptions, "reservePerLetter">,
): MatchQuestionSelection {
  const categories = [...new Set(options.categories)].sort();
  if (categories.length < 2 || categories.length > 10)
    throw new Error("Category selection requires two to ten categories.");
  const queues: Record<string, string[]> = {};
  const slotsPerCategory = Math.ceil(25 / categories.length) + 1;
  for (const category of categories) {
    const eligible = questions
      .filter((question) => question.modality !== "charades" && question.categoryId === category)
      .sort((left, right) => left.id.localeCompare(right.id));
    const uniqueConcepts = new Set(eligible.map((question) => question.answerConceptId)).size;
    // The balanced 25-cell board assigns at most ceil(25/categoryCount) cells
    // to one category. Keep one independent reserve for a terminal replacement.
    if (uniqueConcepts < slotsPerCategory)
      throw new Error(`Category ${category} has insufficient unique concepts for its board allocation and replacement reserve.`);
    queues[category] = eligible.map((question) => question.id);
  }
  const allocation = planCategoryAllocation(questions, categories, slotsPerCategory);
  if (!allocation)
    throw new Error("Category scope has overlapping concepts that cannot cover its board allocation and replacement reserve.");
  for (const category of categories) {
    const categoryQuestions = questions.filter((question) => question.categoryId === category && question.modality !== "charades").sort((left, right) => left.id.localeCompare(right.id));
    const reservedConcepts = allocation.get(category)!;
    const preferred = categoryQuestions.filter((question) => reservedConcepts.has(question.answerConceptId));
    const remaining = categoryQuestions.filter((question) => !reservedConcepts.has(question.answerConceptId));
    const seed = options.seed ^ [...category].reduce((sum, value) => sum + value.charCodeAt(0), 0);
    queues[category] = [...shuffled(preferred.map((question) => question.id), seed), ...shuffled(remaining.map((question) => question.id), seed ^ 0x9e3779b1)];
  }
  return { queues, consumedQuestionIds: [], consumedAnswerConceptIds: [], reservedQuestionIds: [], reservedAnswerConceptIds: [], reservedForCell: {}, seed: options.seed, categories, modality: "classic", gameKind: "categories" };
}

function availableQuestion(questions: RuntimeQuestionV32[], selection: MatchQuestionSelection, queueKey: string): RuntimeQuestionV32 {
  const unavailableIds = new Set([...selection.consumedQuestionIds, ...(selection.reservedQuestionIds ?? [])]);
  const unavailableConcepts = new Set([...selection.consumedAnswerConceptIds, ...(selection.reservedAnswerConceptIds ?? [])]);
  const byId = new Map(questions.map((question) => [question.id, question]));
  const question = (selection.queues[queueKey] ?? []).map((id) => byId.get(id)).find((candidate): candidate is RuntimeQuestionV32 => Boolean(candidate && !unavailableIds.has(candidate.id) && !unavailableConcepts.has(candidate.answerConceptId)));
  if (!question) throw new Error(`No unused question/concept reserve for ${queueKey}.`);
  return question;
}

/** Reserve a concrete replacement before mutating its board cell. */
export function reserveQuestionForCell(
  questions: RuntimeQuestionV32[], selection: MatchQuestionSelection, queueKey: string, cellId: string,
): { question: RuntimeQuestionV32; selection: MatchQuestionSelection } {
  if ((selection.reservedForCell ?? {})[cellId]) throw new Error(`Cell ${cellId} already has a reserved question.`);
  const question = availableQuestion(questions, selection, queueKey);
  return { question, selection: {
    ...selection,
    reservedQuestionIds: [...(selection.reservedQuestionIds ?? []), question.id],
    reservedAnswerConceptIds: [...(selection.reservedAnswerConceptIds ?? []), question.answerConceptId],
    reservedForCell: { ...(selection.reservedForCell ?? {}), [cellId]: question.id },
  } };
}

/** Promote a cell's reservation atomically when its question becomes visible. */
export function promoteReservedQuestion(
  questions: RuntimeQuestionV32[], selection: MatchQuestionSelection, cellId: string,
): { question: RuntimeQuestionV32; selection: MatchQuestionSelection } | undefined {
  const id = selection.reservedForCell?.[cellId];
  if (!id) return undefined;
  const question = questions.find((candidate) => candidate.id === id);
  if (!question) throw new Error("Reserved question is absent from the pinned release.");
  const reservedIds = (selection.reservedQuestionIds ?? []).filter((candidate) => candidate !== id);
  const reservedConcepts = (selection.reservedAnswerConceptIds ?? []).filter((candidate) => candidate !== question.answerConceptId);
  const reservedForCell = { ...(selection.reservedForCell ?? {}) };
  delete reservedForCell[cellId];
  return { question, selection: {
    ...selection,
    reservedQuestionIds: reservedIds,
    reservedAnswerConceptIds: reservedConcepts,
    reservedForCell,
    consumedQuestionIds: [...selection.consumedQuestionIds, question.id],
    consumedAnswerConceptIds: [...selection.consumedAnswerConceptIds, question.answerConceptId],
  } };
}

export function selectCategoryQuestion(
  questions: RuntimeQuestionV32[], selection: MatchQuestionSelection, categoryId: string,
): { question: RuntimeQuestionV32; selection: MatchQuestionSelection } {
  if (selection.gameKind !== "categories") throw new Error("Category selection policy is required.");
  const question = availableQuestion(questions, selection, categoryId);
  return { question, selection: { ...selection, consumedQuestionIds: [...selection.consumedQuestionIds, question.id], consumedAnswerConceptIds: [...selection.consumedAnswerConceptIds, question.answerConceptId] } };
}
export function selectMatchQuestion(
  questions: RuntimeQuestionV32[],
  selection: MatchQuestionSelection,
  letter: string,
): { question: RuntimeQuestionV32; selection: MatchQuestionSelection } {
  const consumedIds = new Set([...selection.consumedQuestionIds, ...(selection.reservedQuestionIds ?? [])]);
  const consumedConcepts = new Set([...selection.consumedAnswerConceptIds, ...(selection.reservedAnswerConceptIds ?? [])]);
  const byId = new Map(questions.map((question) => [question.id, question]));
  const queue = selection.queues[letter.trim()] ?? [];
  const question = queue
    .map((id) => byId.get(id))
    .find((candidate): candidate is RuntimeQuestionV32 =>
      Boolean(
        candidate &&
        !consumedIds.has(candidate.id) &&
        !consumedConcepts.has(candidate.answerConceptId),
      ),
    );
  if (!question)
    throw new Error(`No unused question/concept reserve for letter ${letter}.`);
  return {
    question,
    selection: {
      ...selection,
      consumedQuestionIds: [...selection.consumedQuestionIds, question.id],
      consumedAnswerConceptIds: [
        ...selection.consumedAnswerConceptIds,
        question.answerConceptId,
      ],
    },
  };
}
/** Charades are intentionally never placed in a letter queue.  The caller starts the separate charades lifecycle. */
const canonicalCompare = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;
export function selectCharadesQuestion(
  questions: RuntimeQuestionV32[],
  options: {
    categories: string[];
    cursor: number;
    consumedQuestionIds?: string[];
    consumedAnswerConceptIds?: string[];
  },
): RuntimeQuestionV32 {
  const categories = new Set(options.categories);
  if (!categories.size)
    throw new Error("Charades selection requires an explicit category scope.");
  const usedIds = new Set(options.consumedQuestionIds ?? []);
  const usedConcepts = new Set(options.consumedAnswerConceptIds ?? []);
  const candidates = questions
    .filter(
      (question) =>
        question.modality === "charades" &&
        categories.has(question.categoryId) &&
        !question.targetLetter &&
        !usedIds.has(question.id) &&
        !usedConcepts.has(question.answerConceptId),
    )
    .sort((left, right) => canonicalCompare(left.id, right.id));
  if (!candidates.length)
    throw new Error(
      "No unused approved charades question is available for the selected categories.",
    );
  return candidates[options.cursor % candidates.length];
}
