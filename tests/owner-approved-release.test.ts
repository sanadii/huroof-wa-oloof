import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { SUPPORTED_LETTERS } from "../src/question-bank.js";
import { applyOwnerAuthorizedRelease, buildOwnerAuthorizedReleasePlan, decodeFirestoreValue, OWNER_APPROVAL_PATH, ownerApprovalEntries, rollbackOwnerAuthorizedReleaseToNone, SELECTED_USER_CATEGORY_IDS, verifyOwnerAuthorizedRelease, type FirestoreValue, type OwnerReleaseApi, type ReleaseDocument, type SourceDocument } from "../scripts/owner-approved-release.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const string = (value: string): FirestoreValue => ({ stringValue: value });
const bool = (value: boolean): FirestoreValue => ({ booleanValue: value });
const array = (values: FirestoreValue[]): FirestoreValue => ({ arrayValue: { values } });
const map = (fields: Record<string, FirestoreValue>): FirestoreValue => ({ mapValue: { fields } });

function source(index: number, categoryId: string, letter: string, options: { media?: boolean; duplicateOf?: number } = {}): SourceDocument {
  const contentHash = index.toString(16).padStart(64, "0");
  const question = options.duplicateOf === undefined ? `سؤال ${categoryId} ${index}` : `سؤال ${categoryId} ${options.duplicateOf}`;
  const answer = options.duplicateOf === undefined ? `${letter} إجابة ${index}` : `${letter} إجابة ${options.duplicateOf}`;
  return {
    name: `projects/huroof-a3ee7/databases/(default)/documents/questionImports/bundle/questions/${contentHash}`,
    updateTime: `2026-09-11T00:00:${String(index % 60).padStart(2, "0")}.000000Z`,
    fields: {
      recordKind: string("question"), inert: bool(true), contentHash: string(contentHash), bundleSha256: string("b".repeat(64)), rawCanonicalSha256: string("c".repeat(64)),
      sourceCategoryIdentifiers: array([string(categoryId)]), mediaRefs: options.media ? array([string("unbound-media")]) : array([]),
      raw: map({ category_id: string(categoryId), mode: string("trivia"), question: string(question), answer: string(answer), accepted_answers: array([string(answer)]) }),
      semantic: map({ sourceCategoryIdentifiers: array([string(categoryId)]), questionText: string(question), answerText: string(answer), acceptedAnswers: array([string(answer)]) }),
    },
  };
}

function completeFixture() {
  const rows: SourceDocument[] = [];
  let index = 1;
  for (const categoryId of SELECTED_USER_CATEGORY_IDS)
    for (const letter of SUPPORTED_LETTERS) rows.push(source(index++, categoryId, letter));
  rows.push(source(index++, SELECTED_USER_CATEGORY_IDS[0], "ا", { duplicateOf: 1 }));
  rows.push(source(index++, SELECTED_USER_CATEGORY_IDS[1], "ب", { media: true }));
  return rows.sort((left, right) => left.name.localeCompare(right.name));
}

test("owner release selects exact plain-text source values, dedupes, and proves both requested Categories and global Huroof selectors", () => {
  const rows = completeFixture();
  const plan = buildOwnerAuthorizedReleasePlan(rows, { snapshotCount: rows.length, snapshotSha256: hash(JSON.stringify(rows)), categoryIds: [...SELECTED_USER_CATEGORY_IDS], capturedAt: "2026-09-11T00:00:00.000Z" });
  assert.equal(plan.approvedCount, SUPPORTED_LETTERS.length * SELECTED_USER_CATEGORY_IDS.length);
  assert.equal(plan.readiness.selectedCategoryBoard.playable, true);
  assert.equal(plan.readiness.globalHuroof.playable, true);
  assert.equal(plan.readiness.categories["huroof-068"].categories.playable, true);
  assert.equal(plan.exclusions.exact_text_duplicate, 1);
  assert.equal(plan.exclusions.media_backed_or_missing_immutable_media, 1);
  const question = plan.documents.find((document) => document.path.includes("/questions/"));
  assert.equal(question?.data.modality, "classic");
  assert.equal(question?.data.targetLetter, "ا");
  assert.equal(question?.data.canonicalAnswer, "ا إجابة 1");
  assert.equal(question?.data.publicationAuthority, undefined);
});

test("owner release identity binds the selected runtime projection rather than a snapshot-prefix", () => {
  const original = completeFixture();
  const changed = structuredClone(original);
  (changed[0].fields.raw as { mapValue: { fields: Record<string, FirestoreValue> } }).mapValue.fields.answer = string("ا إجابة معدلة");
  (changed[0].fields.raw as { mapValue: { fields: Record<string, FirestoreValue> } }).mapValue.fields.accepted_answers = array([string("ا إجابة معدلة")]);
  (changed[0].fields.semantic as { mapValue: { fields: Record<string, FirestoreValue> } }).mapValue.fields.answerText = string("ا إجابة معدلة");
  (changed[0].fields.semantic as { mapValue: { fields: Record<string, FirestoreValue> } }).mapValue.fields.acceptedAnswers = array([string("ا إجابة معدلة")]);
  const options = (rows: SourceDocument[]) => ({ snapshotCount: rows.length, snapshotSha256: hash(JSON.stringify(rows)), categoryIds: [...SELECTED_USER_CATEGORY_IDS] });
  assert.notEqual(buildOwnerAuthorizedReleasePlan(original, options(original)).releaseId, buildOwnerAuthorizedReleasePlan(changed, options(changed)).releaseId);
});

test("Firestore REST decoder retains explicit nulls and fails closed for unknown values", () => {
  assert.equal(decodeFirestoreValue({ nullValue: null }), null);
  assert.deepEqual(decodeFirestoreValue({ mapValue: { fields: { answer: { stringValue: "جواب" }, accepted: { arrayValue: {} } } } }), { answer: "جواب", accepted: [] });
  assert.throws(() => decodeFirestoreValue({ bytesValue: "not-supported" }), /Unsupported Firestore REST value/);
});

const encode = (value: unknown): FirestoreValue => value === null ? { nullValue: null } : typeof value === "string" ? string(value) : typeof value === "boolean" ? bool(value) : typeof value === "number" ? { integerValue: String(value) } : Array.isArray(value) ? array(value.map(encode)) : map(Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, encode(child)])));
const releaseSource = (document: ReleaseDocument): SourceDocument => ({ name: `projects/huroof-a3ee7/databases/(default)/documents/${document.path}`, updateTime: "2026-09-11T00:00:00.000000Z", fields: Object.fromEntries(Object.entries(document.data).map(([key, value]) => [key, encode(value)])) });

test("apply fails closed on owner-source drift before any release write", async () => {
  const snapshotPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../firebase-activation-20260911/approval-question-backup.json");
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as SourceDocument[];
  const plan = buildOwnerAuthorizedReleasePlan(snapshot);
  const sources = new Map(snapshot.map((document) => [document.name.split("/documents/")[1], structuredClone(document)]));
  const bindings = snapshot.map((document) => ({ path: document.name.split("/documents/")[1], contentHash: String((document.fields.contentHash as { stringValue: string }).stringValue), bundleSha256: String((document.fields.bundleSha256 as { stringValue: string }).stringValue), rawCanonicalSha256: String((document.fields.rawCanonicalSha256 as { stringValue: string }).stringValue), recordKind: "question", updateTime: document.updateTime }));
  const approval = new Map<string, SourceDocument>();
  approval.set(OWNER_APPROVAL_PATH, releaseSource({ path: OWNER_APPROVAL_PATH, data: { approvalState: "owner_approved", manifestComplete: true, releaseActivated: false, sourceSnapshotSha256: plan.sourceSnapshotSha256, sourceSnapshotDocumentCount: plan.sourceSnapshotCount, projectId: "huroof-a3ee7", databaseId: "(default)" } }));
  for (const entry of ownerApprovalEntries(bindings, String(plan.documents.find((document) => document.path === `releases/${plan.releaseId}`)?.data.asOf))) approval.set(entry.path, releaseSource(entry));
  const first = sources.values().next().value as SourceDocument;
  (first.fields.contentHash as { stringValue: string }).stringValue = "f".repeat(64);
  let writes = 0;
  const api: OwnerReleaseApi = {
    getDatabaseMetadata: async () => ({ projectId: "huroof-a3ee7", databaseId: "(default)", locationId: "me-central2", type: "FIRESTORE_NATIVE" }),
    batchGet: async (paths) => paths.map((path) => sources.get(path) ?? approval.get(path)),
    create: async () => { writes += 1; },
    listCollectionIds: async () => [], listCollection: async (path) => path.includes("questionImports/") ? [...sources.values()] : [], activateIfNoPointer: async () => { throw new Error("must not activate"); },
  };
  const altered = { ...plan, documents: plan.documents.map((document, index) => index === 0 ? { ...document, data: { ...document.data, altered: true } } : document) };
  await assert.rejects(applyOwnerAuthorizedRelease(altered, snapshot, api), /deterministic owner-authority rebuild/i);
  assert.equal(writes, 0);
  await assert.rejects(applyOwnerAuthorizedRelease(plan, snapshot, api), /source drifted/i);
  assert.equal(writes, 0);
});

function fullAuthorityApi(snapshot: SourceDocument[], plan: ReturnType<typeof buildOwnerAuthorizedReleasePlan>, failCreateAt?: number) {
  const docs = new Map(snapshot.map((document) => [document.name.split("/documents/")[1], structuredClone(document)]));
  const bindings = snapshot.map((document) => ({ path: document.name.split("/documents/")[1], contentHash: (document.fields.contentHash as { stringValue: string }).stringValue, bundleSha256: (document.fields.bundleSha256 as { stringValue: string }).stringValue, rawCanonicalSha256: (document.fields.rawCanonicalSha256 as { stringValue: string }).stringValue, recordKind: "question", updateTime: document.updateTime }));
  const root = plan.documents.find((document) => document.path === `releases/${plan.releaseId}`)!;
  docs.set(OWNER_APPROVAL_PATH, releaseSource({ path: OWNER_APPROVAL_PATH, data: { approvalState: "owner_approved", manifestComplete: true, releaseActivated: false, sourceSnapshotSha256: plan.sourceSnapshotSha256, sourceSnapshotDocumentCount: plan.sourceSnapshotCount, projectId: "huroof-a3ee7", databaseId: "(default)" } }));
  for (const entry of ownerApprovalEntries(bindings, String(root.data.asOf))) docs.set(entry.path, releaseSource(entry));
  let creates = 0;
  const api: OwnerReleaseApi = {
    getDatabaseMetadata: async () => ({ projectId: "huroof-a3ee7", databaseId: "(default)", locationId: "me-central2", type: "FIRESTORE_NATIVE" }),
    batchGet: async (paths) => paths.map((path) => docs.get(path)),
    create: async (items) => { creates += 1; if (failCreateAt === creates) throw new Error("simulated partial publish failure"); for (const item of items) { if (docs.has(item.path)) throw new Error(`duplicate ${item.path}`); docs.set(item.path, releaseSource(item)); } },
    listCollectionIds: async (path) => path === root.path ? [...new Set([...docs.keys()].filter((key) => key.startsWith(`${path}/`)).map((key) => key.slice(path.length + 1).split("/")[0]))] : [],
    listCollection: async (path) => [...docs.entries()].filter(([key]) => key.startsWith(`${path}/`) && key.slice(path.length + 1).split("/").length === 1).map(([, document]) => document),
    activateIfNoPointer: async ({ verificationReceipt, pointer, activationReceipt }) => { if (docs.has(pointer.path) || docs.has(activationReceipt.path) || !docs.has(verificationReceipt.path)) throw new Error("pointer conflict"); docs.set(pointer.path, releaseSource(pointer)); docs.set(activationReceipt.path, releaseSource(activationReceipt)); },
    rollbackToNone: async ({ pointer, rollbackReceipt }) => { const current = docs.get(pointer.path); if (!current || JSON.stringify(current.fields) !== JSON.stringify(releaseSource(pointer).fields) || docs.has(rollbackReceipt.path)) throw new Error("rollback CAS mismatch"); docs.delete(pointer.path); docs.set(rollbackReceipt.path, releaseSource(rollbackReceipt)); },
  };
  return { api, docs, setFail: (value?: number) => { failCreateAt = value; } };
}

test("publisher resumes a partial create, verifies immutable barrier, rejects unknown catalog content, and CAS-rolls back only the pointer", async () => {
  const snapshotPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../firebase-activation-20260911/approval-question-backup.json");
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as SourceDocument[];
  const plan = buildOwnerAuthorizedReleasePlan(snapshot);
  const fake = fullAuthorityApi(snapshot, plan, 2);
  await assert.rejects(applyOwnerAuthorizedRelease(plan, snapshot, fake.api), /partial publish failure/);
  fake.setFail(undefined);
  await applyOwnerAuthorizedRelease(plan, snapshot, fake.api);
  assert.deepEqual(await verifyOwnerAuthorizedRelease(plan, fake.api), { releaseId: plan.releaseId, documentCount: plan.documents.length, active: true });
  const active = structuredClone(fake.docs.get("runtime/activeRelease")!);
  (fake.docs.get("runtime/activeRelease")!.fields.releaseId as { stringValue: string }).stringValue = "conflicting-release";
  await assert.rejects(applyOwnerAuthorizedRelease(plan, snapshot, fake.api), /activation receipt conflicts/i);
  fake.docs.set("runtime/activeRelease", active);
  const rogue: ReleaseDocument = { path: `releases/${plan.releaseId}/unknownCatalog/x`, data: { immutable: true } };
  fake.docs.set(rogue.path, releaseSource(rogue));
  await assert.rejects(verifyOwnerAuthorizedRelease(plan, fake.api), /unknown or missing subcollections/);
  fake.docs.delete(rogue.path);
  await rollbackOwnerAuthorizedReleaseToNone(plan, fake.api, "test-rollback");
  assert.equal(fake.docs.has("runtime/activeRelease"), false);
  assert.ok(fake.docs.has(`releases/${plan.releaseId}`));
});
