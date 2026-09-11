/**
 * Owner-authorized production release path for the immutable question-intake
 * snapshot.  This is intentionally separate from firestore-release-publisher:
 * it records owner approval provenance and never presents it as an expert
 * review or a signed-review release.
 *
 * prepare: deterministic local plan only
 * apply: exact cloud source readback, create-only children, root last, then
 *        a compare-and-create active pointer when no active release exists
 * verify: exact recursive release enumeration and pointer/readback audit
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { answerInitial, normalizeArabic, SUPPORTED_LETTERS } from "../src/question-bank.js";
import { createCategoryQuestionSelection, createMatchQuestionSelection, type RuntimeQuestionV32 } from "../src/features/game/runtime/question-selector.js";
import { sourceCategoryRegistry } from "./source-category-crosswalk.js";
import { canonicalJson, SAFE_DOCUMENT_ID } from "./firestore-release-canonical.js";
import { MAX_BATCH_DOCUMENTS, MAX_BATCH_BYTES, PRODUCTION_DATABASE, PRODUCTION_LOCATION, PRODUCTION_PROJECT, chunkReleaseDocuments } from "./firestore-release-publisher.js";

export const OWNER_SNAPSHOT_SHA256 = "072dd09e41e2eaf652db75c9d5216d7515b5a7aff11fba180f864df118363180";
export const OWNER_SNAPSHOT_COUNT = 18_698;
export const OWNER_APPROVAL_RUN_ID = `owner-approval-${OWNER_SNAPSHOT_SHA256}`;
export const OWNER_APPROVAL_PATH = `contentOwnerApprovals/${OWNER_APPROVAL_RUN_ID}`;
/** The owner approved the complete immutable intake; these are regression cases, not the scope. */
export const DEFAULT_CATEGORY_IDS = sourceCategoryRegistry.categories.map((category) => category.sourceCategoryId);
export const SELECTED_USER_CATEGORY_IDS = ["huroof-068", "huroof-069", "huroof-088"] as const;
const OWNER_RELEASE_SCHEMA = "owner-authorized-text-release-v1";
const sourceLabels = Object.fromEntries(sourceCategoryRegistry.categories.map((category) => [category.sourceCategoryId, category.sourceTitleAr])) as Record<string, string>;

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type FirestoreValue = Record<string, unknown>;
export type SourceDocument = { name: string; updateTime: string; fields: Record<string, FirestoreValue> };
export type DecodedSourceDocument = { path: string; updateTime: string; data: Record<string, unknown>; raw: SourceDocument };
export type ReleaseDocument = { path: string; data: Record<string, unknown> };
export type OwnerReleasePlan = {
  schemaVersion: typeof OWNER_RELEASE_SCHEMA;
  releaseId: string;
  sourceSnapshotSha256: string;
  sourceSnapshotCount: number;
  ownerApprovalPath: string;
  categoryIds: string[];
  approvedCount: number;
  approvedSourceBindingsSha256: string;
  catalogSha256: string;
  documentRootSha256: string;
  sourceManifestSha256: string;
  documents: ReleaseDocument[];
  readiness: {
    categories: Record<string, { selected: number; uniqueConcepts: number; huroof: { playable: boolean; detail: string }; categories: { playable: boolean; detail: string } }>;
    selectedCategoryBoard: { playable: boolean; detail: string };
    globalHuroof: { playable: boolean; detail: string };
  };
  exclusions: Record<string, number>;
};
export type OwnerReleaseApi = {
  getDatabaseMetadata(): Promise<{ projectId: string; databaseId: string; locationId: string; type: string }>;
  batchGet(paths: string[]): Promise<Array<SourceDocument | undefined>>;
  create(documents: ReleaseDocument[]): Promise<void>;
  listCollectionIds(path: string): Promise<string[]>;
  listCollection(path: string): Promise<SourceDocument[]>;
  activateIfNoPointer(request: { root: ReleaseDocument; verificationReceipt: ReleaseDocument; pointer: ReleaseDocument; activationReceipt: ReleaseDocument }): Promise<void>;
  rollbackToNone?(request: { pointer: ReleaseDocument; rollbackReceipt: ReleaseDocument }): Promise<void>;
};

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const stableEqual = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const sourcePath = (name: string) => {
  const marker = "/documents/";
  const index = name.indexOf(marker);
  if (index < 0) throw new Error("Firestore source document has an invalid name.");
  return name.slice(index + marker.length);
};
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asString = (...values: unknown[]) => values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? "";
const asStrings = (...values: unknown[]) => [...new Set(values.flatMap((value) => Array.isArray(value) ? value : []).filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()))].sort();
const normalized = (value: string) => normalizeArabic(value);

/** Decodes only Firestore REST values; unknown encodings fail closed. */
export function decodeFirestoreValue(value: FirestoreValue): unknown {
  if (Object.hasOwn(value, "nullValue")) return null;
  if (typeof value.stringValue === "string") return value.stringValue;
  if (typeof value.booleanValue === "boolean") return value.booleanValue;
  if (typeof value.integerValue === "string" && /^-?\d+$/.test(value.integerValue)) return Number(value.integerValue);
  if (typeof value.doubleValue === "number") return value.doubleValue;
  if (value.arrayValue && typeof value.arrayValue === "object") {
    const values = (value.arrayValue as { values?: FirestoreValue[] }).values ?? [];
    return values.map((entry) => decodeFirestoreValue(entry));
  }
  if (value.mapValue && typeof value.mapValue === "object") {
    const fields = (value.mapValue as { fields?: Record<string, FirestoreValue> }).fields ?? {};
    return Object.fromEntries(Object.entries(fields).map(([key, entry]) => [key, decodeFirestoreValue(entry)]));
  }
  throw new Error("Unsupported Firestore REST value in owner-approved source.");
}

export function decodeSourceDocument(document: SourceDocument): DecodedSourceDocument {
  if (!document || typeof document.name !== "string" || typeof document.updateTime !== "string" || !document.updateTime)
    throw new Error("Owner-approved source lacks name or immutable updateTime.");
  return { path: sourcePath(document.name), updateTime: document.updateTime, data: Object.fromEntries(Object.entries(document.fields ?? {}).map(([key, value]) => [key, decodeFirestoreValue(value)])), raw: document };
}

function sourceBinding(document: DecodedSourceDocument) {
  const parts = document.path.split("/");
  const data = document.data;
  if (parts.length !== 4 || parts[0] !== "questionImports" || parts[2] !== "questions" || data.recordKind !== "question")
    throw new Error(`Snapshot contains a non-question source: ${document.path}.`);
  const contentHash = data.contentHash;
  const bundleSha256 = data.bundleSha256;
  const rawCanonicalSha256 = data.rawCanonicalSha256;
  if (![contentHash, bundleSha256, rawCanonicalSha256].every((value) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value)))
    throw new Error(`Snapshot source binding is incomplete: ${document.path}.`);
  return { path: document.path, contentHash, bundleSha256, rawCanonicalSha256, recordKind: "question", updateTime: document.updateTime };
}

function assertSnapshot(documents: SourceDocument[], expected = { sha256: OWNER_SNAPSHOT_SHA256, count: OWNER_SNAPSHOT_COUNT }) {
  const raw = JSON.stringify(documents);
  if (hash(raw) !== expected.sha256 || documents.length !== expected.count)
    throw new Error("Snapshot bytes or document count do not match the owner-approved authority.");
  const decoded = documents.map(decodeSourceDocument);
  const bindings = decoded.map(sourceBinding);
  if (new Set(bindings.map((binding) => binding.path)).size !== bindings.length || bindings.some((binding, index) => index > 0 && binding.path <= bindings[index - 1].path))
    throw new Error("Owner-approved snapshot bindings are not strictly sorted and unique.");
  return { decoded, bindings, raw };
}

function fieldCandidates(values: unknown[]) {
  const nonempty = values.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim());
  return [...new Map(nonempty.map((value) => [normalized(value), value])).values()];
}

function selectedQuestion(source: DecodedSourceDocument, categoryId: string): { question?: RuntimeQuestionV32; exclusion?: string } {
  const data = source.data;
  const raw = asRecord(data.raw), semantic = asRecord(data.semantic);
  if (data.inert !== true || data.recordKind !== "question") return { exclusion: "not_inert_question" };
  const declaredCategories = asStrings(data.sourceCategoryIdentifiers, semantic.sourceCategoryIdentifiers, raw.category_id, raw.categoryId);
  if (declaredCategories.length !== 1 || declaredCategories[0] !== categoryId) return { exclusion: "unmapped_or_cross_category" };
  if (!Array.isArray(data.mediaRefs) || data.mediaRefs.length !== 0) return { exclusion: "media_backed_or_missing_immutable_media" };
  const mode = asString(raw.mode, raw.modality).toLowerCase();
  if (mode && mode !== "trivia" && mode !== "classic") return { exclusion: "non_text_modality" };
  const prompts = fieldCandidates([raw.question, raw.questionText, semantic.questionText]);
  const answers = fieldCandidates([raw.answer, raw.answerText, semantic.answerText]);
  if (prompts.length !== 1) return { exclusion: prompts.length ? "conflicting_question_text" : "missing_question_text" };
  if (answers.length !== 1) return { exclusion: answers.length ? "conflicting_literal_answer" : "missing_literal_answer" };
  const answer = answers[0];
  const targetLetter = answerInitial(answer, true);
  if (!SUPPORTED_LETTERS.includes(targetLetter as typeof SUPPORTED_LETTERS[number])) return { exclusion: "literal_answer_has_no_supported_letter" };
  const acceptedAnswers = asStrings(raw.accepted_answers, raw.acceptedAnswers, semantic.acceptedAnswers);
  const canonicalAccepted = acceptedAnswers.length ? acceptedAnswers : [answer];
  if (!canonicalAccepted.some((candidate) => normalized(candidate) === normalized(answer)) || canonicalAccepted.some((candidate) => !normalized(candidate)))
    return { exclusion: "invalid_accepted_answers" };
  const contentHash = data.contentHash;
  if (typeof contentHash !== "string" || !/^[a-f0-9]{64}$/i.test(contentHash)) return { exclusion: "invalid_content_hash" };
  return { question: {
    id: contentHash,
    categoryId,
    modality: "classic",
    targetLetter,
    answerConceptId: hash(normalized(answer)),
    headerAr: sourceLabels[categoryId],
    promptAr: prompts[0],
    canonicalAnswer: answer,
    acceptedAnswers: canonicalAccepted,
  } };
}

function readiness(questions: RuntimeQuestionV32[], categoryIds: string[]) {
  const result: OwnerReleasePlan["readiness"] = { categories: {}, selectedCategoryBoard: { playable: false, detail: "not run" }, globalHuroof: { playable: false, detail: "not run" } };
  const run = (action: () => unknown) => { try { action(); return { playable: true, detail: "runtime selector passed" }; } catch (error) { return { playable: false, detail: error instanceof Error ? error.message : String(error) }; } };
  for (const categoryId of categoryIds) {
    const scoped = questions.filter((question) => question.categoryId === categoryId);
    const partners = categoryIds.filter((id) => id !== categoryId);
    result.categories[categoryId] = {
      selected: scoped.length,
      uniqueConcepts: new Set(scoped.map((question) => question.answerConceptId)).size,
      huroof: run(() => createMatchQuestionSelection(questions, { categories: [categoryId], modality: "classic", seed: 1, reservePerLetter: 3 })),
      categories: run(() => {
        const partner = partners.find((id) => {
          try { createCategoryQuestionSelection(questions, { categories: [categoryId, id], modality: "classic", seed: 1 }); return true; } catch { return false; }
        });
        if (!partner) throw new Error("No legal two-category board partner passed the runtime selector.");
      }),
    };
  }
  const requested = SELECTED_USER_CATEGORY_IDS.filter((id) => categoryIds.includes(id));
  result.selectedCategoryBoard = run(() => {
    if (requested.length !== SELECTED_USER_CATEGORY_IDS.length) throw new Error("A requested owner-selected category has no technically valid text questions.");
    createCategoryQuestionSelection(questions, { categories: requested, modality: "classic", seed: 1 });
  });
  result.globalHuroof = run(() => createMatchQuestionSelection(questions, { categories: categoryIds, modality: "classic", seed: 1, reservePerLetter: 3 }));
  return result;
}

function docsHash(documents: ReleaseDocument[]) {
  return hash(canonicalJson(documents.slice().sort((left, right) => left.path.localeCompare(right.path)).map(({ path, data }) => ({ path, data }))));
}

/** Builds an immutable release only from exact owner-approved snapshot bytes. */
export function buildOwnerAuthorizedReleasePlan(snapshot: SourceDocument[], options: { snapshotSha256?: string; snapshotCount?: number; categoryIds?: string[]; capturedAt?: string } = {}): OwnerReleasePlan {
  const requestedScope = [...new Set(options.categoryIds ?? DEFAULT_CATEGORY_IDS)].sort();
  if (!requestedScope.length || requestedScope.some((id) => !sourceLabels[id]))
    throw new Error("Owner-authorized release scope contains an unknown source category identity.");
  const expected = { sha256: options.snapshotSha256 ?? OWNER_SNAPSHOT_SHA256, count: options.snapshotCount ?? OWNER_SNAPSHOT_COUNT };
  const { decoded, bindings } = assertSnapshot(snapshot, expected);
  const exclusions: Record<string, number> = {};
  const candidates: Array<{ question: RuntimeQuestionV32; binding: ReturnType<typeof sourceBinding> }> = [];
  for (const source of decoded) {
    const declared = asStrings(source.data.sourceCategoryIdentifiers, asRecord(source.data.raw).category_id, asRecord(source.data.raw).categoryId);
    const categoryId = declared.length === 1 ? declared[0] : "";
    if (declared.length !== 1) { exclusions.unmapped_or_ambiguous_category = (exclusions.unmapped_or_ambiguous_category ?? 0) + 1; continue; }
    if (!requestedScope.includes(categoryId)) { exclusions.outside_owner_category_registry = (exclusions.outside_owner_category_registry ?? 0) + 1; continue; }
    const selected = selectedQuestion(source, categoryId);
    if (!selected.question) { exclusions[selected.exclusion ?? "unknown"] = (exclusions[selected.exclusion ?? "unknown"] ?? 0) + 1; continue; }
    candidates.push({ question: selected.question, binding: sourceBinding(source) });
  }
  const chosen: Array<{ question: RuntimeQuestionV32; binding: ReturnType<typeof sourceBinding> }> = [];
  const seen = new Set<string>();
  for (const candidate of candidates.sort((left, right) => left.question.id.localeCompare(right.question.id))) {
    const key = `${candidate.question.categoryId}\u0000${normalized(candidate.question.promptAr)}\u0000${normalized(candidate.question.canonicalAnswer)}`;
    if (seen.has(key)) { exclusions.exact_text_duplicate = (exclusions.exact_text_duplicate ?? 0) + 1; continue; }
    seen.add(key); chosen.push(candidate);
  }
  const questions = chosen.map(({ question }) => question);
  const categoryIds = [...new Set(questions.map((question) => question.categoryId))].sort();
  if (categoryIds.length < 2) throw new Error("Owner-approved corpus has fewer than two technically playable source categories.");
  const approvedSourceBindings = chosen.map(({ binding }) => binding).sort((left, right) => left.path.localeCompare(right.path));
  const approvedSourceBindingsSha256 = hash(canonicalJson(approvedSourceBindings));
  const runtimeProjectionSha256 = hash(canonicalJson(questions));
  const releaseId = `owner-release-${hash(canonicalJson({ schemaVersion: OWNER_RELEASE_SCHEMA, sourceSnapshotSha256: expected.sha256, categoryIds, approvedSourceBindingsSha256, runtimeProjectionSha256 })).slice(0, 32)}`;
  const catalog = categoryIds.map((id) => ({ path: `releases/${releaseId}/catalogCategories/${id}`, data: { id, labelAr: sourceLabels[id], runtimeScope: OWNER_RELEASE_SCHEMA, immutable: true } }));
  const questionDocuments = questions.map((question) => ({ path: `releases/${releaseId}/questions/${question.id}`, data: { ...question, sourceContentHash: question.id, immutable: true } }));
  const inventory = categoryIds.map((categoryId) => ({ path: `releases/${releaseId}/inventory/${categoryId}`, data: { categoryId, approvedCount: questions.filter((question) => question.categoryId === categoryId).length, uniqueAnswerConceptCount: new Set(questions.filter((question) => question.categoryId === categoryId).map((question) => question.answerConceptId)).size, immutable: true } }));
  const documentRootSha256 = docsHash([...catalog, ...questionDocuments, ...inventory]);
  const sourceManifestSha256 = hash(canonicalJson({ ownerApprovalRunId: OWNER_APPROVAL_RUN_ID, sourceSnapshotSha256: expected.sha256, sourceSnapshotCount: expected.count, categoryIds, approvedSourceBindingsSha256 }));
  const root: ReleaseDocument = { path: `releases/${releaseId}`, data: {
    schemaVersion: OWNER_RELEASE_SCHEMA,
    releaseId,
    immutable: true,
    publicationAuthority: "owner_approval",
    ownerApprovalPath: OWNER_APPROVAL_PATH,
    ownerApprovalRunId: OWNER_APPROVAL_RUN_ID,
    sourceSnapshotSha256: expected.sha256,
    sourceSnapshotCount: expected.count,
    sourceManifestSha256,
    approvedSourceBindingsSha256,
    approvedCount: questions.length,
    catalogSha256: docsHash(catalog),
    documentRootSha256,
    asOf: options.capturedAt ?? "2026-09-11T00:00:00.000Z",
    selectionPolicy: "exact owner-approved source versions; plain text only; source answers preserved; target letter deterministically derived from the literal answer",
  } };
  const plan: OwnerReleasePlan = { schemaVersion: OWNER_RELEASE_SCHEMA, releaseId, sourceSnapshotSha256: expected.sha256, sourceSnapshotCount: expected.count, ownerApprovalPath: OWNER_APPROVAL_PATH, categoryIds, approvedCount: questions.length, approvedSourceBindingsSha256, catalogSha256: docsHash(catalog), documentRootSha256, sourceManifestSha256, documents: [...catalog, ...questionDocuments, ...inventory, root], readiness: readiness(questions, categoryIds), exclusions };
  if (!plan.readiness.selectedCategoryBoard.playable) throw new Error(`Requested category board is not playable: ${plan.readiness.selectedCategoryBoard.detail}`);
  if (!plan.readiness.globalHuroof.playable) throw new Error(`Global Huroof board is not playable: ${plan.readiness.globalHuroof.detail}`);
  return plan;
}

function rootDocument(plan: OwnerReleasePlan) {
  const root = plan.documents.find((document) => document.path === `releases/${plan.releaseId}`);
  if (!root) throw new Error("Owner release plan lacks its root document.");
  return root;
}
function childDocuments(plan: OwnerReleasePlan) { return plan.documents.filter((document) => document.path !== `releases/${plan.releaseId}`); }
function pointerDocuments(plan: OwnerReleasePlan) {
  const root = rootDocument(plan);
  const base = { releaseId: plan.releaseId, approvedCount: plan.approvedCount, catalogSha256: plan.catalogSha256, documentRootSha256: plan.documentRootSha256, sourceManifestSha256: plan.sourceManifestSha256, ownerApprovalPath: plan.ownerApprovalPath, publicationAuthority: "owner_approval" };
  const pointer = { path: "runtime/activeRelease", data: base };
  const verificationReceipt = { path: `ownerReleaseVerificationReceipts/${plan.releaseId}-${plan.documentRootSha256}`, data: { ...base, rootPath: root.path, sourceSnapshotSha256: plan.sourceSnapshotSha256, approvedSourceBindingsSha256: plan.approvedSourceBindingsSha256, verificationKind: "owner_authority_exact_readback", immutable: true } };
  const activationReceipt = { path: `activationReceipts/${plan.releaseId}-owner-approved`, data: { ...base, rootPath: root.path, immutable: true, expectedPreviousReleaseId: null } };
  return { pointer, verificationReceipt, activationReceipt };
}

function assertPlanShape(plan: OwnerReleasePlan) {
  if (plan.schemaVersion !== OWNER_RELEASE_SCHEMA || plan.sourceSnapshotSha256 !== OWNER_SNAPSHOT_SHA256 || plan.sourceSnapshotCount !== OWNER_SNAPSHOT_COUNT || plan.ownerApprovalPath !== OWNER_APPROVAL_PATH || !plan.readiness.selectedCategoryBoard.playable)
    throw new Error("Owner release plan is not bound to the production owner-approval authority.");
  const root = rootDocument(plan);
  if (root.data.documentRootSha256 !== plan.documentRootSha256 || root.data.approvedCount !== plan.approvedCount) throw new Error("Owner release root does not bind its plan identity.");
  for (const document of plan.documents) {
    const segments = document.path.split("/");
    if (!segments.length || segments.length % 2 || segments.some((segment) => !SAFE_DOCUMENT_ID.test(segment))) throw new Error(`Unsafe owner-release document path: ${document.path}.`);
  }
}

function assertOwnerManifest(document: SourceDocument | undefined) {
  if (!document) throw new Error("Owner approval manifest is absent.");
  const data = decodeSourceDocument(document).data;
  if (data.approvalState !== "owner_approved" || data.manifestComplete !== true || data.releaseActivated !== false || data.sourceSnapshotSha256 !== OWNER_SNAPSHOT_SHA256 || data.sourceSnapshotDocumentCount !== OWNER_SNAPSHOT_COUNT || data.projectId !== PRODUCTION_PROJECT || data.databaseId !== PRODUCTION_DATABASE)
    throw new Error("Owner approval manifest differs from the pinned authority.");
}

function chunksOf<T>(items: T[], size: number) { return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size)); }
export function ownerApprovalEntries(bindings: ReturnType<typeof sourceBinding>[], capturedAt: string) {
  const sourceRoot = bindings[0].path.split("/").slice(0, 2).join("/");
  return chunksOf(bindings, 100).map((sourceBindings, index) => {
    const chunkId = `chunk-${String(index + 1).padStart(5, "0")}`;
    return { path: `${OWNER_APPROVAL_PATH}/entries/${chunkId}`, data: {
      schemaVersion: "content-owner-approval-audit-v1", runId: OWNER_APPROVAL_RUN_ID, approvalState: "owner_approved", approvalEffect: "pending_manifest", scope: "owner_approval_only", releaseActivated: false,
      actorKind: "owner", actorSource: "user instruction in Codex", signerIdentity: null, userInstruction: "approve all the questions we have in the db", sourceSnapshotSha256: OWNER_SNAPSHOT_SHA256,
      sourceSnapshotCapturedAt: capturedAt, projectId: PRODUCTION_PROJECT, databaseId: PRODUCTION_DATABASE, sourceRoot, sourceBindingCount: sourceBindings.length, sourceBindingsSha256: hash(canonicalJson(sourceBindings)), sourceBindings,
    } };
  });
}

/** Reads all 18,698 exact source versions and every owner-approval chunk before any root/pointer transition. */
async function assertRemoteOwnerAuthority(plan: OwnerReleasePlan, snapshot: SourceDocument[], api: OwnerReleaseApi) {
  const { decoded, bindings } = assertSnapshot(snapshot);
  const [manifest] = await api.batchGet([OWNER_APPROVAL_PATH]);
  assertOwnerManifest(manifest);
  const sourceCollection = `${bindings[0].path.split("/").slice(0, 2).join("/")}/questions`;
  const inventory = await api.listCollection(sourceCollection);
  const expectedPaths = decoded.map((document) => document.path).sort();
  const actualPaths = inventory.map((document) => sourcePath(document.name)).sort();
  if (!stableEqual(actualPaths, expectedPaths)) throw new Error("Current question-import inventory differs from the owner-approved snapshot.");
  for (const chunk of chunksOf(decoded, MAX_BATCH_DOCUMENTS)) {
    const actual = await api.batchGet(chunk.map((document) => document.path));
    for (let index = 0; index < chunk.length; index += 1)
      if (!actual[index] || !stableEqual(actual[index], chunk[index].raw)) throw new Error(`Owner-approved source drifted or is absent: ${chunk[index].path}.`);
  }
  const entries = ownerApprovalEntries(bindings, String(rootDocument(plan).data.asOf));
  for (const chunk of chunksOf(entries, MAX_BATCH_DOCUMENTS)) {
    const actual = await api.batchGet(chunk.map((entry) => entry.path));
    for (let index = 0; index < chunk.length; index += 1)
      if (!actual[index] || !stableEqual(decodeSourceDocument(actual[index]!).data, chunk[index].data)) throw new Error(`Owner-approval entry differs: ${chunk[index].path}.`);
  }
}

async function pendingCreates(api: OwnerReleaseApi, documents: ReleaseDocument[]) {
  const pending: ReleaseDocument[] = [];
  for (let offset = 0; offset < documents.length; offset += MAX_BATCH_DOCUMENTS) {
    const chunk = documents.slice(offset, offset + MAX_BATCH_DOCUMENTS);
    const stored = await api.batchGet(chunk.map((document) => document.path));
    for (let index = 0; index < chunk.length; index += 1) {
      const current = stored[index];
      if (!current) { pending.push(chunk[index]); continue; }
      if (!stableEqual(decodeSourceDocument(current).data, chunk[index].data)) throw new Error(`Immutable owner-release conflict: ${chunk[index].path}.`);
    }
  }
  return pending;
}

async function assertExactReleaseChildren(plan: OwnerReleasePlan, api: OwnerReleaseApi) {
  const root = rootDocument(plan);
  const allowed = ["catalogCategories", "inventory", "questions"];
  const collectionIds = (await api.listCollectionIds(root.path)).sort();
  if (!stableEqual(collectionIds, allowed)) throw new Error(`Owner release child prefix has unknown or missing subcollections: ${collectionIds.join(",")}.`);
  const expected = new Map(childDocuments(plan).map((document) => [document.path, document.data]));
  const actual = new Map<string, Record<string, unknown>>();
  for (const collectionId of allowed)
    for (const document of await api.listCollection(`${root.path}/${collectionId}`)) actual.set(sourcePath(document.name), decodeSourceDocument(document).data);
  const missing = [...expected.keys()].filter((path) => !actual.has(path));
  const extra = [...actual.keys()].filter((path) => !expected.has(path));
  const mismatch = [...expected].filter(([path, data]) => !stableEqual(actual.get(path), data)).map(([path]) => path);
  if (missing.length || extra.length || mismatch.length) throw new Error(`Owner release child audit failed (missing: ${missing.join(",") || "none"}; extra: ${extra.join(",") || "none"}; mismatched: ${mismatch.join(",") || "none"}).`);
}

/** Cloud mutation path. It is idempotent for equal create-only documents. */
export async function applyOwnerAuthorizedRelease(plan: OwnerReleasePlan, snapshot: SourceDocument[], api: OwnerReleaseApi) {
  assertPlanShape(plan);
  const rebuilt = buildOwnerAuthorizedReleasePlan(snapshot, { capturedAt: String(rootDocument(plan).data.asOf) });
  if (!stableEqual(plan, rebuilt)) throw new Error("Owner release plan differs from the deterministic owner-authority rebuild.");
  const metadata = await api.getDatabaseMetadata();
  if (metadata.projectId !== PRODUCTION_PROJECT || metadata.databaseId !== PRODUCTION_DATABASE || metadata.locationId !== PRODUCTION_LOCATION || metadata.type !== "FIRESTORE_NATIVE") throw new Error("Owner release target is not pinned huroof-a3ee7/(default)/me-central2 Firestore Native.");
  await assertRemoteOwnerAuthority(plan, snapshot, api);
  const pendingChildren = await pendingCreates(api, childDocuments(plan));
  for (const chunk of chunkReleaseDocuments(pendingChildren, MAX_BATCH_DOCUMENTS, MAX_BATCH_BYTES)) {
    await api.create(chunk);
    const readback = await api.batchGet(chunk.map((document) => document.path));
    if (readback.some((document, index) => !document || !stableEqual(decodeSourceDocument(document).data, chunk[index].data))) throw new Error("Owner release child create readback differs.");
  }
  // Full recursive child-prefix audit is required before the immutable root exists.
  await assertExactReleaseChildren(plan, api);
  // The immutable root is a completion marker: it is written only after all children.
  const pendingRoot = await pendingCreates(api, [rootDocument(plan)]);
  if (pendingRoot.length) await api.create(pendingRoot);
  const [rootReadback] = await api.batchGet([rootDocument(plan).path]);
  if (!rootReadback || !stableEqual(decodeSourceDocument(rootReadback).data, rootDocument(plan).data)) throw new Error("Owner release root create readback differs.");
  // Recheck the complete owner authority immediately before the final pointer transition.
  await assertRemoteOwnerAuthority(plan, snapshot, api);
  const { pointer, verificationReceipt, activationReceipt } = pointerDocuments(plan);
  const pendingVerification = await pendingCreates(api, [verificationReceipt]);
  if (pendingVerification.length) await api.create(pendingVerification);
  const [storedVerification] = await api.batchGet([verificationReceipt.path]);
  if (!storedVerification || !stableEqual(decodeSourceDocument(storedVerification).data, verificationReceipt.data)) throw new Error("Owner release verification barrier is absent or differs.");
  const [storedPointer, storedActivation] = await api.batchGet([pointer.path, activationReceipt.path]);
  if (storedPointer || storedActivation) {
    if (!storedPointer || !storedActivation || !stableEqual(decodeSourceDocument(storedPointer).data, pointer.data) || !stableEqual(decodeSourceDocument(storedActivation).data, activationReceipt.data)) throw new Error("Active release or owner activation receipt conflicts with this create-only release.");
    return;
  }
  // The pointer is last and is create-only; a concurrent activation fails closed.
  await api.activateIfNoPointer({ root: rootDocument(plan), verificationReceipt, pointer, activationReceipt });
}

/** Rejects unknown release subcollections as well as missing/mismatched expected docs. */
export async function verifyOwnerAuthorizedRelease(plan: OwnerReleasePlan, api: OwnerReleaseApi) {
  assertPlanShape(plan);
  const root = rootDocument(plan);
  const [storedRoot] = await api.batchGet([root.path]);
  if (!storedRoot || !stableEqual(decodeSourceDocument(storedRoot).data, root.data)) throw new Error("Owner release root is absent or differs.");
  await assertExactReleaseChildren(plan, api);
  const { pointer, verificationReceipt, activationReceipt } = pointerDocuments(plan);
  const [storedPointer, storedVerification, storedReceipt] = await api.batchGet([pointer.path, verificationReceipt.path, activationReceipt.path]);
  if (!storedPointer || !storedVerification || !storedReceipt || !stableEqual(decodeSourceDocument(storedPointer).data, pointer.data) || !stableEqual(decodeSourceDocument(storedVerification).data, verificationReceipt.data) || !stableEqual(decodeSourceDocument(storedReceipt).data, activationReceipt.data)) throw new Error("Owner release active pointer, verification barrier, or activation receipt is absent or differs.");
  return { releaseId: plan.releaseId, documentCount: plan.documents.length, active: true };
}

/** CAS rollback removes only the active pointer. Immutable release documents remain as audit evidence. */
export async function rollbackOwnerAuthorizedReleaseToNone(plan: OwnerReleasePlan, api: OwnerReleaseApi, operationReference: string) {
  assertPlanShape(plan);
  if (!api.rollbackToNone) throw new Error("Owner release rollback requires a CAS-capable production API.");
  if (!operationReference.trim() || operationReference.length > 200) throw new Error("Rollback needs a non-secret operation reference of at most 200 characters.");
  const { pointer } = pointerDocuments(plan);
  const receiptHash = hash(canonicalJson({ releaseId: plan.releaseId, operationReference }));
  const rollbackReceipt = { path: `rollbackReceipts/${plan.releaseId}-${receiptHash}`, data: { releaseId: plan.releaseId, expectedActiveReleaseId: plan.releaseId, restoreReleaseId: null, operationReference, rollbackToNone: true, immutable: true } };
  await api.rollbackToNone({ pointer, rollbackReceipt });
}

function encodeValue(value: unknown): FirestoreValue {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isSafeInteger(value)) return { integerValue: String(value) };
  if (typeof value === "number" && Number.isFinite(value)) return { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (value && typeof value === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, encodeValue(child)])) } };
  throw new Error("Owner release data is not Firestore serializable.");
}

/** REST implementation keeps source version readback exact, including updateTime. */
export async function createProductionOwnerReleaseApi(): Promise<OwnerReleaseApi> {
  const require = createRequire(import.meta.url);
  const accessToken = async () => {
    const { getGlobalDefaultAccount, getAccessToken } = require("firebase-tools/lib/auth.js") as { getGlobalDefaultAccount: () => { tokens?: { refresh_token?: string } } | undefined; getAccessToken: (token: string, scopes: string[]) => Promise<{ access_token?: string }> };
    const refresh = getGlobalDefaultAccount()?.tokens?.refresh_token;
    if (!refresh) throw new Error("Firebase CLI login refresh token is unavailable for owner release publication.");
    const access = await getAccessToken(refresh, ["https://www.googleapis.com/auth/cloud-platform"]);
    if (!access.access_token) throw new Error("Firebase CLI access token is unavailable for owner release publication.");
    return access.access_token;
  };
  const request = async (url: string, init: RequestInit = {}) => {
    const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", "Cache-Control": "no-store", ...(init.headers ?? {}) } });
    if (!response.ok) throw new Error(`Firestore REST ${init.method ?? "GET"} ${response.status}: ${(await response.text()).slice(0, 500)}`);
    return response;
  };
  const base = `https://firestore.googleapis.com/v1/projects/${PRODUCTION_PROJECT}/databases/${encodeURIComponent(PRODUCTION_DATABASE)}/documents`;
  const full = (path: string) => `projects/${PRODUCTION_PROJECT}/databases/${PRODUCTION_DATABASE}/documents/${path}`;
  const parseBatchGet = (body: string) => {
    const trimmed = body.trim();
    if (!trimmed) return [] as Array<{ found?: SourceDocument; missing?: string }>;
    if (trimmed.startsWith("[")) return JSON.parse(trimmed) as Array<{ found?: SourceDocument; missing?: string }>;
    return trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as { found?: SourceDocument; missing?: string });
  };
  return {
    getDatabaseMetadata: async () => {
      const response = await (await request(`https://firestore.googleapis.com/v1/projects/${PRODUCTION_PROJECT}/databases/${encodeURIComponent(PRODUCTION_DATABASE)}`)).json() as { locationId?: string; type?: string };
      return { projectId: PRODUCTION_PROJECT, databaseId: PRODUCTION_DATABASE, locationId: response.locationId ?? "", type: response.type ?? "" };
    },
    batchGet: async (paths) => {
      if (paths.length > MAX_BATCH_DOCUMENTS) throw new Error(`Owner release batchGet exceeds ${MAX_BATCH_DOCUMENTS} documents.`);
      const response = await request(`${base}:batchGet`, { method: "POST", body: JSON.stringify({ documents: paths.map(full) }) });
      const found = new Map(parseBatchGet(await response.text()).filter((row) => row.found).map((row) => [sourcePath(row.found!.name), row.found!]));
      return paths.map((path) => found.get(path));
    },
    create: async (documents) => {
      if (!documents.length) return;
      const writes = documents.map((document) => ({ update: { name: full(document.path), fields: Object.fromEntries(Object.entries(document.data).map(([key, value]) => [key, encodeValue(value)])) }, currentDocument: { exists: false } }));
      await request(`${base}:commit`, { method: "POST", body: JSON.stringify({ writes }) });
    },
    listCollectionIds: async (path) => {
      const response = await (await request(`https://firestore.googleapis.com/v1/${full(path)}:listCollectionIds`, { method: "POST", body: JSON.stringify({ pageSize: 1000 }) })).json() as { collectionIds?: string[] };
      return response.collectionIds ?? [];
    },
    listCollection: async (path) => {
      const documents: SourceDocument[] = []; let pageToken = "";
      do {
        const response = await (await request(`${base}/${path}?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`)).json() as { documents?: SourceDocument[]; nextPageToken?: string };
        documents.push(...(response.documents ?? [])); pageToken = response.nextPageToken ?? "";
      } while (pageToken);
      return documents;
    },
    activateIfNoPointer: async ({ root, verificationReceipt, pointer, activationReceipt }) => {
      const begin = await (await request(`${base}:beginTransaction`, { method: "POST", body: "{}" })).json() as { transaction?: string };
      if (!begin.transaction) throw new Error("Firestore did not return an activation transaction.");
      const guardResponse = await request(`${base}:batchGet`, { method: "POST", body: JSON.stringify({ transaction: begin.transaction, documents: [full(root.path), full(OWNER_APPROVAL_PATH), full(verificationReceipt.path), full(pointer.path), full(activationReceipt.path)] }) });
      const guarded = new Map(parseBatchGet(await guardResponse.text()).filter((row) => row.found).map((row) => [sourcePath(row.found!.name), row.found!]));
      const storedRoot = guarded.get(root.path);
      if (!storedRoot || !stableEqual(decodeSourceDocument(storedRoot).data, root.data)) throw new Error("Activation transaction rejected: immutable release root is absent or differs.");
      assertOwnerManifest(guarded.get(OWNER_APPROVAL_PATH));
      const storedVerification = guarded.get(verificationReceipt.path);
      if (!storedVerification || !stableEqual(decodeSourceDocument(storedVerification).data, verificationReceipt.data)) throw new Error("Activation transaction rejected: immutable verification barrier is absent or differs.");
      if (guarded.has(pointer.path) || guarded.has(activationReceipt.path)) throw new Error("Activation transaction rejected: active pointer or immutable receipt already exists.");
      const writes = [
        { update: { name: full(activationReceipt.path), fields: Object.fromEntries(Object.entries(activationReceipt.data).map(([key, value]) => [key, encodeValue(value)])) }, currentDocument: { exists: false } },
        { update: { name: full(pointer.path), fields: Object.fromEntries(Object.entries(pointer.data).map(([key, value]) => [key, encodeValue(value)])) }, currentDocument: { exists: false } },
      ];
      // Transactional reads bind the root and owner-approval manifest while the
      // final two create-only writes reject any concurrent active pointer.
      await request(`${base}:commit`, { method: "POST", body: JSON.stringify({ transaction: begin.transaction, writes }) });
    },
    rollbackToNone: async ({ pointer, rollbackReceipt }) => {
      const begin = await (await request(`${base}:beginTransaction`, { method: "POST", body: "{}" })).json() as { transaction?: string };
      if (!begin.transaction) throw new Error("Firestore did not return a rollback transaction.");
      const response = await request(`${base}:batchGet`, { method: "POST", body: JSON.stringify({ transaction: begin.transaction, documents: [full(pointer.path), full(rollbackReceipt.path)] }) });
      const guarded = new Map(parseBatchGet(await response.text()).filter((row) => row.found).map((row) => [sourcePath(row.found!.name), row.found!]));
      const active = guarded.get(pointer.path);
      if (!active || !stableEqual(decodeSourceDocument(active).data, pointer.data)) throw new Error("Rollback rejected: active pointer CAS mismatch.");
      if (guarded.has(rollbackReceipt.path)) throw new Error("Rollback rejected: immutable rollback receipt already exists.");
      const fields = Object.fromEntries(Object.entries(rollbackReceipt.data).map(([key, value]) => [key, encodeValue(value)]));
      await request(`${base}:commit`, { method: "POST", body: JSON.stringify({ transaction: begin.transaction, writes: [{ delete: full(pointer.path) }, { update: { name: full(rollbackReceipt.path), fields }, currentDocument: { exists: false } }] }) });
    },
  };
}

function parseFlags(values: string[]) {
  const flags: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index], value = values[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || flags[key.slice(2)] !== undefined) throw new Error("Arguments must be unique --name value pairs.");
    flags[key.slice(2)] = value;
  }
  return flags;
}
async function loadPlan(flags: Record<string, string>) {
  const [snapshotText, summaryText, planText] = await Promise.all([readFile(flags.snapshot, "utf8"), readFile(flags.summary, "utf8"), flags.plan ? readFile(flags.plan, "utf8") : Promise.resolve("")]);
  const summary = JSON.parse(summaryText) as { sha256?: string; count?: number; at?: string };
  if (summary.sha256 !== OWNER_SNAPSHOT_SHA256 || summary.count !== OWNER_SNAPSHOT_COUNT || typeof summary.at !== "string") throw new Error("Owner approval summary is not the pinned authority.");
  const rebuilt = buildOwnerAuthorizedReleasePlan(JSON.parse(snapshotText) as SourceDocument[], { capturedAt: summary.at });
  if (flags.plan && !stableEqual(JSON.parse(planText), rebuilt)) throw new Error("Prepared owner release plan differs from deterministic rebuild.");
  return rebuilt;
}
async function main() {
  const [operation, ...args] = process.argv.slice(2); const flags = parseFlags(args);
  if (operation === "prepare") {
    if (Object.keys(flags).length !== 3 || !flags.snapshot || !flags.summary || !flags.out) throw new Error("Usage: owner-approved-release prepare --snapshot PATH --summary PATH --out PATH");
    const plan = await loadPlan({ ...flags, plan: undefined as unknown as string });
    await writeFile(resolve(flags.out), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ operation, releaseId: plan.releaseId, approvedCount: plan.approvedCount, readiness: plan.readiness, exclusions: plan.exclusions, productionWrite: false }, null, 2)); return;
  }
  if (operation === "apply" || operation === "verify") {
    if (Object.keys(flags).length !== 3 || !flags.snapshot || !flags.summary || !flags.plan) throw new Error(`Usage: owner-approved-release ${operation} --snapshot PATH --summary PATH --plan PATH`);
    const plan = await loadPlan(flags); const api = await createProductionOwnerReleaseApi();
    if (operation === "apply") { await applyOwnerAuthorizedRelease(plan, JSON.parse(await readFile(flags.snapshot, "utf8")) as SourceDocument[], api); console.log(JSON.stringify({ operation, releaseId: plan.releaseId, activated: true }, null, 2)); }
    else console.log(JSON.stringify({ operation, ...(await verifyOwnerAuthorizedRelease(plan, api)) }, null, 2));
    return;
  }
  if (operation === "rollback-none") {
    if (Object.keys(flags).length !== 4 || !flags.snapshot || !flags.summary || !flags.plan || !flags["operation-reference"]) throw new Error("Usage: owner-approved-release rollback-none --snapshot PATH --summary PATH --plan PATH --operation-reference REF");
    const plan = await loadPlan(flags); await rollbackOwnerAuthorizedReleaseToNone(plan, await createProductionOwnerReleaseApi(), flags["operation-reference"]);
    console.log(JSON.stringify({ operation, releaseId: plan.releaseId, rolledBackToNone: true }, null, 2)); return;
  }
  throw new Error("Usage: owner-approved-release <prepare|apply|verify|rollback-none> ...");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch((error) => { console.error(error); process.exitCode = 1; });
