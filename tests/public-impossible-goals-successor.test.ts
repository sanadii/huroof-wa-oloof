import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { applyPublicGoalPlan, buildPublicGoalPlan, createProductionPublicGoalApi, finalizedConsumerMap, finalizePublicGoalPlan, parseGuardedPublicationArguments, prepareGateBoundPlan, publicUrl, recursiveChildrenBounded, rollbackPublicGoalPlan, type CapturedBase, type PublicGoalApi } from "../scripts/public-impossible-goals-successor.js";

const release = "owner-category-reconciliation-b29d90de1e33749c5173d88b9686baf4";
const fields = (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).map(([key, value]) => [key, typeof value === "number" ? { integerValue: String(value) } : { stringValue: String(value) }])) as any;
const base = (): CapturedBase => {
  const root = { path: `releases/${release}`, data: { releaseId: release, approvedCount: 25763, documentRootSha256: "a".repeat(64) }, fields: fields({ releaseId: release, approvedCount: 25763, documentRootSha256: "a".repeat(64) }) };
  const pointer = { path: "runtime/activeRelease", data: { releaseId: release, approvedCount: 25763 }, fields: fields({ releaseId: release, approvedCount: 25763 }) };
  const category = { path: `${root.path}/catalogCategories/goals-2026`, data: { id: "goals-2026", labelAr: "من سجل الهدف؟", runtimeScope: "owner-authorized-media-extension-v1", immutable: true }, fields: fields({ id: "goals-2026", labelAr: "من سجل الهدف؟", runtimeScope: "owner-authorized-media-extension-v1", immutable: true }) };
  return { capturedAt: "2026-09-17T00:00:00.000Z", pointer, root, children: [category] };
};
const response = (body: unknown, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("builds the reviewed accepted-count English-caption questions and scoped-public content-addressed media bindings", async () => {
  const plan = await buildPublicGoalPlan(base());
  const goalCount = plan.uploads.length / 2;
  assert.equal(goalCount, 100);
  assert.equal(plan.additions.filter((doc) => doc.path.includes("/questions/")).length, goalCount);
  assert.equal(plan.additions.filter((doc) => doc.path.includes("/media/")).length, goalCount * 2);
  const q = plan.additions.find((doc) => doc.path.endsWith("/questions/public-impossible-goal-2026-reviewed-001"))!.data;
  assert.deepEqual(q.acceptedAnswers, ["Rayan Cherki"]);
  assert.equal(q.targetLetter, "");
  assert.equal(q.answerAliases, undefined);
  assert.match(plan.uploads[0]!.objectName, /^question-media\/goal-quiz-2026\/assets\/[a-f0-9]{64}\.mp4$/u);
  assert.match(publicUrl(plan.uploads[0]!), /[?&]token=/u);
  const retry = await buildPublicGoalPlan(base());
  assert.equal(retry.uploads[0]!.downloadToken, plan.uploads[0]!.downloadToken);
  assert.equal(plan.root.data.approvedCount, 25763 + goalCount);
  assert.equal(plan.pointer.data.releaseId, plan.releaseId);
  assert.equal(plan.documentRootSha256.length, 64);
  const finalized = finalizePublicGoalPlan(plan, plan.uploads.map((upload, index) => ({ mediaId: upload.mediaId, generation: String(index + 1), url: publicUrl(upload) })));
  assert.equal(finalized.finalized, true);
  assert.equal(finalized.additions.filter((doc) => doc.path.includes("/media/") && String(doc.data.mediaId).startsWith("public-impossible-goal-2026-reviewed:")).every((doc) => /^\d+$/u.test(String(doc.data.generation))), true);
  const consumerMap = finalizedConsumerMap(finalized);
  assert.equal(consumerMap.goals.length, goalCount);
  assert.equal(consumerMap.goals[0]?.exactEnglishAnswer, "Rayan Cherki");
  assert.match(consumerMap.goals[0]!.filtered.publicUrl, /token=/u);
  assert.match(consumerMap.goals[0]!.clear.generation, /^\d+$/u);
});

test("captured canonical pre-upload plan finalizes to the reviewed consumer map and pointer commitments", async () => {
  const preUpload = await buildPublicGoalPlan(base());
  const finalized = finalizePublicGoalPlan(preUpload, preUpload.uploads.map((upload: any, index: number) => ({ mediaId: upload.mediaId, generation: String(index + 100), url: publicUrl(upload) })));
  const map = finalizedConsumerMap(finalized);
  assert.equal(map.goals.length, 100);
  assert.equal(map.goals[99]!.questionId, "public-impossible-goal-2026-reviewed-100");
  assert.equal(finalized.pointer.data.documentRootSha256, finalized.root.data.documentRootSha256);
  assert.equal(finalized.pointer.data.approvedJsonlSha256, finalized.root.data.approvedJsonlSha256);
  assert.equal(finalized.pointer.data.sourceManifestSha256, finalized.root.data.sourceManifestSha256);
});

test("reuses an inherited normalized source-caption concept without changing the displayed answer", async () => {
  const captured = base();
  captured.children.push({ path: `${captured.root.path}/questions/existing`, data: { acceptedAnswers: ["  RAYAN   CHERKI  "], answerConceptId: "known-cherki", categoryId: "goals-2026" }, fields: { acceptedAnswers: { arrayValue: { values: [{ stringValue: "  RAYAN   CHERKI  " }] } }, answerConceptId: { stringValue: "known-cherki" }, categoryId: { stringValue: "goals-2026" } } });
  const plan = await buildPublicGoalPlan(captured);
  const question = plan.additions.find((doc) => doc.path.endsWith("/questions/public-impossible-goal-2026-reviewed-001"))!;
  assert.equal(question.data.answerConceptId, "known-cherki");
  assert.deepEqual(question.data.acceptedAnswers, ["Rayan Cherki"]);
});

test("restores only the goal category readiness in an owner-import successor", async () => {
  const captured = base(), goal = captured.children[0]!;
  goal.data.runtimeScope = "owner_imports_public_release_v1";
  goal.data.runtimeReadiness = { categories: false, huroof: false, charades: false };
  goal.fields = { ...goal.fields, runtimeScope: { stringValue: "owner_imports_public_release_v1" }, runtimeReadiness: { mapValue: { fields: { categories: { booleanValue: false }, huroof: { booleanValue: false }, charades: { booleanValue: false } } } } };
  const other = { path: `${captured.root.path}/catalogCategories/unrelated`, data: { id: "unrelated", runtimeReadiness: { categories: false } }, fields: { id: { stringValue: "unrelated" }, runtimeReadiness: { mapValue: { fields: { categories: { booleanValue: false } } } } } };
  captured.children.push(other);
  const plan = await buildPublicGoalPlan(captured);
  assert.deepEqual(plan.additions.find((d) => d.path.endsWith('/catalogCategories/goals-2026'))!.data.runtimeReadiness, { categories: true, huroof: false, charades: false });
  assert.deepEqual(plan.additions.find((d) => d.path.endsWith('/catalogCategories/unrelated'))!.fields, other.fields);
  assert.equal(plan.root.data.catalogSha256, plan.pointer.data.catalogSha256);
});

test("Gate-bound local rebuild tamper rejects before an API can be constructed", async () => {
  const plan = await buildPublicGoalPlan(base()), planBytes = Buffer.from(JSON.stringify(plan)), sourceBytes = await readFile("scripts/public-impossible-goals-successor.ts"), digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
  const receipt = Buffer.from(JSON.stringify({ status: "PASS", planSha256: digest(planBytes), sourceSha256: digest(sourceBytes), releaseId: plan.releaseId }));
  await assert.rejects(prepareGateBoundPlan(planBytes, receipt, sourceBytes, async () => ({ ...plan, packageSha256: "tampered" })), /deterministic local package rebuild/i);
});

test("documented rollback invocation maps pre-upload plan, Gate receipt, and operation reference exactly", () => {
  assert.deepEqual(parseGuardedPublicationArguments(["rollback", "preupload.json", "gate.json", "operator-2026-09-17"]), { operation: "rollback", planPath: "preupload.json", gateReceiptPath: "gate.json", operationReference: "operator-2026-09-17" });
  assert.throws(() => parseGuardedPublicationArguments(["rollback", "preupload.json", "gate.json"]), /operation-reference/i);
});

test("bounded traversal keeps missing ancestors out while discovering descendants", async () => {
  const docs: Record<string, any[]> = {
    "releases/r/catalog": [{ name: "projects/p/databases/(default)/documents/releases/r/catalog/missing", fields: undefined }],
    "releases/r/catalog/missing/leaves": [{ name: "projects/p/databases/(default)/documents/releases/r/catalog/missing/leaves/real", fields: { id: { stringValue: "real" } }, updateTime: "2026-09-17T00:00:00Z" }],
    "releases/r/catalog/missing/leaves/real": [],
  };
  const api = { listCollectionIds: async (path: string) => path === "releases/r" ? ["catalog"] : path.endsWith("missing") ? ["leaves"] : [], listCollection: async (path: string) => docs[path] ?? [] } as Pick<PublicGoalApi, "listCollectionIds" | "listCollection">;
  const result = await recursiveChildrenBounded(api, "releases/r", 2);
  assert.deepEqual(result.map((doc) => doc.path), ["releases/r/catalog/missing/leaves/real"]);
});

test("stale pointer rejects before public upload or Firestore create", async () => {
  const plan = await buildPublicGoalPlan(base()); let writes = 0;
  const stale = { name: "projects/p/databases/(default)/documents/runtime/activeRelease", fields: fields({ releaseId: "some-other-release", approvedCount: 1 }), updateTime: "t" } as any;
  const api: PublicGoalApi = { metadata: async () => ({ projectId: "huroof-a3ee7", databaseId: "(default)", locationId: "me-central2", type: "FIRESTORE_NATIVE" }), read: async (paths) => paths.map((path) => path === "runtime/activeRelease" ? stale : undefined), listCollectionIds: async () => [], listCollection: async () => [], create: async () => { writes++; }, ensurePublicObject: async () => { writes++; return { generation: "1", url: "" }; }, verifyPublicObject: async () => { writes++; return { generation: "1", url: "" }; }, activate: async () => { writes++; }, rollback: async () => { writes++; } };
  await assert.rejects(applyPublicGoalPlan(plan, api, async () => plan), /stale/i);
  assert.equal(writes, 0);
});

test("successful lifecycle materializes generations before immutable Firestore children", async () => {
  const plan = await buildPublicGoalPlan(base());
  const docs = new Map<string, any>();
  const source = (document: any) => ({ name: `projects/p/databases/(default)/documents/${document.path}`, fields: document.fields ?? fields(document.data), updateTime: "t" });
  for (const document of [plan.base.pointer, plan.base.root, ...plan.base.children]) docs.set(document.path, source(document));
  const listed = async (collection: string) => [...docs.values()].filter((document) => { const path = document.name.split("/documents/")[1]; return path.startsWith(`${collection}/`) && path.slice(collection.length + 1).split("/").length === 1; });
  const api: PublicGoalApi = {
    metadata: async () => ({ projectId: "huroof-a3ee7", databaseId: "(default)", locationId: "me-central2", type: "FIRESTORE_NATIVE" }),
    read: async (paths) => paths.map((path) => docs.get(path)),
    listCollectionIds: async (parent) => [...new Set([...docs.values()].map((document) => document.name.split("/documents/")[1]).filter((path) => path.startsWith(`${parent}/`)).map((path) => path.slice(parent.length + 1).split("/")[0]!))],
    listCollection: listed,
    create: async (created) => { for (const document of created) { assert.equal(docs.has(document.path), false); docs.set(document.path, source(document)); } },
    ensurePublicObject: async (upload) => ({ generation: String(Number(upload.mediaId.match(/\d+/u)![0]) + 1), url: publicUrl(upload) }),
    verifyPublicObject: async (upload) => ({ generation: String(Number(upload.mediaId.match(/\d+/u)![0]) + 1), url: publicUrl(upload) }),
    activate: async (final) => { docs.set("runtime/activeRelease", source(final.pointer)); },
    rollback: async () => {},
  };
  const final = await applyPublicGoalPlan(plan, api, async () => plan);
  assert.equal(final?.finalized, true);
  assert.equal(docs.get(final!.root.path).fields.documentRootSha256.stringValue, final!.documentRootSha256);
  assert.equal([...docs.keys()].filter((path) => path.startsWith(`${final!.root.path}/media/public-impossible-goal-2026-reviewed:`)).length, plan.uploads.length);
});

test("persisted finalized plan rejects a same-byte object with a new Storage generation before Firestore writes", async () => {
  const preUpload = await buildPublicGoalPlan(base()), final = finalizePublicGoalPlan(preUpload, preUpload.uploads.map((upload, index) => ({ mediaId: upload.mediaId, generation: String(index + 1), url: publicUrl(upload) })));
  let writes = 0;
  const source = (document: any) => ({ name: `projects/p/databases/(default)/documents/${document.path}`, fields: document.fields, updateTime: "t" });
  const docs = new Map([final.base.pointer, final.base.root, ...final.base.children].map((document) => [document.path, source(document)]));
  const api: PublicGoalApi = { metadata: async () => ({ projectId: "huroof-a3ee7", databaseId: "(default)", locationId: "me-central2", type: "FIRESTORE_NATIVE" }), read: async (paths) => paths.map((path) => docs.get(path)), listCollectionIds: async (parent) => parent === final.base.root.path ? ["catalogCategories"] : [], listCollection: async (path) => path.endsWith("catalogCategories") ? [docs.get(final.base.children[0]!.path)!] : [], create: async () => { writes++; }, ensurePublicObject: async (upload) => ({ generation: String(Number(final.additions.find((doc) => doc.data.mediaId === upload.mediaId)!.data.generation) + 1), url: publicUrl(upload) }), verifyPublicObject: async (upload) => ({ generation: String(Number(final.additions.find((doc) => doc.data.mediaId === upload.mediaId)!.data.generation) + 1), url: publicUrl(upload) }), activate: async () => { writes++; }, rollback: async () => { writes++; } };
  await assert.rejects(applyPublicGoalPlan(final, api, async () => final), /generation/i);
  assert.equal(writes, 0);
});

test("production REST adapter accepts array/newline batchGet and preserves raw Firestore fields on create", async () => {
  const seen: Array<{ url: string; init?: RequestInit }> = [];
  const document = { name: "projects/huroof-a3ee7/databases/(default)/documents/x/y", fields: { count: { integerValue: "9007199254740991" }, ratio: { doubleValue: 1.5 } }, updateTime: "t" };
  let batchGets = 0;
  const api = await createProductionPublicGoalApi(process.cwd(), { accessToken: async () => "test", fetch: async (url, init) => { seen.push({ url: String(url), init }); if (String(url).includes(":batchGet")) return response(++batchGets === 1 ? JSON.stringify([{ found: document }]) : `${JSON.stringify({ found: document })}\n`); if (String(url).endsWith(":commit")) return response({}); throw new Error(`unexpected ${url}`); } });
  const [read] = await api.read(["x/y"]);
  assert.deepEqual(read?.fields, document.fields);
  const [newlineRead] = await api.read(["x/y"]);
  assert.deepEqual(newlineRead?.fields, document.fields);
  await api.create([{ path: "x/new", data: { count: 1 }, fields: document.fields as any }]);
  const commit = JSON.parse(String(seen.find((item) => item.url.endsWith(":commit"))!.init!.body));
  assert.deepEqual(commit.writes[0].update.fields, document.fields);
});

test("production REST activation refuses a same-release-ID tampered pointer before commit", async () => {
  const prepared = await buildPublicGoalPlan(base());
  const final = finalizePublicGoalPlan(prepared, prepared.uploads.map((upload, index) => ({ mediaId: upload.mediaId, generation: String(index + 1), url: publicUrl(upload) })));
  let commits = 0;
  const api = await createProductionPublicGoalApi(process.cwd(), { accessToken: async () => "test", fetch: async (url, init) => {
    const value = String(url);
    if (value.endsWith(":beginTransaction")) return response({ transaction: "tx" });
    if (value.includes(":batchGet")) return response([{ found: { name: "projects/huroof-a3ee7/databases/(default)/documents/runtime/activeRelease", fields: { ...final.base.pointer.fields, approvedCount: { integerValue: "999999" } }, updateTime: "t" } }, { found: { name: `projects/huroof-a3ee7/databases/(default)/documents/${final.root.path}`, fields: final.root.fields, updateTime: "t" } }, { found: { name: `projects/huroof-a3ee7/databases/(default)/documents/verificationReceipts/${final.releaseId}-public-goals`, fields: { releaseId: { stringValue: final.releaseId } }, updateTime: "t" } }]);
    if (value.endsWith(":commit")) { commits++; return response({}); }
    throw new Error(`unexpected ${url} ${init?.method}`);
  } });
  await assert.rejects(api.activate(final, { path: `verificationReceipts/${final.releaseId}-public-goals`, data: { releaseId: final.releaseId }, fields: { releaseId: { stringValue: final.releaseId } } }), /CAS/i);
  assert.equal(commits, 0);
});

test("production REST activation commits exact transaction preconditions", async () => {
  const prepared = await buildPublicGoalPlan(base());
  const final = finalizePublicGoalPlan(prepared, prepared.uploads.map((upload, index) => ({ mediaId: upload.mediaId, generation: String(index + 1), url: publicUrl(upload) })));
  const receipt = { path: `verificationReceipts/${final.releaseId}-public-goals`, data: { releaseId: final.releaseId }, fields: { releaseId: { stringValue: final.releaseId } } };
  let commit: any;
  const api = await createProductionPublicGoalApi(process.cwd(), { accessToken: async () => "test", fetch: async (url, init) => {
    const value = String(url);
    if (value.endsWith(":beginTransaction")) return response({ transaction: "tx-exact" });
    if (value.includes(":batchGet")) return response([{ found: { name: "projects/huroof-a3ee7/databases/(default)/documents/runtime/activeRelease", fields: final.base.pointer.fields, updateTime: "pointer-time" } }, { found: { name: `projects/huroof-a3ee7/databases/(default)/documents/${final.root.path}`, fields: final.root.fields, updateTime: "root-time" } }, { found: { name: `projects/huroof-a3ee7/databases/(default)/documents/${receipt.path}`, fields: receipt.fields, updateTime: "receipt-time" } }]);
    if (value.endsWith(":commit")) { commit = JSON.parse(String(init?.body)); return response({}); }
    throw new Error(`unexpected ${url}`);
  } });
  await api.activate(final, receipt);
  assert.equal(commit.transaction, "tx-exact");
  assert.deepEqual(commit.writes[0].currentDocument, { exists: false });
  assert.deepEqual(commit.writes[1].currentDocument, { updateTime: "pointer-time" });
  assert.deepEqual(commit.writes[1].update.fields, final.pointer.fields);
});

test("production REST activation refuses a tampered verification receipt before commit", async () => {
  const prepared = await buildPublicGoalPlan(base());
  const final = finalizePublicGoalPlan(prepared, prepared.uploads.map((upload, index) => ({ mediaId: upload.mediaId, generation: String(index + 1), url: publicUrl(upload) })));
  let commits = 0;
  const receipt = { path: `verificationReceipts/${final.releaseId}-public-goals`, data: { releaseId: final.releaseId }, fields: { releaseId: { stringValue: final.releaseId } } };
  const api = await createProductionPublicGoalApi(process.cwd(), { accessToken: async () => "test", fetch: async (url) => {
    const value = String(url);
    if (value.endsWith(":beginTransaction")) return response({ transaction: "tx" });
    if (value.includes(":batchGet")) return response(`${JSON.stringify({ found: { name: "projects/huroof-a3ee7/databases/(default)/documents/runtime/activeRelease", fields: final.base.pointer.fields, updateTime: "t" } })}\n${JSON.stringify({ found: { name: `projects/huroof-a3ee7/databases/(default)/documents/${final.root.path}`, fields: final.root.fields, updateTime: "t" } })}\n${JSON.stringify({ found: { name: `projects/huroof-a3ee7/databases/(default)/documents/${receipt.path}`, fields: { releaseId: { stringValue: "tampered" } }, updateTime: "t" } })}\n`);
    if (value.endsWith(":commit")) { commits++; return response({}); }
    throw new Error(`unexpected ${url}`);
  } });
  await assert.rejects(api.activate(final, receipt), /CAS/i);
  assert.equal(commits, 0);
});

test("rollback refuses wrong activation identity before adapter rollback", async () => {
  const prepared = await buildPublicGoalPlan(base());
  const final = finalizePublicGoalPlan(prepared, prepared.uploads.map((upload, index) => ({ mediaId: upload.mediaId, generation: String(index + 1), url: publicUrl(upload) })));
  let rollbacks = 0;
  const api = {
    read: async (paths: string[]) => paths.map((path) => path === "runtime/activeRelease"
      ? { name: "projects/huroof-a3ee7/databases/(default)/documents/runtime/activeRelease", fields: final.pointer.fields, updateTime: "t" }
      : { name: `projects/huroof-a3ee7/databases/(default)/documents/${path}`, fields: { releaseId: { stringValue: "tampered" } }, updateTime: "t" }),
    rollback: async () => { rollbacks++; },
  } as unknown as PublicGoalApi;
  await assert.rejects(rollbackPublicGoalPlan(final, api, "gate-rollback-1"), /identity/i);
  assert.equal(rollbacks, 0);
});

test("production REST rollback transaction refuses wrong activation identity before commit", async () => {
  const prepared = await buildPublicGoalPlan(base());
  const final = finalizePublicGoalPlan(prepared, prepared.uploads.map((upload, index) => ({ mediaId: upload.mediaId, generation: String(index + 1), url: publicUrl(upload) })));
  let commits = 0;
  const api = await createProductionPublicGoalApi(process.cwd(), { accessToken: async () => "test", fetch: async (url) => {
    const value = String(url);
    if (value.endsWith(":beginTransaction")) return response({ transaction: "rollback-tx" });
    if (value.includes(":batchGet")) return response([{ found: { name: "projects/huroof-a3ee7/databases/(default)/documents/runtime/activeRelease", fields: final.pointer.fields, updateTime: "pointer-time" } }, { found: { name: `projects/huroof-a3ee7/databases/(default)/documents/activationReceipts/${final.releaseId}-public-goals`, fields: { releaseId: { stringValue: "tampered" } }, updateTime: "activation-time" } }]);
    if (value.endsWith(":commit")) { commits++; return response({}); }
    throw new Error(`unexpected ${url}`);
  } });
  await assert.rejects(api.rollback(final, { path: "rollbackReceipts/test", data: { releaseId: final.releaseId }, fields: { releaseId: { stringValue: final.releaseId } } }), /identity/i);
  assert.equal(commits, 0);
});

test("production REST public verification rejects wrong generation metadata after anonymous bytes", async () => {
  const plan = await buildPublicGoalPlan(base()), upload = plan.uploads[0]!;
  const bytes = await readFile(`data/videos/100-impossible-goals-2026-final/${upload.localFile}`);
  const api = await createProductionPublicGoalApi(process.cwd(), { accessToken: async () => "test", fetch: async (url) => {
    const value = String(url);
    if (value.startsWith("https://firebasestorage.googleapis.com/")) return new Response(bytes, { status: 200 });
    if (value.startsWith("https://storage.googleapis.com/storage/")) return response({ generation: "wrong", size: String(bytes.length), contentType: "video/mp4", metadata: { firebaseStorageDownloadTokens: upload.downloadToken, assetSha256: upload.assetSha256, mediaId: upload.mediaId } });
    throw new Error(`unexpected ${url}`);
  } });
  await assert.rejects(api.verifyPublicObject(upload), /metadata/i);
});

test("production REST create-only 412 resumes only after exact anonymous public verification", async () => {
  const plan = await buildPublicGoalPlan(base()), upload = plan.uploads[0]!;
  const bytes = await readFile(`data/videos/100-impossible-goals-2026-final/${upload.localFile}`);
  let objectReads = 0, uploaded = false;
  const api = await createProductionPublicGoalApi(process.cwd(), { accessToken: async () => "test", fetch: async (url, init) => {
    const value = String(url);
    if (value.startsWith("https://firebasestorage.googleapis.com/")) return new Response(bytes, { status: 200 });
    if (value.startsWith("https://storage.googleapis.com/upload/")) { uploaded = true; assert.match(value, /ifGenerationMatch=0/u); assert.equal(init?.method, "POST"); return response({}, 412); }
    if (value.startsWith("https://storage.googleapis.com/storage/")) {
      objectReads++;
      if (objectReads === 1) return response({}, 404);
      return response({ generation: "42", size: String(bytes.length), contentType: "video/mp4", metadata: { firebaseStorageDownloadTokens: upload.downloadToken, assetSha256: upload.assetSha256, mediaId: upload.mediaId, byteSize: String(upload.byteSize), width: String(upload.width), height: String(upload.height), durationSeconds: String(upload.durationSeconds) } });
    }
    throw new Error(`unexpected ${url}`);
  } });
  assert.deepEqual(await api.ensurePublicObject(upload), { generation: "42", url: publicUrl(upload) });
  assert.equal(uploaded, true);
});
