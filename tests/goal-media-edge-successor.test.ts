import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { SourceDocument } from "../scripts/owner-approved-release.js";
import { applyGoalMediaEdgeSuccessor, buildGoalMediaEdgeSuccessorPlan, capturedBaseFromPublicCapture, captureActiveGoalMediaBase, createProductionGoalMediaEdgeSuccessorApi, rollbackGoalMediaEdgeSuccessor, type CapturedActiveRelease, type GoalMediaEdgeSuccessorApi, type ReleaseDocument } from "../scripts/goal-media-edge-successor.js";
import type { ImmutableMediaReadback, PrivateMediaUpload, PrivateMediaUploadPlan } from "../scripts/question-media-release-prep.js";
import { canonicalJson } from "../scripts/firestore-release-canonical.js";

const hash = (number: number) => number.toString(16).padStart(64, "0");
const encode = (value: unknown): Record<string, unknown> => {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, encode(item)])) } };
};
const fields = (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)]));
const documentHash = (documents: ReleaseDocument[]) => createHash("sha256").update(canonicalJson(documents.slice().sort((left, right) => left.path.localeCompare(right.path)).map(({ path, data, fields }) => ({ path, ...(fields ? { fields } : { data }) })))).digest("hex");
const source = (path: string, data: Record<string, unknown>): SourceDocument => ({ name: `projects/huroof-a3ee7/databases/(default)/documents/${path}`, updateTime: "2026-09-17T00:00:00.000000Z", fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)])) } as SourceDocument);

function fixture() {
  const baseReleaseId = "owner-category-reconciliation-0123456789abcdef0123456789abcdef";
  const pointer = { releaseId: baseReleaseId, approvedCount: 1000, catalogSha256: hash(1), documentRootSha256: hash(2), sourceManifestSha256: hash(3), ownerApprovalPath: "contentOwnerApprovals/retained", publicationAuthority: "owner_category_reconciliation" };
  const rootData = { ...pointer, immutable: true, releaseId: baseReleaseId };
  const root: ReleaseDocument = { path: `releases/${baseReleaseId}`, data: rootData, fields: fields(rootData) };
  const children: ReleaseDocument[] = [{ path: `releases/${baseReleaseId}/catalogCategories/goals-2026`, data: { id: "goals-2026", labelAr: "من سجل الهدف؟", immutable: true } }, { path: `releases/${baseReleaseId}/questions/classic-preserved`, data: { id: "classic-preserved", categoryId: "classic", modality: "classic", promptAr: "محفوظ", canonicalAnswer: "محفوظ", immutable: true } }];
  const manifestQuestions: unknown[] = [], uploads: PrivateMediaUpload[] = [];
  for (let index = 1; index <= 99; index++) {
    const goal = String(index).padStart(3, "0"), promptMediaId = `goal-quiz-2026:${goal}:blur`, answerMediaId = `goal-quiz-2026:${goal}:clean`, oldPrompt = hash(index), oldAnswer = hash(index + 100), newPrompt = hash(index + 200), newAnswer = hash(index + 300);
    children.push({ path: `releases/${baseReleaseId}/questions/goal-${goal}`, data: { id: `goal-${goal}`, categoryId: "goals-2026", modality: "video", canonicalAnswer: `answer-${goal}`, acceptedAnswers: [`answer-${goal}`], immutable: true, retainedAuthority: { ownerApprovalPath: "contentOwnerApprovals/retained" }, media: { mediaId: promptMediaId, assetSha256: oldPrompt, altAr: "مقطع السؤال", type: "video", contentType: "video/mp4" }, answerMedia: { mediaId: answerMediaId, assetSha256: oldAnswer, altAr: "مقطع الإجابة", type: "video", contentType: "video/mp4" } } });
    for (const [mediaId, assetSha256] of [[promptMediaId, oldPrompt], [answerMediaId, oldAnswer]] as const) children.push({ path: `releases/${baseReleaseId}/media/${mediaId}`, data: { mediaId, assetSha256, objectName: `question-media/goal-quiz-2026/assets/${assetSha256}.mp4`, generation: "4", contentType: "video/mp4", byteSize: 20, width: 854, height: 374, durationSeconds: 2.1, immutable: true, retainedMediaAuthority: "unchanged" } });
    for (const [mediaId, assetSha256] of [[promptMediaId, newPrompt], [answerMediaId, newAnswer]] as const) uploads.push({ mediaId, assetSha256, contentType: "video/mp4", byteSize: 20, width: 854, height: 374, durationSeconds: 2.1, localFile: `assets/${assetSha256}.mp4`, objectName: `question-media/goal-quiz-2026/assets/${assetSha256}.mp4`, createOnly: true, metadata: { mediaId, assetSha256, contentType: "video/mp4", byteSize: "20", width: "854", height: "374", durationSeconds: "2.1" } });
    manifestQuestions.push({ canonicalAnswer: `answer-${goal}`, acceptedAnswers: [`answer-${goal}`], media: { promptMediaId, promptSha256: newPrompt, answerMediaId, answerSha256: newAnswer } });
  }
  const base: CapturedActiveRelease = { capturedAt: "2026-09-17T00:00:00.000Z", pointer, pointerFields: fields(pointer), root, children: children.map((document) => ({ ...document, fields: fields(document.data) })) };
  const plan = buildGoalMediaEdgeSuccessorPlan({ base, uploads: { dryRun: true, assetCount: 198, packageCounts: { v18: 0, rebuild: 0, goals: 198 }, manifestSha256: hash(900), uploads } as PrivateMediaUploadPlan, questionManifest: { questions: manifestQuestions }, questionManifestSha256: hash(901) });
  return { base, plan };
}

function memoryApi(base: CapturedActiveRelease, options: { stale?: boolean; tamper?: boolean } = {}) {
  const docs = new Map<string, Record<string, unknown>>([["runtime/activeRelease", options.stale ? { ...base.pointer, releaseId: "other-release-0123456789abcdef" } : base.pointer], [base.root.path, base.root.data], ...base.children.map((item) => [item.path, item.data] as const)]);
  const created: string[] = [], objects = new Map<string, ImmutableMediaReadback>(), createdFields = new Map<string, Record<string, unknown> | undefined>();
  let activatedPointerFields: Record<string, unknown> | undefined;
  const api: GoalMediaEdgeSuccessorApi = {
    metadata: async () => ({ projectId: "huroof-a3ee7", databaseId: "(default)", locationId: "me-central2", type: "FIRESTORE_NATIVE" }),
    read: async (paths) => paths.map((path) => docs.has(path) ? source(path, docs.get(path)!) : undefined),
    listCollectionIds: async (parent) => [...new Set([...docs.keys()].filter((path) => path.startsWith(`${parent}/`)).map((path) => path.slice(parent.length + 1).split("/")[0]!).filter(Boolean))],
    listCollection: async (collection) => [...docs.entries()].filter(([path]) => path.startsWith(`${collection}/`) && path.slice(collection.length + 1).split("/").length === 1).map(([path, data]) => source(path, data)),
    ensureObject: async (upload) => { const value: ImmutableMediaReadback = { ...upload, assetSha256: options.tamper && upload.mediaId.endsWith(":blur") ? hash(999) : upload.assetSha256, generation: "7" }; objects.set(upload.mediaId, value); return value; },
    readObject: async (upload) => objects.get(upload.mediaId) ?? { ...upload, generation: "7" },
    create: async (items) => { for (const item of items) { const old = docs.get(item.path); if (old && JSON.stringify(old) !== JSON.stringify(item.data)) throw new Error("conflict"); if (!old) { docs.set(item.path, item.data); created.push(item.path); createdFields.set(item.path, item.fields); } } },
    activate: async (plan, receipt) => { const active = docs.get("runtime/activeRelease"); if (JSON.stringify(active) !== JSON.stringify(plan.base.pointer) && JSON.stringify(active) !== JSON.stringify(plan.pointer)) throw new Error("stale"); if (!docs.has(`activationReceipts/${plan.releaseId}-goal-media-edge`)) docs.set(`activationReceipts/${plan.releaseId}-goal-media-edge`, { releaseId: plan.releaseId, baseReleaseId: plan.base.root.data.releaseId, activePointer: plan.pointer, immutable: true }); docs.set("runtime/activeRelease", plan.pointer); activatedPointerFields = plan.pointerFields; assert.ok(docs.has(receipt.path)); },
    rollback: async (plan, receipt) => { assert.deepEqual(docs.get("runtime/activeRelease"), plan.pointer); assert.ok(!docs.has(receipt.path)); docs.set("runtime/activeRelease", plan.base.pointer); docs.set(receipt.path, receipt.data); },
  };
  return { api, docs, created, createdFields, getActivatedPointerFields: () => activatedPointerFields, objects };
}

test("prepared runner converts the root capture pointer document without changing REST fields", () => {
  const { base } = fixture();
  const converted = capturedBaseFromPublicCapture({
    capturedAt: base.capturedAt,
    pointer: { path: "runtime/activeRelease", data: base.pointer, fields: base.pointerFields },
    root: base.root,
    children: base.children,
  });
  assert.deepEqual(converted, base);
});

test("successor preserves every captured child except 99 bindings and 198 media records", async () => {
  const { base, plan } = fixture(), memory = memoryApi(base);
  await applyGoalMediaEdgeSuccessor(plan, memory.api, async () => plan);
  const successorChildren = [...memory.docs.entries()].filter(([path]) => path.startsWith(`releases/${plan.releaseId}/`) && path !== `releases/${plan.releaseId}`).map(([path, data]) => ({ path, data }));
  assert.equal(successorChildren.length, base.children.length);
  assert.equal(memory.objects.size, 198);
  const catalog = successorChildren.filter(({ path }) => /\/catalogCategories\/[^/]+$/u.test(path)).map(({ path, data }) => ({ path, data, fields: memory.createdFields.get(path) as any }));
  const expectedCatalogSha256 = documentHash(catalog);
  assert.equal(plan.package.catalogSha256, documentHash(plan.preservedChildren.filter(({ path }) => /\/catalogCategories\/[^/]+$/u.test(path))));
  assert.equal(plan.package.catalogSha256, expectedCatalogSha256);
  const successorRoot = memory.docs.get(`releases/${plan.releaseId}`)!;
  const successorPointer = memory.docs.get("runtime/activeRelease")!;
  assert.equal(successorRoot.catalogSha256, expectedCatalogSha256);
  assert.equal(successorPointer.catalogSha256, expectedCatalogSha256);
  assert.equal((memory.createdFields.get(`releases/${plan.releaseId}`)?.catalogSha256 as { stringValue?: string } | undefined)?.stringValue, expectedCatalogSha256);
  assert.equal((memory.getActivatedPointerFields()?.catalogSha256 as { stringValue?: string } | undefined)?.stringValue, expectedCatalogSha256);
  assert.notEqual(expectedCatalogSha256, base.pointer.catalogSha256);
  for (const original of base.children) {
    const successorPath = original.path.replace(base.root.path, `releases/${plan.releaseId}`), actual = memory.docs.get(successorPath)!;
    if (original.path.includes("/questions/goal-")) { const old = original.data, changed = actual; assert.deepEqual({ ...changed, media: old.media, answerMedia: old.answerMedia }, old); assert.notEqual((changed.media as Record<string, unknown>).assetSha256, (old.media as Record<string, unknown>).assetSha256); }
    else if (original.path.includes("/media/goal-quiz-2026:")) { const oldRest = { ...original.data }, newRest = { ...actual }; for (const key of ["assetSha256", "objectName", "generation"]) { delete oldRest[key]; delete newRest[key]; } assert.deepEqual(newRest, oldRest); }
    else assert.deepEqual(actual, original.data);
  }
  await applyGoalMediaEdgeSuccessor(plan, memory.api, async () => plan);
  await rollbackGoalMediaEdgeSuccessor(plan, memory.api, "m08-test-rollback");
  assert.deepEqual(memory.docs.get("runtime/activeRelease"), base.pointer);
});

test("successor refuses stale active pointer before Storage or Firestore writes", async () => {
  const { base, plan } = fixture(), memory = memoryApi(base, { stale: true });
  await assert.rejects(applyGoalMediaEdgeSuccessor(plan, memory.api, async () => plan), /stale/i);
  assert.equal(memory.objects.size, 0); assert.equal(memory.created.length, 0);
});

test("successor rejects tampered authenticated Storage readback before Firestore creates", async () => {
  const { base, plan } = fixture(), memory = memoryApi(base, { tamper: true });
  await assert.rejects(applyGoalMediaEdgeSuccessor(plan, memory.api, async () => plan), /readback differs/i);
  assert.equal(memory.created.length, 0);
});

test("retry refuses an incomplete successor activation identity before any object ensure", async () => {
  const { base, plan } = fixture(), memory = memoryApi(base);
  await applyGoalMediaEdgeSuccessor(plan, memory.api, async () => plan);
  memory.docs.delete(`activationReceipts/${plan.releaseId}-goal-media-edge`);
  const created = memory.created.length, objects = memory.objects.size;
  await assert.rejects(applyGoalMediaEdgeSuccessor(plan, memory.api, async () => plan), /activation identity/i);
  assert.equal(memory.created.length, created);
  assert.equal(memory.objects.size, objects);
});

const json = (value: unknown, status = 200) => Response.json(value, { status });
const restDocument = (path: string, rawFields: Record<string, unknown>) => ({ name: `projects/huroof-a3ee7/databases/(default)/documents/${path}`, updateTime: "2026-09-17T00:00:00.000000Z", fields: rawFields });
const transportApi = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) => createProductionGoalMediaEdgeSuccessorApi(process.cwd(), { accessToken: async () => "test-token", fetch: async (input, init) => handler(String(input), init) });

test("production adapter rejects Firebase download-token metadata before byte readback", async () => {
  const upload: PrivateMediaUpload = { mediaId: "goal-quiz-2026:001:blur", assetSha256: hash(1), contentType: "video/mp4", byteSize: 20, width: 854, height: 374, durationSeconds: 2.1, localFile: "assets/a.mp4", objectName: "question-media/goal-quiz-2026/assets/a.mp4", createOnly: true, metadata: { mediaId: "goal-quiz-2026:001:blur", assetSha256: hash(1), contentType: "video/mp4", byteSize: "20", width: "854", height: "374", durationSeconds: "2.1" } };
  const api = await transportApi((url) => url.includes("storage/v1/") ? json({ generation: "7", size: "20", contentType: "video/mp4", metadata: { ...upload.metadata, firebaseStorageDownloadTokens: "forbidden" } }) : new Response("unexpected", { status: 500 }));
  await assert.rejects(api.readObject(upload), /download-token metadata/i);
});

test("production adapter preserves typed Firestore fields and rejects a create-only conflict", async () => {
  const exactFields = { counter: { integerValue: "900719925474099312345" }, ratio: { doubleValue: 1.25 }, nested: { mapValue: { fields: { legacy: { integerValue: "-900719925474099312345" } } } } };
  const commits: unknown[] = [];
  const api = await transportApi((url, init) => {
    if (url.includes(":batchGet")) return json([]);
    if (url.endsWith(":commit")) { commits.push(JSON.parse(String(init?.body))); return json({}); }
    return new Response("unexpected", { status: 500 });
  });
  await api.create([{ path: "releases/typed/children/exact", data: { counter: Number(exactFields.counter.integerValue), ratio: 1.25, nested: { legacy: Number(exactFields.nested.mapValue.fields.legacy.integerValue) } }, fields: exactFields }]);
  const fieldsWritten = (commits[0] as { writes: Array<{ update: { fields: unknown } }> }).writes[0]!.update.fields;
  assert.deepEqual(fieldsWritten, exactFields);
  const conflictApi = await transportApi((url) => url.includes(":batchGet") ? json([{ found: restDocument("releases/typed/children/exact", { counter: { doubleValue: 1.25 } }) }]) : new Response("commit should not occur", { status: 500 }));
  await assert.rejects(conflictApi.create([{ path: "releases/typed/children/exact", data: { counter: 1 }, fields: exactFields }]), /conflicts/i);
});

test("production adapter CAS rejects a numerically equal but differently typed base pointer", async () => {
  const releaseId = "goal-media-edge-successor-cas-test";
  const baseFields = { releaseId: { stringValue: "base-release-0123456789abcdef" }, approvedCount: { integerValue: "900719925474099312345" } };
  const pointerFields = { releaseId: { stringValue: releaseId }, approvedCount: { integerValue: "900719925474099312345" } };
  const root: ReleaseDocument = { path: `releases/${releaseId}`, data: { releaseId, immutable: true }, fields: { releaseId: { stringValue: releaseId }, immutable: { booleanValue: true } } };
  const plan = { releaseId, root, pointer: { releaseId, approvedCount: Number(baseFields.approvedCount.integerValue) }, pointerFields, documentRootSha256: hash(77), base: { pointer: { releaseId: "base-release-0123456789abcdef", approvedCount: Number(baseFields.approvedCount.integerValue) }, pointerFields: baseFields, root: { path: "releases/base-release-0123456789abcdef", data: { releaseId: "base-release-0123456789abcdef" } } } } as any;
  const verificationFields = { releaseId: { stringValue: releaseId }, baseReleaseId: { stringValue: "base-release-0123456789abcdef" }, activePointer: { mapValue: { fields: pointerFields } }, documentRootSha256: { stringValue: plan.documentRootSha256 }, immutable: { booleanValue: true } };
  const commits: unknown[] = [];
  const api = await transportApi((url, init) => {
    if (url.endsWith(":beginTransaction")) return json({ transaction: "tx" });
    if (url.includes(":batchGet")) return json([
      { found: restDocument("runtime/activeRelease", { releaseId: baseFields.releaseId, approvedCount: { doubleValue: Number(baseFields.approvedCount.integerValue) } }) },
      { found: restDocument(root.path, root.fields!) },
      { found: restDocument(`verificationReceipts/${releaseId}-goal-media-edge`, verificationFields) },
    ]);
    if (url.endsWith(":commit")) { commits.push(JSON.parse(String(init?.body))); return json({}); }
    return new Response("unexpected", { status: 500 });
  });
  await assert.rejects(api.activate(plan, { path: "ignored", data: {} }), /CAS refused stale pointer/i);
  assert.equal(commits.length, 0);
});

test("production adapter paginates and follows descendants below showMissing ancestors without placeholders", async () => {
  const baseId = "base-release-0123456789abcdef";
  const pointer = restDocument("runtime/activeRelease", { releaseId: { stringValue: baseId }, approvedCount: { integerValue: "900719925474099312345" } });
  const root = restDocument(`releases/${baseId}`, { releaseId: { stringValue: baseId }, immutable: { booleanValue: true } });
  const descendant = restDocument(`releases/${baseId}/catalog/missing-parent/leaves/real-child`, { retainedInteger: { integerValue: "900719925474099312345" } });
  const seen: string[] = [];
  const api = await transportApi((url, init) => {
    seen.push(url);
    if (url.includes(":batchGet")) {
      const body = JSON.parse(String(init?.body)) as { documents: string[] };
      return json(body.documents.map((name) => name.endsWith("runtime/activeRelease") ? { found: pointer } : name.endsWith(`releases/${baseId}`) ? { found: root } : undefined).filter(Boolean));
    }
    if (url.includes(":listCollectionIds")) {
      const parent = url.split("/documents/")[1]!.split(":")[0]!;
      if (parent === `releases/${baseId}/catalog/missing-parent`) return json({ collectionIds: ["leaves"] });
      if (parent === `releases/${baseId}`) return json(String(init?.body).includes("second") ? { collectionIds: ["catalog"] } : { collectionIds: [], nextPageToken: "second" });
      return json({ collectionIds: [] });
    }
    if (url.includes(`/documents/releases/${baseId}/catalog?`)) return json({ documents: [{ name: `projects/huroof-a3ee7/databases/(default)/documents/releases/${baseId}/catalog/missing-parent` }] });
    if (url.includes(`/documents/releases/${baseId}/catalog/missing-parent/leaves?`)) return json({ documents: [descendant] });
    return new Response(`unexpected ${url}`, { status: 500 });
  });
  const captured = await captureActiveGoalMediaBase(api, "2026-09-17T00:00:00.000Z");
  assert.deepEqual(captured.children.map((item) => item.path), [`releases/${baseId}/catalog/missing-parent/leaves/real-child`]);
  assert.deepEqual(captured.children[0]!.fields, descendant.fields);
  assert.ok(seen.some((url) => url.includes("showMissing=true")));
  assert.ok(seen.length >= 2);
});
