import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import { readFile } from "node:fs/promises";
import {
  answerVariantsMatchSlotV33,
  asOfArtifactHashV33,
  candidateHashV33,
  candidateCorpusHashV33,
  createScopeManifestV33,
  evidenceBodiesHashV33,
  evidenceHashV33,
  generateSlotsV33,
  policyHashV33,
  questionContentHashV33,
  receiptHashV33,
  receiptSigningPayloadV33,
  sourcePolicyRegistryHashV33,
  validateCorpusV33,
  type V33CategoryPolicy,
  type V33Corpus,
  type V33Question,
  type V33ReviewReceipt,
  type V33TrustRoot,
} from "../src/question-bank-v3.3.js";
import { answerConceptIdV32 } from "../src/question-bank-v3.2.js";
const policy = (
  slotQuotas: V33CategoryPolicy["slotQuotas"],
): V33CategoryPolicy => {
  const x = {
    policyVersion: "question-bank-v3.3-weighted-slots-v1" as const,
    categoryId: "tahadani-001",
    modality: "classic" as const,
    selectionMode: "standalone" as const,
    supportedAnswerLetters: ["ب", "ت", "ث"],
    minimumApproved: 300 as const,
    preferredCandidates: 336 as const,
    reservePerLetter: 3 as const,
    conceptFacets: ["a", "b", "c"],
    performanceFacets: [],
    slotQuotas,
  };
  return { ...x, policyHash: policyHashV33(x) };
};
test("scope is fixed to 62 categories", () =>
  assert.equal(createScopeManifestV33().categoryIds.length, 62));
test("weighted SWRR is deterministic with exact 200/100/36 and 112 difficulty cells", () => {
  const a = generateSlotsV33(
    policy([
      { targetLetter: "ث", facetId: "c", count: 36 },
      { targetLetter: "ب", facetId: "a", count: 200 },
      { targetLetter: "ت", facetId: "b", count: 100 },
    ]),
  );
  assert.deepEqual(
    a.reduce<Record<string, number>>(
      (x, s) => ({ ...x, [s.targetLetter!]: (x[s.targetLetter!] ?? 0) + 1 }),
      {},
    ),
    { ب: 200, ت: 100, ث: 36 },
  );
  assert.deepEqual(
    a.reduce<Record<string, number>>(
      (x, s) => ({ ...x, [s.difficulty]: (x[s.difficulty] ?? 0) + 1 }),
      {},
    ),
    { easy: 112, medium: 112, hard: 112 },
  );
  assert.deepEqual(
    a,
    generateSlotsV33(
      policy([
        { targetLetter: "ب", facetId: "a", count: 200 },
        { targetLetter: "ت", facetId: "b", count: 100 },
        { targetLetter: "ث", facetId: "c", count: 36 },
      ]),
    ),
  );
});
test("quota totals and duplicate cells fail closed", () => {
  assert.throws(() =>
    generateSlotsV33(
      policy([
        { targetLetter: "ب", facetId: "a", count: 335 },
        { targetLetter: "ت", facetId: "b", count: 1 },
        { targetLetter: "ث", facetId: "c", count: 1 },
      ]),
    ),
  );
  assert.throws(() =>
    generateSlotsV33(
      policy([
        { targetLetter: "ب", facetId: "a", count: 200 },
        { targetLetter: "ب", facetId: "a", count: 100 },
        { targetLetter: "ث", facetId: "c", count: 36 },
      ]),
    ),
  );
});
test("candidate hashes bind authoring tuples", () => {
  const x = {
    candidateId: "c",
    schemaVersion: "3.3.0" as const,
    categoryId: "tahadani-001",
    modality: "classic" as const,
    slotId: "s",
    authorUid: "a",
    state: "ready_for_human" as const,
    headerAr: "عنوان",
    promptAr: "صف المعلومة",
    canonicalAnswer: "بحر",
    acceptedAnswers: ["بحر"],
    acceptDefiniteArticle: false,
    answerConceptId: "concept:x",
    difficulty: "easy" as const,
    claimIds: ["c1"],
    evidenceIds: ["e1"],
    targetLetter: "ب",
    facetId: "a",
  };
  assert.notEqual(
    candidateHashV33(x),
    candidateHashV33({ ...x, promptAr: "صياغة أخرى" }),
  );
  assert.notEqual(
    candidateHashV33(x),
    candidateHashV33({ ...x, acceptDefiniteArticle: true }),
  );
});
test("candidate-level definite article handling is semantic and every accepted variant stays in its slot", () => {
  const letterCandidate = (
    canonicalAnswer: string,
    acceptedAnswers: string[],
    targetLetter: string,
    acceptDefiniteArticle: boolean,
  ) => ({
    modality: "classic" as const,
    canonicalAnswer,
    acceptedAnswers,
    targetLetter,
    acceptDefiniteArticle,
  });
  assert.equal(
    answerVariantsMatchSlotV33(letterCandidate("جذر", ["الجذر"], "ج", true)),
    true,
  );
  assert.equal(
    answerVariantsMatchSlotV33(
      letterCandidate("القاهرة", ["قاهرة"], "ق", true),
    ),
    true,
  );
  assert.equal(
    answerVariantsMatchSlotV33(letterCandidate("أليس", ["أليس"], "ا", false)),
    true,
  );
  assert.equal(
    answerVariantsMatchSlotV33(letterCandidate("ألبرت", ["ألبرت"], "ا", false)),
    true,
  );
  assert.equal(
    answerVariantsMatchSlotV33(letterCandidate("سيارة", ["مركبة"], "س", false)),
    false,
  );
  assert.equal(
    answerVariantsMatchSlotV33({
      modality: "charades",
      canonicalAnswer: "أليس",
      acceptedAnswers: ["أليس"],
      targetLetter: undefined,
      acceptDefiniteArticle: false,
    }),
    true,
  );
});

function receiptCorpus() {
  const x = { policyVersion: "question-bank-v3.3-weighted-slots-v1" as const, categoryId: "tahadani-001", modality: "classic" as const, selectionMode: "standalone" as const, supportedAnswerLetters: ["ب"], minimumApproved: 300 as const, preferredCandidates: 336 as const, reservePerLetter: 3 as const, conceptFacets: ["facet"], performanceFacets: [], slotQuotas: [{ targetLetter: "ب", facetId: "facet", count: 336 }] };
  const policy = { ...x, policyHash: policyHashV33(x) };
  const candidateBase = { candidateId: "candidate-1", schemaVersion: "3.3.0" as const, categoryId: "tahadani-001", modality: "classic" as const, slotId: "tahadani-001:classic:001", authorUid: "author", state: "ready_for_human" as const, headerAr: "عنوان", promptAr: "صف البحر", canonicalAnswer: "بحر", acceptedAnswers: ["بحر"], acceptDefiniteArticle: false, answerConceptId: answerConceptIdV32("بحر"), difficulty: "easy" as const, claimIds: [], evidenceIds: [], targetLetter: "ب", facetId: "facet" };
  const candidate = { ...candidateBase, candidateHash: candidateHashV33(candidateBase) };
  const questionBase: Omit<V33Question, "contentHash"> = { ...candidate, state: "approved", evidenceHash: evidenceHashV33([]), reviewReceiptIds: [] };
  const question: V33Question = { ...questionBase, contentHash: "" };
  question.contentHash = questionContentHashV33(question);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const trust: V33TrustRoot = { now: "2026-09-05T00:00:00.000Z", issuers: { issuer: { keys: { key: publicKey.export({ type: "spki", format: "pem" }).toString() }, roles: ["fact_reviewer", "language_reviewer", "image_rights_reviewer", "charades_performance_reviewer", "charades_originality_reviewer", "charades_cultural_suitability_reviewer"], reviewers: { fact: ["fact_reviewer"], language: ["language_reviewer"], rights: ["image_rights_reviewer"], performance: ["charades_performance_reviewer"], originality: ["charades_originality_reviewer"], cultural: ["charades_cultural_suitability_reviewer"] } } } };
  const makeReceipt = (role: string, reviewerUid: string, patch: Partial<V33ReviewReceipt> = {}): V33ReviewReceipt => {
    const unsigned = { receiptId: `receipt-${role}`, version: 1 as const, issuer: "issuer", signerKeyId: "key", reviewerUid, reviewerRole: role, authorUid: "author", reviewRequestNonce: `nonce-${role}`, verdict: "approved" as const, questionId: question.candidateId, categoryId: question.categoryId, questionContentHash: question.contentHash, evidenceHash: question.evidenceHash, policyHash: policy.policyHash, mediaHash: null, issuedAt: "2026-09-04T00:00:00.000Z", ...patch, receiptHash: "", signature: "" };
    const receiptHash = receiptHashV33(unsigned as V33ReviewReceipt);
    return { ...unsigned, receiptHash, signature: sign(null, Buffer.from(receiptSigningPayloadV33({ ...unsigned, receiptHash } as V33ReviewReceipt)), privateKey).toString("base64") } as V33ReviewReceipt;
  };
  const sourcePolicyRegistry = { version: 1 as const, policies: [], contentHash: "" };
  sourcePolicyRegistry.contentHash = sourcePolicyRegistryHashV33(sourcePolicyRegistry);
  const asOfArtifact = { version: 1 as const, asOf: "2026-09-04T00:00:00.000Z", sourcePolicyRegistryHash: sourcePolicyRegistry.contentHash, candidateCorpusHash: candidateCorpusHashV33([candidate]), evidenceBodiesHash: evidenceBodiesHashV33({}), contentHash: "" };
  asOfArtifact.contentHash = asOfArtifactHashV33(asOfArtifact);
  const corpus: V33Corpus = { scope: createScopeManifestV33(), policies: [policy], slots: [], candidates: [candidate], questions: [question], evidence: [], media: [], receipts: [], asOfArtifact, sourcePolicyRegistry, evidenceBodies: {} };
  return { corpus, trust, makeReceipt, question };
}

test("review receipts bind author/category, authenticated reviewer role, nonce, and independent roles", () => {
  const { corpus, trust, makeReceipt, question } = receiptCorpus();
  const fact = makeReceipt("fact_reviewer", "fact"); const language = makeReceipt("language_reviewer", "language");
  corpus.receipts = [fact, language]; corpus.questions = [{ ...question, reviewReceiptIds: [fact.receiptId, language.receiptId], contentHash: question.contentHash }];
  assert.equal(validateCorpusV33(corpus, trust).findings.some((finding) => finding.code === "required_human_receipt_invalid"), false);
  const invalid = (receipt: V33ReviewReceipt) => ({ ...corpus, receipts: [receipt, language] });
  assert.equal(validateCorpusV33(invalid(makeReceipt("fact_reviewer", "fact", { authorUid: "other" })), trust).findings.some((finding) => finding.code === "required_human_receipt_invalid"), true);
  assert.equal(validateCorpusV33(invalid(makeReceipt("fact_reviewer", "author")), trust).findings.some((finding) => finding.code === "required_human_receipt_invalid"), true);
  assert.equal(validateCorpusV33({ ...corpus, receipts: [fact, { ...language, reviewerUid: "fact", receiptId: "receipt-language-duplicate", receiptHash: "0".repeat(64) }] }, trust).findings.some((finding) => finding.code === "required_human_receipt_invalid"), true);
  assert.equal(validateCorpusV33({ ...corpus, receipts: [fact, makeReceipt("language_reviewer", "language", { reviewRequestNonce: fact.reviewRequestNonce })] }, trust).findings.some((finding) => finding.code === "review_receipt_replay_invalid"), true);
  assert.equal(validateCorpusV33(invalid(makeReceipt("fact_reviewer", "fact", { categoryId: "tahadani-002" })), trust).findings.some((finding) => finding.code === "required_human_receipt_invalid"), true);
  assert.equal(validateCorpusV33(invalid(makeReceipt("fact_reviewer", "fact", { policyHash: "f".repeat(64) })), trust).findings.some((finding) => finding.code === "required_human_receipt_invalid"), true);
  assert.equal(validateCorpusV33(invalid(makeReceipt("fact_reviewer", "fact", { issuedAt: "2026-09-03T23:59:59.000Z" })), trust).findings.some((finding) => finding.code === "required_human_receipt_invalid"), true);
});

test("the strict validation-report schema accepts a generated report and rejects missing or fabricated bindings", async () => {
  const { corpus, trust } = receiptCorpus(); const report = validateCorpusV33(corpus, trust);
  const schema = JSON.parse(await readFile("content/question-bank-v3/schemas/validation-report.v3.3.schema.json", "utf8"));
  const validate = new (Ajv2020 as unknown as new (options?: object) => { compile(value: object): (value: unknown) => boolean })({ strict: false }).compile(schema);
  assert.equal(validate(report), true, JSON.stringify((validate as { errors?: unknown }).errors));
  const missing = { ...report } as Partial<typeof report>; delete missing.asOfHash;
  assert.equal(validate(missing), false);
  assert.equal(validate({ ...report, candidateCorpusHash: "0".repeat(64), fabricated: true }), false);
});
