import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canonicalJson } from "../scripts/firestore-release-canonical.js";
import {
  approvedReleaseCatalogProjection,
  questionRows,
  RUNTIME_QUESTION_FIELDS,
} from "../functions/src/index.js";
import {
  applyOwnerCategorySupplement,
  assertNoQuestionOverlap,
  buildOwnerCategoryReconciliationPlan,
  createProductionOwnerCategorySupplementApi,
  rollbackOwnerCategorySupplement,
  verifyOwnerCategorySupplement,
  type CapturedBase,
  type CategorySupplementApi,
  type CategorySupplementPlan,
  type ReleaseDocument,
} from "../scripts/owner-category-reconciliation.js";

const sha = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
const original = "D:/projects/huroof_wa_oloof/output";
const q6000Path = `${original}/q6000-20260912/q6000-plan.json`;
const m05PlanPath = `${original}/media-live-20260911/owner-category-supplement-plan.json`;
const m05SnapshotPath = `${original}/media-live-20260911/M05-VERIFIED-SNAPSHOT.json`;
const freshQ6000Path = `${original}/media-live-20260911/M07-FRESH-Q6000-BASE.json`;
const privateFixture = process.env.RUN_PRIVATE_OWNER_CATEGORY_RECONCILIATION_TESTS === "1" && [q6000Path, m05PlanPath, m05SnapshotPath].every(existsSync);

test("actual Q6000 plus retained M05 prepares the exact 25,763-question union", { skip: privateFixture ? false : "set RUN_PRIVATE_OWNER_CATEGORY_RECONCILIATION_TESTS=1 with Q6000/M05 private artifacts" }, async () => {
  const [q6000, m05Plan, m05Snapshot] = await Promise.all([q6000Path, m05PlanPath, m05SnapshotPath].map(async (path) => JSON.parse(await readFile(path, "utf8"))));
  const root = q6000.release.documents.find((document: ReleaseDocument) => document.path === `releases/${q6000.release.releaseId}`)!;
  const pointer = Object.fromEntries(["releaseId", "approvedCount", "approvedJsonlSha256", "catalogSha256", "documentRootSha256", "sourceManifestSha256", "ownerApprovalPath", "publicationAuthority"].map((field) => [field, root.data[field]]));
  const base: CapturedBase = { capturedAt: "candidate", projectId: "huroof-a3ee7", databaseId: "(default)", locationId: "me-central2", pointer, root, documents: q6000.release.documents };
  const plan = await buildOwnerCategoryReconciliationPlan({ base, q6000, m05Plan, m05Snapshot, m05PlanSha256: sha(await readFile(m05PlanPath, "utf8")), allowCandidate: true });
  assert.equal(plan.approvedCount, 25_763);
  assert.equal(plan.documents.length, 26_445);
  assert.equal(plan.documents.filter((document) => document.path.includes("/questions/")).length, 25_763);
  assert.equal(plan.documents.filter((document) => document.path.includes("/catalogCategories/")).length, 96);
  assert.equal(plan.documents.filter((document) => document.path.includes("/media/")).length, 489);
  assert.equal(plan.approvalDocuments.length, 107);
  const additions = plan.documents.filter((document) => document.data.categoryModeOnly === true);
  assert.equal(additions.length, 4_500);
  assert.ok(additions.every((document) => document.data.targetLetter === "" && document.data.letterModeEligible === false && document.data.specialistReview === "not_claimed"));
  const projection = new Set<string>(RUNTIME_QUESTION_FIELDS);
  const catalog = approvedReleaseCatalogProjection(
    Object.fromEntries(["releaseId", "approvedCount", "approvedJsonlSha256", "catalogSha256", "documentRootSha256", "sourceManifestSha256", "ownerApprovalPath", "publicationAuthority"].map((field) => [field, plan.documents.find((document) => document.path === `releases/${plan.releaseId}`)!.data[field]])),
    plan.documents.find((document) => document.path === `releases/${plan.releaseId}`)!.data,
    plan.documents.filter((document) => document.path.includes("/catalogCategories/")).map((document) => ({ id: String(document.data.id), data: { id: document.data.id, labelAr: document.data.labelAr } })),
    questionRows(plan.documents.filter((document) => document.path.includes("/questions/")).map((document) => ({ id: String(document.data.id), data: () => Object.fromEntries(Object.entries(document.data).filter(([field]) => projection.has(field))) }))),
  );
  assert.equal(catalog.categories.length, 96);
  assert.ok(additions.every((document) => !Object.hasOwn(document.data, "sourceProvenance") || document.data.categoryModeOnly === true));
});

test("actual Q6000 rows reject M05 ID and normalized tuple collisions", { skip: privateFixture ? false : "set RUN_PRIVATE_OWNER_CATEGORY_RECONCILIATION_TESTS=1 with Q6000/M05 private artifacts" }, async () => {
  const [q6000, m05Plan] = await Promise.all([q6000Path, m05PlanPath].map(async (path) => JSON.parse(await readFile(path, "utf8"))));
  const base = q6000.release.documents.filter((document: ReleaseDocument) => document.path.includes("/questions/")).map((document: ReleaseDocument) => document.data);
  const addition = m05Plan.documents.find((document: ReleaseDocument) => document.data.categoryModeOnly === true)!;
  const baseQuestion = q6000.release.documents.find((document: ReleaseDocument) => document.path.includes("/questions/"))!;
  const idCollision = structuredClone(addition); idCollision.data.id = baseQuestion.data.id;
  assert.throws(() => assertNoQuestionOverlap(base, [idCollision]), /conflicts with Q6000 identity/);
  const tupleCollision = structuredClone(addition); tupleCollision.data.categoryId = baseQuestion.data.categoryId; tupleCollision.data.promptAr = baseQuestion.data.promptAr; tupleCollision.data.canonicalAnswer = baseQuestion.data.canonicalAnswer;
  assert.throws(() => assertNoQuestionOverlap(base, [tupleCollision]), /conflicts with Q6000 identity/);
});

test("fresh authority capture rejects missing original, Q4800, Q6000 chunks and extras", { skip: privateFixture && existsSync(freshQ6000Path) ? false : "set RUN_PRIVATE_OWNER_CATEGORY_RECONCILIATION_TESTS=1 with fresh Q6000 capture" }, async () => {
  const [base, q6000, m05Plan, m05Snapshot] = await Promise.all([freshQ6000Path, q6000Path, m05PlanPath, m05SnapshotPath].map(async (path) => JSON.parse(await readFile(path, "utf8"))));
  const build = (changed: CapturedBase) => buildOwnerCategoryReconciliationPlan({ base: changed, q6000, m05Plan, m05Snapshot, m05PlanSha256: sha(awaitedM05Bytes) });
  const awaitedM05Bytes = await readFile(m05PlanPath, "utf8");
  for (const root of ["owner-approval-072dd09e41e2eaf652db75c9d5216d7515b5a7aff11fba180f864df118363180", "owner-approval-q4800-v2-3877f95329e49bf3bc462f68e9f540b0", "owner-approval-q6000-v1-2b94b9d133eac485ef52b63227232faa"]) {
    const changed = structuredClone(base); changed.authorityDocuments = changed.authorityDocuments.filter((document: ReleaseDocument) => document.path !== `contentOwnerApprovals/${root}/entries/chunk-00001`);
    await assert.rejects(() => build(changed), /authority.*(incomplete|altered)/i);
  }
  const extra = structuredClone(base); extra.authorityDocuments.push({ path: "contentOwnerApprovals/owner-approval-q6000-v1-2b94b9d133eac485ef52b63227232faa/entries/unexpected", data: { approvalState: "owner_approved" } });
  await assert.rejects(() => build(extra), /authority.*(incomplete|altered)/i);
});
test("production REST transport paginates and sends create-only immutable writes", async () => {
  const requests: Array<{ url: string; body: any }> = [];
  const api = await createProductionOwnerCategorySupplementApi({
    accessToken: async () => "test-token",
    fetch: async (url: string | URL, init?: RequestInit) => {
      const address = String(url), body = init?.body ? JSON.parse(String(init.body)) : {};
      requests.push({ url: address, body });
      if (address.endsWith(":batchGet")) return new Response("[]", { status: 200 });
      if (address.includes(":listCollectionIds")) return Response.json(body.pageToken ? { collectionIds: ["questions"] } : { collectionIds: ["media"], nextPageToken: "next" });
      if (address.includes("/questions?")) return Response.json(address.includes("pageToken=next") ? { documents: [] } : { documents: [{ name: "projects/x/databases/(default)/documents/release/questions/q1" }], nextPageToken: "next" });
      if (address.endsWith(":commit")) return Response.json({});
      if (address.endsWith("databases/(default)")) return Response.json({ locationId: "me-central2", type: "FIRESTORE_NATIVE" });
      throw new Error(address);
    },
  } as any);
  assert.deepEqual(await api.listCollectionIds("releases/r"), ["media", "questions"]);
  assert.equal((await api.listCollection("releases/r/questions")).length, 1);
  await api.create([{ path: "releases/r/questions/q1", data: { id: "q1", duration: 2.336, immutable: true } }]);
  const commit = requests.find((request) => request.url.endsWith(":commit"))!;
  assert.equal(commit.body.writes[0].currentDocument.exists, false);
  assert.equal(commit.body.writes[0].update.fields.duration.doubleValue, 2.336);
});

const docHash = (documents: ReleaseDocument[]) => sha(documents.slice().sort((a, b) => a.path.localeCompare(b.path)).map(({ path, data }) => ({ path, data })));
const wire = (value: unknown): any => value === null ? { nullValue: null } : typeof value === "string" ? { stringValue: value } : typeof value === "boolean" ? { booleanValue: value } : typeof value === "number" ? (Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }) : Array.isArray(value) ? { arrayValue: { values: value.map(wire) } } : { mapValue: { fields: Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, wire(child)])) } };
const source = (path: string, data: Record<string, unknown>) => ({ name: `projects/huroof-a3ee7/databases/(default)/documents/${path}`, updateTime: "2026-09-12T00:00:00.000Z", fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, wire(value)])) });
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const activePointer = (root: Record<string, unknown>) => Object.fromEntries(["releaseId", "approvedCount", "approvedJsonlSha256", "catalogSha256", "documentRootSha256", "sourceManifestSha256", "ownerApprovalPath", "publicationAuthority"].map((field) => [field, root[field]]));
const rootOf = (plan: CategorySupplementPlan) => plan.documents.find((document) => document.path === `releases/${plan.releaseId}`)!;
const verificationPath = (plan: CategorySupplementPlan) => `ownerCategoryVerificationReceipts/${plan.releaseId}-${plan.documentRootSha256}`;
const activationPath = (plan: CategorySupplementPlan) => `activationReceipts/${plan.releaseId}-owner-category`;
function syntheticPlan(): CategorySupplementPlan {
  const baseRoot: ReleaseDocument = { path: "releases/q6000", data: { releaseId: "q6000", immutable: true, approvedCount: 21263, approvedJsonlSha256: sha("q6000-jsonl"), catalogSha256: sha("q6000-catalog"), documentRootSha256: sha("q6000-root"), sourceManifestSha256: sha("q6000-source"), ownerApprovalPath: "contentOwnerApprovals/q6000", publicationAuthority: "owner_approval", baseReleaseId: "q4800" } };
  const base: CapturedBase = { capturedAt: "test", projectId: "huroof-a3ee7", databaseId: "(default)", locationId: "me-central2", pointer: activePointer(baseRoot.data), root: baseRoot, documents: [baseRoot] };
  const releaseId = "reconciliation-test";
  const children: ReleaseDocument[] = [
    { path: `releases/${releaseId}/questions/q`, data: { id: "q", categoryId: "cat", modality: "classic", targetLetter: "ا", canonicalAnswer: "أ", acceptedAnswers: ["أ"], immutable: true } },
    { path: `releases/${releaseId}/catalogCategories/cat`, data: { id: "cat", labelAr: "فئة", immutable: true } },
    { path: `releases/${releaseId}/inventory/cat`, data: { categoryId: "cat", approvedCount: 1, immutable: true } },
    { path: `releases/${releaseId}/media/m`, data: { mediaId: "m", generation: "1", immutable: true } },
  ];
  const documentRootSha256 = docHash(children), catalogSha256 = docHash(children.filter((document) => document.path.includes("/catalogCategories/")));
  const authority: ReleaseDocument = { path: "contentOwnerApprovals/q6000", data: { immutable: true, approvalState: "owner_approved" } };
  const authorityChunk: ReleaseDocument = { path: "contentOwnerApprovals/q6000/entries/chunk-00001", data: { immutable: true, entries: ["q6000"] } };
  const retainedM05Documents = Array.from({ length: 15994 }, (_, index) => ({ path: `releases/m05/questions/${index}`, data: { id: `m05-${index}`, immutable: true } }));
  const root: ReleaseDocument = { path: `releases/${releaseId}`, data: { releaseId, immutable: true, approvedCount: 25763, approvedJsonlSha256: sha("union-jsonl"), catalogSha256, documentRootSha256, sourceManifestSha256: sha("union-source"), ownerApprovalPath: authority.path, publicationAuthority: "owner_authorization_q6000_m05_reconciliation", baseReleaseId: "q6000" } };
  return { schemaVersion: "owner-category-reconciliation-v1", releaseId, target: { projectId: "huroof-a3ee7", databaseId: "(default)", locationId: "me-central2" }, base, source: { retainedM05PlanSha256: sha("m05-plan"), retainedM05RootSha256: sha("m05-root"), recordCount: 4500, categories: {}, bindingSha256: sha("bindings") }, ownerApproval: { path: authority.path, runId: "q6000", authority: "owner_approval", specialistReview: "not_claimed" }, documents: [...children, root], retainedM05Documents, approvalDocuments: [authority, authorityChunk], approvedCount: 25763, catalogSha256, documentRootSha256, sourceManifestSha256: String(root.data.sourceManifestSha256), readiness: {} };
}
class PersistentFirestore implements CategorySupplementApi {
  readonly documents = new Map<string, any>(); failAfter: number | undefined; dropPath: string | undefined; tamperPath: string | undefined; private creates = 0;
  constructor(readonly plan: CategorySupplementPlan) { this.documents.set("runtime/activeRelease", source("runtime/activeRelease", plan.base.pointer)); for (const document of [...plan.base.documents, ...plan.retainedM05Documents, ...plan.approvalDocuments]) this.documents.set(document.path, source(document.path, document.data)); }
  async target() { return { projectId: "huroof-a3ee7", databaseId: "(default)", locationId: "me-central2", type: "FIRESTORE_NATIVE" }; }
  async read(paths: string[]) { return paths.map((path) => this.documents.get(path)); }
  async create(documents: ReleaseDocument[]) { for (const document of documents) { const existing = this.documents.get(document.path); if (existing && !same(existing.fields, source(document.path, document.data).fields)) throw new Error("create-only conflict"); if (!existing) { if (document.path === this.dropPath) continue; this.documents.set(document.path, source(document.path, document.path === this.tamperPath ? { ...document.data, altered: true } : document.data)); this.creates += 1; if (this.failAfter && this.creates >= this.failAfter) throw new Error("partial transport failure"); } } }
  async listCollectionIds(path: string) { return [...new Set([...this.documents.keys()].filter((key) => key.startsWith(path + "/")).map((key) => key.slice(path.length + 1).split("/")[0]!))].sort(); }
  async listCollection(path: string) { const depth = path.split("/").length + 1; return [...this.documents.entries()].filter(([key]) => key.startsWith(path + "/") && key.split("/").length === depth).map(([, document]) => document); }
  async activate(plan: CategorySupplementPlan, verification: ReleaseDocument) { const root = rootOf(plan), expected = activePointer(root.data), activation = { releaseId: plan.releaseId, baseReleaseId: root.data.baseReleaseId, activePointer: expected, ownerApprovalPath: plan.ownerApproval.path, immutable: true }; for (const document of [root, verification, ...plan.approvalDocuments]) if (!same(this.documents.get(document.path)?.fields, source(document.path, document.data).fields)) throw new Error("Activation authority or release identity drifted."); const prior = this.documents.get(activationPath(plan)); if (prior) { if (same(prior.fields, source(activationPath(plan), activation).fields) && same(this.documents.get("runtime/activeRelease")?.fields, source("runtime/activeRelease", expected).fields)) return; throw new Error("Activation retry conflicts with active pointer."); } if (!same(this.documents.get("runtime/activeRelease")?.fields, source("runtime/activeRelease", plan.base.pointer).fields)) throw new Error("Activation pointer changed."); this.documents.set(activationPath(plan), source(activationPath(plan), activation)); this.documents.set("runtime/activeRelease", source("runtime/activeRelease", expected)); }
  async rollback(plan: CategorySupplementPlan, receipt: ReleaseDocument) { const root = rootOf(plan), expected = activePointer(root.data), verification = { releaseId: plan.releaseId, baseReleaseId: root.data.baseReleaseId, documentRootSha256: plan.documentRootSha256, ownerApprovalPath: plan.ownerApproval.path, verificationKind: "owner_category_reconciliation_exact_readback", immutable: true }, activation = { releaseId: plan.releaseId, baseReleaseId: root.data.baseReleaseId, activePointer: expected, ownerApprovalPath: plan.ownerApproval.path, immutable: true }; if (this.documents.has(receipt.path) || !same(this.documents.get("runtime/activeRelease")?.fields, source("runtime/activeRelease", expected).fields) || !same(this.documents.get(root.path)?.fields, source(root.path, root.data).fields) || !same(this.documents.get(verificationPath(plan))?.fields, source(verificationPath(plan), verification).fields) || !same(this.documents.get(activationPath(plan))?.fields, source(activationPath(plan), activation).fields)) throw new Error("Rollback CAS rejects altered active identity."); this.documents.set("runtime/activeRelease", source("runtime/activeRelease", plan.base.pointer)); this.documents.set(receipt.path, source(receipt.path, receipt.data)); }
  async reactivate() { throw new Error("not used"); }
}
test("persistent reconciliation retries partial writes, rejects tampering, CAS-activates, and rolls back exactly", async () => {
  const plan = syntheticPlan(), cloud = new PersistentFirestore(plan); cloud.failAfter = 2;
  await assert.rejects(() => applyOwnerCategorySupplement(plan, cloud, async () => plan), /partial transport/i);
  cloud.failAfter = undefined; await applyOwnerCategorySupplement(plan, cloud, async () => plan); await applyOwnerCategorySupplement(plan, cloud, async () => plan);
  assert.equal((await verifyOwnerCategorySupplement(plan, cloud)).active, true);
  await rollbackOwnerCategorySupplement(plan, cloud, "restore-q6000");
  assert.ok(same(cloud.documents.get("runtime/activeRelease")?.fields, source("runtime/activeRelease", plan.base.pointer).fields));
  await assert.rejects(() => rollbackOwnerCategorySupplement(plan, cloud, "different"), /Rollback CAS/i);
});
test("child, retained base, authority, and stale pointer drift abort before completion", async () => {
  for (const mode of ["child", "retained", "authority", "pointer"] as const) {
    const plan = syntheticPlan(), cloud = new PersistentFirestore(plan);
    if (mode === "child") cloud.dropPath = plan.documents.find((document) => document.path.includes("/questions/"))!.path;
    if (mode === "retained") cloud.documents.set(plan.retainedM05Documents[0]!.path, source(plan.retainedM05Documents[0]!.path, { immutable: false }));
    if (mode === "authority") cloud.documents.set(plan.approvalDocuments[0]!.path, source(plan.approvalDocuments[0]!.path, { immutable: false }));
    if (mode === "pointer") cloud.documents.set("runtime/activeRelease", source("runtime/activeRelease", { releaseId: "stale" }));
    await assert.rejects(() => applyOwnerCategorySupplement(plan, cloud, async () => plan), /child readback|Retained M05|authority|pointer|Existing immutable/i);
    assert.equal(cloud.documents.has(rootOf(plan).path), false);
    assert.equal(cloud.documents.has(verificationPath(plan)), false);
  }
});

class StatefulFirestoreFetch {
  readonly documents = new Map<string, any>();
  readonly commits: any[] = [];
  version = 0;
  failAfterWrites: number | undefined;
  dropPath: string | undefined;
  stalePointerOnActivationCommit = false;
  writes = 0;
  constructor(plan: CategorySupplementPlan) { this.put("runtime/activeRelease", plan.base.pointer); for (const document of [...plan.base.documents, ...plan.retainedM05Documents, ...plan.approvalDocuments]) this.put(document.path, document.data); }
  put(path: string, data: Record<string, unknown>) { this.version += 1; this.documents.set(path, { ...source(path, data), updateTime: `2026-09-12T00:00:${String(this.version).padStart(2, "0")}.000Z` }); }
  path(name: string) { return name.slice(name.indexOf("/documents/") + 11); }
  async fetch(url: string | URL, init?: RequestInit) {
    const address = String(url), body = init?.body ? JSON.parse(String(init.body)) : {};
    if (address.endsWith(":beginTransaction")) return Response.json({ transaction: "tx" });
    if (address.endsWith(":batchGet")) {
      const rows = body.documents.map((name: string) => this.documents.get(this.path(name)) ? { found: this.documents.get(this.path(name)) } : { missing: name }).reverse();
      return new Response(rows.map((row: unknown) => JSON.stringify(row)).join("\n"), { status: 200 });
    }
    if (address.includes(":listCollectionIds")) {
      const path = this.path(address.slice(0, address.indexOf(":listCollectionIds")));
      const ids = [...new Set([...this.documents.keys()].filter((key) => key.startsWith(path + "/")).map((key) => key.slice(path.length + 1).split("/")[0]!))].sort();
      const token = body.pageToken ? Number(body.pageToken) : 0, page = ids.slice(token, token + 2);
      return Response.json({ collectionIds: page, ...(token + 2 < ids.length ? { nextPageToken: String(token + 2) } : {}) });
    }
    if (address.includes("?pageSize=")) {
      const before = address.slice(0, address.indexOf("?")); const path = this.path(before);
      const all = [...this.documents.entries()].filter(([key]) => key.startsWith(path + "/") && key.slice(path.length + 1).split("/").length === 1).map(([, value]) => value);
      const token = Number(new URL(address).searchParams.get("pageToken") ?? "0"), page = all.slice(token, token + 2);
      return Response.json({ documents: page, ...(token + 2 < all.length ? { nextPageToken: String(token + 2) } : {}) });
    }
    if (address.endsWith(":commit")) {
      this.commits.push(structuredClone(body));
      if (
        this.stalePointerOnActivationCommit &&
        body.transaction &&
        (body.writes ?? []).some(
          (write: { update?: { name?: string } }) =>
            write.update &&
            this.path(write.update.name ?? "") === "runtime/activeRelease",
        )
      ) {
        this.stalePointerOnActivationCommit = false;
        this.put("runtime/activeRelease", { releaseId: "concurrent-pointer" });
      }
      if (body.transaction)
        for (const write of body.writes ?? []) {
          const path = this.path(write.update.name);
          const existing = this.documents.get(path);
          const condition = write.currentDocument ?? {};
          if (
            (condition.exists === false && existing) ||
            (condition.updateTime && existing?.updateTime !== condition.updateTime) ||
            (condition.updateTime && !existing)
          )
            return new Response("precondition", { status: 409 });
        }
      for (const write of body.writes ?? []) {
        const path = this.path(write.update.name);
        const existing = this.documents.get(path), condition = write.currentDocument ?? {};
        if ((condition.exists === false && existing) || (condition.updateTime && existing?.updateTime !== condition.updateTime) || (condition.updateTime && !existing)) return new Response("precondition", { status: 409 });
        if (path !== this.dropPath) {
          this.version += 1;
          this.documents.set(path, { name: write.update.name, fields: write.update.fields, updateTime: `2026-09-12T00:01:${String(this.version).padStart(2, "0")}.000Z` });
        }
        this.writes += 1;
        if (this.failAfterWrites && this.writes >= this.failAfterWrites) { this.failAfterWrites = undefined; return new Response("interrupted", { status: 500 }); }
      }
      return Response.json({});
    }
    if (address.endsWith("databases/(default)")) return Response.json({ locationId: "me-central2", type: "FIRESTORE_NATIVE" });
    throw new Error(address);
  }
}
test("actual production REST adapter handles durable partial retry, CAS activation, verification, and rollback", async () => {
  const plan = syntheticPlan(), wireStore = new StatefulFirestoreFetch(plan);
  wireStore.failAfterWrites = 2;
  const api = await createProductionOwnerCategorySupplementApi({ accessToken: async () => "test", fetch: wireStore.fetch.bind(wireStore) } as any);
  await assert.rejects(() => applyOwnerCategorySupplement(plan, api, async () => plan), /Firestore REST 500/);
  await applyOwnerCategorySupplement(plan, api, async () => plan);
  await applyOwnerCategorySupplement(plan, api, async () => plan);
  assert.equal((await verifyOwnerCategorySupplement(plan, api)).active, true);
  const activationCommit = wireStore.commits.find((commit) =>
    commit.transaction &&
    commit.writes.some((write: { update: { name: string } }) =>
      wireStore.path(write.update.name) === activationPath(plan),
    ),
  )!;
  const activationWrite = activationCommit.writes.find(
    (write: { update: { name: string } }) =>
      wireStore.path(write.update.name) === activationPath(plan),
  );
  const activationPointerWrite = activationCommit.writes.find(
    (write: { update: { name: string } }) =>
      wireStore.path(write.update.name) === "runtime/activeRelease",
  );
  assert.deepEqual(activationWrite.currentDocument, { exists: false });
  assert.match(activationPointerWrite.currentDocument.updateTime, /^2026-/);
  assert.ok(same(wireStore.documents.get(activationPath(plan))?.fields, activationWrite.update.fields));
  const active = activePointer(rootOf(plan).data);
  assert.ok(same(wireStore.documents.get("runtime/activeRelease")?.fields, source("runtime/activeRelease", active).fields));
  await rollbackOwnerCategorySupplement(plan, api, "restore-q6000-http");
  const rollbackCommit = wireStore.commits.at(-1)!;
  const rollbackPointerWrite = rollbackCommit.writes.find(
    (write: { update: { name: string } }) =>
      wireStore.path(write.update.name) === "runtime/activeRelease",
  );
  const rollbackReceiptWrite = rollbackCommit.writes.find(
    (write: { update: { name: string } }) =>
      wireStore.path(write.update.name).startsWith("rollbackReceipts/"),
  );
  assert.match(rollbackPointerWrite.currentDocument.updateTime, /^2026-/);
  assert.deepEqual(rollbackReceiptWrite.currentDocument, { exists: false });
  assert.ok(same(wireStore.documents.get("runtime/activeRelease")?.fields, source("runtime/activeRelease", plan.base.pointer).fields));
  await assert.rejects(() => rollbackOwnerCategorySupplement(plan, api, "stale-http"), /Rollback CAS/);
});
test("actual production REST adapter aborts tampered authority, retained M05, missing children, and stale activation before pointer mutation", async () => {
  for (const mode of ["retained", "authority", "child"] as const) {
    const plan = syntheticPlan(), wireStore = new StatefulFirestoreFetch(plan);
    if (mode === "retained")
      wireStore.put(plan.retainedM05Documents[0]!.path, { immutable: false });
    if (mode === "authority")
      wireStore.put(plan.approvalDocuments[0]!.path, { immutable: false });
    if (mode === "child")
      wireStore.dropPath = plan.documents.find((document) => document.path.includes("/questions/"))!.path;
    const api = await createProductionOwnerCategorySupplementApi({ accessToken: async () => "test", fetch: wireStore.fetch.bind(wireStore) } as any);
    await assert.rejects(
      () => applyOwnerCategorySupplement(plan, api, async () => plan),
      /Retained M05|authority|immutable|child readback/i,
    );
    assert.equal(wireStore.documents.has(rootOf(plan).path), false, mode);
    assert.equal(wireStore.documents.has(verificationPath(plan)), false, mode);
    assert.equal(wireStore.documents.has(activationPath(plan)), false, mode);
    assert.ok(same(wireStore.documents.get("runtime/activeRelease")?.fields, source("runtime/activeRelease", plan.base.pointer).fields), mode);
  }

  const plan = syntheticPlan(), wireStore = new StatefulFirestoreFetch(plan);
  wireStore.stalePointerOnActivationCommit = true;
  const api = await createProductionOwnerCategorySupplementApi({ accessToken: async () => "test", fetch: wireStore.fetch.bind(wireStore) } as any);
  await assert.rejects(() => applyOwnerCategorySupplement(plan, api, async () => plan), /Firestore REST 409/);
  assert.ok(wireStore.documents.has(rootOf(plan).path));
  assert.ok(wireStore.documents.has(verificationPath(plan)));
  assert.equal(wireStore.documents.has(activationPath(plan)), false);
  assert.ok(same(wireStore.documents.get("runtime/activeRelease")?.fields, source("runtime/activeRelease", { releaseId: "concurrent-pointer" }).fields));
});
test("actual production REST authority subtree audit rejects retained-root drift before any create", async () => {
  for (const mode of ["missing", "altered", "extra-child"] as const) {
    const plan = syntheticPlan(), wireStore = new StatefulFirestoreFetch(plan);
    const chunk = plan.approvalDocuments.find((document) => document.path.endsWith("chunk-00001"))!;
    if (mode === "missing") wireStore.documents.delete(chunk.path);
    if (mode === "altered") wireStore.put(chunk.path, { immutable: false });
    if (mode === "extra-child") wireStore.put("contentOwnerApprovals/q6000/entries/unexpected", { immutable: true });
    const api = await createProductionOwnerCategorySupplementApi({ accessToken: async () => "test", fetch: wireStore.fetch.bind(wireStore) } as any);
    await assert.rejects(
      () => applyOwnerCategorySupplement(plan, api, async () => plan),
      /owner authority|authority subtree/i,
    );
    assert.equal(wireStore.commits.length, 0, mode);
    assert.equal(wireStore.documents.has(rootOf(plan).path), false, mode);
    assert.equal(wireStore.documents.has(verificationPath(plan)), false, mode);
    assert.equal(wireStore.documents.has(activationPath(plan)), false, mode);
    assert.ok(same(wireStore.documents.get("runtime/activeRelease")?.fields, source("runtime/activeRelease", plan.base.pointer).fields), mode);
  }
});
test("actual production REST authority subtree audit ignores an unrelated top-level approval root", async () => {
  const plan = syntheticPlan(), wireStore = new StatefulFirestoreFetch(plan);
  wireStore.put("contentOwnerApprovals/unrelated", { immutable: true, approvalState: "owner_approved" });
  const api = await createProductionOwnerCategorySupplementApi({ accessToken: async () => "test", fetch: wireStore.fetch.bind(wireStore) } as any);
  await applyOwnerCategorySupplement(plan, api, async () => plan);
  assert.equal((await verifyOwnerCategorySupplement(plan, api)).active, true);
  assert.ok(same(wireStore.documents.get("contentOwnerApprovals/unrelated")?.fields, source("contentOwnerApprovals/unrelated", { immutable: true, approvalState: "owner_approved" }).fields));
});
