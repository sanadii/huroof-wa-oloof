/**
 * Coordinator-only, dry-run staging bridge. This is a record-level importer,
 * not a release writer: full v3.3 corpus validation still belongs to the
 * production loader, which needs all 62 category ledgers.
 *
 * The emitted fragment is checked against frozen candidate/evidence/media
 * record contracts. It never creates a receipt or an approval/release claim.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  candidateHashV33,
  evidenceContentHashV33,
  mediaContentHashV33,
} from "../src/question-bank-v3.3.js";

type Any = Record<string, unknown>;
type Modality = "classic" | "image" | "charades";
const HASH = /^[a-f0-9]{64}$/u;
const CATEGORY = /^tahadani-(?:00[1-9]|0[1-5][0-9]|06[0-2])$/u;
const LETTER = /^[ابتثجحخدذرزسشصضطظعغفقكلمنهوي]$/u;
const modalities = new Set<Modality>(["classic", "image", "charades"]);
const difficulties = new Set(["easy", "medium", "hard"]);
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const canonicalRoot = resolve("content/question-bank-v3/v3.3");
const isForbiddenApprovalKey = (key: string) => key !== "rightsReceiptHash" && /approv|receipt|release|review(?:status|receipt|approval)?/iu.test(key);
const hasOwn = (value: Any, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const isObject = (value: unknown): value is Any => typeof value === "object" && value !== null && !Array.isArray(value);

export type PromotionInput = {
  stagingPacket: string;
  batchAudit: string;
  slots: string;
  authorUid: string;
  policyHash: string;
  output?: string;
};

export type PromotionFragment = {
  schemaVersion: "staging-promotion-fragment.v1";
  dryRun: boolean;
  corpusSha256: string;
  audit: { auditorTaskIdentity: string; handoffHash: string; bytesSha256: string };
  policyHash: string;
  slotsHash: string;
  authorUid: string;
  candidates: Any[];
  evidence: Any[];
  media: Any[];
};

const fail = (message: string): never => { throw new Error(message); };
const string = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${label} must be a nonempty string`);
  return value as string;
};
const sha = (value: unknown, label: string): string => {
  const result = string(value, label);
  if (!HASH.test(result)) fail(`${label} must be a sha256`);
  return result;
};
const dateTime = (value: unknown, label: string): string => {
  const result = string(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(result) || Number.isNaN(Date.parse(result))) fail(`${label} must be an RFC 3339 date-time`);
  return result;
};
const arrayOfStrings = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !item)) fail(`${label} must be a nonempty string array`);
  const items = value as string[];
  if (new Set(items).size !== items.length) fail(`${label} must not contain duplicates`);
  return items;
};
const exactIds = (left: string[], right: string[], label: string) => {
  if (left.length !== right.length || left.some((id) => !right.includes(id))) fail(`${label} are inconsistent with bound records`);
};

/** Reject approval/release assertions at any depth, including nested metadata. */
const assertNoApprovalFields = (value: unknown, path = "row"): void => {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoApprovalFields(item, `${path}[${index}]`));
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (isForbiddenApprovalKey(key)) fail(`forbidden approval/release field ${path}.${key}`);
    assertNoApprovalFields(child, `${path}.${key}`);
  }
};

const assertCategory = (value: unknown, label: string) => {
  const categoryId = string(value, label);
  if (!CATEGORY.test(categoryId)) fail(`${label} must be a runtime tahadani-001..062 category`);
  return categoryId;
};
const assertModality = (value: unknown, label: string): Modality => {
  if (typeof value !== "string" || !modalities.has(value as Modality)) fail(`${label} has an unsupported modality`);
  return value as Modality;
};
const assertDifficulty = (value: unknown, label: string) => {
  if (typeof value !== "string" || !difficulties.has(value)) fail(`${label} has an unsupported difficulty`);
  return value;
};
const assertNoUnexpectedKeys = (value: Any, allowed: string[], label: string) => {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label} has unknown field ${key}`);
};

const evidenceKeys = [
  "evidenceId", "sourceUrl", "sourceHash", "sourcePolicyHash", "sourceIdentityHash", "publisher", "title", "sourceTier", "claimIds", "retrievedAt", "validUntil", "responseBodySha256", "responseBodyBytes", "bodyStorePath", "byteRange", "excerptBase64", "excerptSha256", "supportTokens", "contentHash",
];
const mediaKeys = ["mediaId", "localAssetPath", "assetSha256", "altAr", "provenance", "licence", "rightsReceiptHash", "contentHash"];
const candidateKeys = ["candidateId", "candidateHash", "schemaVersion", "categoryId", "modality", "slotId", "authorUid", "state", "headerAr", "promptAr", "canonicalAnswer", "acceptedAnswers", "acceptDefiniteArticle", "answerConceptId", "difficulty", "explanationAr", "claimIds", "evidenceIds", "targetLetter", "facetId", "performanceFacetId", "mediaId"];

/** Strict frozen evidence-record contract; the loader adds complete-corpus joins. */
const normalizeEvidence = (value: unknown, policyHash: string, label: string) => {
  if (!isObject(value)) fail(`${label} must be an object`);
  const object = value as Any;
  assertNoUnexpectedKeys(object, evidenceKeys, label);
  const byteRange = object.byteRange;
  if (!isObject(byteRange) || Object.keys(byteRange).length !== 2 || !Number.isInteger(byteRange.start) || !Number.isInteger(byteRange.end) || (byteRange.start as number) < 0 || (byteRange.end as number) <= (byteRange.start as number)) fail(`${label}.byteRange is invalid`);
  const record: Any = {
    evidenceId: string(object.evidenceId, `${label}.evidenceId`), sourceUrl: string(object.sourceUrl, `${label}.sourceUrl`), sourceHash: sha(object.sourceHash, `${label}.sourceHash`), sourcePolicyHash: sha(object.sourcePolicyHash, `${label}.sourcePolicyHash`), sourceIdentityHash: sha(object.sourceIdentityHash, `${label}.sourceIdentityHash`),
    publisher: string(object.publisher, `${label}.publisher`), title: string(object.title, `${label}.title`), sourceTier: string(object.sourceTier, `${label}.sourceTier`), claimIds: arrayOfStrings(object.claimIds, `${label}.claimIds`),
    retrievedAt: dateTime(object.retrievedAt, `${label}.retrievedAt`), validUntil: dateTime(object.validUntil, `${label}.validUntil`), responseBodySha256: sha(object.responseBodySha256, `${label}.responseBodySha256`), responseBodyBytes: object.responseBodyBytes,
    bodyStorePath: string(object.bodyStorePath, `${label}.bodyStorePath`), byteRange: { start: (byteRange as Any).start, end: (byteRange as Any).end }, excerptBase64: string(object.excerptBase64, `${label}.excerptBase64`), excerptSha256: sha(object.excerptSha256, `${label}.excerptSha256`), supportTokens: arrayOfStrings(object.supportTokens, `${label}.supportTokens`), contentHash: sha(object.contentHash, `${label}.contentHash`),
  };
  if (!/^https?:\/\//iu.test(record.sourceUrl as string)) fail(`${label}.sourceUrl must be an absolute URI`);
  if (!Number.isInteger(record.responseBodyBytes) || (record.responseBodyBytes as number) < 1) fail(`${label}.responseBodyBytes is invalid`);
  if (record.sourcePolicyHash !== policyHash) fail(`${label}.sourcePolicyHash does not bind the supplied policy`);
  if (evidenceContentHashV33(record as never) !== record.contentHash) fail(`${label}.contentHash does not match frozen evidence`);
  return record;
};

/** Strict frozen media-record contract. */
const normalizeMedia = (value: unknown, label: string) => {
  if (!isObject(value)) fail(`${label} must be an object`);
  const object = value as Any;
  assertNoUnexpectedKeys(object, mediaKeys, label);
  const record: Any = {
    mediaId: string(object.mediaId, `${label}.mediaId`), localAssetPath: string(object.localAssetPath, `${label}.localAssetPath`), assetSha256: sha(object.assetSha256, `${label}.assetSha256`), altAr: string(object.altAr, `${label}.altAr`), provenance: string(object.provenance, `${label}.provenance`), licence: string(object.licence, `${label}.licence`), rightsReceiptHash: sha(object.rightsReceiptHash, `${label}.rightsReceiptHash`), contentHash: sha(object.contentHash, `${label}.contentHash`),
  };
  if (!(record.localAssetPath as string).startsWith("content/")) fail(`${label}.localAssetPath must be under content/`);
  if (mediaContentHashV33(record as never) !== record.contentHash) fail(`${label}.contentHash does not match frozen media`);
  return record;
};

/** Validates emitted record shapes; it deliberately cannot replace full v3.3 corpus loading. */
export const validatePromotionFragment = (fragment: PromotionFragment): void => {
  if (fragment.schemaVersion !== "staging-promotion-fragment.v1") fail("fragment schema version is invalid");
  sha(fragment.corpusSha256, "fragment.corpusSha256"); sha(fragment.policyHash, "fragment.policyHash"); sha(fragment.slotsHash, "fragment.slotsHash"); string(fragment.authorUid, "fragment.authorUid");
  string(fragment.audit.auditorTaskIdentity, "fragment.audit.auditorTaskIdentity"); sha(fragment.audit.handoffHash, "fragment.audit.handoffHash"); sha(fragment.audit.bytesSha256, "fragment.audit.bytesSha256");
  const evidenceIds = new Set<string>(), mediaIds = new Set<string>(), candidateIds = new Set<string>();
  for (const evidence of fragment.evidence) { const record = normalizeEvidence(evidence, fragment.policyHash, "output evidence"); const evidenceId = record.evidenceId as string; if (evidenceIds.has(evidenceId)) fail(`duplicate output evidence ${evidenceId}`); evidenceIds.add(evidenceId); }
  for (const media of fragment.media) { const record = normalizeMedia(media, "output media"); const mediaId = record.mediaId as string; if (mediaIds.has(mediaId)) fail(`duplicate output media ${mediaId}`); mediaIds.add(mediaId); }
  for (const candidate of fragment.candidates) {
    if (!isObject(candidate)) fail("output candidate must be an object");
    const object = candidate as Any;
    assertNoUnexpectedKeys(object, candidateKeys, "output candidate");
    const candidateId = string(object.candidateId, "output candidateId"); if (candidateIds.has(candidateId)) fail(`duplicate output candidate ${candidateId}`); candidateIds.add(candidateId);
    assertCategory(object.categoryId, "output categoryId"); const modality = assertModality(object.modality, "output modality"); assertDifficulty(object.difficulty, "output difficulty");
    if (object.schemaVersion !== "3.3.0" || object.state !== "ready_for_human") fail("output candidate lifecycle is invalid");
    string(object.slotId, "output slotId"); string(object.authorUid, "output candidate authorUid"); string(object.headerAr, "output headerAr"); string(object.promptAr, "output promptAr"); string(object.canonicalAnswer, "output canonicalAnswer"); arrayOfStrings(object.acceptedAnswers, "output acceptedAnswers");
    if (hasOwn(object, "explanationAr") && object.explanationAr !== null && typeof object.explanationAr !== "string") fail("output explanationAr is invalid");
    if (typeof object.acceptDefiniteArticle !== "boolean") fail("output acceptDefiniteArticle is invalid"); if (typeof object.answerConceptId !== "string" || !/^concept:[a-f0-9]{64}$/u.test(object.answerConceptId)) fail("output answerConceptId is invalid");
    for (const evidenceId of arrayOfStrings(object.evidenceIds, "output evidenceIds")) if (!evidenceIds.has(evidenceId)) fail(`output candidate references unknown evidence ${evidenceId}`);
    arrayOfStrings(object.claimIds, "output claimIds");
    if (modality === "charades") { string(object.performanceFacetId, "output performanceFacetId"); if (hasOwn(object, "targetLetter") || hasOwn(object, "facetId") || hasOwn(object, "mediaId")) fail("charades output candidate has incompatible fields"); }
    else { if (typeof object.targetLetter !== "string" || !LETTER.test(object.targetLetter)) fail("output targetLetter is invalid"); string(object.facetId, "output facetId"); if (hasOwn(object, "performanceFacetId")) fail("non-charades output candidate has performance facet"); if (modality === "image") { const mediaId = string(object.mediaId, "output mediaId"); if (!mediaIds.has(mediaId)) fail(`output candidate references unknown media ${mediaId}`); } else if (hasOwn(object, "mediaId")) fail("non-image output candidate has media"); }
    sha(object.candidateHash, "output candidateHash");
    if (candidateHashV33(object as never) !== object.candidateHash) fail(`output candidate ${candidateId} hash mismatch`);
  }
};

const parseRows = (bytes: Buffer) => {
  const raw = bytes.toString("utf8"); if (!raw.trim()) fail("staging packet is empty");
  return raw.trimEnd().split("\n").map((line, index) => { try { const row = JSON.parse(line); if (!isObject(row)) fail(`row ${index + 1} must be an object`); return row; } catch (error) { if (error instanceof Error) throw error; return fail(`row ${index + 1} is invalid JSON`); } });
};
const pathInside = (parent: string, child: string) => { const relation = relative(parent, child); return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation)); };
const nearestRealParent = async (destination: string) => { let cursor = destination; while (true) { try { return await realpath(cursor); } catch { const parent = dirname(cursor); if (parent === cursor) throw new Error("output destination has no existing parent"); cursor = parent; } } };
const assertSafeOutput = async (output: string) => {
  const lexical = resolve(output), canonical = await realpath(canonicalRoot);
  if (pathInside(canonical, lexical) || pathInside(canonical, await nearestRealParent(lexical))) fail("output must stay outside canonical v3.3 production roots");
  await mkdir(lexical, { recursive: true });
  if (pathInside(canonical, await realpath(lexical))) fail("output symlink resolves inside canonical v3.3 production roots");
  return lexical;
};

/** Strict, deterministic conversion; writing requires an explicit safe output directory. */
export async function promoteStagingV33(input: PromotionInput): Promise<PromotionFragment> {
  string(input.authorUid, "authorUid"); sha(input.policyHash, "policyHash");
  const [packetBytes, auditBytes, slotBytes] = await Promise.all([readFile(input.stagingPacket), readFile(input.batchAudit), readFile(input.slots)]);
  const packetHash = hash(packetBytes); let audit: Any; let slots: unknown;
  try { audit = JSON.parse(auditBytes.toString("utf8")) as Any; slots = JSON.parse(slotBytes.toString("utf8")); } catch { return fail("audit or frozen slots are invalid JSON"); }
  if (!isObject(audit) || !Array.isArray(slots)) fail("audit or frozen slots have invalid shape");
  const batchAudit = audit as Any, frozenSlots = slots as unknown[];
  assertNoApprovalFields(batchAudit, "audit");
  const auditorTaskIdentity = string(batchAudit.auditorTaskIdentity, "independent batch audit auditorTaskIdentity"); if (auditorTaskIdentity === input.authorUid) fail("independent batch audit must be written by a non-writer auditor");
  if (batchAudit.independent !== true) fail("independent batch audit must explicitly be independent"); if (batchAudit.result !== "PASS") fail("batch audit is not a PASS finding"); if (batchAudit.corpusSha256 !== packetHash) fail("batch audit corpus hash mismatch"); sha(batchAudit.handoffHash, "independent batch audit handoffHash"); if (batchAudit.policyHash !== input.policyHash) fail("batch audit policy hash mismatch");
  const rows = parseRows(packetBytes); if (frozenSlots.length !== rows.length) fail("every staging row needs exactly one frozen slot");
  const usedSlots = new Set<string>(), concepts = new Set<string>(), evidenceIds = new Set<string>(), mediaIds = new Set<string>(); const candidates: Any[] = [], evidence: Any[] = [], media: Any[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] as Any, slot = frozenSlots[index], label = `row ${index + 1}`; assertNoApprovalFields(row, label); if (!isObject(slot)) fail(`slot ${index + 1} must be an object`); const slotObject = slot as Any;
    const slotId = string(slotObject.slotId, `slot ${index + 1}.slotId`), categoryId = assertCategory(slotObject.categoryId, `slot ${index + 1}.categoryId`), modality = assertModality(slotObject.modality, `slot ${index + 1}.modality`), difficulty = assertDifficulty(slotObject.difficulty, `slot ${index + 1}.difficulty`);
    if (slotObject.state !== "unfilled" || usedSlots.has(slotId)) fail(`unassigned or duplicate slot ${slotId}`); if (row.categoryId !== categoryId || row.modality !== modality || row.difficulty !== difficulty) fail(`${label}/slot category, modality, or difficulty mismatch`);
    const candidateId = string(row.rawCandidateId ?? row.candidateId, `${label}.candidateId`), answerConceptId = string(row.answerConceptId, `${label}.answerConceptId`); if (!/^concept:[a-f0-9]{64}$/u.test(answerConceptId)) fail(`${label}.answerConceptId is invalid`); if (concepts.has(answerConceptId)) fail(`duplicate answer concept ${answerConceptId}`);
    const claimIds = arrayOfStrings(row.claimIds, `${label}.claimIds`), rowEvidenceIds = arrayOfStrings(row.evidenceIds, `${label}.evidenceIds`); if (!Array.isArray(row.evidence) || row.evidence.length === 0) fail(`${label} missing immutable evidence binding`);
    const normalizedEvidence = (row.evidence as unknown[]).map((item, evidenceIndex) => normalizeEvidence(item, input.policyHash, `${label}.evidence[${evidenceIndex}]`)); const normalizedEvidenceIds = normalizedEvidence.map((item) => item.evidenceId as string); exactIds(rowEvidenceIds, normalizedEvidenceIds, `${label}.evidenceIds`); exactIds(claimIds, [...new Set(normalizedEvidence.flatMap((item) => item.claimIds as string[]))], `${label}.claimIds`);
    for (const item of normalizedEvidence) { const evidenceId = item.evidenceId as string; if (evidenceIds.has(evidenceId)) fail(`duplicate evidence ID ${evidenceId}`); evidenceIds.add(evidenceId); evidence.push(item); }
    const hasMedia = hasOwn(row, "media") && row.media !== undefined && row.media !== null; let normalizedMedia: Any | undefined;
    if (modality === "image") { if (!hasMedia) fail(`${label} image is missing media`); normalizedMedia = normalizeMedia(row.media, `${label}.media`); const mediaId = normalizedMedia.mediaId as string; if (mediaIds.has(mediaId)) fail(`duplicate media ID ${mediaId}`); mediaIds.add(mediaId); media.push(normalizedMedia); } else if (hasMedia) fail(`${label} non-image has media`);
    const base: Any = { candidateId, schemaVersion: "3.3.0", categoryId, modality, slotId, authorUid: input.authorUid, state: "ready_for_human", headerAr: string(row.headerAr, `${label}.headerAr`), promptAr: string(row.promptAr, `${label}.promptAr`), canonicalAnswer: string(row.canonicalAnswer, `${label}.canonicalAnswer`), acceptedAnswers: arrayOfStrings(row.acceptedAnswers ?? row.aliases ?? [row.canonicalAnswer], `${label}.acceptedAnswers`), acceptDefiniteArticle: Boolean(row.acceptDefiniteArticle), answerConceptId, difficulty, ...(hasOwn(row, "explanationAr") ? { explanationAr: row.explanationAr } : {}), claimIds, evidenceIds: rowEvidenceIds };
    if (hasOwn(base, "explanationAr") && base.explanationAr !== null && typeof base.explanationAr !== "string") fail(`${label}.explanationAr is invalid`);
    if (modality === "charades") base.performanceFacetId = string(row.performanceFacetId ?? slotObject.performanceFacetId, `${label}.performanceFacetId`); else { const targetLetter = string(row.targetLetter ?? slotObject.targetLetter, `${label}.targetLetter`); if (!LETTER.test(targetLetter)) fail(`${label}.targetLetter is invalid`); base.targetLetter = targetLetter; base.facetId = string(row.facetId ?? slotObject.facetId, `${label}.facetId`); if (modality === "image") base.mediaId = normalizedMedia!.mediaId as string; }
    base.candidateHash = candidateHashV33(base as never);
    if (base.headerAr !== row.headerAr || base.promptAr !== row.promptAr || base.canonicalAnswer !== row.canonicalAnswer) fail(`${label} wording mutation is forbidden`);
    candidates.push(base); usedSlots.add(slotId); concepts.add(answerConceptId);
  }
  const fragment: PromotionFragment = { schemaVersion: "staging-promotion-fragment.v1", dryRun: !input.output, corpusSha256: packetHash, audit: { auditorTaskIdentity, handoffHash: batchAudit.handoffHash as string, bytesSha256: hash(auditBytes) }, policyHash: input.policyHash, slotsHash: hash(slotBytes), authorUid: input.authorUid, candidates, evidence, media };
  validatePromotionFragment(fragment);
  if (input.output) { const destination = await assertSafeOutput(input.output); await writeFile(resolve(destination, "promotion-fragment.json"), json(fragment)); }
  return fragment;
}
