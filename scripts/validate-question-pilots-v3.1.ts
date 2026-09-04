import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import { inspectEvidenceBodies, parseResponseBodyReference } from './evidence-body-store-v3.1.js';

const ROOT = process.cwd();
const DEFAULT_ROOT = 'content/question-bank-v3/pilots';
const SCHEMAS = 'content/question-bank-v3/schemas';
const REGISTRY = 'content/question-bank-v3/pilot-source-identities.v3.1.json';
const CATEGORY = /^(?:tahadani-[0-9]{3}|huroof-00[1-4])$/;
const BATCH_FILE = /^(batch-[a-z0-9]+(?:-[a-z0-9]+)*)\.(questions\.jsonl|evidence\.jsonl|report\.json)$/;
const SUPPORTED_LETTERS = new Set(['ا', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'ه', 'و', 'ي']);
const GENERIC_SUPPORT_TOKENS = new Set(['the', 'www', 'index', 'list', 'science', 'official', 'source', 'page']);
const STATE_KEYS = ['draft', 'evidence_ready', 'ready_for_human'] as const;

type Json = Record<string, unknown>;
type IssueKind = 'evidence' | 'question' | 'duplicate';
type Policy = { id: string; canonicalUrlPrefix: string; publisher: string; sourceTiers: string[] };
type SourceIdentity = {
  id: string;
  sourcePolicyId: string;
  canonicalUrl: string;
  publisher: string;
  title: string;
  responseBodySha256: string;
  sha256: string;
};
type Batch = {
  categoryId: string;
  stem: string;
  questions: Json[];
  evidence: Json[];
  report?: Json;
  issues: Set<string>;
  reportCanonical: boolean;
};
type QuestionRef = { batch: Batch; id: string; prompt: string };
type Schemas = { question: ValidateFunction; evidence: ValidateFunction; report: ValidateFunction };

export type PilotValidation = {
  root: string;
  batches: number;
  questions: number;
  evidence: number;
  states: Record<string, number>;
  issues: string[];
  integrityChecked: true;
  semanticEntailment: 'human_review_required';
  approved: 0;
  released: 0;
};

const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value as Json).sort().map((key) => [key, sortJson((value as Json)[key])]));
}

export const canonicalJsonV31 = (value: unknown) => JSON.stringify(sortJson(value));

function normalizeArabic(value: string) {
  return value
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06EDـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ؤ]/g, 'و')
    .replace(/[ئى]/g, 'ي');
}

function addIssue(batch: Batch, type: IssueKind, id: string) {
  batch.issues.add(`${type}:${id || 'invalid'}`);
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function decodeBase64(value: unknown): Buffer | undefined {
  if (typeof value !== 'string' || value.length === 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return undefined;
  const bytes = Buffer.from(value, 'base64');
  return bytes.length > 0 && bytes.toString('base64') === value ? bytes : undefined;
}

function decodeUtf8(bytes: Buffer | undefined): string | undefined {
  if (!bytes) return undefined;
  const text = bytes.toString('utf8');
  return Buffer.from(text, 'utf8').equals(bytes) ? text : undefined;
}

function validCanonicalUrl(value: unknown) {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '' && parsed.hash === '' && parsed.href === value;
  } catch {
    return false;
  }
}

function effectiveAnswer(value: string, acceptDefiniteArticle: boolean) {
  const normalized = normalizeArabic(value);
  return acceptDefiniteArticle && normalized.startsWith('ال') && normalized.length > 2 ? normalized.slice(2) : normalized;
}

/** Punctuation is a token boundary; article handling applies only to the leading answer token. */
function answerAliasTokens(value: string, acceptDefiniteArticle: boolean): string[] {
  const tokens = normalizeArabic(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
  if (acceptDefiniteArticle && tokens[0]?.startsWith('ال') && tokens[0].length > 2) tokens[0] = tokens[0].slice(2);
  return tokens;
}

function displayLeaksAnswer(display: string, alias: string[], acceptDefiniteArticle: boolean): boolean {
  if (!alias.length) return false;
  const tokens = answerAliasTokens(display, false);
  for (let index = 0; index <= tokens.length - alias.length; index += 1) {
    const first = acceptDefiniteArticle && tokens[index].startsWith('ال') && tokens[index].length > 2 ? tokens[index].slice(2) : tokens[index];
    if (first === alias[0] && alias.slice(1).every((token, offset) => tokens[index + offset + 1] === token)) return true;
  }
  return false;
}

function questionAnswerAliases(question: Json): string[][] {
  const acceptDefiniteArticle = question.acceptDefiniteArticle === true;
  const answers = [String(question.canonicalAnswer ?? ''), ...(Array.isArray(question.acceptedAnswers) ? question.acceptedAnswers.map(String) : [])];
  const aliases = new Map<string, string[]>();
  for (const answer of answers) {
    const tokens = answerAliasTokens(answer, acceptDefiniteArticle);
    if (tokens.length) aliases.set(tokens.join('\u001f'), tokens);
  }
  return [...aliases.values()];
}

function answerInitial(value: string, acceptDefiniteArticle: boolean) {
  return effectiveAnswer(value, acceptDefiniteArticle).match(/[\u0621-\u064A]/)?.[0] ?? '';
}

export function difficultyScoreV31(rationale: Json) {
  return (6 - Number(rationale.familiarity)) + (6 - Number(rationale.clueDirectness)) + Number(rationale.domainSpecificity) + Number(rationale.retrievalBurden);
}

export function difficultyLevelV31(score: number) {
  return score <= 9 ? 'easy' : score <= 14 ? 'medium' : 'hard';
}

export function sourceIdentitySha256V31(source: Pick<SourceIdentity, 'sourcePolicyId' | 'canonicalUrl' | 'publisher' | 'title' | 'responseBodySha256'>) {
  return sha256(canonicalJsonV31({
    sourcePolicyId: source.sourcePolicyId,
    canonicalUrl: source.canonicalUrl,
    publisher: source.publisher,
    title: source.title,
    responseBodySha256: source.responseBodySha256,
  }));
}

export function sourceIdentityV31(source: Pick<SourceIdentity, 'sourcePolicyId' | 'canonicalUrl' | 'publisher' | 'title' | 'responseBodySha256'>): SourceIdentity {
  const digest = sourceIdentitySha256V31(source);
  return { id: `pilot-source-${digest}`, ...source, sha256: digest };
}

function nearDuplicate(left: string, right: string) {
  const leftTokens = new Set(left.split(' ').filter(Boolean));
  const rightTokens = new Set(right.split(' ').filter(Boolean));
  const union = new Set([...leftTokens, ...rightTokens]);
  if (Math.min(leftTokens.size, rightTokens.size) < 5) return false;
  return [...leftTokens].filter((token) => rightTokens.has(token)).length / union.size >= 0.9;
}

async function validators(): Promise<Schemas> {
  const AjvConstructor = Ajv2020 as unknown as new (options: Record<string, unknown>) => { compile: (schema: object) => ValidateFunction };
  const ajv = new AjvConstructor({ allErrors: true, strict: false, logger: false });
  const compile = async (name: string) => ajv.compile(JSON.parse(await readFile(join(ROOT, SCHEMAS, name), 'utf8')));
  return {
    question: await compile('pilot-question.v3.1.schema.json'),
    evidence: await compile('pilot-evidence.v3.1.schema.json'),
    report: await compile('pilot-report.v3.1.schema.json'),
  };
}

async function readCanonicalJsonl(path: string) {
  const bytes = await readFile(path);
  const raw = bytes.toString('utf8');
  if (raw === '') return [];
  if (!bytes.equals(Buffer.from(raw, 'utf8')) || raw.startsWith('\uFEFF') || raw.includes('\r') || !raw.endsWith('\n') || raw === '\n') {
    throw new Error(`${path}: canonical UTF-8 JSONL with LF terminator required`);
  }
  const lines = raw.slice(0, -1).split('\n');
  if (lines.some((line) => line.length === 0)) throw new Error(`${path}: blank JSONL rows are forbidden`);
  return lines.map((line, index) => {
    const value = JSON.parse(line) as Json;
    if (canonicalJsonV31(value) !== line) throw new Error(`${path}:${index + 1}: JSONL row is not canonical`);
    return value;
  });
}

async function readCanonicalReport(path: string) {
  const bytes = await readFile(path);
  const raw = bytes.toString('utf8');
  if (!bytes.equals(Buffer.from(raw, 'utf8')) || raw.startsWith('\uFEFF')) throw new Error(`${path}: report is not canonical UTF-8 JSON`);
  const value = JSON.parse(raw) as Json;
  return { value, canonical: canonicalJsonV31(value) === raw };
}

async function sourcePolicies() {
  const raw = await readFile(join(ROOT, REGISTRY), 'utf8');
  const value = JSON.parse(raw) as Json;
  if ((raw !== canonicalJsonV31(value) && raw !== `${canonicalJsonV31(value)}\n`) || value.schemaVersion !== '3.1.0' || !Array.isArray(value.identities) || Object.keys(value).sort().join(',') !== 'identities,schemaVersion') {
    throw new Error('pilot source policy registry is invalid or non-canonical');
  }
  const result = new Map<string, Policy>();
  for (const candidate of value.identities) {
    if (!candidate || typeof candidate !== 'object') throw new Error('pilot source policy registry has an invalid record');
    const record = candidate as Json;
    const policy = record as Policy;
    const tiers = Array.isArray(policy.sourceTiers) ? policy.sourceTiers : [];
    if (Object.keys(record).sort().join(',') !== 'canonicalUrlPrefix,id,publisher,sourceTiers' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(policy.id) || !validCanonicalUrl(policy.canonicalUrlPrefix) || typeof policy.publisher !== 'string' || policy.publisher.trim() !== policy.publisher || !policy.publisher || tiers.length === 0 || new Set(tiers).size !== tiers.length || tiers.some((tier) => !['official', 'authoritative', 'primary'].includes(tier)) || result.has(policy.id)) {
      throw new Error('pilot source policy registry has an invalid policy');
    }
    result.set(policy.id, policy);
  }
  return result;
}

function packetIdentity(packet: Json): SourceIdentity {
  return sourceIdentityV31({
    sourcePolicyId: String(packet.sourcePolicyId ?? ''),
    canonicalUrl: String(packet.canonicalUrl ?? ''),
    publisher: String(packet.publisher ?? ''),
    title: String(packet.title ?? ''),
    responseBodySha256: String(packet.responseBodySha256 ?? ''),
  });
}

function validFreshness(freshness: Json | undefined, retrievedAt: string, asOf: string) {
  if (!freshness) return false;
  if (freshness.class === 'stable') return freshness.validUntil === null;
  return freshness.class === 'dated' && validDate(freshness.validUntil) && freshness.validUntil >= retrievedAt && freshness.validUntil >= asOf;
}

function validEvidence(packet: Json, categoryId: string, policies: Map<string, Policy>, asOf: string, bodyBytes: Buffer | undefined) {
  const bodyReference = parseResponseBodyReference(packet.responseBody);
  const excerptBytes = decodeBase64(packet.excerptBase64);
  const bodyText = decodeUtf8(bodyBytes);
  const excerptText = decodeUtf8(excerptBytes);
  const locator = packet.locator as Json | undefined;
  const startByte = Number(locator?.startByte);
  const endByte = Number(locator?.endByte);
  const tokens = Array.isArray(packet.claimSupportTokens) ? packet.claimSupportTokens.map(String) : [];
  const normalizedExcerpt = normalizeArabic(excerptText ?? '').toLowerCase();
  const normalizedBody = normalizeArabic(bodyText ?? '').toLowerCase();
  const normalizedTitle = normalizeArabic(String(packet.title ?? '')).toLowerCase();
  const normalizedTokens = tokens.map((token) => normalizeArabic(token).toLowerCase());
  const policy = policies.get(String(packet.sourcePolicyId ?? ''));
  const identity = packetIdentity(packet);
  const retrievedAt = String(packet.retrievedAt ?? '');
  const url = String(packet.canonicalUrl ?? '');
  const exactRange = Boolean(
    bodyBytes && excerptBytes && locator?.kind === 'response_body_byte_range' &&
    Number.isSafeInteger(startByte) && Number.isSafeInteger(endByte) &&
    startByte >= 0 && endByte > startByte && endByte <= bodyBytes.length &&
    bodyBytes.subarray(startByte, endByte).equals(excerptBytes),
  );
  const validTokens = tokens.length > 0 && new Set(normalizedTokens).size === tokens.length && normalizedTokens.every((token) => token.length >= 2 && !GENERIC_SUPPORT_TOKENS.has(token) && normalizedExcerpt.includes(token));
  return Boolean(
    packet.categoryId === categoryId && bodyText !== undefined && excerptText !== undefined &&
    bodyReference && bodyBytes && excerptBytes && bodyReference.sha256 === packet.responseBodySha256 && bodyReference.byteLength === bodyBytes.byteLength && sha256(bodyBytes) === packet.responseBodySha256 && sha256(excerptBytes) === packet.excerptSha256 && exactRange &&
    policy && url.startsWith(policy.canonicalUrlPrefix) && validCanonicalUrl(url) && packet.publisher === policy.publisher && policy.sourceTiers.includes(String(packet.sourceTier)) &&
    typeof packet.title === 'string' && packet.title.trim() === packet.title && normalizedTitle.length > 0 && normalizedBody.includes(normalizedTitle) &&
    packet.sourceIdentityId === identity.id && packet.sourceIdentitySha256 === identity.sha256 &&
    validDate(retrievedAt) && retrievedAt <= asOf && validFreshness(packet.freshness as Json | undefined, retrievedAt, asOf) && validTokens,
  );
}

function validTemporal(temporal: Json | undefined, asOf: string) {
  if (!temporal || !validDate(temporal.checkedAt) || temporal.checkedAt > asOf) return false;
  if (temporal.kind === 'stable') return temporal.validUntil === null;
  return temporal.kind === 'dated' && validDate(temporal.validUntil) && temporal.validUntil >= temporal.checkedAt && temporal.validUntil >= asOf;
}

function validateQuestion(question: Json, batch: Batch, packetById: Map<string, Json>, packetsByClaim: Map<string, Json[]>, invalidPackets: Set<string>, referencedPacketIds: Set<string>, asOf: string) {
  const id = String(question.id ?? 'invalid');
  const modality = String(question.modality ?? '');
  const prompt = normalizeArabic(String(question.promptAr ?? ''));
  const header = normalizeArabic(String(question.headerAr ?? ''));
  const canonicalAnswer = String(question.canonicalAnswer ?? '');
  const acceptedAnswers = Array.isArray(question.acceptedAnswers) ? question.acceptedAnswers.map(String) : [];
  const targetLetter = String(question.targetLetter ?? '');
  const acceptDefiniteArticle = question.acceptDefiniteArticle === true;
  const claims = Array.isArray(question.claimIds) ? question.claimIds.map(String) : [];
  const packetIds = Array.isArray(question.evidencePacketIds) ? question.evidencePacketIds.map(String) : [];
  const rationale = question.difficultyRationale as Json | undefined;
  const normalizedAccepted = acceptedAnswers.map((answer) => effectiveAnswer(answer, acceptDefiniteArticle));
  const normalizedCanonical = effectiveAnswer(canonicalAnswer, acceptDefiniteArticle);
  const aliasesForLeak = questionAnswerAliases(question);
  const answerLeak = aliasesForLeak.some((alias) => displayLeaksAnswer(prompt, alias, acceptDefiniteArticle) || displayLeaksAnswer(header, alias, acceptDefiniteArticle));
  const acceptedValid = acceptedAnswers.length > 0 && normalizedAccepted.includes(normalizedCanonical) && new Set(normalizedAccepted).size === normalizedAccepted.length && normalizedAccepted.every((answer) => answer.length > 0);
  const nonCharades = modality === 'classic' || modality === 'image';
  const letterValid = SUPPORTED_LETTERS.has(targetLetter) && typeof question.acceptDefiniteArticle === 'boolean' && normalizedAccepted.every((answer) => answerInitial(answer, false) === targetLetter) && answerInitial(canonicalAnswer, acceptDefiniteArticle) === targetLetter;
  const referenced = packetIds.map((packetId) => packetById.get(packetId));
  packetIds.forEach((packetId) => referencedPacketIds.add(packetId));
  const linksValid = claims.length === packetIds.length && claims.length > 0 && claims.every((claim) => (packetsByClaim.get(claim)?.length ?? 0) === 1) && referenced.every((packet) => packet && claims.includes(String(packet.claimId)) && !invalidPackets.has(String(packet.packetId)));
  const charadesReview = question.charadesReview as Json | null;
  const charadesValid = modality !== 'charades' || question.evidencePolicy === 'not_applicable_charades' && !Object.hasOwn(question, 'targetLetter') && !Object.hasOwn(question, 'acceptDefiniteArticle') && claims.length === 0 && packetIds.length === 0 && charadesReview?.originality === 'pending_human_review' && charadesReview?.suitability === 'pending_human_review';
  const score = rationale ? difficultyScoreV31(rationale) : Number.NaN;
  const explanationValid = question.explanationAr === null || typeof question.explanationAr === 'string' && question.explanationAr.trim().length > 0;
  if (
    question.categoryId !== batch.categoryId || !id.startsWith(`pilot-${batch.categoryId}-`) ||
    header.length > 0 && prompt.includes(header) || answerLeak || !acceptedValid || !charadesValid ||
    nonCharades && (question.evidencePolicy !== 'factual_sources_required' || !letterValid || !linksValid) ||
    !nonCharades && modality !== 'charades' || rationale?.difficulty !== question.difficulty ||
    Number(rationale?.score) !== score || question.difficulty !== difficultyLevelV31(score) ||
    !validTemporal(question.temporal as Json | undefined, asOf) || !validDate((question.provenance as Json | undefined)?.createdAt) ||
    String((question.provenance as Json | undefined)?.createdAt ?? '') > asOf || !explanationValid
  ) addIssue(batch, 'question', id);
}

function stateCounts(questions: Json[]) {
  const counts: Record<(typeof STATE_KEYS)[number], number> = { draft: 0, evidence_ready: 0, ready_for_human: 0 };
  for (const question of questions) if (STATE_KEYS.includes(question.state as (typeof STATE_KEYS)[number])) counts[question.state as (typeof STATE_KEYS)[number]] += 1;
  return counts;
}

function expectedIdentities(evidence: Json[]) {
  const identities = new Map<string, SourceIdentity>();
  for (const packet of evidence) {
    const identity = packetIdentity(packet);
    identities.set(identity.id, identity);
  }
  return [...identities.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

export async function validateQuestionPilotsV31(root = join(ROOT, DEFAULT_ROOT), asOf = '2026-09-04', bodyStoreRoot = join(resolve(root), '..', 'evidence-bodies')): Promise<PilotValidation> {
  const problems: string[] = [];
  if (!validDate(asOf)) throw new Error(`invalid as-of date: ${asOf}`);
  const schema = await validators();
  const policies = await sourcePolicies();
  const batches: Batch[] = [];
  let categoryEntries;
  try {
    categoryEntries = await readdir(root, { withFileTypes: true });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { root, batches: 0, questions: 0, evidence: 0, states: stateCounts([]), issues: [`pilot root missing: ${root}`], integrityChecked: true, semanticEntailment: 'human_review_required', approved: 0, released: 0 };
    throw error;
  }

  for (const entry of categoryEntries.filter((candidate) => candidate.isDirectory()).sort((left, right) => left.name < right.name ? -1 : 1)) {
    const categoryId = entry.name;
    if (!CATEGORY.test(categoryId)) {
      problems.push(`invalid pilot category directory: ${categoryId}`);
      continue;
    }
    const directory = join(root, categoryId);
    const filenames = await readdir(directory);
    const stems = new Set<string>();
    for (const filename of filenames) {
      const match = filename.match(BATCH_FILE);
      if (match) stems.add(match[1]);
    }
    if (stems.size === 0) problems.push(`${categoryId}: no pilot batches found`);
    for (const stem of [...stems].sort()) {
      const batch: Batch = { categoryId, stem, questions: [], evidence: [], issues: new Set(), reportCanonical: false };
      const questionFile = join(directory, `${stem}.questions.jsonl`);
      const evidenceFile = join(directory, `${stem}.evidence.jsonl`);
      const reportFile = join(directory, `${stem}.report.json`);
      try { batch.questions = await readCanonicalJsonl(questionFile); } catch (error) { problems.push(String(error)); addIssue(batch, 'question', 'batch'); }
      try { batch.evidence = await readCanonicalJsonl(evidenceFile); } catch (error) { problems.push(String(error)); addIssue(batch, 'evidence', 'batch'); }
      try { const report = await readCanonicalReport(reportFile); batch.report = report.value; batch.reportCanonical = report.canonical; } catch (error) { problems.push(String(error)); }
      batches.push(batch);
    }
  }

  const bodyRecordKeys = new Map<Json, string>();
  const bodyRecords = batches.flatMap((batch) => batch.evidence.map((packet, index) => {
    const key = `${batch.categoryId}/${batch.stem}:${index}`;
    bodyRecordKeys.set(packet, key);
    return { key, batchKey: `${batch.categoryId}/${batch.stem}`, responseBody: packet.responseBody };
  }));
  const bodyInspection = await inspectEvidenceBodies(bodyRecords, bodyStoreRoot);
  problems.push(...bodyInspection.issues.map((issue) => `evidence body store: ${issue}`));
  for (const batch of batches) {
    const packetById = new Map<string, Json>();
    const packetsByClaim = new Map<string, Json[]>();
    const invalidPackets = new Set<string>();
    for (const packet of batch.evidence) {
      const packetId = String(packet.packetId ?? 'invalid');
      const reference = parseResponseBodyReference(packet.responseBody);
      const body = reference ? bodyInspection.bodies.get(reference.sha256) : undefined;
      if (packetById.has(packetId) || bodyInspection.invalidKeys.has(bodyRecordKeys.get(packet) ?? '') || !schema.evidence(packet) || !validEvidence(packet, batch.categoryId, policies, asOf, body)) {
        invalidPackets.add(packetId);
        addIssue(batch, 'evidence', packetId);
      }
      packetById.set(packetId, packet);
      const claimId = String(packet.claimId ?? '');
      packetsByClaim.set(claimId, [...(packetsByClaim.get(claimId) ?? []), packet]);
    }
    const referencedPacketIds = new Set<string>();
    for (const question of batch.questions) {
      const id = String(question.id ?? 'invalid');
      if (!schema.question(question)) addIssue(batch, 'question', id);
      validateQuestion(question, batch, packetById, packetsByClaim, invalidPackets, referencedPacketIds, asOf);
    }
    for (const packetId of packetById.keys()) if (!referencedPacketIds.has(packetId)) addIssue(batch, 'evidence', packetId);
  }

  const questionIds = new Map<string, QuestionRef>();
  const answerAliases = new Map<string, { batch: Batch; id: string }>();
  const prompts: QuestionRef[] = [];
  const packetIds = new Map<string, Batch>();
  const questionClaims = new Map<string, Batch>();
  const evidenceClaims = new Map<string, Batch>();
  const identities = new Map<string, { batch: Batch; identity: SourceIdentity }>();
  const sourcePages = new Map<string, { batch: Batch; identity: SourceIdentity }>();
  for (const batch of batches) {
    for (const question of batch.questions) {
      const ref = { batch, id: String(question.id ?? 'invalid'), prompt: normalizeArabic(String(question.promptAr ?? '')) };
      const existingQuestion = questionIds.get(ref.id);
      if (existingQuestion) { addIssue(existingQuestion.batch, 'duplicate', ref.id); addIssue(batch, 'duplicate', ref.id); } else questionIds.set(ref.id, ref);
      prompts.push(ref);
      for (const alias of questionAnswerAliases(question)) {
        const key = alias.join('\u001f'); const existingAlias = answerAliases.get(key);
        if (existingAlias && existingAlias.id !== ref.id) {
          const collision = `answer-alias:${alias.join('-')}:${existingAlias.id}:${ref.id}`;
          addIssue(existingAlias.batch, 'duplicate', collision); addIssue(batch, 'duplicate', collision);
        } else if (!existingAlias) answerAliases.set(key, { batch, id: ref.id });
      }
      for (const claimId of Array.isArray(question.claimIds) ? question.claimIds.map(String) : []) {
        const existingClaim = questionClaims.get(claimId);
        if (existingClaim) { addIssue(existingClaim, 'duplicate', claimId); addIssue(batch, 'duplicate', claimId); } else questionClaims.set(claimId, batch);
      }
    }
    for (const packet of batch.evidence) {
      const packetId = String(packet.packetId ?? 'invalid');
      const existingPacket = packetIds.get(packetId);
      if (existingPacket) { addIssue(existingPacket, 'duplicate', packetId); addIssue(batch, 'duplicate', packetId); } else packetIds.set(packetId, batch);
      const claimId = String(packet.claimId ?? 'invalid');
      const existingClaim = evidenceClaims.get(claimId);
      if (existingClaim) { addIssue(existingClaim, 'duplicate', claimId); addIssue(batch, 'duplicate', claimId); } else evidenceClaims.set(claimId, batch);
      const identity = packetIdentity(packet);
      const existingIdentity = identities.get(String(packet.sourceIdentityId ?? ''));
      if (existingIdentity && canonicalJsonV31(existingIdentity.identity) !== canonicalJsonV31(identity)) {
        addIssue(existingIdentity.batch, 'evidence', String(packet.sourceIdentityId ?? 'invalid'));
        addIssue(batch, 'evidence', String(packet.sourceIdentityId ?? 'invalid'));
      } else if (!existingIdentity) identities.set(String(packet.sourceIdentityId ?? ''), { batch, identity });
      const existingPage = sourcePages.get(identity.canonicalUrl);
      const pageMetadata = { sourcePolicyId: identity.sourcePolicyId, canonicalUrl: identity.canonicalUrl, publisher: identity.publisher, title: identity.title };
      const existingPageMetadata = existingPage && { sourcePolicyId: existingPage.identity.sourcePolicyId, canonicalUrl: existingPage.identity.canonicalUrl, publisher: existingPage.identity.publisher, title: existingPage.identity.title };
      if (existingPage && canonicalJsonV31(existingPageMetadata) !== canonicalJsonV31(pageMetadata)) {
        addIssue(existingPage.batch, 'evidence', existingPage.identity.id);
        addIssue(batch, 'evidence', identity.id);
      } else if (!existingPage) sourcePages.set(identity.canonicalUrl, { batch, identity });
    }
  }
  for (let left = 0; left < prompts.length; left += 1) {
    for (let right = left + 1; right < prompts.length; right += 1) {
      if (prompts[left].prompt === prompts[right].prompt || nearDuplicate(prompts[left].prompt, prompts[right].prompt)) {
        addIssue(prompts[left].batch, 'duplicate', prompts[left].id);
        addIssue(prompts[right].batch, 'duplicate', prompts[right].id);
      }
    }
  }

  for (const batch of batches) {
    const prefix = `${batch.categoryId}/${batch.stem}`;
    const expectedIssues = [...batch.issues].sort();
    const expectedStates = stateCounts(batch.questions);
    const expectedSources = expectedIdentities(batch.evidence);
    const reportValid = Boolean(
      batch.report && batch.reportCanonical && schema.report(batch.report) &&
      batch.report.categoryId === batch.categoryId && batch.report.batchId === batch.stem &&
      batch.report.questionCount === batch.questions.length && batch.report.evidenceCount === batch.evidence.length &&
      canonicalJsonV31(batch.report.states) === canonicalJsonV31(expectedStates) &&
      canonicalJsonV31(batch.report.issues) === canonicalJsonV31(expectedIssues) &&
      canonicalJsonV31(batch.report.sourceIdentities) === canonicalJsonV31(expectedSources),
    );
    if (!reportValid) problems.push(`${prefix}: report is not canonical and validator-derived`);
    for (const issue of expectedIssues) problems.push(`${prefix}: ${issue}`);
  }

  const allQuestions = batches.flatMap((batch) => batch.questions);
  const allEvidence = batches.flatMap((batch) => batch.evidence);
  return {
    root,
    batches: batches.length,
    questions: allQuestions.length,
    evidence: allEvidence.length,
    states: stateCounts(allQuestions),
    issues: problems.sort(),
    integrityChecked: true,
    semanticEntailment: 'human_review_required',
    approved: 0,
    released: 0,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const root = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, DEFAULT_ROOT);
  const result = await validateQuestionPilotsV31(root);
  console.log(JSON.stringify(result, null, 2));
  if (result.issues.length > 0) process.exitCode = 1;
}
