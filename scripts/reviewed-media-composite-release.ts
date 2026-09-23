/** D17.5 offline composite release preparation. It never activates a pointer. */
import { createHash, verify } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalJson } from "./firestore-release-canonical.js";
import { assertExternalV33TrustRootPath, type FirestoreReleasePlan, type ReleaseDocument } from "./build-firestore-release.js";
import { receiptHashV33, receiptSigningPayloadV33, type V33ReviewReceipt, type V33TrustRoot } from "../src/question-bank-v3.3.js";

const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const rawHash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const validHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const safeId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,120}$/u.test(value);
const goalId = /^goal-quiz-2026-(\d{3})$/u;
const goalMediaId = /^goal-quiz-2026:(\d{3}):(blur|clean)$/u;
const requiredGoalRoles = ["fact_reviewer", "language_reviewer", "video_rights_reviewer"] as const;
const requiredImageRoles = ["fact_reviewer", "language_reviewer", "image_rights_reviewer"] as const;

export type ReviewedGoalMedia = { mediaId: string; assetSha256: string; objectName: string; generation: string; contentType: "video/mp4" | "image/png" | "image/jpeg"; byteSize: number; width: number; height: number; durationSeconds?: number };
export type ReviewedGoalQuestion = { id: string; headerAr: string; promptAr: string; canonicalAnswer: string; acceptedAnswers: string[]; answerConceptId: string; authorUid: string; evidenceHash: string; policyHash: string; contentHash: string; promptMediaId: string; answerMediaId: string; reviewReceiptIds: string[] };
export type ReviewedImageAddition = Omit<ReviewedGoalQuestion, "promptMediaId" | "answerMediaId"> & { categoryId: string; mediaId: string; answerMediaId?: string };
export type ReviewedGoalSupplement = { schemaVersion: "question-media-supplement-v1"; category: { id: "goals-2026"; labelAr: string }; asOf: string; /** SHA-256 of exact canonical trusted-authority JSON bytes. */ trustRootSha256: string; reviewReportHash: string; questions: ReviewedGoalQuestion[]; imageQuestions?: ReviewedImageAddition[]; media: ReviewedGoalMedia[]; receipts: V33ReviewReceipt[]; contentHash: string };
export type ReviewedSupplementReviewReport = { schemaVersion: "question-media-review-report-v1"; supplementSubjectHash: string; trustRootSha256: string; receiptIds: string[]; reviewedAt: string };
export type TrustedReviewedAuthority = { trust: V33TrustRoot; rawSha256: string };
export type TrustedReviewedReport = { report: ReviewedSupplementReviewReport; rawSha256: string };

const documentsHash = (documents: ReleaseDocument[]) => hash(documents.slice().sort((a, b) => a.path.localeCompare(b.path)).map(({ path, data }) => ({ path, data })));
const nonceHash = (nonce: string) => rawHash(nonce);
export const reviewedGoalSupplementHash = (value: Omit<ReviewedGoalSupplement, "contentHash"> | ReviewedGoalSupplement) => hash({ schemaVersion: value.schemaVersion, category: value.category, asOf: value.asOf, trustRootSha256: value.trustRootSha256, reviewReportHash: value.reviewReportHash, questions: value.questions, imageQuestions: value.imageQuestions ?? [], media: value.media, receipts: value.receipts });
/** This review subject deliberately excludes the report hash, avoiding a circular review commitment. */
export const reviewedSupplementSubjectHash = (value: ReviewedGoalSupplement) => hash({ schemaVersion: value.schemaVersion, category: value.category, asOf: value.asOf, trustRootSha256: value.trustRootSha256, questions: value.questions, imageQuestions: value.imageQuestions ?? [], media: value.media, receipts: value.receipts });

/** Binds answer text, media roles, and exact immutable asset values before receipt checks. */
export const reviewedQuestionContentHash = (question: Omit<ReviewedGoalQuestion, "contentHash"> | ReviewedGoalQuestion | ReviewedImageAddition, categoryId: string, modality: "video" | "image", promptMedia: ReviewedGoalMedia, answerMedia?: ReviewedGoalMedia) => hash({
  id: question.id, categoryId, modality, headerAr: question.headerAr, promptAr: question.promptAr, canonicalAnswer: question.canonicalAnswer, acceptedAnswers: question.acceptedAnswers, answerConceptId: question.answerConceptId, authorUid: question.authorUid, evidenceHash: question.evidenceHash, policyHash: question.policyHash,
  promptMedia: { mediaId: promptMedia.mediaId, assetSha256: promptMedia.assetSha256, objectName: promptMedia.objectName, generation: promptMedia.generation, contentType: promptMedia.contentType, byteSize: promptMedia.byteSize, width: promptMedia.width, height: promptMedia.height, durationSeconds: promptMedia.durationSeconds ?? null },
  answerMedia: answerMedia ? { mediaId: answerMedia.mediaId, assetSha256: answerMedia.assetSha256, objectName: answerMedia.objectName, generation: answerMedia.generation, contentType: answerMedia.contentType, byteSize: answerMedia.byteSize, width: answerMedia.width, height: answerMedia.height, durationSeconds: answerMedia.durationSeconds ?? null } : null,
  reviewReceiptIds: question.reviewReceiptIds.slice().sort(),
});

function validAuthority(authority: TrustedReviewedAuthority): boolean { return validHash(authority.rawSha256) && authority.rawSha256 === rawHash(canonicalJson(authority.trust)) && !Number.isNaN(Date.parse(authority.trust.now)) && typeof authority.trust.issuers === "object" && authority.trust.issuers !== null; }
function verifiedReceipt(receipt: V33ReviewReceipt, question: Pick<ReviewedGoalQuestion, "id" | "authorUid" | "contentHash" | "evidenceHash" | "policyHash">, categoryId: string, roles: readonly string[], trust: V33TrustRoot, asOf: string): boolean {
  const issuer = trust.issuers[receipt.issuer] as { keys?: Record<string, string>; publicKeys?: Record<string, string>; roles?: string[]; reviewers?: Record<string, string[]> } | undefined;
  const key = issuer?.keys?.[receipt.signerKeyId] ?? issuer?.publicKeys?.[receipt.signerKeyId];
  if (!key || !roles.includes(receipt.reviewerRole) || !issuer?.roles?.includes(receipt.reviewerRole) || !issuer.reviewers?.[receipt.reviewerUid]?.includes(receipt.reviewerRole) || receipt.version !== 1 || receipt.verdict !== "approved" || receipt.receiptHash !== receiptHashV33(receipt) || receipt.questionId !== question.id || receipt.categoryId !== categoryId || receipt.authorUid !== question.authorUid || receipt.reviewerUid === question.authorUid || receipt.questionContentHash !== question.contentHash || receipt.evidenceHash !== question.evidenceHash || receipt.policyHash !== question.policyHash || receipt.mediaHash !== null || typeof receipt.reviewRequestNonce !== "string" || !receipt.reviewRequestNonce || Number.isNaN(Date.parse(receipt.issuedAt)) || Date.parse(receipt.issuedAt) < Date.parse(asOf) || Date.parse(receipt.issuedAt) > Date.parse(trust.now)) return false;
  try { return verify(null, Buffer.from(receiptSigningPayloadV33(receipt)), key, Buffer.from(receipt.signature, "base64")); } catch { return false; }
}
function validMedia(media: ReviewedGoalMedia, mode: "goal" | "image"): boolean {
  if (!validHash(media.assetSha256) || !/^\d{1,32}$/u.test(media.generation) || !Number.isInteger(media.byteSize) || media.byteSize < 1 || media.byteSize > 1_000_000 || !Number.isInteger(media.width) || media.width < 1 || !Number.isInteger(media.height) || media.height < 1) return false;
  if (mode === "goal") return media.contentType === "video/mp4" && goalMediaId.test(media.mediaId) && media.objectName === `question-media/goal-quiz-2026/assets/${media.assetSha256}.mp4` && typeof media.durationSeconds === "number" && Number.isFinite(media.durationSeconds) && media.durationSeconds > 0;
  return (media.contentType === "image/png" && /^v18-(?:tahadani-)?(?:011|012|014|061)-\d{3}$/u.test(media.mediaId) && media.objectName === `question-media/v18/${media.assetSha256}.png`) || (media.contentType === "image/jpeg" && /^rebuild-v2-photo-011-\d{3}$/u.test(media.mediaId) && media.objectName === `question-media/guess-picture-rebuild-v2/assets/${media.assetSha256}.jpg`);
}
function requireReviewSet(question: Pick<ReviewedGoalQuestion, "reviewReceiptIds">, receiptsById: Map<string, V33ReviewReceipt>, base: Pick<ReviewedGoalQuestion, "id" | "authorUid" | "contentHash" | "evidenceHash" | "policyHash">, categoryId: string, roles: readonly string[], trust: V33TrustRoot, asOf: string): void {
  if (question.reviewReceiptIds.length !== roles.length || new Set(question.reviewReceiptIds).size !== roles.length) throw new Error("Reviewed supplement has an incomplete receipt set.");
  const receipts = question.reviewReceiptIds.map((id) => receiptsById.get(id));
  if (receipts.some((item) => !item) || new Set(receipts.map((item) => item!.reviewerRole)).size !== roles.length || roles.some((role) => !receipts.some((item) => item!.reviewerRole === role && verifiedReceipt(item!, base, categoryId, roles, trust, asOf)))) throw new Error("Reviewed supplement receipts are invalid.");
}

function validateBase(base: FirestoreReleasePlan): { children: ReleaseDocument[]; inheritedNonceClaims: string[] } {
  const rootPath = `releases/${base.releaseId}`;
  if (!safeId(base.releaseId) || !validHash(base.documentRootSha256) || !validHash(base.catalogSha256) || !validHash(base.sourceManifestSha256) || !validHash(base.approvedJsonlSha256) || !Number.isInteger(base.approvedCount) || base.approvedCount < 300 || Number.isNaN(Date.parse(base.asOf)) || new Set(base.documents.map((item) => item.path)).size !== base.documents.length) throw new Error("Composite requires a complete exact V3.3 base release plan.");
  const roots = base.documents.filter((document) => document.path === rootPath), children = base.documents.filter((document) => document.path !== rootPath);
  if (roots.length !== 1 || children.some((document) => !document.path.startsWith(`${rootPath}/`) || document.path === "runtime/activeRelease")) throw new Error("Composite base release paths are invalid.");
  const root = roots[0];
  if (root.data.immutable !== true || root.data.releaseId !== base.releaseId || root.data.asOf !== base.asOf || root.data.approvedCount !== base.approvedCount || root.data.catalogSha256 !== base.catalogSha256 || root.data.documentRootSha256 !== base.documentRootSha256 || root.data.sourceManifestSha256 !== base.sourceManifestSha256 || root.data.questionBankVersion !== "3.3.0" || documentsHash(children) !== base.documentRootSha256) throw new Error("Composite base root provenance/child commitment is invalid.");
  const catalog = children.filter((document) => document.path.startsWith(`${rootPath}/catalogCategories/`)), questions = children.filter((document) => document.path.startsWith(`${rootPath}/questions/`)), inventory = children.filter((document) => document.path.startsWith(`${rootPath}/inventory/`));
  if (catalog.length !== 62 || questions.length !== base.approvedCount || inventory.length !== 62 || documentsHash(catalog) !== base.catalogSha256 || catalog.some((document) => !safeId(document.path.slice(`${rootPath}/catalogCategories/`.length)) || document.data.id !== document.path.slice(`${rootPath}/catalogCategories/`.length) || typeof document.data.labelAr !== "string" || !document.data.labelAr.trim())) throw new Error("Composite base catalog or question commitments are invalid.");
  const inventoryTotal = inventory.reduce((total, document) => total + (Number.isInteger(document.data.approvedCount) ? Number(document.data.approvedCount) : Number.NaN), 0);
  if (inventoryTotal !== base.approvedCount || inventory.some((document) => !safeId(document.path.slice(`${rootPath}/inventory/`.length)) || document.data.categoryId !== document.path.slice(`${rootPath}/inventory/`.length))) throw new Error("Composite base inventory is invalid.");
  const inheritedNonceClaims = base.reviewNonceClaimHashes ?? [];
  if (!inheritedNonceClaims.length || inheritedNonceClaims.some((item) => !validHash(item)) || inheritedNonceClaims.length !== new Set(inheritedNonceClaims).size || inheritedNonceClaims.some((item, index) => index > 0 && inheritedNonceClaims[index - 1] >= item)) throw new Error("Composite base review-nonce provenance is missing or invalid.");
  return { children, inheritedNonceClaims };
}
function validateSupplement(supplement: ReviewedGoalSupplement, authority: TrustedReviewedAuthority, trustedReport: TrustedReviewedReport): { media: Map<string, ReviewedGoalMedia>; imageQuestions: ReviewedImageAddition[]; supplementNonceClaims: string[] } {
  const report = trustedReport.report;
  if (!validAuthority(authority) || !validHash(trustedReport.rawSha256) || trustedReport.rawSha256 !== rawHash(canonicalJson(report)) || supplement.schemaVersion !== "question-media-supplement-v1" || supplement.category.id !== "goals-2026" || !supplement.category.labelAr.trim() || supplement.trustRootSha256 !== authority.rawSha256 || supplement.reviewReportHash !== trustedReport.rawSha256 || supplement.contentHash !== reviewedGoalSupplementHash(supplement) || Number.isNaN(Date.parse(supplement.asOf)) || report.schemaVersion !== "question-media-review-report-v1" || report.supplementSubjectHash !== reviewedSupplementSubjectHash(supplement) || report.trustRootSha256 !== authority.rawSha256 || Number.isNaN(Date.parse(report.reviewedAt)) || Date.parse(report.reviewedAt) < Date.parse(supplement.asOf) || Date.parse(report.reviewedAt) > Date.parse(authority.trust.now) || report.receiptIds.length !== supplement.receipts.length || canonicalJson(report.receiptIds.slice().sort()) !== canonicalJson(supplement.receipts.map((receipt) => receipt.receiptId).sort())) throw new Error("Reviewed goal supplement identity, review report, or trusted authority is invalid.");
  if (supplement.questions.length !== 99 || new Set(supplement.questions.map((question) => question.id)).size !== 99 || new Set(supplement.media.map((item) => item.mediaId)).size !== supplement.media.length || new Set(supplement.media.map((item) => item.assetSha256)).size !== supplement.media.length || new Set(supplement.receipts.map((item) => item.receiptId)).size !== supplement.receipts.length) throw new Error("Reviewed goal supplement has duplicate or incomplete records.");
  const media = new Map(supplement.media.map((item) => [item.mediaId, item])), receiptsById = new Map(supplement.receipts.map((item) => [item.receiptId, item]));
  const allNonceClaims = supplement.receipts.map((item) => nonceHash(item.reviewRequestNonce));
  if (new Set(allNonceClaims).size !== allNonceClaims.length) throw new Error("Reviewed supplement reuses a review request nonce.");
  const usedMedia = new Set<string>();
  for (let ordinal = 1; ordinal <= 99; ordinal += 1) {
    const expected = `goal-quiz-2026-${String(ordinal).padStart(3, "0")}`, question = supplement.questions.find((item) => item.id === expected);
    if (!question || !goalId.test(question.id) || !question.headerAr.trim() || !question.promptAr.trim() || !question.canonicalAnswer.trim() || !question.acceptedAnswers.includes(question.canonicalAnswer) || !validHash(question.evidenceHash) || !validHash(question.policyHash) || !validHash(question.answerConceptId) || !question.authorUid.trim()) throw new Error("Reviewed goal question is invalid.");
    const prompt = media.get(question.promptMediaId), answer = media.get(question.answerMediaId), promptMatch = prompt && goalMediaId.exec(prompt.mediaId), answerMatch = answer && goalMediaId.exec(answer.mediaId);
    if (!prompt || !answer || !validMedia(prompt, "goal") || !validMedia(answer, "goal") || promptMatch?.[1] !== String(ordinal).padStart(3, "0") || answerMatch?.[1] !== String(ordinal).padStart(3, "0") || promptMatch?.[2] !== "blur" || answerMatch?.[2] !== "clean" || question.contentHash !== reviewedQuestionContentHash(question, "goals-2026", "video", prompt, answer)) throw new Error("Reviewed goal media role/content commitment is invalid.");
    usedMedia.add(prompt.mediaId); usedMedia.add(answer.mediaId); requireReviewSet(question, receiptsById, question, "goals-2026", requiredGoalRoles, authority.trust, supplement.asOf);
  }
  const imageQuestions = supplement.imageQuestions ?? [];
  if (new Set(imageQuestions.map((item) => item.id)).size !== imageQuestions.length) throw new Error("Reviewed image supplement has duplicate question IDs.");
  for (const question of imageQuestions) {
    const prompt = media.get(question.mediaId), answer = question.answerMediaId ? media.get(question.answerMediaId) : undefined;
    if (!safeId(question.id) || !safeId(question.categoryId) || !question.headerAr.trim() || !question.promptAr.trim() || !question.canonicalAnswer.trim() || !question.acceptedAnswers.includes(question.canonicalAnswer) || !validHash(question.evidenceHash) || !validHash(question.policyHash) || !validHash(question.answerConceptId) || !question.authorUid.trim() || !prompt || !validMedia(prompt, "image") || (answer && !validMedia(answer, "image")) || (question.answerMediaId && !answer) || question.contentHash !== reviewedQuestionContentHash(question, question.categoryId, "image", prompt, answer)) throw new Error("Reviewed image supplement binding/content commitment is invalid.");
    usedMedia.add(prompt.mediaId); if (answer) usedMedia.add(answer.mediaId); requireReviewSet(question, receiptsById, question, question.categoryId, requiredImageRoles, authority.trust, supplement.asOf);
  }
  if (usedMedia.size !== media.size || [...media.values()].some((item) => !usedMedia.has(item.mediaId))) throw new Error("Reviewed supplement contains unbound media.");
  return { media, imageQuestions, supplementNonceClaims: allNonceClaims.slice().sort() };
}
const mediaDoc = (releaseId: string, media: ReviewedGoalMedia): ReleaseDocument => ({ path: `releases/${releaseId}/media/${media.mediaId}`, data: { ...media, immutable: true } });

/** Copies a verified V3.3 root into one immutable composite and adds signed video/image additions. */
export function buildReviewedMediaCompositeReleasePlan(base: FirestoreReleasePlan, supplement: ReviewedGoalSupplement, authority: TrustedReviewedAuthority, report: TrustedReviewedReport): FirestoreReleasePlan {
  const checkedBase = validateBase(base), checked = validateSupplement(supplement, authority, report);
  const releaseId = `release-${hash({ baseReleaseId: base.releaseId, baseDocumentRootSha256: base.documentRootSha256, supplementContentHash: supplement.contentHash, trustedAuthority: authority.rawSha256 })}`, oldPrefix = `releases/${base.releaseId}/`, newPrefix = `releases/${releaseId}/`;
  const copied = checkedBase.children.map((document) => ({ path: `${newPrefix}${document.path.slice(oldPrefix.length)}`, data: structuredClone(document.data) })), existing = new Set(copied.map((document) => document.path.slice(newPrefix.length))), images = checked.imageQuestions;
  if (existing.has("catalogCategories/goals-2026") || supplement.questions.some((question) => existing.has(`questions/${question.id}`)) || supplement.media.some((item) => existing.has(`media/${item.mediaId}`))) throw new Error("Composite supplement collides with the immutable base release.");
  const categoryDocs = new Map(copied.filter((document) => document.path.startsWith(`${newPrefix}catalogCategories/`)).map((document) => [String(document.data.id), document]));
  for (const question of images) if (!categoryDocs.has(question.categoryId) || existing.has(`questions/${question.id}`)) throw new Error("Reviewed image category must exactly match a copied base catalog and not collide.");
  const added: ReleaseDocument[] = [{ path: `${newPrefix}catalogCategories/goals-2026`, data: { id: "goals-2026", labelAr: supplement.category.labelAr, supplement: true } }, { path: `${newPrefix}inventory/goals-2026`, data: { categoryId: "goals-2026", approvedCount: 99 } }, ...supplement.media.map((item) => mediaDoc(releaseId, item)), ...supplement.questions.map((question) => ({ path: `${newPrefix}questions/${question.id}`, data: { id: question.id, categoryId: "goals-2026", modality: "video", headerAr: question.headerAr, promptAr: question.promptAr, canonicalAnswer: question.canonicalAnswer, acceptedAnswers: question.acceptedAnswers, answerConceptId: question.answerConceptId, media: { mediaId: question.promptMediaId, assetSha256: checked.media.get(question.promptMediaId)!.assetSha256, altAr: "مقطع السؤال", type: "video", contentType: "video/mp4" }, answerMedia: { mediaId: question.answerMediaId, assetSha256: checked.media.get(question.answerMediaId)!.assetSha256, altAr: "مقطع الإجابة", type: "video", contentType: "video/mp4" }, contentHash: question.contentHash, reviewReceiptIds: question.reviewReceiptIds } })), ...images.map((question) => ({ path: `${newPrefix}questions/${question.id}`, data: { id: question.id, categoryId: question.categoryId, modality: "image", headerAr: question.headerAr, promptAr: question.promptAr, canonicalAnswer: question.canonicalAnswer, acceptedAnswers: question.acceptedAnswers, answerConceptId: question.answerConceptId, media: { mediaId: question.mediaId, assetSha256: checked.media.get(question.mediaId)!.assetSha256, altAr: "صورة السؤال", type: "image", contentType: checked.media.get(question.mediaId)!.contentType }, ...(question.answerMediaId ? { answerMedia: { mediaId: question.answerMediaId, assetSha256: checked.media.get(question.answerMediaId)!.assetSha256, altAr: "صورة الإجابة", type: "image", contentType: checked.media.get(question.answerMediaId)!.contentType } } : {}), contentHash: question.contentHash, reviewReceiptIds: question.reviewReceiptIds } }))];
  const increments = new Map<string, number>(); for (const image of images) increments.set(image.categoryId, (increments.get(image.categoryId) ?? 0) + 1);
  for (const [categoryId, increment] of increments) { const path = `${newPrefix}inventory/${categoryId}`, index = copied.findIndex((document) => document.path === path); if (index < 0 || !Number.isInteger(copied[index].data.approvedCount)) throw new Error("Reviewed image category has no immutable base inventory."); copied[index] = { path, data: { ...copied[index].data, approvedCount: Number(copied[index].data.approvedCount) + increment } }; }
  const body = [...copied, ...added].sort((a, b) => a.path.localeCompare(b.path)), catalog = body.filter((document) => document.path.startsWith(`${newPrefix}catalogCategories/`)), documentRootSha256 = documentsHash(body);
  const root: ReleaseDocument = { path: `releases/${releaseId}`, data: { releaseId, asOf: supplement.asOf, immutable: true, composite: true, baseReleaseId: base.releaseId, baseDocumentRootSha256: base.documentRootSha256, baseCatalogSha256: base.catalogSha256, baseSourceManifestSha256: base.sourceManifestSha256, baseApprovedJsonlSha256: base.approvedJsonlSha256, baseReviewNonceClaimHashes: checkedBase.inheritedNonceClaims, supplementContentHash: supplement.contentHash, supplementReviewReportHash: supplement.reviewReportHash, supplementTrustRootSha256: authority.rawSha256, approvedCount: base.approvedCount + 99 + images.length, catalogSha256: documentsHash(catalog), documentRootSha256 } };
  return { releaseId, asOf: supplement.asOf, approvedCount: base.approvedCount + 99 + images.length, approvedJsonlSha256: hash({ base: base.approvedJsonlSha256, supplement: supplement.contentHash }), catalogSha256: root.data.catalogSha256 as string, documentRootSha256, sourceManifestSha256: hash({ base: base.sourceManifestSha256, supplement: supplement.contentHash, trustRootSha256: authority.rawSha256 }), reviewNonceClaimHashes: checked.supplementNonceClaims, documents: [...body, root].sort((a, b) => a.path.localeCompare(b.path)) };
}

/** Loads only a canonical, regular external artifact; never trusts an in-memory caller assertion. */
export async function loadTrustedReviewedAuthority(path: string, expectedRawSha256: string, untrustedArtifactPaths: string[] = []): Promise<TrustedReviewedAuthority> {
  if (!validHash(expectedRawSha256)) throw new Error("Trusted authority requires an exact SHA-256 anchor.");
  const resolved = await realpath(resolve(path));
  for (const artifactPath of untrustedArtifactPaths) assertExternalV33TrustRootPath(dirname(await realpath(resolve(artifactPath))), resolved);
  const stat = await lstat(resolved); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Trusted authority artifact must be a regular file.");
  const raw = await readFile(resolved, "utf8"); if (rawHash(raw) !== expectedRawSha256) throw new Error("Trusted authority SHA-256 anchor does not match exact artifact bytes.");
  let trust: V33TrustRoot; try { trust = JSON.parse(raw) as V33TrustRoot; } catch { throw new Error("Trusted authority artifact is not JSON."); }
  if (canonicalJson(trust) !== raw || !validAuthority({ trust, rawSha256: expectedRawSha256 })) throw new Error("Trusted authority artifact must be canonical JSON with a valid time and issuer registry."); return { trust, rawSha256: expectedRawSha256 };
}
export async function loadReviewedGoalSupplement(path: string, expectedContentHash: string): Promise<ReviewedGoalSupplement> {
  if (!validHash(expectedContentHash)) throw new Error("Reviewed supplement requires an exact content hash.");
  const resolved = await realpath(resolve(path)), relation = relative(process.cwd(), resolved); if (isAbsolute(relation) || relation === ".." || relation.startsWith(`..${sep}`)) throw new Error("Reviewed supplement must be an explicit workspace-local review artifact.");
  const stat = await lstat(resolved); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Reviewed supplement artifact must be a regular file.");
  let supplement: ReviewedGoalSupplement; try { supplement = JSON.parse(await readFile(resolved, "utf8")) as ReviewedGoalSupplement; } catch { throw new Error("Reviewed supplement artifact is not JSON."); }
  if (supplement.contentHash !== expectedContentHash || supplement.contentHash !== reviewedGoalSupplementHash(supplement)) throw new Error("Reviewed supplement content hash does not match exact artifact data."); return supplement;
}
export async function loadReviewedSupplementReviewReport(path: string, expectedRawSha256: string): Promise<TrustedReviewedReport> {
  if (!validHash(expectedRawSha256)) throw new Error("Reviewed supplement report requires an exact SHA-256 commitment.");
  const resolved = await realpath(resolve(path)), relation = relative(process.cwd(), resolved); if (isAbsolute(relation) || relation === ".." || relation.startsWith(`..${sep}`)) throw new Error("Reviewed supplement report must be an explicit workspace-local review artifact.");
  const stat = await lstat(resolved); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Reviewed supplement report artifact must be a regular file.");
  const raw = await readFile(resolved, "utf8"); if (rawHash(raw) !== expectedRawSha256) throw new Error("Reviewed supplement report SHA-256 does not match exact artifact bytes.");
  let report: ReviewedSupplementReviewReport; try { report = JSON.parse(raw) as ReviewedSupplementReviewReport; } catch { throw new Error("Reviewed supplement report artifact is not JSON."); }
  if (canonicalJson(report) !== raw) throw new Error("Reviewed supplement report artifact must be canonical JSON."); return { report, rawSha256: expectedRawSha256 };
}

/** The base plan is an audited immutable artifact, never a mutable active-release lookup. */
export async function loadImmutableBaseReleasePlan(path: string, expectedDocumentRootSha256: string): Promise<FirestoreReleasePlan> {
  if (!validHash(expectedDocumentRootSha256)) throw new Error("Immutable base plan requires an exact document-root SHA-256.");
  const resolved = await realpath(resolve(path)), relation = relative(process.cwd(), resolved); if (isAbsolute(relation) || relation === ".." || relation.startsWith(`..${sep}`)) throw new Error("Immutable base plan must be an explicit workspace-local review artifact.");
  const stat = await lstat(resolved); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Immutable base plan artifact must be a regular file.");
  let base: FirestoreReleasePlan; try { base = JSON.parse(await readFile(resolved, "utf8")) as FirestoreReleasePlan; } catch { throw new Error("Immutable base plan artifact is not JSON."); }
  if (base.documentRootSha256 !== expectedDocumentRootSha256) throw new Error("Immutable base plan root does not match the requested commitment.");
  validateBase(base); return base;
}
