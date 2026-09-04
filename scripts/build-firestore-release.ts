import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalApprovedJsonl, canonicalJson, SAFE_DOCUMENT_ID } from './firestore-release-canonical.js';
import { DEFAULT_VALIDATION_AS_OF, isStrictIsoDate, validateQuestions, type Issue } from './validate-question-bank.js';
import type { Question } from '../src/question-bank.js';
import { assertReleaseReportV32, bankContentHashV32, canonicalJsonV32, validateQuestionBankV32, type CategoryPolicyV32, type QuestionV32, type ValidationReportV32 } from '../src/question-bank-v3.2.js';

const ROOT = process.cwd();
const APPROVED_PATH = join(ROOT, 'content/questions/approved/questions.jsonl');
const MANIFEST_PATH = join(ROOT, 'content/questions/reports/release-manifest.json');
const CATEGORIES_PATH = join(ROOT, 'content/categories/categories.json');

export { canonicalApprovedJsonl } from './firestore-release-canonical.js';
export type ReleaseDocument = { path: string; data: Record<string, unknown> };
export type ReleaseWriteMode = 'create' | 'set';
export type FirestoreReleasePlan = {
  releaseId: string;
  approvedCount: number;
  approvedJsonlSha256: string;
  catalogSha256: string;
  documentRootSha256: string;
  sourceManifestSha256: string;
  asOf: string;
  documents: ReleaseDocument[];
};

const hash = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const byPath = (left: ReleaseDocument, right: ReleaseDocument) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
const documentsHash = (documents: ReleaseDocument[]): string => hash(canonicalJson(documents.slice().sort(byPath).map(({ path, data }) => ({ path, data }))));

/** Only the emulator demo plan carries an active pointer; production preparation never does. */
export function releaseDocumentWriteMode(path: string): ReleaseWriteMode { return path === 'runtime/activeRelease' ? 'set' : 'create'; }

/** Firestore document paths have an even number of non-empty, safe segments. */
export function assertFirestoreDocumentPath(path: string): void {
  const segments = path.split('/');
  if (segments.length === 0 || segments.length % 2 !== 0 || segments.some((segment) => !SAFE_DOCUMENT_ID.test(segment))) throw new Error(`Invalid Firestore document path: ${path}`);
}

export function assertUniqueReleaseDocuments(documents: ReleaseDocument[]): void {
  const paths = new Set<string>();
  for (const document of documents) {
    assertFirestoreDocumentPath(document.path);
    if (paths.has(document.path)) throw new Error(`Release plan contains duplicate document path: ${document.path}`);
    paths.add(document.path);
  }
}

/** Evidence blobs are authoring-only and may never cross a release boundary. */
export function assertReleaseValueExcludesEvidencePayload(value: unknown, label = 'Release value'): void {
  const inspect = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      if (/(?:^|[\\/])evidence-bodies(?:[\\/]|$)|(?:^|[\\/])evidenceBodies(?:[\\/]|$)|\.bin(?:$|[?#])/i.test(value)) throw new Error(`${label} contains a forbidden evidence-body path at ${path}.`);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((item, index) => inspect(item, `${path}[${index}]`)); return; }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (normalized === 'responsebodybase64' || normalized === 'responsebody' || normalized === 'evidencebodies' || normalized.includes('sourcebody') || normalized.includes('evidencebody')) throw new Error(`${label} contains a forbidden evidence-body field at ${path}.${key}.`);
      inspect(child, `${path}.${key}`);
    }
  };
  inspect(value, label);
}

export function assertReleaseDocumentsExcludeEvidencePayload(documents: ReleaseDocument[]): void {
  for (const document of documents) assertReleaseValueExcludesEvidencePayload(document.data, `Release document ${document.path}`);
}

export function assertProductionReleaseAcceptance(questions: Question[], issues: Issue[], v32?: { report: ValidationReportV32; contentHash: string }): void {
  for (const question of questions) {
    const review = question.review;
    if (!review?.factReviewer?.trim() || !review.languageReviewer?.trim() || !review.reviewedAt?.trim()) throw new Error(`Approved question ${question.id} requires non-empty factReviewer, languageReviewer, and reviewedAt.`);
  }
  if (issues.some((issue) => issue.severity === 'error')) throw new Error(`Production release validation has errors: ${issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code).join(', ')}`);
  if (!v32) throw new Error('Production releases require a canonical, hash-bound v3.2 validation report.');
  if (v32) assertReleaseReportV32(v32.report, v32.contentHash);
}

/** Recompute over the exact approved records; report-declared counts/findings are never trusted. */
export function assertExactV32ProductionRelease(questions: QuestionV32[], policyDocument: { categories: CategoryPolicyV32[] }, metadata: { report?: ValidationReportV32; contentHash?: string; dispositions?: unknown }): void {
  if (!Array.isArray(policyDocument.categories) || policyDocument.categories.length !== 66 || new Set(policyDocument.categories.map((policy) => policy.categoryId)).size !== 66) throw new Error('Production release requires the exact 66-policy v3.2 registry.');
  if (!metadata.report || typeof metadata.contentHash !== 'string' || !Array.isArray(metadata.dispositions ?? [])) throw new Error('Production release requires complete v3.2 report metadata.');
  assertReleaseReportV32(metadata.report, metadata.contentHash);
  if (questions.some((question) => question.schemaVersion !== '3.2.0' || question.state !== 'approved' || question.modality === 'charades' || !question.answerConceptId || !question.facetId || question.performanceFacetId)) throw new Error('Production release requires complete approved v3.2 classic/image question records.');
  const recomputed = validateQuestionBankV32({ questions, policies: policyDocument.categories, dispositions: metadata.dispositions as never });
  if (canonicalJsonV32(recomputed) !== canonicalJsonV32(metadata.report) || recomputed.contentHash !== metadata.contentHash) throw new Error('Production v3.2 validation report is fabricated, stale, or does not match the exact approved bank.');
  assertReleaseReportV32(recomputed, metadata.contentHash);
}

export function classifyReleaseDocuments(documents: ReleaseDocument[]): { immutable: ReleaseDocument[]; mutable: ReleaseDocument[] } {
  const immutable = documents.filter((document) => releaseDocumentWriteMode(document.path) === 'create');
  const mutable = documents.filter((document) => releaseDocumentWriteMode(document.path) === 'set');
  if (mutable.length > 1 || mutable.some((document) => document.path !== 'runtime/activeRelease')) throw new Error('A release plan may contain only the active-release pointer as a mutable document.');
  return { immutable, mutable };
}

async function readApprovedBank(path: string): Promise<{ questions: Question[]; canonical: string }> {
  const raw = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? '' : Promise.reject(error));
  const canonical = canonicalApprovedJsonl(raw);
  return { canonical, questions: canonical ? canonical.split('\n').map((line) => JSON.parse(line) as Question) : [] };
}

export async function buildFirestoreReleasePlan(options: { approvedPath?: string; manifestPath?: string; categoriesPath?: string; releaseId?: string; allowEmptyDemo?: boolean; demoFixture?: boolean; production?: boolean } = {}): Promise<FirestoreReleasePlan> {
  const approvedPath = options.approvedPath ?? APPROVED_PATH;
  if (options.production && resolve(approvedPath) !== resolve(APPROVED_PATH)) throw new Error('Production releases accept only content/questions/approved/questions.jsonl.');
  const [bank, schema, manifest, categoriesWrapper, v32PolicyDocument] = await Promise.all([
    readApprovedBank(approvedPath), readFile(join(ROOT, 'content/questions/question.schema.json'), 'utf8').then(JSON.parse), readFile(options.manifestPath ?? MANIFEST_PATH, 'utf8').then(JSON.parse), readFile(options.categoriesPath ?? CATEGORIES_PATH, 'utf8').then(JSON.parse), readFile(join(ROOT, 'content/question-bank-v3/v3.2/category-policies.v3.2.json'), 'utf8').then(JSON.parse),
  ]);
  if (!Array.isArray(categoriesWrapper.categories)) throw new Error('Categories file must be a wrapper with a categories array.');
  if (bank.questions.some((question) => question.status !== 'approved')) throw new Error('Approved JSONL may contain only status: approved records.');
  if (!bank.questions.length && !options.allowEmptyDemo) throw new Error('Refusing to build a normal Firestore release with zero approved questions.');
  if (options.production && !isStrictIsoDate(manifest.asOf)) throw new Error('Production release manifest requires a strict asOf date.');
  const asOf = options.production ? manifest.asOf as string : (isStrictIsoDate(manifest.asOf) ? manifest.asOf : DEFAULT_VALIDATION_AS_OF);
  const validation = validateQuestions(bank.questions, schema, asOf); const errors = validation.issues.filter((issue) => issue.severity === 'error');
  if (errors.length) throw new Error(`Approved bank validation failed: ${errors.map((issue) => `${issue.code}${issue.id ? ` (${issue.id})` : ''}`).join(', ')}`);
  const v32 = manifest.questionBankV32 as { report?: ValidationReportV32; contentHash?: string } | undefined;
  if (v32 && (!v32.report || typeof v32.contentHash !== 'string')) throw new Error('Question-bank v3.2 release metadata is malformed.');
  if (v32 && v32.contentHash !== bankContentHashV32(bank.questions as unknown as Array<Record<string, unknown>>)) throw new Error('Question-bank v3.2 report does not bind the approved bank content.');
  const v32Acceptance = v32?.report && typeof v32.contentHash === 'string' ? { report: v32.report as ValidationReportV32, contentHash: v32.contentHash } : undefined;
  if (options.production) { assertProductionReleaseAcceptance(bank.questions, validation.issues, v32Acceptance); assertExactV32ProductionRelease(bank.questions as unknown as QuestionV32[], v32PolicyDocument as { categories: CategoryPolicyV32[] }, manifest.questionBankV32 ?? {}); }
  const approvedJsonlSha256 = hash(bank.canonical);
  if (manifest.approvedQuestionCount !== bank.questions.length) throw new Error(`Release manifest count mismatch: expected ${manifest.approvedQuestionCount}, found ${bank.questions.length}.`);
  if (manifest.approvedBankSha256 !== approvedJsonlSha256) throw new Error('Release manifest SHA-256 does not match the canonical approved JSONL.');
  assertReleaseValueExcludesEvidencePayload(manifest, 'Release manifest');
  const derivedReleaseId = options.demoFixture ? `demo-empty-${approvedJsonlSha256.slice(0, 16)}` : `release-${approvedJsonlSha256}`;
  if (!options.demoFixture && options.releaseId && options.releaseId !== derivedReleaseId) throw new Error('Production release ID must be the full SHA-256-derived release ID.');
  const releaseId = options.releaseId ?? derivedReleaseId;
  const categories = (categoriesWrapper.categories as Array<{ id: string; [key: string]: unknown }>).slice().sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  for (const category of categories) if (typeof category.id !== 'string' || !SAFE_DOCUMENT_ID.test(category.id)) throw new Error('Categories contain a path-unsafe id.');
  const categoryIds = new Set(categories.map((category) => category.id));
  if (categoryIds.size !== categories.length) throw new Error('Categories contain duplicate IDs.');
  for (const question of bank.questions) if (typeof question.categoryId !== 'string' || !SAFE_DOCUMENT_ID.test(question.categoryId) || !categoryIds.has(question.categoryId)) throw new Error(`Approved question ${question.id} has an unknown or path-unsafe categoryId.`);
  const catalogDocuments = categories.map((category) => ({ path: `catalogCategories/${category.id}`, data: category as Record<string, unknown> }));
  const questionDocuments = bank.questions.map((question) => ({ path: `releases/${releaseId}/questions/${question.id}`, data: question as unknown as Record<string, unknown> }));
  const inventory = new Map<string, number>(); for (const question of bank.questions) inventory.set(question.categoryId, (inventory.get(question.categoryId) ?? 0) + 1);
  const inventoryDocuments = [...inventory.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([categoryId, approvedCount]) => ({ path: `releases/${releaseId}/inventory/${categoryId}`, data: { categoryId, approvedCount } }));
  const catalogSha256 = documentsHash(catalogDocuments);
  const documentRootSha256 = documentsHash([...catalogDocuments, ...questionDocuments, ...inventoryDocuments]);
  const sourceManifestSha256 = hash(canonicalJson(manifest));
  const releaseRoot: ReleaseDocument = { path: `releases/${releaseId}`, data: { releaseId, asOf, approvedCount: bank.questions.length, approvedJsonlSha256, catalogSha256, documentRootSha256, sourceManifestSha256, immutable: true, demoFixture: Boolean(options.demoFixture), sourceManifestSchemaVersion: manifest.schemaVersion ?? null } };
  const documents = [...catalogDocuments, ...questionDocuments, ...inventoryDocuments, releaseRoot].sort(byPath);
  if (options.demoFixture) documents.push({ path: 'runtime/activeRelease', data: { releaseId, approvedCount: bank.questions.length, approvedJsonlSha256, demoFixture: true } });
  assertUniqueReleaseDocuments(documents);
  assertReleaseDocumentsExcludeEvidencePayload(documents);
  classifyReleaseDocuments(documents);
  return { releaseId, asOf, approvedCount: bank.questions.length, approvedJsonlSha256, catalogSha256, documentRootSha256, sourceManifestSha256, documents };
}

export function assertDemoEmulatorTarget(environment: NodeJS.ProcessEnv = process.env): void {
  const projectId = environment.GCLOUD_PROJECT ?? environment.FIREBASE_PROJECT_ID;
  if (!environment.FIRESTORE_EMULATOR_HOST) throw new Error('FIRESTORE_EMULATOR_HOST is required; real Firestore access is disabled.');
  if (!projectId?.startsWith('demo-')) throw new Error('A demo-* project ID is required for seeding.');
}

async function main() {
  const demo = process.argv.includes('--demo');
  const plan = await buildFirestoreReleasePlan({ allowEmptyDemo: demo, demoFixture: demo, production: !demo });
  console.log(JSON.stringify({ releaseId: plan.releaseId, asOf: plan.asOf, approvedCount: plan.approvedCount, approvedJsonlSha256: plan.approvedJsonlSha256, catalogSha256: plan.catalogSha256, documentRootSha256: plan.documentRootSha256, sourceManifestSha256: plan.sourceManifestSha256, documentCount: plan.documents.length, dryRun: process.argv.includes('--dry-run'), production: !demo }, null, 2));
  if (!process.argv.includes('--dry-run')) assertDemoEmulatorTarget();
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
