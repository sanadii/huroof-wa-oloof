import { createHash } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldPath, FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/https";
import { reduceGame } from "../../../src/features/game/domain/lifecycle.js";
import { applyChallengeAward, createChallengeBridgeContext } from "../../../src/features/game/challenges/award-bridge.js";
import { compactChallengeState, parseChallengeDefinitionEnvelope, restoreChallengeState, type ChallengeDefinitionEnvelope } from "../../../src/features/game/challenges/integration.js";
import { reconcileChallengeDeadline } from "../../../src/features/game/challenges/engine.js";
import { projectRoom, type CanonicalMember, type CanonicalQuestion, type CanonicalRoom } from "../game.js";

if (!getApps().length) initializeApp();
const db = getFirestore();
const auth = getAuth();
const region = process.env.FUNCTIONS_REGION || "me-central1";
const callable = { region, enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true" } as const;
const roles = ["super_admin", "content_admin", "reviewer", "game_ops", "viewer"] as const;
type Role = (typeof roles)[number];
type Capability = "session" | "questions.read" | "questions.write" | "reviews.read" | "reviews.decide" | "categories.read" | "categories.write" | "releases.read" | "releases.stage" | "rooms.read" | "rooms.act" | "users.read" | "users.write" | "audit.read" | "health.read" | "settings.read" | "settings.write";
const capabilities: Record<Role, readonly Capability[]> = {
  super_admin: ["session", "questions.read", "questions.write", "reviews.read", "reviews.decide", "categories.read", "categories.write", "releases.read", "releases.stage", "rooms.read", "rooms.act", "users.read", "users.write", "audit.read", "health.read", "settings.read", "settings.write"],
  content_admin: ["session", "questions.read", "questions.write", "reviews.read", "categories.read", "categories.write", "releases.read", "releases.stage", "audit.read", "health.read", "settings.read"],
  reviewer: ["session", "questions.read", "reviews.read", "reviews.decide", "categories.read", "audit.read", "health.read"],
  game_ops: ["session", "rooms.read", "rooms.act", "audit.read", "health.read"],
  viewer: ["session", "questions.read", "reviews.read", "categories.read", "releases.read", "rooms.read", "audit.read", "health.read", "settings.read"],
};
export function sameAdminAuthorization(liveRoles: readonly string[], claimRoles: readonly string[], liveVersion: number, claimVersion: unknown) {
  return liveVersion === claimVersion && liveRoles.length === claimRoles.length && liveRoles.every(role => claimRoles.includes(role));
}
export function isVerifiedAdminProvider(provider: unknown, emailVerified: unknown) {
  return emailVerified === true && (provider === "google.com" || provider === "password");
}
export function publishedQuestionMediaBinding(question: Record<string, unknown>, variant: unknown) {
  if (variant !== "question" && variant !== "answer") throw new HttpsError("invalid-argument", "Invalid media variant.");
  const raw = question[variant === "question" ? "media" : "answerMedia"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpsError("not-found", "Requested published media is not available.");
  const media = raw as Record<string, unknown>;
  // Release media IDs use colon-delimited variants (for example goal blur/clean
  // pairs). Keep the path boundary closed: slashes and dot segments are invalid.
  if (typeof media.mediaId !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/.test(media.mediaId) || typeof media.assetSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(media.assetSha256)) throw new HttpsError("failed-precondition", "Published media binding is invalid.");
  return { mediaId: media.mediaId, assetSha256: media.assetSha256, type: media.type === "video" ? "video" : "image", altAr: typeof media.altAr === "string" ? media.altAr : null } as const;
}
const maxPageSize = 100;
const id = (value: unknown, name = "id") => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new HttpsError("invalid-argument", `Invalid ${name}.`);
  return value;
};
const optionalId = (value: unknown, name = "id") => value === undefined ? undefined : id(value, name);
const text = (value: unknown, name: string, max = 4000) => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new HttpsError("invalid-argument", `Invalid ${name}.`);
  return value.trim();
};
const integer = (value: unknown, name: string, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new HttpsError("invalid-argument", `Invalid ${name}.`);
  return value as number;
};
const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : (() => { throw new HttpsError("invalid-argument", "Expected an object."); })();
function only(data: Record<string, unknown>, keys: readonly string[]) {
  for (const key of Object.keys(data)) if (!keys.includes(key)) throw new HttpsError("invalid-argument", `Unsupported field: ${key}.`);
}
function listInput(value: unknown) {
  const data = object(value ?? {}); only(data, ["limit", "cursor", "status", "categoryId", "query", "modality", "releaseId"]);
  const limit = data.limit === undefined ? 25 : integer(data.limit, "limit", 1, maxPageSize);
  return { limit, cursor: optionalId(data.cursor, "cursor"), status: typeof data.status === "string" ? data.status.slice(0, 64) : undefined, categoryId: typeof data.categoryId === "string" ? id(data.categoryId, "categoryId") : undefined, query: typeof data.query === "string" ? data.query.trim().slice(0, 120) : undefined, modality: typeof data.modality === "string" ? data.modality.slice(0, 64) : undefined, releaseId: optionalId(data.releaseId, "releaseId") };
}
function mutationEnabled() { return process.env.FUNCTIONS_EMULATOR === "true" || process.env.ADMIN_MUTATIONS_ENABLED === "true"; }
function productionBlocked() { if (!mutationEnabled()) throw new HttpsError("failed-precondition", "Admin mutations are staged and disabled in this environment."); }
/** This narrow gate deliberately does not enable the general admin mutation surface. */
export function categoryCorrectionDraftsEnabled(environment: NodeJS.ProcessEnv = process.env) { return environment.FUNCTIONS_EMULATOR === "true" || environment.ADMIN_CATEGORY_CORRECTION_DRAFTS_ENABLED === "true"; }
function categoryCorrectionDraftsBlocked() { if (!categoryCorrectionDraftsEnabled()) throw new HttpsError("failed-precondition", "Category correction drafts are staged and disabled in this environment."); }
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}
export function canonicalAdminHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}
type Principal = { uid: string; roles: Role[]; claimRoles: Role[]; authzVersion: number; claimAuthzVersion: unknown; requestHash: string; categoryScopes?: string[]; reviewerScopes?: string[] };
async function principal(request: CallableRequest<unknown>, capability: Capability): Promise<Principal> {
  const uid = request.auth?.uid;
  const token = request.auth?.token as Record<string, unknown> | undefined;
  const provider = token?.firebase && typeof token.firebase === "object" ? (token.firebase as Record<string, unknown>).sign_in_provider : undefined;
  if (!uid || !isVerifiedAdminProvider(provider, token?.email_verified)) throw new HttpsError("unauthenticated", "A verified Google or email/password identity is required for administration.");
  const snap = await db.doc(`adminPrincipals/${uid}`).get();
  const row = snap.data();
  if (!snap.exists || row?.enabled !== true || row.identityReady !== true || !Array.isArray(row.roles) || !Number.isInteger(row.authzVersion)) throw new HttpsError("permission-denied", "No synchronized enabled administrator registry record.");
  const liveRoles = row.roles.filter((role: unknown): role is Role => typeof role === "string" && (roles as readonly string[]).includes(role));
  const claimRoles = Array.isArray(token?.adminRoles) ? token.adminRoles.filter((role): role is Role => typeof role === "string" && (roles as readonly string[]).includes(role)) : [];
  if (!sameAdminAuthorization(liveRoles, claimRoles, row.authzVersion, token?.authzVersion)) throw new HttpsError("permission-denied", "Administrative authorization is stale. Refresh your Google session.");
  if (!liveRoles.some((role) => capabilities[role].includes(capability))) throw new HttpsError("permission-denied", "Missing administrative capability.");
  return { uid, roles: liveRoles, claimRoles, authzVersion: row.authzVersion, claimAuthzVersion: token?.authzVersion, requestHash: canonicalAdminHash(request.data ?? {}), categoryScopes: Array.isArray(row.categoryScopes) ? row.categoryScopes.filter((v: unknown): v is string => typeof v === "string") : [], reviewerScopes: Array.isArray(row.reviewerScopes) ? row.reviewerScopes.filter((v: unknown): v is string => typeof v === "string") : [] };
}
function requireRole(actor: Principal, role: Role) { if (!actor.roles.includes(role)) throw new HttpsError("permission-denied", "This action requires super administrator authority."); }
function scopeCategory(actor: Principal, categoryId: string) { if (!actor.roles.includes("super_admin") && (!actor.categoryScopes?.includes(categoryId))) throw new HttpsError("permission-denied", "Category is outside your assigned scope."); }
function scopeReviewer(actor: Principal, categoryId: string, specialistRoles: unknown) { scopeCategory(actor, categoryId); if (actor.roles.includes("super_admin")) return; if (!actor.roles.includes("reviewer") || !Array.isArray(specialistRoles) || specialistRoles.some(role => typeof role !== "string" || !actor.reviewerScopes?.includes(role))) throw new HttpsError("permission-denied", "Reviewer qualifications do not cover this modality."); }
const specialistRolesByModality = {
  classic: ["fact_reviewer", "language_reviewer"],
  image: ["fact_reviewer", "language_reviewer", "image_rights_reviewer"],
  charades: ["fact_reviewer", "language_reviewer", "charades_performance_reviewer", "charades_originality_reviewer", "charades_cultural_suitability_reviewer"],
} as const;
const specialistRoleSet = new Set<string>(Object.values(specialistRolesByModality).flat());
function scopedIdList(value: unknown, name: string, reviewer = false) { if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== "string" || (reviewer ? !specialistRoleSet.has(item) : !/^[A-Za-z0-9_-]{1,128}$/.test(item)))) throw new HttpsError("invalid-argument", `Invalid ${name}.`); return [...new Set(value as string[])].sort(); }
export function validateAdminQuestionDraft(draft: Record<string, unknown>) {
  const modality = draft.modality;
  if (modality !== "classic" && modality !== "image" && modality !== "charades") throw new HttpsError("invalid-argument", "Invalid modality.");
  const requiredRoles = specialistRolesByModality[modality];
  if (!Array.isArray(draft.specialistRoles) || draft.specialistRoles.length !== requiredRoles.length || [...draft.specialistRoles].sort().join("|") !== [...requiredRoles].sort().join("|")) throw new HttpsError("invalid-argument", "specialistRoles must exactly match the v3.3 modality contract.");
  if (draft.sources !== undefined) {
    if (!Array.isArray(draft.sources) || draft.sources.length > 16) throw new HttpsError("invalid-argument", "sources must contain at most 16 records.");
    for (const rawSource of draft.sources) {
      const source = object(rawSource);
      only(source, ["sourceUrl", "publisher", "title", "sourceTier", "retrievedAt"]);
      const sourceUrl = text(source.sourceUrl, "sourceUrl", 2048);
      let parsed: URL;
      try { parsed = new URL(sourceUrl); } catch { throw new HttpsError("invalid-argument", "sourceUrl must be a valid HTTPS URL."); }
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new HttpsError("invalid-argument", "sourceUrl must be a credential-free HTTPS URL.");
      text(source.publisher, "publisher", 240);
      text(source.title, "title", 500);
      text(source.sourceTier, "sourceTier", 64);
      if (source.retrievedAt !== undefined && (typeof source.retrievedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(source.retrievedAt) || Number.isNaN(Date.parse(source.retrievedAt)))) throw new HttpsError("invalid-argument", "retrievedAt must be an ISO timestamp.");
    }
  }
}
export function questionReviewBinding(value: Record<string, unknown>, revision: number) {
  return canonicalAdminHash({ revision, authorUid: value.authorUid, categoryId: value.categoryId, modality: value.modality, headerAr: value.headerAr, promptAr: value.promptAr, canonicalAnswer: value.canonicalAnswer, acceptedAnswers: value.acceptedAnswers, specialistRoles: value.specialistRoles, sources: value.sources ?? [] });
}
export function reviewMatchesQuestion(review: Record<string, unknown>, question: Record<string, unknown>) { return review.status === "in_review" && question.status === "in_review" && question.revision === review.questionRevision && questionReviewBinding(question, Number(review.questionRevision)) === review.questionHash; }
export function isArchivableQuestionStatus(status: unknown) { return status === "draft" || status === "ready_for_review" || status === "changes_requested"; }
export function adminRoomDto(id: string, data: Record<string, unknown>, includeMembers = false) { const game = data.game && typeof data.game === "object" ? data.game as Record<string, unknown> : {}; const config = data.config && typeof data.config === "object" ? data.config as Record<string, unknown> : {}; const lifecycle = data.lifecycle ?? game.lifecycle; return { id, revision: data.revision, lifecycle, memberCount: data.memberCount ?? (Array.isArray(data.members) ? data.members.filter(member => member && typeof member === "object" && (member as Record<string, unknown>).active === true).length : undefined), createdAt: data.createdAt ?? null, updatedAt: data.updatedAt ?? null, releaseId: data.releaseId ?? config.releaseId, roomCode: data.roomCode, paused: lifecycle === "PAUSED", closed: data.closed === true, currentRound: data.currentRound ?? game.currentRound, questionScores: data.questionScores ?? game.questionScores, teams: data.teams ?? config.teams, ...(includeMembers && Array.isArray(data.members) ? { members: data.members.map(member => { const value = object(member); return { uid: value.uid, displayName: value.displayName, role: value.role, team: value.team, ready: value.ready === true, active: value.active === true }; }) } : {}) }; }
const challengeDefinitionDigest = (json: string) => createHash("sha256").update(json).digest("hex");
async function reconcileAdminChallenge(tx: FirebaseFirestore.Transaction, room: CanonicalRoom) {
  if (!room.challenge || !room.activeQuestion?.challenge) return { room, definition: undefined };
  const question = room.activeQuestion as CanonicalQuestion;
  const reference = question.challenge?.definition;
  if (!reference) throw new HttpsError("failed-precondition", "CHALLENGE_DEFINITION_MISSING");
  const definitionDoc = await tx.get(db.doc(`challengeDefinitionSets/${reference.manifestSha256}/definitions/${reference.id}`));
  if (!definitionDoc.exists || definitionDoc.id !== reference.id) throw new HttpsError("failed-precondition", "CHALLENGE_DEFINITION_MISSING");
  let definition: import("../../../src/features/game/challenges/definition.js").CanonicalChallengeDefinition;
  try { definition = parseChallengeDefinitionEnvelope(definitionDoc.data() as ChallengeDefinitionEnvelope, challengeDefinitionDigest); }
  catch (reason) { throw new HttpsError("failed-precondition", reason instanceof Error ? reason.message : "CHALLENGE_DEFINITION_INVALID"); }
  const current = restoreChallengeState(room.challenge);
  const reconciled = reconcileChallengeDeadline(definition, current, Date.now());
  if (reconciled === current) return { room, definition };
  let game = room.game;
  let bridge = room.challengeBridge;
  if (reconciled.result === "correct" && game.activeCellId) {
    const awarded = applyChallengeAward(reconciled, game, bridge ?? createChallengeBridgeContext(reconciled.occurrence, game.activeCellId));
    game = awarded.game;
    bridge = awarded.context;
  }
  // The enclosing admin operation owns the one canonical revision and audit
  // event.  It must still project the reconciled challenge before its change.
  return { room: { ...room, game, challenge: compactChallengeState(reconciled), challengeBridge: bridge }, definition };
}
function writeRoomAdminViews(tx: FirebaseFirestore.Transaction, roomId: string, room: CanonicalRoom, members: CanonicalMember[], definition?: import("../../../src/features/game/challenges/definition.js").CanonicalChallengeDefinition) {
  tx.set(db.doc(`rooms/${roomId}/projections/audience`), projectRoom(roomId, room, members, "audience", undefined, Date.now(), definition));
  for (const member of members) { if (!member.active) continue; if (member.role === "host") tx.set(db.doc(`rooms/${roomId}/projections/host`), projectRoom(roomId, room, members, "host", member.uid, Date.now(), definition)); if (member.role === "player") tx.set(db.doc(`rooms/${roomId}/projections/player_${member.uid}`), projectRoom(roomId, room, members, "player", member.uid, Date.now(), definition)); }
  tx.set(db.doc(`adminRoomSummaries/${roomId}`), { revision: room.revision, roomCode: room.roomCode, lifecycle: room.game.lifecycle, releaseId: room.config.releaseId, memberCount: members.filter(member => member.active).length, closed: Boolean((room as CanonicalRoom & { closedAt?: unknown }).closedAt), currentRound: room.game.currentRound, questionScores: room.game.questionScores, teams: room.config.teams, members: members.map(member => ({ uid: member.uid, displayName: member.displayName, role: member.role, team: member.team ?? null, ready: member.ready, active: member.active })), updatedAt: FieldValue.serverTimestamp() });
}
async function page(collection: string, input: ReturnType<typeof listInput>, filters: Record<string, unknown> = {}, allowedCategories?: readonly string[]) {
  let query: FirebaseFirestore.Query = db.collection(collection);
  if (allowedCategories) {
    if (!allowedCategories.length) return { items: [], nextCursor: null };
    if (input.categoryId && !allowedCategories.includes(input.categoryId)) throw new HttpsError("permission-denied", "Category is outside your assigned scope.");
    if (!input.categoryId) {
      if (allowedCategories.length > 30) throw new HttpsError("failed-precondition", "Select one assigned category to page this inventory.");
      query = query.where("categoryId", "in", allowedCategories);
    }
  }
  for (const [field, value] of Object.entries(filters)) if (value !== undefined) query = query.where(field, "==", value);
  query = query.orderBy("updatedAt", "desc").limit(input.limit + 1);
  if (input.cursor) { const cursor = await db.doc(`${collection}/${input.cursor}`).get(); if (cursor.exists) { if (allowedCategories && !allowedCategories.includes(String(cursor.data()?.categoryId))) throw new HttpsError("permission-denied", "Cursor is outside your assigned scope."); query = query.startAfter(cursor); } }
  const rows = await query.get(); const docs = rows.docs.slice(0, input.limit);
  return { items: docs.map((doc) => ({ id: doc.id, ...doc.data() })), nextCursor: rows.docs.length > input.limit ? docs.at(-1)?.id : null };
}
async function pageBy(collection: string, input: ReturnType<typeof listInput>, field: string, filters: Record<string, unknown> = {}) {
  let query: FirebaseFirestore.Query = db.collection(collection);
  for (const [filterField, value] of Object.entries(filters)) if (value !== undefined) query = query.where(filterField, "==", value);
  query = query.orderBy(field, "desc").limit(input.limit + 1);
  if (input.cursor) { const cursor = await db.doc(`${collection}/${input.cursor}`).get(); if (cursor.exists) query = query.startAfter(cursor); }
  const rows = await query.get(); const docs = rows.docs.slice(0, input.limit);
  return { items: docs.map((doc) => ({ id: doc.id, ...doc.data() })), nextCursor: rows.docs.length > input.limit ? docs.at(-1)?.id : null };
}
async function pageIds(collection: string, input: ReturnType<typeof listInput>) {
  let query: FirebaseFirestore.Query = db.collection(collection).orderBy("__name__").limit(input.limit + 1);
  if (input.cursor) { const cursor = await db.doc(`${collection}/${input.cursor}`).get(); if (cursor.exists) query = query.startAfter(cursor); }
  const rows = await query.get(); const docs = rows.docs.slice(0, input.limit);
  return { items: docs.map(doc => ({ id: doc.id, ...doc.data() })), nextCursor: rows.docs.length > input.limit ? docs.at(-1)?.id ?? null : null };
}
async function mutate(actor: Principal, operationId: string, action: string, target: string, expectedRevision: number, fn: (tx: FirebaseFirestore.Transaction, operation: FirebaseFirestore.DocumentReference) => Promise<{ revision: number; status?: string }>) {
  productionBlocked();
  const operationRef = db.doc(`adminOperations/${operationId}`);
  return db.runTransaction(async (tx) => {
    // A category move or archive must be authorized against the stored record as
    // well as the submitted target category. Keeping this at the mutation
    // boundary prevents compressed handlers from accidentally bypassing it.
    if (action === "question.save" || action === "question.archive") {
      const stored = await tx.get(db.doc(`adminQuestionDrafts/${target}`));
      if (stored.exists) scopeCategory(actor, String(stored.data()!.categoryId));
    }
    const prior = await tx.get(operationRef);
    if (prior.exists) { const data = prior.data()!; if (data.actorUid !== actor.uid || data.action !== action || data.target !== target || data.requestHash !== actor.requestHash) throw new HttpsError("already-exists", "operationId was previously used for a different mutation payload."); return { operationId, revision: data.revision, replayed: true, serverTime: data.serverTime ?? null }; }
    const result = await fn(tx, operationRef);
    const serverTime = new Date().toISOString();
    const status = result.status ?? (action.startsWith("user.") ? "registry_committed" : "completed");
    if (action.startsWith("user.")) tx.set(db.doc(`adminPrincipals/${target}`), { identityReady: false, identityUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.create(operationRef, { actorUid: actor.uid, actorRoles: actor.roles, action, target, expectedRevision, revision: result.revision, status, serverTime, requestHash: actor.requestHash });
    tx.create(db.collection("adminAudit").doc(), { actorUid: actor.uid, actorRoles: actor.roles, operationId, action, target, expectedRevision, resultRevision: result.revision, result: status, requestHash: actor.requestHash, createdAt: FieldValue.serverTimestamp() });
    return { operationId, revision: result.revision, replayed: false, serverTime };
  });
}
async function enforceRateLimit(uid: string) { const now = Date.now(); const bucket = Math.floor(now / 60_000); const ref = db.doc(`adminRateLimits/${uid}_${bucket}`); await db.runTransaction(async tx => { const snap = await tx.get(ref); const count = Number(snap.data()?.count ?? 0); if (count >= 120) throw new HttpsError("resource-exhausted", "Administrative request rate exceeded."); tx.set(ref, { uid, bucket, count: count + 1, expiresAt: new Date(now + 5 * 60_000) }, { merge: true }); }); }
function call(capability: Capability, handler: (request: CallableRequest<unknown>, actor: Principal) => Promise<unknown>) { return onCall(callable, async request => { if (Buffer.byteLength(JSON.stringify(request.data ?? {}), "utf8") > 64 * 1024) throw new HttpsError("invalid-argument", "Administrative request is too large."); const actor = await principal(request, capability); await enforceRateLimit(actor.uid); return handler(request, actor); }); }

type ActiveRelease = { id: string; approvedCount: number; categoryCount: number | null; documentRootSha256: string };
/** Binds every published-content request to the one immutable runtime pointer. */
async function activeRelease(input?: { releaseId?: string; cursor?: string }): Promise<ActiveRelease> {
  if (input?.cursor && input.releaseId === undefined) throw new HttpsError("invalid-argument", "releaseId is required when continuing a published page.");
  const pointer = await db.doc("runtime/activeRelease").get();
  const releaseId = pointer.data()?.releaseId;
  if (!pointer.exists || typeof releaseId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(releaseId)) throw new HttpsError("failed-precondition", "No active immutable release.");
  if (input?.releaseId && input.releaseId !== releaseId) throw new HttpsError("aborted", "ACTIVE_RELEASE_CHANGED");
  const root = await db.doc(`releases/${releaseId}`).get();
  const data = root.data();
  if (!root.exists || data?.immutable !== true || !Number.isSafeInteger(data.approvedCount) || data.approvedCount < 0 || typeof data.documentRootSha256 !== "string") throw new HttpsError("failed-precondition", "Active release is incomplete or not immutable.");
  return { id: releaseId, approvedCount: data.approvedCount, categoryCount: Number.isSafeInteger(data.categoryCount) ? data.categoryCount : null, documentRootSha256: data.documentRootSha256 };
}
function publishedScope(actor: Principal, categoryId?: string) {
  // Preserve the existing fail-closed policy: only super admins are globally scoped.
  if (actor.roles.includes("super_admin")) return undefined;
  const scopes = [...new Set(actor.categoryScopes ?? [])].sort();
  if (categoryId && !scopes.includes(categoryId)) throw new HttpsError("permission-denied", "Category is outside your assigned scope.");
  if (!scopes.length) return [];
  if (!categoryId && scopes.length > 30) throw new HttpsError("failed-precondition", "Select one assigned category to page published content.");
  return categoryId ? [categoryId] : scopes;
}
function publishedMediaDto(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.mediaId !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/.test(item.mediaId) || typeof item.assetSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(item.assetSha256)) return null;
  const contentType = item.contentType === "image/png" || item.contentType === "image/jpeg" || item.contentType === "video/mp4" ? item.contentType : null;
  const type = item.type === "image" || item.type === "video" ? item.type : null;
  return { mediaId: item.mediaId, type, contentType, altAr: typeof item.altAr === "string" ? item.altAr : null, assetSha256: item.assetSha256 };
}
/** Explicit public-admin allowlist; never project release internals or storage routing. */
export function publishedQuestionDto(id: string, row: Record<string, unknown>, detail = false) {
  return {
    id, categoryId: row.categoryId, modality: row.modality, headerAr: row.headerAr, promptAr: row.promptAr, targetLetter: row.targetLetter ?? null,
    ...(detail ? {
      canonicalAnswer: row.canonicalAnswer,
      acceptedAnswers: Array.isArray(row.acceptedAnswers) ? row.acceptedAnswers.filter(answer => typeof answer === "string") : [],
      media: publishedMediaDto(row.media), answerMedia: publishedMediaDto(row.answerMedia),
      points: typeof row.points === "number" && Number.isFinite(row.points) ? row.points : null,
      difficulty: typeof row.difficulty === "string" && row.difficulty.trim() ? row.difficulty.trim() : null,
    } : {}),
  };
}
async function publishedCategoryDto(releaseId: string, snapshot: FirebaseFirestore.DocumentSnapshot) {
  const value = snapshot.data() ?? {};
  const inventory = await db.doc(`releases/${releaseId}/inventory/${snapshot.id}`).get();
  const count = inventory.data()?.approvedCount;
  const readiness = value.runtimeReadiness && typeof value.runtimeReadiness === "object" ? value.runtimeReadiness as Record<string, unknown> : {};
  return { id: snapshot.id, labelAr: value.labelAr ?? value.displayNameAr ?? snapshot.id, runtimeReadiness: { huroof: readiness.huroof === true, categories: readiness.categories === true, charades: readiness.charades === true }, approvedCount: Number.isSafeInteger(count) ? count : 0, uniqueAnswerConceptCount: Number.isSafeInteger(inventory.data()?.uniqueAnswerConceptCount) ? inventory.data()!.uniqueAnswerConceptCount : null };
}

type CategoryCorrectionBaseline = { categoryId: string; releaseId: string; releaseRootSha256: string; publishedLabelAr: string; correctionRef: FirebaseFirestore.DocumentReference };
type LiveCorrectionPrincipal = { roles: Role[]; categoryScopes: string[] };

/** The correction form is intentionally limited to a proposed label and private operational note. */
export function categoryCorrectionDraftInput(value: unknown) {
  const draft = object(value); only(draft, ["proposedLabelAr", "internalNote"]);
  return { proposedLabelAr: text(draft.proposedLabelAr, "proposedLabelAr", 160), internalNote: text(draft.internalNote, "internalNote", 2000) };
}
export function canManageCategoryCorrection(live: LiveCorrectionPrincipal, categoryId: string) {
  return live.roles.includes("super_admin") || (live.roles.includes("content_admin") && live.categoryScopes.includes(categoryId));
}
/** Pure, exported transaction guard: callers must invoke it from the Firestore transaction. */
export function validateLiveCategoryCorrectionPrincipal(actor: { claimRoles: readonly Role[]; claimAuthzVersion: unknown }, row: Record<string, unknown> | undefined, categoryId: string): LiveCorrectionPrincipal {
  if (!row || row.enabled !== true || row.identityReady !== true || !Array.isArray(row.roles) || typeof row.authzVersion !== "number" || !Number.isInteger(row.authzVersion)) throw new HttpsError("permission-denied", "Administrator registry authority changed.");
  const liveRoles = row.roles.filter((role: unknown): role is Role => typeof role === "string" && (roles as readonly string[]).includes(role));
  if (!sameAdminAuthorization(liveRoles, actor.claimRoles, row.authzVersion, actor.claimAuthzVersion)) throw new HttpsError("permission-denied", "Administrative authorization changed. Refresh your session.");
  const categoryScopes = Array.isArray(row.categoryScopes) ? row.categoryScopes.filter((scope: unknown): scope is string => typeof scope === "string") : [];
  const live = { roles: liveRoles, categoryScopes };
  if (!liveRoles.some(role => capabilities[role].includes("categories.write")) || !canManageCategoryCorrection(live, categoryId)) throw new HttpsError("permission-denied", "Category correction authority or scope changed.");
  return live;
}
export function categoryCorrectionDto(value: Record<string, unknown>, includeInternalNote: boolean) {
  return {
    categoryId: value.categoryId,
    baseReleaseId: value.baseReleaseId,
    baseReleaseRootSha256: value.baseReleaseRootSha256,
    publishedLabelAr: value.publishedLabelAr,
    proposedLabelAr: value.proposedLabelAr,
    status: value.status === "draft" ? "draft" : "unknown",
    revision: Number.isSafeInteger(value.revision) ? value.revision : 0,
    createdAt: value.createdAt ?? null,
    updatedAt: value.updatedAt ?? null,
    ...(includeInternalNote && typeof value.internalNote === "string" ? { internalNote: value.internalNote } : {}),
  };
}
function correctionReadDto(snapshot: FirebaseFirestore.DocumentSnapshot, includeInternalNote: boolean) {
  if (!snapshot.exists) return null;
  const value = snapshot.data() ?? {};
  return categoryCorrectionDto(value, includeInternalNote);
}
async function correctionBaselineInTransaction(tx: FirebaseFirestore.Transaction, categoryId: string): Promise<CategoryCorrectionBaseline> {
  const pointer = await tx.get(db.doc("runtime/activeRelease"));
  const releaseId = pointer.data()?.releaseId;
  if (!pointer.exists || typeof releaseId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(releaseId)) throw new HttpsError("failed-precondition", "No active immutable release.");
  const [release, category] = await Promise.all([tx.get(db.doc(`releases/${releaseId}`)), tx.get(db.doc(`releases/${releaseId}/catalogCategories/${categoryId}`))]);
  const releaseData = release.data(); const categoryData = category.data();
  if (!release.exists || releaseData?.immutable !== true || typeof releaseData.documentRootSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(releaseData.documentRootSha256)) throw new HttpsError("failed-precondition", "Active release is incomplete or not immutable.");
  const publishedLabelAr = typeof categoryData?.labelAr === "string" && categoryData.labelAr.trim() ? categoryData.labelAr.trim() : typeof categoryData?.displayNameAr === "string" && categoryData.displayNameAr.trim() ? categoryData.displayNameAr.trim() : null;
  if (!category.exists || !publishedLabelAr) throw new HttpsError("not-found", "Published category not found in the active release.");
  return { categoryId, releaseId, releaseRootSha256: releaseData.documentRootSha256, publishedLabelAr, correctionRef: db.doc(`adminCategoryCorrections/${categoryId}/releases/${releaseId}`) };
}
function correctionMatchesBaseline(value: Record<string, unknown>, baseline: CategoryCorrectionBaseline) {
  return value.categoryId === baseline.categoryId && value.baseReleaseId === baseline.releaseId && value.baseReleaseRootSha256 === baseline.releaseRootSha256 && value.publishedLabelAr === baseline.publishedLabelAr && value.status === "draft";
}
async function publishedQuestionPage(release: ActiveRelease, actor: Principal, input: ReturnType<typeof listInput>) {
  const scope = publishedScope(actor, input.categoryId);
  if (scope?.length === 0) return { releaseId: release.id, items: [], nextCursor: null };
  let query: FirebaseFirestore.Query = db.collection(`releases/${release.id}/questions`);
  if (input.categoryId) query = query.where("categoryId", "==", input.categoryId);
  else if (scope) query = query.where("categoryId", "in", scope);
  if (input.modality) query = query.where("modality", "==", input.modality);
  query = query.orderBy(FieldPath.documentId()).limit(input.limit + 1);
  if (input.cursor) {
    const cursor = await db.doc(`releases/${release.id}/questions/${input.cursor}`).get();
    if (!cursor.exists || (scope && !scope.includes(String(cursor.data()?.categoryId))) || (input.categoryId && cursor.data()?.categoryId !== input.categoryId) || (input.modality && cursor.data()?.modality !== input.modality)) throw new HttpsError("aborted", "Invalid, filtered-out, or out-of-scope published cursor.");
    query = query.startAfter(cursor);
  }
  const result = await query.get(); const docs = result.docs.slice(0, input.limit);
  return { releaseId: release.id, items: docs.map(doc => publishedQuestionDto(doc.id, doc.data())), nextCursor: result.docs.length > input.limit ? docs.at(-1)?.id ?? null : null };
}

export const adminGetSession = call("session", async (_request, actor) => ({ uid: actor.uid, roles: actor.roles, authzVersion: actor.authzVersion, capabilities: [...new Set(actor.roles.flatMap(role => capabilities[role]))], mutationMode: mutationEnabled() ? "enabled" : "staged", categoryCorrectionDraftMode: categoryCorrectionDraftsEnabled() ? "enabled" : "staged" }));
export const adminGetOverview = call("session", async (_request, actor) => {
  const inventory: Record<string, number> = {};
  const draftScope = actor.roles.includes("super_admin") || actor.roles.includes("viewer");
  const scopedCount = async (collection: string) => { const scopes = actor.categoryScopes ?? []; if (!scopes.length) return 0; if (scopes.length <= 30) return (await db.collection(collection).where("categoryId", "in", scopes).count().get()).data().count; const counts = await Promise.all(scopes.map(async categoryId => (await db.collection(collection).where("categoryId", "==", categoryId).count().get()).data().count)); return counts.reduce((sum, count) => sum + count, 0); };
  if (draftScope) { const names = ["adminQuestionDrafts", "adminReviewRequests", "adminRoomSummaries", "adminOperations"]; const counts = await Promise.all(names.map(async name => (await db.collection(name).count().get()).data().count)); names.forEach((name, index) => { inventory[name] = counts[index]; }); }
  else { if (actor.roles.some(role => role === "content_admin" || role === "reviewer")) { inventory.adminQuestionDrafts = await scopedCount("adminQuestionDrafts"); inventory.adminReviewRequests = await scopedCount("adminReviewRequests"); } if (actor.roles.includes("game_ops")) inventory.adminRoomSummaries = (await db.collection("adminRoomSummaries").count().get()).data().count; }
  let published: { releaseId: string | null; questionCount: number | null; categoryCount: number | null; scoped: boolean } = { releaseId: null, questionCount: null, categoryCount: null, scoped: !actor.roles.includes("super_admin") };
  if (actor.roles.some(role => capabilities[role].includes("questions.read"))) {
    const release = await activeRelease(); const scope = actor.roles.includes("super_admin") ? undefined : [...new Set(actor.categoryScopes ?? [])].sort();
    if (scope === undefined) published = { releaseId: release.id, questionCount: release.approvedCount, categoryCount: release.categoryCount, scoped: false };
    else if (scope.length) {
      const inventoryRows = await db.getAll(...scope.map(categoryId => db.doc(`releases/${release.id}/inventory/${categoryId}`)));
      published = { releaseId: release.id, questionCount: inventoryRows.reduce((sum, row) => sum + (Number.isSafeInteger(row.data()?.approvedCount) ? row.data()!.approvedCount : 0), 0), categoryCount: scope.length, scoped: true };
    } else published = { releaseId: release.id, questionCount: 0, categoryCount: 0, scoped: true };
  }
  return { inventory, published, mutationMode: mutationEnabled() ? "enabled" : "staged", actor: { uid: actor.uid, roles: actor.roles } };
});

/** Read-only projections of the active immutable release. Draft APIs remain separate below. */
export const adminListPublishedQuestions = call("questions.read", async (request, actor) => publishedQuestionPage(await activeRelease(listInput(request.data)), actor, listInput(request.data)));
export const adminGetPublishedQuestion = call("questions.read", async (request, actor) => {
  const data = object(request.data); only(data, ["id", "releaseId"]); const release = await activeRelease({ releaseId: optionalId(data.releaseId, "releaseId") }); const questionId = id(data.id);
  const snap = await db.doc(`releases/${release.id}/questions/${questionId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Published question not found."); scopeCategory(actor, String(snap.data()?.categoryId));
  return { releaseId: release.id, ...publishedQuestionDto(snap.id, snap.data()!, true) };
});
/**
 * Delivers a small, verified release-owned preview only after question scope is
 * checked. The client supplies no object path, media id, or generation.
 */
export const adminGetPublishedQuestionMedia = call("questions.read", async (request, actor) => {
  const data = object(request.data); only(data, ["id", "releaseId", "variant"]); const release = await activeRelease({ releaseId: optionalId(data.releaseId, "releaseId") }); const questionId = id(data.id);
  const question = await db.doc(`releases/${release.id}/questions/${questionId}`).get(); if (!question.exists) throw new HttpsError("not-found", "Published question not found."); scopeCategory(actor, String(question.data()?.categoryId));
  const binding = publishedQuestionMediaBinding(question.data()!, data.variant);
  const media = await db.doc(`releases/${release.id}/media/${binding.mediaId}`).get(); const record = media.data();
  const contentType = record?.contentType;
  if (!media.exists || record?.immutable !== true || record?.mediaId !== binding.mediaId || record?.assetSha256 !== binding.assetSha256 || typeof record?.objectName !== "string" || typeof record?.generation !== "string" || !/^[1-9][0-9]*$/.test(record.generation) || !["image/png", "image/jpeg", "video/mp4"].includes(String(contentType))) throw new HttpsError("failed-precondition", "Immutable media preview binding is unavailable.");
  const file = getStorage().bucket().file(record.objectName, { generation: record.generation }); const [metadata] = await file.getMetadata(); const size = Number(metadata.size);
  // Base64 expands by roughly one third; keep the callable result well below its response cap.
  if (!Number.isSafeInteger(size) || size < 1 || size > 1_000_000) throw new HttpsError("resource-exhausted", "Published media is too large for an inline administration preview.");
  const [bytes] = await file.download();
  if (bytes.length !== size || createHash("sha256").update(bytes).digest("hex") !== binding.assetSha256 || metadata.generation !== record.generation || metadata.contentType !== contentType) throw new HttpsError("failed-precondition", "Immutable media preview verification failed.");
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])); const jpeg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])); const video = bytes.subarray(4, 8).toString("ascii") === "ftyp";
  if ((contentType === "image/png" && !png) || (contentType === "image/jpeg" && !jpeg) || (contentType === "video/mp4" && !video)) throw new HttpsError("failed-precondition", "Immutable media preview format mismatch.");
  return { releaseId: release.id, questionId, variant: data.variant, mediaId: binding.mediaId, type: binding.type, contentType, altAr: binding.altAr, url: `data:${contentType};base64,${bytes.toString("base64")}` };
});
export const adminListPublishedCategories = call("categories.read", async (request, actor) => {
  const input = listInput(request.data); const release = await activeRelease(input); const scope = publishedScope(actor, input.categoryId);
  if (scope?.length === 0) return { releaseId: release.id, items: [], nextCursor: null };
  let query: FirebaseFirestore.Query = db.collection(`releases/${release.id}/catalogCategories`);
  if (input.categoryId) query = query.where(FieldPath.documentId(), "==", input.categoryId);
  else if (scope) query = query.where(FieldPath.documentId(), "in", scope);
  query = query.orderBy(FieldPath.documentId()).limit(input.limit + 1);
  if (input.cursor) { const cursor = await db.doc(`releases/${release.id}/catalogCategories/${input.cursor}`).get(); if (!cursor.exists || (scope && !scope.includes(cursor.id)) || (input.categoryId && cursor.id !== input.categoryId)) throw new HttpsError("aborted", "Invalid, filtered-out, or out-of-scope published cursor."); query = query.startAfter(cursor); }
  const result = await query.get(); const docs = result.docs.slice(0, input.limit);
  return { releaseId: release.id, items: await Promise.all(docs.map(doc => publishedCategoryDto(release.id, doc))), nextCursor: result.docs.length > input.limit ? docs.at(-1)?.id ?? null : null };
});
export const adminGetPublishedCategory = call("categories.read", async (request, actor) => {
  const data = object(request.data); only(data, ["id", "releaseId"]); const release = await activeRelease({ releaseId: optionalId(data.releaseId, "releaseId") }); const categoryId = id(data.id); scopeCategory(actor, categoryId);
  const snap = await db.doc(`releases/${release.id}/catalogCategories/${categoryId}`).get(); if (!snap.exists) throw new HttpsError("not-found", "Published category not found.");
  return { releaseId: release.id, ...await publishedCategoryDto(release.id, snap) };
});

/** Correction drafts are separate from immutable release catalogs. */
export const adminGetCategoryCorrection = call("categories.read", async (request, actor) => {
  const data = object(request.data); only(data, ["categoryId", "releaseId"]); const categoryId = id(data.categoryId, "categoryId"); const release = await activeRelease({ releaseId: optionalId(data.releaseId, "releaseId") });
  scopeCategory(actor, categoryId);
  const category = await db.doc(`releases/${release.id}/catalogCategories/${categoryId}`).get(); if (!category.exists) throw new HttpsError("not-found", "Published category not found.");
  const correction = await db.doc(`adminCategoryCorrections/${categoryId}/releases/${release.id}`).get();
  const canManage = canManageCategoryCorrection({ roles: actor.roles, categoryScopes: actor.categoryScopes ?? [] }, categoryId) && actor.roles.some(role => capabilities[role].includes("categories.write"));
  if (correction.exists) {
    const categoryData = category.data()!;
    const label = typeof categoryData.labelAr === "string" && categoryData.labelAr.trim() ? categoryData.labelAr.trim() : typeof categoryData.displayNameAr === "string" && categoryData.displayNameAr.trim() ? categoryData.displayNameAr.trim() : null;
    if (!label || !correctionMatchesBaseline(correction.data()!, { categoryId, releaseId: release.id, releaseRootSha256: release.documentRootSha256, publishedLabelAr: label, correctionRef: correction.ref })) throw new HttpsError("failed-precondition", "Category correction draft no longer matches the active release baseline.");
  }
  return { releaseId: release.id, draft: correctionReadDto(correction, canManage), canEdit: canManage, correctionDraftMode: categoryCorrectionDraftsEnabled() ? "enabled" : "staged" };
});

/**
 * Writes one shared category/release draft. It re-reads live authorization,
 * pointer, immutable root, category baseline, and idempotency inside its
 * transaction before creating the draft, revision snapshot, and audit receipt.
 */
export const adminSaveCategoryCorrection = call("categories.write", async (request, actor) => {
  const data = object(request.data); only(data, ["categoryId", "releaseId", "operationId", "expectedRevision", "draft"]);
  const categoryId = id(data.categoryId, "categoryId"); const requestedReleaseId = id(data.releaseId, "releaseId"); const operationId = id(data.operationId, "operationId"); const expectedRevision = integer(data.expectedRevision, "expectedRevision", 0); const draft = categoryCorrectionDraftInput(data.draft);
  scopeCategory(actor, categoryId);
  if (!canManageCategoryCorrection({ roles: actor.roles, categoryScopes: actor.categoryScopes ?? [] }, categoryId)) throw new HttpsError("permission-denied", "Category correction authority or scope is missing.");
  categoryCorrectionDraftsBlocked();
  return db.runTransaction(async tx => {
    categoryCorrectionDraftsBlocked();
    const baseline = await correctionBaselineInTransaction(tx, categoryId);
    if (baseline.releaseId !== requestedReleaseId) throw new HttpsError("aborted", "ACTIVE_RELEASE_CHANGED");
    const [livePrincipal, correction, priorOperation] = await Promise.all([tx.get(db.doc(`adminPrincipals/${actor.uid}`)), tx.get(baseline.correctionRef), tx.get(db.doc(`adminOperations/${operationId}`))]);
    const live = validateLiveCategoryCorrectionPrincipal(actor, livePrincipal.data(), categoryId);
    const target = `${categoryId}:${baseline.releaseId}`;
    if (priorOperation.exists) {
      const prior = priorOperation.data()!;
      if (prior.actorUid !== actor.uid || prior.action !== "category.correction-draft.save" || prior.target !== target || prior.requestHash !== actor.requestHash) throw new HttpsError("already-exists", "operationId was previously used for a different mutation payload.");
      return { operationId, revision: prior.revision, replayed: true, serverTime: prior.serverTime ?? null };
    }
    const previous = correction.exists ? correction.data()! : undefined;
    const revision = Number(previous?.revision ?? 0);
    if (previous && !correctionMatchesBaseline(previous, baseline)) throw new HttpsError("aborted", "CATEGORY_CORRECTION_BASE_CHANGED");
    if (revision !== expectedRevision) throw new HttpsError("aborted", "stale-revision");
    const nextRevision = revision + 1; const serverTime = new Date().toISOString();
    const next = { categoryId, baseReleaseId: baseline.releaseId, baseReleaseRootSha256: baseline.releaseRootSha256, publishedLabelAr: baseline.publishedLabelAr, proposedLabelAr: draft.proposedLabelAr, internalNote: draft.internalNote, status: "draft", revision: nextRevision, authorUid: previous?.authorUid ?? actor.uid, updatedByUid: actor.uid, updatedAt: FieldValue.serverTimestamp(), createdAt: previous?.createdAt ?? FieldValue.serverTimestamp() };
    tx.set(baseline.correctionRef, next);
    tx.create(baseline.correctionRef.collection("revisions").doc(String(nextRevision).padStart(8, "0")), { ...next, immutable: true, createdByUid: actor.uid, createdAt: FieldValue.serverTimestamp() });
    tx.create(priorOperation.ref, { actorUid: actor.uid, actorRoles: live.roles, action: "category.correction-draft.save", target, expectedRevision, revision: nextRevision, status: "draft_saved", serverTime, requestHash: actor.requestHash, categoryId, baseReleaseId: baseline.releaseId, baseReleaseRootSha256: baseline.releaseRootSha256 });
    tx.create(db.collection("adminAudit").doc(), { actorUid: actor.uid, actorRoles: live.roles, operationId, action: "category.correction-draft.save", target, expectedRevision, resultRevision: nextRevision, result: "draft_saved", requestHash: actor.requestHash, categoryId, baseReleaseId: baseline.releaseId, baseReleaseRootSha256: baseline.releaseRootSha256, createdAt: FieldValue.serverTimestamp() });
    return { operationId, revision: nextRevision, replayed: false, serverTime };
  });
});

export const adminListQuestions = call("questions.read", async (request, actor) => { const input = listInput(request.data); const result = await page("adminQuestionDrafts", input, { status: input.status, categoryId: input.categoryId }, actor.roles.includes("super_admin") ? undefined : actor.categoryScopes); const items = (result.items as Record<string, unknown>[]).map(item => ({ id: item.id, revision: item.revision, status: item.status, categoryId: item.categoryId, modality: item.modality, headerAr: item.headerAr, updatedAt: item.updatedAt })); return { ...result, items }; });
export const adminGetQuestion = call("questions.read", async (request, actor) => { const data = object(request.data); only(data, ["id"]); const snap = await db.doc(`adminQuestionDrafts/${id(data.id)}`).get(); if (!snap.exists) throw new HttpsError("not-found", "Question draft not found."); scopeCategory(actor, String(snap.data()!.categoryId)); return { id: snap.id, ...snap.data() }; });
export const adminSaveQuestion = call("questions.write", async (request, actor) => { const data = object(request.data); only(data, ["id", "operationId", "expectedRevision", "draft"]); const draft = object(data.draft); only(draft, ["categoryId", "modality", "headerAr", "promptAr", "canonicalAnswer", "acceptedAnswers", "specialistRoles", "sources", "status"]); const questionId = id(data.id); const operationId = id(data.operationId, "operationId"); const expected = integer(data.expectedRevision, "expectedRevision", 0); const categoryId = id(draft.categoryId, "categoryId"); scopeCategory(actor, categoryId); validateAdminQuestionDraft(draft); if (draft.status !== undefined && draft.status !== "draft" && draft.status !== "ready_for_review") throw new HttpsError("invalid-argument", "Invalid draft status."); text(draft.headerAr, "headerAr", 240); text(draft.promptAr, "promptAr", 4000); text(draft.canonicalAnswer, "canonicalAnswer", 1000); if (!Array.isArray(draft.acceptedAnswers) || draft.acceptedAnswers.length < 1 || draft.acceptedAnswers.length > 32 || draft.acceptedAnswers.some(answer => typeof answer !== "string" || !answer.trim() || answer.length > 1000)) throw new HttpsError("invalid-argument", "acceptedAnswers must contain 1–32 Arabic answer variants."); return mutate(actor, operationId, "question.save", questionId, expected, async (tx) => { const ref = db.doc(`adminQuestionDrafts/${questionId}`); const prior = await tx.get(ref); const current = prior.exists ? prior.data()! : undefined; const revision = current?.revision ?? 0; if (revision !== expected) throw new HttpsError("aborted", "stale-revision"); if (["in_review", "approved", "exported", "released"].includes(String(current?.status))) throw new HttpsError("failed-precondition", "Immutable review work must be forked into a successor draft."); const next = { ...draft, status: draft.status ?? "draft", revision: revision + 1, authorUid: current?.authorUid ?? actor.uid, updatedAt: FieldValue.serverTimestamp(), createdAt: current?.createdAt ?? FieldValue.serverTimestamp() }; tx.set(ref, next); tx.create(ref.collection("revisions").doc(String(revision + 1).padStart(8, "0")), { ...draft, status: next.status, revision: revision + 1, immutable: true, createdBy: actor.uid, createdAt: FieldValue.serverTimestamp() }); return { revision: revision + 1 }; }); });
export const adminValidateQuestion = call("questions.write", async (request, actor) => { const data = object(request.data); only(data, ["id"]); const questionId = id(data.id); const snap = await db.doc(`adminQuestionDrafts/${questionId}`).get(); if (!snap.exists) throw new HttpsError("not-found", "Question draft not found."); const draft = snap.data()!; scopeCategory(actor, String(draft.categoryId)); const errors = ["headerAr", "promptAr", "canonicalAnswer", "specialistRoles"].filter(field => !draft[field] || (Array.isArray(draft[field]) && !draft[field].length)); return { id: questionId, valid: !errors.length, errors, state: draft.status }; });
export const adminSubmitQuestionReview = call("questions.write", async (request, actor) => { const data = object(request.data); only(data, ["id", "operationId", "expectedRevision"]); const questionId = id(data.id); const expected = integer(data.expectedRevision, "expectedRevision", 1); return mutate(actor, id(data.operationId, "operationId"), "question.submit-review", questionId, expected, async (tx) => { const ref = db.doc(`adminQuestionDrafts/${questionId}`); const snap = await tx.get(ref); if (!snap.exists) throw new HttpsError("not-found", "Question draft not found."); const value = snap.data()!; scopeCategory(actor, String(value.categoryId)); if (value.revision !== expected || value.status !== "ready_for_review") throw new HttpsError("aborted", "stale-or-illegal-question-state"); const reviewRef = db.collection("adminReviewRequests").doc(questionId); const existing = await tx.get(reviewRef); if (existing.exists && existing.data()!.status === "in_review") throw new HttpsError("failed-precondition", "A review is already in progress."); const submittedRevision = expected + 1; const submittedValue = { ...value, status: "in_review", revision: submittedRevision }; tx.update(ref, { status: "in_review", revision: submittedRevision, updatedAt: FieldValue.serverTimestamp() }); tx.create(ref.collection("revisions").doc(String(submittedRevision).padStart(8, "0")), { ...submittedValue, immutable: true, createdBy: actor.uid, createdAt: FieldValue.serverTimestamp() }); tx.set(reviewRef, { questionId, categoryId: value.categoryId, authorUid: value.authorUid, specialistRoles: value.specialistRoles, questionRevision: submittedRevision, questionHash: questionReviewBinding(submittedValue, submittedRevision), status: "in_review", revision: Number(existing.data()?.revision ?? 0) + 1, updatedAt: FieldValue.serverTimestamp(), createdAt: existing.data()?.createdAt ?? FieldValue.serverTimestamp() }); return { revision: submittedRevision }; }); });
export const adminArchiveQuestion = call("questions.write", async (request, actor) => { const data = object(request.data); only(data, ["id", "operationId", "expectedRevision"]); const questionId = id(data.id); const expected = integer(data.expectedRevision, "expectedRevision", 1); return mutate(actor, id(data.operationId, "operationId"), "question.archive", questionId, expected, async tx => { const ref = db.doc(`adminQuestionDrafts/${questionId}`); const snap = await tx.get(ref); if (!snap.exists) throw new HttpsError("not-found", "Question draft not found."); const current = snap.data()!; scopeCategory(actor, String(current.categoryId)); if (current.revision !== expected) throw new HttpsError("aborted", "stale-revision"); if (!["draft", "ready_for_review", "changes_requested"].includes(String(current.status))) throw new HttpsError("failed-precondition", "Only mutable draft states may be archived."); tx.update(ref, { status: "archived", revision: expected + 1, updatedAt: FieldValue.serverTimestamp() }); tx.create(ref.collection("revisions").doc(String(expected + 1).padStart(8, "0")), { ...current, status: "archived", revision: expected + 1, immutable: true, createdBy: actor.uid, createdAt: FieldValue.serverTimestamp() }); return { revision: expected + 1 }; }); });

export const adminListReviews = call("reviews.read", async (request, actor) => { const input = listInput(request.data); const result = await page("adminReviewRequests", input, { status: input.status, categoryId: input.categoryId }, actor.roles.includes("super_admin") ? undefined : actor.categoryScopes); const items = (result.items as Record<string, unknown>[]).map(item => ({ id: item.id, questionId: item.questionId, categoryId: item.categoryId, status: item.status, revision: item.revision, updatedAt: item.updatedAt })); return { ...result, items }; });
export const adminGetReview = call("reviews.read", async (request, actor) => { const data = object(request.data); only(data, ["id"]); const snap = await db.doc(`adminReviewRequests/${id(data.id)}`).get(); if (!snap.exists) throw new HttpsError("not-found", "Review not found."); scopeCategory(actor, String(snap.data()!.categoryId)); return { id: snap.id, ...snap.data() }; });
export const adminDecideReview = call("reviews.decide", async (request, actor) => { const data = object(request.data); only(data, ["id", "operationId", "expectedRevision", "decision", "reason"]); const reviewId = id(data.id); const expected = integer(data.expectedRevision, "expectedRevision", 1); const decision = data.decision === "approved" || data.decision === "changes_requested" ? data.decision : (() => { throw new HttpsError("invalid-argument", "Invalid decision."); })(); if (decision === "approved") throw new HttpsError("failed-precondition", "Approval is staged: signing keys and receipt verification are unavailable."); const reason = text(data.reason, "reason", 2000); return mutate(actor, id(data.operationId, "operationId"), "review.decide", reviewId, expected, async tx => { const reviewRef = db.doc(`adminReviewRequests/${reviewId}`); const review = await tx.get(reviewRef); if (!review.exists) throw new HttpsError("not-found", "Review not found."); const value = review.data()!; if (value.revision !== expected || value.status !== "in_review" || value.authorUid === actor.uid) throw new HttpsError("permission-denied", "The review is stale, completed, or self-authored."); const questionRef = db.doc(`adminQuestionDrafts/${value.questionId}`); const question = await tx.get(questionRef); if (!question.exists) throw new HttpsError("not-found", "Question draft not found."); const questionValue = question.data()!; if (questionValue.status !== "in_review" || questionValue.revision !== value.questionRevision || questionReviewBinding(questionValue, Number(value.questionRevision)) !== value.questionHash) throw new HttpsError("aborted", "Review binding is stale or the submitted revision changed."); scopeReviewer(actor, String(questionValue.categoryId), questionValue.specialistRoles); const nextQuestionRevision = Number(questionValue.revision) + 1; tx.update(reviewRef, { status: decision, revision: expected + 1, decidedBy: actor.uid, reason, updatedAt: FieldValue.serverTimestamp() }); tx.update(questionRef, { status: decision, revision: nextQuestionRevision, updatedAt: FieldValue.serverTimestamp() }); tx.create(questionRef.collection("revisions").doc(String(nextQuestionRevision).padStart(8, "0")), { ...questionValue, status: decision, revision: nextQuestionRevision, immutable: true, createdBy: actor.uid, createdAt: FieldValue.serverTimestamp() }); return { revision: expected + 1 }; }); });

export const adminListCategories = call("categories.read", async (request, actor) => { const input = listInput(request.data); if (actor.roles.includes("super_admin")) return page("adminCategoryMetadata", input); const scoped = [...new Set(actor.categoryScopes ?? [])].sort(); if (input.categoryId && !scoped.includes(input.categoryId)) throw new HttpsError("permission-denied", "Category is outside your assigned scope."); const selected = input.categoryId ? [input.categoryId] : scoped; const start = input.cursor ? selected.indexOf(input.cursor) + 1 : 0; if (input.cursor && start === 0) throw new HttpsError("permission-denied", "Cursor is outside your assigned scope."); const ids = selected.slice(start, start + input.limit + 1); if (!ids.length) return { items: [], nextCursor: null }; const snapshots = await db.getAll(...ids.map(categoryId => db.doc(`adminCategoryMetadata/${categoryId}`))); const visible = snapshots.filter(snapshot => snapshot.exists).slice(0, input.limit); return { items: visible.map(snapshot => ({ id: snapshot.id, ...snapshot.data() })), nextCursor: ids.length > input.limit ? ids[input.limit - 1] : null }; });
export const adminGetCategory = call("categories.read", async (request, actor) => { const data = object(request.data); only(data, ["id"]); const categoryId = id(data.id); scopeCategory(actor, categoryId); const snap = await db.doc(`adminCategoryMetadata/${categoryId}`).get(); if (!snap.exists) throw new HttpsError("not-found", "Category not found."); return { id: snap.id, ...snap.data() }; });
export const adminUpdateCategory = call("categories.write", async (request, actor) => { const data = object(request.data); only(data, ["id", "operationId", "expectedRevision", "metadata"]); const categoryId = id(data.id); scopeCategory(actor, categoryId); const metadata = object(data.metadata); only(metadata, ["titleAr", "descriptionAr", "enabled"]); if (metadata.titleAr !== undefined) text(metadata.titleAr, "titleAr", 160); if (metadata.descriptionAr !== undefined) text(metadata.descriptionAr, "descriptionAr", 1000); if (metadata.enabled !== undefined && typeof metadata.enabled !== "boolean") throw new HttpsError("invalid-argument", "enabled must be boolean."); const expected = integer(data.expectedRevision, "expectedRevision", 0); return mutate(actor, id(data.operationId, "operationId"), "category.update", categoryId, expected, async tx => { const ref = db.doc(`adminCategoryMetadata/${categoryId}`); const prior = await tx.get(ref); const revision = prior.exists ? Number(prior.data()!.revision ?? 0) : 0; if (revision !== expected) throw new HttpsError("aborted", "stale-revision"); tx.set(ref, { ...metadata, revision: revision + 1, updatedAt: FieldValue.serverTimestamp(), createdAt: prior.data()?.createdAt ?? FieldValue.serverTimestamp() }, { merge: true }); return { revision: revision + 1 }; }); });

export const adminListReleases = call("releases.read", async request => pageIds("releases", listInput(request.data)));
export const adminGetRelease = call("releases.read", async request => { const data = object(request.data); only(data, ["id"]); const snap = await db.doc(`releases/${id(data.id)}`).get(); if (!snap.exists) throw new HttpsError("not-found", "Release not found."); return { id: snap.id, ...snap.data() }; });
export const adminAuditRelease = call("releases.read", async request => { const data = object(request.data); only(data, ["id"]); const releaseId = id(data.id); const snap = await db.doc(`releases/${releaseId}`).get(); return { releaseId, exists: snap.exists, immutable: snap.data()?.immutable === true, publication: "Use the existing plan/prepare/exact-verify/single-use barrier/activation workflow; this endpoint never publishes." }; });
export const adminStageRelease = call("releases.stage", async (request, actor) => { const data = object(request.data); only(data, ["id", "operationId", "expectedRevision"]); const releaseId = id(data.id); return mutate(actor, id(data.operationId, "operationId"), "release.stage", releaseId, integer(data.expectedRevision, "expectedRevision", 0), async () => ({ revision: 0, status: "blocked" })); });
const staged = (capability: Capability, action: string) => call(capability, async request => { const data = object(request.data); only(data, ["id", "operationId", "expectedRevision"]); return { state: "blocked", reason: `${action} is intentionally unavailable until the immutable release pipeline prerequisites are verified.`, operationId: optionalId(data.operationId, "operationId") }; });
export const adminCreateQuestion = adminSaveQuestion;
export const adminImportPreview = staged("questions.write", "Question import preview");
export const adminImportCommit = staged("questions.write", "Question import commit");
export const adminCreateExportJob = staged("releases.stage", "Question export");
export const adminCreateMediaUploadSession = staged("questions.write", "Media upload session");
export const adminFinalizeMediaUpload = staged("questions.write", "Media upload finalization");
export const adminRemoveUnreferencedMedia = staged("questions.write", "Media removal");
export const adminAssignReview = staged("reviews.decide", "Review assignment");
export const adminRequestReviewChanges = staged("reviews.decide", "Review change request");
export const adminPrepareRelease = staged("releases.stage", "Release prepare");
export const adminVerifyRelease = staged("releases.stage", "Release verify");
export const adminActivateRelease = staged("releases.stage", "Release activation");
export const adminRollbackRelease = staged("releases.stage", "Release rollback");

export const adminListRooms = call("rooms.read", async request => { const result = await page("adminRoomSummaries", listInput(request.data)); return { ...result, items: result.items.map(item => adminRoomDto(String(item.id), item)) }; });
export const adminGetRoom = call("rooms.act", async request => { const data = object(request.data); only(data, ["id"]); const roomId = id(data.id); const snap = await db.doc(`adminRoomSummaries/${roomId}`).get(); if (!snap.exists) throw new HttpsError("not-found", "Room summary not found."); return adminRoomDto(snap.id, snap.data()!, true); });
export const adminRoomAction = call("rooms.act", async (request, actor) => {
  const data = object(request.data);
  only(data, ["id", "operationId", "expectedRevision", "action", "reason", "memberUid"]);
  const roomId = id(data.id);
  const action = data.action === "pause" || data.action === "resume" || data.action === "close" || data.action === "remove_member"
    ? data.action : (() => { throw new HttpsError("invalid-argument", "Invalid room action."); })();
  const reason = text(data.reason, "reason", 1000);
  const memberUid = action === "remove_member" ? id(data.memberUid, "memberUid") : undefined;
  const expected = integer(data.expectedRevision, "expectedRevision", 1);
  return mutate(actor, id(data.operationId, "operationId"), `room.${action}`, roomId, expected, async tx => {
    const ref = db.doc(`rooms/${roomId}`);
    const [snap, membersSnap] = await Promise.all([tx.get(ref), tx.get(ref.collection("members"))]);
    if (!snap.exists) throw new HttpsError("not-found", "Room not found.");
    const stored = snap.data() as CanonicalRoom;
    if (stored.revision !== expected || (stored as CanonicalRoom & { closedAt?: unknown }).closedAt)
      throw new HttpsError("aborted", "stale-or-closed-room");
    // Generic board PAUSE/RESUME cannot safely mutate a challenge deadline.
    // Hosts must use the challenge controls, which carry occurrence and stage.
    if ((action === "pause" || action === "resume") && stored.challenge && !stored.challenge.continued)
      throw new HttpsError("failed-precondition", "CHALLENGE_ADMIN_CONTROLS_REQUIRED");
    const reconciled = await reconcileAdminChallenge(tx, stored);
    const room = reconciled.room;
    const targetMember = memberUid ? membersSnap.docs.map(doc => doc.data() as CanonicalMember).find(member => member.uid === memberUid) : undefined;
    if (memberUid && (!targetMember || targetMember.role === "host" || targetMember.active !== true))
      throw new HttpsError("failed-precondition", "Only an active non-host participant may be removed.");
    const game = action === "pause" || action === "resume" ? reduceGame(room.game, { type: action === "pause" ? "PAUSE" : "RESUME" }) : room.game;
    const timer = action === "pause" && room.timer ? { deadlineMs: 0, buzzOpen: false, remainingMs: Math.max(0, room.timer.deadlineMs - Date.now()), pausedBuzzOpen: room.timer.buzzOpen }
      : action === "resume" && room.timer?.remainingMs !== undefined ? { deadlineMs: Date.now() + room.timer.remainingMs, buzzOpen: Boolean(room.timer.pausedBuzzOpen) } : room.timer;
    const next = { ...room, game, timer, revision: expected + 1, updatedAt: FieldValue.serverTimestamp(), ...(action === "close" ? { closedAt: FieldValue.serverTimestamp() } : {}) } as CanonicalRoom;
    const members = membersSnap.docs.map(doc => doc.data() as CanonicalMember).map(member => memberUid && member.uid === memberUid ? { ...member, active: false } : member);
    if (memberUid) tx.update(ref.collection("members").doc(memberUid), { active: false, removedBy: actor.uid, removedReason: reason, updatedAt: FieldValue.serverTimestamp() });
    tx.update(ref, next);
    tx.create(ref.collection("events").doc(String(next.revision).padStart(12, "0")), { type: `ADMIN_${action.toUpperCase()}`, actorUid: actor.uid, reason, revision: next.revision, createdAt: FieldValue.serverTimestamp() });
    writeRoomAdminViews(tx, roomId, next, members, reconciled.definition);
    return { revision: next.revision };
  });
});

export const adminLookupUser = call("users.read", async request => { const data = object(request.data); only(data, ["uid", "email"]); if ((data.uid === undefined) === (data.email === undefined)) throw new HttpsError("invalid-argument", "Provide exactly one UID or email."); const user = data.uid !== undefined ? await auth.getUser(id(data.uid, "uid")) : await auth.getUserByEmail(text(data.email, "email", 320).toLowerCase()); const registry = await db.doc(`adminPrincipals/${user.uid}`).get(); return { uid: user.uid, displayName: user.displayName ?? null, email: user.email ?? null, providerIds: user.providerData.map(provider => provider.providerId), emailVerified: user.emailVerified, disabled: user.disabled, admin: registry.exists ? { enabled: registry.data()!.enabled === true, identityReady: registry.data()!.identityReady === true, roles: registry.data()!.roles ?? [], categoryScopes: registry.data()!.categoryScopes ?? [], reviewerScopes: registry.data()!.reviewerScopes ?? [], authzVersion: registry.data()!.authzVersion ?? 0 } : null }; });
async function synchronizeClaims(targetUid: string) { const [user, registry] = await Promise.all([auth.getUser(targetUid), db.doc(`adminPrincipals/${targetUid}`).get()]); const row = registry.data()!; if (!user.emailVerified || !user.providerData.some(provider => provider.providerId === "google.com" || provider.providerId === "password") || (row.enabled === true && user.disabled)) throw new HttpsError("failed-precondition", "Target must be a verified, usable Google or email/password identity before administrative activation."); await auth.setCustomUserClaims(targetUid, { ...(user.customClaims ?? {}), adminRoles: row.enabled === true ? row.roles : [], authzVersion: row.authzVersion }); await auth.revokeRefreshTokens(targetUid); }
async function recordIdentityOutcome(actor: Principal, operationId: string, action: string, targetUid: string, result: "identity_synced" | "identity_sync_failed") {
  const batch = db.batch();
  batch.set(db.doc(`adminOperations/${operationId}`), { status: result, identityUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
  batch.set(db.doc(`adminPrincipals/${targetUid}`), { identityReady: result === "identity_synced", identityUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
  batch.create(db.collection("adminAudit").doc(), { actorUid: actor.uid, actorRoles: actor.roles, operationId, action: `${action}.${result}`, target: targetUid, result, requestHash: actor.requestHash, createdAt: FieldValue.serverTimestamp() });
  await batch.commit();
}
async function synchronizeIdentity(actor: Principal, operationId: string, action: string, targetUid: string, work: () => Promise<void>) {
  let result: "identity_synced" | "identity_sync_failed" = "identity_synced";
  try { await work(); } catch { result = "identity_sync_failed"; }
  await recordIdentityOutcome(actor, operationId, action, targetUid, result);
  if (result === "identity_sync_failed") throw new HttpsError("failed-precondition", "Firebase Auth synchronization failed; registry authorization remains fail-closed.");
}
export function wouldOrphanSuperAdmin(currentlySuper: boolean, remainsSuper: boolean, otherActiveSuperAdmins: number) {
  return currentlySuper && !remainsSuper && otherActiveSuperAdmins < 1;
}
export function wouldLockOutLastSuperAdmin(currentlyUsableSuper: boolean, otherUsableSuperAdmins: number) { return currentlyUsableSuper && otherUsableSuperAdmins < 1; }
async function protectLastSuperAdmin(tx: FirebaseFirestore.Transaction, targetUid: string, current: Record<string, unknown> | undefined, nextEnabled: boolean, nextRoles: readonly Role[]) {
  const currentlySuper = current?.enabled === true && current.identityReady === true && Array.isArray(current.roles) && current.roles.includes("super_admin");
  const remainsSuper = nextEnabled && nextRoles.includes("super_admin");
  if (!currentlySuper) return;
  const lockRef = db.doc("adminAuthzInvariants/superAdmins");
  await tx.get(lockRef);
  const enabledSuperAdmins = await tx.get(db.collection("adminPrincipals").where("enabled", "==", true).where("identityReady", "==", true).where("roles", "array-contains", "super_admin"));
  const otherUsable = enabledSuperAdmins.docs.filter(doc => doc.id !== targetUid).length;
  if (wouldOrphanSuperAdmin(currentlySuper, remainsSuper, otherUsable) || wouldLockOutLastSuperAdmin(currentlySuper, otherUsable)) throw new HttpsError("failed-precondition", "A second synchronized super administrator is required before changing the final one.");
  tx.set(lockRef, { revision: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}
export const adminUpdateUserRole = call("users.write", async (request, actor) => { requireRole(actor, "super_admin"); const data = object(request.data); only(data, ["uid", "operationId", "expectedRevision", "roles", "enabled", "categoryScopes", "reviewerScopes"]); const targetUid = id(data.uid, "uid"); if (!Array.isArray(data.roles) || !data.roles.length || data.roles.some(role => typeof role !== "string" || !(roles as readonly string[]).includes(role))) throw new HttpsError("invalid-argument", "Invalid roles."); if (typeof data.enabled !== "boolean") throw new HttpsError("invalid-argument", "enabled is required."); const nextRoles = [...new Set(data.roles as Role[])].sort(); const categoryScopes = scopedIdList(data.categoryScopes ?? [], "categoryScopes"); const reviewerScopes = scopedIdList(data.reviewerScopes ?? [], "reviewerScopes", true); if (nextRoles.includes("reviewer") && (!categoryScopes.length || !reviewerScopes.length)) throw new HttpsError("invalid-argument", "Reviewers require category and specialist qualification scopes."); const expected = integer(data.expectedRevision, "expectedRevision", 0); const result = await mutate(actor, id(data.operationId, "operationId"), "user.role", targetUid, expected, async tx => { const ref = db.doc(`adminPrincipals/${targetUid}`); const current = await tx.get(ref); const existing = current.data(); const revision = Number(existing?.authzVersion ?? 0); if (revision !== expected) throw new HttpsError("aborted", "stale-authorization-version"); await protectLastSuperAdmin(tx, targetUid, existing, data.enabled as boolean, nextRoles); tx.set(ref, { enabled: data.enabled, roles: nextRoles, categoryScopes, reviewerScopes, authzVersion: revision + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); return { revision: revision + 1 }; }); await synchronizeIdentity(actor, result.operationId, "user.role", targetUid, () => synchronizeClaims(targetUid)); return result; });
export const adminSetUserStatus = call("users.write", async (request, actor) => { requireRole(actor, "super_admin"); const data = object(request.data); only(data, ["uid", "operationId", "expectedRevision", "disabled"]); const targetUid = id(data.uid, "uid"); if (typeof data.disabled !== "boolean") throw new HttpsError("invalid-argument", "disabled is required."); const expected = integer(data.expectedRevision, "expectedRevision", 0); const result = await mutate(actor, id(data.operationId, "operationId"), "user.status", targetUid, expected, async tx => { const ref = db.doc(`adminPrincipals/${targetUid}`); const snap = await tx.get(ref); const current = snap.data(); const version = Number(current?.authzVersion ?? 0); if (version !== expected) throw new HttpsError("aborted", "stale-authorization-version"); const currentRoles = Array.isArray(current?.roles) ? current.roles.filter((role): role is Role => typeof role === "string" && (roles as readonly string[]).includes(role)) : []; await protectLastSuperAdmin(tx, targetUid, current, !data.disabled, currentRoles); tx.set(ref, { enabled: !data.disabled, authzVersion: version + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); return { revision: version + 1 }; }); await synchronizeIdentity(actor, result.operationId, "user.status", targetUid, async () => { await auth.updateUser(targetUid, { disabled: data.disabled as boolean }); await synchronizeClaims(targetUid); }); return result; });
export const adminRevokeUserSessions = call("users.write", async (request, actor) => { requireRole(actor, "super_admin"); const data = object(request.data); only(data, ["uid", "operationId", "expectedRevision"]); const targetUid = id(data.uid, "uid"); const expected = integer(data.expectedRevision, "expectedRevision", 0); const result = await mutate(actor, id(data.operationId, "operationId"), "user.revoke", targetUid, expected, async (tx) => { const ref = db.doc(`adminPrincipals/${targetUid}`); const snap = await tx.get(ref); const current = snap.data(); const version = Number(current?.authzVersion ?? 0); if (version !== expected) throw new HttpsError("aborted", "stale-authorization-version"); const currentRoles = Array.isArray(current?.roles) ? current.roles.filter((role): role is Role => typeof role === "string" && (roles as readonly string[]).includes(role)) : []; await protectLastSuperAdmin(tx, targetUid, current, current?.enabled === true, currentRoles); tx.set(ref, { authzVersion: version + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); return { revision: version + 1 }; }); await synchronizeIdentity(actor, result.operationId, "user.revoke", targetUid, () => synchronizeClaims(targetUid)); return result; });
export const adminListAudit = call("audit.read", async (request, actor) => { const result = await pageBy("adminAudit", listInput(request.data), "createdAt", actor.roles.includes("super_admin") ? {} : { actorUid: actor.uid }); return { ...result, items: (result.items as Record<string, unknown>[]).map(item => ({ id: item.id, actorUid: item.actorUid, actorRoles: item.actorRoles, operationId: item.operationId, action: item.action, target: item.target, expectedRevision: item.expectedRevision, resultRevision: item.resultRevision, result: item.result, createdAt: item.createdAt })) }; });
function runtimeSettingsDto(value: Record<string, unknown>) { return { schemaVersion: value.schemaVersion ?? 1, revision: value.revision ?? 0, maintenanceMode: value.maintenanceMode === true, maintenanceMessageAr: typeof value.maintenanceMessageAr === "string" ? value.maintenanceMessageAr : "", roomCreationEnabled: value.roomCreationEnabled !== false, defaultQuestionTimerSeconds: value.defaultQuestionTimerSeconds ?? 30, defaultOpponentTimerSeconds: value.defaultOpponentTimerSeconds ?? 10, roomRetentionDays: value.roomRetentionDays ?? 30 }; }
export const adminGetHealth = call("health.read", async () => { const [settings, activeRelease, failedJobs, staleRooms] = await Promise.all([db.doc("adminSettings/runtime").get(), db.doc("runtime/activeRelease").get(), db.collection("adminOperations").where("status", "in", ["failed", "identity_sync_failed", "claim_sync_failed"]).count().get(), db.collection("adminRoomSummaries").where("updatedAt", "<", new Date(Date.now() - 24 * 60 * 60 * 1000)).count().get()]); return { components: { auth: "configured", functions: "reachable", firestore: "reachable", storage: "staged", appCheck: callable.enforceAppCheck ? "enforced" : "emulator_disabled" }, activeReleaseId: activeRelease.data()?.releaseId ?? null, failedJobs: failedJobs.data().count, staleRooms: staleRooms.data().count, deploymentVersion: process.env.K_REVISION ?? "local", runtimeRevision: runtimeSettingsDto(settings.data() ?? {}).revision, mutationMode: mutationEnabled() ? "enabled" : "staged", signing: "blocked_missing_signing_key" }; });
export const adminGetSettings = call("settings.read", async () => { const snap = await db.doc("adminSettings/runtime").get(); return { runtime: runtimeSettingsDto(snap.data() ?? {}), immutableNotice: "Production publication settings are not editable from the browser." }; });
export const adminUpdateSettings = call("settings.write", async (request, actor) => { requireRole(actor, "super_admin"); const data = object(request.data); only(data, ["operationId", "expectedRevision", "settings"]); const settings = object(data.settings); only(settings, ["maintenanceMode", "maintenanceMessageAr", "roomCreationEnabled", "defaultQuestionTimerSeconds", "defaultOpponentTimerSeconds", "roomRetentionDays"]); if (settings.maintenanceMode !== undefined && typeof settings.maintenanceMode !== "boolean") throw new HttpsError("invalid-argument", "maintenanceMode must be boolean."); if (settings.maintenanceMessageAr !== undefined && (typeof settings.maintenanceMessageAr !== "string" || settings.maintenanceMessageAr.length > 500)) throw new HttpsError("invalid-argument", "maintenanceMessageAr is invalid."); if (settings.roomCreationEnabled !== undefined && typeof settings.roomCreationEnabled !== "boolean") throw new HttpsError("invalid-argument", "roomCreationEnabled must be boolean."); if (settings.defaultQuestionTimerSeconds !== undefined) integer(settings.defaultQuestionTimerSeconds, "defaultQuestionTimerSeconds", 5, 600); if (settings.defaultOpponentTimerSeconds !== undefined) integer(settings.defaultOpponentTimerSeconds, "defaultOpponentTimerSeconds", 3, 300); if (settings.roomRetentionDays !== undefined) integer(settings.roomRetentionDays, "roomRetentionDays", 1, 365); const expected = integer(data.expectedRevision, "expectedRevision", 0); return mutate(actor, id(data.operationId, "operationId"), "settings.update", "runtime", expected, async tx => { const ref = db.doc("adminSettings/runtime"); const snap = await tx.get(ref); const revision = Number(snap.data()?.revision ?? 0); if (revision !== expected) throw new HttpsError("aborted", "stale-revision"); tx.set(ref, { ...settings, schemaVersion: 1, revision: revision + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); return { revision: revision + 1 }; }); });
