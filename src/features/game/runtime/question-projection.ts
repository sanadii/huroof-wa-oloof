/** Immutable runtime question projection shared by publication and Firebase reads. */
export const RUNTIME_QUESTION_FIELD_NAMES = [
  "id", "categoryId", "modality", "targetLetter", "answerConceptId",
  "headerAr", "promptAr", "canonicalAnswer", "acceptedAnswers", "media",
  "answerMedia", "sources", "review", "moderation", "challenge",
] as const;
export const RUNTIME_QUESTION_PROJECTION_SCHEMA = "t36-runtime-question-projection-v1" as const;
export type RuntimeQuestionProjection = Record<(typeof RUNTIME_QUESTION_FIELD_NAMES)[number], unknown>;
/** Copies exactly the Firestore select shape; omitted optional fields remain omitted. */
export function runtimeQuestionProjection(value: Record<string, unknown>): RuntimeQuestionProjection {
  return Object.fromEntries(RUNTIME_QUESTION_FIELD_NAMES.flatMap((key) => value[key] === undefined ? [] : [[key, value[key]]])) as RuntimeQuestionProjection;
}
