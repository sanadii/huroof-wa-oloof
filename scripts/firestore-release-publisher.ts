import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { assertReleaseDocumentsExcludeEvidencePayload, buildFirestoreReleasePlan, type FirestoreReleasePlan, type ReleaseDocument } from './build-firestore-release.js';
import { canonicalJson } from './firestore-release-canonical.js';

export const PRODUCTION_PROJECT = 'huroof-a3ee7';
export const PRODUCTION_DATABASE = '(default)';
export const PRODUCTION_LOCATION = 'me-central2';
export const MAX_BATCH_DOCUMENTS = 400;
export const MAX_BATCH_BYTES = 9 * 1024 * 1024;

export type StoredDocument = { path: string; exists: boolean; data?: Record<string, unknown> };
export type ActivationRequest = {
  releaseRoot: ReleaseDocument;
  publicationReceipt: ReleaseDocument;
  expectedPreviousReleaseId: string | null;
  operationReference: string;
  activationReceipt: ReleaseDocument;
  activeRelease: ReleaseDocument;
};

/** Thin boundary around Firestore so publication behavior is fully testable without cloud credentials. */
export interface FirestorePublicationAdapter {
  getProjectId(): Promise<string>;
  getDatabaseMetadata(projectId: string, databaseId: string): Promise<{ locationId: string; type: string }>;
  read(paths: string[]): Promise<StoredDocument[]>;
  create(documents: ReleaseDocument[]): Promise<void>;
  activate(request: ActivationRequest): Promise<void>;
}

const hash = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const equal = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);
const chunksOf = <T>(items: T[], size: number): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

export function chunkReleaseDocuments(documents: ReleaseDocument[], maxDocuments = MAX_BATCH_DOCUMENTS, maxBytes = MAX_BATCH_BYTES): ReleaseDocument[][] {
  if (!Number.isInteger(maxDocuments) || maxDocuments < 1 || maxDocuments > MAX_BATCH_DOCUMENTS) throw new Error(`Chunk document limit must be between 1 and ${MAX_BATCH_DOCUMENTS}.`);
  const chunks: ReleaseDocument[][] = []; let chunk: ReleaseDocument[] = []; let bytes = 0;
  for (const document of documents) {
    const documentBytes = Buffer.byteLength(canonicalJson({ path: document.path, data: document.data }), 'utf8');
    if (documentBytes > maxBytes) throw new Error(`Document exceeds the ${maxBytes}-byte publication limit: ${document.path}`);
    if (chunk.length === maxDocuments || (chunk.length > 0 && bytes + documentBytes > maxBytes)) { chunks.push(chunk); chunk = []; bytes = 0; }
    chunk.push(document); bytes += documentBytes;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

export function assertProductionTarget(flags: Record<string, string>, environment: NodeJS.ProcessEnv = process.env): void {
  if (environment.FIRESTORE_EMULATOR_HOST) throw new Error('Production publication rejects FIRESTORE_EMULATOR_HOST.');
  if (flags.project !== PRODUCTION_PROJECT) throw new Error(`--project must be exactly ${PRODUCTION_PROJECT}.`);
  if (flags.database !== PRODUCTION_DATABASE) throw new Error(`--database must be exactly ${PRODUCTION_DATABASE}.`);
  if (flags.location !== PRODUCTION_LOCATION) throw new Error(`--location must be exactly ${PRODUCTION_LOCATION}.`);
}

function releaseRoot(plan: FirestoreReleasePlan): ReleaseDocument {
  const root = plan.documents.find((document) => document.path === `releases/${plan.releaseId}`);
  if (!root) throw new Error('Release plan is missing its immutable root document.');
  return root;
}

export function publicationReceipt(plan: FirestoreReleasePlan): ReleaseDocument {
  return {
    path: `releases/${plan.releaseId}/publicationReceipts/publication-${plan.documentRootSha256}`,
    data: { releaseId: plan.releaseId, asOf: plan.asOf, approvedCount: plan.approvedCount, approvedJsonlSha256: plan.approvedJsonlSha256, catalogSha256: plan.catalogSha256, documentRootSha256: plan.documentRootSha256, sourceManifestSha256: plan.sourceManifestSha256, documentCount: plan.documents.length, immutable: true },
  };
}

async function assertVerifiedTarget(adapter: FirestorePublicationAdapter): Promise<void> {
  const projectId = await adapter.getProjectId();
  if (projectId !== PRODUCTION_PROJECT) throw new Error(`Application Default Credentials resolve to ${projectId}, not ${PRODUCTION_PROJECT}.`);
  const metadata = await adapter.getDatabaseMetadata(PRODUCTION_PROJECT, PRODUCTION_DATABASE);
  if (metadata.locationId !== PRODUCTION_LOCATION || metadata.type !== 'FIRESTORE_NATIVE') throw new Error(`Firestore metadata must be FIRESTORE_NATIVE in ${PRODUCTION_LOCATION}.`);
}

async function readByPath(adapter: FirestorePublicationAdapter, documents: ReleaseDocument[]): Promise<Map<string, StoredDocument>> {
  const entries = await Promise.all(chunksOf(documents, MAX_BATCH_DOCUMENTS).map(async (chunk) => adapter.read(chunk.map((document) => document.path))));
  return new Map(entries.flat().map((document) => [document.path, document]));
}

async function assertDocumentsEqual(adapter: FirestorePublicationAdapter, documents: ReleaseDocument[]): Promise<void> {
  const stored = await readByPath(adapter, documents);
  for (const document of documents) {
    const current = stored.get(document.path);
    if (!current?.exists || !equal(current.data, document.data)) throw new Error(`Firestore readback does not match planned immutable document: ${document.path}`);
  }
}

/** Stages immutable catalog/release documents only. It never writes runtime/activeRelease. */
export async function prepareProductionRelease(plan: FirestoreReleasePlan, adapter: FirestorePublicationAdapter): Promise<{ created: number; skipped: number; receipt: ReleaseDocument }> {
  assertReleaseDocumentsExcludeEvidencePayload(plan.documents);
  const pointer = plan.documents.find((document) => document.path === 'runtime/activeRelease');
  if (pointer) throw new Error('Production preparation must not include runtime/activeRelease.');
  await assertVerifiedTarget(adapter);
  const existing = await readByPath(adapter, plan.documents); const pending: ReleaseDocument[] = []; let skipped = 0;
  for (const document of plan.documents) {
    const current = existing.get(document.path);
    if (!current?.exists) pending.push(document);
    else if (equal(current.data, document.data)) skipped += 1;
    else throw new Error(`Immutable conflict at ${document.path}; publication aborted before writes.`);
  }
  for (const chunk of chunkReleaseDocuments(pending)) { await adapter.create(chunk); await assertDocumentsEqual(adapter, chunk); }
  await assertDocumentsEqual(adapter, plan.documents);
  const receipt = publicationReceipt(plan); const existingReceipt = (await adapter.read([receipt.path]))[0];
  if (existingReceipt?.exists) {
    if (!equal(existingReceipt.data, receipt.data)) throw new Error(`Immutable conflict at ${receipt.path}; receipt not overwritten.`);
  } else { await adapter.create([receipt]); await assertDocumentsEqual(adapter, [receipt]); }
  return { created: pending.length + (existingReceipt?.exists ? 0 : 1), skipped, receipt };
}

/** Read-only confirmation that every planned document and its publication receipt are exact. */
export async function verifyPreparedProductionRelease(plan: FirestoreReleasePlan, adapter: FirestorePublicationAdapter): Promise<void> {
  assertReleaseDocumentsExcludeEvidencePayload(plan.documents);
  await assertVerifiedTarget(adapter); await assertDocumentsEqual(adapter, plan.documents); await assertDocumentsEqual(adapter, [publicationReceipt(plan)]);
}

export function activationDocuments(plan: FirestoreReleasePlan, expectedPreviousReleaseId: string | null, operationReference: string): Pick<ActivationRequest, 'activationReceipt' | 'activeRelease'> {
  if (!operationReference.trim() || operationReference.length > 200) throw new Error('--operation-reference must be a non-empty, non-secret reference of at most 200 characters.');
  const referenceHash = hash(canonicalJson({ releaseId: plan.releaseId, operationReference }));
  const base = { releaseId: plan.releaseId, asOf: plan.asOf, approvedCount: plan.approvedCount, approvedJsonlSha256: plan.approvedJsonlSha256, catalogSha256: plan.catalogSha256, documentRootSha256: plan.documentRootSha256, sourceManifestSha256: plan.sourceManifestSha256, operationReference };
  return {
    activationReceipt: { path: `activationReceipts/${plan.releaseId}-${referenceHash}`, data: { ...base, expectedPreviousReleaseId, immutable: true } },
    activeRelease: { path: 'runtime/activeRelease', data: base },
  };
}

/** Moves the active pointer only through the adapter's atomic root/receipt/CAS transaction. */
export async function activateProductionRelease(plan: FirestoreReleasePlan, adapter: FirestorePublicationAdapter, expectedPreviousReleaseId: string | null, operationReference: string): Promise<void> {
  assertReleaseDocumentsExcludeEvidencePayload(plan.documents);
  await assertVerifiedTarget(adapter);
  const { activationReceipt, activeRelease } = activationDocuments(plan, expectedPreviousReleaseId, operationReference);
  await adapter.activate({ releaseRoot: releaseRoot(plan), publicationReceipt: publicationReceipt(plan), expectedPreviousReleaseId, operationReference, activationReceipt, activeRelease });
}

/** Creates the real adapter lazily so offline plan mode imports and initializes no Admin SDK code. */
export async function createAdminProductionAdapter(): Promise<FirestorePublicationAdapter> {
  const { GoogleAuth } = await import('google-auth-library');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const projectId = await auth.getProjectId();
  const client = await auth.getClient();
  const { applicationDefault, getApps, initializeApp } = await import('firebase-admin/app');
  const firestoreModule = await import('firebase-admin/firestore');
  const app = getApps()[0] ?? initializeApp({ credential: applicationDefault(), projectId });
  const database = firestoreModule.getFirestore(app, PRODUCTION_DATABASE);
  return {
    getProjectId: async () => projectId,
    getDatabaseMetadata: async (requestedProject, databaseId) => {
      const response = await client.request<{ locationId?: string; type?: string }>({ url: `https://firestore.googleapis.com/v1/projects/${requestedProject}/databases/${databaseId}` });
      return { locationId: response.data.locationId ?? '', type: response.data.type ?? '' };
    },
    read: async (paths) => (await database.getAll(...paths.map((path) => database.doc(path)))).map((snapshot) => ({ path: snapshot.ref.path, exists: snapshot.exists, data: snapshot.exists ? snapshot.data() as Record<string, unknown> : undefined })),
    create: async (documents) => { const batch = database.batch(); for (const document of documents) batch.create(database.doc(document.path), document.data); await batch.commit(); },
    activate: async (request) => { await database.runTransaction(async (transaction) => {
      const [root, receipt, pointer, activation] = await Promise.all([transaction.get(database.doc(request.releaseRoot.path)), transaction.get(database.doc(request.publicationReceipt.path)), transaction.get(database.doc('runtime/activeRelease')), transaction.get(database.doc(request.activationReceipt.path))]);
      if (!root.exists || !equal(root.data(), request.releaseRoot.data)) throw new Error('Activation rejected: release root is missing or differs.');
      if (!receipt.exists || !equal(receipt.data(), request.publicationReceipt.data)) throw new Error('Activation rejected: publication receipt is missing or differs.');
      if (activation.exists) throw new Error('Activation rejected: immutable activation receipt already exists.');
      const actualPrevious = pointer.exists ? pointer.data()?.releaseId : null;
      if (actualPrevious !== request.expectedPreviousReleaseId) throw new Error(`Activation rejected: expected ${request.expectedPreviousReleaseId ?? 'no active release'}, found ${actualPrevious ?? 'no active release'}.`);
      transaction.create(database.doc(request.activationReceipt.path), request.activationReceipt.data); transaction.set(database.doc(request.activeRelease.path), request.activeRelease.data);
    }); },
  };
}

function parseFlags(values: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]; const value = values[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--') || flags[key.slice(2)] !== undefined) throw new Error('Arguments must be unique --name value pairs.');
    flags[key.slice(2)] = value;
  }
  return flags;
}

function requireFlags(flags: Record<string, string>, names: string[]): void {
  if (Object.keys(flags).length !== names.length || names.some((name) => !flags[name])) throw new Error(`Required flags: ${names.map((name) => `--${name}`).join(' ')}.`);
}

async function productionPlan(flags: Record<string, string>): Promise<FirestoreReleasePlan> {
  assertProductionTarget(flags); const plan = await buildFirestoreReleasePlan({ production: true });
  if (flags['release-id'] !== plan.releaseId) throw new Error('--release-id does not match the derived immutable production release ID.');
  if (flags['approved-sha256'] !== plan.approvedJsonlSha256) throw new Error('--approved-sha256 does not match the approved canonical JSONL.');
  return plan;
}

async function main(): Promise<void> {
  const [operation, ...values] = process.argv.slice(2);
  if (operation === 'plan') {
    if (values.length) throw new Error('Plan mode takes no arguments and never imports or initializes Admin SDK.');
    if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Production plan rejects FIRESTORE_EMULATOR_HOST.');
    const plan = await buildFirestoreReleasePlan({ production: true }); console.log(JSON.stringify({ releaseId: plan.releaseId, asOf: plan.asOf, approvedCount: plan.approvedCount, approvedJsonlSha256: plan.approvedJsonlSha256, catalogSha256: plan.catalogSha256, documentRootSha256: plan.documentRootSha256, sourceManifestSha256: plan.sourceManifestSha256, documentCount: plan.documents.length }, null, 2)); return;
  }
  const flags = parseFlags(values);
  if (operation === 'prepare') { requireFlags(flags, ['project', 'database', 'location', 'release-id', 'approved-sha256']); const plan = await productionPlan(flags); const result = await prepareProductionRelease(plan, await createAdminProductionAdapter()); console.log(JSON.stringify({ operation, releaseId: plan.releaseId, ...result }, null, 2)); return; }
  if (operation === 'verify') { requireFlags(flags, ['project', 'database', 'location', 'release-id', 'approved-sha256']); const plan = await productionPlan(flags); await verifyPreparedProductionRelease(plan, await createAdminProductionAdapter()); console.log(JSON.stringify({ operation, releaseId: plan.releaseId, verified: true }, null, 2)); return; }
  if (operation === 'activate') { requireFlags(flags, ['project', 'database', 'location', 'release-id', 'approved-sha256', 'expected-active-release', 'operation-reference']); const plan = await productionPlan(flags); const expected = flags['expected-active-release'] === 'none' ? null : flags['expected-active-release']; await activateProductionRelease(plan, await createAdminProductionAdapter(), expected, flags['operation-reference']); console.log(JSON.stringify({ operation, releaseId: plan.releaseId, activated: true }, null, 2)); return; }
  throw new Error('Usage: firestore-release-publisher <plan|prepare|verify|activate> [required flags].');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
