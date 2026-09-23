/** Immutable public-release counts for the T36 map sidecar cohort. */
export type ExactMapVariantCommitment = {
  schemaVersion: "t36-map-variant-v1";
  definitionManifestSha256: string;
  definitionEnvelopeRootSha256: string;
  sidecarSha256: string;
  count: 300;
  reviewed: 205;
  held: 95;
};

/**
 * The release root is an authority boundary: a self-consistent but differently
 * counted cohort must never be admitted into a room or permit scope.
 */
export function exactMapVariantCommitment(premium: Record<string, unknown> | undefined): ExactMapVariantCommitment {
  const mapVariants = premium?.mapVariants as Record<string, unknown> | undefined;
  if (!mapVariants || mapVariants.schemaVersion !== "t36-map-variant-v1" || mapVariants.count !== 300 || mapVariants.reviewed !== 205 || mapVariants.held !== 95)
    throw new Error("MAP_VARIANT_COMMITMENT_INVALID");
  const definitionManifestSha256 = premium?.definitionManifestSha256;
  const definitionEnvelopeRootSha256 = premium?.definitionEnvelopeRootSha256;
  const sidecarSha256 = mapVariants.sidecarSha256;
  if (![definitionManifestSha256, definitionEnvelopeRootSha256, sidecarSha256].every((value) => typeof value === "string" && /^[a-f0-9]{64}$/iu.test(value)))
    throw new Error("MAP_VARIANT_COMMITMENT_INVALID");
  return { schemaVersion: "t36-map-variant-v1", definitionManifestSha256: definitionManifestSha256 as string, definitionEnvelopeRootSha256: definitionEnvelopeRootSha256 as string, sidecarSha256: sidecarSha256 as string, count: 300, reviewed: 205, held: 95 };
}
