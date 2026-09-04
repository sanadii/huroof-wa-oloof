import Ajv2020 from 'ajv/dist/2020.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerMatchesLetter, approvedInventory, normalizedQuestionKey, normalizeArabic, sha256, SUPPORTED_LETTERS, tokenSimilarity, type Question } from '../src/question-bank.js';
import { canonicalApprovedJsonl } from './firestore-release-canonical.js';

const ROOT = process.cwd();
const WORKFLOW_EXPLANATION_PATTERNS = [/يجب\s+أن\s+تخضع/u, /مراجعة\s+بشرية/u];
export type Issue = { severity: 'error' | 'warning'; code: string; id?: string; message: string };
export type ValidationResult = { issues: Issue[]; exactDuplicates: Array<{ ids: string[]; key: string }>; nearDuplicates: Array<{ left: string; right: string; similarity: number }>; runtimeInventory: Question[] };
export const DEFAULT_VALIDATION_AS_OF = '2026-09-04';

export function isStrictIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number); const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

async function readJsonl(path: string): Promise<Question[]> {
  const text = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? '' : Promise.reject(error));
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => { try { return JSON.parse(line) as Question; } catch { throw new Error(`Invalid JSONL at ${path}:${index + 1}`); } });
}

function sourceError(url: string): string | null {
  try { const parsed = new URL(url); if (parsed.protocol !== 'https:' || !parsed.hostname || /(^|\.)(localhost|local)$/i.test(parsed.hostname) || /^127\./.test(parsed.hostname) || /^10\./.test(parsed.hostname) || /^192\.168\./.test(parsed.hostname)) return 'source URL must be a public HTTPS URL'; return null; } catch { return 'source URL is malformed'; }
}

export function validateQuestions(questions: Question[], schema: object, asOf = DEFAULT_VALIDATION_AS_OF): ValidationResult {
  if (!isStrictIsoDate(asOf)) throw new Error('Validation requires a strict YYYY-MM-DD asOf date.');
  const AjvConstructor = Ajv2020 as unknown as new (options: Record<string, unknown>) => { compile: (input: object) => ((value: unknown) => boolean) & { errors?: unknown[] }; errorsText: (errors?: unknown[] | null) => string };
  const ajv = new AjvConstructor({ allErrors: true, strict: false }); const validSchema = ajv.compile(schema); const issues: Issue[] = [];
  const exact = new Map<string, string[]>(); const nearDuplicates: Array<{ left: string; right: string; similarity: number }> = [];
  for (const question of questions) {
    if (!validSchema(question)) issues.push({ severity: 'error', code: 'schema', id: question.id, message: ajv.errorsText(validSchema.errors) });
    if (!question.headerAr?.trim()) issues.push({ severity: 'error', code: 'missing_header', id: question.id, message: 'Question header must be non-empty.' });
    if (!question.promptAr?.trim() || !question.canonicalAnswer?.trim()) issues.push({ severity: 'error', code: 'empty_text', id: question.id, message: 'Prompt and canonical answer must be non-empty.' });
    const explanation = question.explanationAr;
    if (typeof explanation === 'string' && WORKFLOW_EXPLANATION_PATTERNS.some((pattern) => pattern.test(explanation))) issues.push({ severity: 'error', code: 'workflow_explanation', id: question.id, message: 'Explanation must contain only player-facing, source-supported additive information, not review workflow text.' });
    if (normalizeArabic(question.promptAr ?? '').startsWith(normalizeArabic(question.headerAr ?? ''))) issues.push({ severity: 'error', code: 'header_embedded_in_prompt', id: question.id, message: 'Prompt must not repeat its display header at the beginning.' });
    for (const answer of [question.canonicalAnswer, ...(question.acceptedAnswers ?? [])]) if (!answerMatchesLetter(answer, question.targetLetter, question.acceptDefiniteArticle)) issues.push({ severity: 'error', code: 'initial_mismatch', id: question.id, message: `Accepted answer “${answer}” does not start with ${question.targetLetter}.` });
    for (const source of question.sources ?? []) { const problem = sourceError(source.url); if (problem) issues.push({ severity: 'error', code: 'source_url', id: question.id, message: problem }); if (!isStrictIsoDate(source.accessedAt)) issues.push({ severity: 'error', code: 'invalid_date', id: question.id, message: 'Source accessedAt must be a real YYYY-MM-DD date.' }); }
    if (!isStrictIsoDate(question.temporal?.verifiedAt) || (question.temporal?.validUntil !== null && !isStrictIsoDate(question.temporal?.validUntil)) || (question.review?.reviewedAt !== null && !isStrictIsoDate(question.review?.reviewedAt))) issues.push({ severity: 'error', code: 'invalid_date', id: question.id, message: 'Question dates must be real YYYY-MM-DD values.' });
    if (!question.sources?.length) issues.push({ severity: 'error', code: 'missing_source', id: question.id, message: 'Fact question lacks a source.' });
    if (question.difficulty === 'hard' && question.sources?.length < 2) issues.push({ severity: 'warning', code: 'hard_source_review', id: question.id, message: 'Hard draft needs a second source or source-review decision.' });
    if (question.temporal?.kind === 'dated' && (!question.temporal.validUntil || question.temporal.validUntil < asOf)) issues.push({ severity: 'error', code: 'expired_dated_fact', id: question.id, message: `Dated fact needs a validUntil on or after ${asOf}.` });
    if (question.questionType === 'image' && (!question.media?.assetId || !question.media.altAr || !/^[a-f0-9]{64}$/i.test(question.media.sha256 ?? '') || !question.media.rightsStatus)) issues.push({ severity: 'error', code: 'invalid_media', id: question.id, message: 'Image question needs local asset, alt text, hash, and rights status.' });
    if (/\b(?:current|latest|today)\b/i.test(question.promptAr) || /الحالي|الأحدث|اليوم/.test(question.promptAr)) issues.push({ severity: 'error', code: 'temporal_language', id: question.id, message: 'Unstable temporal wording is not allowed.' });
    if (question.questionType === 'text' && question.categoryId === 'tahadani-016') issues.push({ severity: 'error', code: 'charades_runtime', id: question.id, message: 'Charades categories cannot enter classic text inventory.' });
    const key = normalizedQuestionKey(question); exact.set(key, [...(exact.get(key) ?? []), question.id]);
  }
  const exactDuplicates = [...exact.entries()].filter(([, ids]) => ids.length > 1).map(([key, ids]) => ({ key, ids }));
  for (const duplicate of exactDuplicates) issues.push({ severity: 'error', code: 'exact_duplicate', message: `Exact duplicate: ${duplicate.ids.join(', ')}` });
  for (let left = 0; left < questions.length; left++) for (let right = left + 1; right < questions.length; right++) { const similarity = tokenSimilarity(questions[left].promptAr, questions[right].promptAr); if (similarity >= 0.86 && normalizeArabic(questions[left].canonicalAnswer) !== normalizeArabic(questions[right].canonicalAnswer)) nearDuplicates.push({ left: questions[left].id, right: questions[right].id, similarity }); }
  return { issues, exactDuplicates, nearDuplicates, runtimeInventory: approvedInventory(questions) };
}

function stableString(value: unknown) { return JSON.stringify(value, null, 2) + '\n'; }
async function main() {
  const asOfIndex = process.argv.indexOf('--as-of'); const asOf = asOfIndex >= 0 ? process.argv[asOfIndex + 1] : undefined;
  if (!isStrictIsoDate(asOf)) throw new Error('Use --as-of YYYY-MM-DD to write a release manifest.');
  const [schema, categoriesData, drafts, approved, seedData] = await Promise.all([readFile(join(ROOT, 'content/questions/question.schema.json'), 'utf8').then(JSON.parse), readFile(join(ROOT, 'content/categories/categories.json'), 'utf8').then(JSON.parse), readJsonl(join(ROOT, 'content/questions/drafts/questions.jsonl')), readJsonl(join(ROOT, 'content/questions/approved/questions.jsonl')), readFile(join(ROOT, 'content/questions/drafts/seed-manifest.json'), 'utf8').then(JSON.parse)]);
  const questions = [...drafts, ...approved]; const result = validateQuestions(questions, schema, asOf); const categories = categoriesData.categories as Array<{ id: string; questionReadiness: string }>;
  const allowedSpecialTopics: Record<string, string> = { 'tahadani-045': 'capital', 'tahadani-046': 'country_capital', 'tahadani-047': 'currency', 'tahadani-051': 'car_brand' };
  const seeds = seedData.seeds as Array<{ id: string; categoryId: string; topic: string; sourceKind: string }>; const seedById = new Map(seeds.map((seed) => [seed.id, seed]));
  if (seeds.length !== drafts.length) result.issues.push({ severity: 'error', code: 'seed_manifest_count', message: 'Draft seed manifest count must match draft JSONL count.' });
  for (const draft of drafts) { const seed = seedById.get(draft.id); if (!seed || seed.categoryId !== draft.categoryId) result.issues.push({ severity: 'error', code: 'seed_category_ownership', id: draft.id, message: 'Draft category must match explicit seed ownership.' }); else if (allowedSpecialTopics[draft.categoryId] && allowedSpecialTopics[draft.categoryId] !== seed.topic) result.issues.push({ severity: 'error', code: 'specialized_topic_mismatch', id: draft.id, message: 'Specialized category topic does not match its declared intent.' }); }
  const coverageRows = categories.flatMap((category) => SUPPORTED_LETTERS.flatMap((letter) => ['easy', 'medium', 'hard'].map((difficulty) => ({ categoryId: category.id, targetLetter: letter, difficulty, draft: questions.filter((q) => q.categoryId === category.id && q.targetLetter === letter && q.difficulty === difficulty && q.status === 'draft').length, approved: questions.filter((q) => q.categoryId === category.id && q.targetLetter === letter && q.difficulty === difficulty && q.status === 'approved').length }))));
  const approvedByLetter = Object.fromEntries(SUPPORTED_LETTERS.map((letter) => [letter, approved.filter((q) => q.targetLetter === letter).length]));
  const draftByLetter = Object.fromEntries(SUPPORTED_LETTERS.map((letter) => [letter, drafts.filter((q) => q.targetLetter === letter).length]));
  const coverage = { schemaVersion: 1, allQuestionCount: questions.length, draftCount: drafts.length, approvedCount: approved.length, draftByLetter, approvedByLetter, cells: coverageRows };
  const readiness = { schemaVersion: 1, approvedInventoryCount: result.runtimeInventory.length, draftsExcludedFromRuntime: drafts.length, combinedPilot: { minimumPerLetter: 8, active: SUPPORTED_LETTERS.every((letter) => approvedByLetter[letter] >= 8), approvedByLetter }, categories: categories.map((category) => ({ categoryId: category.id, approvedCount: approved.filter((q) => q.categoryId === category.id).length, readiness: 'empty', reason: 'No approved questions; drafts are intentionally excluded from runtime.' })) };
  const lexicalPublishers = new Set(['معجم المعاني', 'ويكاموس العربي']);
  const lexicalOnlyFactualDrafts = drafts.filter((draft) => { const seed = seedById.get(draft.id); return seed?.topic !== 'word_puzzle' && draft.sources.length > 0 && draft.sources.every((source) => lexicalPublishers.has(source.publisher)); }).map((draft) => draft.id);
  const lexicalOnlyWordPuzzleDrafts = drafts.filter((draft) => { const seed = seedById.get(draft.id); return seed?.topic === 'word_puzzle' && draft.sources.length > 0 && draft.sources.every((source) => lexicalPublishers.has(source.publisher)); }).map((draft) => draft.id);
  for (const id of lexicalOnlyFactualDrafts) result.issues.push({ severity: 'warning', code: 'lexical_only_factual_source', id, message: 'Factual draft is backed only by lexical sources.' });
  const sourceReview = { schemaVersion: 1, reviewStatus: 'human_review_pending', draftQuestions: drafts.length, approvedQuestions: approved.length, hardDraftsWithTwoSources: drafts.filter((q) => q.difficulty === 'hard' && q.sources.length >= 2).length, explanations: { nullCount: questions.filter((q) => q.explanationAr === null).length, playerFacingAddonCount: questions.filter((q) => q.explanationAr !== null).length }, sourceStrategies: { factualReferenceDrafts: drafts.length - lexicalOnlyWordPuzzleDrafts.length, lexicalOnlyWordPuzzleDrafts: lexicalOnlyWordPuzzleDrafts.length, lexicalOnlyFactualDrafts: lexicalOnlyFactualDrafts.length }, lexicalOnlyWordPuzzleDrafts, lexicalOnlyFactualDrafts, lexicalOnlyFactualDraftCount: lexicalOnlyFactualDrafts.length, flagged: result.issues.filter((issue) => issue.code === 'hard_source_review' || issue.code === 'missing_source' || issue.code === 'source_url' || issue.code === 'lexical_only_factual_source') };
  const approvedRaw = await readFile(join(ROOT, 'content/questions/approved/questions.jsonl'), 'utf8');
  const release = { schemaVersion: 1, asOf, approvedQuestionCount: approved.length, approvedBankSha256: sha256(canonicalApprovedJsonl(approvedRaw)), coverageSha256: sha256(JSON.stringify(coverage)), runtimeOnlyApproved: true };
  const reports = join(ROOT, 'content/questions/reports'); await mkdir(reports, { recursive: true });
  const updatedCategories = { ...categoriesData, categories: categoriesData.categories.map((category: { id: string }) => ({ ...category, questionReadiness: drafts.some((question) => question.categoryId === category.id) ? 'drafting' : 'empty' })) };
  await Promise.all([writeFile(join(ROOT, 'content/categories/categories.json'), stableString(updatedCategories)), writeFile(join(reports, 'coverage.json'), stableString(coverage)), writeFile(join(reports, 'duplicates.json'), stableString({ schemaVersion: 1, exact: result.exactDuplicates, near: result.nearDuplicates })), writeFile(join(reports, 'source-review.json'), stableString(sourceReview)), writeFile(join(reports, 'readiness.json'), stableString(readiness)), writeFile(join(reports, 'release-manifest.json'), stableString(release)), writeFile(join(reports, 'validation.json'), stableString({ schemaVersion: 1, errors: result.issues.filter((issue) => issue.severity === 'error'), warnings: result.issues.filter((issue) => issue.severity === 'warning') }))]);
  const errors = result.issues.filter((issue) => issue.severity === 'error'); console.log(`Validated ${questions.length} questions (${approved.length} approved runtime questions): ${errors.length} errors, ${result.issues.length - errors.length} warnings.`); if (errors.length) process.exitCode = 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch((error) => { console.error(error); process.exitCode = 1; });
