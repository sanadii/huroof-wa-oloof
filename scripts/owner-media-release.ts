/**
 * Owner-authorized immutable media extension.
 *
 * This is intentionally separate from both the signed-review publisher and
 * the text-only owner publisher.  It never represents owner authority as a
 * specialist signature.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { answerInitial, normalizeArabic } from "../src/question-bank.js";
import { createCategoryQuestionSelection, createMatchQuestionSelection, type RuntimeQuestionV32 } from "../src/features/game/runtime/question-selector.js";
import { canonicalJson } from "./firestore-release-canonical.js";
import { buildQuestionMediaUploadPlan, type ImmutableMediaReadback, type PrivateMediaUpload, type PrivateMediaUploadPlan } from "./question-media-release-prep.js";
import { assertFirestoreDocumentPath, type ReleaseDocument } from "./build-firestore-release.js";
import { decodeSourceDocument, OWNER_SNAPSHOT_COUNT, OWNER_SNAPSHOT_SHA256, type SourceDocument } from "./owner-approved-release.js";

export const OWNER_MEDIA_SCHEMA = "owner-authorized-media-extension-v1";
export const OWNER_MEDIA_INSTRUCTION = "uploaded image questions to display images, goal-video category to appear and play, and all uploaded categories to work";
export const OWNER_APPROVAL_PATH = "contentOwnerApprovals/owner-approval-072dd09e41e2eaf652db75c9d5216d7515b5a7aff11fba180f864df118363180";
export const TEXT_BASE_RELEASE = "owner-release-3b46a28072ec92a4ed3be4941bf7a818";
export const SUPERSEDED_IMAGE_STUBS = 238;
export const VERIFIED_IMAGE_QUESTIONS = 291;
export const VERIFIED_GOAL_QUESTIONS = 99;
export const PRIVATE_MEDIA_BUCKET = "huroof-a3ee7.firebasestorage.app";

const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const isHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/iu.test(value);
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asStrings = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()))] : [];
const imageSource = /^(?:v18-tahadani-(?:011|012|014|061)|rebuild-v2-tahadani-011)-\d{3}$/u;
const imageCategories = new Set(["tahadani-011", "tahadani-012", "tahadani-014", "tahadani-061"]);
const v18Media = /^v18-(?:tahadani-)?(?:011|012|014|061)-\d{3}$/u;
const rebuildMedia = /^rebuild-v2-photo-011-\d{3}$/u;
const goalMedia = /^goal-quiz-2026:\d{3}:(?:blur|clean)$/u;

export type SourceMediaRecord = {
  sourcePath: string;
  sourceContentHash: string;
  rawHash: string;
  raw: Record<string, unknown>;
};
export type OwnerMediaPlan = {
  schemaVersion: typeof OWNER_MEDIA_SCHEMA;
  releaseId: string;
  capturedAt: string;
  base: { releaseId: string; pointer: Record<string, unknown>; root: ReleaseDocument; children: ReleaseDocument[] };
  authority: { ownerApprovalPath: typeof OWNER_APPROVAL_PATH; userInstruction: typeof OWNER_MEDIA_INSTRUCTION; sqliteSha256: string; sourceExportSha256: string; manifestHashes: Record<string, string>; selectedSourceBindingsSha256: string };
  approvedCount: number;
  catalogSha256: string;
  documentRootSha256: string;
  sourceManifestSha256: string;
  documents: ReleaseDocument[];
  media: PrivateMediaUploadPlan;
  superseded: Array<{ id: string; categoryId: string; sourceContentHash: string; reason: "replaced_by_verified_media_pair" }>;
  exclusions: Record<string, number>;
  readiness: { categories: Record<string, CategoryReadiness>; globalHuroof: { playable: boolean; detail: string } };
};
export type CategoryReadiness = { text: number; image: number; video: number; concepts: number; categories: { playable: boolean; detail: string }; huroof: { playable: boolean; detail: string }; hiddenReason?: string };
export type PlanInput = {
  basePlan: { releaseId: string; approvedCount: number; documentRootSha256: string; documents: ReleaseDocument[] };
  basePointer: Record<string, unknown>;
  sqliteBytes: Uint8Array;
  sourceExportText: string;
  sourceRecords: SourceMediaRecord[];
  goalPackage: unknown;
  mediaRoot: string;
  manifestHashes: Record<string, string>;
  capturedAt: string;
};

export function parseSourceExport(text: string): SourceMediaRecord[] {
  const rows = text.split(/\r?\n/u).filter((line) => line.trim()).flatMap((line, index) => {
    let value: unknown;
    try { value = JSON.parse(line); } catch { throw new Error("Source export JSONL line " + String(index + 1) + " is invalid."); }
    const outer = asRecord(value), data = asRecord(outer.data), raw = asRecord(data.raw);
    const sourceContentHash = data.sourceContentSha256 ?? raw.source_content_sha256;
    const rawHash = data.rawSha256 ?? data.rawCanonicalSha256;
    // The export also contains non-media intake evidence.  It is committed by
    // sourceExportSha256, but it is not an eligible addition to this release.
    if (typeof raw.id !== "string" || !imageSource.test(raw.id)) return [];
    if (typeof outer.path !== "string" || !isHash(sourceContentHash) || !isHash(rawHash) || !Object.keys(raw).length)
      throw new Error("Source export line " + String(index + 1) + " lacks immutable media-question provenance.");
    // The import package keeps immutable associations beside the SQLite payload.
    raw._mediaReferences = data.mediaReferences;
    return [{ sourcePath: outer.path, sourceContentHash, rawHash, raw }];
  });
  if (new Set(rows.map((row) => row.sourcePath)).size !== rows.length) throw new Error("Source export contains duplicate source paths.");
  return rows;
}

function docHash(documents: ReleaseDocument[]) {
  return digest(canonicalJson(documents.slice().sort((left, right) => left.path.localeCompare(right.path)).map((document) => ({ path: document.path, data: document.data }))));
}
function validateDocuments(documents: ReleaseDocument[]) {
  const paths = new Set<string>();
  for (const document of documents) {
    assertFirestoreDocumentPath(document.path);
    if (paths.has(document.path)) throw new Error("Duplicate immutable document " + document.path);
    paths.add(document.path);
  }
}
function label(categoryId: string) {
  const labels: Record<string, string> = {
    "tahadani-011": "خمن الصورة", "tahadani-012": "خمن الجزء", "tahadani-014": "الجزء المفقود", "tahadani-061": "من اللاعب؟", "goals-2026": "من سجل الهدف؟",
  };
  const value = labels[categoryId];
  if (!value) throw new Error("Media category has no fixed Arabic label.");
  return value;
}
function readMediaReference(raw: Record<string, unknown>, uploads: Map<string, PrivateMediaUpload>) {
  const association = asRecord(raw.importMediaAssociation), registry = asRecord(association.registry);
  const mediaId = registry.mediaId, assetSha256 = registry.assetSha256;
  const refs = raw._mediaReferences;
  const upload = typeof mediaId === "string" ? uploads.get(mediaId) : undefined;
  if (!Array.isArray(refs) || refs.length !== 1 || !upload || assetSha256 !== upload.assetSha256 || (upload.contentType !== "image/png" && upload.contentType !== "image/jpeg"))
    throw new Error("Image source does not have one exact manifest media binding.");
  if (!(v18Media.test(upload.mediaId) || rebuildMedia.test(upload.mediaId))) throw new Error("Image source uses an unapproved media family.");
  return upload;
}
function imageQuestion(source: SourceMediaRecord, upload: PrivateMediaUpload): RuntimeQuestionV32 & Record<string, unknown> {
  const raw = source.raw, categoryId = raw.categoryId, promptAr = raw.promptAr ?? raw.question, canonicalAnswer = raw.canonicalAnswer ?? raw.answer;
  const acceptedAnswers = asStrings(raw.acceptedAnswers ?? raw.accepted_answers);
  if (typeof categoryId !== "string" || !imageCategories.has(categoryId) || typeof promptAr !== "string" || !promptAr.trim() || typeof canonicalAnswer !== "string" || !canonicalAnswer.trim() || !acceptedAnswers.some((answer) => normalizeArabic(answer) === normalizeArabic(canonicalAnswer)))
    throw new Error("Image source literal prompt, answer, category, or accepted answer is invalid.");
  // Image categories are category-board only.  Numeric visual-puzzle answers
  // therefore keep an explicit non-letter sentinel instead of inventing an
  // Arabic initial; Huroof selection filters to classic modality before this.
  const targetLetter = answerInitial(canonicalAnswer, true) || "category-only";
  return { id: source.sourceContentHash, categoryId, modality: "image", targetLetter, answerConceptId: digest(normalizeArabic(canonicalAnswer)), headerAr: label(categoryId), promptAr, canonicalAnswer, acceptedAnswers, media: { mediaId: upload.mediaId, assetSha256: upload.assetSha256, altAr: "صورة السؤال", type: "image", contentType: upload.contentType }, sourceContentHash: source.sourceContentHash, immutable: true };
}
function selectedImages(records: SourceMediaRecord[], uploads: Map<string, PrivateMediaUpload>, exclusions: Record<string, number>) {
  const result: Array<RuntimeQuestionV32 & Record<string, unknown>> = [];
  for (const source of records) {
    const id = source.raw.id;
    if (typeof id !== "string" || !imageSource.test(id)) continue;
    try { result.push(imageQuestion(source, readMediaReference(source.raw, uploads))); }
    catch (error) { const reason = error instanceof Error ? error.message.replace(/[^A-Za-z0-9]+/gu, "_").slice(0, 96) : "unknown"; exclusions["image_" + reason] = (exclusions["image_" + reason] ?? 0) + 1; }
  }
  if (result.length !== VERIFIED_IMAGE_QUESTIONS || new Set(result.map((item) => item.id)).size !== result.length || new Set(result.map((item) => (item.media as { mediaId: string }).mediaId)).size !== result.length)
    throw new Error("Expected exactly 291 valid one-to-one image question/media pairs; selected=" + String(result.length) + ", exclusions=" + canonicalJson(exclusions));
  return result.sort((a, b) => a.id.localeCompare(b.id));
}
function selectedGoals(value: unknown, uploads: Map<string, PrivateMediaUpload>) {
  const packageValue = asRecord(value), questions = packageValue.questions;
  if (packageValue.questionCount !== VERIFIED_GOAL_QUESTIONS || !Array.isArray(questions) || questions.length !== VERIFIED_GOAL_QUESTIONS) throw new Error("Goal package must contain exactly 99 questions.");
  const result = questions.map((value) => {
    const question = asRecord(value), media = asRecord(question.media), source = asRecord(question.importSource);
    const id = question.id, categoryId = question.categoryId, prompt = media.promptMediaId, answer = media.answerMediaId, promptHash = media.promptSha256, answerHash = media.answerSha256, canonicalAnswer = question.canonicalAnswer, acceptedAnswers = asStrings(question.acceptedAnswers), sourceHash = source.source_content_sha256;
    const promptUpload = typeof prompt === "string" ? uploads.get(prompt) : undefined, answerUpload = typeof answer === "string" ? uploads.get(answer) : undefined;
    if (typeof id !== "string" || !/^goal-quiz-2026-\d{3}$/u.test(id) || categoryId !== "goals-2026" || question.headerAr !== "من سجل الهدف؟" || question.promptAr !== "من سجل هذا الهدف؟" || typeof canonicalAnswer !== "string" || !acceptedAnswers.some((item) => normalizeArabic(item) === normalizeArabic(canonicalAnswer)) || !isHash(sourceHash) || !promptUpload || !answerUpload || promptUpload.contentType !== "video/mp4" || answerUpload.contentType !== "video/mp4" || promptUpload.assetSha256 !== promptHash || answerUpload.assetSha256 !== answerHash || !goalMedia.test(promptUpload.mediaId) || !goalMedia.test(answerUpload.mediaId) || !promptUpload.mediaId.endsWith(":blur") || !answerUpload.mediaId.endsWith(":clean"))
      throw new Error("Goal question has an invalid exact blur/clean asset pair.");
    return { id: sourceHash, categoryId, modality: "video" as const, targetLetter: answerInitial(canonicalAnswer, true), answerConceptId: digest(normalizeArabic(canonicalAnswer)), headerAr: "من سجل الهدف؟", promptAr: "من سجل هذا الهدف؟", canonicalAnswer, acceptedAnswers, media: { mediaId: promptUpload.mediaId, assetSha256: promptUpload.assetSha256, altAr: "مقطع السؤال", type: "video" as const, contentType: "video/mp4" as const }, answerMedia: { mediaId: answerUpload.mediaId, assetSha256: answerUpload.assetSha256, altAr: "مقطع الإجابة", type: "video" as const, contentType: "video/mp4" as const }, sourceContentHash: sourceHash, immutable: true };
  });
  if (new Set(result.map((item) => item.id)).size !== result.length) throw new Error("Goal package has duplicate source hashes.");
  return result.sort((a, b) => a.id.localeCompare(b.id));
}
function selectorReadiness(questions: Array<RuntimeQuestionV32 & Record<string, unknown>>, categoryIds: string[]) {
  const run = (action: () => unknown) => { try { action(); return { playable: true, detail: "runtime selector passed" }; } catch (error) { return { playable: false, detail: error instanceof Error ? error.message : String(error) }; } };
  const globalHuroof = run(() => createMatchQuestionSelection(questions, { categories: categoryIds, modality: "classic", seed: 1, reservePerLetter: 3 }));
  const categories: Record<string, CategoryReadiness> = {};
  for (const categoryId of categoryIds) {
    const scoped = questions.filter((question) => question.categoryId === categoryId);
    const text = scoped.filter((question) => question.modality === "classic").length, image = scoped.filter((question) => question.modality === "image").length, video = scoped.filter((question) => question.modality === "video").length;
    const partner = categoryIds.find((other) => other !== categoryId && run(() => createCategoryQuestionSelection(questions, { categories: [categoryId, other], modality: "classic", seed: 1 })).playable);
    categories[categoryId] = { text, image, video, concepts: new Set(scoped.map((question) => question.answerConceptId)).size, categories: partner ? { playable: true, detail: "runtime selector passed with " + partner } : { playable: false, detail: "No legal two-category board partner passed the runtime selector." }, huroof: globalHuroof.playable && text > 0 ? { playable: true, detail: "contributes to the shared classic Huroof pool" } : { playable: false, detail: text ? globalHuroof.detail : "image/video-only category is unavailable in Huroof mode" }, ...(scoped.length ? {} : { hiddenReason: "no usable runtime questions" }) };
  }
  return { categories, globalHuroof };
}

/** Builds only from explicit local source authority; this function never reads cloud state. */
export async function buildOwnerMediaReleasePlan(input: PlanInput): Promise<OwnerMediaPlan> {
  const baseRoot = input.basePlan.documents.find((document) => document.path === "releases/" + input.basePlan.releaseId);
  const baseChildren = input.basePlan.documents.filter((document) => document.path !== baseRoot?.path);
  if (!baseRoot || input.basePlan.releaseId !== TEXT_BASE_RELEASE || input.basePlan.approvedCount !== 10686 || !isHash(input.basePlan.documentRootSha256) || input.basePointer.releaseId !== TEXT_BASE_RELEASE || input.basePointer.documentRootSha256 !== input.basePlan.documentRootSha256 || docHash(baseChildren) !== input.basePlan.documentRootSha256)
    throw new Error("The active immutable text base is not the captured owner-authorized release.");
  const stubs = input.basePlan.documents.filter((document) => document.path.startsWith("releases/" + input.basePlan.releaseId + "/questions/") && imageCategories.has(String(document.data.categoryId)));
  if (stubs.length !== SUPERSEDED_IMAGE_STUBS || !stubs.every((document) => document.data.modality === "classic" && typeof document.data.id === "string" && isHash(document.data.sourceContentHash)))
    throw new Error("The text base does not contain exactly the authorized image stub replacement set.");
  const media = await buildQuestionMediaUploadPlan(input.mediaRoot);
  const uploads = new Map(media.uploads.map((upload) => [upload.mediaId, upload]));
  const exclusions: Record<string, number> = {};
  const images = selectedImages(input.sourceRecords, uploads, exclusions), goals = selectedGoals(input.goalPackage, uploads);
  const superseded = stubs.map((document) => ({ id: String(document.data.id), categoryId: String(document.data.categoryId), sourceContentHash: String(document.data.sourceContentHash), reason: "replaced_by_verified_media_pair" as const })).sort((left, right) => left.id.localeCompare(right.id));
  const bindings = input.sourceRecords.filter((source) => images.some((question) => question.id === source.sourceContentHash)).map((source) => ({ sourcePath: source.sourcePath, sourceContentHash: source.sourceContentHash, rawHash: source.rawHash })).sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  const selectedBindingHash = digest(canonicalJson(bindings));
  const releaseIdentity = { schemaVersion: OWNER_MEDIA_SCHEMA, baseReleaseId: input.basePlan.releaseId, baseDocumentRootSha256: input.basePlan.documentRootSha256, sqliteSha256: digest(input.sqliteBytes), sourceExportSha256: digest(input.sourceExportText), manifests: input.manifestHashes, selectedBindingHash, mediaManifestSha256: media.manifestSha256, superseded, additions: [...images, ...goals].map((question) => ({ id: question.id, categoryId: question.categoryId, modality: question.modality, media: question.media, ...(question.answerMedia ? { answerMedia: question.answerMedia } : {}) })) };
  const releaseId = "owner-media-release-" + digest(canonicalJson(releaseIdentity)).slice(0, 32);
  const kept = input.basePlan.documents.filter((document) => document.path !== baseRoot.path && !superseded.some((item) => document.path === "releases/" + input.basePlan.releaseId + "/questions/" + item.id) && !document.path.includes("/catalogCategories/") && !document.path.includes("/inventory/")).map((document) => ({ path: document.path.replace("releases/" + input.basePlan.releaseId + "/", "releases/" + releaseId + "/"), data: document.data }));
  const questions = [...kept.filter((document) => document.path.includes("/questions/")).map((document) => document.data as RuntimeQuestionV32 & Record<string, unknown>), ...images, ...goals];
  const categoryIds = [...new Set(questions.map((question) => question.categoryId))].sort();
  const baseLabels = new Map(input.basePlan.documents.filter((document) => document.path.includes("/catalogCategories/")).map((document) => [String(document.data.id), document.data.labelAr]));
  const catalog = categoryIds.map((id) => ({ path: "releases/" + releaseId + "/catalogCategories/" + id, data: { id, labelAr: id === "goals-2026" ? label(id) : baseLabels.get(id), runtimeScope: OWNER_MEDIA_SCHEMA, immutable: true } }));
  if (catalog.some((document) => typeof document.data.labelAr !== "string" || !String(document.data.labelAr).trim())) throw new Error("Media release catalog cannot inherit a verified Arabic label.");
  const inventory = categoryIds.map((id) => { const scoped = questions.filter((question) => question.categoryId === id); return { path: "releases/" + releaseId + "/inventory/" + id, data: { categoryId: id, approvedCount: scoped.length, uniqueAnswerConceptCount: new Set(scoped.map((question) => question.answerConceptId)).size, immutable: true } }; });
  const additions = [...images, ...goals].map((question) => ({ path: "releases/" + releaseId + "/questions/" + question.id, data: question }));
  const body = [...kept, ...catalog, ...inventory, ...additions].sort((left, right) => left.path.localeCompare(right.path));
  const documentRootSha256 = docHash(body), catalogSha256 = docHash(catalog), sourceManifestSha256 = digest(canonicalJson({ ownerApprovalPath: OWNER_APPROVAL_PATH, userInstruction: OWNER_MEDIA_INSTRUCTION, baseReleaseId: input.basePlan.releaseId, baseDocumentRootSha256: input.basePlan.documentRootSha256, sqliteSha256: digest(input.sqliteBytes), sourceExportSha256: digest(input.sourceExportText), manifests: input.manifestHashes, selectedBindingHash, mediaManifestSha256: media.manifestSha256, superseded }));
  const root: ReleaseDocument = { path: "releases/" + releaseId, data: { schemaVersion: OWNER_MEDIA_SCHEMA, releaseId, immutable: true, publicationAuthority: "owner_approval_media_extension", ownerApprovalPath: OWNER_APPROVAL_PATH, userInstruction: OWNER_MEDIA_INSTRUCTION, baseReleaseId: input.basePlan.releaseId, baseDocumentRootSha256: input.basePlan.documentRootSha256, baseApprovedCount: input.basePlan.approvedCount, approvedCount: questions.length, documentRootSha256, catalogSha256, sourceManifestSha256, supersededQuestionCount: superseded.length, selectedImageQuestionCount: images.length, goalVideoQuestionCount: goals.length, asOf: input.capturedAt } };
  const documents = [...body, root].sort((left, right) => left.path.localeCompare(right.path));
  validateDocuments(documents);
  if (questions.length !== 10838) throw new Error("Media release arithmetic must be 10686 - 238 + 291 + 99 = 10838.");
  const readiness = selectorReadiness(questions, categoryIds);
  if (!readiness.categories["tahadani-011"]?.categories.playable || !readiness.categories["goals-2026"]?.categories.playable) throw new Error("Verified image and goal categories must be category-board playable.");
  return { schemaVersion: OWNER_MEDIA_SCHEMA, releaseId, capturedAt: input.capturedAt, base: { releaseId: input.basePlan.releaseId, pointer: input.basePointer, root: baseRoot, children: baseChildren }, authority: { ownerApprovalPath: OWNER_APPROVAL_PATH, userInstruction: OWNER_MEDIA_INSTRUCTION, sqliteSha256: digest(input.sqliteBytes), sourceExportSha256: digest(input.sourceExportText), manifestHashes: input.manifestHashes, selectedSourceBindingsSha256: selectedBindingHash }, approvedCount: questions.length, catalogSha256, documentRootSha256, sourceManifestSha256, documents, media, superseded, exclusions, readiness };
}

export type OwnerMediaApi = {
  metadata(): Promise<{ projectId: string; databaseId: string; locationId: string; type: string }>;
  verifyBase(plan: OwnerMediaPlan): Promise<void>;
  ensureObject(upload: PrivateMediaUpload): Promise<ImmutableMediaReadback>;
  /** Exact authenticated object readback without creating a missing object. */
  readObject(upload: PrivateMediaUpload): Promise<ImmutableMediaReadback>;
  create(documents: ReleaseDocument[]): Promise<void>;
  verifyRelease(plan: OwnerMediaPlan, media: ReleaseDocument[]): Promise<void>;
  activate(plan: OwnerMediaPlan, receipt: ReleaseDocument): Promise<void>;
  verifyActivation(plan: OwnerMediaPlan): Promise<void>;
  rollback(plan: OwnerMediaPlan, receipt: ReleaseDocument): Promise<void>;
};
function root(plan: OwnerMediaPlan) { const value = plan.documents.find((document) => document.path === "releases/" + plan.releaseId); if (!value) throw new Error("Media release lacks its root."); return value; }
function rootPointerData(plan: OwnerMediaPlan) {
  return { releaseId: plan.releaseId, approvedCount: plan.approvedCount, catalogSha256: plan.catalogSha256, documentRootSha256: plan.documentRootSha256, sourceManifestSha256: plan.sourceManifestSha256, ownerApprovalPath: OWNER_APPROVAL_PATH, publicationAuthority: "owner_approval_media_extension", baseReleaseId: plan.base.releaseId };
}
export function assertOwnerMediaApproval(data: Record<string, unknown>) {
  if (data.approvalState !== "owner_approved" || data.manifestComplete !== true || data.releaseActivated !== false || data.sourceSnapshotSha256 !== OWNER_SNAPSHOT_SHA256 || data.sourceSnapshotDocumentCount !== OWNER_SNAPSHOT_COUNT || data.projectId !== "huroof-a3ee7" || data.databaseId !== "(default)")
    throw new Error("Owner approval authority is absent or changed.");
}
export function assertAnonymousPrivateReadbacks(gcsStatus: number, firebaseStatus: number) {
  if (![401, 403].includes(gcsStatus) || ![401, 403].includes(firebaseStatus))
    throw new Error("Private media byte endpoints must deny anonymous reads with 401 or 403.");
}
export function resolveValidatedMediaLocalFile(mediaRoot: string, upload: PrivateMediaUpload) {
  let packageRoot: string;
  if (upload.contentType === "image/png" && v18Media.test(upload.mediaId) && upload.objectName === "question-media/v18/" + upload.assetSha256 + ".png") packageRoot = resolve(mediaRoot, "content", "question-media", "v18-private-240");
  else if (upload.contentType === "image/jpeg" && rebuildMedia.test(upload.mediaId) && upload.objectName === "question-media/guess-picture-rebuild-v2/assets/" + upload.assetSha256 + ".jpg") packageRoot = resolve(mediaRoot, "content", "question-media", "guess-picture-rebuild-v2");
  else if (upload.contentType === "video/mp4" && goalMedia.test(upload.mediaId) && upload.objectName === "question-media/goal-quiz-2026/assets/" + upload.assetSha256 + ".mp4") packageRoot = resolve(mediaRoot, "content", "question-media", "goal-quiz-2026");
  else throw new Error("Private media upload family or object path is not allowlisted.");
  const local = resolve(packageRoot, upload.localFile);
  const path = relative(packageRoot, local);
  if (isAbsolute(upload.localFile) || path.startsWith("..") || path.split(sep).includes("..")) throw new Error("Private media local path escapes its allowlisted package.");
  return local;
}
function mediaDocuments(plan: OwnerMediaPlan, readback: ImmutableMediaReadback[]) {
  const expected = new Map(plan.media.uploads.map((upload) => [upload.mediaId, upload]));
  if (readback.length !== expected.size) throw new Error("Every private media object requires exact readback.");
  const documents = readback.map((item) => {
    const upload = expected.get(item.mediaId);
    if (!upload || item.assetSha256 !== upload.assetSha256 || item.objectName !== upload.objectName || item.contentType !== upload.contentType || item.byteSize !== upload.byteSize || item.width !== upload.width || item.height !== upload.height || item.durationSeconds !== upload.durationSeconds || !/^[1-9]\d*$/u.test(item.generation)) throw new Error("Storage readback differs from an approved immutable media binding.");
    expected.delete(item.mediaId);
    return { path: "releases/" + plan.releaseId + "/media/" + item.mediaId, data: { ...item, immutable: true } };
  }).sort((left, right) => left.path.localeCompare(right.path));
  if (expected.size) throw new Error("Storage readback omits an approved immutable media binding.");
  return documents;
}
function publicationReceipt(plan: OwnerMediaPlan) {
  return { path: "ownerMediaReleaseVerificationReceipts/" + plan.releaseId + "-" + plan.documentRootSha256, data: { releaseId: plan.releaseId, baseReleaseId: plan.base.releaseId, documentRootSha256: plan.documentRootSha256, sourceManifestSha256: plan.sourceManifestSha256, ownerApprovalPath: OWNER_APPROVAL_PATH, verificationKind: "owner_media_exact_readback", immutable: true } };
}
function activationReceipt(plan: OwnerMediaPlan) {
  return { path: "activationReceipts/" + plan.releaseId + "-owner-media", data: { releaseId: plan.releaseId, baseReleaseId: plan.base.releaseId, documentRootSha256: plan.documentRootSha256, expectedPreviousReleaseId: plan.base.releaseId, activePointer: rootPointerData(plan), immutable: true } };
}
/** Storage generations are unknowable during prepare.  The immutable release
 * root is therefore materialized only after every create-only object has an
 * authenticated generation, and before its verification receipt or pointer. */
function materializeStorageReadback(plan: OwnerMediaPlan, media: ReleaseDocument[]): OwnerMediaPlan {
  const preparedRoot = root(plan);
  const children = [...plan.documents.filter((document) => document.path !== preparedRoot.path), ...media].sort((left, right) => left.path.localeCompare(right.path));
  const documentRootSha256 = docHash(children);
  const finalRoot: ReleaseDocument = { path: preparedRoot.path, data: { ...preparedRoot.data, preparedDocumentRootSha256: plan.documentRootSha256, documentRootSha256, mediaDocumentRootSha256: docHash(media) } };
  return { ...plan, documentRootSha256, documents: [...children, finalRoot].sort((left, right) => left.path.localeCompare(right.path)) };
}
async function mapBounded<T, R>(values: T[], limit: number, action: (value: T) => Promise<R>) {
  const result = new Array<R>(values.length); let next = 0;
  const worker = async () => {
    while (next < values.length) {
      const index = next++;
      result[index] = await action(values[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return result;
}
async function materializedReadbackPlan(plan: OwnerMediaPlan, read: (upload: PrivateMediaUpload) => Promise<ImmutableMediaReadback>) {
  const readback = await mapBounded(plan.media.uploads, 8, read);
  return materializeStorageReadback(plan, mediaDocuments(plan, readback));
}
export async function applyOwnerMediaRelease(plan: OwnerMediaPlan, api: OwnerMediaApi, rebuild: () => Promise<OwnerMediaPlan>) {
  const rebuilt = await rebuild();
  if (!same(plan, rebuilt)) throw new Error("Prepared media release differs from the deterministic source/base rebuild.");
  const metadata = await api.metadata();
  if (metadata.projectId !== "huroof-a3ee7" || metadata.databaseId !== "(default)" || metadata.locationId !== "me-central2" || metadata.type !== "FIRESTORE_NATIVE") throw new Error("Publication target is not pinned huroof-a3ee7/(default)/me-central2 Firestore Native.");
  await api.verifyBase(plan);
  if (!plan.media.uploads.length) throw new Error("Media release has no verified uploads.");
  // The first authenticated object must also pass both unauthenticated byte
  // endpoint denials before any bounded parallel upload begins.
  const first = await api.ensureObject(plan.media.uploads[0]!);
  const remaining = await mapBounded(plan.media.uploads.slice(1), 8, (upload) => api.ensureObject(upload));
  const readback = [first, ...remaining];
  const media = mediaDocuments(plan, readback);
  const finalPlan = materializeStorageReadback(plan, media);
  const children = finalPlan.documents.filter((document) => document.path !== root(finalPlan).path);
  await api.create(children);
  await api.verifyRelease(finalPlan, []);
  await api.create([root(finalPlan)]);
  await api.verifyBase(finalPlan);
  const receipt = publicationReceipt(finalPlan);
  await api.create([receipt]);
  await api.activate(finalPlan, receipt);
  await api.verifyActivation(finalPlan);
}
export async function rollbackOwnerMediaRelease(plan: OwnerMediaPlan, api: OwnerMediaApi, operationReference: string) {
  if (!/^[A-Za-z0-9._:-]{3,160}$/u.test(operationReference)) throw new Error("Rollback operation reference is invalid.");
  const finalPlan = await materializedReadbackPlan(plan, (upload) => api.readObject(upload));
  const receipt = { path: "rollbackReceipts/" + plan.releaseId + "-" + digest(operationReference).slice(0, 32), data: { releaseId: plan.releaseId, expectedActiveReleaseId: plan.releaseId, expectedActivePointer: rootPointerData(finalPlan), restoreReleaseId: plan.base.releaseId, restorePointer: plan.base.pointer, operationReference, immutable: true } };
  await api.rollback(finalPlan, receipt);
}
export async function verifyOwnerMediaRelease(plan: OwnerMediaPlan, api: OwnerMediaApi) {
  const finalPlan = await materializedReadbackPlan(plan, (upload) => api.readObject(upload));
  await api.verifyActivation(finalPlan);
  return { releaseId: plan.releaseId, approvedCount: plan.approvedCount, active: true };
}

/** Report only the successor's technically verified runtime scope.  A caller
 * appends broader intake-held rows from its separate reconciliation evidence. */
export function renderOwnerMediaReadinessMarkdown(plan: OwnerMediaPlan) {
  const rows = Object.entries(plan.readiness.categories).sort(([left], [right]) => left.localeCompare(right)).map(([id, value]) => "| " + id + " | " + String(value.text) + " | " + String(value.image) + " | " + String(value.video) + " | " + (value.categories.playable ? "yes" : "no") + " | " + (value.huroof.playable ? "shared-pool contributor" : value.huroof.detail) + " | " + (value.hiddenReason ?? "") + " |");
  return ["# Owner media extension readiness", "", "This table covers the immutable successor only. Huroof status means participation in the shared classic pool; it is not a claim that each category independently has a letter board.", "", "| Category | Text | Image | Video | Category board | Huroof status | Held reason |", "| --- | ---: | ---: | ---: | --- | --- | --- |", ...rows, "", "## Held source records", "", "- 9 rebuilt-photo source records were excluded because no exact manifest asset pair exists.", "- 238 text projections in tahadani-011/012/014/061 were superseded only by the 291 exact verified image pairs.", "- No optional photo-001 records are included in this release.", ""].join("\n");
}

type RestValue = Record<string, unknown>;
const firestoreName = (path: string) => "projects/huroof-a3ee7/databases/(default)/documents/" + path;
function encodeFirestore(value: unknown): RestValue {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestore) } };
  if (value && typeof value === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, encodeFirestore(item)])) } };
  throw new Error("Release value cannot be encoded for Firestore.");
}
function responseRows(body: string): Array<{ found?: SourceDocument; missing?: string }> {
  const trimmed = body.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) return JSON.parse(trimmed) as Array<{ found?: SourceDocument; missing?: string }>;
  return trimmed.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as { found?: SourceDocument; missing?: string });
}
function sourceNamePath(name: string) {
  const marker = "/documents/", index = name.indexOf(marker);
  if (index < 0) throw new Error("Firestore response has an unsafe document name.");
  return name.slice(index + marker.length);
}
export function documentsStillToCreate(documents: ReleaseDocument[], existing: Array<SourceDocument | undefined>) {
  if (documents.length !== existing.length) throw new Error("Firestore create retry lookup is incomplete.");
  return documents.filter((document, index) => {
    const stored = existing[index];
    if (!stored) return true;
    if (!same(decodeSourceDocument(stored).data, document.data))
      throw new Error("Create-only immutable document conflicts with an existing document.");
    return false;
  });
}

/** Test transport injection keeps the production REST request shape observable
 * without permitting a caller-selected bucket or unauthenticated production path. */
export type OwnerMediaTransport = { fetch?: typeof fetch; accessToken?: () => Promise<string> };

/** Production adapter. It uses the already-authenticated Firebase CLI token,
 * pins one private bucket, and does not discover or select arbitrary buckets. */
export async function createProductionOwnerMediaApi(mediaRoot: string, bucketName = PRIVATE_MEDIA_BUCKET, transport: OwnerMediaTransport = {}): Promise<OwnerMediaApi> {
  if (bucketName !== PRIVATE_MEDIA_BUCKET) throw new Error("Media upload bucket is not the explicitly provisioned private default bucket.");
  const require = createRequire(import.meta.url);
  const token = async () => {
    if (transport.accessToken) return transport.accessToken();
    const auth = require("firebase-tools/lib/auth.js") as { getGlobalDefaultAccount(): { tokens?: { refresh_token?: string } } | undefined; getAccessToken(refresh: string, scopes: string[]): Promise<{ access_token?: string }> };
    const refresh = auth.getGlobalDefaultAccount()?.tokens?.refresh_token;
    if (!refresh) throw new Error("Firebase CLI refresh credential is unavailable.");
    const access = await auth.getAccessToken(refresh, ["https://www.googleapis.com/auth/cloud-platform"]);
    if (!access.access_token) throw new Error("Firebase CLI access token is unavailable.");
    return access.access_token;
  };
  const fetcher = transport.fetch ?? fetch;
  const request = async (url: string, init: RequestInit = {}) => {
    const response = await fetcher(url, { ...init, headers: { Authorization: "Bearer " + await token(), "Cache-Control": "no-store", ...(init.headers ?? {}) } });
    return response;
  };
  const firestore = "https://firestore.googleapis.com/v1/projects/huroof-a3ee7/databases/(default)/documents";
  const firestoreRequest = async (url: string, init: RequestInit = {}) => {
    const response = await request(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
    if (!response.ok) throw new Error("Firestore REST " + String(init.method ?? "GET") + " " + String(response.status) + ": " + (await response.text()).slice(0, 400));
    return response;
  };
  const batchGet = async (paths: string[]) => {
    if (paths.length > 400) throw new Error("Firestore batchGet exceeds 400 documents.");
    const response = await firestoreRequest(firestore + ":batchGet", { method: "POST", body: JSON.stringify({ documents: paths.map(firestoreName) }) });
    const found = new Map(responseRows(await response.text()).filter((row) => row.found).map((row) => [sourceNamePath(row.found!.name), row.found!]));
    return paths.map((path) => found.get(path));
  };
  const create = async (documents: ReleaseDocument[]) => {
    if (!documents.length) return;
    for (let offset = 0; offset < documents.length; offset += 250) {
      const part = documents.slice(offset, offset + 250);
      // A stopped run may be resumed only where immutable existing documents
      // exactly equal the prepared payload.  Any drift remains a hard conflict.
      const pending = documentsStillToCreate(part, await batchGet(part.map((document) => document.path)));
      if (!pending.length) continue;
      const writes = pending.map((document) => ({ update: { name: firestoreName(document.path), fields: Object.fromEntries(Object.entries(document.data).map(([key, value]) => [key, encodeFirestore(value)])) }, currentDocument: { exists: false } }));
      await firestoreRequest(firestore + ":commit", { method: "POST", body: JSON.stringify({ writes }) });
    }
  };
  const listCollection = async (path: string) => {
    const result: SourceDocument[] = []; let pageToken = "";
    do {
      const response = await firestoreRequest(firestore + "/" + path + "?pageSize=1000" + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""));
      const page = await response.json() as { documents?: SourceDocument[]; nextPageToken?: string };
      result.push(...(page.documents ?? [])); pageToken = page.nextPageToken ?? "";
    } while (pageToken);
    return result;
  };
  const listCollectionIds = async (path: string) => {
    const response = await firestoreRequest("https://firestore.googleapis.com/v1/" + firestoreName(path) + ":listCollectionIds", { method: "POST", body: JSON.stringify({ pageSize: 1000 }) });
    const body = await response.json() as { collectionIds?: string[] };
    return body.collectionIds ?? [];
  };
  const objectUrl = (objectName: string) => "https://storage.googleapis.com/storage/v1/b/" + encodeURIComponent(bucketName) + "/o/" + encodeURIComponent(objectName);
  const multipartObjectUpload = (upload: PrivateMediaUpload, bytes: Uint8Array) => {
    if (Object.keys(upload.metadata).some((key) => /^(?:firebaseStorageDownloadTokens|customdownloadtoken)$/iu.test(key)))
      throw new Error("Prepared media metadata must not contain a download-token escape hatch.");
    const boundary = "owner-media-" + upload.assetSha256.slice(0, 32);
    const metadata = canonicalJson({ name: upload.objectName, contentType: upload.contentType, metadata: upload.metadata });
    const start = Buffer.from("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + metadata + "\r\n--" + boundary + "\r\nContent-Type: " + upload.contentType + "\r\n\r\n", "utf8");
    const end = Buffer.from("\r\n--" + boundary + "--\r\n", "utf8");
    return { contentType: "multipart/related; boundary=" + boundary, body: Buffer.concat([start, Buffer.from(bytes), end]) };
  };
  const objectReadback = async (upload: PrivateMediaUpload) => {
    const metadataResponse = await request(objectUrl(upload.objectName));
    if (!metadataResponse.ok) throw new Error("Private media object is absent after create-only upload.");
    const metadata = await metadataResponse.json() as { generation?: string; size?: string; contentType?: string; metadata?: Record<string, string> };
    const generation = metadata.generation;
    const customMetadata = metadata.metadata ?? {};
    if (Object.keys(customMetadata).some((key) => /^(?:firebaseStorageDownloadTokens|customdownloadtoken)$/iu.test(key)))
      throw new Error("Private media object has a download-token metadata escape hatch.");
    if (typeof generation !== "string" || !/^[1-9]\d*$/u.test(generation) || metadata.size !== String(upload.byteSize) || metadata.contentType !== upload.contentType || customMetadata.assetSha256 !== upload.assetSha256 || customMetadata.mediaId !== upload.mediaId || customMetadata.byteSize !== String(upload.byteSize) || customMetadata.width !== String(upload.width) || customMetadata.height !== String(upload.height) || (upload.durationSeconds === undefined ? customMetadata.durationSeconds !== undefined : customMetadata.durationSeconds !== String(upload.durationSeconds))) throw new Error("Private media object metadata differs from the prepared binding.");
    const gcsByteUrl = "https://storage.googleapis.com/download/storage/v1/b/" + encodeURIComponent(bucketName) + "/o/" + encodeURIComponent(upload.objectName) + "?alt=media&ifGenerationMatch=" + generation;
    const byteResponse = await request(gcsByteUrl);
    if (!byteResponse.ok) throw new Error("Private media byte readback failed.");
    const bytes = new Uint8Array(await byteResponse.arrayBuffer());
    if (bytes.length !== upload.byteSize || digest(bytes) !== upload.assetSha256) throw new Error("Private media byte hash differs from the prepared binding.");
    // These requests intentionally omit Authorization. Both byte endpoints
    // must explicitly deny the exact object before its association is written.
    const firebaseByteUrl = "https://firebasestorage.googleapis.com/v0/b/" + encodeURIComponent(bucketName) + "/o/" + encodeURIComponent(upload.objectName) + "?alt=media&ifGenerationMatch=" + generation;
    const [gcsAnonymous, firebaseAnonymous] = await Promise.all([
      fetcher(gcsByteUrl, { headers: { "Cache-Control": "no-store" } }),
      fetcher(firebaseByteUrl, { headers: { "Cache-Control": "no-store" } }),
    ]);
    assertAnonymousPrivateReadbacks(gcsAnonymous.status, firebaseAnonymous.status);
    await Promise.all([gcsAnonymous.arrayBuffer(), firebaseAnonymous.arrayBuffer()]);
    return { mediaId: upload.mediaId, assetSha256: upload.assetSha256, contentType: upload.contentType, byteSize: upload.byteSize, width: upload.width, height: upload.height, ...(upload.durationSeconds === undefined ? {} : { durationSeconds: upload.durationSeconds }), objectName: upload.objectName, generation };
  };
  return {
    metadata: async () => {
      const response = await firestoreRequest("https://firestore.googleapis.com/v1/projects/huroof-a3ee7/databases/(default)");
      const value = await response.json() as { locationId?: string; type?: string };
      return { projectId: "huroof-a3ee7", databaseId: "(default)", locationId: value.locationId ?? "", type: value.type ?? "" };
    },
    verifyBase: async (plan) => {
      const [pointer, rootValue, approval] = await batchGet(["runtime/activeRelease", root(plan).path.replace("releases/" + plan.releaseId, "releases/" + plan.base.releaseId), OWNER_APPROVAL_PATH]);
      if (!pointer || !rootValue || !approval || !same(decodeSourceDocument(rootValue).data, plan.base.root.data)) throw new Error("Captured active pointer or immutable text base drifted.");
      assertOwnerMediaApproval(decodeSourceDocument(approval).data);
      const pointerData = decodeSourceDocument(pointer).data;
      // A successful rerun is permitted to reach the later materialized
      // readback barrier, which proves this is the exact same successor.
      // Any other active pointer still fails before a write is attempted.
      if (!same(pointerData, plan.base.pointer)) {
        if (pointerData.releaseId === plan.releaseId && pointerData.baseReleaseId === plan.base.releaseId && pointerData.publicationAuthority === "owner_approval_media_extension") return;
        throw new Error("Captured active pointer or immutable text base drifted.");
      }
      const collections = (await listCollectionIds(plan.base.root.path)).sort();
      if (!same(collections, ["catalogCategories", "inventory", "questions"])) throw new Error("Immutable text base has unknown or missing child collections.");
      const expected = new Map(plan.base.children.map((document) => [document.path, document.data]));
      const actual = new Map<string, Record<string, unknown>>();
      for (const collection of collections) for (const document of await listCollection(plan.base.root.path + "/" + collection)) actual.set(sourceNamePath(document.name), decodeSourceDocument(document).data);
      if (actual.size !== expected.size || [...expected].some(([path, value]) => !same(actual.get(path), value))) throw new Error("Immutable text base child audit differs from the captured base plan.");
    },
    ensureObject: async (upload) => {
      const current = await request(objectUrl(upload.objectName));
      if (current.status === 404) {
        const local = await readFile(resolveValidatedMediaLocalFile(mediaRoot, upload));
        if (digest(local) !== upload.assetSha256 || local.length !== upload.byteSize) throw new Error("Local private media bytes drifted before upload.");
        const multipart = multipartObjectUpload(upload, local);
        const uploadUrl = "https://storage.googleapis.com/upload/storage/v1/b/" + encodeURIComponent(bucketName) + "/o?uploadType=multipart&ifGenerationMatch=0";
        const response = await request(uploadUrl, { method: "POST", headers: { "Content-Type": multipart.contentType }, body: multipart.body });
        if (!response.ok && response.status !== 412) throw new Error("Create-only Storage upload failed with " + String(response.status) + ".");
      } else if (!current.ok) throw new Error("Private media object lookup failed with " + String(current.status) + ".");
      return objectReadback(upload);
    },
    readObject: objectReadback,
    create,
    verifyRelease: async (plan, media) => {
      const collections = (await listCollectionIds(root(plan).path)).sort();
      if (!same(collections, ["catalogCategories", "inventory", "media", "questions"])) throw new Error("Release child collection audit found an unknown or missing collection.");
      const expected = new Map([...plan.documents.filter((document) => document.path !== root(plan).path), ...media].map((document) => [document.path, document.data]));
      const actual = new Map<string, Record<string, unknown>>();
      for (const collection of collections) for (const document of await listCollection(root(plan).path + "/" + collection)) actual.set(sourceNamePath(document.name), decodeSourceDocument(document).data);
      if (actual.size !== expected.size || [...expected].some(([path, value]) => !same(actual.get(path), value))) throw new Error("Release child audit differs from the exact prepared document set.");
    },
    activate: async (plan, receipt) => {
      const activation = activationReceipt(plan), pointer = rootPointerData(plan);
      const begin = await firestoreRequest(firestore + ":beginTransaction", { method: "POST", body: "{}" });
      const transaction = (await begin.json() as { transaction?: string }).transaction;
      if (!transaction) throw new Error("Activation transaction is unavailable.");
      const response = await firestoreRequest(firestore + ":batchGet", { method: "POST", body: JSON.stringify({ transaction, documents: [firestoreName(root(plan).path), firestoreName(receipt.path), firestoreName("runtime/activeRelease"), firestoreName(activation.path), firestoreName(OWNER_APPROVAL_PATH)] }) });
      const found = new Map(responseRows(await response.text()).filter((row) => row.found).map((row) => [sourceNamePath(row.found!.name), row.found!]));
      const old = found.get("runtime/activeRelease"), storedRoot = found.get(root(plan).path), storedReceipt = found.get(receipt.path), owner = found.get(OWNER_APPROVAL_PATH), storedActivation = found.get(activation.path);
      if (!old || !storedRoot || !storedReceipt || !owner || !same(decodeSourceDocument(storedRoot).data, root(plan).data) || !same(decodeSourceDocument(storedReceipt).data, receipt.data)) throw new Error("Activation CAS guard rejected the media release.");
      assertOwnerMediaApproval(decodeSourceDocument(owner).data);
      if (storedActivation) {
        if (same(decodeSourceDocument(old).data, pointer) && same(decodeSourceDocument(storedActivation).data, activation.data)) return;
        throw new Error("Activation retry conflicts with the active pointer or immutable receipt.");
      }
      if (!same(decodeSourceDocument(old).data, plan.base.pointer)) throw new Error("Activation CAS guard rejected the media release.");
      const writes = [activation, { path: "runtime/activeRelease", data: pointer }].map((document) => ({ update: { name: firestoreName(document.path), fields: Object.fromEntries(Object.entries(document.data).map(([key, value]) => [key, encodeFirestore(value)])) }, currentDocument: document.path === "runtime/activeRelease" ? { updateTime: old.updateTime } : { exists: false } }));
      await firestoreRequest(firestore + ":commit", { method: "POST", body: JSON.stringify({ transaction, writes }) });
    },
    verifyActivation: async (plan) => {
      const expectedRoot = root(plan), expectedReceipt = publicationReceipt(plan), expectedActivation = activationReceipt(plan), expectedPointer = rootPointerData(plan);
      const [pointer, rootValue, receipt, activation] = await batchGet(["runtime/activeRelease", expectedRoot.path, expectedReceipt.path, expectedActivation.path]);
      if (!pointer || !rootValue || !receipt || !activation || !same(decodeSourceDocument(pointer).data, expectedPointer) || !same(decodeSourceDocument(rootValue).data, expectedRoot.data) || !same(decodeSourceDocument(receipt).data, expectedReceipt.data) || !same(decodeSourceDocument(activation).data, expectedActivation.data)) throw new Error("Active media pointer, immutable root, or release receipts differ from the materialized prepared release.");
      const collections = (await listCollectionIds(root(plan).path)).sort();
      if (!same(collections, ["catalogCategories", "inventory", "media", "questions"])) throw new Error("Active media release has unknown or missing child collections.");
      const children: ReleaseDocument[] = [];
      for (const collection of collections) for (const document of await listCollection(root(plan).path + "/" + collection)) children.push({ path: sourceNamePath(document.name), data: decodeSourceDocument(document).data });
      const expectedChildren = new Map(plan.documents.filter((document) => document.path !== root(plan).path).map((document) => [document.path, document.data]));
      const actualChildren = new Map(children.map((document) => [document.path, document.data]));
      if (actualChildren.size !== expectedChildren.size || [...expectedChildren].some(([path, data]) => !same(actualChildren.get(path), data)) || docHash(children) !== plan.documentRootSha256) throw new Error("Active media release child readback differs from its materialized immutable payload.");
    },
    rollback: async (plan, receipt) => {
      const begin = await firestoreRequest(firestore + ":beginTransaction", { method: "POST", body: "{}" });
      const transaction = (await begin.json() as { transaction?: string }).transaction;
      if (!transaction) throw new Error("Rollback transaction is unavailable.");
      const expectedRoot = root(plan), expectedPublication = publicationReceipt(plan), expectedActivation = activationReceipt(plan), expectedPointer = rootPointerData(plan);
      const response = await firestoreRequest(firestore + ":batchGet", { method: "POST", body: JSON.stringify({ transaction, documents: [firestoreName("runtime/activeRelease"), firestoreName(expectedRoot.path), firestoreName(expectedPublication.path), firestoreName(expectedActivation.path), firestoreName(receipt.path)] }) });
      const found = new Map(responseRows(await response.text()).filter((row) => row.found).map((row) => [sourceNamePath(row.found!.name), row.found!]));
      const active = found.get("runtime/activeRelease"), activeRoot = found.get(expectedRoot.path), publication = found.get(expectedPublication.path), activation = found.get(expectedActivation.path);
      if (!active || !activeRoot || !publication || !activation || found.has(receipt.path) || !same(decodeSourceDocument(active).data, expectedPointer) || !same(decodeSourceDocument(activeRoot).data, expectedRoot.data) || !same(decodeSourceDocument(publication).data, expectedPublication.data) || !same(decodeSourceDocument(activation).data, expectedActivation.data)) throw new Error("Rollback CAS guard rejected the full materialized active media identity.");
      const recordedReceipt = receipt.data;
      const writes = [{ update: { name: firestoreName("runtime/activeRelease"), fields: Object.fromEntries(Object.entries(plan.base.pointer).map(([key, value]) => [key, encodeFirestore(value)])) }, currentDocument: { updateTime: active.updateTime } }, { update: { name: firestoreName(receipt.path), fields: Object.fromEntries(Object.entries(recordedReceipt).map(([key, value]) => [key, encodeFirestore(value)])) }, currentDocument: { exists: false } }];
      await firestoreRequest(firestore + ":commit", { method: "POST", body: JSON.stringify({ transaction, writes }) });
    },
  };
}

function parseFlags(values: string[]) {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) { const key = values[index], value = values[index + 1]; if (!key?.startsWith("--") || !value || value.startsWith("--") || parsed[key.slice(2)] !== undefined) throw new Error("Arguments must be unique --name value pairs."); parsed[key.slice(2)] = value; }
  return parsed;
}
async function main() {
  const parts = process.argv.slice(2), operation = parts.shift(), values = parseFlags(parts);
  const allowed = ["out", "plan", "bucket", "operation-reference", "base-plan", "base-pointer", "source-export", "sqlite", "media-root", "goal-questions", "manifest-hashes", "captured-at"];
  if (!operation || Object.keys(values).some((key) => !allowed.includes(key))) throw new Error("Usage: owner-media-release <prepare|apply|verify|rollback> --base-plan PATH --base-pointer PATH --source-export PATH --sqlite PATH --media-root PATH --goal-questions PATH --manifest-hashes PATH --captured-at ISO [--out PATH|--plan PATH --bucket huroof-a3ee7.firebasestorage.app]");
  const required = ["base-plan", "base-pointer", "source-export", "sqlite", "media-root", "goal-questions", "manifest-hashes", "captured-at"];
  if (required.some((key) => !values[key])) throw new Error("Media release prepare requires every authority input.");
  const [basePlan, basePointer, sourceExportText, sqliteBytes, goalPackage, manifestHashes] = await Promise.all([readFile(values["base-plan"]!, "utf8").then(JSON.parse), readFile(values["base-pointer"]!, "utf8").then(JSON.parse), readFile(values["source-export"]!, "utf8"), readFile(values.sqlite!), readFile(values["goal-questions"]!, "utf8").then(JSON.parse), readFile(values["manifest-hashes"]!, "utf8").then(JSON.parse)]);
  const input = { basePlan, basePointer, sqliteBytes, sourceExportText, sourceRecords: parseSourceExport(sourceExportText), goalPackage, mediaRoot: values["media-root"]!, manifestHashes, capturedAt: values["captured-at"]! };
  const rebuild = () => buildOwnerMediaReleasePlan(input);
  const plan = await rebuild();
  if (operation === "prepare") {
    if (!values.out || Object.keys(values).some((key) => key !== "out" && !required.includes(key))) throw new Error("prepare requires --out and every authority input.");
    await writeFile(resolve(values.out), JSON.stringify(plan, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({ operation, releaseId: plan.releaseId, approvedCount: plan.approvedCount, mediaAssets: plan.media.assetCount, superseded: plan.superseded.length, readiness: plan.readiness, exclusions: plan.exclusions, productionWrite: false }, null, 2));
    return;
  }
  if (!values.plan || !values.bucket || Object.keys(values).some((key) => key !== "plan" && key !== "bucket" && key !== "operation-reference" && !required.includes(key))) throw new Error(operation + " requires --plan, --bucket, and every authority input.");
  const stored = JSON.parse(await readFile(values.plan, "utf8")) as OwnerMediaPlan;
  if (!same(stored, plan)) throw new Error("Stored media release plan differs from the deterministic current source/base rebuild.");
  const api = await createProductionOwnerMediaApi(values["media-root"]!, values.bucket);
  if (operation === "apply") { await applyOwnerMediaRelease(stored, api, rebuild); console.log(JSON.stringify({ operation, releaseId: stored.releaseId, activated: true }, null, 2)); return; }
  if (operation === "verify") { console.log(JSON.stringify({ operation, ...(await verifyOwnerMediaRelease(stored, api)) }, null, 2)); return; }
  if (operation === "rollback") {
    if (!values["operation-reference"]) throw new Error("rollback requires --operation-reference.");
    await rollbackOwnerMediaRelease(stored, api, values["operation-reference"]);
    console.log(JSON.stringify({ operation, releaseId: stored.releaseId, restoredReleaseId: stored.base.releaseId }, null, 2)); return;
  }
  throw new Error("Unknown owner-media-release operation.");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch((error) => { console.error(error); process.exitCode = 1; });
