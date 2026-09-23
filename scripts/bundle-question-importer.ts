/** Private, additive Firestore intake for a reviewed local bundle plan. */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './firestore-release-canonical.js';

export const IMPORT_PROJECT = 'huroof-a3ee7';
export const IMPORT_DATABASE = '(default)';
export const IMPORT_LOCATION = 'me-central2';
export const MAX_IMPORT_BATCH_DOCUMENTS = 350;
export const MAX_IMPORT_DOCUMENT_BYTES = 900 * 1024;
export const MAX_IMPORT_BATCH_BYTES = 9 * 1024 * 1024;
export const DEFAULT_MAX_NEW_DOCUMENTS = 19_000;
export const MAX_BUDGETED_DOCUMENT_READS = 49_000;
const require = createRequire(import.meta.url);

export type ImportDocument = { path: string; data: Record<string, unknown> };
export type ImportReport = { schemaVersion: string; bundleSha256: string; documentsPath: string; documentsSha256: string; documentCount: number; contentRootSha256: string; questionCount: number; blueprintCount: number; occurrenceCount: number; sourceFileCount: number; issues: unknown[] };
export type ImportPlan = { report: ImportReport; documents: ImportDocument[]; manifest: ImportDocument };

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const equal = (left: unknown, right: unknown) => left === undefined || right === undefined ? left === right : canonicalJson(left) === canonicalJson(right);
export const importBatches = (documents: ImportDocument[]) => { const out: ImportDocument[][] = []; let batch: ImportDocument[] = []; let bytes = 0; for (const document of documents) { const size = Buffer.byteLength(canonicalJson(document), 'utf8'); if (size > MAX_IMPORT_BATCH_BYTES) throw new Error(`Plan document exceeds batch byte limit: ${document.path}`); if (batch.length === MAX_IMPORT_BATCH_DOCUMENTS || (batch.length && bytes + size > MAX_IMPORT_BATCH_BYTES)) { out.push(batch); batch = []; bytes = 0; } batch.push(document); bytes += size; } if (batch.length) out.push(batch); return out; };

function assertTarget(environment: NodeJS.ProcessEnv = process.env): void {
  if (environment.FIRESTORE_EMULATOR_HOST || environment.FIREBASE_AUTH_EMULATOR_HOST || environment.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error('Bundle import rejects Firebase emulator environment variables.');
}

export function assertPlan(report: ImportReport, documents: ImportDocument[]): ImportPlan {
  if (report.schemaVersion !== 'bundle-question-intake-v1' || !/^[a-f0-9]{64}$/u.test(report.bundleSha256)) throw new Error('Invalid intake report identity.');
  if (report.documentCount !== documents.length || sha(documents.map(canonicalJson).join('\n') + (documents.length ? '\n' : '')) !== report.documentsSha256) throw new Error('Plan document count or SHA-256 does not match its report.');
  if (report.issues.length) throw new Error(`Intake report has ${report.issues.length} unresolved classification or parser issues.`);
  const prefix = `questionImports/${report.bundleSha256}/`;
  const seen = new Set<string>();
  for (const document of documents) {
    if (!document || typeof document.path !== 'string' || !document.data || typeof document.data !== 'object' || Array.isArray(document.data)) throw new Error('Plan contains an invalid document.');
    if (!document.path.startsWith(prefix) || document.path.split('/').length % 2 !== 0 || seen.has(document.path)) throw new Error(`Invalid or duplicate private intake path: ${document.path}`);
    seen.add(document.path);
    if (Buffer.byteLength(canonicalJson(document), 'utf8') > MAX_IMPORT_DOCUMENT_BYTES) throw new Error(`Plan document exceeds ${MAX_IMPORT_DOCUMENT_BYTES} bytes: ${document.path}`);
  }
  const manifestData = {
    schemaVersion: report.schemaVersion, bundleSha256: report.bundleSha256, documentsSha256: report.documentsSha256, contentRootSha256: report.contentRootSha256,
    documentCount: report.documentCount, questionCount: report.questionCount, blueprintCount: report.blueprintCount, occurrenceCount: report.occurrenceCount, sourceFileCount: report.sourceFileCount,
    issueCount: report.issues.length, approval: 'unreviewed', inert: true, manifestCommitBarrier: true,
  };
  return { report, documents, manifest: { path: `questionImports/${report.bundleSha256}`, data: manifestData } };
}

export async function loadImportPlan(reportPath: string): Promise<ImportPlan> {
  const absoluteReport = resolve(reportPath); const report = JSON.parse(await readFile(absoluteReport, 'utf8')) as ImportReport;
  const docsPath = resolve(absoluteReport, '..', report.documentsPath);
  const documents = (await readFile(docsPath, 'utf8')).split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as ImportDocument);
  return assertPlan(report, documents);
}

type FirestoreDoc = { path: string; exists: boolean; data?: Record<string, unknown> };
interface ImportAdapter {
  projectId(): Promise<string>;
  databaseMetadata(): Promise<{ locationId: string; type: string }>;
  read(paths: string[]): Promise<FirestoreDoc[]>;
  enumerateImportPrefix(bundleSha256: string): Promise<FirestoreDoc[]>;
  create(documents: ImportDocument[]): Promise<void>;
}

async function readExact(adapter: ImportAdapter, documents: ImportDocument[]): Promise<void> {
  const actual = new Map<string, FirestoreDoc>(); for (const batch of importBatches(documents)) for (const item of await adapter.read(batch.map(({ path }) => path))) actual.set(item.path, item);
  for (const document of documents) if (!actual.get(document.path)?.exists || !equal(actual.get(document.path)?.data, document.data)) throw new Error(`Readback differs from immutable import plan: ${document.path}`);
}

async function assertTargetAndPrefix(adapter: ImportAdapter, plan: ImportPlan): Promise<FirestoreDoc[]> {
  if (await adapter.projectId() !== IMPORT_PROJECT) throw new Error(`Credential project is not ${IMPORT_PROJECT}.`);
  const metadata = await adapter.databaseMetadata();
  if (metadata.locationId !== IMPORT_LOCATION || metadata.type !== 'FIRESTORE_NATIVE') throw new Error('Firestore metadata is not the pinned native production database.');
  return assertNoUnknownPrefix(adapter, plan);
}

async function assertNoUnknownPrefix(adapter: ImportAdapter, plan: ImportPlan): Promise<FirestoreDoc[]> {
  const expected = new Set([...plan.documents.map(({ path }) => path), plan.manifest.path]);
  const stored = await adapter.enumerateImportPrefix(plan.report.bundleSha256);
  const unknown = stored.filter((item) => item.exists && !expected.has(item.path));
  if (unknown.length) throw new Error(`Unknown stored documents under intake prefix: ${unknown.slice(0, 5).map(({ path }) => path).join(', ')}`);
  return stored;
}

export function assertMaxNewDocuments(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('--max-new-documents must be a positive integer.');
  return value;
}

export async function applyImport(plan: ImportPlan, adapter: ImportAdapter, maxNewDocuments = DEFAULT_MAX_NEW_DOCUMENTS, progress: (event: Record<string, unknown>) => void = () => {}): Promise<{ created: number; skipped: number; verifiedDocumentCount: number; remaining: number; manifestWritten: boolean }> {
  assertMaxNewDocuments(maxNewDocuments); progress({ stage: 'preflight', totalDocuments: plan.documents.length, maxNewDocuments });
  const discovered = await assertTargetAndPrefix(adapter, plan);
  const beforePointer = (await adapter.read(['runtime/activeRelease']))[0];
  const initialManifest = (await adapter.read([plan.manifest.path]))[0];
  if (initialManifest?.exists && !equal(initialManifest.data, plan.manifest.data)) throw new Error(`Immutable intake manifest conflict: ${plan.manifest.path}`);
  const existing = new Map(discovered.filter((item) => item.path !== plan.manifest.path).map((item) => [item.path, item]));
  const pending: ImportDocument[] = []; let skipped = 0;
  for (const document of plan.documents) { const current = existing.get(document.path); if (!current?.exists) pending.push(document); else if (equal(current.data, document.data)) skipped += 1; else throw new Error(`Immutable intake conflict before write: ${document.path}`); }
  if (initialManifest?.exists && pending.length) throw new Error('Intake manifest exists while planned child documents are missing.');
  const allowedByReadBudget = MAX_BUDGETED_DOCUMENT_READS - skipped;
  if (pending.length && allowedByReadBudget < 1) throw new Error(`Budgeted apply cannot safely read back another child after ${skipped} preflight documents; resume after quota reset or use an explicitly authorized full audit.`);
  const creating = pending.slice(0, Math.min(maxNewDocuments, allowedByReadBudget)); const remaining = pending.length - creating.length;
  const writeBatches = importBatches(creating); for (let index = 0; index < writeBatches.length; index += 1) { const batch = writeBatches[index]; await adapter.create(batch); await readExact(adapter, batch); if ((index + 1) % 10 === 0 || index + 1 === writeBatches.length) progress({ stage: 'write', completedBatches: index + 1, totalBatches: writeBatches.length, createdDocuments: Math.min((index + 1) * MAX_IMPORT_BATCH_DOCUMENTS, creating.length), totalDocuments: creating.length }); }
  const afterChildrenPointer = (await adapter.read(['runtime/activeRelease']))[0];
  if ((beforePointer?.exists ?? false) !== (afterChildrenPointer?.exists ?? false) || !equal(beforePointer?.data, afterChildrenPointer?.data)) throw new Error('runtime/activeRelease changed during private intake; manifest was not written.');
  if (remaining) { progress({ stage: 'partial', createdDocuments: creating.length, skippedDocuments: skipped, verifiedDocumentCount: skipped + creating.length, remaining, manifestWritten: false }); return { created: creating.length, skipped, verifiedDocumentCount: skipped + creating.length, remaining, manifestWritten: false }; }
  // Existing documents were decoded from the complete preflight scan; new documents
  // were read back batch-by-batch. Together this is the complete exact child audit.
  progress({ stage: 'full-readback', totalDocuments: plan.documents.length });
  await assertNoUnknownPrefix(adapter, plan);
  const storedManifest = (await adapter.read([plan.manifest.path]))[0];
  if (storedManifest?.exists) { if (!equal(storedManifest.data, plan.manifest.data)) throw new Error(`Immutable intake manifest conflict: ${plan.manifest.path}`); }
  else { progress({ stage: 'manifest', totalDocuments: plan.documents.length }); await adapter.create([plan.manifest]); await readExact(adapter, [plan.manifest]); }
  const afterManifestPointer = (await adapter.read(['runtime/activeRelease']))[0];
  if ((beforePointer?.exists ?? false) !== (afterManifestPointer?.exists ?? false) || !equal(beforePointer?.data, afterManifestPointer?.data)) throw new Error('runtime/activeRelease changed during manifest write.');
  progress({ stage: 'complete', verifiedDocumentCount: plan.documents.length, manifestVerified: true });
  return { created: creating.length + (storedManifest?.exists ? 0 : 1), skipped, verifiedDocumentCount: plan.documents.length, remaining: 0, manifestWritten: true };
}

async function productionAdapter(): Promise<ImportAdapter> {
  assertTarget();
  const { getGlobalDefaultAccount, getAccessToken } = require('firebase-tools/lib/auth.js') as { getGlobalDefaultAccount: () => { tokens?: { refresh_token?: string } } | undefined; getAccessToken: (refresh: string, scopes: string[]) => Promise<{ access_token: string; expires_in?: number }> };
  const account = getGlobalDefaultAccount(); const refresh = account?.tokens?.refresh_token;
  if (!refresh) throw new Error('Firebase CLI login refresh token is unavailable.');
  const token = async () => getAccessToken(refresh, ['https://www.googleapis.com/auth/cloud-platform']);
  // The Admin SDK rejects custom CLI credentials for Firestore. The underlying
  // Google Cloud client supports the existing CLI authorized-user credential.
  // Keep the refresh token in memory and let Google Auth refresh access normally.
  const { Firestore } = await import('@google-cloud/firestore');
  const { clientId, clientSecret } = require('firebase-tools/lib/api.js') as { clientId: () => string; clientSecret: () => string };
  // Firestore's public type exposes only the service-account subset; Google Auth also accepts authorized_user.
  const cliCredentials: { client_email?: string; type: 'authorized_user'; client_id: string; client_secret: string; refresh_token: string } = { type: 'authorized_user', client_id: clientId(), client_secret: clientSecret(), refresh_token: refresh };
  const db = new Firestore({ projectId: IMPORT_PROJECT, databaseId: IMPORT_DATABASE, credentials: cliCredentials });
  const decodeFirestoreValue = (value: Record<string, unknown>): unknown => {
    if ('nullValue' in value) return null; if ('booleanValue' in value) return value.booleanValue;
    if ('integerValue' in value) return Number(value.integerValue); if ('doubleValue' in value) return value.doubleValue;
    if ('timestampValue' in value || 'stringValue' in value || 'bytesValue' in value || 'referenceValue' in value) return value.timestampValue ?? value.stringValue ?? value.bytesValue ?? value.referenceValue;
    if ('arrayValue' in value) return ((value.arrayValue as { values?: Array<Record<string, unknown>> }).values ?? []).map(decodeFirestoreValue);
    if ('mapValue' in value) return decodeFirestoreFields((value.mapValue as { fields?: Record<string, Record<string, unknown>> }).fields ?? {});
    throw new Error('Firestore descendant enumeration returned an unsupported value type.');
  };
  const decodeFirestoreFields = (fields: Record<string, Record<string, unknown>>) => Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]));
  const metadata = async () => { const access = await token(); const response = await fetch(`https://firestore.googleapis.com/v1/projects/${IMPORT_PROJECT}/databases/${encodeURIComponent(IMPORT_DATABASE)}`, { headers: { Authorization: `Bearer ${access.access_token}` } }); if (!response.ok) throw new Error(`Firestore metadata request failed: ${response.status}`); const body = await response.json() as { locationId?: string; type?: string }; return { locationId: body.locationId ?? '', type: body.type ?? '' }; };
  return {
    projectId: async () => IMPORT_PROJECT,
    databaseMetadata: metadata,
    read: async (paths) => (await db.getAll(...paths.map((path) => db.doc(path)))).map((snap) => ({ path: snap.ref.path, exists: snap.exists, data: snap.data() as Record<string, unknown> | undefined })),
    enumerateImportPrefix: async (bundleSha256) => {
      const parentPath = `questionImports/${bundleSha256}`; const endpoint = `https://firestore.googleapis.com/v1/projects/${IMPORT_PROJECT}/databases/${encodeURIComponent(IMPORT_DATABASE)}/documents/${parentPath}:runQuery`;
      const out: FirestoreDoc[] = []; let cursor: string | undefined;
      for (;;) {
        const access = await token(); const structuredQuery: Record<string, unknown> = { from: [{ allDescendants: true }], orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: 1000 };
        if (cursor) structuredQuery.startAt = { values: [{ referenceValue: cursor }], before: false };
        const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${access.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ structuredQuery }) });
        if (!response.ok) throw new Error(`Firestore descendant enumeration failed: ${response.status}`);
        const rows = await response.json() as Array<{ document?: { name?: string; fields?: Record<string, Record<string, unknown>> } }>; const documents = rows.flatMap((row) => row.document?.name ? [row.document] : []); const names = documents.map((document) => document.name!);
        for (const document of documents) { const name = document.name!; const marker = '/documents/'; const index = name.indexOf(marker); if (index < 0) throw new Error('Firestore descendant enumeration returned an invalid document name.'); out.push({ path: name.slice(index + marker.length), exists: true, data: decodeFirestoreFields(document.fields ?? {}) }); }
        if (names.length < 1000) return out;
        const next = names[names.length - 1]; if (!next || next === cursor) throw new Error('Firestore descendant enumeration pagination did not advance.'); cursor = next;
      }
    },
    create: async (documents) => { const batch = db.batch(); for (const document of documents) batch.create(db.doc(document.path), document.data); await batch.commit(); },
  };
}

async function main(): Promise<void> {
  const [command, reportPath, ...flags] = process.argv.slice(2);
  if (!command || !reportPath || !['plan', 'apply'].includes(command)) throw new Error('Usage: tsx scripts/bundle-question-importer.ts <plan|apply> <report.json> [--root-gate-approval <receipt>] [--max-new-documents <positive-integer>]');
  const plan = await loadImportPlan(reportPath);
  if (command === 'plan') { console.log(canonicalJson({ command: 'plan', report: basename(reportPath), bundleSha256: plan.report.bundleSha256, documents: plan.documents.length, questions: plan.report.questionCount, blueprints: plan.report.blueprintCount, occurrences: plan.report.occurrenceCount, sourceFiles: plan.report.sourceFileCount, issues: plan.report.issues.length, productionWrite: false })); return; }
  let gateApproval: string | undefined; let maxNewDocuments = DEFAULT_MAX_NEW_DOCUMENTS;
  for (let index = 0; index < flags.length; index += 2) { const flag = flags[index]; const value = flags[index + 1]; if (!value) throw new Error(`Missing value for ${flag}.`); if (flag === '--root-gate-approval') gateApproval = value; else if (flag === '--max-new-documents') maxNewDocuments = assertMaxNewDocuments(Number(value)); else throw new Error(`Unknown flag ${flag}.`); }
  if (!gateApproval?.trim()) throw new Error('Production apply requires an explicit --root-gate-approval receipt after integrated Gate approval.');
  const result = await applyImport(plan, await productionAdapter(), maxNewDocuments, (event) => console.log(canonicalJson({ command: 'apply-progress', bundleSha256: plan.report.bundleSha256, ...event }))); console.log(canonicalJson({ command: 'apply', bundleSha256: plan.report.bundleSha256, ...result, activeReleaseChanged: false }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
