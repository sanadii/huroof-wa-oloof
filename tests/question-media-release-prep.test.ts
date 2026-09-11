import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildImmutableQuestionMediaDocuments,
  buildPrivateMediaUploadPlan,
} from "../scripts/question-media-release-prep.js";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("generic private preparation verifies synthetic PNG/JPEG/MP4 bytes and immutable readback", async () => {
  const root = await mkdtemp(join(tmpdir(), "huroof-media-prep-"));
  try {
    const fixtures = [
      { type: "image/png" as const, id: "fixture-png", file: "png.bin", manifest: "png.json", bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) },
      { type: "image/jpeg" as const, id: "fixture-jpeg", file: "jpeg.bin", manifest: "jpeg.json", bytes: Buffer.from([255, 216, 255, 0]) },
      { type: "video/mp4" as const, id: "fixture-video", file: "video.bin", manifest: "video.json", bytes: Buffer.from([0, 0, 0, 0, 102, 116, 121, 112]), durationSeconds: 2.5 },
    ];
    await Promise.all(fixtures.flatMap((fixture) => {
      const asset = { mediaId: fixture.id, assetSha256: digest(fixture.bytes), localFile: fixture.file, mediaType: fixture.type, width: 10, height: 20, ...(fixture.durationSeconds === undefined ? {} : { durationSeconds: fixture.durationSeconds }) };
      return [writeFile(join(root, fixture.file), fixture.bytes), writeFile(join(root, fixture.manifest), JSON.stringify({ assetCount: 1, assets: [asset] }))];
    }));
    const plan = await buildPrivateMediaUploadPlan(root, fixtures.map((fixture) => ({ manifest: fixture.manifest, expectedCount: 1, expected: { contentType: fixture.type, mediaId: new RegExp(`^${fixture.id}$`), objectName: (assetSha256: string) => `private/${fixture.id}/${assetSha256}` } })));
    assert.equal(plan.assetCount, 3);
    const docs = buildImmutableQuestionMediaDocuments("release-0123456789abcdef", { ...plan, packageCounts: { v18: 0, rebuild: 0, goals: 0 } }, plan.uploads.map((upload, index) => ({ mediaId: upload.mediaId, assetSha256: upload.assetSha256, contentType: upload.contentType, byteSize: upload.byteSize, width: upload.width, height: upload.height, durationSeconds: upload.durationSeconds, objectName: upload.objectName, generation: String(index + 1) })));
    assert.equal(docs.length, 3);
    assert.equal(docs.find((document) => document.data.contentType === "video/mp4")?.data.durationSeconds, 2.5);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("immutable media associations reject incomplete or drifting Storage readback", () => {
  const upload = { mediaId: "fixture-png", assetSha256: "a".repeat(64), contentType: "image/png" as const, byteSize: 8, width: 10, height: 20, localFile: "png.bin", objectName: "private/png", createOnly: true as const, metadata: { assetSha256: "a".repeat(64), mediaId: "fixture-png", contentType: "image/png", byteSize: "8", width: "10", height: "20" } };
  const plan = { dryRun: true as const, assetCount: 1, packageCounts: { v18: 0, rebuild: 0, goals: 0 }, manifestSha256: "b".repeat(64), uploads: [upload] };
  assert.throws(() => buildImmutableQuestionMediaDocuments("release-0123456789abcdef", plan, []), /every prepared/i);
  assert.throws(() => buildImmutableQuestionMediaDocuments("release-0123456789abcdef", plan, [{ mediaId: upload.mediaId, assetSha256: upload.assetSha256, contentType: upload.contentType, byteSize: upload.byteSize, width: 11, height: upload.height, objectName: upload.objectName, generation: "1" }]), /readback/i);
  const docs = buildImmutableQuestionMediaDocuments("release-0123456789abcdef", plan, [{ mediaId: upload.mediaId, assetSha256: upload.assetSha256, contentType: upload.contentType, byteSize: upload.byteSize, width: upload.width, height: upload.height, objectName: upload.objectName, generation: "1" }]);
  assert.equal(docs[0]?.data.contentType, "image/png");
});
