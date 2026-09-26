/**
 * The category picker classifies only the stimulus delivered with a question.
 * Answer media and category artwork deliberately do not participate.
 */
export const QUESTION_TYPE_KEYS = ["text", "image", "video", "audio", "interactive", "other"] as const;
export type QuestionTypeKey = (typeof QUESTION_TYPE_KEYS)[number];
export type QuestionTypeCounts = Record<QuestionTypeKey, number>;

export const QUESTION_TYPE_CLASSIFIER_VERSION = "t40-question-side-v1" as const;

export const emptyQuestionTypeCounts = (): QuestionTypeCounts => ({
  text: 0,
  image: 0,
  video: 0,
  audio: 0,
  interactive: 0,
  other: 0,
});

export function isQuestionTypeCounts(value: unknown): value is QuestionTypeCounts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === QUESTION_TYPE_KEYS.length &&
    QUESTION_TYPE_KEYS.every((key) => Number.isSafeInteger(record[key]) && (record[key] as number) >= 0);
}

type QuestionSideMedia = { type?: unknown };
type QuestionSideRecord = {
  modality?: unknown;
  media?: QuestionSideMedia | null;
  /** A present challenge definition is a question-side interactive stimulus. */
  challenge?: unknown;
};

/**
 * Throws for records that claim an unsupported prompt modality. This makes an
 * index fail closed during publication instead of silently filing new content
 * under an inaccurate filter.
 */
export function classifyQuestionSideType(question: QuestionSideRecord): QuestionTypeKey {
  if (question.challenge && typeof question.challenge === "object") return "interactive";
  const modality = question.modality === undefined ? "classic" : question.modality;
  if (modality !== "classic" && modality !== "image" && modality !== "video" && modality !== "charades")
    throw new Error("QUESTION_TYPE_UNSUPPORTED_MODALITY");
  const media = question.media;
  if (media !== undefined && media !== null && (typeof media !== "object" || Array.isArray(media)))
    throw new Error("QUESTION_TYPE_INVALID_PROMPT_MEDIA");
  if (media !== undefined && media !== null) {
    const mediaType = media.type;
    if (mediaType !== undefined && mediaType !== "image" && mediaType !== "video")
      throw new Error("QUESTION_TYPE_UNSUPPORTED_PROMPT_MEDIA");
    // Legacy bindings may omit type only when their immutable modality already
    // identifies the stimulus. A classic row with an untyped prompt asset is
    // ambiguous and cannot be indexed safely.
    if (mediaType === undefined) {
      if (modality === "image" || modality === "video") return modality;
      throw new Error("QUESTION_TYPE_UNTYPED_PROMPT_MEDIA");
    }
    if ((modality === "image" || modality === "video") && modality !== mediaType)
      throw new Error("QUESTION_TYPE_CONFLICTING_PROMPT_MEDIA");
    return mediaType;
  }
  if (modality === "image" || modality === "video") return modality;
  return modality === "charades" ? "other" : "text";
}

export function addQuestionTypeCount(counts: QuestionTypeCounts, type: QuestionTypeKey): QuestionTypeCounts {
  return { ...counts, [type]: counts[type] + 1 };
}
