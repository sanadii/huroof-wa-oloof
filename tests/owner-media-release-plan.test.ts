import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { buildOwnerMediaReleasePlan, parseSourceExport } from "../scripts/owner-media-release.js";

const original = resolve(process.cwd(), "..", "..", "..");
const sourceExport = resolve(original, "output/firebase-sync-20260911/package/documents.jsonl");
const sqlite = resolve(process.env.LOCALAPPDATA ?? "", "Temp/huroof-wa-oloof-local-game.sqlite");
const available = existsSync(sourceExport) && existsSync(sqlite);

async function input() {
  const [basePlan, sourceExportText, sqliteBytes, goalPackage, manifestHashes] = await Promise.all([
    readFile(resolve(original, "output/release-production-20260911/owner-approved-release-plan.json"), "utf8").then(JSON.parse),
    readFile(sourceExport, "utf8"),
    readFile(sqlite),
    readFile(resolve(original, "content/question-media/goal-quiz-2026/questions.json"), "utf8").then(JSON.parse),
    readFile(resolve(original, "output/media-live-20260911/media-manifest-hashes.json"), "utf8").then(JSON.parse),
  ]);
  const root = basePlan.documents.find((document: { path: string }) => document.path === "releases/" + basePlan.releaseId).data;
  const basePointer = { releaseId: root.releaseId, approvedCount: root.approvedCount, catalogSha256: root.catalogSha256, documentRootSha256: root.documentRootSha256, sourceManifestSha256: root.sourceManifestSha256, ownerApprovalPath: root.ownerApprovalPath, publicationAuthority: "owner_approval" };
  return { basePlan, basePointer, sqliteBytes, sourceExportText, sourceRecords: parseSourceExport(sourceExportText), goalPackage, mediaRoot: original, manifestHashes, capturedAt: "2026-09-12T00:00:00.000Z" };
}

test("real owner media authority yields the exact successor arithmetic and selectors", { skip: !available }, async () => {
  const plan = await buildOwnerMediaReleasePlan(await input());
  assert.equal(plan.approvedCount, 10838);
  assert.equal(plan.superseded.length, 238);
  assert.equal(plan.media.assetCount, 489);
  assert.equal(plan.readiness.categories["tahadani-011"]?.image, 111);
  assert.equal(plan.readiness.categories["goals-2026"]?.video, 99);
  assert.equal(plan.readiness.categories["goals-2026"]?.categories.playable, true);
  assert.equal(plan.readiness.categories["goals-2026"]?.huroof.playable, false);
  assert.equal(plan.exclusions.image_Image_source_does_not_have_one_exact_manifest_media_binding_, 9);
});
test("role swaps and malformed exact pairs fail closed", { skip: !available }, async () => {
  const value = await input();
  const swapped = structuredClone(value);
  swapped.goalPackage.questions[0].media.answerMediaId = swapped.goalPackage.questions[0].media.promptMediaId;
  await assert.rejects(buildOwnerMediaReleasePlan(swapped), /blur\/clean asset pair/i);
  const malformed = structuredClone(value);
  const first = malformed.sourceRecords.find((item: { raw: { id?: string } }) => item.raw.id === "v18-tahadani-011-001");
  assert.ok(first);
  first.raw._mediaReferences = [];
  await assert.rejects(buildOwnerMediaReleasePlan(malformed), /291 valid one-to-one/i);
});
test("literal-answer, replacement-set, and inherited-base tampering fail closed", { skip: !available }, async () => {
  const answerTamper = await input();
  const source = answerTamper.sourceRecords.find((item) => item.raw.id === "v18-tahadani-011-001");
  assert.ok(source);
  source.raw.acceptedAnswers = ["not-the-source-answer"];
  await assert.rejects(buildOwnerMediaReleasePlan(answerTamper), /291 valid one-to-one/i);

  const replacementTamper = await input();
  const index = replacementTamper.basePlan.documents.findIndex((document: { path: string; data: { categoryId?: string } }) => document.path.includes("/questions/") && document.data.categoryId === "tahadani-011");
  assert.ok(index >= 0);
  replacementTamper.basePlan.documents.splice(index, 1);
  await assert.rejects(buildOwnerMediaReleasePlan(replacementTamper), /text base|238/i);

  const inheritedTamper = await input();
  const inherited = inheritedTamper.basePlan.documents.find((document: { path: string; data: { categoryId?: string } }) => document.path.includes("/questions/") && document.data.categoryId === "huroof-068");
  assert.ok(inherited);
  inherited.data.promptAr = "tampered inherited base";
  await assert.rejects(buildOwnerMediaReleasePlan(inheritedTamper), /active immutable text base/i);
});
