import assert from "node:assert/strict";
import test from "node:test";
import { generateCategoryBoard } from "../../src/features/game/domain/board.js";
import { createCategoryQuestionSelection, reserveQuestionForCell, selectCategoryQuestion, selectMatchQuestion } from "../../src/features/game/runtime/question-selector.js";

const categories = [
  { id: "tahadani-006", labelAr: "معلومات عامة" },
  { id: "tahadani-007", labelAr: "عالم الحيوان" },
];
const questions = Array.from({ length: 30 }, (_, index) => ({
  id: `q-${index}`,
  categoryId: categories[index % 2].id,
  modality: "classic" as const,
  answerConceptId: `concept-${index}`,
  headerAr: "عنوان",
  promptAr: "سؤال",
  canonicalAnswer: "إجابة",
  acceptedAnswers: ["إجابة"],
}));

test("category board preserves 25 coordinates and deterministic balanced labels", () => {
  const first = generateCategoryBoard(42, categories);
  const second = generateCategoryBoard(42, categories);
  assert.deepEqual(first, second);
  assert.equal(first.cells.length, 25);
  assert.deepEqual(first.cells.map((cell) => cell.id), Array.from({ length: 25 }, (_, index) => `cell-${index % 5}-${Math.floor(index / 5)}`));
  assert.ok(first.cells.every((cell) => cell.kind === "category" && cell.categoryLabelAr && cell.categoryOccurrence));
  const counts = Object.values(first.cells.reduce<Record<string, number>>((all, cell) => ({ ...all, [cell.categoryId!]: (all[cell.categoryId!] ?? 0) + 1 }), {}));
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
});

test("category selection consumes one fresh concept monotonically", () => {
  const initial = createCategoryQuestionSelection(questions, { categories: categories.map((category) => category.id), modality: "classic", seed: 7 });
  const first = selectCategoryQuestion(questions, initial, categories[0].id);
  const second = selectCategoryQuestion(questions, first.selection, categories[0].id);
  assert.notEqual(first.question.id, second.question.id);
  assert.notEqual(first.question.answerConceptId, second.question.answerConceptId);
  assert.deepEqual(initial.consumedQuestionIds, []);
});

test("category creation rejects a scope that cannot cover its allocated cells and replacement reserve", () => {
  assert.throws(() => createCategoryQuestionSelection(questions.slice(0, 26), { categories: categories.map((category) => category.id), modality: "classic", seed: 7 }), /allocation and replacement reserve/);
  const overlapping = categories.flatMap((category) => Array.from({ length: 14 }, (_, index) => ({ ...questions[index], categoryId: category.id, answerConceptId: `shared-${index}` })));
  assert.throws(() => createCategoryQuestionSelection(overlapping, { categories: categories.map((category) => category.id), modality: "classic", seed: 7 }), /overlapping concepts/);
});

test("shared-concept category queues retain a deterministic disjoint startup allocation", () => {
  const categoryA = categories[0].id; const categoryB = categories[1].id;
  const shared = Array.from({ length: 14 }, (_, index) => `shared-${index}`);
  const mixed = [
    ...Array.from({ length: 14 }, (_, index) => ({ ...questions[index], id: `a-unique-${index}`, categoryId: categoryA, answerConceptId: `a-unique-${index}` })),
    ...shared.map((concept, index) => ({ ...questions[index], id: `a-shared-${index}`, categoryId: categoryA, answerConceptId: concept })),
    ...shared.map((concept, index) => ({ ...questions[index], id: `b-shared-${index}`, categoryId: categoryB, answerConceptId: concept })),
  ];
  let selection = createCategoryQuestionSelection(mixed, { categories: categories.map((category) => category.id), modality: "classic", seed: 13 });
  for (let index = 0; index < 13; index += 1) selection = selectCategoryQuestion(mixed, selection, categoryA).selection;
  for (let index = 0; index < 12; index += 1) selection = selectCategoryQuestion(mixed, selection, categoryB).selection;
  assert.equal(selection.consumedAnswerConceptIds.length, 25);
  assert.doesNotThrow(() => selectCategoryQuestion(mixed, selection, categoryB));
});

test("ordinary letter selection cannot consume a reserved surprise replacement", () => {
  const letterQuestions = ["أ", "أ", "ب"].map((targetLetter, index) => ({ id: `letter-${index}`, categoryId: "tahadani-006", modality: "classic" as const, targetLetter, answerConceptId: `letter-concept-${index}`, headerAr: "عنوان", promptAr: "سؤال", canonicalAnswer: "إجابة", acceptedAnswers: ["إجابة"] }));
  const selection = { queues: { أ: ["letter-0", "letter-1"], ب: ["letter-2"] }, consumedQuestionIds: [], consumedAnswerConceptIds: [], seed: 2, categories: ["tahadani-006"], modality: "classic" as const };
  const reserved = reserveQuestionForCell(letterQuestions, selection, "أ", "cell-0-0");
  const next = selectMatchQuestion(letterQuestions, reserved.selection, "أ");
  assert.notEqual(next.question.id, reserved.question.id);
});
