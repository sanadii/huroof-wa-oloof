/**
 * Release-scoped map variant boundary.
 *
 * The historical map question is a predecessor and must remain byte-for-byte
 * usable in ordinary play.  Interactive play receives a new safe effective
 * question assembled from a pinned sidecar and private definition instead of
 * inheriting legacy prompt, answer, or media fields.
 */
import type { CanonicalChallengeDefinition } from "../challenges/definition.js";
import type { ChallengeDefinitionReference } from "../challenges/integration.js";

export type MapPresentation = "ordinary" | "interactive";
export type MapVariantDisposition = "reviewed" | "held";
export type MapSelectionFacts = { kind: "qatar_map"; factFamilies: readonly string[] };

export type MapVariantBinding = {
  schemaVersion: "t36-map-variant-v1";
  runtimeQuestionId: string;
  /** Full immutable predecessor identity, verified by publisher/transport. */
  predecessorQuestionCanonicalSha256: string;
  /** Exact Firestore runtime select shape, verified by both runtimes. */
  runtimeProjectionSchema: "t36-runtime-question-projection-v1";
  runtimeProjectionSha256: string;
  m1SourceId: string;
  m1SourceRawSha256: string;
  m1SourceContextsSha256: string;
  reconciliationSha256: string;
  definition: ChallengeDefinitionReference;
  mechanic: "qatar_map";
  factFamilies: readonly string[];
  disposition: MapVariantDisposition;
  geographicOverlaySha256: string;
};

export type MapVariantQuestion = {
  id: string;
  categoryId?: string;
  headerAr: string;
  promptAr: string;
  canonicalAnswer: string;
  acceptedAnswers: string[];
  answerConceptId?: string;
  modality?: string;
  media?: unknown;
  answerMedia?: unknown;
  sources?: unknown;
  review?: unknown;
  moderation?: unknown;
  challenge?: unknown;
  selectionFacts?: MapSelectionFacts;
};

const sha = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/iu.test(value);
const sameSorted = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);

export function assertMapVariantBinding(
  binding: MapVariantBinding,
  question: Pick<MapVariantQuestion, "id">,
  runtimeProjectionSha256: string,
  definition: CanonicalChallengeDefinition,
): void {
  if (
    binding.schemaVersion !== "t36-map-variant-v1" ||
    binding.runtimeQuestionId !== question.id ||
    !sha(binding.predecessorQuestionCanonicalSha256) ||
    binding.runtimeProjectionSchema !== "t36-runtime-question-projection-v1" ||
    !sha(binding.runtimeProjectionSha256) ||
    binding.runtimeProjectionSha256 !== runtimeProjectionSha256 ||
    !binding.m1SourceId || !sha(binding.m1SourceRawSha256) || !sha(binding.m1SourceContextsSha256) || !sha(binding.reconciliationSha256) || !sha(binding.geographicOverlaySha256) ||
    binding.mechanic !== "qatar_map" || definition.kind !== "qatar_map" ||
    !sha(binding.definition.manifestSha256) ||
    binding.definition.id !== definition.id ||
    binding.definition.schemaVersion !== definition.schemaVersion ||
    binding.definition.definitionSha256 !== definition.definitionSha256 ||
    (binding.disposition !== "reviewed" && binding.disposition !== "held") ||
    (binding.disposition === "reviewed" && definition.disposition !== "ready") ||
    (binding.disposition === "held" && definition.disposition !== "held") ||
    binding.m1SourceId !== definition.source.sourceId ||
    binding.m1SourceRawSha256 !== definition.source.sourceRawSha256 ||
    binding.m1SourceContextsSha256 !== definition.source.sourceContextsSha256 ||
    !sameSorted(binding.factFamilies, definition.factFamilies)
  ) throw new Error("MAP_VARIANT_BINDING_INVALID");
}

/**
 * A variant cannot be produced by spreading the historical question.  The
 * allowlist below intentionally leaves out all generic question/media fields
 * which can disclose an answer or source image.
 */
export function interactiveMapQuestion(
  question: MapVariantQuestion,
  binding: MapVariantBinding,
  definition: Extract<CanonicalChallengeDefinition, { kind: "qatar_map" }>,
): MapVariantQuestion {
  return {
    id: question.id,
    categoryId: question.categoryId,
    modality: "classic",
    headerAr: "لوكيشن قطر",
    promptAr: definition.publicData.promptAr,
    // Selector identity only. Challenge grading never reads these values.
    canonicalAnswer: `map:${binding.factFamilies.slice().sort().join("+")}`,
    acceptedAnswers: [`map:${binding.factFamilies.slice().sort().join("+")}`],
    answerConceptId: `map:${binding.factFamilies.slice().sort().join("+")}`,
    challenge: {
      definition: binding.definition,
      factFamilies: [...binding.factFamilies].sort(),
      kind: "qatar_map",
    },
  };
}

/**
 * All selection/admission callers use this once per scoped release read.
 * Duplicated variant keys and missing bindings fail closed; a held sidecar is
 * valid metadata but never creates an interactive candidate.
 */
export function materializeMapPresentation<T extends MapVariantQuestion>(
  questions: readonly T[],
  presentation: MapPresentation,
  bindings: readonly MapVariantBinding[],
  runtimeProjectionHash: (question: T) => string,
  definitionFor: (binding: MapVariantBinding) => CanonicalChallengeDefinition,
): T[] {
  const byQuestion = new Map<string, MapVariantBinding>();
  for (const binding of bindings) {
    if (byQuestion.has(binding.runtimeQuestionId)) throw new Error("MAP_VARIANT_BINDING_DUPLICATE");
    byQuestion.set(binding.runtimeQuestionId, binding);
  }
  const mapQuestionIds = new Set(questions.filter((question) => question.categoryId === "tahadani-games-326").map((question) => question.id));
  if (mapQuestionIds.size !== byQuestion.size || [...byQuestion.keys()].some((id) => !mapQuestionIds.has(id)))
    throw new Error("MAP_VARIANT_BINDING_EXTRA_OR_MISSING");
  const output = questions.flatMap((question) => {
    const binding = byQuestion.get(question.id);
    if (!binding) {
      // The accepted release binding proves this category has exactly 300
      // predecessor maps.  A missing sidecar is corruption, never a fallback.
      if (question.categoryId === "tahadani-games-326") throw new Error("MAP_SELECTION_BINDING_MISSING");
      return [question];
    }
    const definition = definitionFor(binding);
    if (presentation === "interactive") {
      // Every sidecar is identity-validated before held cards are filtered.
      // A held record is evidence, never a legacy fallback.
      assertMapVariantBinding(binding, question, runtimeProjectionHash(question), definition);
      if (binding.disposition === "held") return [];
      return [interactiveMapQuestion(question, binding, definition as Extract<CanonicalChallengeDefinition, { kind: "qatar_map" }>) as T];
    }
    // Ordinary maps consume the independently pinned semantic family in
    // challenge-enabled mixed matches while retaining ordinary delivery.
    if (!sha(binding.predecessorQuestionCanonicalSha256) || binding.runtimeProjectionSchema !== "t36-runtime-question-projection-v1" || !sha(binding.runtimeProjectionSha256) || binding.runtimeProjectionSha256 !== runtimeProjectionHash(question) || binding.runtimeQuestionId !== question.id || binding.m1SourceId !== definition.source.sourceId || binding.m1SourceRawSha256 !== definition.source.sourceRawSha256 || binding.m1SourceContextsSha256 !== definition.source.sourceContextsSha256 || !sha(binding.reconciliationSha256) || !sameSorted(binding.factFamilies, definition.factFamilies))
      throw new Error("MAP_SELECTION_BINDING_INVALID");
    return [{ ...question, selectionFacts: { kind: "qatar_map", factFamilies: [...binding.factFamilies].sort() } }];
  });
  if (new Set(output.map((question) => question.id)).size !== output.length)
    throw new Error("MAP_EFFECTIVE_QUESTION_DUPLICATE");
  return output;
}
