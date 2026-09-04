/** Versioned comparison rules.  Exact identity deliberately keeps Arabic letters distinct. */
export const QUESTION_BANK_V32 = '3.2.0';
export const EXACT_NORMALIZER_VERSION = 'arabic-exact-v1';
export const FUZZY_NORMALIZER_VERSION = 'arabic-fuzzy-v1';
export const DUPLICATE_POLICY_VERSION = 'question-bank-duplicate-v3.2';

export type ModalityV32 = 'classic' | 'image' | 'charades';
export type FindingSeverity = 'error' | 'warning' | 'review_required' | 'informational';
export type ReusePolicyV32 = { kind: 'default' | 'closed_domain'; maxPerConcept: 1 | 2 };
export type CategoryPolicyV32 = { categoryId: string; modality: ModalityV32; supportedAnswerLetters: string[]; grossTarget: { preferred: 336; minimum: 300 }; standaloneEligible: boolean; playability: 'letter_board' | 'separate_mode' | 'scope_blocked'; scopeBlocker?: string; reusePolicy: ReusePolicyV32 };
export type QuestionV32 = {
  id: string; schemaVersion: typeof QUESTION_BANK_V32; categoryId: string; modality: ModalityV32; headerAr: string; promptAr: string;
  canonicalAnswer: string; acceptedAnswers: string[]; answerConceptId: string; targetLetter?: string; facetId?: string; performanceFacetId?: string;
  claimIds: string[]; evidencePacketIds: string[]; state: string; acceptDefiniteArticle?: boolean; contentHash?: string; [key: string]: unknown;
};
export type FindingV32 = { severity: FindingSeverity; code: string; ids: string[]; categories: string[]; modalities: ModalityV32[]; concepts: string[]; promptSimilarity?: number; answerSimilarity?: number; thresholdVersion: string; contentHashes: string[]; disposition?: string };
export type DispositionV32 = { kind: 'same_prompt_different_concept' | 'alias_reuse'; ids: [string, string]; contentHashes: [string, string]; policyVersion: typeof DUPLICATE_POLICY_VERSION; disposition: string };
export type SemanticConceptOverrideV32 = { questionId: string; answerConceptId: string; canonicalAnswerHash: string; registryVersion: string };
export const SEMANTIC_CONCEPT_REGISTRY_VERSION = 'semantic-concept-registry-v1';
export type ValidationReportV32 = { schemaVersion: typeof QUESTION_BANK_V32; policyVersion: typeof DUPLICATE_POLICY_VERSION; normalizers: { exact: typeof EXACT_NORMALIZER_VERSION; fuzzy: typeof FUZZY_NORMALIZER_VERSION }; findings: FindingV32[]; counts: Record<FindingSeverity, number>; indexedCandidatePairs: number; quadraticPairsAvoided: number; contentHash: string; reportHash: string };

const DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06EDـ]/g;
const PUNCTUATION = /[^\p{L}\p{N}]+/gu;
/** Browser-safe synchronous SHA-256 over the UTF-8 bytes used by Node's createHash(). */
const SHA256_INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const SHA256_CONSTANTS = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
const rotateRight = (value: number, count: number) => (value >>> count) | (value << (32 - count));
const sha = (value: string): string => {
  const input = new TextEncoder().encode(value); const padded = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64); padded.set(input); padded[input.length] = 0x80;
  const bitLength = BigInt(input.length) * 8n; for (let index = 0; index < 8; index += 1) padded[padded.length - 1 - index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
  const hash = [...SHA256_INITIAL]; const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) { const byte = offset + index * 4; words[index] = ((padded[byte] << 24) | (padded[byte + 1] << 16) | (padded[byte + 2] << 8) | padded[byte + 3]) >>> 0; }
    for (let index = 16; index < 64; index += 1) { const a = words[index - 15]; const b = words[index - 2]; words[index] = (words[index - 16] + (rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3)) + words[index - 7] + (rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10))) >>> 0; }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) { const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25); const choice = (e & f) ^ (~e & g); const temp1 = (h + sum1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0; const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22); const majority = (a & b) ^ (a & c) ^ (b & c); const temp2 = (sum0 + majority) >>> 0; h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0; }
    hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0; hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0; hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0; hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
  }
  return hash.map((word) => word.toString(16).padStart(8, '0')).join('');
};
export function canonicalJsonV32(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonV32).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJsonV32((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function exactNormalizeV1(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').replace(DIACRITICS, '').replace(/[أإآٱ]/g, 'ا').toLocaleLowerCase('ar').replace(PUNCTUATION, ' ').trim().replace(/\s+/g, ' ');
}
/** Fuzzy normalization is suggestions-only; never use it for equality or release identity. */
export function fuzzyNormalizeV1(value: string): string {
  return exactNormalizeV1(value).replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
}
export const contentHashV32 = (question: Omit<QuestionV32, 'contentHash'> | Record<string, unknown>) => sha(canonicalJsonV32(question));
export const bankContentHashV32 = (questions: Array<Record<string, unknown>>) => sha(canonicalJsonV32(questions.map((question) => contentHashV32(Object.fromEntries(Object.entries(question).filter(([key]) => key !== 'contentHash')))).sort()));
export const answerConceptIdV32 = (canonicalAnswer: string) => `concept:${sha(exactNormalizeV1(canonicalAnswer))}`;
const words = (value: string) => exactNormalizeV1(value).split(' ').filter(Boolean);
/** Multiset Dice over ordered character trigrams, never a character-set proxy. */
const dice = (left: readonly string[], right: readonly string[]) => { if (!left.length && !right.length) return 1; const counts = new Map<string, number>(); for (const value of left) counts.set(value, (counts.get(value) ?? 0) + 1); let overlap = 0; for (const value of right) { const remaining = counts.get(value) ?? 0; if (remaining) { overlap += 1; counts.set(value, remaining - 1); } } return left.length + right.length ? (2 * overlap) / (left.length + right.length) : 0; };
const jaccard = (left: string, right: string) => { const a = new Set(words(left)); const b = new Set(words(right)); const union = new Set([...a, ...b]); return union.size ? [...a].filter((item) => b.has(item)).length / union.size : 0; };
const trigrams = (value: string) => Array.from({ length: Math.max(0, value.length - 2) }, (_, index) => value.slice(index, index + 3));
export const promptSimilarityV1 = (left: string, right: string) => Math.max(jaccard(left, right), dice(trigrams(exactNormalizeV1(left)), trigrams(exactNormalizeV1(right))));
function normalizeAlias(question: QuestionV32, value: string) { const normalized = exactNormalizeV1(value); return question.acceptDefiniteArticle === true ? normalized.replace(/^ال(?=\S)/, '') : normalized; }
function aliases(question: QuestionV32) { return new Set([question.canonicalAnswer, ...question.acceptedAnswers].map((value) => normalizeAlias(question, value)).filter(Boolean)); }
function aliasSimilarity(left: QuestionV32, right: QuestionV32) { const a = [...aliases(left)]; const b = [...aliases(right)]; const scores = a.flatMap((x) => b.map((y) => dice(trigrams(x), trigrams(y)))); return left.answerConceptId === right.answerConceptId ? 1 : Math.max(0, ...scores); }
function pairKey(left: QuestionV32, right: QuestionV32) { return [left.id, right.id].sort().join('\u0000'); }
function finding(severity: FindingSeverity, code: string, left: QuestionV32, right: QuestionV32, extra: Partial<FindingV32> = {}): FindingV32 {
  return { severity, code, ids: [left.id, right.id].sort(), categories: [...new Set([left.categoryId, right.categoryId])].sort(), modalities: [...new Set([left.modality, right.modality])].sort() as ModalityV32[], concepts: [...new Set([left.answerConceptId, right.answerConceptId])].sort(), thresholdVersion: DUPLICATE_POLICY_VERSION, contentHashes: [left.contentHash!, right.contentHash!].sort(), ...extra };
}
function dispositionFor(dispositions: DispositionV32[], kind: DispositionV32['kind'], left: QuestionV32, right: QuestionV32) {
  const ids = [left.id, right.id].sort(); const hashes = [left.contentHash!, right.contentHash!].sort();
  return dispositions.find((item) => item.kind === kind && item.policyVersion === DUPLICATE_POLICY_VERSION && canonicalJsonV32(item.ids.slice().sort()) === canonicalJsonV32(ids) && canonicalJsonV32(item.contentHashes.slice().sort()) === canonicalJsonV32(hashes));
}
export function indexedPairsV32(questions: QuestionV32[]) {
  const buckets = new Map<string, QuestionV32[]>();
  for (const question of questions) {
    const normalized = exactNormalizeV1(question.promptAr); const tokens = words(question.promptAr); const grams = trigrams(normalized);
    const positions = [...new Set([0, Math.floor(grams.length / 3), Math.floor((grams.length * 2) / 3), Math.max(0, grams.length - 1)])];
    const keys = new Set<string>([...tokens.slice(0, 6).map((token) => `w:${token}`), ...positions.map((position) => `t:${grams[position] ?? ''}`), `c:${question.answerConceptId}`]);
    for (const key of keys) buckets.set(key, [...(buckets.get(key) ?? []), question]);
  }
  const pairs = new Map<string, [QuestionV32, QuestionV32]>();
  // Small blocks are exhaustive. Oversized blocks use bounded lexical windows, so a
  // frequent stem cannot turn this into all-pairs while near-identical strings remain
  // co-located through their shared prefix/suffix blocks.
  for (const values of buckets.values()) { const sorted = values.slice().sort((a, b) => exactNormalizeV1(a.promptAr).localeCompare(exactNormalizeV1(b.promptAr)) || a.id.localeCompare(b.id)); const window = sorted.length <= 128 ? sorted.length : 96; for (let i = 0; i < sorted.length; i += 1) for (let j = i + 1; j < Math.min(sorted.length, i + window); j += 1) pairs.set(pairKey(sorted[i], sorted[j]), [sorted[i], sorted[j]]); }
  return [...pairs.values()];
}
export function validateQuestionBankV32(input: { questions: QuestionV32[]; policies: CategoryPolicyV32[]; dispositions?: DispositionV32[]; semanticConceptOverrides?: SemanticConceptOverrideV32[]; schemaFindings?: FindingV32[] }): ValidationReportV32 {
  const questions = input.questions.map((value) => { const raw = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'contentHash')); return { ...raw, contentHash: contentHashV32(raw) } as QuestionV32; }); const policies = new Map(input.policies.map((policy) => [policy.categoryId, policy])); const dispositions = input.dispositions ?? []; const overrides = input.semanticConceptOverrides ?? []; const findings: FindingV32[] = [...(input.schemaFindings ?? [])]; const ids = new Map<string, QuestionV32>();
  const add = (value: FindingV32) => findings.push(value);
  for (const question of questions) {
    const prior = ids.get(question.id); if (prior) add(finding('error', 'duplicate_id', prior, question)); else ids.set(question.id, question);
    const policy = policies.get(question.categoryId);
    if (!policy || policy.modality !== question.modality) add(finding('error', 'category_policy_mismatch', question, question));
    if (!['draft', 'evidence_ready', 'ready_for_human', 'approved', 'released'].includes(question.state)) add(finding('error', 'invalid_workflow_state', question, question));
    if (policy && question.modality !== 'charades' && (!policy.supportedAnswerLetters.includes(question.targetLetter ?? '') || policy.playability !== 'letter_board')) add(finding('error', 'unsupported_target_letter_or_playability', question, question));
    if (policy && question.modality === 'charades' && (policy.supportedAnswerLetters.length || policy.playability !== 'separate_mode')) add(finding('error', 'charades_policy_invariant', question, question));
    const override = overrides.find((item) => item.questionId === question.id && item.answerConceptId === question.answerConceptId && item.canonicalAnswerHash === contentHashV32({ canonicalAnswer: question.canonicalAnswer }) && item.registryVersion === SEMANTIC_CONCEPT_REGISTRY_VERSION);
    if (question.answerConceptId !== answerConceptIdV32(question.canonicalAnswer) && !override) add(finding('error', 'answer_concept_not_canonical_or_registered', question, question));
    const seenAliases = new Set<string>(); for (const rawAlias of [question.canonicalAnswer, ...question.acceptedAnswers]) { const normalizedAlias = normalizeAlias(question, rawAlias); if (seenAliases.has(normalizedAlias)) add(finding('error', 'duplicate_normalized_alias_within_question', question, question)); seenAliases.add(normalizedAlias); }
    if (question.modality === 'charades' ? Boolean(question.targetLetter || question.facetId || !question.performanceFacetId) : Boolean(!question.targetLetter || !question.facetId || question.performanceFacetId)) add(finding('error', 'modality_facet_invariant', question, question));
  }
  const exact = new Map<string, QuestionV32>(); const aliasesByValue = new Map<string, QuestionV32>();
  for (const question of questions) {
    const prompt = exactNormalizeV1(question.promptAr); const key = `${prompt}\u0000${question.answerConceptId}`; const prior = exact.get(key);
    if (prior) add(finding('error', 'exact_prompt_concept_duplicate', prior, question)); else exact.set(key, question);
    for (const alias of aliases(question)) { const priorAlias = aliasesByValue.get(alias); if (priorAlias && priorAlias.answerConceptId !== question.answerConceptId) { const disposition = dispositionFor(dispositions, 'alias_reuse', priorAlias, question); if (!disposition) add(finding('review_required', 'alias_reuse_requires_disposition', priorAlias, question)); } else aliasesByValue.set(alias, question); }
  }
  const prompts = new Map<string, QuestionV32[]>();
  for (const question of questions) prompts.set(exactNormalizeV1(question.promptAr), [...(prompts.get(exactNormalizeV1(question.promptAr)) ?? []), question]);
  for (const entries of prompts.values()) for (let left = 0; left < entries.length; left += 1) for (let right = left + 1; right < entries.length; right += 1) if (entries[left].answerConceptId !== entries[right].answerConceptId) { if ([...aliases(entries[left])].some((alias) => aliases(entries[right]).has(alias))) add(finding('error', 'exact_prompt_overlapping_alias_duplicate', entries[left], entries[right])); else { const disposition = dispositionFor(dispositions, 'same_prompt_different_concept', entries[left], entries[right]); if (!disposition) add(finding('review_required', 'same_prompt_different_concept', entries[left], entries[right])); } }
  for (const disposition of dispositions) { const matched = questions.filter((question) => disposition.ids.includes(question.id) && disposition.contentHashes.includes(question.contentHash!)); if (matched.length !== 2 || disposition.policyVersion !== DUPLICATE_POLICY_VERSION) add(finding('error', 'stale_or_invalid_disposition', matched[0] ?? questions[0], matched[1] ?? matched[0] ?? questions[0])); }
  const reuse = new Map<string, QuestionV32[]>();
  for (const question of questions) { const policy = policies.get(question.categoryId); if (!policy) continue; const scope = question.modality === 'charades' ? `${question.categoryId}\u0000${question.modality}\u0000${question.answerConceptId}` : `${question.categoryId}\u0000${question.targetLetter}\u0000${question.modality}\u0000${question.answerConceptId}`; reuse.set(scope, [...(reuse.get(scope) ?? []), question]); }
  for (const entries of reuse.values()) { const policy = policies.get(entries[0].categoryId)!; const cap = policy.reusePolicy.maxPerConcept; if (entries.length > cap) add(finding('error', 'concept_reuse_cap_exceeded', entries[0], entries[cap])); if (entries.length === 2 && cap === 2) { const [left, right] = entries; const facet = left.modality === 'charades' ? left.performanceFacetId : left.facetId; const otherFacet = right.modality === 'charades' ? right.performanceFacetId : right.facetId; const independentlyEvidenced = left.modality === 'charades' ? !left.evidencePacketIds.some((id) => right.evidencePacketIds.includes(id)) : !left.evidencePacketIds.some((id) => right.evidencePacketIds.includes(id)) && left.claimIds.every((id) => !right.claimIds.includes(id)); if (!independentlyEvidenced || !facet || !otherFacet || facet === otherFacet || promptSimilarityV1(left.promptAr, right.promptAr) >= .82) add(finding('error', 'closed_domain_second_facet_invalid', left, right)); } }
  const byConcept = new Map<string, QuestionV32[]>(); for (const question of questions) byConcept.set(question.answerConceptId, [...(byConcept.get(question.answerConceptId) ?? []), question]);
  for (const entries of byConcept.values()) for (let left = 0; left < entries.length; left += 1) for (let right = left + 1; right < entries.length; right += 1) { if (entries[left].categoryId !== entries[right].categoryId && entries[left].modality === entries[right].modality) add(finding('warning', 'cross_category_concept_reuse', entries[left], entries[right])); if (entries[left].modality !== entries[right].modality) add(finding('informational', 'cross_modality_concept_reuse', entries[left], entries[right])); }
  const pairs = indexedPairsV32(questions);
  for (const [left, right] of pairs) { const prompt = promptSimilarityV1(left.promptAr, right.promptAr); const answer = aliasSimilarity(left, right); const sameConcept = left.answerConceptId === right.answerConceptId; const extra = { promptSimilarity: prompt, answerSimilarity: answer };
    if ((prompt >= .9 && answer >= .9) || (sameConcept && prompt >= .82)) add(finding('review_required', 'near_duplicate_high', left, right, extra));
    else if (prompt >= .82 || (sameConcept && prompt >= .7)) add(finding('warning', 'near_duplicate_suggestion', left, right, extra));
  }
  const unique = new Map<string, FindingV32>(); for (const item of findings) unique.set(`${item.severity}:${item.code}:${item.ids.join(',')}`, item);
  const ordered = [...unique.values()].sort((a, b) => canonicalJsonV32(a).localeCompare(canonicalJsonV32(b))); const counts: Record<FindingSeverity, number> = { error: 0, warning: 0, review_required: 0, informational: 0 }; for (const item of ordered) counts[item.severity] += 1;
  const contentHash = bankContentHashV32(questions); const unsigned: Omit<ValidationReportV32, 'reportHash'> = { schemaVersion: QUESTION_BANK_V32, policyVersion: DUPLICATE_POLICY_VERSION, normalizers: { exact: EXACT_NORMALIZER_VERSION, fuzzy: FUZZY_NORMALIZER_VERSION }, findings: ordered, counts, indexedCandidatePairs: pairs.length, quadraticPairsAvoided: Math.max(0, questions.length * (questions.length - 1) / 2 - pairs.length), contentHash }; return { ...unsigned, reportHash: sha(canonicalJsonV32(unsigned)) };
}
export function assertReleaseReportV32(report: ValidationReportV32, expectedContentHash: string) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.findings) || !report.counts || typeof report.counts.error !== 'number' || typeof report.counts.warning !== 'number' || typeof report.counts.review_required !== 'number' || typeof report.counts.informational !== 'number' || typeof report.indexedCandidatePairs !== 'number' || typeof report.quadraticPairsAvoided !== 'number') throw new Error('Question-bank v3.2 report schema is malformed.');
  const unsigned = { ...report }; delete (unsigned as Partial<ValidationReportV32>).reportHash;
  if (report.schemaVersion !== QUESTION_BANK_V32 || report.policyVersion !== DUPLICATE_POLICY_VERSION || report.contentHash !== expectedContentHash || report.reportHash !== sha(canonicalJsonV32(unsigned))) throw new Error('Question-bank v3.2 report/hash mismatch.');
  if (report.counts.error || report.counts.review_required) throw new Error('Question-bank v3.2 release has errors or unresolved review-required findings.');
}
