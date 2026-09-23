/** Server-only contract for the single-use, flags-off QA admission permit. */
import { createHash } from "node:crypto";
import { canonicalChallengeJson, CHALLENGE_PROTOCOL_VERSION } from "../../src/features/game/challenges/integration.js";
import type { MapPresentation } from "../../src/features/game/runtime/map-variant-resolver.js";

export const QA_CHALLENGE_PERMIT_SCHEMA = "t36-qa-challenge-permit-v1" as const;
export const QA_CHALLENGE_PERMIT_MAX_LIFETIME_MS = 15 * 60_000;
export type QaMapVariantCommitment = {
  schemaVersion: "t36-map-variant-v1";
  definitionManifestSha256: string;
  definitionEnvelopeRootSha256: string;
  sidecarSha256: string;
  count: 300;
  reviewed: 205;
  held: 95;
};
export type QaChallengePermit = {
  schemaVersion: typeof QA_CHALLENGE_PERMIT_SCHEMA;
  permitId: string;
  projectId: string;
  hostUid: string;
  releaseId: string;
  releaseRootSha256: string;
  categoryIds: readonly string[];
  mechanics: readonly string[];
  mapPresentation: MapPresentation;
  /** Required exactly for interactive map rooms; never inferred from current flags. */
  mapVariantBinding?: QaMapVariantCommitment;
  protocolVersion: typeof CHALLENGE_PROTOCOL_VERSION;
  issuedAt: string;
  expiresAt: string;
  issuedBy: string;
  reason: string;
  revokedAt?: string;
  consumedAt?: string;
};

export type QaPermitExpectation = {
  permitId: string;
  projectId: string;
  hostUid: string;
  releaseId: string;
  releaseRootSha256: string;
  categoryIds: readonly string[];
  mechanics: readonly string[];
  mapPresentation: MapPresentation;
  mapVariantBinding?: QaMapVariantCommitment;
  protocolVersion: typeof CHALLENGE_PROTOCOL_VERSION;
  now: string;
};

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const ids = (values: readonly string[]) => [...new Set(values)].sort();
const same = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);
const id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{12,160}$/u.test(value);
const text = (value: unknown, limit = 512) => typeof value === "string" && value.trim().length > 0 && value.length <= limit;
const iso = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const sha256 = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/iu.test(value);
export function assertQaMapVariantCommitment(value: unknown): asserts value is QaMapVariantCommitment {
  const pin = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<QaMapVariantCommitment> : undefined;
  if (!pin || pin.schemaVersion !== "t36-map-variant-v1" || !sha256(pin.definitionManifestSha256) || !sha256(pin.definitionEnvelopeRootSha256) || !sha256(pin.sidecarSha256) || pin.count !== 300 || pin.reviewed !== 205 || pin.held !== 95)
    throw new Error("QA_PERMIT_MAP_VARIANT_INVALID");
}
const sameVariantCommitment = (left: QaMapVariantCommitment | undefined, right: QaMapVariantCommitment | undefined) =>
  canonicalChallengeJson(left ?? null) === canonicalChallengeJson(right ?? null);

/** Inputs are normalized before hashing so equivalent ordering can replay safely. */
export function qaPermitRequestHash(value: Record<string, unknown>): string {
  return sha(canonicalChallengeJson(value));
}

/** Returns only a generic error marker; callers must not disclose permit ownership. */
export function assertQaChallengePermit(value: unknown, expected: QaPermitExpectation): QaChallengePermit {
  const permit = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<QaChallengePermit> : undefined;
  if (!permit || permit.schemaVersion !== QA_CHALLENGE_PERMIT_SCHEMA || !id(permit.permitId) ||
    !text(permit.projectId, 128) || !text(permit.hostUid, 128) || !text(permit.releaseId, 128) ||
    !text(permit.releaseRootSha256, 64) || !sha256(permit.releaseRootSha256) || !Array.isArray(permit.categoryIds) || !Array.isArray(permit.mechanics) ||
    !text(permit.protocolVersion, 128) || !iso(permit.issuedAt) || !iso(permit.expiresAt) ||
    !text(permit.issuedBy, 128) || !text(permit.reason, 512)) throw new Error("QA_PERMIT_INVALID");
  const categories = ids(permit.categoryIds);
  const mechanics = ids(permit.mechanics);
  const expiresAt = permit.expiresAt as string;
  const issuedAt = permit.issuedAt as string;
  try {
    if (permit.mapPresentation !== "ordinary" && permit.mapPresentation !== "interactive") throw new Error("invalid presentation");
    if (permit.categoryIds.includes("tahadani-games-326")) assertQaMapVariantCommitment(permit.mapVariantBinding);
    else if (permit.mapVariantBinding !== undefined) throw new Error("unselected map scope cannot carry a variant pin");
    if (expected.categoryIds.includes("tahadani-games-326")) assertQaMapVariantCommitment(expected.mapVariantBinding);
    else if (expected.mapVariantBinding !== undefined) throw new Error("invalid expected map pin");
  } catch { throw new Error("QA_PERMIT_DENIED"); }
  if (categories.length !== permit.categoryIds.length || mechanics.length !== permit.mechanics.length ||
    categories.some((entry) => !/^[A-Za-z0-9_-]{1,128}$/u.test(entry)) ||
    mechanics.some((entry) => !["navigation", "missing_tile", "memory", "qatar_map"].includes(entry)) ||
    permit.permitId !== expected.permitId || permit.projectId !== expected.projectId || permit.hostUid !== expected.hostUid ||
    permit.releaseId !== expected.releaseId || permit.releaseRootSha256 !== expected.releaseRootSha256 ||
    !same(categories, ids(expected.categoryIds)) || !same(mechanics, ids(expected.mechanics)) ||
    permit.mapPresentation !== expected.mapPresentation || !sameVariantCommitment(permit.mapVariantBinding, expected.mapVariantBinding) ||
    permit.protocolVersion !== expected.protocolVersion || permit.revokedAt !== undefined || permit.consumedAt !== undefined ||
    Date.parse(issuedAt) > Date.parse(expected.now) || Date.parse(expiresAt) <= Date.parse(expected.now) ||
    Date.parse(expiresAt) - Date.parse(issuedAt) > QA_CHALLENGE_PERMIT_MAX_LIFETIME_MS) throw new Error("QA_PERMIT_DENIED");
  return { ...permit, categoryIds: categories, mechanics } as QaChallengePermit;
}
