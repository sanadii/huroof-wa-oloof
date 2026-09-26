import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { approvedReleaseCatalogProjection } from "../functions/src/index.js";
import type { FirestoreReleasePlan } from "../scripts/build-firestore-release.js";
import {
  buildQuestionTypeReleaseIndex,
  isQuestionTypeReleaseIndex,
  publishQuestionTypeReleaseIndex,
  questionTypeIndexDocument,
} from "../scripts/question-type-release-index.js";
import { classifyQuestionSideType } from "../src/features/game/runtime/question-type-counts.js";
import { canonicalJson } from "../scripts/firestore-release-canonical.js";

const releaseId = "release-question-type-fixture";
const rootSha = "a".repeat(64);
const category = (id: string, labelAr: string) => ({
  path: `releases/${releaseId}/catalogCategories/${id}`,
  data: { id, labelAr, runtimeReadiness: { huroof: false, categories: true, charades: false } },
});
const question = (id: string, categoryId: string, data: Record<string, unknown>) => ({
  path: `releases/${releaseId}/questions/${id}`,
  data: { id, categoryId, modality: "classic", ...data },
});
const fixturePlan = (firstCategoryId = "cat-a", secondCategoryId = "cat-b"): FirestoreReleasePlan => {
  const documents = [
    category(firstCategoryId, "أ"),
    category(secondCategoryId, "ب"),
    question("text", firstCategoryId, {}),
    question("answer-media-only", firstCategoryId, { answerMedia: { type: "video" } }),
    question("image", firstCategoryId, { media: { type: "image" } }),
    question("video", secondCategoryId, { modality: "video", media: { type: "video" } }),
    question("interactive", secondCategoryId, { challenge: { kind: "memory" } }),
    question("other", secondCategoryId, { modality: "charades" }),
    { path: `releases/${releaseId}/inventory/${firstCategoryId}`, data: { categoryId: firstCategoryId, approvedCount: 3 } },
    { path: `releases/${releaseId}/inventory/${secondCategoryId}`, data: { categoryId: secondCategoryId, approvedCount: 3 } },
    { path: `releases/${releaseId}`, data: { releaseId, immutable: true, approvedCount: 6, categoryCount: 2, documentRootSha256: rootSha } },
  ];
  return { releaseId, approvedCount: 6, approvedJsonlSha256: "b".repeat(64), catalogSha256: "c".repeat(64), documentRootSha256: rootSha, sourceManifestSha256: "d".repeat(64), asOf: "2026-09-24", documents };
};

test("question-side classifier ignores answer-only media and rejects unsupported prompt media", () => {
  assert.equal(classifyQuestionSideType({ modality: "classic", answerMedia: { type: "video" } } as never), "text");
  assert.equal(classifyQuestionSideType({ modality: "classic", media: { type: "image" } }), "image");
  assert.equal(classifyQuestionSideType({ modality: "classic", challenge: { kind: "memory" } }), "interactive");
  assert.throws(() => classifyQuestionSideType({ modality: "audio" }), /UNSUPPORTED_MODALITY/);
  assert.throws(() => classifyQuestionSideType({ modality: "classic", media: { type: "audio" } }), /UNSUPPORTED_PROMPT_MEDIA/);
});

test("mixed-case category identifiers use the same order for building and validating", () => {
  const index = buildQuestionTypeReleaseIndex(fixturePlan("A", "a"));
  assert.deepEqual(index.categories.map((item) => item.id), ["A", "a"]);
  assert.equal(isQuestionTypeReleaseIndex(index), true);
});

test("release index is deterministic, complete, release-bound, and contains no question payload", () => {
  const plan = fixturePlan();
  const index = buildQuestionTypeReleaseIndex(plan);
  const shuffled = { ...plan, documents: plan.documents.slice().reverse() };
  assert.deepEqual(buildQuestionTypeReleaseIndex(shuffled), index);
  assert.ok(isQuestionTypeReleaseIndex(index));
  assert.equal(index.releaseId, releaseId);
  assert.equal(index.releaseRootSha256, rootSha);
  assert.deepEqual(index.categories, [
    { id: "cat-a", questionTypeCounts: { text: 2, image: 1, video: 0, audio: 0, interactive: 0, other: 0 } },
    { id: "cat-b", questionTypeCounts: { text: 0, image: 0, video: 1, audio: 0, interactive: 1, other: 1 } },
  ]);
  assert.ok(!JSON.stringify(index).includes("answer-media-only"));
  const altered = structuredClone(index);
  altered.categories[0]!.questionTypeCounts.text = 3;
  assert.equal(isQuestionTypeReleaseIndex(altered), false);
  const unsorted = structuredClone(index);
  unsorted.categories.reverse();
  assert.equal(isQuestionTypeReleaseIndex(unsorted), false);
  const extraTopLevel = { ...index, answer: "private data" };
  assert.equal(isQuestionTypeReleaseIndex(extraTopLevel), false);
  assert.throws(() => questionTypeIndexDocument(extraTopLevel), /QUESTION_TYPE_INDEX_INVALID/);
  const extraCategory = structuredClone(index);
  Object.assign(extraCategory.categories[0]!, { answer: "private data" });
  const payload: Partial<typeof extraCategory> = { ...extraCategory };
  delete payload.indexSha256;
  delete payload.immutable;
  extraCategory.indexSha256 = createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
  assert.equal(isQuestionTypeReleaseIndex(extraCategory), false);
  assert.throws(() => questionTypeIndexDocument(extraCategory), /QUESTION_TYPE_INDEX_INVALID/);
});

test("sidecar publication is create-only, idempotent, and read back exactly", async () => {
  const stored = new Map<string, Record<string, unknown>>();
  const adapter = {
    read: async (paths: string[]) => paths.map((path) => ({ path, exists: stored.has(path), data: stored.get(path) })),
    create: async (documents: Array<{ path: string; data: Record<string, unknown> }>) => {
      for (const document of documents) {
        if (stored.has(document.path)) throw new Error("already exists");
        stored.set(document.path, structuredClone(document.data));
      }
    },
    createQuestionTypeIndexIfActiveReleaseMatches: async (document: { path: string; data: Record<string, unknown> }) => {
      if (stored.has(document.path)) return false;
      stored.set(document.path, structuredClone(document.data));
      return true;
    },
  };
  const index = buildQuestionTypeReleaseIndex(fixturePlan());
  assert.equal((await publishQuestionTypeReleaseIndex(index, adapter)).created, true);
  assert.equal((await publishQuestionTypeReleaseIndex(index, adapter)).created, false);
  const document = questionTypeIndexDocument(index);
  stored.set(document.path, { ...document.data, indexSha256: "0".repeat(64) });
  await assert.rejects(publishQuestionTypeReleaseIndex(index, adapter), /READBACK_MISMATCH/);
});

test("catalog projection exposes only an exact matching sidecar and preserves legacy catalog behavior", () => {
  const plan = fixturePlan();
  const index = buildQuestionTypeReleaseIndex(plan);
  const root = plan.documents.find((document) => document.path === `releases/${releaseId}`)!.data;
  const rows = plan.documents.filter((document) => document.path.includes("/catalogCategories/")).map((document) => ({ id: String(document.data.id), data: document.data }));
  const matching = approvedReleaseCatalogProjection({ releaseId }, root, rows, [], { allowDemoFixture: true, questionTypeIndex: index });
  assert.equal(matching.categories[0]!.questionTypeCounts?.image, 1);
  const stale = structuredClone(index);
  stale.releaseRootSha256 = "e".repeat(64);
  const legacy = approvedReleaseCatalogProjection({ releaseId }, root, rows, [], { allowDemoFixture: true, questionTypeIndex: stale });
  assert.equal(legacy.categories[0]!.questionTypeCounts, undefined);
});
