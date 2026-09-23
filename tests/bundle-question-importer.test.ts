import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { applyImport, assertMaxNewDocuments, assertPlan, importBatches, MAX_IMPORT_BATCH_DOCUMENTS, type ImportDocument, type ImportReport } from '../scripts/bundle-question-importer.js';
import { canonicalJson } from '../scripts/firestore-release-canonical.js';

const reportFor = (documents: ImportDocument[]): ImportReport => ({ schemaVersion: 'bundle-question-intake-v1', bundleSha256: 'a'.repeat(64), documentsPath: 'plan.jsonl', documentsSha256: createHash('sha256').update(documents.map(canonicalJson).join('\n') + '\n').digest('hex'), documentCount: documents.length, contentRootSha256: 'b'.repeat(64), questionCount: 1, blueprintCount: 0, occurrenceCount: 1, sourceFileCount: 1, issues: [] });

test('private intake creates immutable children, then manifest, and preserves absent active release', async () => {
  const documents = [{ path: `questionImports/${'a'.repeat(64)}/questions/q`, data: { raw: { question: 'س' }, approval: 'unreviewed' } }, { path: `questionImports/${'a'.repeat(64)}/occurrences/s`, data: { archive: 'a.zip' } }];
  const plan = assertPlan(reportFor(documents), documents); const stored = new Map<string, Record<string, unknown>>(); const writes: string[][] = [];
  const adapter = { projectId: async () => 'huroof-a3ee7', databaseMetadata: async () => ({ locationId: 'me-central2', type: 'FIRESTORE_NATIVE' }), read: async (paths: string[]) => paths.map((path) => ({ path, exists: stored.has(path), data: stored.get(path) })), enumerateImportPrefix: async () => [...stored].map(([path, data]) => ({ path, exists: true, data })), create: async (items: ImportDocument[]) => { writes.push(items.map(({ path }) => path)); for (const item of items) { if (stored.has(item.path)) throw new Error('already exists'); stored.set(item.path, structuredClone(item.data)); } } };
  assert.deepEqual(await applyImport(plan, adapter), { created: 3, skipped: 0, verifiedDocumentCount: 2, remaining: 0, manifestWritten: true });
  assert.equal(writes.at(-1)?.[0], plan.manifest.path); assert.equal(stored.has('runtime/activeRelease'), false);
  assert.deepEqual(await applyImport(plan, adapter), { created: 0, skipped: 2, verifiedDocumentCount: 2, remaining: 0, manifestWritten: true });
});

test('plan rejects non-private paths and detects tampering before any adapter call', () => {
  const documents = [{ path: 'runtime/activeRelease', data: {} }];
  assert.throws(() => assertPlan(reportFor(documents), documents), /Invalid or duplicate private intake path/);
});

test('issues, child conflicts, manifest conflicts, and unknown prefix documents abort before writes', async () => {
  const documents = [{ path: `questionImports/${'a'.repeat(64)}/questions/q`, data: { value: 1 } }]; const report = reportFor(documents);
  assert.throws(() => assertPlan({ ...report, issues: [{ code: 'unclassified' }] }, documents), /unresolved/i);
  const plan = assertPlan(report, documents); const stored = new Map<string, Record<string, unknown>>([[documents[0].path, { value: 2 }]]); let writes = 0;
  const adapter = { projectId: async () => 'huroof-a3ee7', databaseMetadata: async () => ({ locationId: 'me-central2', type: 'FIRESTORE_NATIVE' }), read: async (paths: string[]) => paths.map((path) => ({ path, exists: stored.has(path), data: stored.get(path) })), enumerateImportPrefix: async () => [...stored].map(([path, data]) => ({ path, exists: true, data })), create: async () => { writes += 1; } };
  await assert.rejects(applyImport(plan, adapter), /conflict/i); assert.equal(writes, 0);
  stored.clear(); stored.set(plan.manifest.path, { wrong: true }); await assert.rejects(applyImport(plan, adapter), /manifest conflict/i); assert.equal(writes, 0);
  stored.clear(); stored.set(`questionImports/${'a'.repeat(64)}/unexpected/x`, {}); await assert.rejects(applyImport(plan, adapter), /Unknown stored/i); assert.equal(writes, 0);
});

test('partial resume, corrupt readback, and batch-count bounds are enforced', async () => {
  const documents = [{ path: `questionImports/${'a'.repeat(64)}/questions/a`, data: { value: 1 } }, { path: `questionImports/${'a'.repeat(64)}/occurrences/b`, data: { value: 2 } }]; const plan = assertPlan(reportFor(documents), documents); const stored = new Map<string, Record<string, unknown>>([[documents[0].path, documents[0].data]]);
  const adapter = { projectId: async () => 'huroof-a3ee7', databaseMetadata: async () => ({ locationId: 'me-central2', type: 'FIRESTORE_NATIVE' }), read: async (paths: string[]) => paths.map((path) => ({ path, exists: stored.has(path), data: stored.get(path) })), enumerateImportPrefix: async () => [...stored].map(([path, data]) => ({ path, exists: true, data })), create: async (items: ImportDocument[]) => { for (const item of items) stored.set(item.path, item.data); } };
  assert.deepEqual(await applyImport(plan, adapter), { created: 2, skipped: 1, verifiedDocumentCount: 2, remaining: 0, manifestWritten: true });
  const corrupt = { ...adapter, create: async () => {} }; stored.clear(); await assert.rejects(applyImport(plan, corrupt), /Readback differs/i);
  assert.equal(importBatches(Array.from({ length: MAX_IMPORT_BATCH_DOCUMENTS + 1 }, (_, index) => ({ path: `questionImports/${'a'.repeat(64)}/questions/${index}`, data: { index } }))).length, 2);
});

test('quota budget creates a verified prefix, never creates the manifest early, then resumes safely', async () => {
  const documents = [{ path: `questionImports/${'a'.repeat(64)}/questions/a`, data: { value: 1 } }, { path: `questionImports/${'a'.repeat(64)}/occurrences/b`, data: { value: 2 } }]; const plan = assertPlan(reportFor(documents), documents); const stored = new Map<string, Record<string, unknown>>(); const readCalls: string[][] = [];
  const adapter = { projectId: async () => 'huroof-a3ee7', databaseMetadata: async () => ({ locationId: 'me-central2', type: 'FIRESTORE_NATIVE' }), read: async (paths: string[]) => { readCalls.push(paths); return paths.map((path) => ({ path, exists: stored.has(path), data: stored.get(path) })); }, enumerateImportPrefix: async () => [...stored].map(([path, data]) => ({ path, exists: true, data })), create: async (items: ImportDocument[]) => { for (const item of items) stored.set(item.path, structuredClone(item.data)); } };
  assert.deepEqual(await applyImport(plan, adapter, 1), { created: 1, skipped: 0, verifiedDocumentCount: 1, remaining: 1, manifestWritten: false });
  assert.equal(stored.has(plan.manifest.path), false); assert.ok(!readCalls.some((paths) => paths.length === 2));
  assert.deepEqual(await applyImport(plan, adapter, 1), { created: 2, skipped: 1, verifiedDocumentCount: 2, remaining: 0, manifestWritten: true });
  assert.equal(stored.has(plan.manifest.path), true); assert.throws(() => assertMaxNewDocuments(0), /positive integer/i); assert.throws(() => assertMaxNewDocuments(1.5), /positive integer/i);
});
