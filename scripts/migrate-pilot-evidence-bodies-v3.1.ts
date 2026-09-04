import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJsonV31, sourceIdentityV31, validateQuestionPilotsV31 } from './validate-question-pilots-v3.1.js';
import { MAX_BODY_BYTES, responseBodyReference, sha256Bytes, writeEvidenceBody } from './evidence-body-store-v3.1.js';

const ROOT = process.cwd();
const PILOTS = join(ROOT, 'content/question-bank-v3/pilots');
const BODY_STORE = join(ROOT, 'content/question-bank-v3/evidence-bodies');
const BACKUPS = join(ROOT, '.evidence-migration-backups');
const STAGING = join(ROOT, '.evidence-migration-staging');
const EVIDENCE_FILE = /^(batch-[a-z0-9]+(?:-[a-z0-9]+)*)\.evidence\.jsonl$/;
type Json = Record<string, unknown>;

export type EvidenceMigrationSummary = { backupPath: string; packets: number; uniqueBodies: number; inlineBytes: number; storedBytes: number; stagedValidation: { issues: string[] }; };

function decodeBase64(value: unknown): Buffer {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('legacy responseBodyBase64 is not canonical base64');
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.toString('base64') !== value) throw new Error('legacy responseBodyBase64 is empty or non-canonical');
  return bytes;
}

function normalizeForIntegrity(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06EDـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/[ؤ]/g, 'و').replace(/[ئى]/g, 'ي').toLowerCase();
}

function assertLegacyPacket(packet: Json, path: string): Buffer {
  const body = decodeBase64(packet.responseBodyBase64);
  const excerpt = decodeBase64(packet.excerptBase64);
  const locator = packet.locator as Json | undefined;
  const start = Number(locator?.startByte); const end = Number(locator?.endByte);
  if (body.byteLength > MAX_BODY_BYTES) throw new Error(`${path}: legacy body exceeds ${MAX_BODY_BYTES} bytes`);
  if (sha256Bytes(body) !== packet.responseBodySha256 || sha256Bytes(excerpt) !== packet.excerptSha256 || locator?.kind !== 'response_body_byte_range' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > body.byteLength || !body.subarray(start, end).equals(excerpt)) throw new Error(`${path}: legacy body/hash/excerpt/locator integrity check failed`);
  const text = body.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(body) || typeof packet.title !== 'string' || !normalizeForIntegrity(text).includes(normalizeForIntegrity(packet.title))) throw new Error(`${path}: legacy body UTF-8/title integrity check failed`);
  return body;
}

async function canonicalRows(path: string): Promise<Json[]> {
  const bytes = await readFile(path); const raw = bytes.toString('utf8');
  if (raw === '') return [];
  if (!bytes.equals(Buffer.from(raw, 'utf8')) || raw.startsWith('\uFEFF') || raw.includes('\r') || !raw.endsWith('\n') || raw === '\n') throw new Error(`${path}: canonical UTF-8 JSONL with LF terminator required`);
  return raw.slice(0, -1).split('\n').map((line, index) => {
    const value = JSON.parse(line) as Json;
    if (canonicalJsonV31(value) !== line) throw new Error(`${path}:${index + 1}: legacy row is not canonical`);
    return value;
  });
}

function reportFor(categoryId: string, batchId: string, questions: Json[], evidence: Json[]): Json {
  const states = { draft: 0, evidence_ready: 0, ready_for_human: 0 };
  for (const question of questions) if (question.state === 'draft' || question.state === 'evidence_ready' || question.state === 'ready_for_human') states[question.state] += 1;
  const identities = new Map<string, unknown>();
  for (const packet of evidence) {
    const identity = sourceIdentityV31({ sourcePolicyId: String(packet.sourcePolicyId), canonicalUrl: String(packet.canonicalUrl), publisher: String(packet.publisher), title: String(packet.title), responseBodySha256: String(packet.responseBodySha256) });
    identities.set(identity.id, identity);
  }
  return { schemaVersion: '3.1.0', categoryId, batchId, questionCount: questions.length, evidenceCount: evidence.length, states, issues: [], sourceIdentities: [...identities.values()].sort((left, right) => String((left as Json).id).localeCompare(String((right as Json).id))), integrityChecked: true, semanticEntailment: 'human_review_required', approved: 0, released: 0 };
}

async function listEvidenceFiles(root: string): Promise<string[]> {
  const categories = await readdir(root, { withFileTypes: true });
  const result: string[] = [];
  for (const category of categories.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    for (const filename of await readdir(join(root, category.name))) if (EVIDENCE_FILE.test(filename)) result.push(join(root, category.name, filename));
  }
  return result;
}

async function writeAtomic(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.stage`;
  await writeFile(temporary, value, { flag: 'wx' });
  await rename(temporary, path);
}

/**
 * One-time, staged migration. It never modifies runtime inputs before the staged
 * corpus validates, and leaves the precise inline rollback copy under .evidence-migration-backups.
 * Follow-up: responseBodySha256 remains in packets because it is part of v3.1 source identity.
 */
export async function migratePilotEvidenceBodies(options: { pilotsRoot?: string; bodyStoreRoot?: string; backupRoot?: string; stagingRoot?: string } = {}): Promise<EvidenceMigrationSummary> {
  const pilotsRoot = resolve(options.pilotsRoot ?? PILOTS); const bodyStoreRoot = resolve(options.bodyStoreRoot ?? BODY_STORE);
  const backupRoot = resolve(options.backupRoot ?? BACKUPS); const stagingRoot = resolve(options.stagingRoot ?? STAGING);
  const token = `v3.1-inline-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const stage = join(stagingRoot, token); const stagedPilots = join(stage, 'pilots'); const stagedBodies = join(stage, 'evidence-bodies'); const backupPath = join(backupRoot, token);
  if (await readdir(bodyStoreRoot).then(() => true).catch(() => false)) throw new Error(`Refusing migration: body store already exists at ${bodyStoreRoot}`);
  const evidenceFiles = await listEvidenceFiles(pilotsRoot);
  const stagedEvidence = new Map<string, string>(); const stagedReports = new Map<string, string>(); const unique = new Map<string, Buffer>(); let packets = 0; let inlineBytes = 0;
  for (const evidenceFile of evidenceFiles) {
    const relativeEvidence = relative(pilotsRoot, evidenceFile); const categoryId = relativeEvidence.split(/[\\/]/)[0]; const batchId = EVIDENCE_FILE.exec(relativeEvidence.split(/[\\/]/)[1])?.[1];
    if (!batchId) throw new Error(`Could not derive batch ID from ${evidenceFile}`);
    const legacy = await canonicalRows(evidenceFile); const migrated: Json[] = [];
    for (let index = 0; index < legacy.length; index += 1) {
      const body = assertLegacyPacket(legacy[index], `${evidenceFile}:${index + 1}`); const reference = responseBodyReference(body);
      if (reference.sha256 !== legacy[index].responseBodySha256) throw new Error(`${evidenceFile}:${index + 1}: source-identity response digest drift`);
      unique.set(reference.sha256, body); inlineBytes += body.byteLength; packets += 1;
      const next: Json = { ...legacy[index], responseBody: reference }; delete next.responseBodyBase64; migrated.push(next);
    }
    stagedEvidence.set(relativeEvidence, migrated.length ? `${migrated.map(canonicalJsonV31).join('\n')}\n` : '');
    const questionsPath = evidenceFile.replace('.evidence.jsonl', '.questions.jsonl'); const questions = await canonicalRows(questionsPath);
    const reportPath = evidenceFile.replace('.evidence.jsonl', '.report.json'); stagedReports.set(relative(pilotsRoot, reportPath), canonicalJsonV31(reportFor(categoryId, batchId, questions, migrated)));
    await writeAtomic(join(stagedPilots, relative(pilotsRoot, questionsPath)), await readFile(questionsPath, 'utf8'));
  }
  for (const [digest, body] of unique) { await writeEvidenceBody(stagedBodies, body); if (digest !== sha256Bytes(body)) throw new Error('staged digest drift'); }
  for (const [path, content] of stagedEvidence) await writeAtomic(join(stagedPilots, path), content);
  for (const [path, content] of stagedReports) await writeAtomic(join(stagedPilots, path), content);
  const stagedValidation = await validateQuestionPilotsV31(stagedPilots, '2026-09-04', stagedBodies);
  if (stagedValidation.issues.length) throw new Error(`Staged migration validation failed: ${stagedValidation.issues.join('; ')}`);
  await mkdir(backupPath, { recursive: true });
  for (const evidenceFile of evidenceFiles) {
    const reportFile = evidenceFile.replace('.evidence.jsonl', '.report.json');
    await writeAtomic(join(backupPath, relative(pilotsRoot, evidenceFile)), await readFile(evidenceFile, 'utf8'));
    await writeAtomic(join(backupPath, relative(pilotsRoot, reportFile)), await readFile(reportFile, 'utf8'));
  }
  let bodyStoreInstalled = false;
  try {
    await mkdir(join(bodyStoreRoot, '..'), { recursive: true }); await rename(stagedBodies, bodyStoreRoot); bodyStoreInstalled = true;
    for (const [path, content] of stagedEvidence) await writeAtomic(join(pilotsRoot, path), content);
    for (const [path, content] of stagedReports) await writeAtomic(join(pilotsRoot, path), content);
    const finalValidation = await validateQuestionPilotsV31(pilotsRoot, '2026-09-04', bodyStoreRoot);
    if (finalValidation.issues.length) throw new Error(`Final migration validation failed: ${finalValidation.issues.join('; ')}`);
  } catch (error) {
    for (const evidenceFile of evidenceFiles) {
      const reportFile = evidenceFile.replace('.evidence.jsonl', '.report.json');
      await writeAtomic(evidenceFile, await readFile(join(backupPath, relative(pilotsRoot, evidenceFile)), 'utf8'));
      await writeAtomic(reportFile, await readFile(join(backupPath, relative(pilotsRoot, reportFile)), 'utf8'));
    }
    if (bodyStoreInstalled) await rename(bodyStoreRoot, join(backupPath, 'failed-evidence-bodies')).catch(() => undefined);
    throw error;
  } finally { await rm(stage, { recursive: true, force: true }); }
  return { backupPath, packets, uniqueBodies: unique.size, inlineBytes, storedBytes: [...unique.values()].reduce((total, body) => total + body.byteLength, 0), stagedValidation: { issues: stagedValidation.issues } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) migratePilotEvidenceBodies().then((summary) => console.log(JSON.stringify(summary, null, 2))).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
