import assert from "node:assert/strict";
import test from "node:test";
import { exactMapVariantCommitment } from "./map-variant-commitment.js";

const premium = {
  definitionManifestSha256: "a".repeat(64), definitionEnvelopeRootSha256: "b".repeat(64),
  mapVariants: { schemaVersion: "t36-map-variant-v1", sidecarSha256: "c".repeat(64), count: 300, reviewed: 205, held: 95 },
};

test("exact map commitment rejects a self-consistent but unapproved 204/96 root", () => {
  assert.deepEqual(exactMapVariantCommitment(premium), { schemaVersion: "t36-map-variant-v1", definitionManifestSha256: "a".repeat(64), definitionEnvelopeRootSha256: "b".repeat(64), sidecarSha256: "c".repeat(64), count: 300, reviewed: 205, held: 95 });
  assert.throws(() => exactMapVariantCommitment({ ...premium, mapVariants: { ...premium.mapVariants, reviewed: 204, held: 96 } }), /MAP_VARIANT_COMMITMENT_INVALID/);
});
