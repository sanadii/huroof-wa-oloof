import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { assertReleaseDocumentsExcludeEvidencePayload, buildV33FirestoreReleasePlan, loadV33ProductionReleaseInput, type FirestoreReleasePlan, type ReleaseDocument } from './build-firestore-release.js';
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
  verificationReceipt: ReleaseDocument;
  verificationUseReceipt: ReleaseDocument;
  expectedPreviousReleaseId: string | null;
  operationReference: string;
  activationReceipt: ReleaseDocument;
  activeRelease: ReleaseDocument;
};
export type RollbackRequest = {
  expectedActiveReleaseId: string;
  restoreReleaseId: string | null;
  rollbackReceipt: ReleaseDocument;
  activeRelease: ReleaseDocument | null;
  restoreReleaseRoot?: ReleaseDocument;
  restorePublicationReceipt?: ReleaseDocument;
};

/** Thin boundary around Firestore so publication behavior is fully testable without cloud credentials. */
export interface FirestorePublicationAdapter {
  getProjectId(): Promise<string>;
  getDatabaseMetadata(projectId: string, databaseId: string): Promise<{ locationId: string; type: string }>;
  read(paths: string[]): Promise<StoredDocument[]>;
  /** Exact release-prefix enumeration; required for audit and rollback-to-none. */
  listPrefix?(prefix: string): Promise<StoredDocument[]>;
  /** Atomically creates global, immutable review-nonce claims; equal retries are allowed. */
  claimReviewNonceClaims?(documents: ReleaseDocument[]): Promise<void>;
  create(documents: ReleaseDocument[]): Promise<void>;
  activate(request: ActivationRequest): Promise<void>;
  rollback?(request: RollbackRequest): Promise<void>;
}

export const MAX_VERIFICATION_BARRIER_AGE_MS = 15 * 60 * 1000;

const hash = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const equal = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);
const chunksOf = <T>(items: T[], size: number): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
const REVIEW_NONCE_CLAIM_HASH = /^[a-f0-9]{64}$/u;

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

/** Global claims are keyed by a SHA-256 nonce commitment; no raw review nonce is published. */
export function reviewNonceClaimDocuments(plan: FirestoreReleasePlan): ReleaseDocument[] {
  const hashes = plan.reviewNonceClaimHashes ?? [];
  if (
    hashes.some((value) => !REVIEW_NONCE_CLAIM_HASH.test(value)) ||
    hashes.length !== new Set(hashes).size ||
    hashes.some((value, index) => index > 0 && hashes[index - 1] >= value)
  )
    throw new Error('Review-nonce claims must be sorted, unique SHA-256 commitments.');
  return hashes.map((reviewNonceHash) => ({
    path: `reviewNonceClaims/${reviewNonceHash}`,
    data: {
      reviewNonceHash,
      releaseId: plan.releaseId,
      documentRootSha256: plan.documentRootSha256,
      sourceManifestSha256: plan.sourceManifestSha256,
      immutable: true,
    },
  }));
}

type VerificationReceiptData = {
  releaseId: string;
  asOf: string;
  approvedCount: number;
  approvedJsonlSha256: string;
  catalogSha256: string;
  documentRootSha256: string;
  sourceManifestSha256: string;
  documentCount: number;
  verifiedAt: string;
  expiresAt: string;
  immutable: true;
};
const verificationBinding = (plan: FirestoreReleasePlan) => ({ releaseId: plan.releaseId, asOf: plan.asOf, approvedCount: plan.approvedCount, approvedJsonlSha256: plan.approvedJsonlSha256, catalogSha256: plan.catalogSha256, documentRootSha256: plan.documentRootSha256, sourceManifestSha256: plan.sourceManifestSha256, documentCount: plan.documents.length });
/** A barrier is written only after exact prefix enumeration, point readback, and publication-receipt readback. */
export function verificationReceipt(plan: FirestoreReleasePlan, verifiedAt = new Date()): ReleaseDocument {
  if (Number.isNaN(verifiedAt.getTime())) throw new Error('Verification receipt requires a valid verification time.');
  const data: VerificationReceiptData = { ...verificationBinding(plan), verifiedAt: verifiedAt.toISOString(), expiresAt: new Date(verifiedAt.getTime() + MAX_VERIFICATION_BARRIER_AGE_MS).toISOString(), immutable: true };
  const receiptHash = hash(canonicalJson(data));
  return { path: `releaseVerificationReceipts/${plan.releaseId}-${receiptHash}`, data };
}
export function assertVerificationReceipt(plan: FirestoreReleasePlan, receipt: ReleaseDocument, now = new Date()): void {
  if (!receipt || typeof receipt.path !== 'string' || !receipt.data || typeof receipt.data !== 'object' || Array.isArray(receipt.data)) throw new Error('Verification barrier is missing, mismatched, stale, or replayed.');
  const data = receipt.data as Partial<VerificationReceiptData>;
  const expected = verificationBinding(plan);
  const expectedKeys = [...Object.keys(expected), 'expiresAt', 'immutable', 'verifiedAt'].sort();
  if (canonicalJson(Object.keys(data).sort()) !== canonicalJson(expectedKeys) || Object.keys(expected).some((key) => data[key as keyof VerificationReceiptData] === undefined)) throw new Error('Verification barrier is missing, mismatched, stale, or replayed.');
  if (!equal(Object.fromEntries(Object.keys(expected).map((key) => [key, data[key as keyof VerificationReceiptData]])), expected) || data.immutable !== true || typeof data.verifiedAt !== 'string' || typeof data.expiresAt !== 'string' || Number.isNaN(Date.parse(data.verifiedAt)) || Number.isNaN(Date.parse(data.expiresAt)) || Date.parse(data.verifiedAt) > now.getTime() || Date.parse(data.expiresAt) < now.getTime() || Date.parse(data.expiresAt) - Date.parse(data.verifiedAt) !== MAX_VERIFICATION_BARRIER_AGE_MS || receipt.path !== verificationReceipt(plan, new Date(data.verifiedAt)).path) throw new Error('Verification barrier is missing, mismatched, stale, or replayed.');
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

async function assertReviewNonceClaims(plan: FirestoreReleasePlan, adapter: FirestorePublicationAdapter): Promise<void> {
  const claims = reviewNonceClaimDocuments(plan);
  if (!claims.length) return;
  await assertDocumentsEqual(adapter, claims);
}

async function claimReviewNonces(plan: FirestoreReleasePlan, adapter: FirestorePublicationAdapter): Promise<void> {
  const claims = reviewNonceClaimDocuments(plan);
  if (!claims.length) return;
  if (!adapter.claimReviewNonceClaims) throw new Error('Production publication requires transactional review-nonce claim support.');
  await adapter.claimReviewNonceClaims(claims);
  await assertReviewNonceClaims(plan, adapter);
}

/** Stages immutable catalog/release documents only. It never writes runtime/activeRelease. */
export async function prepareProductionRelease(plan: FirestoreReleasePlan, adapter: FirestorePublicationAdapter): Promise<{ created: number; skipped: number; receipt: ReleaseDocument }> {
  assertReleaseDocumentsExcludeEvidencePayload(plan.documents);
  const pointer = plan.documents.find((document) => document.path === 'runtime/activeRelease');
  if (pointer) throw new Error('Production preparation must not include runtime/activeRelease.');
  await assertVerifiedTarget(adapter);
  await claimReviewNonces(plan, adapter);
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
export async function verifyPreparedProductionRelease(plan: FirestoreReleasePlan, adapter: FirestorePublicationAdapter, verifiedAt = new Date()): Promise<ReleaseDocument> {
  if (!adapter.listPrefix) throw new Error('Verification requires exact release-prefix enumeration.');
  await assertReviewNonceClaims(plan, adapter);
  await assertExactProductionReleaseAudit(plan, adapter);
  const receipt = verificationReceipt(plan, verifiedAt);
  const current = (await adapter.read([receipt.path]))[0];
  if (current?.exists) {
    if (!equal(current.data, receipt.data)) throw new Error(`Immutable conflict at ${receipt.path}; verification barrier not overwritten.`);
  } else {
    await adapter.create([receipt]);
    await assertDocumentsEqual(adapter, [receipt]);
  }
  return receipt;
}

export type ReleaseAudit = { releaseId: string; missing: string[]; extra: string[]; mismatched: string[]; activeReleaseId: string | null };
/** Read-only audit.  Unlike point readback, this detects extra stored question/inventory/receipt IDs. */
export async function auditProductionRelease(plan: FirestoreReleasePlan, adapter: FirestorePublicationAdapter): Promise<ReleaseAudit> {
  if (!adapter.listPrefix) throw new Error('Release audit requires an adapter with exact prefix enumeration.');
  assertReleaseDocumentsExcludeEvidencePayload(plan.documents); await assertVerifiedTarget(adapter);
  const prefix = `releases/${plan.releaseId}/`; const expected = new Map([...plan.documents.filter((document) => document.path === `releases/${plan.releaseId}` || document.path.startsWith(prefix)), publicationReceipt(plan)].map((document) => [document.path, document]));
  const stored = new Map((await adapter.listPrefix(prefix)).map((document) => [document.path, document]));
  const missing = [...expected.keys()].filter((path) => !stored.get(path)?.exists).sort();
  const extra = [...stored.values()].filter((document) => document.exists && !expected.has(document.path)).map((document) => document.path).sort();
  const mismatched = [...expected.entries()].filter(([path, document]) => stored.get(path)?.exists && !equal(stored.get(path)?.data, document.data)).map(([path]) => path).sort();
  const pointer = (await adapter.read(['runtime/activeRelease']))[0]; return { releaseId: plan.releaseId, missing, extra, mismatched, activeReleaseId: pointer?.exists && typeof pointer.data?.releaseId === 'string' ? pointer.data.releaseId : null };
}
export async function assertExactProductionReleaseAudit(plan: FirestoreReleasePlan, adapter: FirestorePublicationAdapter): Promise<void> {
  const audit = await auditProductionRelease(plan, adapter); if (audit.missing.length || audit.extra.length || audit.mismatched.length) throw new Error(`Release audit failed (missing: ${audit.missing.join(',') || 'none'}; extra: ${audit.extra.join(',') || 'none'}; mismatched: ${audit.mismatched.join(',') || 'none'}).`);
}

export function activationDocuments(plan: FirestoreReleasePlan, expectedPreviousReleaseId: string | null, operationReference: string, verification: ReleaseDocument): Pick<ActivationRequest, 'activationReceipt' | 'activeRelease' | 'verificationUseReceipt'> {
  if (!operationReference.trim() || operationReference.length > 200) throw new Error('--operation-reference must be a non-empty, non-secret reference of at most 200 characters.');
  const referenceHash = hash(canonicalJson({ releaseId: plan.releaseId, operationReference }));
  assertVerificationReceipt(plan, verification);
  const verificationHash = hash(canonicalJson({ path: verification.path, data: verification.data }));
  const base = { releaseId: plan.releaseId, asOf: plan.asOf, approvedCount: plan.approvedCount, approvedJsonlSha256: plan.approvedJsonlSha256, catalogSha256: plan.catalogSha256, documentRootSha256: plan.documentRootSha256, sourceManifestSha256: plan.sourceManifestSha256, operationReference, verificationReceiptPath: verification.path, verificationReceiptHash: verificationHash };
  return {
    activationReceipt: { path: `activationReceipts/${plan.releaseId}-${referenceHash}`, data: { ...base, expectedPreviousReleaseId, immutable: true } },
    activeRelease: { path: 'runtime/activeRelease', data: base },
    verificationUseReceipt: { path: `releaseVerificationUses/${verificationHash}`, data: { ...base, immutable: true } },
  };
}

/** Moves the active pointer only through the adapter's atomic root/receipt/CAS transaction. */
export async function activateProductionRelease(plan: FirestoreReleasePlan, adapter: FirestorePublicationAdapter, expectedPreviousReleaseId: string | null, operationReference: string, verification: ReleaseDocument): Promise<void> {
  assertReleaseDocumentsExcludeEvidencePayload(plan.documents);
  await assertExactProductionReleaseAudit(plan, adapter);
  await assertReviewNonceClaims(plan, adapter);
  assertVerificationReceipt(plan, verification);
  const stored = (await adapter.read([verification.path]))[0];
  if (!stored?.exists || !equal(stored.data, verification.data)) throw new Error('Verification barrier is missing or mismatched.');
  const { activationReceipt, activeRelease, verificationUseReceipt } = activationDocuments(plan, expectedPreviousReleaseId, operationReference, verification);
  await adapter.activate({ releaseRoot: releaseRoot(plan), publicationReceipt: publicationReceipt(plan), verificationReceipt: verification, verificationUseReceipt, expectedPreviousReleaseId, operationReference, activationReceipt, activeRelease });
}

export function rollbackDocuments(activePlan: FirestoreReleasePlan, restorePlan: FirestoreReleasePlan | null, operationReference: string): Pick<RollbackRequest, 'rollbackReceipt' | 'activeRelease' | 'restoreReleaseRoot' | 'restorePublicationReceipt'> {
  if (!operationReference.trim() || operationReference.length > 200) throw new Error('--operation-reference must be a non-empty, non-secret reference of at most 200 characters.');
  const restoreReleaseId = restorePlan?.releaseId ?? null; const referenceHash = hash(canonicalJson({ activeReleaseId: activePlan.releaseId, restoreReleaseId, operationReference }));
  const rollbackReceipt: ReleaseDocument = { path: `rollbackReceipts/${activePlan.releaseId}-${referenceHash}`, data: { activeReleaseId: activePlan.releaseId, restoreReleaseId, operationReference, immutable: true, rollbackToNone: restoreReleaseId === null } };
  return restorePlan ? { rollbackReceipt, activeRelease: { path: 'runtime/activeRelease', data: { releaseId: restorePlan.releaseId, approvedCount: restorePlan.approvedCount, approvedJsonlSha256: restorePlan.approvedJsonlSha256, catalogSha256: restorePlan.catalogSha256, documentRootSha256: restorePlan.documentRootSha256, sourceManifestSha256: restorePlan.sourceManifestSha256, restoredFromReleaseId: activePlan.releaseId, operationReference } }, restoreReleaseRoot: releaseRoot(restorePlan), restorePublicationReceipt: publicationReceipt(restorePlan) } : { rollbackReceipt, activeRelease: null };
}
/** CAS rollback.  `restorePlan === null` is only permitted when the active release is the sole immutable release root. */
export async function rollbackProductionRelease(activePlan: FirestoreReleasePlan, restorePlan: FirestoreReleasePlan | null, adapter: FirestorePublicationAdapter, operationReference: string): Promise<void> {
  if (!adapter.rollback || !adapter.listPrefix) throw new Error('Rollback requires an adapter with audited CAS rollback and exact prefix enumeration.');
  assertReleaseDocumentsExcludeEvidencePayload(activePlan.documents); await assertVerifiedTarget(adapter); await assertExactProductionReleaseAudit(activePlan, adapter);
  if (restorePlan) { await assertExactProductionReleaseAudit(restorePlan, adapter); }
  else {
    const roots = (await adapter.listPrefix('releases/')).filter((document) => document.exists && /^releases\/[^/]+$/.test(document.path));
    if (roots.length !== 1 || roots[0].path !== `releases/${activePlan.releaseId}`) throw new Error('Rollback to none is permitted only for a verified first release.');
  }
  const documents = rollbackDocuments(activePlan, restorePlan, operationReference); await adapter.rollback({ expectedActiveReleaseId: activePlan.releaseId, restoreReleaseId: restorePlan?.releaseId ?? null, ...documents });
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
    listPrefix: async (prefix) => {
      if (prefix === 'releases/') return (await database.collection('releases').get()).docs.map((snapshot) => ({ path: snapshot.ref.path, exists: true, data: snapshot.data() as Record<string, unknown> }));
      const match = /^releases\/([^/]+)\/$/.exec(prefix); if (!match) throw new Error(`Unsupported audit prefix: ${prefix}`);
      const releaseId = match[1]; const root = database.doc(`releases/${releaseId}`); const [rootSnapshot, questions, inventory, receipts] = await Promise.all([root.get(), database.collection(`releases/${releaseId}/questions`).get(), database.collection(`releases/${releaseId}/inventory`).get(), database.collection(`releases/${releaseId}/publicationReceipts`).get()]);
      return [rootSnapshot, ...questions.docs, ...inventory.docs, ...receipts.docs].filter((snapshot) => snapshot.exists).map((snapshot) => ({ path: snapshot.ref.path, exists: true, data: snapshot.data() as Record<string, unknown> }));
    },
    claimReviewNonceClaims: async (documents) => {
      for (const chunk of chunksOf(documents, MAX_BATCH_DOCUMENTS)) await database.runTransaction(async (transaction) => {
        const snapshots = await Promise.all(chunk.map((document) => transaction.get(database.doc(document.path))));
        for (let index = 0; index < chunk.length; index += 1)
          if (snapshots[index].exists && !equal(snapshots[index].data(), chunk[index].data))
            throw new Error(`Review-nonce claim already belongs to another release: ${chunk[index].path}`);
        for (let index = 0; index < chunk.length; index += 1)
          if (!snapshots[index].exists) transaction.create(database.doc(chunk[index].path), chunk[index].data);
      });
    },
    create: async (documents) => { const batch = database.batch(); for (const document of documents) batch.create(database.doc(document.path), document.data); await batch.commit(); },
    activate: async (request) => { await database.runTransaction(async (transaction) => {
      const [root, receipt, barrier, pointer, activation, barrierUse] = await Promise.all([transaction.get(database.doc(request.releaseRoot.path)), transaction.get(database.doc(request.publicationReceipt.path)), transaction.get(database.doc(request.verificationReceipt.path)), transaction.get(database.doc('runtime/activeRelease')), transaction.get(database.doc(request.activationReceipt.path)), transaction.get(database.doc(request.verificationUseReceipt.path))]);
      if (!root.exists || !equal(root.data(), request.releaseRoot.data)) throw new Error('Activation rejected: release root is missing or differs.');
      if (!receipt.exists || !equal(receipt.data(), request.publicationReceipt.data)) throw new Error('Activation rejected: publication receipt is missing or differs.');
      if (!barrier.exists || !equal(barrier.data(), request.verificationReceipt.data)) throw new Error('Activation rejected: verification barrier is missing or differs.');
      assertVerificationReceipt({ ...request.releaseRoot.data, ...request.publicationReceipt.data, documents: Array.from({ length: Number(request.verificationReceipt.data.documentCount) }, () => ({ path: 'x/y', data: {} })) } as FirestoreReleasePlan, request.verificationReceipt);
      if (activation.exists) throw new Error('Activation rejected: immutable activation receipt already exists.');
      if (barrierUse.exists) throw new Error('Activation rejected: verification barrier was already used.');
      const actualPrevious = pointer.exists ? pointer.data()?.releaseId : null;
      if (actualPrevious !== request.expectedPreviousReleaseId) throw new Error(`Activation rejected: expected ${request.expectedPreviousReleaseId ?? 'no active release'}, found ${actualPrevious ?? 'no active release'}.`);
      transaction.create(database.doc(request.verificationUseReceipt.path), request.verificationUseReceipt.data); transaction.create(database.doc(request.activationReceipt.path), request.activationReceipt.data); transaction.set(database.doc(request.activeRelease.path), request.activeRelease.data);
    }); },
    rollback: async (request) => { await database.runTransaction(async (transaction) => {
      const pointerRef = database.doc('runtime/activeRelease'); const reads = [transaction.get(pointerRef), transaction.get(database.doc(request.rollbackReceipt.path)), ...(request.restoreReleaseRoot ? [transaction.get(database.doc(request.restoreReleaseRoot.path)), transaction.get(database.doc(request.restorePublicationReceipt!.path))] : [])];
      const [pointer, receipt, restoreRoot, restoreReceipt] = await Promise.all(reads); if (receipt.exists) throw new Error('Rollback rejected: immutable rollback receipt already exists.');
      if (!pointer.exists || pointer.data()?.releaseId !== request.expectedActiveReleaseId) throw new Error('Rollback rejected: active-release CAS mismatch.');
      if (request.restoreReleaseId) { if (!restoreRoot?.exists || !equal(restoreRoot.data(), request.restoreReleaseRoot?.data) || !restoreReceipt?.exists || !equal(restoreReceipt.data(), request.restorePublicationReceipt?.data)) throw new Error('Rollback rejected: verified restore release is missing or differs.'); transaction.set(pointerRef, request.activeRelease!.data); }
      else transaction.delete(pointerRef);
      transaction.create(database.doc(request.rollbackReceipt.path), request.rollbackReceipt.data);
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
  assertProductionTarget(flags); const plan = buildV33FirestoreReleasePlan(await loadV33ProductionReleaseInput({ trustRootPath: flags['trust-root'], trustRootSha256: flags['trust-root-sha256'] }));
  if (flags['release-id'] !== plan.releaseId) throw new Error('--release-id does not match the derived immutable production release ID.');
  if (flags['approved-sha256'] !== plan.approvedJsonlSha256) throw new Error('--approved-sha256 does not match the approved canonical JSONL.');
  return plan;
}

async function main(): Promise<void> {
  const [operation, ...values] = process.argv.slice(2);
  if (operation === 'plan') {
    const flags = parseFlags(values); requireFlags(flags, ['trust-root', 'trust-root-sha256']);
    if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Production plan rejects FIRESTORE_EMULATOR_HOST.');
    const plan = buildV33FirestoreReleasePlan(await loadV33ProductionReleaseInput({ trustRootPath: flags['trust-root'], trustRootSha256: flags['trust-root-sha256'] })); console.log(JSON.stringify({ releaseId: plan.releaseId, asOf: plan.asOf, approvedCount: plan.approvedCount, approvedJsonlSha256: plan.approvedJsonlSha256, catalogSha256: plan.catalogSha256, documentRootSha256: plan.documentRootSha256, sourceManifestSha256: plan.sourceManifestSha256, documentCount: plan.documents.length }, null, 2)); return;
  }
  const flags = parseFlags(values);
  if (operation === 'prepare') { requireFlags(flags, ['project', 'database', 'location', 'release-id', 'approved-sha256', 'trust-root', 'trust-root-sha256']); const plan = await productionPlan(flags); const result = await prepareProductionRelease(plan, await createAdminProductionAdapter()); console.log(JSON.stringify({ operation, releaseId: plan.releaseId, ...result }, null, 2)); return; }
  if (operation === 'verify') { requireFlags(flags, ['project', 'database', 'location', 'release-id', 'approved-sha256', 'trust-root', 'trust-root-sha256']); const plan = await productionPlan(flags); const receipt = await verifyPreparedProductionRelease(plan, await createAdminProductionAdapter()); console.log(JSON.stringify({ operation, releaseId: plan.releaseId, verified: true, verificationReceipt: receipt }, null, 2)); return; }
  if (operation === 'activate') { requireFlags(flags, ['project', 'database', 'location', 'release-id', 'approved-sha256', 'expected-active-release', 'operation-reference', 'verification-receipt', 'trust-root', 'trust-root-sha256']); const plan = await productionPlan(flags); const expected = flags['expected-active-release'] === 'none' ? null : flags['expected-active-release']; const adapter = await createAdminProductionAdapter(); const stored = (await adapter.read([flags['verification-receipt']]))[0]; if (!stored?.exists || !stored.data) throw new Error('Activation requires an existing verification barrier receipt.'); await activateProductionRelease(plan, adapter, expected, flags['operation-reference'], { path: flags['verification-receipt'], data: stored.data }); console.log(JSON.stringify({ operation, releaseId: plan.releaseId, activated: true }, null, 2)); return; }
  if (operation === 'audit') { requireFlags(flags, ['project', 'database', 'location', 'release-id', 'approved-sha256', 'trust-root', 'trust-root-sha256']); const plan = await productionPlan(flags); const audit = await auditProductionRelease(plan, await createAdminProductionAdapter()); console.log(JSON.stringify({ operation, ...audit }, null, 2)); return; }
  if (operation === 'rollback-none') { requireFlags(flags, ['project', 'database', 'location', 'release-id', 'approved-sha256', 'operation-reference', 'trust-root', 'trust-root-sha256']); const plan = await productionPlan(flags); await rollbackProductionRelease(plan, null, await createAdminProductionAdapter(), flags['operation-reference']); console.log(JSON.stringify({ operation, releaseId: plan.releaseId, rolledBack: true }, null, 2)); return; }
  throw new Error('Usage: firestore-release-publisher <plan|prepare|verify|activate|audit|rollback-none> [required flags].');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
