import { randomBytes } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/https";
import {
  expireRoom,
  intentHash,
  intentReceiptId,
  isRoomClosed,
  MAX_AUDIENCE,
  MAX_PLAYERS,
  normalizeRoomCode,
  projectRoom,
  reduceIntent,
  validateDisplayName,
  validIntent,
  type CanonicalMember,
  type CanonicalQuestion,
  type CanonicalRoom,
} from "./game.js";
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
  selectCharadesQuestion,
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
  if (
    !categories.length ||
    (modality !== "classic" && modality !== "image" && modality !== "charades")
  )
    throw new HttpsError(
      "invalid-argument",
      "A non-empty classic, image, or separate charades category scope is required.",
    );
  return { categories, modality };
}
function error(error: unknown) {
  if (error instanceof HttpsError) throw error;
  const message = error instanceof Error ? error.message : "invalid";
  const code =
    message === "stale-revision"
      ? "aborted"
      : message === "invalid-display-name" || message === "invalid-room-code"
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
    memberCount: members.filter((member) => member.active).length,
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
function memberTeam(members: CanonicalMember[]) {
  const players = members.filter(
    (member) => member.role === "player" && member.active,
  );
  const horizontal = players.filter(
    (member) => member.team === "horizontal",
  ).length;
  const vertical = players.length - horizontal;
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
    throw new HttpsError(
      "failed-precondition",
      error instanceof Error
        ? error.message
        : "Pinned release has no playable question.",
    );
  }
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
        demo,
        questionSeconds,
        opponentSeconds,
        teams,
        releaseId: release.releaseId,
        releaseRootSha256: release.releaseRootSha256,
        releaseDemoFixture: release.demoFixture,
        ...scope,
        difficulty,
        mode,
      },
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
  let displayName: string;
  try {
    roomCode = normalizeRoomCode(String(request.data?.roomCode ?? ""));
    displayName = validateDisplayName(request.data?.displayName, "لاعب");
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
    if (room.game.lifecycle !== "LOBBY")
      throw new HttpsError(
        "failed-precondition",
        "Joining is allowed only in the lobby.",
      );
    if (
      members.filter((member) => member.role === "player" && member.active)
        .length >= MAX_PLAYERS
    )
      throw new HttpsError("resource-exhausted", "Player capacity reached.");
    const member: CanonicalMember = {
      uid: actor,
      role: "player",
      displayName,
      ready: false,
      active: true,
      team: memberTeam(members),
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
    const room = expiring(raw.data() as CanonicalRoom);
    const member = memberRaw.data() as CanonicalMember;
    const members = memberDocs.docs.map(
      (item) => item.data() as CanonicalMember,
    );
    let question: CanonicalQuestion | undefined;
    let surpriseLetter: string | undefined;
    let letters: string[] | undefined;
    const charades = room.config.modality === "charades";
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
      const cell = room.game.board?.cells.find((item) => item.id === cellId);
      if (cell?.kind === "letter")
        ({ question } = await pinnedQuestion(tx, room, cellId));
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
      letters = releaseLetters(await releaseQuestions(tx, room), room);
      if (letters.length < 25)
        throw new HttpsError(
          "failed-precondition",
          "Pinned release has insufficient 16 visible + 9 surprise coverage.",
        );
    }
    let result;
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
      );
    } catch (reason) {
      return error(reason);
    }
    const next = { ...result.room, updatedAt: FieldValue.serverTimestamp() };
    const nextMembers = members.map((item) =>
      item.uid === actor ? result.member : item,
    );
    tx.set(ref, next);
    tx.set(memberRef, result.member);
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
