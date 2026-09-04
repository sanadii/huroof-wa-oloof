import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import type { Candidate } from './question-bank-v3-review.js';

const ROOT = process.cwd();
const CATEGORY_DIR = 'content/question-bank-v3/categories';
const REPORT_PATH = 'content/question-bank-v3/reports/category-split.v3.1.json';
const legacyCatalogPath = 'content/categories/categories.json';
const extensionCatalogPath = 'content/categories/extensions/huroof-v2.1.json';
const schemaPath = 'content/question-bank-v3/schemas/category-record.v3.1.schema.json';
export const V31 = '3.1.0';
export type Modality = 'classic' | 'image' | 'charades';
export type ResolvedCategory = { categoryId: string; filename: string; modality: Modality; displayNameAr: string; origin: 'legacy' | 'extension' };
export type CategoryRecord = { recordVersion: '3.1.0'; candidateId: string; revision: 1; schemaVersion: '3.1.0'; categoryId: string; modality: Modality; headerAr: string; promptAr?: string; phraseAr?: string; canonicalAnswer: string; acceptedAnswers: string[]; targetLetter?: string; difficulty: 'easy' | 'medium' | 'hard'; difficultyRationale: Candidate['difficultyRationale']; explanationAr: null | string; temporal: unknown; claimIds: string[]; evidencePacketIds: string[]; media: unknown; provenance: Candidate['provenance']; workflow: { state: Candidate['state']; disposition: Candidate['disposition']; dispositionReason: string }; legacySources: { authority: 'unverified_legacy_metadata'; sources: unknown[] } };
const deepSort = (value: unknown): unknown => Array.isArray(value) ? value.map(deepSort) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, deepSort(child)])) : value;
export const canonical = (value: unknown) => JSON.stringify(deepSort(value));
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const mode = (sourceMode: unknown): Modality => sourceMode === 'image' ? 'image' : sourceMode === 'charades' ? 'charades' : 'classic';

/** Resolves only the immutable 62-record catalog plus the four pinned extensions. */
export function validateExtensionCatalog(value: unknown): Array<{ id: string; displayNameAr: string }> {
  const root = value as { schemaVersion?: unknown; extensionKind?: unknown; categories?: unknown }; const expected = ['huroof-001', 'huroof-002', 'huroof-003', 'huroof-004'];
  if (root.schemaVersion !== '2.1.0' || root.extensionKind !== 'append_only_authoring_catalog' || !Array.isArray(root.categories) || root.categories.length !== 4) throw new Error('extension catalog must contain exactly four append-only v2.1 records');
  return root.categories.map((raw, index) => { const item = raw as Record<string, unknown>; if (item.id !== expected[index] || typeof item.displayNameAr !== 'string' || item.sourceMode !== 'trivia' || item.classicCompatibility !== 'text' || item.catalogStatus !== 'proposed' || item.origin !== 'v2.1_extension' || item.sortOrder !== index + 63 || item.runtimeVisibility !== false || item.questionReadiness !== 'authoring_only' || item.activation !== 'authoring_only' || !item.cover || (item.cover as Record<string, unknown>).state !== 'proposed' || (item.cover as Record<string, unknown>).publishable !== false) throw new Error(`invalid extension category at index ${index}`); return { id: item.id as string, displayNameAr: item.displayNameAr as string }; });
}
export async function resolveV31Catalog(): Promise<ResolvedCategory[]> {
  const legacy = JSON.parse(await readFile(join(ROOT, legacyCatalogPath), 'utf8')) as { categories: Array<{ id: string; sourceMode: string; displayNameAr: string }> };
  if (legacy.categories.length !== 62 || legacy.categories.some((item, index) => item.id !== `tahadani-${String(index + 1).padStart(3, '0')}`)) throw new Error('immutable 62-category catalog is not contiguous');
  const extensions = validateExtensionCatalog(JSON.parse(await readFile(join(ROOT, extensionCatalogPath), 'utf8')));
  return [...legacy.categories.map((item) => ({ categoryId: item.id, filename: `${item.id}.jsonl`, modality: mode(item.sourceMode), displayNameAr: item.displayNameAr, origin: 'legacy' as const })), ...extensions.map((item) => ({ categoryId: item.id, filename: `${item.id}.jsonl`, modality: 'classic' as const, displayNameAr: item.displayNameAr, origin: 'extension' as const }))];
}

function asRecord(candidate: Candidate, catalog: Map<string, ResolvedCategory>): CategoryRecord {
  const playable = candidate.playable; const categoryId = String(playable.categoryId); const category = catalog.get(categoryId); if (!category) throw new Error(`unknown category ${categoryId}`);
  const questionType = String(playable.questionType ?? 'text'); const modality: Modality = questionType === 'image' ? 'image' : category.modality;
  const targetLetter = typeof playable.targetLetter === 'string' ? playable.targetLetter : undefined;
  if ((modality === 'classic' || modality === 'image') && !targetLetter) throw new Error(`missing target letter ${candidate.candidateId}`);
  if (modality === 'charades' && targetLetter) throw new Error(`charades has target letter ${candidate.candidateId}`);
  const promptAr = String(playable.promptAr ?? ''); const phraseAr = typeof playable.phraseAr === 'string' ? playable.phraseAr : undefined;
  if (!promptAr && !phraseAr) throw new Error(`missing prompt or phrase ${candidate.candidateId}`);
  const difficulty = String(playable.difficulty) as CategoryRecord['difficulty'];
  if (!['easy', 'medium', 'hard'].includes(difficulty) || !candidate.difficultyRationale) throw new Error(`missing documented difficulty rubric ${candidate.candidateId}`);
  return { recordVersion: V31, candidateId: candidate.candidateId, revision: 1, schemaVersion: V31, categoryId, modality, headerAr: String(playable.headerAr ?? ''), ...(promptAr ? { promptAr } : {}), ...(phraseAr ? { phraseAr } : {}), canonicalAnswer: String(playable.canonicalAnswer ?? ''), acceptedAnswers: Array.isArray(playable.acceptedAnswers) ? playable.acceptedAnswers.map(String) : [], ...(targetLetter ? { targetLetter } : {}), difficulty, difficultyRationale: candidate.difficultyRationale, explanationAr: playable.explanationAr === null ? null : String(playable.explanationAr ?? ''), temporal: playable.temporal ?? null, claimIds: candidate.evidencePacketId ? [`claim:${candidate.evidencePacketId}`] : [], evidencePacketIds: candidate.evidencePacketId ? [candidate.evidencePacketId] : [], media: playable.media ?? null, provenance: candidate.provenance, workflow: { state: candidate.state, disposition: candidate.disposition, dispositionReason: candidate.dispositionReason }, legacySources: { authority: 'unverified_legacy_metadata', sources: Array.isArray(playable.sources) ? playable.sources : [] } };
}

export async function writeV31CategoryArtifacts(candidates: Candidate[]) {
  const catalog = await resolveV31Catalog(); const byId = new Map(catalog.map((item) => [item.categoryId, item])); const records = candidates.map((candidate) => asRecord(candidate, byId));
  if (new Set(records.map((record) => record.candidateId)).size !== records.length) throw new Error('duplicate migrated candidate');
  await mkdir(join(ROOT, CATEGORY_DIR), { recursive: true });
  // A later category-generation wave owns new IDs.  Import may refresh only
  // its known migration rows; it must fail rather than erase generated work.
  const migratedIds = new Set(records.map((record) => record.candidateId));
  for (const category of catalog) { const path = join(ROOT, CATEGORY_DIR, category.filename); try { const existing = (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as { candidateId?: unknown }); if (existing.some((row) => typeof row.candidateId !== 'string' || !migratedIds.has(row.candidateId))) throw new Error(`refusing to overwrite non-migrated category row in ${category.filename}`); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
  for (const category of catalog) { const rows = records.filter((record) => record.categoryId === category.categoryId).sort((a, b) => a.candidateId.localeCompare(b.candidateId)); const serialized = rows.map(canonical).join('\n') + (rows.length ? '\n' : ''); await writeFile(join(ROOT, CATEGORY_DIR, category.filename), serialized); }
  const aggregate = records.slice().sort((a, b) => a.candidateId.localeCompare(b.candidateId)).map(canonical).join('\n') + '\n';
  await mkdir(join(ROOT, 'content/question-bank-v3/reports'), { recursive: true }); await writeFile(join(ROOT, 'content/question-bank-v3/aggregate.v3.1.jsonl'), aggregate);
  const report = { schemaVersion: V31, categories: catalog.length, migrated: records.length, perCategory: Object.fromEntries(catalog.map((category) => [category.categoryId, records.filter((record) => record.categoryId === category.categoryId).length])), aggregateSha256: sha(aggregate), approved: 0, released: 0 };
  await writeFile(join(ROOT, REPORT_PATH), JSON.stringify(report, null, 2) + '\n'); return report;
}

export async function validateV31CategoryArtifacts(): Promise<string[]> {
  const catalog = await resolveV31Catalog(); const names = (await readdir(join(ROOT, CATEGORY_DIR))).filter((name) => name.endsWith('.jsonl')).sort(); const expected = catalog.map((item) => item.filename).sort(); const issues: string[] = []; if (JSON.stringify(names) !== JSON.stringify(expected)) issues.push('category filenames do not exactly match resolved catalog');
  const schema = JSON.parse(await readFile(join(ROOT, schemaPath), 'utf8')); const validateSchema = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  const all: CategoryRecord[] = [];
  for (const category of catalog) { const path = join(ROOT, CATEGORY_DIR, category.filename); const rows = (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as CategoryRecord); for (const row of rows) { if (!validateSchema(row)) issues.push(`schema-invalid category record ${row.candidateId}: ${validateSchema.errors?.[0]?.instancePath ?? 'unknown'}`); if (row.categoryId !== category.categoryId || row.modality !== category.modality || row.recordVersion !== V31 || row.schemaVersion !== V31 || (row.modality !== 'charades' && !row.targetLetter) || (row.modality === 'charades' && row.targetLetter) || !row.headerAr || (!row.promptAr && !row.phraseAr) || !row.difficultyRationale || !Array.isArray(row.evidencePacketIds) || row.workflow.state === 'approved' || row.workflow.state === 'released') issues.push(`invalid category record ${row.candidateId}`); } all.push(...rows); }
  const aggregate = await readFile(join(ROOT, 'content/question-bank-v3/aggregate.v3.1.jsonl'), 'utf8'); const expectedAggregate = all.slice().sort((a, b) => a.candidateId.localeCompare(b.candidateId)).map(canonical).join('\n') + '\n'; if (aggregate !== expectedAggregate) issues.push('aggregate is not the canonical union'); if (new Set(all.map((record) => record.candidateId)).size !== all.length) issues.push('duplicate candidate in category files'); if (all.length !== 284) issues.push(`migrated count is ${all.length}, expected 284`); return issues;
}

/** The actual authoring corpus is sampled, but only approved rows could ever be runtime inventory. */
export function simulateActualApprovedCorpus(records: CategoryRecord[], rounds = 1000, seed = 0x9e3779b9) {
  let value = seed >>> 0; let sampled = 0; let playable = 0;
  const approved = records.filter((record) => record.workflow.state === 'approved');
  for (let index = 0; index < rounds; index += 1) { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; sampled += 1; if (approved[value % Math.max(approved.length, 1)]) playable += 1; }
  return { rounds, sampled, approvedInventory: approved.length, runtimePlayable: playable, seed };
}
