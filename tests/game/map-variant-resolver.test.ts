import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canonicalChallengeJson } from "../../src/features/game/challenges/integration.js";
import { materializeMapPresentation, type MapVariantBinding, type MapVariantQuestion } from "../../src/features/game/runtime/map-variant-resolver.js";

const sha = (value: unknown) => createHash("sha256").update(canonicalChallengeJson(value)).digest("hex");
const definition = {
  schemaVersion: "t36-challenge-definition-v1", id: "m1-map-1", kind: "qatar_map", categoryId: "tahadani-games-326", ordinal: 1, disposition: "ready",
  definitionSha256: "d".repeat(64), factFamilies: ["place:l1"],
  source: { sourceId: "pack-326-1", sourceRawSha256: "e".repeat(64), sourceContextsSha256: "f".repeat(64) },
  publicData: { mode: "identify", timeLimitSeconds: 30, markers: [], optionIds: [], promptAr: "حدد الموقع" },
} as never;
const question: MapVariantQuestion = {
  id: "legacy-map-1", categoryId: "tahadani-games-326", modality: "image", headerAr: "لوكيشن قطر", promptAr: "A = answer", canonicalAnswer: "A", acceptedAnswers: ["A"], answerConceptId: "legacy", media: { mediaId: "unsafe-source" },
};
const binding: MapVariantBinding = {
  schemaVersion: "t36-map-variant-v1", runtimeQuestionId: question.id,
  predecessorQuestionCanonicalSha256: sha(question), runtimeProjectionSchema: "t36-runtime-question-projection-v1", runtimeProjectionSha256: sha(question), m1SourceId: "pack-326-1",
  m1SourceRawSha256: "e".repeat(64), m1SourceContextsSha256: "f".repeat(64), reconciliationSha256: "c".repeat(64),
  definition: { manifestSha256: "a".repeat(64), id: "m1-map-1", schemaVersion: "t36-challenge-definition-v1", definitionSha256: "d".repeat(64) },
  mechanic: "qatar_map", factFamilies: ["place:l1"], disposition: "reviewed", geographicOverlaySha256: "b".repeat(64),
};

test("ordinary map keeps the predecessor fields while adding only selection facts", () => {
  const [ordinary] = materializeMapPresentation([question], "ordinary", [binding], sha, () => definition);
  assert.equal((ordinary.media as { mediaId?: string } | undefined)?.mediaId, "unsafe-source");
  assert.deepEqual(ordinary.selectionFacts, { kind: "qatar_map", factFamilies: ["place:l1"] });
  assert.equal(ordinary.challenge, undefined);
});

test("interactive map is a safe allowlist, excludes held variants, and rejects corruption", () => {
  const [interactive] = materializeMapPresentation([question], "interactive", [binding], sha, () => definition);
  assert.equal(interactive.media, undefined);
  assert.equal(interactive.promptAr, "حدد الموقع");
  assert.equal((interactive.challenge as { kind: string }).kind, "qatar_map");
  assert.deepEqual(materializeMapPresentation([question], "interactive", [{ ...binding, disposition: "held" }], sha, () => ({ ...(definition as Record<string, unknown>), disposition: "held" } as never)), []);
  assert.throws(() => materializeMapPresentation([question], "interactive", [{ ...binding, disposition: "held", m1SourceRawSha256: "0".repeat(64) }], sha, () => ({ ...(definition as Record<string, unknown>), disposition: "held" } as never)), /MAP_VARIANT_BINDING_INVALID/);
  assert.throws(() => materializeMapPresentation([question], "interactive", [{ ...binding, runtimeProjectionSha256: "c".repeat(64) }], sha, () => definition), /MAP_VARIANT_BINDING_INVALID/);
});

test("ordinary selection verifies the exact predecessor hash and complete sidecar set", () => {
  assert.throws(() => materializeMapPresentation([question], "ordinary", [], sha, () => definition), /MAP_VARIANT_BINDING_EXTRA_OR_MISSING/);
  assert.throws(() => materializeMapPresentation([question], "ordinary", [{ ...binding, runtimeProjectionSha256: "0".repeat(64) }], sha, () => definition), /MAP_SELECTION_BINDING_INVALID/);
  assert.throws(() => materializeMapPresentation([question], "ordinary", [binding, { ...binding, runtimeQuestionId: "unexpected-map" }], sha, () => definition), /MAP_VARIANT_BINDING_EXTRA_OR_MISSING/);
  assert.throws(() => materializeMapPresentation([question, { ...question, id: question.id }], "ordinary", [binding], sha, () => definition), /MAP_EFFECTIVE_QUESTION_DUPLICATE/);
});
