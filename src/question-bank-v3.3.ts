// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- release validation invokes this Node-only integrity primitive.
import { createHash, verify as verifySignature } from "node:crypto";
import {
  answerConceptIdV32,
  canonicalJsonV32,
  exactNormalizeV1,
  promptSimilarityV1,
} from "./question-bank-v3.2.js";
import {
  createMatchQuestionSelection,
  selectMatchQuestion,
} from "./features/game/runtime/question-selector.js";
type NodeLikeBuffer = Uint8Array & {
  subarray(start: number, end?: number): NodeLikeBuffer;
  equals(other: Uint8Array): boolean;
  toString(encoding?: string): string;
};
declare const Buffer: {
  from(value: string | Uint8Array, encoding?: string): NodeLikeBuffer;
};

export const QUESTION_BANK_V33 = "3.3.0" as const;
export const QUESTION_BANK_V33_POLICY =
  "question-bank-v3.3-weighted-slots-v1" as const;
export const QUESTION_BANK_V33_SCOPE = "question-bank-v3.3-runtime-62" as const;
export const RUNTIME_CATEGORY_IDS_V33 = Array.from(
  { length: 62 },
  (_, i) => `tahadani-${String(i + 1).padStart(3, "0")}`,
) as readonly string[];
/** Board inventory has exactly the 28 Arabic letters; hamza has no separate cell. */
export const ARABIC_ALPHABET_V33 = [
  "ا",
  "ب",
  "ت",
  "ث",
  "ج",
  "ح",
  "خ",
  "د",
  "ذ",
  "ر",
  "ز",
  "س",
  "ش",
  "ص",
  "ض",
  "ط",
  "ظ",
  "ع",
  "غ",
  "ف",
  "ق",
  "ك",
  "ل",
  "م",
  "ن",
  "ه",
  "و",
  "ي",
] as const;
export type Hash = string;
export type V33Modality = "classic" | "image" | "charades";
export type V33SelectionMode = "standalone" | "combined_only" | "charades_only";
export type V33Difficulty = "easy" | "medium" | "hard";
export type V33Severity = "error" | "warning" | "review_required";
export type V33ClassicSlotQuota = {
  targetLetter: string;
  facetId: string;
  count: number;
};
export type V33CharadesSlotQuota = {
  performanceFacetId: string;
  count: number;
};
export type V33SlotQuota = V33ClassicSlotQuota | V33CharadesSlotQuota;
export type V33ScopeManifest = {
  schemaVersion: typeof QUESTION_BANK_V33;
  scope: typeof QUESTION_BANK_V33_SCOPE;
  categoryIds: string[];
  scopeHash: Hash;
};
export type V33CategoryPolicy = {
  policyVersion: typeof QUESTION_BANK_V33_POLICY;
  categoryId: string;
  modality: V33Modality;
  selectionMode: V33SelectionMode;
  supportedAnswerLetters: string[];
  minimumApproved: 300;
  preferredCandidates: 336;
  reservePerLetter: 3;
  conceptFacets: string[];
  performanceFacets: string[];
  slotQuotas: V33SlotQuota[];
  closedDomainConceptReuseCap?: 2;
  policyHash: Hash;
};
/** Immutable Arabic labels are reviewed corpus metadata, never a mutable global catalog lookup. */
export type V33CategoryCatalog = {
  schemaVersion: typeof QUESTION_BANK_V33;
  categories: Array<{ id: string; labelAr: string }>;
  contentHash: Hash;
};
export type V33Slot = {
  slotId: string;
  categoryId: string;
  modality: V33Modality;
  ordinal: number;
  difficulty: V33Difficulty;
  state: "unfilled" | "blocked";
  targetLetter?: string;
  facetId?: string;
  performanceFacetId?: string;
};
export type V33SourcePolicyRegistry = {
  version: 1;
  policies: Array<{
    sourcePolicyHash: Hash;
    sourceIdentityHash: Hash;
    sourceUrl: string;
    publisher: string;
    title: string;
    sourceTier: string;
  }>;
  contentHash: Hash;
};
/** `asOf` binds corpus freshness and is distinct from independent trust-root `now`. */
export type V33AsOfArtifact = {
  version: 1;
  asOf: string;
  sourcePolicyRegistryHash: Hash;
  candidateCorpusHash: Hash;
  evidenceBodiesHash: Hash;
  contentHash: Hash;
};
export type V33Evidence = {
  evidenceId: string;
  sourceUrl: string;
  sourceHash: Hash;
  sourcePolicyHash: Hash;
  sourceIdentityHash: Hash;
  publisher: string;
  title: string;
  sourceTier: string;
  claimIds: string[];
  retrievedAt: string;
  validUntil: string;
  responseBodySha256: Hash;
  responseBodyBytes: number;
  bodyStorePath: string;
  byteRange: { start: number; end: number };
  excerptBase64: string;
  excerptSha256: Hash;
  supportTokens: string[];
  contentHash: Hash;
};
export type V33Candidate = {
  candidateId: string;
  candidateHash: Hash;
  schemaVersion: typeof QUESTION_BANK_V33;
  categoryId: string;
  modality: V33Modality;
  slotId: string;
  authorUid: string;
  state: "ready_for_human";
  headerAr: string;
  promptAr: string;
  canonicalAnswer: string;
  acceptedAnswers: string[];
  /** Explicit authoring decision; never inherited from category policy. */
  acceptDefiniteArticle: boolean;
  answerConceptId: string;
  difficulty: V33Difficulty;
  explanationAr?: string | null;
  claimIds: string[];
  evidenceIds: string[];
  targetLetter?: string;
  facetId?: string;
  performanceFacetId?: string;
  mediaId?: string;
};
export type V33Media = {
  mediaId: string;
  localAssetPath: string;
  assetSha256: Hash;
  altAr: string;
  provenance: string;
  licence: string;
  rightsReceiptHash: Hash;
  contentHash: Hash;
};
export type V33ReviewReceipt = {
  receiptId: string;
  version: 1;
  issuer: string;
  signerKeyId: string;
  reviewerUid: string;
  reviewerRole: string;
  authorUid: string;
  reviewRequestNonce: string;
  verdict: "approved" | "rejected";
  questionId: string;
  categoryId: string;
  questionContentHash: Hash;
  evidenceHash: Hash;
  policyHash: Hash;
  mediaHash: Hash | null;
  issuedAt: string;
  receiptHash: Hash;
  signature: string;
};
export type V33Question = Omit<V33Candidate, "state"> & {
  state: "approved";
  evidenceHash: Hash;
  reviewReceiptIds: string[];
  contentHash: Hash;
};
export type V33Finding = {
  severity: V33Severity;
  code: string;
  ids: string[];
  categoryIds: string[];
  message: string;
};
export type V33ValidationReport = {
  schemaVersion: typeof QUESTION_BANK_V33;
  scopeHash: Hash;
  contentHash: Hash;
  asOfHash: Hash;
  candidateCorpusHash: Hash;
  sourcePolicyRegistryHash: Hash;
  evidenceBodiesHash: Hash;
  catalogHash: Hash;
  withinCategoryCandidateComparisons: number;
  findings: V33Finding[];
  counts: Record<V33Severity, number>;
  reportHash: Hash;
};
export type V33TrustRoot = {
  now: string;
  issuers: Record<
    string,
    | {
        keys?: Record<string, string>;
        publicKeys?: Record<string, string>;
        roles?: string[];
        /** Authenticated reviewer-to-role registry for this issuer. */
        reviewers?: Record<string, string[]>;
      }
    | unknown
  >;
};
export type V33Corpus = {
  scope: V33ScopeManifest;
  catalog: V33CategoryCatalog;
  policies: V33CategoryPolicy[];
  slots: V33Slot[];
  candidates: V33Candidate[];
  questions: V33Question[];
  evidence: V33Evidence[];
  media: V33Media[];
  receipts: V33ReviewReceipt[];
  asOfArtifact: V33AsOfArtifact;
  sourcePolicyRegistry: V33SourcePolicyRegistry;
  evidenceBodies: Record<string, Uint8Array>;
  schemaFindings?: V33Finding[];
};
export type V33CategoryApprovedFile = {
  categoryId: string;
  questions: V33Question[];
  canonicalFileHash: Hash;
};

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const h = (x: string | Uint8Array) =>
  createHash("sha256").update(x).digest("hex");
const hash = (x: unknown) => h(canonicalJsonV32(x));
const omit = (x: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(Object.entries(x).filter(([k]) => !keys.includes(k)));
const isHash = (x: unknown): x is string =>
  typeof x === "string" && /^[a-f0-9]{64}$/u.test(x);
const ordered = (x: string[]) =>
  x.length === new Set(x).size && x.every((v, i) => !i || cmp(x[i - 1], v) < 0);
const sameBytes = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);
const add = (
  f: V33Finding[],
  code: string,
  row: Partial<{ candidateId: string; categoryId: string }> | undefined,
  message: string,
) =>
  f.push({
    severity: "error",
    code,
    ids: row?.candidateId ? [row.candidateId] : [],
    categoryIds: row?.categoryId ? [row.categoryId] : [],
    message,
  });
export const policyHashV33 = (
  x: Omit<V33CategoryPolicy, "policyHash"> | V33CategoryPolicy,
) => hash(omit(x as Record<string, unknown>, ["policyHash"]));
export const catalogContentHashV33 = (
  x: Omit<V33CategoryCatalog, "contentHash"> | V33CategoryCatalog,
) => hash({
  schemaVersion: x.schemaVersion,
  categories: x.categories
    .map((category) => ({ id: category.id, labelAr: category.labelAr }))
    .sort((left, right) => cmp(left.id, right.id)),
});
export const candidateHashV33 = (
  x: Omit<V33Candidate, "candidateHash"> | V33Candidate,
) => hash(omit(x as Record<string, unknown>, ["candidateHash"]));
export const evidenceContentHashV33 = (x: V33Evidence) =>
  hash(omit(x as unknown as Record<string, unknown>, ["contentHash"]));
export const mediaContentHashV33 = (x: V33Media) =>
  hash(
    omit(x as unknown as Record<string, unknown>, [
      "contentHash",
      "rightsReceiptHash",
    ]),
  );
export const evidenceHashV33 = (x: V33Evidence[]) =>
  hash(
    x
      .map((e) => ({ id: e.evidenceId, h: e.contentHash }))
      .sort((a, b) => cmp(a.id, b.id)),
  );
export const receiptHashV33 = (x: V33ReviewReceipt) =>
  hash(
    omit(x as unknown as Record<string, unknown>, ["receiptHash", "signature"]),
  );
export const receiptSigningPayloadV33 = (x: V33ReviewReceipt) =>
  `question-bank-v3.3-receipt/v1:${x.receiptHash}`;
export const sourcePolicyRegistryHashV33 = (x: V33SourcePolicyRegistry) =>
  hash(omit(x as unknown as Record<string, unknown>, ["contentHash"]));
export const asOfArtifactHashV33 = (x: V33AsOfArtifact) =>
  hash(omit(x as unknown as Record<string, unknown>, ["contentHash"]));
export const candidateCorpusHashV33 = (x: V33Candidate[]) =>
  hash(
    x
      .map((c) => ({ id: c.candidateId, h: c.candidateHash }))
      .sort((a, b) => cmp(a.id, b.id)),
  );
export const evidenceBodiesHashV33 = (x: Record<string, Uint8Array>) =>
  hash(
    Object.entries(x)
      .map(([id, b]) => ({ id, n: b.length, h: h(b) }))
      .sort((a, b) => cmp(a.id, b.id)),
  );
export function createScopeManifestV33(): V33ScopeManifest {
  const x = {
    schemaVersion: QUESTION_BANK_V33,
    scope: QUESTION_BANK_V33_SCOPE,
    categoryIds: [...RUNTIME_CATEGORY_IDS_V33],
  };
  return { ...x, scopeHash: hash(x) };
}
/** Definite article removal is semantic and only occurs at an initial `ال`. */ export function initialArabicLetterV33(
  x: string,
  article = false,
) {
  let n = exactNormalizeV1(x);
  if (article && /^ال(?=[\u0621-\u064A])/u.test(n)) n = n.slice(2);
  return (ARABIC_ALPHABET_V33 as readonly string[]).includes(n[0]) ? n[0] : "";
}
/** Every playable answer spelling must remain in the immutable candidate slot. */
export function answerVariantsMatchSlotV33(
  candidate: Pick<
    V33Candidate,
    | "modality"
    | "targetLetter"
    | "canonicalAnswer"
    | "acceptedAnswers"
    | "acceptDefiniteArticle"
  >,
): boolean {
  if (candidate.modality === "charades") return !candidate.targetLetter;
  return (
    typeof candidate.targetLetter === "string" &&
    [candidate.canonicalAnswer, ...candidate.acceptedAnswers].every(
      (answer) =>
        initialArabicLetterV33(answer, candidate.acceptDefiniteArticle) ===
        candidate.targetLetter,
    )
  );
}
const quotaKey = (q: V33SlotQuota) =>
  "performanceFacetId" in q
    ? `p\0${q.performanceFacetId}`
    : `l\0${q.targetLetter}\0${q.facetId}`;
const classic = (q: V33SlotQuota): q is V33ClassicSlotQuota =>
  "targetLetter" in q && "facetId" in q;
function validPolicy(p: V33CategoryPolicy) {
  const q = p.slotQuotas,
    k = q.map(quotaKey);
  if (
    p.policyVersion !== QUESTION_BANK_V33_POLICY ||
    p.minimumApproved !== 300 ||
    p.preferredCandidates !== 336 ||
    p.reservePerLetter !== 3 ||
    !ordered(p.supportedAnswerLetters) ||
    !ordered(p.conceptFacets) ||
    !ordered(p.performanceFacets) ||
    k.length !== new Set(k).size ||
    q.reduce((n, x) => n + x.count, 0) !== 336 ||
    q.some((x) => !Number.isInteger(x.count) || x.count < 1)
  )
    return false;
  if (p.modality === "charades")
    return (
      p.selectionMode === "charades_only" &&
      !p.supportedAnswerLetters.length &&
      !p.conceptFacets.length &&
      q.every((x) => !classic(x)) &&
      new Set(q.map((x) => (x as V33CharadesSlotQuota).performanceFacetId))
        .size === p.performanceFacets.length &&
      p.performanceFacets.every((f) =>
        q.some((x) => !classic(x) && x.performanceFacetId === f),
      )
    );
  return (
    p.selectionMode !== "charades_only" &&
    !p.performanceFacets.length &&
    q.every(classic) &&
    new Set(q.map((x) => (x as V33ClassicSlotQuota).targetLetter)).size ===
      p.supportedAnswerLetters.length &&
    new Set(q.map((x) => (x as V33ClassicSlotQuota).facetId)).size ===
      p.conceptFacets.length &&
    p.supportedAnswerLetters.every((l) =>
      q.some((x) => classic(x) && x.targetLetter === l),
    ) &&
    p.conceptFacets.every((f) => q.some((x) => classic(x) && x.facetId === f))
  );
}
/** Input order cannot affect SWRR scheduling, tie-breaking, or resulting ledger. */ export function generateSlotsV33(
  p: V33CategoryPolicy,
): V33Slot[] {
  if (!validPolicy(p)) throw Error("Invalid weighted v3.3 policy.");
  const a = p.slotQuotas
    .slice()
    .sort((l, r) => cmp(quotaKey(l), quotaKey(r)))
    .map((q) => ({ q, n: 0 }));
  return Array.from({ length: 336 }, (_, i) => {
    a.forEach((x) => (x.n += x.q.count));
    let chosen = a[0];
    for (const row of a.slice(1))
      if (
        row.n > chosen.n ||
        (row.n === chosen.n && cmp(quotaKey(row.q), quotaKey(chosen.q)) < 0)
      )
        chosen = row;
    chosen.n -= 336;
    const c = {
      slotId: `${p.categoryId}:${p.modality}:${String(i + 1).padStart(3, "0")}`,
      categoryId: p.categoryId,
      modality: p.modality,
      ordinal: i + 1,
      difficulty: (["easy", "medium", "hard"] as const)[i % 3],
      state: "unfilled" as const,
    };
    return classic(chosen.q)
      ? { ...c, targetLetter: chosen.q.targetLetter, facetId: chosen.q.facetId }
      : { ...c, performanceFacetId: chosen.q.performanceFacetId };
  });
}
const candidateProjection = (q: V33Question): V33Candidate => {
  const candidate = { ...q } as Record<string, unknown>;
  for (const key of [
    "state",
    "evidenceHash",
    "reviewReceiptIds",
    "contentHash",
  ])
    delete candidate[key];
  return { ...candidate, state: "ready_for_human" } as V33Candidate;
};
export const questionContentHashV33 = (x: V33Question) =>
  hash(
    omit(x as unknown as Record<string, unknown>, [
      "contentHash",
      "reviewReceiptIds",
    ]),
  );
const phrase = (text: string, value: string) => {
  const t = exactNormalizeV1(text),
    v = exactNormalizeV1(value);
  return Boolean(v) && ` ${t} `.includes(` ${v} `);
};
const debris = (x: string) =>
  Array.from(x).some(
    (character) =>
      character.charCodeAt(0) < 32 ||
      character === "\u007f" ||
      character === "\ufffd",
  ) ||
  /<\/?(?:html|script|div|span|json)\b|&(?:amp|nbsp|quot|#\d+);|\b(?:Retrieved|بوابة)\b|(?:\[|\(|\{)[^\])}]*$/iu.test(
    x,
  ) ||
  /(?:و|أو|ثم|لكن|من|في|على)$/u.test(x.trim());
const template = (x: V33Candidate) =>
  exactNormalizeV1(x.promptAr)
    .replace(
      new RegExp(
        exactNormalizeV1(x.candidateId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "g",
      ),
      "#",
    )
    .replace(/\b\d+\b/gu, "#");
const roles = (q: V33Question) =>
  q.modality === "image"
    ? ["fact_reviewer", "language_reviewer", "image_rights_reviewer"]
    : q.modality === "charades"
      ? [
          "fact_reviewer",
          "language_reviewer",
          "charades_performance_reviewer",
          "charades_originality_reviewer",
          "charades_cultural_suitability_reviewer",
        ]
      : ["fact_reviewer", "language_reviewer"];
function signedReceipt(
  r: V33ReviewReceipt,
  t: V33TrustRoot,
  q: V33Question,
  p: V33CategoryPolicy,
  e: string,
  m: string | null,
  asOf: string,
) {
  const issuer = t.issuers[r.issuer] as
      | {
          keys?: Record<string, string>;
          publicKeys?: Record<string, string>;
          roles?: string[];
          reviewers?: Record<string, string[]>;
        }
      | undefined,
    key = issuer?.keys?.[r.signerKeyId] ?? issuer?.publicKeys?.[r.signerKeyId];
  if (
    !key ||
    !issuer?.roles?.includes(r.reviewerRole) ||
    !issuer?.reviewers?.[r.reviewerUid]?.includes(r.reviewerRole) ||
    r.version !== 1 ||
    r.verdict !== "approved" ||
    r.receiptHash !== receiptHashV33(r) ||
    r.questionId !== q.candidateId ||
    r.categoryId !== q.categoryId ||
    r.authorUid !== q.authorUid ||
    r.reviewerUid === q.authorUid ||
    r.questionContentHash !== q.contentHash ||
    r.evidenceHash !== e ||
    r.policyHash !== p.policyHash ||
    r.mediaHash !== m ||
    Number.isNaN(Date.parse(r.issuedAt)) ||
    Date.parse(r.issuedAt) < Date.parse(asOf) ||
    Date.parse(r.issuedAt) > Date.parse(t.now)
  )
    return false;
  try {
    return verifySignature(
      null,
      Buffer.from(receiptSigningPayloadV33(r)),
      key,
      Buffer.from(r.signature, "base64"),
    );
  } catch {
    return false;
  }
}
export function validateCorpusV33(
  c: V33Corpus,
  t?: V33TrustRoot,
): V33ValidationReport {
  const f = [...(c.schemaFindings ?? [])],
    pol = new Map(c.policies.map((x) => [x.categoryId, x])),
    slots = new Map(c.slots.map((x) => [x.slotId, x])),
    ev = new Map(c.evidence.map((x) => [x.evidenceId, x])),
    registry = new Map(
      c.sourcePolicyRegistry.policies.map((x) => [x.sourcePolicyHash, x]),
    );
  if (canonicalJsonV32(c.scope) !== canonicalJsonV32(createScopeManifestV33()))
    add(f, "scope_manifest_invalid", undefined, "fixed scope");
  if (
    c.catalog.schemaVersion !== QUESTION_BANK_V33 ||
    c.catalog.contentHash !== catalogContentHashV33(c.catalog) ||
    c.catalog.categories.length !== 62 ||
    new Set(c.catalog.categories.map((category) => category.id)).size !== 62 ||
    c.catalog.categories.some(
      (category) =>
        !c.scope.categoryIds.includes(category.id) ||
        typeof category.labelAr !== "string" ||
        !category.labelAr.trim(),
    )
  )
    add(f, "catalog_labels_invalid", undefined, "immutable category labels");
  if (
    c.policies.length !== 62 ||
    new Set(c.policies.map((x) => x.categoryId)).size !== 62
  )
    add(f, "policy_scope_invalid", undefined, "62 policies");
  if (
    c.asOfArtifact.contentHash !== asOfArtifactHashV33(c.asOfArtifact) ||
    c.asOfArtifact.sourcePolicyRegistryHash !==
      c.sourcePolicyRegistry.contentHash ||
    c.sourcePolicyRegistry.contentHash !==
      sourcePolicyRegistryHashV33(c.sourcePolicyRegistry) ||
    c.asOfArtifact.candidateCorpusHash !==
      candidateCorpusHashV33(c.candidates) ||
    c.asOfArtifact.evidenceBodiesHash !==
      evidenceBodiesHashV33(c.evidenceBodies) ||
    Number.isNaN(Date.parse(c.asOfArtifact.asOf))
  )
    add(
      f,
      "as_of_or_source_registry_invalid",
      undefined,
      "hash-bound corpus time",
    );
  for (const p of c.policies) {
    if (
      !validPolicy(p) ||
      p.policyHash !== policyHashV33(p) ||
      !c.scope.categoryIds.includes(p.categoryId)
    )
      add(f, "invalid_weighted_policy", p, "policy");
    else if (
      canonicalJsonV32(c.slots.filter((s) => s.categoryId === p.categoryId)) !==
      canonicalJsonV32(generateSlotsV33(p))
    )
      add(f, "slot_ledger_not_canonical", p, "ledger");
  }
  if (c.slots.length !== 20832 || slots.size !== 20832)
    add(f, "slot_corpus_invalid", undefined, "62x336 slots");
  const ids = new Set<string>(),
    usedSlots = new Set<string>(),
    templates = new Map<string, V33Candidate[]>();
  for (const x of c.candidates) {
    const s = slots.get(x.slotId),
      p = pol.get(x.categoryId);
    if (
      !ids.add(x.candidateId) ||
      !usedSlots.add(x.slotId) ||
      x.state !== "ready_for_human" ||
      x.candidateHash !== candidateHashV33(x) ||
      !s ||
      !p ||
      s.categoryId !== x.categoryId ||
      s.modality !== x.modality ||
      s.difficulty !== x.difficulty
    )
      add(f, "candidate_slot_or_hash_invalid", x, "candidate");
    if (
      x.answerConceptId !== answerConceptIdV32(x.canonicalAnswer) ||
      !answerVariantsMatchSlotV33(x) ||
      (x.modality === "charades"
        ? Boolean(x.targetLetter || x.facetId || !x.performanceFacetId)
        : Boolean(!x.targetLetter || !x.facetId || x.performanceFacetId))
    )
      add(f, "candidate_answer_binding_invalid", x, "answer");
    if (
      (x.explanationAr !== undefined &&
        x.explanationAr !== null &&
        (!x.explanationAr.trim() ||
          exactNormalizeV1(x.explanationAr) ===
            exactNormalizeV1(x.promptAr))) ||
      phrase(x.headerAr, x.canonicalAnswer) ||
      phrase(x.promptAr, x.canonicalAnswer) ||
      x.acceptedAnswers.some(
        (a) => phrase(x.headerAr, a) || phrase(x.promptAr, a),
      ) ||
      phrase(x.headerAr, x.candidateId) ||
      phrase(x.promptAr, x.candidateId) ||
      /(?:slot|ordinal|سؤال\s*رقم)\s*\d+/iu.test(
        x.headerAr + " " + x.promptAr,
      ) ||
      ["ما هذا", "من هو", "اذكر الاجابة"].includes(
        exactNormalizeV1(x.promptAr),
      ) ||
      exactNormalizeV1(x.promptAr) === exactNormalizeV1(x.headerAr) ||
      debris(x.headerAr) ||
      debris(x.promptAr)
    )
      add(f, "candidate_authoring_quality_invalid", x, "quality");
    if (
      !ordered(x.claimIds) ||
      !ordered(x.evidenceIds) ||
      !x.claimIds.every((id) =>
        x.evidenceIds.some((e) => ev.get(e)?.claimIds.includes(id)),
      )
    )
      add(f, "candidate_claim_evidence_invalid", x, "claims");
    templates.set(template(x), [...(templates.get(template(x)) ?? []), x]);
  }
  if (
    c.candidates.length !== 20832 ||
    ids.size !== 20832 ||
    usedSlots.size !== 20832
  )
    add(f, "candidate_corpus_invalid", undefined, "62x336 candidates");
  for (const rows of templates.values())
    if (rows.length >= 3)
      add(
        f,
        "candidate_template_collapse",
        rows[0],
        "3 prompts share template",
      );
  let comparisons = 0;
  for (const categoryId of c.scope.categoryIds) {
    const rows = c.candidates
      .filter((x) => x.categoryId === categoryId)
      .sort((a, b) => cmp(a.candidateId, b.candidateId));
    comparisons += (rows.length * (rows.length - 1)) / 2;
    for (let i = 0; i < rows.length; i++)
      for (let j = 0; j < i; j++)
        if (
          exactNormalizeV1(rows[i].promptAr) ===
            exactNormalizeV1(rows[j].promptAr) ||
          promptSimilarityV1(rows[i].promptAr, rows[j].promptAr) >= 0.9
        )
          add(f, "candidate_near_duplicate", rows[i], "duplicate");
  }
  if (comparisons !== 3489360)
    add(
      f,
      "candidate_comparison_count_invalid",
      undefined,
      "3,489,360 exhaustive pairs",
    );
  const bound = new Set<string>();
  for (const x of c.evidence) {
    const body = c.evidenceBodies[x.bodyStorePath],
      excerpt = Buffer.from(x.excerptBase64, "base64"),
      source = registry.get(x.sourcePolicyHash);
    if (
      !source ||
      source.sourceIdentityHash !== x.sourceIdentityHash ||
      source.sourceUrl !== x.sourceUrl ||
      source.publisher !== x.publisher ||
      source.title !== x.title ||
      source.sourceTier !== x.sourceTier ||
      x.contentHash !== evidenceContentHashV33(x) ||
      !body ||
      body.length !== x.responseBodyBytes ||
      h(body) !== x.responseBodySha256 ||
      x.byteRange.start < 0 ||
      x.byteRange.end <= x.byteRange.start ||
      x.byteRange.end > body.length ||
      !sameBytes(body.subarray(x.byteRange.start, x.byteRange.end), excerpt) ||
      h(excerpt) !== x.excerptSha256 ||
      !x.supportTokens.every((token) =>
        new TextDecoder().decode(excerpt).includes(token),
      ) ||
      Number.isNaN(Date.parse(x.retrievedAt)) ||
      Number.isNaN(Date.parse(x.validUntil)) ||
      Date.parse(x.validUntil) < Date.parse(c.asOfArtifact.asOf)
    )
      add(
        f,
        "evidence_integrity_or_freshness_invalid",
        undefined,
        x.evidenceId,
      );
  }
  for (const x of c.candidates) x.evidenceIds.forEach((id) => bound.add(id));
  for (const x of c.evidence)
    if (!bound.has(x.evidenceId))
      add(f, "orphan_bound_evidence", undefined, x.evidenceId);
  const receiptIds = new Set<string>(),
    receiptHashes = new Set<string>(),
    receiptNonces = new Set<string>();
  for (const receipt of c.receipts) {
    if (
      receiptIds.has(receipt.receiptId) ||
      receiptHashes.has(receipt.receiptHash) ||
      receiptNonces.has(receipt.reviewRequestNonce)
    )
      add(f, "review_receipt_replay_invalid", undefined, receipt.receiptId);
    receiptIds.add(receipt.receiptId);
    receiptHashes.add(receipt.receiptHash);
    receiptNonces.add(receipt.reviewRequestNonce);
  }
  const candidates = new Map(c.candidates.map((x) => [x.candidateId, x])),
    receipts = new Map(c.receipts.map((x) => [x.receiptId, x])),
    reuse = new Map<string, V33Question[]>(),
    receiptQuestionUse = new Map<string, string[]>();
  for (const q of c.questions) {
    const x = candidates.get(q.candidateId),
      p = pol.get(q.categoryId),
      e = q.evidenceIds
        .map((id) => ev.get(id))
        .filter((x): x is V33Evidence => Boolean(x)),
      m = q.mediaId ? c.media.find((x) => x.mediaId === q.mediaId) : undefined;
    if (
      !x ||
      x.candidateHash !== q.candidateHash ||
      canonicalJsonV32(x) !== canonicalJsonV32(candidateProjection(q)) ||
      q.contentHash !== questionContentHashV33(q) ||
      !p ||
      q.evidenceHash !== evidenceHashV33(e)
    )
      add(f, "approved_candidate_projection_invalid", q, "projection");
    const rs = q.reviewReceiptIds
      .map((id) => receipts.get(id))
      .filter((x): x is V33ReviewReceipt => Boolean(x));
    for (const receiptId of q.reviewReceiptIds)
      receiptQuestionUse.set(receiptId, [
        ...(receiptQuestionUse.get(receiptId) ?? []),
        q.candidateId,
      ]);
    const requiredRoles = roles(q);
    const validByRole = new Map(
      rs
        .filter((receipt) =>
          p &&
          t &&
          signedReceipt(
            receipt,
            t,
            q,
            p,
            q.evidenceHash,
            m?.assetSha256 ?? null,
            c.asOfArtifact.asOf,
          ),
        )
        .map((receipt) => [receipt.reviewerRole, receipt]),
    );
    if (
      !p ||
      !t ||
      rs.length !== q.reviewReceiptIds.length ||
      requiredRoles.some((role) => !validByRole.has(role)) ||
      new Set(
        requiredRoles.map((role) => validByRole.get(role)?.reviewerUid),
      ).size !== requiredRoles.length ||
      (q.modality === "image" &&
        (!m ||
          m.contentHash !== mediaContentHashV33(m) ||
          !rs.some(
            (receipt) =>
              receipt.reviewerRole === "image_rights_reviewer" &&
              receipt.receiptHash === m.rightsReceiptHash,
          )))
    )
      add(f, "required_human_receipt_invalid", q, "receipts");
    const key = `${q.categoryId}\0${q.modality}\0${q.answerConceptId}`;
    reuse.set(key, [...(reuse.get(key) ?? []), q]);
  }
  for (const [receiptId, questionIds] of receiptQuestionUse)
    if (questionIds.length !== 1)
      add(
        f,
        "review_receipt_replay_invalid",
        undefined,
        `${receiptId}:${questionIds.join(",")}`,
      );
  for (const rows of reuse.values()) {
    const p = pol.get(rows[0].categoryId);
    if (rows.length > (p?.closedDomainConceptReuseCap ?? 1))
      add(f, "closed_domain_concept_reuse_invalid", rows[0], "reuse cap");
    if (rows.length === 2 && p?.closedDomainConceptReuseCap === 2) {
      const [a, b] = rows,
        fa = a.modality === "charades" ? a.performanceFacetId : a.facetId,
        fb = b.modality === "charades" ? b.performanceFacetId : b.facetId;
      if (
        !fa ||
        fa === fb ||
        a.claimIds.some((x) => b.claimIds.includes(x)) ||
        a.evidenceIds.some((x) => b.evidenceIds.includes(x)) ||
        promptSimilarityV1(a.promptAr, b.promptAr) >= 0.82
      )
        add(f, "closed_domain_second_use_invalid", a, "second use");
    }
  }
  for (const p of c.policies) {
    const n = c.questions.filter((q) => q.categoryId === p.categoryId).length;
    if (n < 300 || n > 336)
      add(f, "category_approved_count_invalid", p, "approved count");
  }
  const findings = [
      ...new Map(
        f.map((x) => [
          `${x.severity}\0${x.code}\0${x.ids.join("\0")}\0${x.message}`,
          x,
        ]),
      ).values(),
    ].sort((a, b) => cmp(canonicalJsonV32(a), canonicalJsonV32(b))),
    counts = { error: 0, warning: 0, review_required: 0 } as Record<
      V33Severity,
      number
    >;
  findings.forEach((x) => counts[x.severity]++);
  const unsigned = {
    schemaVersion: QUESTION_BANK_V33,
    scopeHash: c.scope.scopeHash,
    contentHash: hash(c.questions.map((x) => x.contentHash).sort(cmp)),
    asOfHash: c.asOfArtifact.contentHash,
    candidateCorpusHash: candidateCorpusHashV33(c.candidates),
    sourcePolicyRegistryHash: c.sourcePolicyRegistry.contentHash,
    evidenceBodiesHash: evidenceBodiesHashV33(c.evidenceBodies),
    catalogHash: c.catalog.contentHash,
    withinCategoryCandidateComparisons: comparisons,
    findings,
    counts,
  };
  return { ...unsigned, reportHash: hash(unsigned) };
}
export function assertReleaseReadyV33(
  r: V33ValidationReport,
  c: V33Corpus,
  t: V33TrustRoot,
) {
  if (
    canonicalJsonV32(validateCorpusV33(c, t)) !== canonicalJsonV32(r) ||
    r.counts.error ||
    r.counts.warning ||
    r.counts.review_required
  )
    throw Error("v3.3 release is not ready.");
}
export function assertSelectedPackPlayableV33(
  c: V33Corpus,
  ids: string[],
  m: V33Modality,
  reserve = 3,
) {
  if (reserve !== 3) throw Error("v3.3 reserve is pinned to three.");
  const policies = new Map(c.policies.map((p) => [p.categoryId, p]));
  if (m === "charades") {
    if (ids.some((id) => policies.get(id)?.selectionMode !== "charades_only"))
      throw Error("Charades stays separate.");
    return;
  }
  if (
    !ids.length ||
    ids.some(
      (id) =>
        policies.get(id)?.modality !== m ||
        policies.get(id)?.selectionMode === "charades_only",
    ) ||
    (ids.length === 1 &&
      policies.get(ids[0])?.selectionMode === "combined_only")
  )
    throw Error("Invalid selected pack.");
  const q = c.questions
    .filter((x) => ids.includes(x.categoryId) && x.modality === m)
    .map((x) => ({
      id: x.candidateId,
      categoryId: x.categoryId,
      modality: x.modality,
      targetLetter: x.targetLetter,
      answerConceptId: x.answerConceptId,
      headerAr: x.headerAr,
      promptAr: x.promptAr,
      canonicalAnswer: x.canonicalAnswer,
      acceptedAnswers: x.acceptedAnswers,
    }));
  let s = createMatchQuestionSelection(q, {
    categories: ids,
    modality: m,
    seed: 1,
    reservePerLetter: 3,
  });
  for (let round = 0; round < 3; round++)
    for (const letter of Object.keys(s.queues).sort(cmp))
      s = selectMatchQuestion(q, s, letter).selection;
}
export const categoryApprovedFileHashV33 = (
  x: Pick<V33CategoryApprovedFile, "categoryId" | "questions">,
) =>
  hash({
    categoryId: x.categoryId,
    questions: x.questions
      .map((q) => ({ id: q.candidateId, h: q.contentHash }))
      .sort((a, b) => cmp(a.id, b.id)),
  });
export function deriveAggregateFromCanonicalFilesV33(
  x: V33CategoryApprovedFile[],
) {
  if (x.length !== 62 || new Set(x.map((f) => f.categoryId)).size !== 62)
    throw Error("Exactly 62 canonical approved files are required.");
  return x
    .slice()
    .sort((a, b) => cmp(a.categoryId, b.categoryId))
    .flatMap((f) => {
      if (
        f.canonicalFileHash !== categoryApprovedFileHashV33(f) ||
        f.questions.length < 300 ||
        f.questions.length > 336 ||
        f.questions.some((q) => q.categoryId !== f.categoryId)
      )
        throw Error(`Invalid canonical approved file ${f.categoryId}.`);
      return f.questions;
    });
}
export function assertCanonicalAggregateEqualsV33(
  f: V33CategoryApprovedFile[],
  q: V33Question[],
) {
  if (
    canonicalJsonV32(
      deriveAggregateFromCanonicalFilesV33(f)
        .map((x) => x.contentHash)
        .sort(cmp),
    ) !== canonicalJsonV32(q.map((x) => x.contentHash).sort(cmp))
  )
    throw Error("Canonical aggregate does not match corpus.");
}
export function projectRuntimeQuestionV33(q: V33Question, m?: V33Media) {
  if (
    !q.answerConceptId ||
    !isHash(q.candidateHash) ||
    (q.modality === "image" && !m)
  )
    throw Error("Runtime question is incomplete.");
  return {
    id: q.candidateId,
    categoryId: q.categoryId,
    modality: q.modality,
    answerConceptId: q.answerConceptId,
    headerAr: q.headerAr,
    promptAr: q.promptAr,
    canonicalAnswer: q.canonicalAnswer,
    acceptedAnswers: q.acceptedAnswers,
    targetLetter: q.targetLetter,
    ...(q.modality === "image"
      ? {
          media: {
            mediaId: m!.mediaId,
            assetSha256: m!.assetSha256,
            altAr: m!.altAr,
          },
        }
      : {}),
  };
}
export function deriveReleaseIdentityV33(
  c: V33Corpus,
  r: V33ValidationReport,
  t: V33TrustRoot,
) {
  assertReleaseReadyV33(r, c, t);
  return `release-${hash({ asOf: c.asOfArtifact.contentHash, catalog: c.catalog.contentHash, report: r.reportHash })}`;
}
