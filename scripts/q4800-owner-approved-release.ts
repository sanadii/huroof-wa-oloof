/**
 * T17.3b exact-source preparation.  This deliberately keeps owner approval
 * separate from factual/specialist review: supplied review text is retained as
 * source data and never used as an instruction or a review receipt.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { answerInitial, normalizeArabic, SUPPORTED_LETTERS } from "../src/question-bank.js";
import { createCategoryQuestionSelection, createMatchQuestionSelection, type RuntimeQuestionV32 } from "../src/features/game/runtime/question-selector.js";
import { canonicalJson, SAFE_DOCUMENT_ID } from "./firestore-release-canonical.js";

export const Q4800_EXPECTED_SOURCE_SHA256 = "3877f95329e49bf3bc462f68e9f540b0cc8b3e33617127a148bdcccbfd132e2c";
export const Q4800_PARSER_REVISION = "v2";
export const Q4800_CATEGORY_IDS = Array.from({ length: 12 }, (_, i) => `tahadani-${String(i + 51).padStart(3, "0")}`);
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const hash = (value: unknown) => sha(canonicalJson(value));
const equal = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const require = createRequire(import.meta.url);

export type ReleaseDocument = { path: string; data: Record<string, unknown> };
export type RestDocument = { name: string; fields: Record<string, RestValue>; updateTime?: string };
export type RestValue = Record<string, unknown>;
export type Q4800Record = { sourceId: string; categoryId: string; categoryTitleAr: string; points: number; promptAr: string; canonicalAnswer: string; acceptedAnswers: string[]; reviewProvenance: string; rawMarkdown: string; rawSha256: string };
export type Q4800Plan = {
  schemaVersion: "q4800-owner-approved-release-v2"; target: { projectId: "huroof-a3ee7"; databaseId: "(default)"; locationId: "me-central2" };
  source: { path: string; sha256: string; recordCount: 4800; categories: Record<string, number> };
  capturedBase: { releaseId: string; capturedAt: string; sha256: string; pointer: Record<string, unknown>; documentCount: number };
  ownerApproval: { authority: "owner_approval"; userInstruction: "add these to the db, make sure they are approved and ready to be used"; specialistReview: "not_claimed"; sourceReviewNotes: "preserved_as_data"; runId: string };
  reconciliation: { exactCarried: string[]; changedVersions: Array<{ sourceId: string; priorPaths: string[] }>; additions: string[]; runtimeExisting: string[]; runtimeAdded: string[]; categoryOnly: string[]; exclusions: Record<string, string[]>; conflictingPrompts: Array<{ categoryId: string; promptAr: string; sourceIds: string[]; answers: string[] }> };
  intakeDocuments: ReleaseDocument[]; approvalDocuments: ReleaseDocument[]; release: { releaseId: string; documents: ReleaseDocument[]; documentRootSha256: string; catalogSha256: string; sourceManifestSha256: string; approvedCount: number; approvedJsonlSha256: string; readiness: Record<string, { playable: boolean; detail: string; selected: number }> };
  applyContract: { createOnly: true; rootWrittenLast: true; exactReadback: true; capturedPointerCas: true; rootOnly: true; requiredLiveInputs: string[] };
};
export type Q4800ApplyAdapter = {
  getTarget(): Promise<{ projectId: string; databaseId: string; locationId: string; type: string }>;
  read(paths: string[]): Promise<Array<{ path: string; exists: boolean; data?: Record<string, unknown> }>>;
  create(documents: ReleaseDocument[]): Promise<void>;
  /** Enumerates every descendant, including documents beneath missing parents. */
  listDescendants(prefix: string): Promise<Array<{ path: string; exists: boolean; data?: Record<string, unknown> }>>;
  /** One transaction must confirm the exact captured pointer and set the new pointer/receipts. */
  activateCapturedPointer(request: { expectedPointer: Record<string, unknown>; pointer: ReleaseDocument; releaseRoot: ReleaseDocument; activationReceipt: ReleaseDocument; verificationReceipt: ReleaseDocument }): Promise<void>;
  rollbackCapturedPointer(request: { expectedPointer: Record<string, unknown>; restorePointer: ReleaseDocument; rollbackReceipt: ReleaseDocument }): Promise<void>;
};
export type Q4800GateApproval = { status: "PASS"; planCanonicalSha256: string; runnerSha256: string; sourceSha256: string; capturedBaseSha256: string };
export type Q4800TrustedInputs = { markdown: string; capturedBytes: Buffer; prior: RestDocument[]; gate: Q4800GateApproval };

export function decodeRestValue(value: RestValue): unknown {
  if (Object.hasOwn(value, "nullValue")) return null;
  if (typeof value.stringValue === "string" || typeof value.booleanValue === "boolean" || typeof value.doubleValue === "number") return value.stringValue ?? value.booleanValue ?? value.doubleValue;
  if (typeof value.integerValue === "string" && /^-?\d+$/u.test(value.integerValue)) return Number(value.integerValue);
  if (value.arrayValue && typeof value.arrayValue === "object") return (((value.arrayValue as { values?: RestValue[] }).values) ?? []).map(decodeRestValue);
  if (value.mapValue && typeof value.mapValue === "object") return Object.fromEntries(Object.entries((value.mapValue as { fields?: Record<string, RestValue> }).fields ?? {}).map(([key, child]) => [key, decodeRestValue(child)]));
  throw new Error("Unsupported Firestore REST value in captured input.");
}
export function decodeRestDocument(document: RestDocument) { const marker = "/documents/"; const index = document.name.indexOf(marker); if (index < 0) throw new Error("Captured Firestore document name is invalid."); return { path: document.name.slice(index + marker.length), data: Object.fromEntries(Object.entries(document.fields ?? {}).map(([key, value]) => [key, decodeRestValue(value)])), updateTime: document.updateTime ?? "" }; }

/** Strict parser for the supplied Markdown shape; no Markdown text is executed. */
export function parseQ4800Markdown(markdown: string): Q4800Record[] {
  const categoryAt = [...markdown.matchAll(/^## (\d{3}) — (.+)$/gmu)].map((match) => ({ index: match.index!, id: `tahadani-${match[1]}`, title: match[2]!.trim() }));
  if (categoryAt.length !== 12 || categoryAt.some((item, index) => item.id !== Q4800_CATEGORY_IDS[index])) throw new Error("Q4800 category headings must be exactly tahadani-051 through tahadani-062.");
  const headings = [...markdown.matchAll(/^#### ([A-Za-z0-9_-]+)$/gmu)]; const output: Q4800Record[] = [];
  for (let index = 0; index < headings.length; index += 1) {
    const match = headings[index]!; const rawMarkdown = markdown.slice(match.index!, index + 1 < headings.length ? headings[index + 1]!.index! : markdown.length).replace(/\s+$/u, "");
    const category = [...categoryAt].reverse().find((item) => item.index < match.index!); if (!category) throw new Error(`Question ${match[1]} has no category.`);
    const sourceId = match[1]!; const idMatch = /^(?:(?:v16|v17|v18|x400)-|legacy-v14-)tahadani-(\d{3})-(?:\d{3}|Q\d{3})$/u.exec(sourceId);
    if (!idMatch || category.id !== `tahadani-${idMatch[1]}`) throw new Error(`Unsafe or cross-category source ID: ${sourceId}.`);
    const detail = /<details>\s*\n([\s\S]*?)\n<\/details>/u.exec(rawMarkdown)?.[1]; if (!detail) throw new Error(`Question ${sourceId} lacks an answer details block.`);
    const before = rawMarkdown.slice(match[0]!.length, rawMarkdown.indexOf("<details>")).trim(); if (!before) throw new Error(`Question ${sourceId} lacks prompt text.`);
    const answer = /^\*\*(.+?)\*\*$/mu.exec(detail)?.[1]?.trim(); if (!answer) throw new Error(`Question ${sourceId} lacks a bold literal answer.`);
    const aliases = /^صيغ مقبولة:\s*(.+)$/mu.exec(detail)?.[1]?.split(/[،,]/u).map((item) => item.trim()).filter(Boolean) ?? [];
    const pointHeadings = [...markdown.slice(category.index, match.index!).matchAll(/^### (200|400|600) نقطة$/gmu)];
    const pointHeading = pointHeadings.at(-1)?.[1];
    output.push({ sourceId, categoryId: category.id, categoryTitleAr: category.title, points: Number(pointHeading ?? 0), promptAr: before, canonicalAnswer: answer, acceptedAnswers: unique([answer, ...aliases]), reviewProvenance: detail, rawMarkdown, rawSha256: sha(rawMarkdown) });
  }
  if (output.length !== 4800 || new Set(output.map((record) => record.sourceId)).size !== output.length) throw new Error("Q4800 parser did not produce exactly 4,800 unique records.");
  for (const categoryId of Q4800_CATEGORY_IDS) if (output.filter((record) => record.categoryId === categoryId).length !== 400) throw new Error(`Q4800 category ${categoryId} does not contain exactly 400 records.`);
  return output;
}

function priorSourceId(document: RestDocument) { const data = decodeRestDocument(document).data, raw = asRecord(data.raw), semantic = asRecord(data.semantic); return [raw.id, raw.question_id, raw.recordKey, semantic.key].find((value): value is string => typeof value === "string" && value.trim().length > 0); }
function sourceFingerprint(record: Q4800Record | { categoryId: string; promptAr: string; canonicalAnswer: string }) { return `${record.categoryId}\u0000${normalizeArabic(record.promptAr)}\u0000${normalizeArabic(record.canonicalAnswer)}`; }
function docHash(documents: ReleaseDocument[]) { return hash(documents.slice().sort((a, b) => a.path.localeCompare(b.path)).map(({ path, data }) => ({ path, data }))); }

function parseBase(captured: { capturedAt: string; projectId: string; releaseId: string; pointer: RestDocument; documents: RestDocument[] }, bytes: Buffer) {
  if (captured.projectId !== "huroof-a3ee7" || !SAFE_DOCUMENT_ID.test(captured.releaseId)) throw new Error("Captured base target or release ID is invalid.");
  const pointer = decodeRestDocument(captured.pointer); if (pointer.path !== "runtime/activeRelease" || pointer.data.releaseId !== captured.releaseId) throw new Error("Captured pointer does not bind the captured base release.");
  const decoded = captured.documents.map(decodeRestDocument); const root = decoded.find((document) => document.path === `releases/${captured.releaseId}`); if (!root || root.data.immutable !== true || root.data.releaseId !== captured.releaseId) throw new Error("Captured base root is missing or not immutable.");
  const children = decoded.filter((document) => document.path.startsWith(`releases/${captured.releaseId}/`));
  if (new Set(children.map((document) => document.path)).size !== children.length || children.some((document) => document.path.split("/").length !== 4)) throw new Error("Captured base contains unsupported nested or duplicate descendants.");
  return { pointer: pointer.data, root: root.data, children, capturedHash: sha(bytes) };
}

export function buildQ4800Plan(markdown: string, capturedBytes: Buffer, prior: RestDocument[], options: { sourcePath?: string } = {}): Q4800Plan {
  if (sha(markdown) !== Q4800_EXPECTED_SOURCE_SHA256) throw new Error("Q4800 source SHA-256 differs from the root-audited source.");
  const records = parseQ4800Markdown(markdown); const captured = JSON.parse(capturedBytes.toString("utf8")) as { capturedAt: string; projectId: string; releaseId: string; pointer: RestDocument; documents: RestDocument[] };
  const base = parseBase(captured, capturedBytes); const runId = `owner-approval-q4800-${Q4800_PARSER_REVISION}-${sha(markdown).slice(0, 32)}`;
  const priorById = new Map<string, RestDocument[]>(); for (const document of prior) { const id = priorSourceId(document); if (id) priorById.set(id, [...(priorById.get(id) ?? []), document]); }
  const baseQuestions = base.children.filter((document) => document.path.includes("/questions/")).map((document) => document.data as unknown as RuntimeQuestionV32);
  const baseByFingerprint = new Map(baseQuestions.map((question) => [sourceFingerprint(question), question]));
  const exactCarried: string[] = [], additions: string[] = [], runtimeExisting: string[] = [], runtimeAdded: string[] = [], categoryOnly: string[] = []; const changedVersions: Array<{ sourceId: string; priorPaths: string[] }> = []; const exclusions: Record<string, string[]> = {};
  const intakeDocuments: ReleaseDocument[] = [], approvalBindings: Array<Record<string, unknown>> = [], addedRuntime: RuntimeQuestionV32[] = [];
  for (const record of records) {
    const priorDocs = priorById.get(record.sourceId) ?? []; const fingerprint = sourceFingerprint(record); const existing = baseByFingerprint.get(fingerprint);
    if (priorDocs.length) {
      const same = priorDocs.some((document) => { const data = decodeRestDocument(document).data, raw = asRecord(data.raw), semantic = asRecord(data.semantic); return sourceFingerprint({ categoryId: record.categoryId, promptAr: String(raw.question ?? raw.questionText ?? semantic.questionText ?? ""), canonicalAnswer: String(raw.answer ?? raw.answerText ?? semantic.answerText ?? "") }) === fingerprint; });
      if (same) exactCarried.push(record.sourceId); else changedVersions.push({ sourceId: record.sourceId, priorPaths: priorDocs.map((document) => decodeRestDocument(document).path).sort() });
    } else additions.push(record.sourceId);
    const sourceContentHash = hash({ sourceId: record.sourceId, categoryId: record.categoryId, points: record.points, promptAr: record.promptAr, canonicalAnswer: record.canonicalAnswer, acceptedAnswers: record.acceptedAnswers, rawSha256: record.rawSha256 });
    const sourcePath = `questionImports/q4800-${Q4800_PARSER_REVISION}-${Q4800_EXPECTED_SOURCE_SHA256}/questions/${sourceContentHash}`;
    const targetLetter = answerInitial(record.canonicalAnswer, true); const baseAliasComplete = !!existing && record.acceptedAnswers.every((alias) => existing.acceptedAnswers.some((baseAlias) => normalizeArabic(baseAlias) === normalizeArabic(alias))); const reusableBase = !!existing && baseAliasComplete; const sourceDisposition = reusableBase ? "already_in_captured_release" : existing ? "corrected_base_alias_version" : priorDocs.length ? "changed_source_version" : "new_source_id";
    const huroofEligible = SUPPORTED_LETTERS.includes(targetLetter as typeof SUPPORTED_LETTERS[number]);
    intakeDocuments.push({ path: sourcePath, data: { schemaVersion: "q4800-source-intake-v2", recordKind: "question", inert: true, releaseEligible: !reusableBase, releaseEligibility: reusableBase ? "already_in_captured_release" : huroofEligible ? "classic_and_huroof" : "classic_category_only", approval: "owner_approved", approvalAuthority: "owner_approval", specialistReview: "not_claimed", sourceId: record.sourceId, sourceCategoryIdentifiers: [record.categoryId], contentHash: sourceContentHash, rawCanonicalSha256: record.rawSha256, raw: { sourceId: record.sourceId, categoryId: record.categoryId, categoryTitleAr: record.categoryTitleAr, points: record.points, question: record.promptAr, answer: record.canonicalAnswer, accepted_answers: record.acceptedAnswers, reviewProvenance: record.reviewProvenance, rawMarkdown: record.rawMarkdown }, lineage: { priorSourcePaths: priorDocs.map((document) => decodeRestDocument(document).path).sort(), disposition: sourceDisposition } } });
    if (reusableBase) { runtimeExisting.push(record.sourceId); approvalBindings.push({ sourceId: record.sourceId, disposition: sourceDisposition, releaseQuestionId: existing!.id, sourcePath, rawSha256: record.rawSha256 }); continue; }
    const runtime: RuntimeQuestionV32 = { id: sourceContentHash, categoryId: record.categoryId, modality: "classic", targetLetter: huroofEligible ? targetLetter : "", answerConceptId: sha(normalizeArabic(record.canonicalAnswer)), headerAr: record.categoryTitleAr, promptAr: record.promptAr, canonicalAnswer: record.canonicalAnswer, acceptedAnswers: record.acceptedAnswers };
    addedRuntime.push(runtime); runtimeAdded.push(record.sourceId); if (!huroofEligible) categoryOnly.push(record.sourceId); approvalBindings.push({ sourceId: record.sourceId, disposition: priorDocs.length ? "changed_source_version" : "new_source_id", sourcePath, sourceContentHash, rawSha256: record.rawSha256, releaseEligibility: huroofEligible ? "classic_and_huroof" : "classic_category_only" });
  }
  const approvalPath = `contentOwnerApprovals/${runId}`; const approvalEntries: ReleaseDocument[] = Array.from({ length: Math.ceil(approvalBindings.length / 100) }, (_, index) => { const bindings = approvalBindings.slice(index * 100, index * 100 + 100); return { path: `${approvalPath}/entries/chunk-${String(index + 1).padStart(5, "0")}`, data: { runId, approvalState: "owner_approved", approvalEffect: "pending_manifest", scope: "owner_approval_only", authority: "owner_approval", sourceBindings: bindings, sourceBindingsSha256: hash(bindings), immutable: true } }; }); const approvalDocuments: ReleaseDocument[] = [...approvalEntries, { path: approvalPath, data: { schemaVersion: "content-owner-approval-v2", runId, approvalState: "owner_approved", approvalEffect: "manifest_gated", scope: "owner_approval_only", authority: "owner_approval", userInstruction: "add these to the db, make sure they are approved and ready to be used", specialistReview: "not_claimed", sourceReviewNotes: "preserved_as_data", sourceSha256: Q4800_EXPECTED_SOURCE_SHA256, sourceRecordCount: 4800, immutable: true } }];
  const releaseSeed = { parserRevision: Q4800_PARSER_REVISION, baseReleaseId: captured.releaseId, baseDocumentRootSha256: base.root.documentRootSha256, sourceSha256: Q4800_EXPECTED_SOURCE_SHA256, runtimeAdded: addedRuntime.map((question) => question.id).sort() }; const releaseId = `owner-release-q4800-${hash(releaseSeed).slice(0, 32)}`;
  const copied = base.children.map((document) => ({ path: document.path.replace(`releases/${captured.releaseId}/`, `releases/${releaseId}/`), data: document.data }));
  const catalogExisting = new Set(copied.filter((document) => document.path.includes("/catalogCategories/")).map((document) => document.path.split("/").at(-1)!));
  const catalogAdds = Q4800_CATEGORY_IDS.filter((id) => !catalogExisting.has(id)).map((id) => ({ path: `releases/${releaseId}/catalogCategories/${id}`, data: { id, labelAr: records.find((record) => record.categoryId === id)!.categoryTitleAr, runtimeScope: "owner_authorized_q4800", immutable: true } }));
  const existingInventory = new Map(copied.filter((document) => document.path.includes("/inventory/")).map((document) => [document.path.split("/").at(-1)!, document]));
  const inventory = Q4800_CATEGORY_IDS.map((categoryId) => { const old = existingInventory.get(categoryId); const oldData = old?.data ?? {}; const current = Number(oldData.approvedCount ?? 0); const all = [...baseQuestions, ...addedRuntime].filter((question) => question.categoryId === categoryId); return { path: `releases/${releaseId}/inventory/${categoryId}`, data: { ...oldData, categoryId, approvedCount: current + addedRuntime.filter((question) => question.categoryId === categoryId).length, uniqueAnswerConceptCount: new Set(all.map((question) => question.answerConceptId)).size, immutable: true } }; });
  const withoutInventory = copied.filter((document) => !Q4800_CATEGORY_IDS.some((categoryId) => document.path === `releases/${releaseId}/inventory/${categoryId}`)); const addedQuestionDocs = addedRuntime.map((question) => ({ path: `releases/${releaseId}/questions/${question.id}`, data: { ...question, sourceContentHash: question.id, publicationAuthority: "owner_approval", immutable: true } }));
  const children = [...withoutInventory, ...catalogAdds, ...inventory, ...addedQuestionDocs].sort((a, b) => a.path.localeCompare(b.path)); if (new Set(children.map((document) => document.path)).size !== children.length) throw new Error("Merged release would collide with a captured immutable child path.");
  const readiness: Q4800Plan["release"]["readiness"] = {}; const mergedQuestions = [...baseQuestions, ...addedRuntime];
  for (const categoryId of Q4800_CATEGORY_IDS) { const scoped = mergedQuestions.filter((question) => question.categoryId === categoryId && question.modality === "classic"); try { const partner = Q4800_CATEGORY_IDS.find((id) => id !== categoryId && mergedQuestions.some((question) => question.categoryId === id))!; createCategoryQuestionSelection(mergedQuestions, { categories: [categoryId, partner], modality: "classic", seed: 4800 }); readiness[categoryId] = { playable: true, detail: "two-category runtime selector passed", selected: scoped.length }; } catch (error) { readiness[categoryId] = { playable: false, detail: error instanceof Error ? error.message : String(error), selected: scoped.length }; }
  }
  try { createMatchQuestionSelection(mergedQuestions, { categories: Q4800_CATEGORY_IDS, modality: "classic", seed: 4800, reservePerLetter: 3 }); } catch { /* Per-category readiness is the release criterion; global Huroof is reported by root runtime smoke. */ }
  if (Object.values(readiness).some((item) => !item.playable)) throw new Error("One or more Q4800 categories fail the runtime selector and must not be activated.");
  const catalog = children.filter((document) => document.path.includes("/catalogCategories/")); const documentRootSha256 = docHash(children); const sourceManifestSha256 = hash({ runId, sourceSha256: Q4800_EXPECTED_SOURCE_SHA256, capturedBaseSha256: base.capturedHash, intakeDocuments: intakeDocuments.map((document) => document.path), approvals: approvalDocuments.map((document) => document.path) }); const approvedCount = mergedQuestions.length; const approvedJsonlSha256 = hash(mergedQuestions.slice().sort((a, b) => a.id.localeCompare(b.id)));
  const root: ReleaseDocument = { path: `releases/${releaseId}`, data: { schemaVersion: "owner-authorized-q4800-release-v2", releaseId, immutable: true, publicationAuthority: "owner_approval", specialistReview: "not_claimed", ownerApprovalPath: approvalPath, baseReleaseId: captured.releaseId, baseDocumentRootSha256: base.root.documentRootSha256, capturedPointerSha256: hash(base.pointer), sourceManifestSha256, sourceSha256: Q4800_EXPECTED_SOURCE_SHA256, approvedCount, approvedJsonlSha256, catalogSha256: docHash(catalog), documentRootSha256, selectionPolicy: "exact captured immutable base plus owner-approved Q4800 text; raw source wording retained in inert intake records", asOf: captured.capturedAt } };
  const promptGroups = new Map<string, Q4800Record[]>(); for (const record of records) { const key = `${record.categoryId}\u0000${normalizeArabic(record.promptAr)}`; promptGroups.set(key, [...(promptGroups.get(key) ?? []), record]); } const conflictingPrompts = [...promptGroups.values()].filter((group) => new Set(group.map((record) => `${normalizeArabic(record.canonicalAnswer)}\u0000${record.acceptedAnswers.map(normalizeArabic).sort().join("\u0001")}`)).size > 1).map((group) => ({ categoryId: group[0]!.categoryId, promptAr: group[0]!.promptAr, sourceIds: group.map((record) => record.sourceId).sort(), answers: unique(group.flatMap((record) => record.acceptedAnswers)).sort() })).sort((a, b) => a.categoryId.localeCompare(b.categoryId) || a.promptAr.localeCompare(b.promptAr));
  return { schemaVersion: "q4800-owner-approved-release-v2", target: { projectId: "huroof-a3ee7", databaseId: "(default)", locationId: "me-central2" }, source: { path: options.sourcePath ?? "C:/Users/User/Downloads/ALL_QUESTIONS (2).md", sha256: Q4800_EXPECTED_SOURCE_SHA256, recordCount: 4800, categories: Object.fromEntries(Q4800_CATEGORY_IDS.map((id) => [id, 400])) }, capturedBase: { releaseId: captured.releaseId, capturedAt: captured.capturedAt, sha256: base.capturedHash, pointer: base.pointer, documentCount: captured.documents.length }, ownerApproval: { authority: "owner_approval", userInstruction: "add these to the db, make sure they are approved and ready to be used", specialistReview: "not_claimed", sourceReviewNotes: "preserved_as_data", runId }, reconciliation: { exactCarried: exactCarried.sort(), changedVersions: changedVersions.sort((a, b) => a.sourceId.localeCompare(b.sourceId)), additions: additions.sort(), runtimeExisting: runtimeExisting.sort(), runtimeAdded: runtimeAdded.sort(), categoryOnly: categoryOnly.sort(), exclusions, conflictingPrompts }, intakeDocuments: intakeDocuments.sort((a, b) => a.path.localeCompare(b.path)), approvalDocuments, release: { releaseId, documents: [...children, root], documentRootSha256, catalogSha256: docHash(catalog), sourceManifestSha256, approvedCount, approvedJsonlSha256, readiness }, applyContract: { createOnly: true, rootWrittenLast: true, exactReadback: true, capturedPointerCas: true, rootOnly: true, requiredLiveInputs: ["fresh activeRelease pointer equal to captured pointer", "fresh immutable base root and copied child readback", "fresh source-version readback for every lineage binding", "Gate approval receipt", "verified resolution of every same-prompt/different-answer report entry", "verification receipt before pointer CAS"] } };
}

const chunks = <T>(values: T[], size = 400) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
const intakeManifest = (plan: Q4800Plan): ReleaseDocument => ({ path: `questionImports/q4800-${Q4800_PARSER_REVISION}-${plan.source.sha256}`, data: { schemaVersion: "q4800-source-intake-v2", sourceSha256: plan.source.sha256, sourceRecordCount: plan.intakeDocuments.length, documentsSha256: hash(plan.intakeDocuments), approval: "owner_approved", inert: true, manifestCommitBarrier: true, immutable: true } });
const rootOf = (plan: Q4800Plan) => plan.release.documents.find((document) => document.path === `releases/${plan.release.releaseId}`)!;
const releaseChildren = (plan: Q4800Plan) => plan.release.documents.filter((document) => document.path !== rootOf(plan).path);
const verificationOf = (plan: Q4800Plan, gate: Q4800GateApproval): ReleaseDocument => ({ path: `q4800VerificationReceipts/${plan.release.releaseId}-${plan.release.documentRootSha256}`, data: { releaseId: plan.release.releaseId, documentRootSha256: plan.release.documentRootSha256, capturedBaseSha256: plan.capturedBase.sha256, gatePlanCanonicalSha256: gate.planCanonicalSha256, gateRunnerSha256: gate.runnerSha256, immutable: true } });
const pointerOf = (plan: Q4800Plan): ReleaseDocument => ({ path: "runtime/activeRelease", data: { releaseId: plan.release.releaseId, approvedCount: plan.release.approvedCount, approvedJsonlSha256: plan.release.approvedJsonlSha256, catalogSha256: plan.release.catalogSha256, documentRootSha256: plan.release.documentRootSha256, sourceManifestSha256: plan.release.sourceManifestSha256, publicationAuthority: "owner_approval", ownerApprovalPath: `contentOwnerApprovals/${plan.ownerApproval.runId}` } });
const activationOf = (plan: Q4800Plan, gate: Q4800GateApproval, verification: ReleaseDocument): ReleaseDocument => ({ path: `activationReceipts/${plan.release.releaseId}-q4800-${hash(gate)}`, data: { releaseId: plan.release.releaseId, expectedPreviousReleaseId: plan.capturedBase.releaseId, gatePlanCanonicalSha256: gate.planCanonicalSha256, verificationReceiptPath: verification.path, immutable: true } });
function assertTrustedPlan(plan: Q4800Plan, inputs: Q4800TrustedInputs) {
  const rebuilt = buildQ4800Plan(inputs.markdown, inputs.capturedBytes, inputs.prior, { sourcePath: plan.source.path });
  if (!equal(plan, rebuilt)) throw new Error("Q4800 executable plan differs from the deterministic pinned-input rebuild.");
  if (plan.reconciliation.conflictingPrompts.length) throw new Error("Q4800 unresolved same-prompt conflict report blocks activation.");
  const runnerSha256 = sha(require("node:fs").readFileSync(new URL(import.meta.url)));
  if (inputs.gate.status !== "PASS" || inputs.gate.planCanonicalSha256 !== hash(plan) || inputs.gate.runnerSha256 !== runnerSha256 || inputs.gate.sourceSha256 !== plan.source.sha256 || inputs.gate.capturedBaseSha256 !== plan.capturedBase.sha256) throw new Error("Q4800 Gate receipt is absent, non-PASS, or not bound to this plan, runner, source, and captured base.");
}
async function assertExactPrefix(adapter: Q4800ApplyAdapter, prefix: string, expected: ReleaseDocument[], allowExactSubset = false) {
  const actual = new Map((await adapter.listDescendants(prefix)).filter((item) => item.exists).map((item) => [item.path, item.data])); const wanted = new Map(expected.map((item) => [item.path, item.data]));
  if (process.env.Q4800_APPLY_PROGRESS === "1") console.error(`[Q4800] recursive inventory ${prefix}: ${actual.size} documents checked.`);
  if ((!allowExactSubset && actual.size !== wanted.size) || [...actual].some(([path, data]) => !wanted.has(path) || !equal(data, wanted.get(path)))) throw new Error(`Q4800 recursive inventory differs at ${prefix}.`);
  return actual;
}
async function createExact(adapter: Q4800ApplyAdapter, documents: ReleaseDocument[]) {
  for (const batch of chunks(documents)) {
    const current = new Map((await adapter.read(batch.map((document) => document.path))).map((item) => [item.path, item])); const pending: ReleaseDocument[] = [];
    for (const document of batch) { const found = current.get(document.path); if (!found?.exists) pending.push(document); else if (!equal(found.data, document.data)) throw new Error(`Immutable Q4800 conflict: ${document.path}`); }
    if (pending.length) await adapter.create(pending);
    const readback = await adapter.read(batch.map((document) => document.path)); for (let index = 0; index < batch.length; index += 1) if (!readback[index]?.exists || !equal(readback[index]!.data, batch[index]!.data)) throw new Error(`Q4800 exact readback differs: ${batch[index]!.path}`);
  }
}
/** Root-only cloud lifecycle. It is testable through this narrow adapter and never runs from prepare mode. */
export async function applyQ4800Plan(plan: Q4800Plan, adapter: Q4800ApplyAdapter, inputs: Q4800TrustedInputs) {
  assertTrustedPlan(plan, inputs);
  const target = await adapter.getTarget(); if (target.projectId !== plan.target.projectId || target.databaseId !== plan.target.databaseId || target.locationId !== plan.target.locationId || target.type !== "FIRESTORE_NATIVE") throw new Error("Q4800 target is not the pinned production Firestore database.");
  const verificationReceipt = verificationOf(plan, inputs.gate), activationReceipt = activationOf(plan, inputs.gate, verificationReceipt), pointerDoc = pointerOf(plan);
  const [pointer] = await adapter.read(["runtime/activeRelease"]);
  if (pointer?.exists && equal(pointer.data, pointerDoc.data)) { await assertExactPrefix(adapter, `questionImports/q4800-${Q4800_PARSER_REVISION}-${plan.source.sha256}`, [...plan.intakeDocuments, intakeManifest(plan)]); await assertExactPrefix(adapter, `contentOwnerApprovals/${plan.ownerApproval.runId}`, plan.approvalDocuments); await assertExactPrefix(adapter, `releases/${plan.release.releaseId}`, plan.release.documents); const receipts = await adapter.read([verificationReceipt.path, activationReceipt.path]); if (!receipts.every((item, index) => item.exists && equal(item.data, [verificationReceipt, activationReceipt][index]!.data))) throw new Error("Q4800 already-active release lacks exact immutable activation evidence."); return { releaseId: plan.release.releaseId, activated: true, idempotent: true, createdPlanDocuments: 0 }; }
  if (!pointer?.exists || !equal(pointer.data, plan.capturedBase.pointer)) throw new Error("Q4800 captured active pointer changed; refusing a stale successor release.");
  const captured = JSON.parse(inputs.capturedBytes.toString("utf8")) as { releaseId: string; documents: RestDocument[] }; const decoded = captured.documents.map(decodeRestDocument); const predecessor = decoded.filter((document) => document.path === `releases/${captured.releaseId}` || document.path.startsWith(`releases/${captured.releaseId}/`)).map(({ path, data }) => ({ path, data })); await assertExactPrefix(adapter, `releases/${captured.releaseId}`, predecessor);
  const priorByPath = new Map(inputs.prior.map((document) => { const item = decodeRestDocument(document); return [item.path, item.data] as const; })); const lineagePaths = [...new Set(plan.intakeDocuments.flatMap((document) => { const paths = asRecord(document.data.lineage).priorSourcePaths; return Array.isArray(paths) ? paths.filter((path): path is string => typeof path === "string") : []; }))].sort(); for (const batch of chunks(lineagePaths)) { const current = new Map((await adapter.read(batch)).map((item) => [item.path, item])); for (const path of batch) if (!current.get(path)?.exists || !equal(current.get(path)?.data, priorByPath.get(path))) throw new Error(`Q4800 historical source lineage differs: ${path}`); }
  const intakeExpected = [...plan.intakeDocuments, intakeManifest(plan)]; const approvalExpected = plan.approvalDocuments; const releaseExpected = plan.release.documents;
  const intakeExisting = await assertExactPrefix(adapter, `questionImports/q4800-${Q4800_PARSER_REVISION}-${plan.source.sha256}`, intakeExpected, true); const approvalExisting = await assertExactPrefix(adapter, `contentOwnerApprovals/${plan.ownerApproval.runId}`, approvalExpected, true); const releaseExisting = await assertExactPrefix(adapter, `releases/${plan.release.releaseId}`, releaseExpected, true);
  const approvalManifest = plan.approvalDocuments.find((document) => document.path === `contentOwnerApprovals/${plan.ownerApproval.runId}`)!; const successorRoot = rootOf(plan); const intakeParent = intakeManifest(plan);
  if ((intakeExisting.has(intakeParent.path) && intakeExisting.size !== intakeExpected.length) || (approvalExisting.has(approvalManifest.path) && approvalExisting.size !== approvalExpected.length) || (releaseExisting.has(successorRoot.path) && releaseExisting.size !== releaseExpected.length)) throw new Error("Q4800 interrupted state violates an immutable manifest/root commit barrier.");
  await createExact(adapter, plan.intakeDocuments); await assertExactPrefix(adapter, `questionImports/q4800-${Q4800_PARSER_REVISION}-${plan.source.sha256}`, intakeExisting.has(intakeParent.path) ? intakeExpected : plan.intakeDocuments); await createExact(adapter, [intakeParent]); await assertExactPrefix(adapter, `questionImports/q4800-${Q4800_PARSER_REVISION}-${plan.source.sha256}`, intakeExpected);
  const approvalEntries = plan.approvalDocuments.filter((document) => document.path !== approvalManifest.path); await createExact(adapter, approvalEntries); await assertExactPrefix(adapter, `contentOwnerApprovals/${plan.ownerApproval.runId}`, approvalExisting.has(approvalManifest.path) ? approvalExpected : approvalEntries); await createExact(adapter, [approvalManifest]); await assertExactPrefix(adapter, `contentOwnerApprovals/${plan.ownerApproval.runId}`, approvalExpected);
  const successorChildren = releaseChildren(plan); await createExact(adapter, successorChildren); await assertExactPrefix(adapter, `releases/${plan.release.releaseId}`, releaseExisting.has(successorRoot.path) ? releaseExpected : successorChildren); await createExact(adapter, [successorRoot]); await assertExactPrefix(adapter, `releases/${plan.release.releaseId}`, releaseExpected); await createExact(adapter, [verificationReceipt]);
  await adapter.activateCapturedPointer({ expectedPointer: plan.capturedBase.pointer, pointer: pointerDoc, releaseRoot: rootOf(plan), activationReceipt, verificationReceipt }); return { releaseId: plan.release.releaseId, activated: true, idempotent: false, createdPlanDocuments: plan.intakeDocuments.length + plan.approvalDocuments.length + plan.release.documents.length + 2 };
}

export async function rollbackQ4800Plan(plan: Q4800Plan, adapter: Q4800ApplyAdapter, inputs: Q4800TrustedInputs) { assertTrustedPlan(plan, inputs); const current = pointerOf(plan); const rollbackReceipt: ReleaseDocument = { path: `rollbackReceipts/${plan.release.releaseId}-q4800-${hash(inputs.gate)}`, data: { releaseId: plan.release.releaseId, restoreReleaseId: plan.capturedBase.releaseId, gatePlanCanonicalSha256: inputs.gate.planCanonicalSha256, immutable: true } }; await adapter.rollbackCapturedPointer({ expectedPointer: current.data, restorePointer: { path: "runtime/activeRelease", data: plan.capturedBase.pointer }, rollbackReceipt }); return { rolledBack: true, restoreReleaseId: plan.capturedBase.releaseId }; }

/** Lazily loaded production adapter; prepare/validate never initialize credentials or write cloud state. */
export async function createQ4800ProductionAdapter(): Promise<Q4800ApplyAdapter> {
  if (!process.execArgv.includes("--use-system-ca") || process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.GOOGLE_API_USE_MTLS_ENDPOINT) throw new Error("Q4800 production adapter requires node --use-system-ca and rejects emulator/endpoint redirection.");
  const account = (require("firebase-tools/lib/auth.js") as { getGlobalDefaultAccount: () => { tokens?: { refresh_token?: string } } | undefined }).getGlobalDefaultAccount(); const refresh = account?.tokens?.refresh_token; if (!refresh) throw new Error("Firebase CLI authorized-user refresh credential is unavailable."); const api = require("firebase-tools/lib/api.js") as { clientId: () => string; clientSecret: () => string }; const credentials = { type: "authorized_user" as const, client_id: api.clientId(), client_secret: api.clientSecret(), refresh_token: refresh };
  const { GoogleAuth } = await import("google-auth-library"); const auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/cloud-platform"] }); const client = await auth.getClient(); const cloud = await import("@google-cloud/firestore"); const db = new cloud.Firestore({ projectId: "huroof-a3ee7", databaseId: "(default)", authClient: client });
  const exact = (snapshot: { exists: boolean; data: () => unknown }, data: Record<string, unknown>) => snapshot.exists && equal(snapshot.data(), data);
  const walk = async (root: any): Promise<Array<{ path: string; exists: boolean; data?: Record<string, unknown> }>> => {
    const out: Array<{ path: string; exists: boolean; data?: Record<string, unknown> }> = []; const frontier = [root]; const parallelism = 48;
    while (frontier.length) {
      const references = frontier.splice(0, parallelism); const snapshots = await db.getAll(...references);
      for (const snapshot of snapshots) if (snapshot.exists) out.push({ path: snapshot.ref.path, exists: true, data: snapshot.data() as Record<string, unknown> });
      const collectionsByReference = await Promise.all(references.map((reference: any) => reference.listCollections()));
      const collections = collectionsByReference.flat(); const children = await Promise.all(collections.map((collection: any) => collection.listDocuments()));
      frontier.push(...children.flat());
    }
    return out;
  };
  return {
    getTarget: async () => { const response = await client.request<{ locationId?: string; type?: string }>({ url: "https://firestore.googleapis.com/v1/projects/huroof-a3ee7/databases/(default)" }); return { projectId: "huroof-a3ee7", databaseId: "(default)", locationId: response.data.locationId ?? "", type: response.data.type ?? "" }; },
    read: async (paths) => (await db.getAll(...paths.map((path) => db.doc(path)))).map((snapshot) => ({ path: snapshot.ref.path, exists: snapshot.exists, data: snapshot.exists ? snapshot.data() as Record<string, unknown> : undefined })),
    create: async (documents) => { const batch = db.batch(); for (const document of documents) batch.create(db.doc(document.path), document.data); await batch.commit(); },
    listDescendants: async (prefix) => walk(db.doc(prefix)),
    activateCapturedPointer: async (request) => { await db.runTransaction(async (transaction) => { const [pointer, root, verification, activation] = await Promise.all([transaction.get(db.doc("runtime/activeRelease")), transaction.get(db.doc(request.releaseRoot.path)), transaction.get(db.doc(request.verificationReceipt.path)), transaction.get(db.doc(request.activationReceipt.path))]); if (!exact(pointer, request.expectedPointer)) throw new Error("Q4800 pointer CAS failed."); if (!exact(root, request.releaseRoot.data) || !exact(verification, request.verificationReceipt.data) || activation.exists) throw new Error("Q4800 activation prerequisites differ."); transaction.create(db.doc(request.activationReceipt.path), request.activationReceipt.data); transaction.set(db.doc(request.pointer.path), request.pointer.data); }); },
    rollbackCapturedPointer: async (request) => { await db.runTransaction(async (transaction) => { const [pointer, receipt] = await Promise.all([transaction.get(db.doc("runtime/activeRelease")), transaction.get(db.doc(request.rollbackReceipt.path))]); if (!exact(pointer, request.expectedPointer) || receipt.exists) throw new Error("Q4800 rollback CAS failed."); transaction.create(db.doc(request.rollbackReceipt.path), request.rollbackReceipt.data); transaction.set(db.doc(request.restorePointer.path), request.restorePointer.data); }); },
  };
}

const runnerSha256 = () => sha(require("node:fs").readFileSync(new URL(import.meta.url)));
function parseGateApproval(value: unknown): Q4800GateApproval {
  const receipt = asRecord(value); const required = ["status", "planCanonicalSha256", "runnerSha256", "sourceSha256", "capturedBaseSha256"];
  if (Object.keys(receipt).length !== required.length || required.some((key) => typeof receipt[key] !== "string") || receipt.status !== "PASS") throw new Error("Q4800 Gate receipt must be an exact PASS binding with plan, runner, source, and captured-base hashes.");
  return receipt as unknown as Q4800GateApproval;
}
async function trustedInputsFor(plan: Q4800Plan, gatePath: string): Promise<Q4800TrustedInputs> {
  const [markdown, capturedBytes, priorBytes, gateBytes] = await Promise.all([readFile(resolve(plan.source.path), "utf8"), readFile("output/q4800-20260912/live-base.json"), readFile("output/firebase-activation-20260911/approval-question-backup.json", "utf8"), readFile(resolve(gatePath), "utf8")]);
  return { markdown, capturedBytes, prior: JSON.parse(priorBytes) as RestDocument[], gate: parseGateApproval(JSON.parse(gateBytes)) };
}
export async function writeQ4800Package(outputDirectory: string, markdownPath: string, capturedPath: string, priorPath: string) {
  const [markdown, captured, priorBytes] = await Promise.all([readFile(markdownPath, "utf8"), readFile(capturedPath), readFile(priorPath, "utf8")]); const plan = buildQ4800Plan(markdown, captured, JSON.parse(priorBytes) as RestDocument[], { sourcePath: markdownPath }); await mkdir(outputDirectory, { recursive: true });
  const preparedBinding = { planCanonicalSha256: hash(plan), runnerSha256: runnerSha256(), sourceSha256: plan.source.sha256, capturedBaseSha256: plan.capturedBase.sha256, cloudMutated: false, gateStatus: "pending_independent_gate" };
  const requirements = `# Q4800 root-only release apply\n\nThis package performs no cloud mutation. The runner reconstructs the plan from the pinned raw Markdown, captured base, and historical source snapshot before every apply or rollback. It then checks a PASS Gate receipt, production project/database/location, the fresh captured pointer, full recursive predecessor inventory, every historical lineage document, and empty successor prefixes. It creates exact documents in bounded batches, writes manifests only after children, writes the release root last, audits recursive readback, then transacts the exact pointer/root/verification commitments. Set \`Q4800_APPLY_PROGRESS=1\` to print recursive-audit document counts.\n\nUse exactly:\n\`\`\`powershell\n$env:Q4800_ROOT_APPLY='1'\n$env:Q4800_APPLY_PROGRESS='1'\nnode --use-system-ca --import tsx scripts/q4800-owner-approved-release.ts apply output/q4800-20260912/q4800-plan.json --gate-receipt output/q4800-20260912/GATE-APPROVAL.json\n\`\`\`\n\nThe Gate receipt is a JSON object with exactly \`status: "PASS"\`, \`planCanonicalSha256\`, \`runnerSha256\`, \`sourceSha256\`, and \`capturedBaseSha256\`; all hashes must equal \`PREPARED-BINDING.json\` at the moment of review. Owner approval is not specialist or factual review. Conditional rollback uses the same command with \`rollback\` and refuses if any later release owns the pointer.\n`;
  await Promise.all([writeFile(resolve(outputDirectory, "q4800-plan.json"), `${canonicalJson(plan)}\n`), writeFile(resolve(outputDirectory, "PREPARED-BINDING.json"), `${canonicalJson(preparedBinding)}\n`), writeFile(resolve(outputDirectory, "SOURCE-ACCOUNTING.json"), `${canonicalJson({ source: plan.source, reconciliation: plan.reconciliation, approval: plan.ownerApproval, release: { releaseId: plan.release.releaseId, approvedCount: plan.release.approvedCount, readiness: plan.release.readiness }, cloudMutated: false })}\n`), writeFile(resolve(outputDirectory, "CONFLICT-REPORT.json"), `${canonicalJson({ samePromptDifferentAnswerOrAliases: plan.reconciliation.conflictingPrompts, resolutionRequiredBeforeActivation: plan.reconciliation.conflictingPrompts.length > 0, cloudMutated: false })}\n`), writeFile(resolve(outputDirectory, "APPLY-REQUIREMENTS.md"), requirements)]); return plan;
}

async function main() { const [command, ...args] = process.argv.slice(2); if (command === "prepare") { const [output = "output/q4800-20260912", source = "C:/Users/User/Downloads/ALL_QUESTIONS (2).md", captured = "output/q4800-20260912/live-base.json", prior = "output/firebase-activation-20260911/approval-question-backup.json"] = args; const plan = await writeQ4800Package(resolve(output), resolve(source), resolve(captured), resolve(prior)); console.log(canonicalJson({ command, releaseId: plan.release.releaseId, sourceRecords: plan.source.recordCount, carried: plan.reconciliation.exactCarried.length, runtimeAdded: plan.reconciliation.runtimeAdded.length, approvedCount: plan.release.approvedCount, cloudMutated: false })); return; } if (command === "apply" || command === "rollback") { const [planPath, flag, gateReceipt] = args; if (process.env.Q4800_ROOT_APPLY !== "1" || flag !== "--gate-receipt" || !gateReceipt) throw new Error("Root-only operation requires Q4800_ROOT_APPLY=1 and --gate-receipt <Gate receipt path>."); const plan = JSON.parse(await readFile(resolve(planPath), "utf8")) as Q4800Plan; const inputs = await trustedInputsFor(plan, gateReceipt); const adapter = await createQ4800ProductionAdapter(); const result = command === "apply" ? await applyQ4800Plan(plan, adapter, inputs) : await rollbackQ4800Plan(plan, adapter, inputs); console.log(canonicalJson({ command, ...result })); return; } throw new Error("Usage: tsx scripts/q4800-owner-approved-release.ts <prepare|apply|rollback> ..."); }
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
