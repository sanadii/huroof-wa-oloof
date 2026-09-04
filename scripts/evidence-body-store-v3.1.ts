import { createHash } from 'node:crypto';
import { link, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

export const BODY_STORE_VERSION = 1 as const;
export const MAX_BODY_BYTES = 1_310_720; // 1.25 MiB; the corpus's retained USHMM response is 1,134,524 bytes.
export const MAX_UNIQUE_BODY_BYTES_PER_BATCH = 10 * 1024 * 1024;
export const SHA256_HEX = /^[a-f0-9]{64}$/;

export type ResponseBodyReference = { storeVersion: typeof BODY_STORE_VERSION; sha256: string; byteLength: number };
export type BodyReferenceRecord = { key: string; batchKey: string; responseBody: unknown };
export type EvidenceBodyInspection = { bodies: Map<string, Buffer>; invalidKeys: Set<string>; issues: string[]; uniqueBodyBytes: number };

export const sha256Bytes = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export function responseBodyReference(bytes: Uint8Array): ResponseBodyReference {
  if (bytes.byteLength > MAX_BODY_BYTES) throw new Error(`Evidence response body exceeds the ${MAX_BODY_BYTES}-byte limit.`);
  return { storeVersion: BODY_STORE_VERSION, sha256: sha256Bytes(bytes), byteLength: bytes.byteLength };
}

export function parseResponseBodyReference(value: unknown): ResponseBodyReference | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'byteLength,sha256,storeVersion' || record.storeVersion !== BODY_STORE_VERSION || typeof record.sha256 !== 'string' || !SHA256_HEX.test(record.sha256) || typeof record.byteLength !== 'number' || !Number.isSafeInteger(record.byteLength) || record.byteLength < 1 || record.byteLength > MAX_BODY_BYTES) return undefined;
  return { storeVersion: BODY_STORE_VERSION, sha256: record.sha256, byteLength: record.byteLength };
}

/** The closed digest-derived layout is intentionally the only path construction API. */
export function evidenceBodyPath(storeRoot: string, digest: string): string {
  if (!SHA256_HEX.test(digest)) throw new Error('Evidence body digest must be 64 lowercase hexadecimal characters.');
  const root = resolve(storeRoot);
  const path = resolve(root, 'sha256', digest.slice(0, 2), `${digest}.bin`);
  if (relative(root, path).startsWith('..') || relative(root, path) === '') throw new Error('Evidence body path escaped its store root.');
  return path;
}

async function equalExisting(path: string, bytes: Buffer, digest: string): Promise<void> {
  const existing = await readFile(path);
  if (!existing.equals(bytes) || sha256Bytes(existing) !== digest) throw new Error(`Evidence body conflict at ${path}; existing bytes will not be overwritten.`);
}

/** Atomically creates a digest-addressed blob; pre-existing blobs must be byte-identical. */
export async function writeEvidenceBody(storeRoot: string, bytes: Buffer): Promise<ResponseBodyReference> {
  const reference = responseBodyReference(bytes);
  const path = evidenceBodyPath(storeRoot, reference.sha256);
  await mkdir(dirname(path), { recursive: true });
  try {
    await equalExisting(path, bytes, reference.sha256);
    return reference;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temporary, bytes, { flag: 'wx' });
  try {
    await link(temporary, path);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    await equalExisting(path, bytes, reference.sha256);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
  await equalExisting(path, bytes, reference.sha256);
  return reference;
}

async function inventoryFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? [] : Promise.reject(error));
  const result: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await inventoryFiles(path));
    else if (entry.isFile()) result.push(path);
    else throw new Error(`Unexpected non-file evidence body entry: ${path}`);
  }
  return result;
}

async function validateInventory(storeRoot: string, referenced: Set<string>): Promise<string[]> {
  const root = resolve(storeRoot);
  const files = await inventoryFiles(root);
  const unexpected: string[] = [];
  for (const path of files) {
    const rel = relative(root, path).replace(/\\/g, '/');
    const match = rel.match(/^sha256\/([a-f0-9]{2})\/([a-f0-9]{64})\.bin$/);
    if (!match || match[1] !== match[2].slice(0, 2) || path !== evidenceBodyPath(root, match[2]) || !referenced.has(match[2])) unexpected.push(rel);
  }
  return unexpected.sort();
}

/** Reads each digest once, checks the closed inventory, and applies unique-byte batch budgets. */
export async function inspectEvidenceBodies(records: BodyReferenceRecord[], storeRoot: string): Promise<EvidenceBodyInspection> {
  const invalidKeys = new Set<string>();
  const issues: string[] = [];
  const references = new Map<string, ResponseBodyReference>();
  const recordDigest = new Map<string, string>();
  for (const record of records) {
    const reference = parseResponseBodyReference(record.responseBody);
    if (!reference) { invalidKeys.add(record.key); issues.push(`${record.key}: invalid responseBody reference`); continue; }
    const prior = references.get(reference.sha256);
    if (prior && prior.byteLength !== reference.byteLength) { invalidKeys.add(record.key); issues.push(`${record.key}: conflicting byteLength for ${reference.sha256}`); continue; }
    references.set(reference.sha256, reference); recordDigest.set(record.key, reference.sha256);
  }
  const bodies = new Map<string, Buffer>();
  for (const [digest, reference] of references) {
    try {
      const bytes = await readFile(evidenceBodyPath(storeRoot, digest));
      if (bytes.byteLength !== reference.byteLength || bytes.byteLength > MAX_BODY_BYTES || sha256Bytes(bytes) !== digest) throw new Error('missing, tampered, or length-mismatched body');
      bodies.set(digest, bytes);
    } catch (error) {
      issues.push(`${digest}: ${error instanceof Error ? error.message : 'body unavailable'}`);
      for (const [key, keyDigest] of recordDigest) if (keyDigest === digest) invalidKeys.add(key);
    }
  }
  const batchDigests = new Map<string, Set<string>>();
  for (const record of records) {
    const digest = recordDigest.get(record.key);
    if (digest && bodies.has(digest)) {
      const digests = batchDigests.get(record.batchKey) ?? new Set<string>();
      digests.add(digest);
      batchDigests.set(record.batchKey, digests);
    }
  }
  for (const [batchKey, digests] of batchDigests) {
    const bytes = [...digests].reduce((total, digest) => total + (bodies.get(digest)?.byteLength ?? 0), 0);
    if (bytes > MAX_UNIQUE_BODY_BYTES_PER_BATCH) {
      issues.push(`${batchKey}: unique evidence body bytes exceed ${MAX_UNIQUE_BODY_BYTES_PER_BATCH}`);
      for (const record of records) if (record.batchKey === batchKey) invalidKeys.add(record.key);
    }
  }
  const unexpected = await validateInventory(storeRoot, new Set([...references.keys()]));
  if (unexpected.length) issues.push(`unexpected or orphan evidence body files: ${unexpected.join(', ')}`);
  return { bodies, invalidKeys, issues: issues.sort(), uniqueBodyBytes: [...bodies.values()].reduce((total, bytes) => total + bytes.byteLength, 0) };
}
