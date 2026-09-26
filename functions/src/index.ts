import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError, onCall } from "firebase-functions/https";
import { isQuestionTypeCounts, type QuestionTypeCounts } from "../../src/features/game/runtime/question-type-counts.js";
import {
  canManageTeamsInState,
  expireRoom,
  intentHash,
  intentReceiptId,
  isRoomClosed,
  MAX_AUDIENCE,
  MAX_PLAYERS,
  activePlayerCount,
  normalizeRoomCode,
  preflightContentPreparation,
  projectRoom,
  roomGameKind,
  reduceIntent,
  makeBoard,
  validateDisplayName,
  validIntent,
  type CanonicalMember,
  type CanonicalQuestion,
  type CanonicalRoom,
} from "./game.js";
import { authorizeCurrentQuestionMedia, emulatorCurrentQuestionMediaUrl, expectedReleaseMediaObjectName, readWithFinalMediaAuthorization } from "./question-media.js";
import {
  exactPresenceRoomId,
  leaseState,
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_LEASE_MS,
} from "./presence.js";
export {
  adminGetSession, adminGetOverview, adminListQuestions, adminGetQuestion,
  adminListPublishedQuestions, adminGetPublishedQuestion, adminGetPublishedQuestionMedia, adminMarkPublishedQuestionInspected, adminListPublishedCategories, adminGetPublishedCategory, adminGetCategoryCorrection, adminSaveCategoryCorrection,
  adminSaveQuestion, adminValidateQuestion, adminSubmitQuestionReview, adminArchiveQuestion,
  adminListReviews, adminGetReview, adminDecideReview, adminListCategories, adminGetCategory,
  adminUpdateCategory, adminListReleases, adminGetRelease, adminAuditRelease, adminStageRelease,
  adminListRooms, adminGetRoom, adminRoomAction, adminLookupUser, adminUpdateUserRole,
  adminSetUserStatus, adminRevokeUserSessions, adminListAudit, adminGetHealth,
  adminGetSettings, adminUpdateSettings,
  adminRoomDto,
  adminCreateQuestion, adminImportPreview, adminImportCommit, adminCreateExportJob,
  adminCreateMediaUploadSession, adminFinalizeMediaUpload, adminRemoveUnreferencedMedia,
  adminAssignReview, adminRequestReviewChanges, adminPrepareRelease, adminVerifyRelease,
  adminActivateRelease, adminRollbackRelease,
} from "./admin/admin.js";
import { initialGameState, reduceGame } from "../../src/features/game/domain/lifecycle.js";
import { generateCategoryBoard } from "../../src/features/game/domain/board.js";
import { createHash as challengeHash } from "node:crypto";
import { assertChallengeDefinitionBinding, canonicalChallengeJson, compactChallengeState, parseChallengeDefinitionEnvelope, restoreChallengeState, type ChallengeDefinitionEnvelope } from "../../src/features/game/challenges/integration.js";
import { materializeMapPresentation, type MapPresentation, type MapVariantBinding } from "../../src/features/game/runtime/map-variant-resolver.js";
import { exactMapVariantCommitment } from "./map-variant-commitment.js";
import { RUNTIME_QUESTION_FIELD_NAMES, runtimeQuestionProjection } from "../../src/features/game/runtime/question-projection.js";
import { assertQaChallengePermit, qaPermitRequestHash } from "./qa-challenge-permit.js";
import { createChallengeState, reduceChallenge, reconcileChallengeDeadline, type ChallengeIntent, type ChallengeRuntimeConfig, type Participant } from "../../src/features/game/challenges/engine.js";
import { applyChallengeAward, applyChallengeContinuation, createChallengeBridgeContext } from "../../src/features/game/challenges/award-bridge.js";
import {
  addChallengeReplacementReserve,
  assertChallengeSelectionCapacity,
  beginNextChallengeSelectionRound,
  createMatchQuestionSelection,
  createCategoryQuestionSelection,
  createChallengeCategoryQuestionSelection,
  promoteReservedChallengeQuestion,
  promoteReservedQuestion,
  reserveChallengeQuestionForCell,
  reserveQuestionForCell,
  selectChallengeCategoryQuestion,
  selectCharadesQuestion,
  selectCategoryQuestion,
  selectMatchQuestion,
  type ChallengeCategoryQuestionSelection,
} from "../../src/features/game/runtime/challenge-question-selector.js";
import type { FamilySlot } from "../../src/features/game/challenges/family-allocation.js";

if (!getApps().length) initializeApp();
const database = getFirestore();
database.settings({ ignoreUndefinedProperties: true });
const region = process.env.FUNCTIONS_REGION || "me-central1";
const callable = {
  region,
  enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true",
} as const;
/**
 * These callables materialize a bounded full release. Projection excludes
 * owner provenance and one request per instance bounds concurrent heaps.
 */
export const RELEASE_READER_OPTIONS = {
  memory: "1GiB",
  cpu: 1,
  concurrency: 1,
  maxInstances: 20,
  timeoutSeconds: 60,
} as const;
const releaseReaderCallable = { ...callable, ...RELEASE_READER_OPTIONS } as const;
type ChallengeMechanic = "navigation" | "missing_tile" | "memory" | "qatar_map" | "word_search";
const challengeMechanicValues: readonly ChallengeMechanic[] = ["navigation", "missing_tile", "memory", "qatar_map", "word_search"];
const QUESTION_TYPE_INDEX_SCHEMA_VERSION = "t40-question-type-index-v1";
const QUESTION_TYPE_CLASSIFIER_VERSION = "t40-question-side-v1";
const questionTypeIndexPath = (releaseId: string, releaseRootSha256: string) => `releaseQuestionTypeIndexes/${createHash("sha256").update(releaseId).update("\0").update(releaseRootSha256.toLowerCase()).digest("hex")}`;
type ApprovedReleaseCatalog = {
  releaseId: string;
  releaseRootSha256: string;
  demoFixture: boolean;
  categories: Array<{ id: string; labelAr: string; playable: { huroof: boolean; categories: boolean; charades: boolean }; questionTypeCounts?: QuestionTypeCounts; challengeOnly?: boolean; challengeKinds?: ChallengeMechanic[] }>;
  boardCapabilities: { huroof: boolean; categories: boolean; charades: boolean };
};
// A release can grow independently from a room.  Room creation and gameplay
// only ever read the explicitly selected category scope (maximum ten
// categories), while catalogue discovery reads immutable metadata only.
// These are abuse/response-size bounds, not a global release-size ceiling.
export const MAX_RELEASE_CATALOG_CATEGORIES = 600;
export const MAX_ROOM_SCOPE_CATEGORIES = 10;
export const MAX_SCOPED_RELEASE_QUESTIONS = 10_000;
const MAX_APPROVED_RELEASE_QUESTIONS = 1_000_000;
export const RUNTIME_QUESTION_FIELDS = RUNTIME_QUESTION_FIELD_NAMES;
export const RUNTIME_CATEGORY_FIELDS = ["id", "labelAr", "displayNameAr", "runtimeReadiness", "challengeKinds", "challengeOnly"] as const;
const RELEASE_READINESS_CACHE_MS = 5 * 60_000;
const releaseReadinessCache = new Map<string, { expiresAt: number; value: Promise<ApprovedReleaseCatalog> }>();
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const mediaIssues = new Map<string, number[]>();
const permitMediaIssue = (uid: string, roomId: string) => {
  const key = `${uid}:${roomId}`, current = now();
  const recent = (mediaIssues.get(key) ?? []).filter((value) => value > current - 60_000);
  if (recent.length >= 12) throw new HttpsError("resource-exhausted", "Media request limit reached.");
  recent.push(current); mediaIssues.set(key, recent);
};
const code = () =>
  Array.from(randomBytes(8), (byte) => alphabet[byte % alphabet.length]).join(
    "",
  );
const now = () => Date.now();
const uid = (request: { auth?: { uid: string } | null }) => {
  if (!request.auth?.uid)
    throw new HttpsError("unauthenticated", "Sign-in is required.");
  return request.auth.uid;
};
const roomId = (value: unknown) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    throw new HttpsError("invalid-argument", "Invalid roomId.");
  return value;
};
const number = (value: unknown, fallback: number) =>
  value === undefined
    ? fallback
    : Number.isInteger(value) &&
        (value as number) >= 5 &&
        (value as number) <= 90
      ? (value as number)
      : (() => {
          throw new HttpsError("invalid-argument", "Invalid timer.");
      })();
export function expectedReleaseMatches(value: unknown, releaseId: string, releaseRootSha256: string) {
  const expected = value && typeof value === "object" ? value as Record<string, unknown> : undefined;
  return Boolean(expected && expected.releaseId === releaseId && expected.releaseRootSha256 === releaseRootSha256);
}
/** Reject ambiguous release pins before they enter an idempotency receipt. */
export function normalizeExpectedRelease(value: unknown): { releaseId: string; releaseRootSha256: string } | undefined {
  if (value === undefined) return undefined;
  const pin = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  if (!pin || typeof pin.releaseId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(pin.releaseId) || typeof pin.releaseRootSha256 !== "string" || !/^[a-f0-9]{64}$/iu.test(pin.releaseRootSha256))
    throw new HttpsError("invalid-argument", "EXPECTED_RELEASE_INVALID");
  return { releaseId: pin.releaseId, releaseRootSha256: pin.releaseRootSha256.toLowerCase() };
}
function approvedQuestionCount(value: unknown, message = "Production requires a non-empty approved release.") {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > MAX_APPROVED_RELEASE_QUESTIONS)
    throw new HttpsError("failed-precondition", message);
  return value as number;
}
function teamNames(value: unknown) {
  const teams =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    horizontal: validateDisplayName(teams.horizontal, "الفريق الأفقي"),
    vertical: validateDisplayName(teams.vertical, "الفريق العمودي"),
  };
}
function challengeCapabilityOffer(value: unknown) {
  if (value === undefined) return undefined;
  const offer = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const mechanics = offer?.mechanics;
  const definitionSchemas = offer?.definitionSchemas === undefined ? ["t36-challenge-definition-v1"] : offer.definitionSchemas;
  if (!offer || offer.protocolVersion !== "t36-challenge-runtime-v1" || !Array.isArray(mechanics) || !mechanics.length || mechanics.length > 5 || new Set(mechanics).size !== mechanics.length || mechanics.some((mechanic) => !["navigation", "missing_tile", "memory", "qatar_map", "word_search"].includes(mechanic)) || !Array.isArray(definitionSchemas) || !definitionSchemas.length || definitionSchemas.length > 3 || new Set(definitionSchemas).size !== definitionSchemas.length || definitionSchemas.some((schema) => schema !== "t36-challenge-definition-v1" && schema !== "t37-clean70-challenge-definition-v1" && schema !== "t37-topup-word-search-definition-v1"))
    throw new HttpsError("failed-precondition", "CHALLENGE_PROTOCOL_UNSUPPORTED");
  return { protocolVersion: "t36-challenge-runtime-v1" as const, mechanics: mechanics as Array<"navigation" | "missing_tile" | "memory" | "qatar_map" | "word_search">, definitionSchemas: [...definitionSchemas].sort() as Array<"t36-challenge-definition-v1" | "t37-clean70-challenge-definition-v1" | "t37-topup-word-search-definition-v1"> };
}
export function normalizeT36CreateOptions(requestData: Record<string, unknown>) {
  const rawMapPresentation = requestData.mapPresentation;
  if (rawMapPresentation !== undefined && rawMapPresentation !== "ordinary" && rawMapPresentation !== "interactive")
    throw new HttpsError("invalid-argument", "MAP_PRESENTATION_INVALID");
  const rawPermitId = requestData.qaChallengePermitId;
  if (rawPermitId !== undefined && (typeof rawPermitId !== "string" || !/^[A-Za-z0-9_-]{12,160}$/u.test(rawPermitId)))
    throw new HttpsError("invalid-argument", "QA_PERMIT_REFERENCE_INVALID");
  return {
    mapPresentation: rawMapPresentation === "interactive" ? "interactive" as const : "ordinary" as const,
    qaPermitId: rawPermitId as string | undefined,
  };
}
export function validateQuestionScope(value: unknown): {
  categories: string[];
  modality: "classic" | "image" | "video" | "charades";
  gameKind: "huroof" | "categories";
} {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const categories = Array.isArray(source.categories)
    ? [
        ...new Set(
          source.categories
            .filter(
              (item): item is string =>
                typeof item === "string" && /^[a-z0-9-]{3,128}$/i.test(item),
            )
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ].sort()
    : [];
  const modality = source.modality;
  const gameKind = source.gameKind === undefined ? "huroof" : source.gameKind;
  if (
    !categories.length || categories.length > MAX_ROOM_SCOPE_CATEGORIES ||
    (modality !== "classic" && modality !== "image" && modality !== "video" && modality !== "charades") ||
    (gameKind !== "huroof" && gameKind !== "categories") ||
    (gameKind === "categories" && (categories.length < 2 || categories.length > 10 || modality !== "classic"))
  )
    throw new HttpsError(
      "invalid-argument",
      "A non-empty classic, image, video, or separate charades category scope is required.",
    );
  return { categories, modality, gameKind };
}
function error(error: unknown) {
  if (error instanceof HttpsError) throw error;
  const message = error instanceof Error ? error.message : "invalid";
  const code =
    message === "stale-revision"
      ? "aborted"
      : message === "player-capacity-reached"
        ? "resource-exhausted"
        : message === "invalid-display-name" || message === "invalid-room-code" || message === "invalid-presence-request"
          ? "invalid-argument"
          : "failed-precondition";
  throw new HttpsError(code, message);
}
function isDemoProject() {
  return (
    process.env.GCLOUD_PROJECT ??
    process.env.FIREBASE_CONFIG?.match(/"projectId":"([^"]+)/)?.[1] ??
    ""
  ).startsWith("demo-");
}

function writes(
  tx: FirebaseFirestore.Transaction,
  id: string,
  room: CanonicalRoom,
  members: CanonicalMember[],
  definition?: import("../../src/features/game/challenges/definition.js").CanonicalChallengeDefinition,
) {
  tx.set(database.doc(`adminRoomSummaries/${id}`), {
    revision: room.revision,
    roomCode: room.roomCode,
    lifecycle: room.game.lifecycle,
    releaseId: room.config.releaseId,
    memberCount: activePlayerCount(room, members),
    closed: Boolean((room as CanonicalRoom & { closedAt?: unknown }).closedAt),
    currentRound: room.game.currentRound,
    questionScores: room.game.questionScores,
    teams: room.config.teams,
    members: members.map((member) => ({
      uid: member.uid,
      displayName: member.displayName,
      role: member.role,
      team: member.team ?? null,
      ready: member.ready,
      active: member.active,
    })),
    updatedAt: FieldValue.serverTimestamp(),
  });
  tx.set(
    database.doc(`rooms/${id}/projections/audience`),
    projectRoom(id, room, members, "audience", undefined, now(), definition),
  );
  for (const member of members) {
    if (member.role === "player")
      tx.set(
        database.doc(`rooms/${id}/projections/player_${member.uid}`),
        projectRoom(id, room, members, "player", member.uid, now(), definition),
      );
    if (member.role === "host")
      tx.set(
        database.doc(`rooms/${id}/projections/host`),
        projectRoom(id, room, members, "host", member.uid, now(), definition),
      );
  }
}
async function activeRelease(
  tx: FirebaseFirestore.Transaction,
  demoRequested: boolean,
  expectedRelease: unknown,
) {
  const pointer = await tx.get(database.doc("runtime/activeRelease"));
  if (!pointer.exists)
    throw new HttpsError("failed-precondition", "No active immutable release.");
  const releaseId = pointer.data()?.releaseId;
  if (
    typeof releaseId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(releaseId)
  )
    throw new HttpsError("failed-precondition", "Invalid active release.");
  const root = await tx.get(database.doc(`releases/${releaseId}`));
  if (!root.exists || root.data()?.immutable !== true)
    throw new HttpsError(
      "failed-precondition",
      "Active release is not immutable.",
    );
  const demoFixture = root.data()?.demoFixture === true;
  const approvedCount = approvedQuestionCount(root.data()?.approvedCount);
  const releaseRootSha256 = root.data()?.documentRootSha256;
  if (typeof releaseRootSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(releaseRootSha256))
    throw new HttpsError("failed-precondition", "Active release has an invalid identity.");
  if (
    !isDemoProject() &&
    demoFixture
  )
    throw new HttpsError(
      "failed-precondition",
      "Production requires a non-empty approved release.",
    );
  if (demoRequested !== demoFixture)
    throw new HttpsError(
      "failed-precondition",
      demoFixture
        ? "Demo fixture must be explicitly requested."
      : "Approved release cannot be used as a demo fixture.",
    );
  if ((!isDemoProject() && !expectedReleaseMatches(expectedRelease, releaseId, releaseRootSha256)) || (expectedRelease !== undefined && !expectedReleaseMatches(expectedRelease, releaseId, releaseRootSha256)))
    throw new HttpsError("failed-precondition", "ACTIVE_RELEASE_CHANGED");
  return {
    releaseId,
    releaseRootSha256,
    demoFixture,
    approvedCount,
    t36Premium: root.data()?.t36Premium,
  };
}

/**
 * Public-to-an-authenticated-host release metadata only. Canonical questions,
 * answers, sources, and media are intentionally absent from this boundary.
 */
function projectedQuestionTypeCounts(
  value: unknown,
  releaseId: string,
  releaseRootSha256: string,
  categoryIds: readonly string[],
  approvedQuestionCount: number,
): Map<string, QuestionTypeCounts> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const index = value as Record<string, unknown>;
  const expectedKeys = ["approvedQuestionCount", "categories", "categoryCount", "classifierVersion", "immutable", "indexSha256", "releaseId", "releaseRootSha256", "schemaVersion"];
  if (JSON.stringify(Object.keys(index).sort()) !== JSON.stringify(expectedKeys) || index.schemaVersion !== QUESTION_TYPE_INDEX_SCHEMA_VERSION || index.classifierVersion !== QUESTION_TYPE_CLASSIFIER_VERSION || index.immutable !== true || index.releaseId !== releaseId || index.releaseRootSha256 !== releaseRootSha256 || !Number.isSafeInteger(index.approvedQuestionCount) || index.approvedQuestionCount !== approvedQuestionCount || !Number.isSafeInteger(index.categoryCount) || index.categoryCount !== categoryIds.length || typeof index.indexSha256 !== "string" || !/^[a-f0-9]{64}$/iu.test(index.indexSha256) || !Array.isArray(index.categories) || index.categories.length !== categoryIds.length) return undefined;
  const payload = {
    schemaVersion: index.schemaVersion,
    classifierVersion: index.classifierVersion,
    releaseId: index.releaseId,
    releaseRootSha256: index.releaseRootSha256,
    approvedQuestionCount: index.approvedQuestionCount,
    categoryCount: index.categoryCount,
    categories: index.categories,
  };
  if (index.indexSha256.toLowerCase() !== challengeHash("sha256").update(canonicalChallengeJson(payload)).digest("hex")) return undefined;
  const expected = new Set(categoryIds);
  const result = new Map<string, QuestionTypeCounts>();
  let total = 0;
  let priorId = "";
  for (const row of index.categories) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return undefined;
    const category = row as Record<string, unknown>;
    if (JSON.stringify(Object.keys(category).sort()) !== JSON.stringify(["id", "questionTypeCounts"]) || typeof category.id !== "string" || category.id <= priorId || !expected.has(category.id) || result.has(category.id) || !isQuestionTypeCounts(category.questionTypeCounts)) return undefined;
    priorId = category.id;
    result.set(category.id, category.questionTypeCounts);
    total += Object.values(category.questionTypeCounts).reduce((sum, count) => sum + count, 0);
  }
  return total === approvedQuestionCount && result.size === expected.size ? result : undefined;
}

function withProjectedQuestionTypeIndex(catalog: ApprovedReleaseCatalog, value: unknown, approvedQuestionCount: number): ApprovedReleaseCatalog {
  const counts = projectedQuestionTypeCounts(value, catalog.releaseId, catalog.releaseRootSha256, catalog.categories.map((category) => category.id), approvedQuestionCount);
  return counts ? { ...catalog, categories: catalog.categories.map((category) => ({ ...category, questionTypeCounts: counts.get(category.id)! })) } : catalog;
}

export function approvedReleaseCatalogProjection(
  pointerData: unknown,
  rootData: unknown,
  categoryRows: Array<{ id: string; data: unknown }>,
  questions: CanonicalQuestion[] = [],
  options: { allowDemoFixture?: boolean; questionTypeIndex?: unknown } = {},
): ApprovedReleaseCatalog {
  const pointer = pointerData && typeof pointerData === "object" ? pointerData as Record<string, unknown> : {};
  const root = rootData && typeof rootData === "object" ? rootData as Record<string, unknown> : {};
  const releaseId = pointer.releaseId;
  if (typeof releaseId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(releaseId))
    throw new HttpsError("failed-precondition", "Invalid active release.");
  if (root.immutable !== true)
    throw new HttpsError("failed-precondition", "Active release is not immutable.");
  const demoFixture = root.demoFixture === true;
  approvedQuestionCount(root.approvedCount);
  if (demoFixture && !options.allowDemoFixture)
    throw new HttpsError("failed-precondition", "Production requires a non-empty approved release.");
  const releaseRootSha256 = root.documentRootSha256;
  if (typeof releaseRootSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(releaseRootSha256))
    throw new HttpsError("failed-precondition", "Active release has an invalid identity.");
  const categories = categoryRows.map(({ id, data }) => {
    const row = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const rowId = row.id;
    const labelAr = row.labelAr ?? row.displayNameAr;
    if (rowId !== id || typeof rowId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(rowId) || typeof labelAr !== "string" || !labelAr.trim())
      throw new HttpsError("failed-precondition", "Active release contains an invalid category catalog.");
    const challengeKinds = Array.isArray(row.challengeKinds) && row.challengeKinds.length > 0 && row.challengeKinds.length <= challengeMechanicValues.length && new Set(row.challengeKinds).size === row.challengeKinds.length && row.challengeKinds.every((kind): kind is ChallengeMechanic => typeof kind === "string" && challengeMechanicValues.includes(kind as ChallengeMechanic))
      ? [...row.challengeKinds] as ChallengeMechanic[]
      : undefined;
    if (row.challengeOnly !== undefined && typeof row.challengeOnly !== "boolean")
      throw new HttpsError("failed-precondition", "Active release contains an invalid challenge catalog marker.");
    if (row.challengeOnly === true && !challengeKinds)
      throw new HttpsError("failed-precondition", "Challenge-only category lacks a scoped mechanism.");
    return { id: rowId, labelAr: labelAr.trim(), ...(row.challengeOnly === true ? { challengeOnly: true } : {}), ...(challengeKinds ? { challengeKinds } : {}) };
  }).sort((left, right) => left.id.localeCompare(right.id));
  if (!categories.length)
    throw new HttpsError("failed-precondition", "Active release has no eligible categories.");
  if (new Set(categories.map((category) => category.id)).size !== categories.length)
    throw new HttpsError("failed-precondition", "Active release category catalog is duplicated.");
  const questionTypeCounts = projectedQuestionTypeCounts(options.questionTypeIndex, releaseId, releaseRootSha256, categories.map((category) => category.id), root.approvedCount as number);
  const rawCategoryById = new Map(categoryRows.map((row) => [row.id, row.data]));
  const catalogReadiness = categories.map((category) => {
    const row = rawCategoryById.get(category.id);
    const raw = row && typeof row === "object" ? row as Record<string, unknown> : {};
    const readiness = raw.runtimeReadiness;
    if (!readiness || typeof readiness !== "object" || Array.isArray(readiness)) return undefined;
    const value = readiness as Record<string, unknown>;
    return value.huroof === true && value.categories === true && value.charades === true
      ? { huroof: true, categories: true, charades: true }
      : value.huroof === false && value.categories === false && value.charades === false
        ? { huroof: false, categories: false, charades: false }
        : typeof value.huroof === "boolean" && typeof value.categories === "boolean" && typeof value.charades === "boolean"
          ? { huroof: value.huroof, categories: value.categories, charades: value.charades }
          : undefined;
  });
  if (!questions.length) {
    if (catalogReadiness.some((value) => !value))
      throw new HttpsError("failed-precondition", "Active release is missing immutable scoped readiness metadata.");
    const categoriesWithReadiness = categories.map((category, index) => ({ ...category, playable: catalogReadiness[index]!, ...(questionTypeCounts ? { questionTypeCounts: questionTypeCounts.get(category.id)! } : {}) }));
    return {
      releaseId,
      releaseRootSha256,
      demoFixture,
      categories: categoriesWithReadiness,
      boardCapabilities: {
        huroof: categoriesWithReadiness.some((category) => category.playable.huroof),
        categories: categoriesWithReadiness.some((category) => category.playable.categories),
        charades: categoriesWithReadiness.some((category) => category.playable.charades),
      },
    };
  }
  const runtime = runtimeQuestions(questions);
  const playable = (categories: string[], mode: "huroof" | "categories" | "charades") => {
    try {
      if (mode === "huroof") createMatchQuestionSelection(runtime, { categories, modality: "classic", seed: 1, reservePerLetter: 3 });
      else if (mode === "categories") createCategoryQuestionSelection(runtime, { categories, modality: "classic", seed: 1 });
      else selectCharadesQuestion(runtime, { categories, cursor: 0 });
      return true;
    } catch { return false; }
  };
  const sharedHuroofPoolPlayable = playable(categories.map((category) => category.id), "huroof");
  const categoriesWithReadiness = categories.map((category) => ({
    ...category,
    ...(questionTypeCounts ? { questionTypeCounts: questionTypeCounts.get(category.id)! } : {}),
    playable: {
      // Categories contribute letters to a shared board; they need not each
      // contain every board letter. Room creation still validates the exact
      // selected combination with the authoritative selector.
      huroof: sharedHuroofPoolPlayable && runtime.some((question) =>
        question.categoryId === category.id && question.modality === "classic" &&
        typeof question.targetLetter === "string" && question.targetLetter.length > 0),
      categories: categories.some((other) => other.id !== category.id && playable([category.id, other.id], "categories")),
      charades: playable([category.id], "charades"),
    },
  }));
  return {
    releaseId,
    releaseRootSha256,
    demoFixture,
    categories: categoriesWithReadiness,
    boardCapabilities: {
      huroof: sharedHuroofPoolPlayable,
      categories: categoriesWithReadiness.some((category) => category.playable.categories),
      charades: categoriesWithReadiness.some((category) => category.playable.charades),
    },
  };
}

type CanonicalQueryBuilder = {
  select(...fields: string[]): CanonicalQueryBuilder;
  orderBy(field: FirebaseFirestore.FieldPath): CanonicalQueryBuilder;
  limit(value: number): CanonicalQueryBuilder;
};
/** The only release-question Firestore shape accepted by runtime callables. */
export function canonicalQuestionQuery<T extends CanonicalQueryBuilder>(query: T, approvedCount: number): T {
  return query.select(...RUNTIME_QUESTION_FIELDS).orderBy(FieldPath.documentId()).limit(approvedCount + 1) as T;
}
type ScopedCanonicalQueryBuilder = CanonicalQueryBuilder & {
  where(fieldPath: string, opStr: FirebaseFirestore.WhereFilterOp, value: unknown): ScopedCanonicalQueryBuilder;
};
/** A room may only retrieve its frozen category scope, never a whole release. */
export function scopedCanonicalQuestionQuery<T extends ScopedCanonicalQueryBuilder>(query: T, categoryId: string, approvedCount: number): T {
  return canonicalQuestionQuery(query.where("categoryId", "==", categoryId) as T, approvedCount);
}
function releaseCategoryQuestionQuery(releaseId: string, categoryId: string, approvedCount: number) {
  return scopedCanonicalQuestionQuery(database.collection(`releases/${releaseId}/questions`), categoryId, approvedCount);
}
function releaseCategoryQuery(releaseId: string) {
  return database.collection(`releases/${releaseId}/catalogCategories`)
    .select(...RUNTIME_CATEGORY_FIELDS).orderBy(FieldPath.documentId()).limit(MAX_RELEASE_CATALOG_CATEGORIES + 1);
}

/** Authenticated/App Check metadata discovery; final room creation revalidates in its transaction. */
export const getApprovedReleaseCatalog = onCall(releaseReaderCallable, async (request) => {
  uid(request);
  const pointer = await database.doc("runtime/activeRelease").get();
  if (!pointer.exists) throw new HttpsError("failed-precondition", "No active immutable release.");
  const releaseId = pointer.data()?.releaseId;
  if (typeof releaseId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(releaseId))
    throw new HttpsError("failed-precondition", "Invalid active release.");
  const root = await database.doc(`releases/${releaseId}`).get();
  if (!root.exists || root.data()?.immutable !== true) throw new HttpsError("failed-precondition", "Active release is not immutable.");
  if (!isDemoProject() && root.data()?.demoFixture === true)
    throw new HttpsError("failed-precondition", "Production requires a non-demo approved release.");
  approvedQuestionCount(root.data()?.approvedCount);
  const releaseRootSha256 = root.data()?.documentRootSha256;
  if (typeof releaseRootSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(releaseRootSha256))
    throw new HttpsError("failed-precondition", "Active release has an invalid identity.");
  const cacheKey = `${releaseId}:${releaseRootSha256}`;
  const cached = releaseReadinessCache.get(cacheKey);

  const value = cached && cached.expiresAt > now() ? cached.value : (async () => {
    const categories = await releaseCategoryQuery(releaseId).get();
    const categoryCount = root.data()?.categoryCount;
    if (
      categories.size > MAX_RELEASE_CATALOG_CATEGORIES ||
      (categoryCount !== undefined && (!Number.isSafeInteger(categoryCount) || categoryCount !== categories.size))
    )
      throw new HttpsError("failed-precondition", "Active release exceeds its immutable readiness bounds.");
    return approvedReleaseCatalogProjection(
      pointer.data(),
      root.data(),
      categories.docs.map((document) => ({ id: document.id, data: document.data() })),
      [],
      { allowDemoFixture: isDemoProject() },
    );
  })();
  if (!cached || cached.expiresAt <= now()) releaseReadinessCache.set(cacheKey, { expiresAt: now() + RELEASE_READINESS_CACHE_MS, value });
  while (releaseReadinessCache.size > 8) releaseReadinessCache.delete(releaseReadinessCache.keys().next().value!);
  try {
    // The release catalog itself is cached, but sidecars are read outside that
    // cache so a just-published immutable index becomes discoverable without a
    // five-minute readiness-cache delay. Its release/root binding is rechecked
    // before any counts reach the client.
    const [catalog, flags, questionTypeIndex] = await Promise.all([
      value,
      database.doc("runtime/challengeMechanics").get(),
      database.doc(questionTypeIndexPath(releaseId, releaseRootSha256)).get(),
    ]);
    const values = flags.data() ?? {};
    const enabledMechanics = values.enabled === true
      ? challengeMechanicValues.filter((mechanic) => values[mechanic] === true)
      : [];
    return { ...withProjectedQuestionTypeIndex(catalog, questionTypeIndex.exists ? questionTypeIndex.data() : undefined, root.data()?.approvedCount as number), challengeAvailability: { enabledMechanics } };
  } catch (failure) {
    releaseReadinessCache.delete(cacheKey);
    throw failure;
  }
});
function memberTeam(members: CanonicalMember[], room: CanonicalRoom) {
  const players = members.filter(
    (member) => member.role === "player" && member.active,
  );
  const horizontal = players.filter(
    (member) => member.team === "horizontal",
  ).length + (room.manualParticipants ?? []).filter((participant) => participant.team === "horizontal").length;
  const vertical = players.length + (room.manualParticipants?.length ?? 0) - horizontal;
  return horizontal <= vertical
    ? ("horizontal" as const)
    : ("vertical" as const);
}
export function scopedCategories(categories: readonly string[]) {
  const values = [...new Set(categories)].sort();
  if (!values.length || values.length > MAX_ROOM_SCOPE_CATEGORIES || values.some((id) => !/^[A-Za-z0-9_-]{1,128}$/.test(id)))
    throw new HttpsError("failed-precondition", "Pinned room has an invalid immutable category scope.");
  return values;
}
export function scopedInventoryCount(categoryId: string, data: FirebaseFirestore.DocumentData | undefined) {
  if (!data || data.immutable !== true || data.categoryId !== categoryId || !Number.isSafeInteger(data.approvedCount) || data.approvedCount <= 0)
    throw new HttpsError("failed-precondition", `Pinned release inventory is invalid for category ${categoryId}.`);
  return data.approvedCount as number;
}
/**
 * Release roots can contain hundreds of categories.  A room has a frozen
 * maximum-ten-category scope, so read the immutable inventory first and then
 * read only the exact per-category question sets.  The +1 query limit catches
 * stale/incomplete inventory without ever turning a room transaction into a
 * full-release read.
 */
async function releaseScopedQuestions(
  tx: FirebaseFirestore.Transaction,
  releaseId: string,
  categories: readonly string[],
): Promise<CanonicalQuestion[]> {
  const scope = scopedCategories(categories);
  const inventory = await Promise.all(scope.map(async (categoryId) => {
    const document = await tx.get(database.doc(`releases/${releaseId}/inventory/${categoryId}`));
    return { categoryId, approvedCount: scopedInventoryCount(categoryId, document.data()) };
  }));
  const scopedCount = inventory.reduce((sum, entry) => sum + entry.approvedCount, 0);
  if (!Number.isSafeInteger(scopedCount) || scopedCount > MAX_SCOPED_RELEASE_QUESTIONS)
    throw new HttpsError("failed-precondition", "Selected category scope exceeds the bounded room question limit.");
  const snapshots = await Promise.all(inventory.map(async ({ categoryId, approvedCount }) => {
    const snapshot = await tx.get(releaseCategoryQuestionQuery(releaseId, categoryId, approvedCount));
    if (snapshot.size !== approvedCount)
      throw new HttpsError("failed-precondition", `Pinned release question scope is incomplete for category ${categoryId}.`);
    const rows = questionRows(snapshot.docs);
    if (rows.some((question) => question.categoryId !== categoryId))
      throw new HttpsError("failed-precondition", `Pinned release question scope has a category mismatch for ${categoryId}.`);
    return rows;
  }));
  return snapshots.flat();
}
async function releaseQuestions(
  tx: FirebaseFirestore.Transaction,
  room: CanonicalRoom,
): Promise<CanonicalQuestion[]> {
  const root = await tx.get(database.doc(`releases/${room.config.releaseId}`));
  if (!root.exists || root.data()?.immutable !== true || root.data()?.documentRootSha256 !== room.config.releaseRootSha256)
    throw new HttpsError("failed-precondition", "Pinned release identity is invalid.");
  approvedQuestionCount(root.data()?.approvedCount, "Pinned release has an invalid question count.");
  const questions = await releaseScopedQuestions(tx, room.config.releaseId, room.config.categories ?? []);
  const materialized = await materializeReleaseMapQuestions(tx, room.config.releaseId, questions, room.config.mapPresentation ?? "ordinary", room.config.mapVariantBinding);
  return challengeQuestionsForRoom(materialized, room.config.challenge);
}
async function releaseQuestionsForNewRoom(
  tx: FirebaseFirestore.Transaction,
  release: { releaseId: string; releaseRootSha256: string; approvedCount: number },
  categories: string[],
  mapPresentation: MapPresentation,
  includeChallenges: boolean,
): Promise<CanonicalQuestion[]> {
  const questions = await releaseScopedQuestions(tx, release.releaseId, categories);
  const materialized = await materializeReleaseMapQuestions(tx, release.releaseId, questions, mapPresentation);
  // A legacy room never negotiates the challenge protocol.  Mixed categories
  // therefore retain their ordinary pool while challenge rows stay invisible.
  return includeChallenges ? materialized : materialized.filter((question) => !question.challenge);
}

/** The published map cohort is a fixed reviewed commitment, never a caller-selected count. */
function committedMapVariantPin(premium: Record<string, unknown> | undefined): NonNullable<CanonicalRoom["config"]["mapVariantBinding"]> {
  try { return exactMapVariantCommitment(premium); }
  catch { throw new HttpsError("failed-precondition", "MAP_VARIANT_COMMITMENT_INVALID"); }
}

/**
 * M6 map sidecars are release children, separate from legacy question rows.
 * We load them for the selected scope only and reconstruct a safe effective
 * question before any selector, reserve, or occurrence can touch a map.
 */
async function materializeReleaseMapQuestions(
  tx: FirebaseFirestore.Transaction,
  releaseId: string,
  questions: CanonicalQuestion[],
  presentation: MapPresentation,
  expectedPin?: CanonicalRoom["config"]["mapVariantBinding"],
): Promise<CanonicalQuestion[]> {
  if (!questions.some((question) => question.categoryId === "tahadani-games-326")) return questions;
  const root = await tx.get(database.doc(`releases/${releaseId}`));
  const premium = root.data()?.t36Premium as Record<string, unknown> | undefined;
  const t36Map = premium?.mapVariants as Record<string, unknown> | undefined;
  if (expectedPin && (!t36Map || expectedPin.schemaVersion !== t36Map.schemaVersion || expectedPin.definitionManifestSha256 !== premium?.definitionManifestSha256 || expectedPin.definitionEnvelopeRootSha256 !== premium?.definitionEnvelopeRootSha256 || expectedPin.sidecarSha256 !== t36Map.sidecarSha256 || expectedPin.count !== t36Map.count || expectedPin.reviewed !== t36Map.reviewed || expectedPin.held !== t36Map.held))
    throw new HttpsError("failed-precondition", "MAP_VARIANT_PIN_MISMATCH");
  const rows = await tx.get(database.collection(`releases/${releaseId}/mapVariants`).orderBy(FieldPath.documentId()).limit(301));
  // Only an immutable pre-T36 root can retain ordinary maps without sidecars.
  if (rows.empty && presentation === "ordinary" && !t36Map) return questions;
  if (rows.size !== 300) throw new HttpsError("failed-precondition", "MAP_VARIANT_NAMESPACE_INCOMPLETE");
  if (!t36Map) throw new HttpsError("failed-precondition", "MAP_VARIANT_NAMESPACE_UNCOMMITTED");
  const bindings = rows.docs.map((document) => {
    const data = document.data() as MapVariantBinding;
    if (data.runtimeQuestionId !== document.id) throw new HttpsError("failed-precondition", "MAP_VARIANT_RUNTIME_ID_MISMATCH");
    return data;
  });
  if (new Set(bindings.map((binding) => binding.runtimeQuestionId)).size !== bindings.length)
    throw new HttpsError("failed-precondition", "MAP_VARIANT_NAMESPACE_DUPLICATE");
  const reviewed = bindings.filter((binding) => binding.disposition === "reviewed").length;
  const held = bindings.filter((binding) => binding.disposition === "held").length;
  if (t36Map.schemaVersion !== "t36-map-variant-v1" || t36Map.runtimeProjectionSchema !== "t36-runtime-question-projection-v1" || t36Map.count !== 300 || t36Map.reviewed !== 205 || t36Map.held !== 95 || reviewed !== 205 || held !== 95 || reviewed + held !== bindings.length || t36Map.sidecarSha256 !== definitionDigest(canonicalChallengeJson(bindings)) || bindings.some((binding) => binding.definition.manifestSha256 !== premium?.definitionManifestSha256 || binding.geographicOverlaySha256 !== premium?.geographicOverlaySha256))
    throw new HttpsError("failed-precondition", "MAP_VARIANT_NAMESPACE_PIN_MISMATCH");
  const definitions = new Map<string, import("../../src/features/game/challenges/definition.js").CanonicalChallengeDefinition>();
  await Promise.all(bindings.map(async (binding) => {
    const definition = await pinnedDefinitionEnvelope(tx, binding.definition);
    definitions.set(binding.runtimeQuestionId, definition);
  }));
  try {
    return materializeMapPresentation(
      questions,
      presentation,
      bindings,
      (question) => definitionDigest(canonicalChallengeJson(runtimeQuestionProjection(question as Record<string, unknown>))),
      (binding) => {
        const definition = definitions.get(binding.runtimeQuestionId);
        if (!definition) throw new Error("MAP_VARIANT_DEFINITION_MISSING");
        return definition;
      },
    ) as CanonicalQuestion[];
  } catch (reason) {
    throw new HttpsError("failed-precondition", reason instanceof Error ? reason.message : "MAP_VARIANT_INVALID");
  }
}
function assertPlayableScope(questions: CanonicalQuestion[], scope: ReturnType<typeof validateQuestionScope>) {
  const runtime = runtimeQuestions(questions);
  try {
    if (scope.gameKind === "categories") createCategoryQuestionSelection(runtime, { categories: scope.categories, modality: "classic", seed: 1 });
    else if (scope.modality === "charades") selectCharadesQuestion(runtime, { categories: scope.categories, cursor: 0 });
    else createMatchQuestionSelection(runtime, { categories: scope.categories, modality: scope.modality, seed: 1, reservePerLetter: 3 });
  } catch { throw new HttpsError("failed-precondition", "SELECTED_SCOPE_NOT_PLAYABLE"); }
}
export function questionRows(docs: Array<{ id: string; data(): FirebaseFirestore.DocumentData }>): CanonicalQuestion[] {
  const rows = docs.map((item) => ({ id: item.id, ...(item.data() as Partial<CanonicalQuestion>) }));
  if (
    docs.some((item) => item.data()?.id !== item.id) ||
    rows.some(
      (item) =>
        typeof item.id !== "string" ||
        typeof item.categoryId !== "string" ||
        (item.modality !== "classic" &&
          item.modality !== "image" &&
          item.modality !== "video" &&
          item.modality !== "charades") ||
        typeof item.answerConceptId !== "string" ||
        !item.answerConceptId ||
        typeof item.headerAr !== "string" ||
        typeof item.promptAr !== "string" ||
        typeof item.canonicalAnswer !== "string" ||
        !Array.isArray(item.acceptedAnswers) ||
        (item.challenge !== undefined && (!item.challenge || typeof item.challenge !== "object" || !item.challenge.definition || typeof item.challenge.definition !== "object" || typeof item.challenge.definition.manifestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.challenge.definition.manifestSha256) || typeof item.challenge.definition.id !== "string" || typeof item.challenge.definition.definitionSha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.challenge.definition.definitionSha256) || !["t36-challenge-definition-v1", "t37-clean70-challenge-definition-v1", "t37-topup-word-search-definition-v1"].includes(item.challenge.definition.schemaVersion) || !Array.isArray(item.challenge.factFamilies) || !item.challenge.factFamilies.every((family: unknown) => typeof family === "string" && family.length > 0) || !["navigation", "missing_tile", "memory", "qatar_map", "word_search"].includes(item.challenge.kind))) ||
        (item.modality === "charades"
          ? Boolean(item.targetLetter)
          : typeof item.targetLetter !== "string"),
    )
  )
    throw new HttpsError(
      "failed-precondition",
      "Pinned release contains an incomplete runtime question.",
    );
  return rows as CanonicalQuestion[];
}
const runtimeQuestions = (questions: CanonicalQuestion[]) =>
  questions.map((question) => {
    if (!question.categoryId || !question.modality || !question.answerConceptId)
      throw new Error(
        "Pinned release question lacks required runtime identity.",
      );
    return {
      ...question,
      categoryId: question.categoryId,
      modality: question.modality,
      answerConceptId: question.answerConceptId,
    };
  });
export function challengeQuestionsForRoom(
  questions: CanonicalQuestion[],
  challenge: CanonicalRoom["config"]["challenge"] | undefined,
) {
  return !challenge
    ? questions.filter((question) => !question.challenge)
    : questions.filter((question) => !question.challenge || challenge.mechanics.includes(question.challenge.kind));
}
/** Category labels are trusted only from Firestore and frozen into the room at create. */
async function pinnedCategorySnapshot(
  tx: FirebaseFirestore.Transaction,
  release: { releaseId: string; demoFixture: boolean },
  categories: string[],
) {
  let docs = await Promise.all(
    categories.map((id) => tx.get(database.doc(`releases/${release.releaseId}/catalogCategories/${id}`))),
  );
  // Older emulator fixtures predate release-owned catalogs. Approved releases
  // cannot fall back to mutable catalog rows.
  if (release.demoFixture && docs.some((doc) => !doc.exists))
    docs = await Promise.all(
      categories.map((id) => tx.get(database.doc(`catalogCategories/${id}`))),
    );
  const snapshot = docs.map((doc, index) => {
    const data = doc.data();
    const labelAr = data?.labelAr ?? data?.displayNameAr;
    if (!doc.exists || typeof labelAr !== "string" || !labelAr.trim())
      throw new HttpsError("failed-precondition", `Category ${categories[index]} has no trusted Arabic label.`);
    return { id: categories[index], labelAr: labelAr.trim() };
  });
  return snapshot;
}
function releaseLetters(questions: CanonicalQuestion[], room: CanonicalRoom) {
  if (room.config.modality === "charades")
    throw new Error("Charades never creates a letter-board selection.");
  const selection =
    room.questionSelection ??
    createMatchQuestionSelection(runtimeQuestions(challengeQuestionsForRoom(questions, room.config.challenge)), {
      categories: room.config.categories ?? [],
      modality: room.config.modality ?? "classic",
      seed: room.questionCursor + 1,
      reservePerLetter: 3,
    });
  room.questionSelection = selection;
  return Object.keys(selection.queues);
}
function isChallengeSelection(selection: CanonicalRoom["questionSelection"]): selection is ChallengeCategoryQuestionSelection {
  return !!selection && "challengeFamilyState" in selection;
}
/**
 * Board slots are bound to the board persisted in the room, not to the
 * question cursor.  The cursor advances after every card selection while a
 * board remains immutable for its whole round.
 */
export function categoryChallengePlanForBoard(board: NonNullable<CanonicalRoom["game"]["board"]>): { boardSlots: FamilySlot[]; reserveSlots: FamilySlot[] } {
  if (!Number.isSafeInteger(board.seed)) throw new Error("Challenge category board has an invalid stable marker.");
  const marker = String(board.seed);
  const boardSlots = board.cells.map((cell) => {
    if (!cell.categoryId) throw new Error("Challenge category board cell is missing category scope.");
    return { slotId: `board:${marker}:${cell.id}`, categoryId: cell.categoryId };
  });
  const categories = [...new Set(boardSlots.map((slot) => slot.categoryId))].sort();
  return { boardSlots, reserveSlots: categories.map((categoryId) => ({ slotId: `reserve:${marker}:${categoryId}:0`, categoryId })) };
}
function challengeRemainingSlots(selection: ChallengeCategoryQuestionSelection, selectedSlotId?: string): FamilySlot[] {
  const occupied = new Set([...selection.challengeCompletedSlotIds, ...Object.values(selection.challengeSlotForCell)]);
  if (selectedSlotId) occupied.add(selectedSlotId);
  return selection.challengePlannedSlots.filter((slot) => !occupied.has(slot.slotId));
}

function boardCellId(slotId: string): string | undefined {
  return /^board:[^:]+:(cell-[0-4]-[0-4])$/u.exec(slotId)?.[1];
}

/**
 * M6 initially regenerated the plan from questionCursor. Existing QA rooms
 * can therefore contain unoccupied board slots whose category differs from
 * the immutable board. Correct only those unoccupied category claims. Every
 * completed/reserved slot, selector history, family state, and reservation ID
 * stays byte-for-byte intact; an occupied mismatch fails before any write.
 * Older affected rooms may have an owned board cell whose completed-slot entry
 * was discarded by the old round reset. Its board owner and consumed families
 * remain authoritative, so its stale untracked plan category is corrected but
 * its slot deliberately remains in future capacity accounting (conservative
 * over-reservation rather than making an awarded question available again).
 */
export function reconcileChallengeSelectionForCurrentBoard(
  runtime: ReturnType<typeof runtimeQuestions>,
  selection: ChallengeCategoryQuestionSelection,
  room: CanonicalRoom,
): ChallengeCategoryQuestionSelection {
  const board = room.game.board;
  if (!board) throw new Error("CHALLENGE_SELECTION_BOARD_PLAN_INVALID");
  const expectedPlan = categoryChallengePlanForBoard(board);
  const expectedByCell = new Map(expectedPlan.boardSlots.map((slot) => [boardCellId(slot.slotId)!, slot]));
  const persistedByCell = new Map<string, FamilySlot>();
  for (const slot of selection.challengeBoardSlots) {
    const cellId = boardCellId(slot.slotId);
    if (!cellId || persistedByCell.has(cellId)) throw new Error("CHALLENGE_SELECTION_BOARD_PLAN_INVALID");
    persistedByCell.set(cellId, slot);
  }
  if (persistedByCell.size !== expectedByCell.size || [...expectedByCell.keys()].some((cellId) => !persistedByCell.has(cellId)))
    throw new Error("CHALLENGE_SELECTION_BOARD_PLAN_INVALID");

  const plannedById = new Map(selection.challengePlannedSlots.map((slot) => [slot.slotId, slot]));
  const reserveById = new Map(selection.challengeReserveSlots.map((slot) => [slot.slotId, slot]));
  const selectedCategories = new Set(selection.categories);
  const allPersistedSlots = [...selection.challengeBoardSlots, ...selection.challengeReserveSlots];
  if (
    plannedById.size !== selection.challengePlannedSlots.length ||
    reserveById.size !== selection.challengeReserveSlots.length ||
    new Set(allPersistedSlots.map((slot) => slot.slotId)).size !== allPersistedSlots.length ||
    selection.challengePlannedSlots.length !== allPersistedSlots.length ||
    allPersistedSlots.some((slot) => plannedById.get(slot.slotId)?.categoryId !== slot.categoryId || !selectedCategories.has(slot.categoryId)) ||
    [...persistedByCell.values()].some((slot) => !plannedById.has(slot.slotId)) ||
    selection.categories.some((categoryId) => !selection.challengeReserveSlots.some((slot) => slot.categoryId === categoryId))
  )
    throw new Error("CHALLENGE_SELECTION_BOARD_PLAN_INVALID");
  const recordedOccupied = new Set([...selection.challengeCompletedSlotIds, ...Object.values(selection.challengeSlotForCell)]);
  if (
    new Set(selection.challengeCompletedSlotIds).size !== selection.challengeCompletedSlotIds.length ||
    [...recordedOccupied].some((slotId) => !plannedById.has(slotId))
  ) throw new Error("CHALLENGE_SELECTION_OCCUPANCY_INVALID");
  const ownedUntracked = new Set(
    board.cells
      .filter((cell) => cell.owner)
      .map((cell) => persistedByCell.get(cell.id)?.slotId)
      .filter((slotId): slotId is string => Boolean(slotId && !recordedOccupied.has(slotId))),
  );
  const originalByCell = new Map(
    generateCategoryBoard(board.seed, room.config.categorySnapshot ?? [])
      .cells.map((cell) => [cell.id, cell]),
  );
  const reservationIds = selection.reservedForCell ?? {};
  const reservedSlotIds = selection.challengeFamilyState.reservedForSlot;
  const reservationCells = new Set(Object.keys(reservationIds));
  const activeReplacementBoardSlots = new Set<string>();
  for (const [cellId, slotId] of Object.entries(selection.challengeSlotForCell)) {
    const questionId = reservationIds[cellId];
    const stateQuestionId = reservedSlotIds[slotId];
    const expected = expectedByCell.get(cellId);
    const boardSlot = persistedByCell.get(cellId);
    const original = originalByCell.get(cellId as `cell-${number}-${number}`);
    if (!questionId || questionId !== stateQuestionId || !expected || !boardSlot) throw new Error("CHALLENGE_SELECTION_RESERVATION_INVALID");
    const question = runtime.find((candidate) => candidate.id === questionId);
    if (!question || question.categoryId !== expected.categoryId) throw new Error("CHALLENGE_SELECTION_RESERVATION_CATEGORY_CONFLICT");
    if (slotId !== boardSlot.slotId) {
      const history = selection.challengeReplacementHistory?.[cellId];
      if (!reserveById.has(slotId) || !selection.challengeCompletedSlotIds.includes(boardSlot.slotId))
        throw new Error("CHALLENGE_SELECTION_RESERVATION_INVALID");
      if (boardSlot.categoryId !== expected.categoryId) {
        if (
          !history ||
          history.boardSlotId !== boardSlot.slotId ||
          history.reserveSlotId !== slotId ||
          history.originalCategoryId !== boardSlot.categoryId ||
          history.originalCategoryId !== original?.categoryId ||
          history.replacementCategoryId !== expected.categoryId
        ) throw new Error("CHALLENGE_SELECTION_REPLACEMENT_LINEAGE_INVALID");
        activeReplacementBoardSlots.add(boardSlot.slotId);
      }
    } else if (boardSlot.categoryId !== expected.categoryId) {
      throw new Error("CHALLENGE_SELECTION_RESERVATION_CATEGORY_CONFLICT");
    }
    reservationCells.delete(cellId);
  }
  if (reservationCells.size || Object.keys(reservedSlotIds).some((slotId) => !Object.values(selection.challengeSlotForCell).includes(slotId)))
    throw new Error("CHALLENGE_SELECTION_RESERVATION_INVALID");

  const historicalReplacementBoardSlots = new Set(
    Object.entries(selection.challengeReplacementHistory ?? {})
      .filter(([cellId, history]) => {
        const boardSlot = persistedByCell.get(cellId);
        const original = originalByCell.get(cellId as `cell-${number}-${number}`);
        const current = expectedByCell.get(cellId);
        return Boolean(
          boardSlot && original && current &&
          selection.challengeCompletedSlotIds.includes(boardSlot.slotId) &&
          selection.challengeCompletedSlotIds.includes(history.reserveSlotId) &&
          reserveById.get(history.reserveSlotId)?.categoryId === current.categoryId &&
          history.boardSlotId === boardSlot.slotId &&
          history.reserveSlotId !== boardSlot.slotId &&
          history.originalCategoryId === boardSlot.categoryId &&
          history.originalCategoryId === original.categoryId &&
          history.replacementCategoryId === current.categoryId &&
          original.categoryId !== current.categoryId,
        );
      })
      .map(([, history]) => history.boardSlotId),
  );
  const correctedBoardSlots = selection.challengeBoardSlots.map((slot) => {
    const cellId = boardCellId(slot.slotId)!;
    const expected = expectedByCell.get(cellId)!;
    const validReplacement = activeReplacementBoardSlots.has(slot.slotId) || historicalReplacementBoardSlots.has(slot.slotId);
    if (recordedOccupied.has(slot.slotId) && slot.categoryId !== expected.categoryId && !validReplacement)
      throw new Error("CHALLENGE_SELECTION_OCCUPIED_CATEGORY_CONFLICT");
    // `ownedUntracked` has no slot receipt left to preserve; see the recovery
    // contract above. Its consumed family state remains untouched.
    if (ownedUntracked.has(slot.slotId)) return { ...slot, categoryId: expected.categoryId };
    return recordedOccupied.has(slot.slotId) ? slot : { ...slot, categoryId: expected.categoryId };
  });
  const correctedById = new Map(correctedBoardSlots.map((slot) => [slot.slotId, slot]));
  const corrected = {
    ...selection,
    challengeBoardSlots: correctedBoardSlots,
    challengePlannedSlots: selection.challengePlannedSlots.map((slot) => correctedById.get(slot.slotId) ?? slot),
  };
  assertChallengeSelectionCapacity(runtime, corrected, challengeRemainingSlots(corrected));
  return corrected;
}

/** A retry keeps the current category; after a prior replacement its new reserve supersedes the consumed reserve in the auditable lineage. */
export function updateChallengeRetryLineage(
  selection: ChallengeCategoryQuestionSelection,
  cellId: string,
  boardSlot: FamilySlot | undefined,
  retrySlot: FamilySlot,
): ChallengeCategoryQuestionSelection {
  if (!boardSlot || boardSlot.categoryId === retrySlot.categoryId) return selection;
  const history = selection.challengeReplacementHistory?.[cellId];
  if (
    !history ||
    history.boardSlotId !== boardSlot.slotId ||
    history.originalCategoryId !== boardSlot.categoryId ||
    history.replacementCategoryId !== retrySlot.categoryId ||
    !selection.challengeReserveSlots.some((slot) => slot.slotId === retrySlot.slotId && slot.categoryId === retrySlot.categoryId)
  ) throw new Error("CHALLENGE_SELECTION_REPLACEMENT_LINEAGE_INVALID");
  return {
    ...selection,
    challengeReplacementHistory: {
      ...(selection.challengeReplacementHistory ?? {}),
      [cellId]: { ...history, reserveSlotId: retrySlot.slotId },
    },
  };
}

export function releaseCategorySelection(questions: CanonicalQuestion[], room: CanonicalRoom, nextRound = false) {
  if (room.config.challenge) {
    const runtime = runtimeQuestions(questions).filter((question) => question.modality !== "charades" && (!question.challenge || room.config.challenge!.mechanics.includes(question.challenge.kind)));
    const board = nextRound || !room.game.board ? makeBoard(room) : room.game.board;
    const plan = categoryChallengePlanForBoard(board);
    try {
      const selection = isChallengeSelection(room.questionSelection)
        ? nextRound
          ? beginNextChallengeSelectionRound(runtime, room.questionSelection, plan)
          : reconcileChallengeSelectionForCurrentBoard(runtime, room.questionSelection, room)
        : createChallengeCategoryQuestionSelection(runtime, { categories: room.config.categories ?? [], modality: "classic", seed: room.questionCursor + 1 }, plan);
      room.questionSelection = selection;
      return selection;
    } catch (error) {
      if (isChallengeAllocationExhausted(error))
        throw new HttpsError("failed-precondition", "CONTENT_DEPLETED");
      throw error;
    }
  }
  const selection = room.questionSelection ?? createCategoryQuestionSelection(runtimeQuestions(challengeQuestionsForRoom(questions, undefined)), {
    categories: room.config.categories ?? [], modality: "classic", seed: room.questionCursor + 1,
  });
  room.questionSelection = selection;
  return selection;
}
function releaseRoundReservations(room: CanonicalRoom) {
  if (!room.questionSelection || isChallengeSelection(room.questionSelection)) return;
  room.questionSelection = { ...room.questionSelection, reservedQuestionIds: [], reservedAnswerConceptIds: [], reservedForCell: {} };
}
function contentHold(room: CanonicalRoom, operation: 'SELECT_CELL' | 'START_NEXT_ROUND' | 'CONTINUE', cellId = room.game.activeCellId): CanonicalRoom {
  return { ...room, game: { ...room.game, contentHold: { reason: 'CONTENT_EXHAUSTED', operation, ...(cellId ? { cellId } : {}), heldAtRevision: room.revision + 1 } }, timer: undefined, buzzWinner: undefined };
}
function isChallengeAllocationExhausted(reason: unknown) {
  return reason instanceof Error && (
    reason.message.startsWith("Insufficient family-safe reserve") ||
    reason.message.startsWith("No family-safe reservation") ||
    reason.message.startsWith("Family allocation search budget exhausted")
  );
}
export function isContentDepleted(reason: unknown) {
  return reason instanceof HttpsError && reason.message === 'CONTENT_DEPLETED';
}
export function selectQuestionForActiveCell(
  room: CanonicalRoom,
  questions: CanonicalQuestion[],
): CanonicalQuestion {
  const active = room.game.board?.cells.find(
    (cell) => cell.id === room.game.activeCellId,
  );
  return selectQuestionForLetter(
    active?.revealedLetter ?? active?.visibleValue,
    room.questionCursor,
    questions,
  );
}
function selectQuestionForLetter(
  letter: string | undefined,
  cursor: number,
  questions: CanonicalQuestion[],
): CanonicalQuestion {
  const matches = questions.filter(
    (question) =>
      question.modality !== "charades" &&
      question.targetLetter?.trim() === letter,
  );
  if (!letter || !matches.length)
    throw new Error("Pinned release has no question for the active letter.");
  return matches[cursor % matches.length];
}
/** Selects a release-backed question and, for an unrevealed surprise, its one-time letter. */
export function prepareLetterReveal(
  room: CanonicalRoom,
  questions: CanonicalQuestion[],
): { question: CanonicalQuestion; surpriseLetter?: string } {
  const board = room.game.board;
  const active = board?.cells.find(
    (cell) => cell.id === room.game.activeCellId,
  );
  if (!active) throw new Error("No active board cell.");
  if (active.kind !== "surprise" || active.revealedLetter)
    return { question: selectQuestionForActiveCell(room, questions) };
  const used = new Set(
    board!.cells.flatMap((cell) =>
      cell.kind === "letter"
        ? [cell.visibleValue]
        : cell.revealedLetter
          ? [cell.revealedLetter]
          : [],
    ),
  );
  const candidates = [
    ...new Set(
      questions
        .filter((question) => question.modality !== "charades")
        .map((question) => question.targetLetter?.trim())
        .filter(
          (letter): letter is string =>
            typeof letter === "string" && letter.length > 0,
        )
        .filter((letter) => !used.has(letter)),
    ),
  ].sort();
  if (!candidates.length)
    throw new Error(
      "Pinned release has no unused question letter for the surprise cell.",
    );
  const surpriseLetter = candidates[room.questionCursor % candidates.length];
  return {
    surpriseLetter,
    question: selectQuestionForLetter(
      surpriseLetter,
      room.questionCursor,
      questions,
    ),
  };
}
async function pinnedQuestion(
  tx: FirebaseFirestore.Transaction,
  room: CanonicalRoom,
  activeCellId = room.game.activeCellId,
): Promise<{ question: CanonicalQuestion; surpriseLetter?: string }> {
  try {
    roomGameKind(room);
    const questions = await releaseQuestions(tx, room);
    const runtime = runtimeQuestions(challengeQuestionsForRoom(questions, room.config.challenge));
    if (room.config.modality === "charades")
      {
        const question = selectCharadesQuestion(runtime, {
          categories: room.config.categories ?? [],
          cursor: room.questionCursor,
          consumedQuestionIds: room.questionSelection?.consumedQuestionIds,
          consumedAnswerConceptIds:
            room.questionSelection?.consumedAnswerConceptIds,
        }) as CanonicalQuestion;
        room.questionSelection = {
          queues: {},
          consumedQuestionIds: [
            ...(room.questionSelection?.consumedQuestionIds ?? []),
            question.id,
          ],
          consumedAnswerConceptIds: [
            ...(room.questionSelection?.consumedAnswerConceptIds ?? []),
            question.answerConceptId!,
          ],
          seed: room.questionCursor + 1,
          categories: [...(room.config.categories ?? [])].sort(),
          modality: "charades",
        };
        return { question };
      }
    const active = room.game.board?.cells.find(
      (cell) => cell.id === activeCellId,
    );
    if (!active) throw new Error("No active board cell.");
    if (roomGameKind(room) === "categories") {
      const selection = releaseCategorySelection(questions, room);
      const result = isChallengeSelection(selection)
        ? (() => {
            const challengeRuntime = runtime.filter((question) => question.modality !== "charades" && (!question.challenge || room.config.challenge!.mechanics.includes(question.challenge.kind)));
            const promoted = promoteReservedChallengeQuestion(challengeRuntime, selection, active.id);
            if (promoted) return promoted;
            const slot = selection.challengeBoardSlots.find((candidate) => candidate.slotId.endsWith(`:${active.id}`));
            if (!slot) throw new Error("CHALLENGE_SLOT_MISSING");
            return selectChallengeCategoryQuestion(challengeRuntime, selection, slot, challengeRemainingSlots(selection, slot.slotId));
          })()
        : (promoteReservedQuestion(runtime, selection, active.id) ?? selectCategoryQuestion(runtime, selection, active.categoryId ?? ""));
      const question = questions.find((candidate) => candidate.id === result.question.id);
      if (!question || question.categoryId !== active.categoryId)
        throw new Error("Pinned release lacks the selected category question.");
      room.questionSelection = result.selection;
      return { question };
    }
    const selection =
      room.questionSelection ??
      createMatchQuestionSelection(runtime, {
        categories: room.config.categories ?? [],
        modality: room.config.modality ?? "classic",
        seed: room.questionCursor + 1,
        reservePerLetter: 3,
      });
    const used = new Set(
      room.game.board!.cells.flatMap((cell) =>
        cell.kind === "letter"
          ? [cell.visibleValue]
          : cell.revealedLetter
            ? [cell.revealedLetter]
            : [],
      ),
    );
    const candidates = Object.keys(selection.queues)
      .filter((letter) => !used.has(letter))
      .sort();
    const surpriseLetter =
      active.kind === "surprise" && !active.revealedLetter
        ? candidates[room.questionCursor % candidates.length]
        : undefined;
    const letter =
      surpriseLetter ?? active.revealedLetter ?? active.visibleValue;
    if (!letter) throw new Error("No unused surprise letter.");
    const promoted = promoteReservedQuestion(runtime, selection, active.id);
    const result = promoted ?? selectMatchQuestion(runtime, selection, letter);
    const question = questions.find(
      (candidate) => candidate.id === result.question.id,
    );
    if (
      !question ||
      !question.targetLetter?.trim() ||
      question.targetLetter.trim() !== letter.trim()
    )
      throw new Error(
        "Pinned release question is missing its selected target letter.",
      );
    room.questionSelection = result.selection;
    return { question, ...(surpriseLetter ? { surpriseLetter } : {}) };
  } catch (error) {
    if (isContentDepleted(error)) throw error;
    if (error instanceof Error && (/No unused question\/concept reserve|No unused surprise letter/.test(error.message)))
      throw new HttpsError('failed-precondition', 'CONTENT_DEPLETED');
    throw new HttpsError("failed-precondition", error instanceof Error ? error.message : "Pinned release has no playable question.");
  }
}
/** Retry reserves a fresh question without changing the active cell's scope; the callable promotes it immediately. */
async function retryFailedCell(
  tx: FirebaseFirestore.Transaction,
  room: CanonicalRoom,
): Promise<CanonicalRoom> {
  const cell = room.game.board?.cells.find((item) => item.id === room.game.activeCellId);
  if (!cell || !room.questionSelection)
    throw new HttpsError("failed-precondition", "CONTENT_DEPLETED");
  const questions = await releaseQuestions(tx, room);
  const runtime = runtimeQuestions(challengeQuestionsForRoom(questions, room.config.challenge));
  const queueKey = roomGameKind(room) === "categories"
    ? cell.categoryId
    : cell.revealedLetter ?? cell.visibleValue;
  if (!queueKey)
    throw new HttpsError("failed-precondition", "CONTENT_DEPLETED");
  try {
    if (roomGameKind(room) === "categories" && isChallengeSelection(room.questionSelection)) {
      const challengeRuntime = runtime.filter((question) => question.modality !== "charades" && (!question.challenge || room.config.challenge!.mechanics.includes(question.challenge.kind)));
      let selection = room.questionSelection;
      let slot = selection.challengeReserveSlots.find((entry) => entry.categoryId === queueKey && !selection.challengeCompletedSlotIds.includes(entry.slotId) && !Object.values(selection.challengeSlotForCell).includes(entry.slotId));
      if (!slot) { slot = { slotId: `retry:${room.questionCursor + 1}:${cell.id}:${queueKey}:${selection.challengeReserveSlots.length}`, categoryId: queueKey }; selection = addChallengeReplacementReserve(challengeRuntime, selection, slot); }
      const selected = reserveChallengeQuestionForCell(challengeRuntime, selection, slot, challengeRemainingSlots(selection, slot.slotId), cell.id);
      const boardSlot = selection.challengeBoardSlots.find((entry) => entry.slotId.endsWith(`:${cell.id}`));
      return { ...room, questionSelection: updateChallengeRetryLineage(selected.selection, cell.id, boardSlot, slot) };
    }
    const selected = reserveQuestionForCell(runtime, room.questionSelection, queueKey, cell.id);
    return { ...room, questionSelection: selected.selection };
  } catch {
    throw new HttpsError("failed-precondition", "CONTENT_DEPLETED");
  }
}
/** Returning to the board reserves a replacement before its cell changes, so concurrent selection cannot steal it. */
async function replaceFailedCell(
  tx: FirebaseFirestore.Transaction,
  room: CanonicalRoom,
): Promise<CanonicalRoom> {
  const cell = room.game.board?.cells.find((item) => item.id === room.game.activeCellId);
  if (!cell || !room.questionSelection || !room.game.board)
      throw new HttpsError("failed-precondition", "CONTENT_DEPLETED");
  const questions = await releaseQuestions(tx, room);
  const runtime = runtimeQuestions(challengeQuestionsForRoom(questions, room.config.challenge));
  if (roomGameKind(room) === "categories") {
    const alternatives = (room.config.categories ?? []).filter((id) => id !== cell.categoryId).sort();
    const originalChallengeBoardSlot = isChallengeSelection(room.questionSelection)
      ? room.questionSelection.challengeBoardSlots.find((entry) => entry.slotId.endsWith(`:${cell.id}`))
      : undefined;
    let selected: { question: import("../../src/features/game/runtime/challenge-question-selector.js").RuntimeQuestionV32; selection: CanonicalRoom["questionSelection"] } | undefined;
    let categoryId: string | undefined;
    for (const candidate of alternatives) try {
      if (isChallengeSelection(room.questionSelection)) {
        const challengeRuntime = runtime.filter((question) => question.modality !== "charades" && (!question.challenge || room.config.challenge!.mechanics.includes(question.challenge.kind)));
        let selection = room.questionSelection;
        let slot = selection.challengeReserveSlots.find((entry) => entry.categoryId === candidate && !selection.challengeCompletedSlotIds.includes(entry.slotId) && !Object.values(selection.challengeSlotForCell).includes(entry.slotId));
        if (!slot) { slot = { slotId: `replacement:${room.questionCursor + 1}:${cell.id}:${candidate}:${selection.challengeReserveSlots.length}`, categoryId: candidate }; selection = addChallengeReplacementReserve(challengeRuntime, selection, slot); }
        selected = reserveChallengeQuestionForCell(challengeRuntime, selection, slot, challengeRemainingSlots(selection, slot.slotId), cell.id);
      } else selected = reserveQuestionForCell(runtime, room.questionSelection, candidate, cell.id);
      categoryId = candidate;
      break;
    } catch { /* explicit hold/recovery is handled by the caller when none remain */ }
    if (!selected || !categoryId)
      throw new HttpsError("failed-precondition", "CONTENT_DEPLETED");
    if (originalChallengeBoardSlot && isChallengeSelection(selected.selection)) {
      const replacementSlotId = selected.selection.challengeSlotForCell[cell.id];
      if (!replacementSlotId || !selected.selection.challengeReserveSlots.some((slot) => slot.slotId === replacementSlotId && slot.categoryId === categoryId))
        throw new HttpsError("failed-precondition", "CONTENT_DEPLETED");
      selected = {
        ...selected,
        selection: {
          ...selected.selection,
          challengeReplacementHistory: {
            ...(selected.selection.challengeReplacementHistory ?? {}),
            [cell.id]: {
              boardSlotId: originalChallengeBoardSlot.slotId,
              reserveSlotId: replacementSlotId,
              originalCategoryId: originalChallengeBoardSlot.categoryId,
              replacementCategoryId: categoryId,
            },
          },
        },
      };
    }
    const labelAr = room.config.categorySnapshot?.find((entry) => entry.id === categoryId)?.labelAr;
    if (!labelAr) throw new HttpsError("failed-precondition", "Category snapshot is invalid.");
    const occurrence = (room.categoryOccurrences?.[categoryId] ?? 0) + 1;
    return {
      ...room,
      questionSelection: selected.selection,
      categoryOccurrences: { ...(room.categoryOccurrences ?? {}), [categoryId]: occurrence },
      game: { ...room.game, board: { ...room.game.board, cells: room.game.board.cells.map((item) => item.id === cell.id ? { ...item, categoryId, categoryLabelAr: labelAr, categoryOccurrence: occurrence, visibleValue: String(occurrence) } : item) } },
      activeQuestion: undefined,
    };
  }
  if (cell.kind === "surprise") {
    const used = new Set(room.game.board.cells.flatMap((item) => item.kind === "letter" ? [item.visibleValue] : item.revealedLetter ? [item.revealedLetter] : []));
    const candidates = Object.keys(room.questionSelection.queues).filter((letter) => letter !== cell.revealedLetter && !used.has(letter)).sort();
    let selected: ReturnType<typeof reserveQuestionForCell> | undefined;
    let letter: string | undefined;
    for (const candidate of candidates) try {
      selected = reserveQuestionForCell(runtime, room.questionSelection, candidate, cell.id);
      letter = candidate;
      break;
    } catch { /* next eligible unused letter */ }
    if (!selected || !letter)
      throw new HttpsError("failed-precondition", "CONTENT_DEPLETED");
    return { ...room, questionSelection: selected.selection, game: { ...room.game, board: { ...room.game.board, cells: room.game.board.cells.map((item) => item.id === cell.id ? { ...item, revealedLetter: letter } : item) } }, activeQuestion: undefined };
  }
  return { ...room, activeQuestion: undefined };
}
function expiring(room: CanonicalRoom) {
  const next = expireRoom(room, now());
  return next === room
    ? room
    : { ...next, updatedAt: FieldValue.serverTimestamp() };
}

const definitionDigest = (json: string) => challengeHash("sha256").update(json).digest("hex");
async function pinnedDefinitionEnvelope(tx: FirebaseFirestore.Transaction, reference: { manifestSha256: string; id: string; schemaVersion: ChallengeDefinitionEnvelope["schemaVersion"]; definitionSha256: string }) {
  const doc = await tx.get(database.doc(`challengeDefinitionSets/${reference.manifestSha256}/definitions/${reference.id}`));
  if (!doc.exists) throw new HttpsError("failed-precondition", "CHALLENGE_DEFINITION_MISSING");
  const envelope = doc.data() as ChallengeDefinitionEnvelope;
  if (
    doc.id !== reference.id || envelope.id !== reference.id ||
    envelope.manifestSha256 !== reference.manifestSha256 ||
    envelope.schemaVersion !== reference.schemaVersion ||
    envelope.definitionSha256 !== reference.definitionSha256
  ) throw new HttpsError("failed-precondition", "CHALLENGE_DEFINITION_PIN_MISMATCH");
  try { return parseChallengeDefinitionEnvelope(envelope, definitionDigest); }
  catch (reason) { throw new HttpsError("failed-precondition", reason instanceof Error ? reason.message : "CHALLENGE_DEFINITION_INVALID"); }
}
async function pinnedChallengeDefinition(tx: FirebaseFirestore.Transaction, question: CanonicalQuestion) {
  const reference = question.challenge?.definition;
  if (!reference) throw new HttpsError("failed-precondition", "CHALLENGE_DEFINITION_MISSING");
  try {
    const definition = await pinnedDefinitionEnvelope(tx, reference);
    assertChallengeDefinitionBinding(definition, question);
    return definition;
  }
  catch (reason) { throw new HttpsError("failed-precondition", reason instanceof Error ? reason.message : "CHALLENGE_DEFINITION_INVALID"); }
}
function firebaseChallengeParticipants(room: CanonicalRoom, members: CanonicalMember[], hostUid: string): Participant[] {
  return [
    ...members.flatMap((member) => member.active && member.role === "player" && member.team ? [{ kind: "member" as const, uid: `member:${member.uid}`, actorUid: member.uid, team: member.team }] : []),
    ...(room.manualParticipants ?? []).map((participant) => ({ kind: "manual" as const, id: `manual:${participant.id}`, team: participant.team, controllerUid: hostUid })),
  ];
}
function firebaseChallengeRuntime(room: CanonicalRoom, definitionHash: string, hostUid: string): ChallengeRuntimeConfig {
  if (!room.config.challenge) throw new HttpsError("failed-precondition", "CHALLENGE_PROTOCOL_UNAVAILABLE");
  return { hostUid, protocolHash: room.config.challenge.protocolVersion, assignmentHash: `${room.activeQuestionOccurrence ?? "missing"}:${room.revision}`, stimulusHash: definitionHash };
}
function firebaseChallengeIntent(intent: import("./game.js").GameIntent, actor: string, requestHash: string): ChallengeIntent {
  const payload = intent.payload;
  const names: Record<string, ChallengeIntent["type"]> = { CHALLENGE_ASSIGN: "ASSIGN", CHALLENGE_READY: "READY", CHALLENGE_START: "START", CHALLENGE_MOVE: "MOVE", CHALLENGE_SUBMIT: "SUBMIT", CHALLENGE_START_STEAL: "START_STEAL", CHALLENGE_DECLINE_STEAL: "DECLINE_STEAL", CHALLENGE_PAUSE: "PAUSE", CHALLENGE_RESUME: "RESUME", CHALLENGE_VOID: "VOID", CHALLENGE_REVEAL: "REVEAL", CHALLENGE_CONTINUE: "CONTINUE" };
  const type = names[intent.type];
  if (!type) throw new HttpsError("invalid-argument", "CHALLENGE_INTENT_INVALID");
  const common = { id: intent.intentId, actor, payloadHash: requestHash, occurrence: payload.occurrence as string, revision: payload.challengeRevision as number, expectedStage: payload.stage as ChallengeIntent["expectedStage"], at: now(), type };
  if (type === "ASSIGN") return { ...common, type, assignment: payload.assignment as "guide" | "mover" | "captain" | "stealCaptain", participantId: payload.participantId as string };
  if (type === "READY") return { ...common, type, participantId: payload.participantId as string, readiness: payload.readiness as { protocolHash: string; assignmentHash: string; stimulusHash: string } };
  if (type === "MOVE") return { ...common, type, direction: payload.direction as "north" | "east" | "south" | "west" };
  if (type === "SUBMIT") return { ...common, type, ...(Array.isArray(payload.answers) ? { answers: payload.answers as string[] } : { start: payload.start as { row: number; column: number }, end: payload.end as { row: number; column: number } }) };
  return common as ChallengeIntent;
}

export const createRoom = onCall(releaseReaderCallable, async (request) => {
  const actor = uid(request);
  const requestData = request.data ?? {};
  const demo = requestData.demo === true;
  let displayName: string;
  let teams: { horizontal: string; vertical: string };
  try {
    displayName = validateDisplayName(requestData.displayName, "المضيف");
    teams = teamNames(requestData.teams);
  } catch (reason) {
    return error(reason);
  }
  const questionSeconds = number(requestData.questionSeconds, 20);
  const opponentSeconds = number(requestData.opponentSeconds, 10);
  const scope = validateQuestionScope(requestData);
  const challenge = challengeCapabilityOffer(requestData.challenge);
  const difficulty =
    typeof requestData.difficulty === "string" && requestData.difficulty.trim()
      ? requestData.difficulty.trim().slice(0, 32)
      : "mixed";
  const mode =
    requestData.mode === "fast" || requestData.mode === "custom"
      ? requestData.mode
      : "classic";
  const labelledColours = requestData.labelledColours === true;
  const { mapPresentation, qaPermitId } = normalizeT36CreateOptions(requestData);
  const expectedRelease = normalizeExpectedRelease(requestData.expectedRelease);
  const normalizedQaRequest = qaPermitId ? qaPermitRequestHash({
    permitId: qaPermitId, displayName, teams, demo, questionSeconds, opponentSeconds,
    categories: scope.categories, modality: scope.modality, gameKind: scope.gameKind, mapPresentation,
    difficulty, mode, labelledColours, expectedRelease, challenge: challenge ? { protocolVersion: challenge.protocolVersion, mechanics: [...challenge.mechanics].sort(), definitionSchemas: [...challenge.definitionSchemas].sort() } : undefined,
  }) : undefined;
  const candidates = Array.from({ length: 12 }, code);
  return database.runTransaction(async (tx) => {
    // A consumed permit is an idempotency receipt, not a fresh admission. It
    // deliberately resolves before current-release/expiry validation so a
    // retried network request cannot allocate a different room after rollout.
    if (qaPermitId && normalizedQaRequest) {
      const used = await tx.get(database.doc(`qaChallengePermitUses/${qaPermitId}`));
      if (used.exists) {
        const receipt = used.data() ?? {};
        if (receipt.immutable !== true || receipt.permitId !== qaPermitId || receipt.requestHash !== normalizedQaRequest || receipt.hostUid !== actor || typeof receipt.roomId !== "string" || typeof receipt.roomCode !== "string")
          throw new HttpsError("failed-precondition", "CHALLENGE_MECHANICS_DISABLED");
        const [existingRoom, existingHost] = await Promise.all([
          tx.get(database.doc(`rooms/${receipt.roomId}`)),
          tx.get(database.doc(`rooms/${receipt.roomId}/members/${actor}`)),
        ]);
        if (!existingRoom.exists || isRoomClosed(existingRoom.data() as CanonicalRoom) || !existingHost.exists || existingHost.data()?.role !== "host" || existingHost.data()?.uid !== actor || existingHost.data()?.active !== true || (existingRoom.data() as CanonicalRoom).config.qaAdmission?.permitId !== qaPermitId || (existingRoom.data() as CanonicalRoom).roomCode !== receipt.roomCode)
          throw new HttpsError("failed-precondition", "CHALLENGE_MECHANICS_DISABLED");
        return { roomId: receipt.roomId, roomCode: receipt.roomCode, revision: (existingRoom.data() as CanonicalRoom).revision };
      }
    }
    const release = await activeRelease(tx, demo, expectedRelease);
    const questions = await releaseQuestionsForNewRoom(tx, release, scope.categories, mapPresentation, Boolean(challenge));
    const scopedChallengeKinds = [...new Set([
      ...questions.flatMap((question) => question.challenge ? [question.challenge.kind] : []),
      ...(mapPresentation === "interactive" && scope.categories.includes("tahadani-games-326") ? ["qatar_map" as const] : []),
    ])];
    const scopedDefinitionSchemas = [...new Set(questions.flatMap((question) => question.challenge ? [question.challenge.definition.schemaVersion] : []))];
    if (scopedChallengeKinds.length && !challenge) throw new HttpsError("failed-precondition", "CHALLENGE_PROTOCOL_REQUIRED");
    if (scopedChallengeKinds.length && !scopedChallengeKinds.every((mechanic) => challenge!.mechanics.includes(mechanic))) throw new HttpsError("failed-precondition", "CHALLENGE_PROTOCOL_UNSUPPORTED");
    if (scopedDefinitionSchemas.length && !scopedDefinitionSchemas.every((schema) => challenge!.definitionSchemas.includes(schema))) throw new HttpsError("failed-precondition", "CHALLENGE_DEFINITION_SCHEMA_UNSUPPORTED");
    if (qaPermitId && !scopedChallengeKinds.length) throw new HttpsError("failed-precondition", "CHALLENGE_MECHANICS_DISABLED");
    let qaPermit: ReturnType<typeof assertQaChallengePermit> | undefined;
    if (scopedChallengeKinds.length) {
      if (scope.gameKind !== "categories") throw new HttpsError("failed-precondition", "CHALLENGE_CATEGORY_BOARD_REQUIRED");
      if (!challenge) throw new HttpsError("failed-precondition", "CHALLENGE_PROTOCOL_REQUIRED");
      const flags = await tx.get(database.doc("runtime/challengeMechanics"));
      const values = flags.data() ?? {};
      const normallyEnabled = values.enabled === true && scopedChallengeKinds.length > 0 && scopedChallengeKinds.every((mechanic) => values[mechanic] === true);
      if (qaPermitId) {
        const permit = await tx.get(database.doc(`qaChallengePermits/${qaPermitId}`));
        const expectedMapVariantBinding = scope.categories.includes("tahadani-games-326")
          ? committedMapVariantPin(release.t36Premium as Record<string, unknown> | undefined)
          : undefined;
        try {
          qaPermit = assertQaChallengePermit(permit.data(), {
            permitId: qaPermitId,
            projectId: process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? "huroof-a3ee7",
            hostUid: actor,
            releaseId: release.releaseId,
            releaseRootSha256: release.releaseRootSha256,
            categoryIds: scope.categories,
            mechanics: scopedChallengeKinds,
            mapPresentation,
            mapVariantBinding: expectedMapVariantBinding,
            protocolVersion: challenge.protocolVersion,
            now: new Date(now()).toISOString(),
          });
        } catch { throw new HttpsError("failed-precondition", "CHALLENGE_MECHANICS_DISABLED"); }
      } else if (!normallyEnabled) throw new HttpsError("failed-precondition", "CHALLENGE_MECHANICS_DISABLED");
    }
    assertPlayableScope(questions, scope);
    const categorySnapshot = scope.gameKind === "categories"
      ? await pinnedCategorySnapshot(tx, release, scope.categories)
      : undefined;
    let roomCode: string | undefined;
    for (const candidate of candidates)
      if (!(await tx.get(database.doc(`roomCodes/${candidate}`))).exists) {
        roomCode = candidate;
        break;
      }
    if (!roomCode)
      throw new HttpsError("aborted", "Could not allocate room code.");
    const ref = database.collection("rooms").doc();
    const room: CanonicalRoom = {
      schemaVersion: 2,
      roomCode,
      revision: 1,
      game: initialGameState(),
      config: {
        policyVersion: 1,
        demo,
        questionSeconds,
        opponentSeconds,
        teams,
        releaseId: release.releaseId,
        releaseRootSha256: release.releaseRootSha256,
        releaseDemoFixture: release.demoFixture,
        showQuestionOnAudience: true,
        labelledColours,
        mapPresentation,
        ...scope,
        ...(categorySnapshot ? { categorySnapshot } : {}),
        difficulty,
        mode,
        ...(challenge && scopedChallengeKinds.length ? { challenge: { protocolVersion: challenge.protocolVersion, mechanics: scopedChallengeKinds, definitionSchemas: scopedDefinitionSchemas.sort() } } : {}),
        ...(scope.categories.includes("tahadani-games-326") ? { mapVariantBinding: committedMapVariantPin(release.t36Premium as Record<string, unknown> | undefined) } : {}),
        ...(qaPermit ? { qaAdmission: { permitId: qaPermit.permitId } } : {}),
      },
      manualParticipants: [],
      questionCursor: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    const host: CanonicalMember = {
      uid: actor,
      role: "host",
      displayName,
      ready: true,
      active: true,
      joinedAt: FieldValue.serverTimestamp(),
    };
    tx.create(ref, room);
    tx.create(database.doc(`roomCodes/${roomCode}`), {
      roomId: ref.id,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.create(ref.collection("members").doc(actor), host);
    if (qaPermit && normalizedQaRequest) {
      tx.create(database.doc(`qaChallengePermitUses/${qaPermit.permitId}`), {
        immutable: true, permitId: qaPermit.permitId, requestHash: normalizedQaRequest,
        hostUid: actor, roomId: ref.id, roomCode, createdAt: FieldValue.serverTimestamp(),
      });
      tx.update(database.doc(`qaChallengePermits/${qaPermit.permitId}`), {
        consumedAt: FieldValue.serverTimestamp(), consumedRequestHash: normalizedQaRequest,
      });
    }
    writes(tx, ref.id, room, [host]);
    return { roomId: ref.id, roomCode, revision: room.revision };
  });
});

/** Shared callable input validation; provenance authorization remains transaction-bound. */
export function validateQaClosureRequest(data: unknown) {
  const value = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  const id = roomId(value.roomId);
  if (typeof value.intentId !== "string" || !/^[A-Za-z0-9_-]{1,120}$/u.test(value.intentId) || !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0 || typeof value.reason !== "string" || !value.reason.trim() || value.reason.length > 240)
    throw new HttpsError("invalid-argument", "QA_CLOSURE_REQUEST_INVALID");
  return { id, intentId: value.intentId, expectedRevision: value.expectedRevision as number, reason: value.reason.trim() };
}
/** Narrow QA cleanup: does not depend on global admin mutations, flags, or current release. */
export const closeQaChallengeRoom = onCall(callable, async (request) => {
  const actor = uid(request);
  let closure: ReturnType<typeof validateQaClosureRequest>;
  try { closure = validateQaClosureRequest(request.data); } catch (reason) { return error(reason); }
  const { id, intentId, expectedRevision, reason: normalizedReason } = closure;
  const receiptId = createHash("sha256").update(actor).update("\0").update(intentId).digest("hex");
  const requestHash = qaPermitRequestHash({ operation: "closeQaChallengeRoom", roomId: id, intentId, expectedRevision, reason: normalizedReason });
  return database.runTransaction(async (tx) => {
    const ref = database.doc(`rooms/${id}`);
    const receiptRef = ref.collection("qaClosureReceipts").doc(receiptId);
    const [raw, own, receiptRaw, memberDocs] = await Promise.all([tx.get(ref), tx.get(ref.collection("members").doc(actor)), tx.get(receiptRef), tx.get(ref.collection("members"))]);
    if (!raw.exists || !own.exists) throw new HttpsError("permission-denied", "QA_CLOSURE_DENIED");
    const room = raw.data() as CanonicalRoom;
    const member = own.data() as CanonicalMember;
    const permitId = room.config.qaAdmission?.permitId;
    if (!permitId || member.uid !== actor || member.role !== "host" || member.active !== true) throw new HttpsError("permission-denied", "QA_CLOSURE_DENIED");
    const permitUse = await tx.get(database.doc(`qaChallengePermitUses/${permitId}`));
    const use = permitUse.data() ?? {};
    if (!permitUse.exists || use.immutable !== true || use.permitId !== permitId || use.roomId !== id || use.hostUid !== actor) throw new HttpsError("permission-denied", "QA_CLOSURE_DENIED");
    if (receiptRaw.exists) {
      const receipt = receiptRaw.data() ?? {};
      if (receipt.immutable !== true || receipt.operation !== "closeQaChallengeRoom" || receipt.requestHash !== requestHash || receipt.actorUid !== actor || receipt.roomId !== id || receipt.permitId !== permitId || receipt.originalRevision !== expectedRevision || receipt.closedRevision !== expectedRevision + 1 || receipt.outcome !== "closed" || room.revision !== receipt.closedRevision || !isRoomClosed(room))
        throw new HttpsError("failed-precondition", "QA_CLOSURE_REPLAY_CONFLICT");
      return { roomId: id, revision: receipt.closedRevision, replayed: true };
    }
    if (isRoomClosed(room) || room.revision !== expectedRevision) throw new HttpsError("failed-precondition", "QA_CLOSURE_STALE");
    const members = memberDocs.docs.map((item) => item.data() as CanonicalMember);
    const next = { ...room, revision: room.revision + 1, closedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), timer: undefined, buzzWinner: undefined } as CanonicalRoom & { closedAt: unknown };
    tx.set(ref, next);
    tx.create(receiptRef, { immutable: true, operation: "closeQaChallengeRoom", actorUid: actor, roomId: id, permitId, requestHash, originalRevision: room.revision, closedRevision: next.revision, outcome: "closed", createdAt: FieldValue.serverTimestamp() });
    tx.create(ref.collection("events").doc(String(next.revision).padStart(12, "0")), { type: "QA_ROOM_CLOSED", actorUid: actor, revision: next.revision, createdAt: FieldValue.serverTimestamp() });
    writes(tx, id, next, members);
    return { roomId: id, revision: next.revision, replayed: false };
  });
});

export const joinRoom = onCall(callable, async (request) => {
  const actor = uid(request);
  let roomCode: string;
  try {
    roomCode = normalizeRoomCode(String(request.data?.roomCode ?? ""));
  } catch (reason) {
    return error(reason);
  }
  return database.runTransaction(async (tx) => {
    const codeDoc = await tx.get(database.doc(`roomCodes/${roomCode}`));
    if (!codeDoc.exists || typeof codeDoc.data()?.roomId !== "string")
      throw new HttpsError("not-found", "Room not found.");
    const id = codeDoc.data()!.roomId as string;
    const ref = database.doc(`rooms/${id}`);
    const [raw, own, memberDocs] = await Promise.all([
      tx.get(ref),
      tx.get(ref.collection("members").doc(actor)),
      tx.get(ref.collection("members")),
    ]);
    if (!raw.exists) throw new HttpsError("not-found", "Room not found.");
    let room = expiring(raw.data() as CanonicalRoom);
    if (room.config.challenge) {
      const offered = challengeCapabilityOffer(request.data?.challenge);
      if (!offered || offered.protocolVersion !== room.config.challenge.protocolVersion || !room.config.challenge.mechanics.every((mechanic) => offered.mechanics.includes(mechanic)) || !(room.config.challenge.definitionSchemas ?? ["t36-challenge-definition-v1"]).every((schema) => offered.definitionSchemas.includes(schema)))
        throw new HttpsError("failed-precondition", "CHALLENGE_PROTOCOL_REQUIRED");
    }
    if (isRoomClosed(room))
      throw new HttpsError("failed-precondition", "Room is closed.");
    const members = memberDocs.docs.map(
      (item) => item.data() as CanonicalMember,
    );
    let definition: import("../../src/features/game/challenges/definition.js").CanonicalChallengeDefinition | undefined;
    if (room.challenge && room.activeQuestion?.challenge) {
      definition = await pinnedChallengeDefinition(tx, room.activeQuestion);
      const state = restoreChallengeState(room.challenge);
      const reconciled = reconcileChallengeDeadline(definition, state, now());
      if (reconciled !== state) {
        let game = room.game;
        let bridge = room.challengeBridge;
        if (reconciled.result === "correct" && game.activeCellId) {
          const bridged = applyChallengeAward(reconciled, game, bridge ?? createChallengeBridgeContext(reconciled.occurrence, game.activeCellId));
          game = bridged.game;
          bridge = bridged.context;
        }
        room = { ...room, revision: room.revision + 1, game, challenge: compactChallengeState(reconciled), challengeBridge: bridge, updatedAt: FieldValue.serverTimestamp() };
      }
    }
    if (own.exists) {
      if (room.revision !== (raw.data() as CanonicalRoom).revision) {
        tx.set(ref, room);
        tx.create(ref.collection("events").doc(String(room.revision).padStart(12, "0")), { type: "CHALLENGE_JOIN_RECONCILE", actorUid: "server", revision: room.revision, createdAt: FieldValue.serverTimestamp() });
        writes(tx, id, room, members, definition);
      }
      return { roomId: id, revision: room.revision };
    }
    let displayName: string;
    try {
      displayName = validateDisplayName(request.data?.displayName);
    } catch (reason) {
      return error(reason);
    }
    if (!canManageTeamsInState(room.game.lifecycle))
      throw new HttpsError(
        "failed-precondition",
        "Joining is currently locked during an active question or match stop.",
      );
    if (activePlayerCount(room, members) >= MAX_PLAYERS)
      throw new HttpsError("resource-exhausted", "Player capacity reached.");
    const member: CanonicalMember = {
      uid: actor,
      role: "player",
      displayName,
      ready: false,
      active: true,
      team: memberTeam(members, room),
      joinedAt: FieldValue.serverTimestamp(),
    };
    const next = {
      ...room,
      revision: room.revision + 1,
      updatedAt: FieldValue.serverTimestamp(),
    };
    tx.create(ref.collection("members").doc(actor), member);
    tx.set(ref, next);
    writes(tx, id, next, [...members, member], definition);
    return { roomId: id, revision: next.revision };
  });
});

export const joinAudience = onCall(callable, async (request) => {
  const actor = uid(request);
  let roomCode: string;
  try {
    roomCode = normalizeRoomCode(String(request.data?.roomCode ?? ""));
  } catch (reason) {
    return error(reason);
  }
  return database.runTransaction(async (tx) => {
    const codeDoc = await tx.get(database.doc(`roomCodes/${roomCode}`));
    if (!codeDoc.exists) throw new HttpsError("not-found", "Room not found.");
    const id = codeDoc.data()!.roomId as string;
    const ref = database.doc(`rooms/${id}`);
    const [raw, own, memberDocs] = await Promise.all([
      tx.get(ref),
      tx.get(ref.collection("members").doc(actor)),
      tx.get(ref.collection("members")),
    ]);
    if (!raw.exists) throw new HttpsError("not-found", "Room not found.");
    let room = expiring(raw.data() as CanonicalRoom);
    if (isRoomClosed(room))
      throw new HttpsError("failed-precondition", "Room is closed.");
    if (room.config.challenge) {
      const offered = challengeCapabilityOffer(request.data?.challenge);
      if (!offered || offered.protocolVersion !== room.config.challenge.protocolVersion || !room.config.challenge.mechanics.every((mechanic) => offered.mechanics.includes(mechanic)) || !(room.config.challenge.definitionSchemas ?? ["t36-challenge-definition-v1"]).every((schema) => offered.definitionSchemas.includes(schema)))
        throw new HttpsError("failed-precondition", "CHALLENGE_PROTOCOL_REQUIRED");
    }
    const members = memberDocs.docs.map(
      (item) => item.data() as CanonicalMember,
    );
    let definition: import("../../src/features/game/challenges/definition.js").CanonicalChallengeDefinition | undefined;
    if (room.challenge && room.activeQuestion?.challenge) {
      definition = await pinnedChallengeDefinition(tx, room.activeQuestion);
      const state = restoreChallengeState(room.challenge);
      const reconciled = reconcileChallengeDeadline(definition, state, now());
      if (reconciled !== state) {
        let game = room.game;
        let bridge = room.challengeBridge;
        if (reconciled.result === "correct" && game.activeCellId) {
          const bridged = applyChallengeAward(reconciled, game, bridge ?? createChallengeBridgeContext(reconciled.occurrence, game.activeCellId));
          game = bridged.game;
          bridge = bridged.context;
        }
        room = { ...room, revision: room.revision + 1, game, challenge: compactChallengeState(reconciled), challengeBridge: bridge, updatedAt: FieldValue.serverTimestamp() };
      }
    }
    if (own.exists) {
      if (room.revision !== (raw.data() as CanonicalRoom).revision) {
        tx.set(ref, room);
        tx.create(ref.collection("events").doc(String(room.revision).padStart(12, "0")), { type: "CHALLENGE_AUDIENCE_RECONCILE", actorUid: "server", revision: room.revision, createdAt: FieldValue.serverTimestamp() });
        writes(tx, id, room, members, definition);
      }
      return { roomId: id, revision: room.revision };
    }
    if (
      members.filter((member) => member.role === "audience" && member.active)
        .length >= MAX_AUDIENCE
    )
      throw new HttpsError("resource-exhausted", "Audience capacity reached.");
    const member: CanonicalMember = {
      uid: actor,
      role: "audience",
      displayName: "جمهور",
      ready: false,
      active: true,
      joinedAt: FieldValue.serverTimestamp(),
    };
    const next = {
      ...room,
      revision: room.revision + 1,
      updatedAt: FieldValue.serverTimestamp(),
    };
    tx.create(ref.collection("members").doc(actor), member);
    tx.set(ref, next);
    writes(tx, id, next, [...members, member], definition);
    return { roomId: id, revision: next.revision };
  });
});


/** Authenticated resume samples authoritative time and reconciles a challenge before the client refreshes its projection. */
export const resumeRoom = onCall(callable, async (request) => {
  const actor = uid(request);
  const id = roomId(request.data?.roomId);
  return database.runTransaction(async (tx) => {
    const ref = database.doc(`rooms/${id}`);
    const [raw, own, memberDocs] = await Promise.all([tx.get(ref), tx.get(ref.collection("members").doc(actor)), tx.get(ref.collection("members"))]);
    if (!raw.exists || !own.exists) throw new HttpsError("permission-denied", "Not a room member.");
    const room = raw.data() as CanonicalRoom;
    const member = own.data() as CanonicalMember;
    if (!member.active || member.uid !== actor) throw new HttpsError("permission-denied", "Not an active room member.");
    if (room.config.challenge) {
      const offered = challengeCapabilityOffer(request.data?.challenge);
      if (!offered || offered.protocolVersion !== room.config.challenge.protocolVersion || !room.config.challenge.mechanics.every((mechanic) => offered.mechanics.includes(mechanic)) || !(room.config.challenge.definitionSchemas ?? ["t36-challenge-definition-v1"]).every((schema) => offered.definitionSchemas.includes(schema)))
        throw new HttpsError("failed-precondition", "CHALLENGE_PROTOCOL_REQUIRED");
    }
    if (isRoomClosed(room)) throw new HttpsError("failed-precondition", "Room is closed.");
    const members = memberDocs.docs.map((item) => item.data() as CanonicalMember);
    let next = expiring(room);
    let definition: import("../../src/features/game/challenges/definition.js").CanonicalChallengeDefinition | undefined;
    if (room.challenge && room.activeQuestion?.challenge) {
      definition = await pinnedChallengeDefinition(tx, room.activeQuestion);
      const state = restoreChallengeState(room.challenge);
      const reconciled = reconcileChallengeDeadline(definition, state, now());
      if (reconciled !== state) {
        let game = room.game;
        let bridge = room.challengeBridge;
        if (reconciled.result === "correct" && game.activeCellId) {
          const bridged = applyChallengeAward(reconciled, game, bridge ?? createChallengeBridgeContext(reconciled.occurrence, game.activeCellId));
          game = bridged.game;
          bridge = bridged.context;
        }
        next = { ...room, revision: room.revision + 1, game, challenge: compactChallengeState(reconciled), challengeBridge: bridge, updatedAt: FieldValue.serverTimestamp() };
      }
    }
    if (next !== room) {
      tx.set(ref, next);
      tx.create(ref.collection("events").doc(String(next.revision).padStart(12, "0")), { type: "CHALLENGE_RESUME_RECONCILE", actorUid: "server", revision: next.revision, createdAt: FieldValue.serverTimestamp() });
      writes(tx, id, next, members, definition);
    }
    return { revision: next.revision, serverTime: new Date(now()).toISOString() };
  });
});

/** Private per-device lease. This never writes canonical game state or projections. */
export const renewPresence = onCall(callable, async (request) => {
  const actor = uid(request);
  let id: string;
  try {
    id = exactPresenceRoomId(request.data);
  } catch (reason) {
    return error(reason);
  }
  return database.runTransaction(async (tx) => {
    const ref = database.doc(`rooms/${id}`);
    const memberRef = ref.collection("members").doc(actor);
    const leaseRef = ref.collection("presence").doc(actor);
    const [raw, memberRaw, leaseRaw] = await Promise.all([
      tx.get(ref),
      tx.get(memberRef),
      tx.get(leaseRef),
    ]);
    if (!raw.exists || !memberRaw.exists)
      throw new HttpsError("permission-denied", "Not a room member.");
    const room = raw.data() as CanonicalRoom;
    const member = memberRaw.data() as CanonicalMember;
    if (isRoomClosed(room) || !member.active || member.role !== "player" || member.uid !== actor)
      throw new HttpsError("failed-precondition", "Presence is unavailable.");
    const currentTime = now();
    const existing = leaseRaw.data();
    const previousUpdate = existing?.updatedAtMs;
    if (
      typeof previousUpdate === "number" &&
      currentTime - previousUpdate < PRESENCE_HEARTBEAT_MS
    )
      return { expiresAtMs: existing?.expiresAtMs, accepted: false };
    const expiresAtMs = currentTime + PRESENCE_LEASE_MS;
    tx.set(leaseRef, { uid: actor, updatedAtMs: currentTime, expiresAtMs });
    return { expiresAtMs, accepted: true };
  });
});

/** Host-only bounded read; clients cannot access the private lease collection directly. */
export const getRoomPresence = onCall(callable, async (request) => {
  const actor = uid(request);
  let id: string;
  try {
    id = exactPresenceRoomId(request.data);
  } catch (reason) {
    return error(reason);
  }
  const ref = database.doc(`rooms/${id}`);
  const [raw, memberRaw] = await Promise.all([
    ref.get(),
    ref.collection("members").doc(actor).get(),
  ]);
  if (!raw.exists || !memberRaw.exists)
    throw new HttpsError("permission-denied", "Not a room member.");
  const room = raw.data() as CanonicalRoom;
  const requester = memberRaw.data() as CanonicalMember;
  if (isRoomClosed(room) || !requester.active || requester.role !== "host" || requester.uid !== actor)
    throw new HttpsError("permission-denied", "Host presence is unavailable.");
  const playerDocs = await ref.collection("members")
    .where("role", "==", "player")
    .where("active", "==", true)
    .limit(MAX_PLAYERS + 1)
    .get();
  if (playerDocs.docs.length > MAX_PLAYERS)
    throw new HttpsError("failed-precondition", "Invalid player roster.");
  const players = playerDocs.docs.map((document) => {
    const member = document.data() as CanonicalMember;
    if (member.uid !== document.id || !member.active || member.role !== "player")
      throw new HttpsError("failed-precondition", "Invalid player roster.");
    return member;
  });
  const leaseDocs = await Promise.all(
    players.map((member) => ref.collection("presence").doc(member.uid).get()),
  );
  const currentTime = now();
  return {
    roomId: id,
    serverTime: new Date(currentTime).toISOString(),
    players: Object.fromEntries(
      players.map((member, index) => {
        const lease = leaseDocs[index].data();
        return [member.uid, {
          state: leaseState(lease, currentTime),
          ...(typeof lease?.updatedAtMs === "number"
            ? { lastSeen: new Date(lease.updatedAtMs).toISOString() }
            : {}),
        }];
      }),
    ),
  };
});

export const submitGameIntent = onCall(releaseReaderCallable, async (request) => {
  const actor = uid(request);
  let id: string;
  const intent = request.data?.intent;
  try {
    id = roomId(request.data?.roomId);
    if (!validIntent(intent)) throw new Error("invalid-intent");
  } catch (reason) {
    return error(reason);
  }
  const manualParticipantId = intent.type === "LOBBY_ADD_MANUAL_PLAYER" ? randomUUID() : undefined;
  return database.runTransaction(async (tx) => {
    const ref = database.doc(`rooms/${id}`);
    const memberRef = ref.collection("members").doc(actor);
    const receiptRef = ref
      .collection("intentReceipts")
      .doc(intentReceiptId(actor, intent.intentId));
    const [raw, memberRaw, receiptRaw, memberDocs] = await Promise.all([
      tx.get(ref),
      tx.get(memberRef),
      tx.get(receiptRef),
      tx.get(ref.collection("members")),
    ]);
    if (!raw.exists || !memberRaw.exists)
      throw new HttpsError("permission-denied", "Not a room member.");
    const member = memberRaw.data() as CanonicalMember;
    const members = memberDocs.docs.map((item) => item.data() as CanonicalMember);
    if (!member.active || member.uid !== actor)
      throw new HttpsError("permission-denied", "Not an active room member.");
    const receiptHash = intentHash(intent);
    let room = expiring(raw.data() as CanonicalRoom);
    if (isRoomClosed(room))
      throw new HttpsError("failed-precondition", "Room is closed.");
    if (room.challenge && room.activeQuestion?.challenge) {
      const definition = await pinnedChallengeDefinition(tx, room.activeQuestion);
      const current = restoreChallengeState(room.challenge);
      const reconciled = reconcileChallengeDeadline(definition, current, now());
      if (reconciled !== current) {
        let game = room.game;
        let bridge = room.challengeBridge;
        if (reconciled.result === "correct" && game.activeCellId) {
          const bridged = applyChallengeAward(reconciled, game, bridge ?? createChallengeBridgeContext(reconciled.occurrence, game.activeCellId));
          game = bridged.game; bridge = bridged.context;
        }
        const next = { ...room, revision: room.revision + 1, game, challenge: compactChallengeState(reconciled), challengeBridge: bridge, updatedAt: FieldValue.serverTimestamp() };
        tx.set(ref, next);
        tx.create(ref.collection("events").doc(String(next.revision).padStart(12, "0")), { type: "CHALLENGE_SERVER_DEADLINE", actorUid: "server", revision: next.revision, createdAt: FieldValue.serverTimestamp() });
        writes(tx, id, next, members, definition);
        return { revision: next.revision, replayed: false, stale: true };
      }
    }
    if (receiptRaw.exists) {
      if (receiptRaw.data()?.requestHash !== receiptHash)
        throw new HttpsError("already-exists", "Intent id was reused with a different request.");
      return { revision: receiptRaw.data()?.revision, replayed: true };
    }
    if (intent.type.startsWith("CHALLENGE_")) {
      if (intent.expectedRevision !== room.revision) return { revision: room.revision, replayed: false, stale: true };
      if (!room.challenge || !room.activeQuestion?.challenge || !room.activeQuestionOccurrence)
        throw new HttpsError("failed-precondition", "CHALLENGE_NOT_ACTIVE");
      const definition = await pinnedChallengeDefinition(tx, room.activeQuestion);
      const hostUid = members.find((candidate) => candidate.active && candidate.role === "host")?.uid;
      if (!hostUid) throw new HttpsError("failed-precondition", "CHALLENGE_HOST_MISSING");
      const runtime = firebaseChallengeRuntime(room, definition.definitionSha256, hostUid);
      const current = restoreChallengeState(room.challenge);
      const nextState = reduceChallenge(definition, current, firebaseChallengeIntent(intent, actor, receiptHash), firebaseChallengeParticipants(room, members, hostUid), runtime);
      if (nextState === current) throw new HttpsError("failed-precondition", "CHALLENGE_INTENT_REJECTED");
      let game = room.game;
      let challengeBridge = room.challengeBridge;
      if (nextState.result === "correct" && game.activeCellId) {
        const bridged = applyChallengeAward(nextState, game, challengeBridge ?? createChallengeBridgeContext(nextState.occurrence, game.activeCellId));
        game = bridged.game; challengeBridge = bridged.context;
      } else if (nextState.continued && nextState.result !== "correct" && game.activeCellId) {
        const continuedCellId = game.activeCellId;
        if (roomGameKind(room) === "categories") {
          room = await replaceFailedCell(tx, room);
          game = room.game;
        }
        const bridged = applyChallengeContinuation(nextState, game, challengeBridge ?? createChallengeBridgeContext(nextState.occurrence, continuedCellId));
        game = bridged.game; challengeBridge = bridged.context;
      }
      const next = { ...room, revision: room.revision + 1, game, challenge: compactChallengeState(nextState), challengeBridge, updatedAt: FieldValue.serverTimestamp() };
      tx.set(ref, next);
      tx.create(ref.collection("events").doc(String(next.revision).padStart(12, "0")), { type: intent.type, actorUid: actor, revision: next.revision, createdAt: FieldValue.serverTimestamp() });
      tx.create(receiptRef, { revision: next.revision, requestHash: receiptHash, createdAt: FieldValue.serverTimestamp() });
      writes(tx, id, next, members, definition);
      return { revision: next.revision, replayed: false };
    }
    let question: CanonicalQuestion | undefined;
    let challengeDefinition: import("../../src/features/game/challenges/definition.js").CanonicalChallengeDefinition | undefined;
    let surpriseLetter: string | undefined;
    let letters: string[] | undefined;
    const gameKind = roomGameKind(room);
    const charades = room.config.modality === "charades";
    const selectionBefore = structuredClone(room);
    let result: ReturnType<typeof reduceIntent> | undefined;
    let createdContentHold = false;
    // This runs after actor/hash receipt replay, but before every operation that
    // can allocate or prepare pinned content. A rejected request must never
    // persist the depletion-hold exception path.
    try {
      preflightContentPreparation(room, member, intent, members);
    } catch (reason) {
      return error(reason);
    }
    try {
    if (intent.type === "RETRY_CELL" && room.game.lifecycle === "QUESTION_FAILED" && !charades) {
      room = await retryFailedCell(tx, room);
      ({ question } = await pinnedQuestion(tx, room));
    }
    if (intent.type === "RETURN_CELL" && room.game.lifecycle === "QUESTION_FAILED" && !charades)
      room = await replaceFailedCell(tx, room);
    if (intent.type === "LETTER_REVEALED") {
      const active = room.game.board?.cells.find(
        (cell) => cell.id === room.game.activeCellId,
      );
      if (active?.kind === "surprise" && !active.revealedLetter)
        ({ question, surpriseLetter } = await pinnedQuestion(tx, room));
      else question = room.activeQuestion;
    }
    if (!charades && intent.type === "SELECT_CELL") {
      const cellId = intent.payload.cellId as string;
      ({ question, surpriseLetter } = await pinnedQuestion(tx, room, cellId));
    }
    if (
      charades &&
      (intent.type === "START_MATCH" || intent.type === "START_NEXT_ROUND")
    )
      ({ question } = await pinnedQuestion(tx, room));
    if (
      !charades &&
      (intent.type === "START_MATCH" || intent.type === "START_NEXT_ROUND")
    ) {
      if (intent.type !== "START_MATCH") releaseRoundReservations(room);
      const releaseQuestionsForBoard = await releaseQuestions(tx, room);
      if (gameKind === "categories") {
          releaseCategorySelection(releaseQuestionsForBoard, room, intent.type === "START_NEXT_ROUND");
      } else letters = releaseLetters(releaseQuestionsForBoard, room);
      if (gameKind !== "categories" && (!letters || letters.length < 25))
        throw new HttpsError(
          "failed-precondition",
          "Pinned release has insufficient 16 visible + 9 surprise coverage.",
        );
    }
    try {
      result = reduceIntent(
        room,
        member,
        intent,
        now(),
        question,
        members,
        letters,
        surpriseLetter,
        manualParticipantId,
      );
    } catch (reason) {
      return error(reason);
    } } catch (reason) {
      if (isContentDepleted(reason) && ['SELECT_CELL', 'LETTER_REVEALED', 'RETRY_CELL', 'RETURN_CELL', 'START_NEXT_ROUND'].includes(intent.type)) {
        room = contentHold(selectionBefore, intent.type === 'START_NEXT_ROUND' ? 'START_NEXT_ROUND' : intent.type === 'SELECT_CELL' || intent.type === 'LETTER_REVEALED' ? 'SELECT_CELL' : 'CONTINUE', intent.type === 'SELECT_CELL' ? intent.payload.cellId as string : selectionBefore.game.activeCellId);
        createdContentHold = true;
      } else throw reason;
    }
    if (createdContentHold) {
      const held = { ...room, revision: room.revision + 1 };
      const next = { ...held, updatedAt: FieldValue.serverTimestamp() };
      tx.set(ref, next); tx.set(memberRef, member);
      tx.create(ref.collection('events').doc(String(next.revision).padStart(12, '0')), { type: 'CONTENT_HOLD', actorUid: actor, revision: next.revision, createdAt: FieldValue.serverTimestamp() });
      tx.create(receiptRef, { revision: next.revision, requestHash: receiptHash, createdAt: FieldValue.serverTimestamp() });
      writes(tx, id, next, members);
      return { revision: next.revision, replayed: false };
    }
    if (!result) throw new HttpsError('internal', 'Intent did not produce a result.');
    if (result.room.activeQuestion?.challenge && result.room.config.challenge) {
      challengeDefinition = await pinnedChallengeDefinition(tx, result.room.activeQuestion);
      if (!result.room.config.challenge.mechanics.includes(challengeDefinition.kind))
        throw new HttpsError("failed-precondition", "CHALLENGE_MECHANIC_NOT_NEGOTIATED");
      const hostUid = members.find((candidate) => candidate.active && candidate.role === "host")?.uid;
      if (!hostUid || !result.room.activeQuestionOccurrence || !result.room.game.activeCellId || !result.room.game.entitledTeam)
        throw new HttpsError("failed-precondition", "CHALLENGE_OCCURRENCE_UNAVAILABLE");
      if (challengeDefinition.kind === "navigation" && !members.some((candidate) => candidate.active && candidate.role === "player" && candidate.team === result.room.game.entitledTeam))
        throw new HttpsError("failed-precondition", "NAVIGATION_PRIVATE_GUIDE_REQUIRED");
      const runtime = firebaseChallengeRuntime(result.room, challengeDefinition.definitionSha256, hostUid);
      result.room.challenge = compactChallengeState(createChallengeState(challengeDefinition, result.room.activeQuestionOccurrence, result.room.game.entitledTeam, now(), runtime));
      result.room.challengeBridge = createChallengeBridgeContext(result.room.activeQuestionOccurrence, result.room.game.activeCellId);
      result.room.game = reduceGame(result.room.game, { type: "BUZZ_ACCEPTED", team: result.room.game.entitledTeam });
      result.room.timer = undefined;
      result.room.buzzWinner = undefined;
    }
    if (gameKind === "categories" && (intent.type === "START_MATCH" || intent.type === "START_NEXT_ROUND")) {
      result.room.categoryOccurrences = Object.fromEntries((result.room.game.board?.cells ?? []).reduce<Map<string, number>>((counts, cell) => counts.set(cell.categoryId!, Math.max(counts.get(cell.categoryId!) ?? 0, cell.categoryOccurrence ?? 0)), new Map()));
    }
    const next = { ...result.room, updatedAt: FieldValue.serverTimestamp() };
    const nextMembers = members.map((item) =>
      item.uid === actor
        ? result.member
        : item.uid === result.targetMember?.uid
          ? result.targetMember
          : item,
    );
    tx.set(ref, next);
    tx.set(memberRef, result.member);
    if (result.targetMember)
      tx.set(
        ref.collection("members").doc(result.targetMember.uid),
        result.targetMember,
      );
    tx.create(
      ref.collection("events").doc(String(next.revision).padStart(12, "0")),
      {
        type: result.eventType,
        actorUid: actor,
        revision: next.revision,
        createdAt: FieldValue.serverTimestamp(),
      },
    );
    tx.create(receiptRef, {
      revision: next.revision,
      requestHash: receiptHash,
      createdAt: FieldValue.serverTimestamp(),
    });
    writes(tx, id, next, nextMembers, challengeDefinition);
    return { revision: next.revision, replayed: false };
  });
});

/** Trusted reconciliation makes deadline expiry deterministic even if no player sends another intent. */
export const syncRoomDeadline = onCall(callable, async (request) => {
  const actor = uid(request);
  const id = roomId(request.data?.roomId);
  return database.runTransaction(async (tx) => {
    const ref = database.doc(`rooms/${id}`);
    const [raw, memberRaw, memberDocs] = await Promise.all([
      tx.get(ref),
      tx.get(ref.collection("members").doc(actor)),
      tx.get(ref.collection("members")),
    ]);
    if (!raw.exists) throw new HttpsError("not-found", "Room not found.");
    if (
      !memberRaw.exists ||
      (memberRaw.data() as CanonicalMember).active !== true
    )
      throw new HttpsError("permission-denied", "Not an active room member.");
    const current = raw.data() as CanonicalRoom;
    if (isRoomClosed(current)) throw new HttpsError("failed-precondition", "Room is closed.");
    let definition: import("../../src/features/game/challenges/definition.js").CanonicalChallengeDefinition | undefined;
    let next = expireRoom(current, now());
    if (current.challenge && current.activeQuestion?.challenge) {
      definition = await pinnedChallengeDefinition(tx, current.activeQuestion);
      const state = restoreChallengeState(current.challenge);
      const reconciled = reconcileChallengeDeadline(definition, state, now());
      if (reconciled !== state) {
        let game = current.game;
        let bridge = current.challengeBridge;
        if (reconciled.result === "correct" && game.activeCellId) {
          const bridged = applyChallengeAward(reconciled, game, bridge ?? createChallengeBridgeContext(reconciled.occurrence, game.activeCellId));
          game = bridged.game; bridge = bridged.context;
        }
        next = { ...current, revision: current.revision + 1, game, challenge: compactChallengeState(reconciled), challengeBridge: bridge };
      }
    }
    if (next === current) return { revision: current.revision, expired: false };
    const stamped = { ...next, updatedAt: FieldValue.serverTimestamp() };
    tx.set(ref, stamped);
    const members = memberDocs.docs.map(
      (item) => item.data() as CanonicalMember,
    );
    writes(tx, id, stamped, members, definition);
    return { revision: stamped.revision, expired: true };
  });
});

/** Authenticated callable byte delivery; no Storage URL is exposed to a browser. */
export const getCurrentQuestionMedia = onCall(callable, async (request) => {
  const actor = uid(request);
  const data = request.data;
  let id: string;
  try { id = roomId(data?.roomId); } catch (reason) { return error(reason); }
  const authorizeFresh = async () => database.runTransaction(async (tx) => {
    const ref = database.doc(`rooms/${id}`);
    const [raw, memberRaw, memberDocs] = await Promise.all([tx.get(ref), tx.get(ref.collection('members').doc(actor)), tx.get(ref.collection('members'))]);
    if (!raw.exists || !memberRaw.exists) throw new HttpsError('permission-denied', 'Not a room member.');
    try {
      const room = raw.data() as CanonicalRoom;
      return { ...authorizeCurrentQuestionMedia(id, room, memberDocs.docs.map((item) => item.data() as CanonicalMember), actor, data), occurrence: room.activeQuestionOccurrence, disclosureOccurrence: room.answerRevealedOccurrence };
    }
    catch (reason) { throw new HttpsError('permission-denied', reason instanceof Error ? reason.message : 'media-not-visible'); }
  });
  const binding = await authorizeFresh();
  permitMediaIssue(actor, id);
  // The release-owned binding is immutable. It supplies the only object name and
  // generation accepted by this callable; request input never supplies a path.
  const room = (await database.doc(`rooms/${id}`).get()).data() as CanonicalRoom | undefined;
  const releaseId = room?.config.releaseId;
  if (typeof releaseId !== 'string') throw new HttpsError('failed-precondition', 'Invalid pinned release.');
  const releaseMedia = await database.doc(`releases/${releaseId}/media/${binding.mediaId}`).get();
  const item = releaseMedia.data();
  const video = binding.type === 'video' || room?.activeQuestion?.modality === 'video';
  const rebuiltJpeg = !video && binding.contentType === 'image/jpeg' && /^rebuild-v2-photo-\d{3}-\d{3}$/.test(binding.mediaId);
  const contentType = video ? 'video/mp4' : rebuiltJpeg ? 'image/jpeg' : 'image/png';
  const expectedObjectName = expectedReleaseMediaObjectName(binding.mediaId, binding.assetSha256, video, rebuiltJpeg);
  if (!releaseMedia.exists || item?.mediaId !== binding.mediaId || item?.assetSha256 !== binding.assetSha256 || item?.objectName !== expectedObjectName || item?.contentType !== contentType || item?.immutable !== true || typeof item?.generation !== 'string' || !/^[1-9][0-9]*$/.test(item.generation)) throw new HttpsError('failed-precondition', 'Immutable media binding is unavailable.');
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    const url = await readWithFinalMediaAuthorization(binding, () => emulatorCurrentQuestionMediaUrl(binding), authorizeFresh)
      .catch((reason) => { throw new HttpsError('permission-denied', reason instanceof Error ? reason.message : 'Media authorization changed.'); });
    return { mediaId: binding.mediaId, assetSha256: binding.assetSha256, url, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  }
  const file = getStorage().bucket().file(item.objectName, { generation: item.generation });
  const [metadataResponse, downloaded] = await readWithFinalMediaAuthorization(binding, () => Promise.all([file.getMetadata(), file.download()]), authorizeFresh)
    .catch((reason) => { throw new HttpsError('permission-denied', reason instanceof Error ? reason.message : 'Media authorization changed.'); });
  const metadata = metadataResponse[0], bytes = downloaded[0];
  if (metadata.generation !== item.generation || metadata.metadata?.assetSha256 !== binding.assetSha256 || metadata.contentType !== contentType || bytes.length > 1_000_000 || createHash('sha256').update(bytes).digest('hex') !== binding.assetSha256) throw new HttpsError('failed-precondition', 'Immutable media generation mismatch.');
  if (video && bytes.subarray(4, 8).toString('ascii') !== 'ftyp') throw new HttpsError('failed-precondition', 'Immutable media format mismatch.');
  if (rebuiltJpeg && !bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) throw new HttpsError('failed-precondition', 'Immutable media format mismatch.');
  if (!video && !rebuiltJpeg && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new HttpsError('failed-precondition', 'Immutable media format mismatch.');
  return { mediaId: binding.mediaId, assetSha256: binding.assetSha256, url: `data:${contentType};base64,${bytes.toString('base64')}`, expiresAt: new Date(Date.now() + 60_000).toISOString() };
});
