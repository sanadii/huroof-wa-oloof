import { randomBytes, randomUUID } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError, onCall } from "firebase-functions/https";
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
  validateDisplayName,
  validIntent,
  type CanonicalMember,
  type CanonicalQuestion,
  type CanonicalRoom,
} from "./game.js";
import { authorizeCurrentQuestionMedia, emulatorCurrentQuestionMediaUrl } from "./question-media.js";
import {
  exactPresenceRoomId,
  leaseState,
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_LEASE_MS,
} from "./presence.js";
export {
  adminGetSession, adminGetOverview, adminListQuestions, adminGetQuestion,
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
import { initialGameState } from "../../src/features/game/domain/lifecycle.js";
import {
  createMatchQuestionSelection,
  createCategoryQuestionSelection,
  promoteReservedQuestion,
  reserveQuestionForCell,
  selectCharadesQuestion,
  selectCategoryQuestion,
  selectMatchQuestion,
} from "../../src/features/game/runtime/question-selector.js";

if (!getApps().length) initializeApp();
const database = getFirestore();
database.settings({ ignoreUndefinedProperties: true });
const region = process.env.FUNCTIONS_REGION || "me-central2";
const callable = {
  region,
  enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true",
} as const;
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
export function validateQuestionScope(value: unknown): {
  categories: string[];
  modality: "classic" | "image" | "charades";
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
    !categories.length ||
    (modality !== "classic" && modality !== "image" && modality !== "charades") ||
    (gameKind !== "huroof" && gameKind !== "categories") ||
    (gameKind === "categories" && (categories.length < 2 || categories.length > 10 || modality !== "classic"))
  )
    throw new HttpsError(
      "invalid-argument",
      "A non-empty classic, image, or separate charades category scope is required.",
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
    projectRoom(id, room, members, "audience", undefined, now()),
  );
  for (const member of members) {
    if (member.role === "player")
      tx.set(
        database.doc(`rooms/${id}/projections/player_${member.uid}`),
        projectRoom(id, room, members, "player", member.uid, now()),
      );
    if (member.role === "host")
      tx.set(
        database.doc(`rooms/${id}/projections/host`),
        projectRoom(id, room, members, "host", member.uid, now()),
      );
  }
}
async function activeRelease(
  tx: FirebaseFirestore.Transaction,
  demoRequested: boolean,
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
  const approvedCount = root.data()?.approvedCount;
  if (
    !isDemoProject() &&
    (demoFixture || !Number.isInteger(approvedCount) || approvedCount <= 0)
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
  return {
    releaseId,
    releaseRootSha256: String(root.data()?.documentRootSha256 ?? ""),
    demoFixture,
  };
}
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
async function releaseQuestions(
  tx: FirebaseFirestore.Transaction,
  room: CanonicalRoom,
): Promise<CanonicalQuestion[]> {
  const snapshot = await tx.get(
    database
      .collection(`releases/${room.config.releaseId}/questions`)
      .orderBy(FieldPath.documentId()),
  );
  const rows = snapshot.docs.map(
    (item) => item.data() as Partial<CanonicalQuestion>,
  );
  if (
    rows.some(
      (item) =>
        typeof item.id !== "string" ||
        typeof item.categoryId !== "string" ||
        (item.modality !== "classic" &&
          item.modality !== "image" &&
          item.modality !== "charades") ||
        typeof item.answerConceptId !== "string" ||
        !item.answerConceptId ||
        typeof item.headerAr !== "string" ||
        typeof item.promptAr !== "string" ||
        typeof item.canonicalAnswer !== "string" ||
        !Array.isArray(item.acceptedAnswers) ||
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
/** Category labels are trusted only from Firestore and frozen into the room at create. */
async function pinnedCategorySnapshot(
  tx: FirebaseFirestore.Transaction,
  categories: string[],
) {
  const docs = await Promise.all(
    categories.map((id) => tx.get(database.doc(`categories/${id}`))),
  );
  const snapshot = docs.map((doc, index) => {
    const data = doc.data();
    const labelAr = data?.displayNameAr;
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
    createMatchQuestionSelection(runtimeQuestions(questions), {
      categories: room.config.categories ?? [],
      modality: room.config.modality ?? "classic",
      seed: room.questionCursor + 1,
      reservePerLetter: 3,
    });
  room.questionSelection = selection;
  return Object.keys(selection.queues);
}
function releaseCategorySelection(questions: CanonicalQuestion[], room: CanonicalRoom) {
  const selection = room.questionSelection ?? createCategoryQuestionSelection(runtimeQuestions(questions), {
    categories: room.config.categories ?? [], modality: "classic", seed: room.questionCursor + 1,
  });
  room.questionSelection = selection;
  return selection;
}
function releaseRoundReservations(room: CanonicalRoom) {
  if (!room.questionSelection) return;
  room.questionSelection = { ...room.questionSelection, reservedQuestionIds: [], reservedAnswerConceptIds: [], reservedForCell: {} };
}
function contentHold(room: CanonicalRoom, operation: 'SELECT_CELL' | 'START_NEXT_ROUND' | 'CONTINUE', cellId = room.game.activeCellId): CanonicalRoom {
  return { ...room, game: { ...room.game, contentHold: { reason: 'CONTENT_EXHAUSTED', operation, ...(cellId ? { cellId } : {}), heldAtRevision: room.revision + 1 } }, timer: undefined, buzzWinner: undefined };
}
function isContentDepleted(reason: unknown) {
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
    const runtime = runtimeQuestions(questions);
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
      const promoted = promoteReservedQuestion(runtime, selection, active.id);
      const result = promoted ?? selectCategoryQuestion(runtime, selection, active.categoryId ?? "");
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
    const result = selectMatchQuestion(runtime, selection, letter);
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
    if (error instanceof Error && (/No unused question\/concept reserve|No unused surprise letter/.test(error.message)))
      throw new HttpsError('failed-precondition', 'CONTENT_DEPLETED');
    throw new HttpsError("failed-precondition", error instanceof Error ? error.message : "Pinned release has no playable question.");
  }
}
/** Continue reserves the replacement before its cell changes, so concurrent selection cannot steal it. */
async function replaceFailedCell(
  tx: FirebaseFirestore.Transaction,
  room: CanonicalRoom,
): Promise<CanonicalRoom> {
  const cell = room.game.board?.cells.find((item) => item.id === room.game.activeCellId);
  if (!cell || !room.questionSelection || !room.game.board)
      throw new HttpsError("failed-precondition", "CONTENT_DEPLETED");
  const questions = await releaseQuestions(tx, room);
  const runtime = runtimeQuestions(questions);
  if (roomGameKind(room) === "categories") {
    const alternatives = (room.config.categories ?? []).filter((id) => id !== cell.categoryId).sort();
    let selected: ReturnType<typeof reserveQuestionForCell> | undefined;
    let categoryId: string | undefined;
    for (const candidate of alternatives) try {
      selected = reserveQuestionForCell(runtime, room.questionSelection, candidate, cell.id);
      categoryId = candidate;
      break;
    } catch { /* explicit hold/recovery is handled by the caller when none remain */ }
    if (!selected || !categoryId)
      throw new HttpsError("failed-precondition", "CONTENT_DEPLETED");
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

export const createRoom = onCall(callable, async (request) => {
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
  const difficulty =
    typeof requestData.difficulty === "string" && requestData.difficulty.trim()
      ? requestData.difficulty.trim().slice(0, 32)
      : "mixed";
  const mode =
    requestData.mode === "fast" || requestData.mode === "custom"
      ? requestData.mode
      : "classic";
  const candidates = Array.from({ length: 12 }, code);
  return database.runTransaction(async (tx) => {
    const release = await activeRelease(tx, demo);
    const categorySnapshot = scope.gameKind === "categories"
      ? await pinnedCategorySnapshot(tx, scope.categories)
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
        ...scope,
        ...(categorySnapshot ? { categorySnapshot } : {}),
        difficulty,
        mode,
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
    writes(tx, ref.id, room, [host]);
    return { roomId: ref.id, roomCode, revision: room.revision };
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
    const room = expiring(raw.data() as CanonicalRoom);
    if (isRoomClosed(room))
      throw new HttpsError("failed-precondition", "Room is closed.");
    const members = memberDocs.docs.map(
      (item) => item.data() as CanonicalMember,
    );
    if (own.exists) return { roomId: id, revision: room.revision };
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
    writes(tx, id, next, [...members, member]);
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
    const room = expiring(raw.data() as CanonicalRoom);
    if (isRoomClosed(room))
      throw new HttpsError("failed-precondition", "Room is closed.");
    const members = memberDocs.docs.map(
      (item) => item.data() as CanonicalMember,
    );
    if (own.exists) return { roomId: id, revision: room.revision };
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
    writes(tx, id, next, [...members, member]);
    return { roomId: id, revision: next.revision };
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

export const submitGameIntent = onCall(callable, async (request) => {
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
    const receiptHash = intentHash(intent);
    if (receiptRaw.exists) {
      if (receiptRaw.data()?.requestHash !== receiptHash)
        throw new HttpsError(
          "already-exists",
          "Intent id was reused with a different request.",
        );
      return { revision: receiptRaw.data()?.revision, replayed: true };
    }
    let room = expiring(raw.data() as CanonicalRoom);
    const member = memberRaw.data() as CanonicalMember;
    const members = memberDocs.docs.map(
      (item) => item.data() as CanonicalMember,
    );
    let question: CanonicalQuestion | undefined;
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
    try { if (
      (intent.type === "RETRY_CELL" || intent.type === "RETURN_CELL") &&
      room.game.lifecycle === "QUESTION_FAILED" &&
      !charades
    )
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
        releaseCategorySelection(releaseQuestionsForBoard, room);
      } else letters = releaseLetters(releaseQuestionsForBoard, room);
      if (gameKind !== "categories" && (!letters || letters.length < 25))
        throw new HttpsError(
          "failed-precondition",
          "Pinned release has insufficient 16 visible + 9 surprise coverage.",
        );
    }
    try {
      // A terminal retry prepares an eligible replacement above, then deliberately
      // clears disclosed state and returns to the board instead of reopening the old cell.
      const lifecycleIntent =
        !charades &&
        (intent.type === "RETRY_CELL" || intent.type === "RETURN_CELL") &&
        room.game.lifecycle === "QUESTION_FAILED"
          ? { ...intent, type: "RETURN_CELL" as const }
          : intent;
      result = reduceIntent(
        room,
        member,
        lifecycleIntent,
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
    writes(tx, id, next, nextMembers);
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
    const next = expireRoom(current, now());
    if (next === current) return { revision: current.revision, expired: false };
    const stamped = { ...next, updatedAt: FieldValue.serverTimestamp() };
    tx.set(ref, stamped);
    const members = memberDocs.docs.map(
      (item) => item.data() as CanonicalMember,
    );
    writes(tx, id, stamped, members);
    return { revision: stamped.revision, expired: true };
  });
});

/** A 60s V4 bearer URL is issued only after current room/member/media binding checks. */
export const getCurrentQuestionMedia = onCall(callable, async (request) => {
  const actor = uid(request);
  const data = request.data;
  let id: string;
  try { id = roomId(data?.roomId); } catch (reason) { return error(reason); }
  const binding = await database.runTransaction(async (tx) => {
    const ref = database.doc(`rooms/${id}`);
    const [raw, memberRaw, memberDocs] = await Promise.all([tx.get(ref), tx.get(ref.collection('members').doc(actor)), tx.get(ref.collection('members'))]);
    if (!raw.exists || !memberRaw.exists) throw new HttpsError('permission-denied', 'Not a room member.');
    try { return authorizeCurrentQuestionMedia(id, raw.data() as CanonicalRoom, memberDocs.docs.map((item) => item.data() as CanonicalMember), actor, data); }
    catch (reason) { throw new HttpsError('permission-denied', reason instanceof Error ? reason.message : 'media-not-visible'); }
  });
  permitMediaIssue(actor, id);
  // The release-owned binding is immutable. It supplies the only object name and
  // generation accepted by this callable; request input never supplies a path.
  const room = (await database.doc(`rooms/${id}`).get()).data() as CanonicalRoom | undefined;
  const releaseId = room?.config.releaseId;
  if (typeof releaseId !== 'string') throw new HttpsError('failed-precondition', 'Invalid pinned release.');
  const releaseMedia = await database.doc(`releases/${releaseId}/media/${binding.mediaId}`).get();
  const item = releaseMedia.data();
  const expectedObjectName = `question-media/v18/${binding.assetSha256}.png`;
  if (!releaseMedia.exists || item?.mediaId !== binding.mediaId || item?.assetSha256 !== binding.assetSha256 || item?.objectName !== expectedObjectName || item?.immutable !== true || typeof item?.generation !== 'string' || !/^[1-9][0-9]*$/.test(item.generation)) throw new HttpsError('failed-precondition', 'Immutable media binding is unavailable.');
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    const url = await emulatorCurrentQuestionMediaUrl(binding);
    return { mediaId: binding.mediaId, assetSha256: binding.assetSha256, url, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  }
  const file = getStorage().bucket().file(item.objectName, { generation: item.generation });
  const [metadata] = await file.getMetadata();
  if (metadata.generation !== item.generation || metadata.metadata?.assetSha256 !== binding.assetSha256) throw new HttpsError('failed-precondition', 'Immutable media generation mismatch.');
  const expiresAtMs = Date.now() + 60_000;
  const [url] = await file.getSignedUrl({ action: 'read', version: 'v4', expires: expiresAtMs });
  return { mediaId: binding.mediaId, assetSha256: binding.assetSha256, url, expiresAt: new Date(expiresAtMs).toISOString() };
});
