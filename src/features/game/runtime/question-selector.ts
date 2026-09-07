export type RuntimeQuestionV32 = {
  id: string;
  categoryId: string;
  modality: "classic" | "image" | "charades";
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
export function selectMatchQuestion(
  questions: RuntimeQuestionV32[],
  selection: MatchQuestionSelection,
  letter: string,
): { question: RuntimeQuestionV32; selection: MatchQuestionSelection } {
  const consumedIds = new Set(selection.consumedQuestionIds);
  const consumedConcepts = new Set(selection.consumedAnswerConceptIds);
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
