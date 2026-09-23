/** Offline-only preparation for private immutable question-media uploads.
 *
 * This reads local bytes and manifests. It never writes Storage or Firestore,
 * and it refuses to create a release association until a caller supplies the
 * exact post-upload object generation returned by Storage.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ReleaseDocument } from "./build-firestore-release.js";
import { canonicalJson } from "./firestore-release-canonical.js";

const ROOT = process.cwd();
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const hash = (value: unknown) => sha256(Buffer.from(canonicalJson(value)));
const rootPath = (root: string, localFile: string) => {
  const path = resolve(root, localFile);
  if (isAbsolute(localFile) || relative(root, path).startsWith("..") || relative(root, path).split(sep).includes(".."))
    throw new Error(`Private media local path escapes its package: ${localFile}`);
  return path;
};

export type PrivateMediaUpload = {
  mediaId: string;
  assetSha256: string;
  contentType: "image/png" | "image/jpeg" | "video/mp4";
  byteSize: number;
  width: number;
  height: number;
  durationSeconds?: number;
  localFile: string;
  objectName: string;
  createOnly: true;
  metadata: { assetSha256: string; mediaId: string; contentType: string; byteSize: string; width: string; height: string; durationSeconds?: string };
};
export type PrivateMediaUploadPlan = {
  dryRun: true;
  assetCount: number;
  packageCounts: Record<"v18" | "rebuild" | "goals", number>;
  manifestSha256: string;
  uploads: PrivateMediaUpload[];
};
export type ImmutableMediaReadback = Pick<PrivateMediaUpload, "mediaId" | "assetSha256" | "contentType" | "byteSize" | "width" | "height" | "durationSeconds" | "objectName"> & { generation: string };
export type PrivateMediaPackageSpec = {
  manifest: string;
  expectedCount: number;
  expected: { contentType: PrivateMediaUpload["contentType"]; mediaId: RegExp; objectName: (hash: string) => string };
};

type RawAsset = Record<string, unknown>;
const validHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const signatureFor = (type: PrivateMediaUpload["contentType"], bytes: Uint8Array) =>
  (type === "image/png" && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
  (type === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
  (type === "video/mp4" && Buffer.from(bytes.subarray(4, 8)).equals(Buffer.from("ftyp")));

async function verifiedUpload(
  packageRoot: string,
  raw: RawAsset,
  expected: { contentType: PrivateMediaUpload["contentType"]; mediaId: RegExp; objectName: (hash: string) => string },
): Promise<PrivateMediaUpload> {
  const mediaId = raw.mediaId, assetSha256 = raw.assetSha256 ?? raw.sha256, localFile = raw.localFile;
  if (typeof mediaId !== "string" || !expected.mediaId.test(mediaId) || !validHash(assetSha256) || typeof localFile !== "string")
    throw new Error("Private media manifest has an unsafe binding.");
  const declaredType = raw.contentType ?? raw.mediaType;
  if (declaredType !== expected.contentType) throw new Error(`Private media type drift for ${mediaId}.`);
  const objectName = expected.objectName(assetSha256);
  if (raw.privateObject !== undefined && raw.privateObject !== objectName)
    throw new Error(`Private media object path drift for ${mediaId}.`);
  const bytes = await readFile(rootPath(packageRoot, localFile));
  if (!signatureFor(expected.contentType, bytes) || sha256(bytes) !== assetSha256)
    throw new Error(`Private media byte verification failed for ${mediaId}.`);
  if (typeof raw.bytes === "number" && raw.bytes !== bytes.length)
    throw new Error(`Private media byte-size drift for ${mediaId}.`);
  const width = raw.width, height = raw.height;
  if (typeof width !== "number" || typeof height !== "number" || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
    throw new Error(`Private media dimensions are invalid for ${mediaId}.`);
  const durationSeconds = raw.durationSeconds;
  if (expected.contentType === "video/mp4" && (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0))
    throw new Error(`Private video duration is invalid for ${mediaId}.`);
  return { mediaId, assetSha256, contentType: expected.contentType, byteSize: bytes.length, localFile, objectName, createOnly: true,
    width, height, ...(typeof durationSeconds === "number" ? { durationSeconds } : {}),
    metadata: { assetSha256, mediaId, contentType: expected.contentType, byteSize: String(bytes.length), width: String(width), height: String(height), ...(typeof durationSeconds === "number" ? { durationSeconds: String(durationSeconds) } : {}) } };
}

async function manifestUploads(
  root: string,
  relativeManifest: string,
  expectedCount: number,
  expected: Parameters<typeof verifiedUpload>[2],
): Promise<PrivateMediaUpload[]> {
  const packageRoot = resolve(root, relativeManifest, "..");
  const bytes = await readFile(resolve(root, relativeManifest));
  const document = JSON.parse(bytes.toString("utf8")) as { assets?: unknown[]; assetCount?: unknown };
  if (document.assetCount !== expectedCount || !Array.isArray(document.assets) || document.assets.length !== expectedCount)
    throw new Error(`Private media manifest ${relativeManifest} does not have its expected asset count.`);
  return Promise.all(document.assets.map((asset) => verifiedUpload(packageRoot, asset as RawAsset, expected)));
}

/** Generic verifier used by release preparation and self-contained regression tests. */
export async function buildPrivateMediaUploadPlan(root: string, packages: PrivateMediaPackageSpec[]) {
  if (!packages.length) throw new Error("At least one private media package is required.");
  const groups = await Promise.all(packages.map((item) => manifestUploads(root, item.manifest, item.expectedCount, item.expected)));
  const uploads = groups.flat().sort((left, right) => left.mediaId.localeCompare(right.mediaId));
  if (new Set(uploads.map((upload) => upload.mediaId)).size !== uploads.length || new Set(uploads.map((upload) => upload.assetSha256)).size !== uploads.length)
    throw new Error("Private media IDs and hashes must be one-to-one.");
  return { dryRun: true as const, assetCount: uploads.length, manifestSha256: hash(uploads.map(({ localFile, ...upload }) => upload)), uploads };
}

/** Validates every locally available V18 PNG, rebuilt JPEG, and T17 MP4 before any cloud action. */
export async function buildQuestionMediaUploadPlan(root = ROOT): Promise<PrivateMediaUploadPlan> {
  const specs: PrivateMediaPackageSpec[] = [
    { manifest: "content/question-media/v18-private-240/manifest.json", expectedCount: 240, expected: {
      contentType: "image/png", mediaId: /^v18-(?:tahadani-)?(?:011|012|014|061)-\d{3}$/u,
      objectName: (assetSha256) => `question-media/v18/${assetSha256}.png`,
    } },
    { manifest: "content/question-media/guess-picture-rebuild-v2/manifest.json", expectedCount: 51, expected: {
      contentType: "image/jpeg", mediaId: /^rebuild-v2-photo-011-\d{3}$/u,
      objectName: (assetSha256) => `question-media/guess-picture-rebuild-v2/assets/${assetSha256}.jpg`,
    } },
    { manifest: "content/question-media/goal-quiz-2026/media-registry.json", expectedCount: 198, expected: {
      contentType: "video/mp4", mediaId: /^goal-quiz-2026:\d{3}:(?:blur|clean)$/u,
      objectName: (assetSha256) => `question-media/goal-quiz-2026/assets/${assetSha256}.mp4`,
    } },
  ];
  const plan = await buildPrivateMediaUploadPlan(root, specs);
  const uploads = plan.uploads;
  const [v18, rebuild, goals] = [uploads.filter((upload) => upload.contentType === "image/png"), uploads.filter((upload) => upload.contentType === "image/jpeg"), uploads.filter((upload) => upload.contentType === "video/mp4")];
  const goalPairs = new Map<string, Set<string>>();
  for (const upload of goals) {
    const match = /^goal-quiz-2026:(\d{3}):(blur|clean)$/u.exec(upload.mediaId)!;
    goalPairs.set(match[1]!, new Set([...(goalPairs.get(match[1]!) ?? []), match[2]! ]));
  }
  if (goalPairs.size !== 99 || [...goalPairs.values()].some((pair) => pair.size !== 2))
    throw new Error("Goal media must contain exactly 99 blur/clean pairs.");
  return { ...plan, packageCounts: { v18: v18.length, rebuild: rebuild.length, goals: goals.length } };
}

/** Converts complete authenticated Storage readback into immutable release media documents. */
export function buildImmutableQuestionMediaDocuments(releaseId: string, plan: PrivateMediaUploadPlan, readback: ImmutableMediaReadback[]): ReleaseDocument[] {
  if (!/^release-[A-Za-z0-9_-]{16,128}$/u.test(releaseId)) throw new Error("Invalid immutable release ID.");
  if (readback.length !== plan.uploads.length) throw new Error("Every prepared private media upload requires exact Storage readback.");
  const expected = new Map(plan.uploads.map((upload) => [upload.mediaId, upload]));
  const documents = readback.map((item) => {
    const upload = expected.get(item.mediaId);
    if (!upload || item.assetSha256 !== upload.assetSha256 || item.objectName !== upload.objectName || item.contentType !== upload.contentType || item.byteSize !== upload.byteSize || item.width !== upload.width || item.height !== upload.height || item.durationSeconds !== upload.durationSeconds || !/^\d{1,32}$/u.test(item.generation))
      throw new Error(`Invalid immutable private media readback for ${item.mediaId}.`);
    expected.delete(item.mediaId);
    return { path: `releases/${releaseId}/media/${item.mediaId}`, data: { mediaId: item.mediaId, assetSha256: item.assetSha256, objectName: item.objectName, generation: item.generation, contentType: item.contentType, byteSize: item.byteSize, width: item.width, height: item.height, ...(item.durationSeconds === undefined ? {} : { durationSeconds: item.durationSeconds }), immutable: true } };
  }).sort((left, right) => left.path.localeCompare(right.path));
  if (expected.size || new Set(documents.map((document) => document.path)).size !== documents.length)
    throw new Error("Private media readback is incomplete or duplicates a media association.");
  return documents;
}
