import assert from "node:assert/strict";
import test from "node:test";
import { assertQaChallengePermit, qaPermitRequestHash } from "./qa-challenge-permit.js";

const base = {
  schemaVersion: "t36-qa-challenge-permit-v1" as const,
  permitId: "permit_1234567890",
  projectId: "huroof-a3ee7",
  hostUid: "host-1",
  releaseId: "t36-candidate-1",
  releaseRootSha256: "a".repeat(64),
  categoryIds: ["tahadani-games-127", "tahadani-games-326"],
  mechanics: ["missing_tile", "qatar_map"],
  mapPresentation: "interactive" as const,
  mapVariantBinding: { schemaVersion: "t36-map-variant-v1" as const, definitionManifestSha256: "c".repeat(64), definitionEnvelopeRootSha256: "d".repeat(64), sidecarSha256: "e".repeat(64), count: 300 as const, reviewed: 205 as const, held: 95 as const },
  protocolVersion: "t36-challenge-runtime-v1" as const,
  issuedAt: "2026-09-23T10:00:00.000Z",
  expiresAt: "2026-09-23T10:15:00.000Z",
  issuedBy: "operator-1",
  reason: "recorded QA acceptance",
};
const expected = {
  permitId: base.permitId, projectId: base.projectId, hostUid: base.hostUid,
  releaseId: base.releaseId, releaseRootSha256: base.releaseRootSha256,
  categoryIds: [...base.categoryIds].reverse(), mechanics: [...base.mechanics].reverse(),
  mapPresentation: base.mapPresentation, mapVariantBinding: base.mapVariantBinding,
  protocolVersion: base.protocolVersion, now: "2026-09-23T10:10:00.000Z",
};

test("QA permit matches an exact normalized scope and request hash", () => {
  assert.deepEqual(assertQaChallengePermit(base, expected).categoryIds, [...base.categoryIds]);
  assert.equal(
    qaPermitRequestHash({ categories: ["b", "a"], permitId: base.permitId }),
    qaPermitRequestHash({ permitId: base.permitId, categories: ["b", "a"] }),
  );
});

test("QA permit fails closed for identity, scope, expiry, revocation, and prior use", () => {
  for (const permit of [
    { ...base, hostUid: "other" }, { ...base, mechanics: ["memory"] },
    { ...base, expiresAt: expected.now }, { ...base, issuedAt: "2026-09-23T10:31:00.000Z" },
    { ...base, expiresAt: "2026-09-23T10:16:00.001Z" }, { ...base, mapPresentation: "ordinary" as const },
    { ...base, mapVariantBinding: { ...base.mapVariantBinding, sidecarSha256: "f".repeat(64) } }, { ...base, revokedAt: expected.now },
    { ...base, consumedAt: expected.now }, { ...base, permitId: "short" },
  ]) assert.throws(() => assertQaChallengePermit(permit, expected), /QA_PERMIT_(?:INVALID|DENIED)/);
});
