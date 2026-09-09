import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import {
  generateBoard,
  generateCategoryBoard,
  revealSurprise,
  type GameBoard,
  type TeamAxis,
} from "../src/features/game/domain/board.js";
import {
  deriveMatch,
  initialGameState,
  reduceGame,
  type GameEvent,
  type GameState,
  type RuleSet,
} from "../src/features/game/domain/lifecycle.js";
import {
  createCategoryQuestionSelection,
  createMatchQuestionSelection,
  promoteReservedQuestion,
  reserveQuestionForCell,
  selectCategoryQuestion,
  selectMatchQuestion,
  type MatchQuestionSelection,
  type RuntimeQuestionV32,
} from "../src/features/game/runtime/question-selector.js";
import type {
  ClientRole,
  GameIntent,
  ProjectionEnvelope,
  SafeProjection,
} from "../src/features/game/runtime/contracts.js";
import type { LocalRuntimeQuestionSource } from "./local-firestore-question-source.js";
import { sourceCategoryRegistry } from "../scripts/source-category-crosswalk.js";

type Member = {
  uid: string;
  role: ClientRole;
  displayName: string;
  team?: TeamAxis;
  ready: boolean;
};
type ManualParticipant = { id: string; displayName: string; team: TeamAxis };
type QuestionMedia = { mediaId: string; assetSha256: string; altAr: string };
type StoredQuestion = RuntimeQuestionV32 & {
  targetLetter?: string;
  sources?: unknown[];
  status: string;
  difficulty?: string;
  useCount?: number;
  objectionCount?: number;
  reviewError?: string;
  readOnly?: boolean;
  sourceUrl?: string;
  media?: QuestionMedia;
};
export type MatchConfig = {
  policyVersion?: 1;
  questionSeconds: number;
  opponentSeconds: number;
  teams: Record<TeamAxis, string>;
  categories: string[];
  modality: "classic" | "image" | "charades";
  gameKind?: "huroof" | "categories";
  categorySnapshot?: Array<{ id: string; labelAr: string }>;
  difficulty: string;
  mode: "classic" | "fast" | "custom";
  showQuestionOnAudience?: boolean;
};
type CreateMatchConfig = Partial<MatchConfig> & { bestOf?: 1 | 3 | 5 | 7 };
type Room = {
  id: string;
  code: string;
  revision: number;
  demo: boolean;
  questionSourceSnapshot?: string;
  roomSchemaVersion: 1 | 2;
  ruleSet: RuleSet;
  config: MatchConfig;
  game: GameState;
  members: Member[];
  manualParticipants?: ManualParticipant[];
  intentIds: Record<string, number>;
  intentHashes?: Record<string, string>;
  boardNonce: string;
  boardSequence: number;
  categoryOccurrences?: Record<string, number>;
  activeQuestion?: StoredQuestion;
  surpriseLetters: string[];
  questionSelection?: MatchQuestionSelection;
  deadlineAt?: string;
  buzzOpen?: boolean;
  pausedTimer?: { remainingMs: number; buzzOpen?: boolean };
  buzzWinner?: {
    uid?: string;
    displayName: string;
    team: TeamAxis;
    method: "player" | "host";
  };
  audit: Array<{
    revision: number;
    type: string;
    at: string;
    actor: string;
    payload: unknown;
  }>;
};
type Capability = { roomId: string; uid: string; role: ClientRole };
export type Clock = () => Date;
export const verifyPrivateQuestionMediaBytes = (
  bytes: Buffer,
  assetSha256: string,
  width?: unknown,
  height?: unknown,
) => {
  if (
    !Buffer.isBuffer(bytes) ||
    !/^[a-f0-9]{64}$/.test(assetSha256) ||
    createHash("sha256").update(bytes).digest("hex") !== assetSha256
  )
    throw new Error("MEDIA_ASSET_HASH_MISMATCH");
  if (
    bytes.length < 24 ||
    !bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  )
    throw new Error("MEDIA_ASSET_INVALID_PNG");
  const actualWidth = bytes.readUInt32BE(16),
    actualHeight = bytes.readUInt32BE(20);
  if (
    !actualWidth ||
    !actualHeight ||
    actualWidth > 4096 ||
    actualHeight > 4096 ||
    (typeof width === "number" && width !== actualWidth) ||
    (typeof height === "number" && height !== actualHeight)
  )
    throw new Error("MEDIA_ASSET_INVALID_BOUNDS");
};
const canManageTeamsInState = (lifecycle: GameState["lifecycle"]) =>
  [
    "LOBBY",
    "ROUND_SETUP",
    "CELL_SELECTION",
    "QUESTION_FAILED",
    "ROUND_COMPLETE",
  ].includes(lifecycle);
const validDisplayName = (value: unknown, fallback?: string) => {
  const name = typeof value === "string" ? value.trim() : fallback?.trim();
  if (!name || name.length > 48 || /\p{Cc}/u.test(name))
    throw new Error("INVALID_DISPLAY_NAME");
  return name;
};

const scores = (value?: unknown): Record<TeamAxis, number> => {
  const record = value as Partial<Record<TeamAxis, unknown>> | undefined;
  return {
    horizontal: typeof record?.horizontal === "number" ? record.horizontal : 0,
    vertical: typeof record?.vertical === "number" ? record.vertical : 0,
  };
};
const canonicalIntentHash = (intent: GameIntent) =>
  JSON.stringify({
    type: intent.type,
    expectedRevision: intent.expectedRevision,
    payload: Object.fromEntries(
      Object.entries(intent.payload).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  });
const trustedCategorySnapshot = (ids: string[]) => {
  const source = JSON.parse(
    readFileSync(
      join(process.cwd(), "content", "categories", "categories.json"),
      "utf8",
    ),
  ) as { categories?: Array<{ id?: unknown; displayNameAr?: unknown }> };
  const labels = new Map(
    (source.categories ?? []).flatMap((category) =>
      typeof category.id === "string" &&
      typeof category.displayNameAr === "string" &&
      category.displayNameAr.trim()
        ? [[category.id, category.displayNameAr.trim()] as const]
        : [],
    ),
  );
  for (const category of sourceCategoryRegistry.categories)
    labels.set(category.sourceCategoryId, category.sourceTitleAr);
  const snapshot = ids
    .map((id) => ({ id, labelAr: labels.get(id) }))
    .filter((item): item is { id: string; labelAr: string } =>
      Boolean(item.labelAr),
    );
  if (snapshot.length !== ids.length)
    throw new Error("CATEGORY_SNAPSHOT_INVALID");
  return snapshot;
};

function validIntent(intent: unknown): intent is GameIntent {
  if (!intent || typeof intent !== "object") return false;
  const value = intent as GameIntent;
  if (
    !Object.keys(value).every((key) =>
      ["type", "intentId", "expectedRevision", "payload"].includes(key),
    ) ||
    typeof value.type !== "string" ||
    typeof value.intentId !== "string" ||
    !/^[A-Za-z0-9_-]{1,120}$/.test(value.intentId) ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 0 ||
    !value.payload ||
    typeof value.payload !== "object" ||
    Array.isArray(value.payload)
  )
    return false;
  const keys = Object.keys(value.payload);
  if (value.type === "LOBBY_SET_READY")
    return keys.length === 1 && typeof value.payload.ready === "boolean";
  if (value.type === "LOBBY_ASSIGN_TEAM") {
    const hasMember =
      typeof value.payload.memberUid === "string" &&
      value.payload.memberUid.length > 0 &&
      value.payload.memberUid.length <= 128;
    const hasManual =
      typeof value.payload.manualParticipantId === "string" &&
      value.payload.manualParticipantId.length > 0 &&
      value.payload.manualParticipantId.length <= 128;
    return (
      keys.length === 2 &&
      hasMember !== hasManual &&
      (value.payload.team === "horizontal" || value.payload.team === "vertical")
    );
  }
  if (value.type === "LOBBY_ADD_MANUAL_PLAYER")
    return (
      keys.length === 2 &&
      typeof value.payload.displayName === "string" &&
      (value.payload.team === "horizontal" || value.payload.team === "vertical")
    );
  if (value.type === "SELECT_CELL")
    return (
      keys.length === 1 &&
      typeof value.payload.cellId === "string" &&
      /^cell-[0-4]-[0-4]$/.test(value.payload.cellId)
    );
  if (value.type === "HOST_SELECT_TEAM")
    return (
      keys.length === 1 &&
      (value.payload.team === "horizontal" || value.payload.team === "vertical")
    );
  if (value.type === "SET_AUDIENCE_QUESTION_VISIBILITY")
    return keys.length === 1 && typeof value.payload.showQuestion === "boolean";
  if (value.type === "BEGIN_CORRECTION")
    return (
      keys.every((key) => ["cellId", "owner", "reason"].includes(key)) &&
      typeof value.payload.cellId === "string" &&
      /^cell-[0-4]-[0-4]$/.test(value.payload.cellId) &&
      (value.payload.owner === undefined ||
        value.payload.owner === "horizontal" ||
        value.payload.owner === "vertical") &&
      typeof value.payload.reason === "string" &&
      value.payload.reason.trim().length > 0 &&
      value.payload.reason.length <= 240
    );
  return (
    [
      "START_MATCH",
      "ROUND_READY",
      "LETTER_REVEALED",
      "OPEN_QUESTION",
      "BUZZ",
      "JUDGE_CORRECT",
      "JUDGE_INCORRECT",
      "RETRY_CELL",
      "RETURN_CELL",
      "END_WITHOUT_WINNER",
      "AWARD_CELL",
      "CHECK_PATH",
      "START_NEXT_ROUND",
      "PAUSE",
      "RESUME",
      "CONFIRM_CORRECTION",
      "CANCEL_CORRECTION",
    ].includes(value.type) && keys.length === 0
  );
}

/** Produces a browser-safe deterministic board seed from persisted room entropy. */
export function deriveBoardSeed(
  boardNonce: string,
  boardSequence: number,
): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < boardNonce.length; index++)
    hash = Math.imul(hash ^ boardNonce.charCodeAt(index), 0x01000193);
  return (hash ^ Math.imul(boardSequence + 1, 0x9e3779b1)) >>> 0;
}

function boardDefaults<
  T extends { boardNonce?: unknown; boardSequence?: unknown },
>(room: T): T & Pick<Room, "boardNonce" | "boardSequence"> {
  return {
    ...room,
    boardNonce:
      typeof room.boardNonce === "string" && room.boardNonce
        ? room.boardNonce
        : randomUUID(),
    boardSequence:
      Number.isSafeInteger(room.boardSequence) &&
      Number(room.boardSequence) >= 0
        ? Number(room.boardSequence)
        : 0,
  };
}

/** Bounded JSON upcast: untouched lobbies become v2; started legacy rooms retain legacy authority without invented round order. */
function upcastRoom(value: unknown): Room {
  const room = boardDefaults(
    value as Room & {
      roomSchemaVersion?: number;
      ruleSet?: RuleSet;
      config?: MatchConfig & { bestOf?: 1 | 3 | 5 | 7 };
      game?: GameState & {
        points?: Record<TeamAxis, number>;
        roundWins?: Record<TeamAxis, number>;
      };
    },
  );
  if (room.roomSchemaVersion === 2 && room.ruleSet === "v2") {
    if (room.config?.policyVersion === undefined) {
      if (room.config?.gameKind && room.config.gameKind !== "huroof")
        throw new Error("ROOM_POLICY_UNKNOWN");
      return {
        ...room,
        config: { ...room.config, policyVersion: 1, gameKind: "huroof" },
      };
    }
    if (
      room.config.policyVersion !== 1 ||
      (room.config.gameKind !== "huroof" &&
        room.config.gameKind !== "categories")
    )
      throw new Error("ROOM_POLICY_UNKNOWN");
    return room;
  }
  const legacyBestOf =
    room.config?.bestOf && [1, 3, 5, 7].includes(room.config.bestOf)
      ? room.config.bestOf
      : 3;
  const config: MatchConfig = {
    policyVersion: 1,
    questionSeconds: room.config?.questionSeconds ?? 20,
    opponentSeconds: room.config?.opponentSeconds ?? 10,
    teams: room.config?.teams ?? { horizontal: "فريق ↔", vertical: "فريق ↕" },
    categories: room.config?.categories ?? [],
    modality:
      room.config?.modality === "image" || room.config?.modality === "charades"
        ? room.config.modality
        : "classic",
    gameKind: "huroof",
    difficulty: room.config?.difficulty ?? "mixed",
    mode: room.config?.mode ?? "classic",
    showQuestionOnAudience: room.config?.showQuestionOnAudience !== false,
  };
  if (!room.game || room.game.lifecycle === "LOBBY")
    return {
      ...room,
      roomSchemaVersion: 2,
      ruleSet: "v2",
      config,
      game: initialGameState(),
    };
  const game = room.game;
  return {
    ...room,
    roomSchemaVersion: 1,
    ruleSet: "legacy-v1",
    config,
    game: {
      ...game,
      ruleSet: "legacy-v1",
      questionScores: game.questionScores ?? scores(game.points),
      currentRound: game.currentRound ?? 0,
      roundOutcomeHistory: game.roundOutcomeHistory ?? [],
      legacyRoundWins: game.legacyRoundWins ?? scores(game.roundWins),
      legacyBestOf,
    },
  };
}

export class RoomStore {
  private readonly db: DatabaseSync;
  /** The development database lives outside the worktree unless GAME_DB_PATH explicitly opts in. */
  constructor(path = join(tmpdir(), "huroof-wa-oloof-local-game.sqlite")) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (room_id TEXT NOT NULL, revision INTEGER NOT NULL, event TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(room_id, revision)); CREATE TABLE IF NOT EXISTS snapshots (room_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(room_id, revision)); CREATE TABLE IF NOT EXISTS local_admin_drafts (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);",
    );
  }
  save(room: Room): void {
    const data = JSON.stringify(room);
    this.db
      .prepare(
        "INSERT INTO rooms(id, code, revision, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data",
      )
      .run(room.id, room.code, room.revision, data);
    this.db
      .prepare(
        "INSERT OR REPLACE INTO snapshots(room_id, revision, data) VALUES (?, ?, ?)",
      )
      .run(room.id, room.revision, data);
  }
  event(room: Room, value: unknown, at: string): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO events(room_id, revision, event, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(room.id, room.revision, JSON.stringify(value), at);
  }
  private hydrate(data: string): Room {
    const room = upcastRoom(JSON.parse(data));
    const upgraded = JSON.stringify(room);
    // Persist the bounded schema marker without inventing an event, revision, or legacy round order.
    if (upgraded !== data)
      this.db
        .prepare("UPDATE rooms SET data=? WHERE id=?")
        .run(upgraded, room.id);
    return room;
  }
  load(idOrCode: string): Room | undefined {
    const row = this.db
      .prepare("SELECT data FROM rooms WHERE id=? OR code=?")
      .get(idOrCode, idOrCode) as { data: string } | undefined;
    return row ? this.hydrate(row.data) : undefined;
  }
  rooms(): Room[] {
    return (
      this.db.prepare("SELECT data FROM rooms").all() as Array<{ data: string }>
    ).map((row) => this.hydrate(row.data));
  }
  saveAdminDraft(id: string, draft: unknown, at: string): void {
    this.db
      .prepare(
        "INSERT INTO local_admin_drafts(id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
      )
      .run(id, JSON.stringify(draft), at);
  }
  adminDrafts(): StoredQuestion[] {
    return (
      this.db
        .prepare("SELECT data FROM local_admin_drafts ORDER BY updated_at DESC")
        .all() as Array<{ data: string }>
    ).map((row) => JSON.parse(row.data) as StoredQuestion);
  }
  close(): void {
    this.db.close();
  }
}

export class AuthoritativeGameService {
  readonly store: RoomStore;
  private readonly secret: string;
  private readonly clock: Clock;
  private readonly newBoardNonce: () => string;
  private readonly localFirestoreQuestionSource?: LocalRuntimeQuestionSource;
  private readonly roomSerial = new Map<string, Promise<void>>();
  private readonly mediaIssues = new Map<string, number[]>();
  constructor(
    options: {
      dbPath?: string;
      secret?: string;
      clock?: Clock;
      boardNonce?: () => string;
      localFirestoreQuestionSource?: LocalRuntimeQuestionSource;
    } = {},
  ) {
    this.store = new RoomStore(options.dbPath);
    this.secret = options.secret ?? "local-development-secret";
    this.clock = options.clock ?? (() => new Date());
    this.newBoardNonce = options.boardNonce ?? randomUUID;
    this.localFirestoreQuestionSource = options.localFirestoreQuestionSource;
  }
  close(): void {
    this.store.close();
  }
  private now(): string {
    return this.clock().toISOString();
  }
  private token(capability: Capability): string {
    const encoded = Buffer.from(JSON.stringify(capability)).toString(
      "base64url",
    );
    return `${encoded}.${createHmac("sha256", this.secret).update(encoded).digest("base64url")}`;
  }
  verify(token: string): Capability | undefined {
    const [encoded, signature] = token.split(".");
    if (!encoded || !signature) return undefined;
    const expected = createHmac("sha256", this.secret)
      .update(encoded)
      .digest("base64url");
    if (
      expected.length !== signature.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    )
      return undefined;
    try {
      return JSON.parse(
        Buffer.from(encoded, "base64url").toString("utf8"),
      ) as Capability;
    } catch {
      return undefined;
    }
  }
  createAudienceCapability(roomId: string): string {
    this.mustRoom(roomId);
    return this.token({ roomId, uid: "audience", role: "audience" });
  }
  create(
    displayName = "المضيف",
    demo = false,
    requested: CreateMatchConfig = {},
  ): {
    roomId: string;
    roomCode: string;
    revision: number;
    token: string;
    audienceToken: string;
  } {
    if (!demo && !this.questionsSync(false).length)
      throw new Error("NO_APPROVED_QUESTION_STOCK");
    const id = randomUUID();
    const code = id.replaceAll("-", "").slice(0, 6).toUpperCase();
    const host = {
      uid: randomUUID(),
      role: "host" as const,
      displayName,
      ready: true,
    };
    // bestOf is accepted only for stale clients and deliberately has no v2 effect.
    const requestedCategories = [
      ...new Set(
        (requested.categories ?? [])
          .filter(
            (category): category is string =>
              typeof category === "string" && category.trim().length > 0,
          )
          .map((category) => category.trim()),
      ),
    ].sort();
    const categories = requestedCategories.length
      ? requestedCategories
      : demo
        ? [
            ...new Set(
              this.questionsSync(true)
                .map((question) => question.categoryId)
                .filter(
                  (category): category is string =>
                    typeof category === "string",
                ),
            ),
          ].sort()
        : [];
    if (!categories.length) throw new Error("QUESTION_CATEGORY_SCOPE_REQUIRED");
    const modality =
      requested.modality === "image" || requested.modality === "charades"
        ? requested.modality
        : "classic";
    const gameKind = requested.gameKind ?? "huroof";
    if (gameKind !== "huroof" && gameKind !== "categories")
      throw new Error("GAME_KIND_INVALID");
    if (
      gameKind === "categories" &&
      (categories.length < 2 ||
        categories.length > 10 ||
        modality !== "classic")
    )
      throw new Error("CATEGORY_GAME_COMBINATION_INVALID");
    this.requirePlayableQuestionScope(demo, categories, modality, gameKind);
    const config: MatchConfig = {
      policyVersion: 1,
      questionSeconds: Math.max(
        10,
        Math.min(60, requested.questionSeconds ?? 20),
      ),
      opponentSeconds: Math.max(
        10,
        Math.min(60, requested.opponentSeconds ?? 10),
      ),
      teams: {
        horizontal: requested.teams?.horizontal?.trim() || "فريق ↔",
        vertical: requested.teams?.vertical?.trim() || "فريق ↕",
      },
      categories,
      modality,
      gameKind,
      ...(gameKind === "categories"
        ? { categorySnapshot: trustedCategorySnapshot(categories) }
        : {}),
      difficulty: requested.difficulty ?? "mixed",
      mode: requested.mode ?? "classic",
      showQuestionOnAudience: requested.showQuestionOnAudience !== false,
    };
    const room: Room = {
      id,
      code,
      revision: 1,
      demo,
      roomSchemaVersion: 2,
      ruleSet: "v2",
      config,
      game: initialGameState(),
      members: [host],
      manualParticipants: [],
      intentIds: {},
      boardNonce: this.newBoardNonce(),
      boardSequence: 0,
      surpriseLetters: [],
      audit: [
        {
          revision: 1,
          type: "ROOM_CREATED",
          at: this.now(),
          actor: host.uid,
          payload: { demo, config, ruleSet: "v2" },
        },
      ],
    };
    if (demo && this.localFirestoreQuestionSource)
      room.questionSourceSnapshot =
        this.localFirestoreQuestionSource.snapshotId;
    this.store.save(room);
    this.store.event(room, room.audit[0], this.now());
    return {
      roomId: id,
      roomCode: code,
      revision: 1,
      token: this.token({ roomId: id, uid: host.uid, role: "host" }),
      audienceToken: this.token({
        roomId: id,
        uid: "audience",
        role: "audience",
      }),
    };
  }
  async join(
    code: string,
    displayName: unknown,
  ): Promise<{ roomId: string; revision: number; token: string }> {
    const initial = this.store.load(code);
    if (!initial) throw new Error("ROOM_NOT_FOUND");
    return this.serialize(initial.id, async () =>
      this.joinSerialized(code, displayName),
    );
  }
  private joinSerialized(
    code: string,
    displayName: unknown,
  ): { roomId: string; revision: number; token: string } {
    const room = this.store.load(code);
    if (!room) throw new Error("ROOM_NOT_FOUND");
    const name = validDisplayName(displayName);
    if (!canManageTeamsInState(room.game.lifecycle))
      throw new Error("JOIN_NOT_ALLOWED");
    if (this.participantCount(room) >= 16)
      throw new Error("PLAYER_CAPACITY_REACHED");
    const team = this.memberTeam(room);
    const member: Member = {
      uid: randomUUID(),
      role: "player",
      displayName: name,
      team,
      ready: false,
    };
    room.members.push(member);
    this.commit(room, "PLAYER_JOINED", member.uid, { team });
    return {
      roomId: room.id,
      revision: room.revision,
      token: this.token({ roomId: room.id, uid: member.uid, role: "player" }),
    };
  }
  metadata(roomId: string, token: string): ProjectionEnvelope {
    const capability = this.mustCapability(roomId, token);
    const room = this.mustRoom(roomId);
    return this.project(room, capability);
  }
  presenceActor(
    roomId: string,
    token: string,
  ): { uid: string; role: ClientRole } {
    const capability = this.mustCapability(roomId, token);
    const room = this.mustRoom(roomId);
    // Audience is an explicitly signed, synthetic read-only capability. It has
    // no member record and must never participate in player presence.
    if (capability.role === "audience" && capability.uid === "audience")
      return { uid: capability.uid, role: capability.role };
    const member = room.members.find(
      (candidate) =>
        candidate.uid === capability.uid && candidate.role === capability.role,
    );
    if (!member) throw new Error("UNAUTHORIZED");
    return { uid: member.uid, role: member.role };
  }
  private mustRoom(id: string): Room {
    const room = this.store.load(id);
    if (!room) throw new Error("ROOM_NOT_FOUND");
    if (
      (room.questionSourceSnapshot &&
        (!this.localFirestoreQuestionSource ||
          room.questionSourceSnapshot !==
            this.localFirestoreQuestionSource.snapshotId)) ||
      (room.demo &&
        this.localFirestoreQuestionSource &&
        !room.questionSourceSnapshot)
    )
      throw new Error("QUESTION_SOURCE_SNAPSHOT_UNAVAILABLE");
    return room;
  }
  private mustCapability(roomId: string, token: string): Capability {
    const capability = this.verify(token);
    if (!capability || capability.roomId !== roomId)
      throw new Error("UNAUTHORIZED");
    return capability;
  }
  /** Authorizes an image by the active immutable question binding only. */
  authorizeCurrentQuestionMedia(
    roomId: string,
    token: string,
    request: unknown,
  ): QuestionMedia {
    const capability = this.mustCapability(roomId, token);
    const room = this.mustRoom(roomId);
    const value = request as Partial<QuestionMedia> | undefined;
    if (
      !value ||
      Object.keys(value).length !== 2 ||
      typeof value.mediaId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(value.mediaId) ||
      typeof value.assetSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.assetSha256)
    )
      throw new Error("INVALID_MEDIA_REQUEST");
    if ((room as Room & { closedAt?: unknown }).closedAt)
      throw new Error("ROOM_CLOSED");
    const visibleStates = new Set<GameState["lifecycle"]>([
      "QUESTION_READING",
      "FIRST_ANSWER",
      "OPPONENT_CHANCE",
      "QUESTION_FAILED",
    ]);
    const hostAllowed = capability.role === "host";
    const audienceAllowed =
      capability.role === "audience" &&
      capability.uid === "audience" &&
      visibleStates.has(room.game.lifecycle) &&
      room.config.showQuestionOnAudience !== false;
    if (!hostAllowed && !audienceAllowed)
      throw new Error(
        capability.role === "player" ? "FORBIDDEN_ROLE" : "MEDIA_NOT_VISIBLE",
      );
    const media = room.activeQuestion?.media;
    if (
      room.activeQuestion?.modality !== "image" ||
      !media ||
      media.mediaId !== value.mediaId ||
      media.assetSha256 !== value.assetSha256
    )
      throw new Error("MEDIA_BINDING_MISMATCH");
    return media;
  }
  issueCurrentQuestionMedia(
    roomId: string,
    token: string,
    request: unknown,
  ): { ticket: string; expiresAt: string } {
    const media = this.authorizeCurrentQuestionMedia(roomId, token, request);
    const capability = this.mustCapability(roomId, token);
    const key = `${capability.uid}:${roomId}`;
    const nowMs = this.clock().getTime();
    const recent = (this.mediaIssues.get(key) ?? []).filter(
      (at) => at > nowMs - 60_000,
    );
    if (recent.length >= 12) throw new Error("MEDIA_RATE_LIMITED");
    recent.push(nowMs);
    this.mediaIssues.set(key, recent);
    const expiresAtMs = nowMs + 60_000;
    const payload = {
      purpose: "current-question-media",
      roomId,
      uid: capability.uid,
      role: capability.role,
      mediaId: media.mediaId,
      assetSha256: media.assetSha256,
      expiresAtMs,
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return {
      ticket: `${encoded}.${createHmac("sha256", this.secret).update(encoded).digest("base64url")}`,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }
  async readCurrentQuestionMedia(
    ticket: string,
    bearerToken: string,
  ): Promise<{ bytes: Buffer; contentType: string }> {
    const [encoded, signature] = ticket.split(".");
    const expected = encoded
      ? createHmac("sha256", this.secret).update(encoded).digest("base64url")
      : "";
    if (
      !encoded ||
      !signature ||
      expected.length !== signature.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    )
      throw new Error("INVALID_MEDIA_TICKET");
    let payload: {
      purpose?: unknown;
      roomId?: unknown;
      uid?: unknown;
      role?: unknown;
      mediaId?: unknown;
      assetSha256?: unknown;
      expiresAtMs?: unknown;
    };
    try {
      payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      throw new Error("INVALID_MEDIA_TICKET");
    }
    if (
      payload.purpose !== "current-question-media" ||
      typeof payload.roomId !== "string" ||
      typeof payload.uid !== "string" ||
      typeof payload.role !== "string" ||
      typeof payload.mediaId !== "string" ||
      typeof payload.assetSha256 !== "string" ||
      !Number.isSafeInteger(payload.expiresAtMs)
    )
      throw new Error("MEDIA_TICKET_EXPIRED");
    const expiresAtMs = payload.expiresAtMs as number;
    if (expiresAtMs < this.clock().getTime())
      throw new Error("MEDIA_TICKET_EXPIRED");
    const capability = this.mustCapability(payload.roomId, bearerToken);
    if (capability.uid !== payload.uid || capability.role !== payload.role)
      throw new Error("UNAUTHORIZED");
    const media = this.authorizeCurrentQuestionMedia(
      payload.roomId,
      bearerToken,
      { mediaId: payload.mediaId, assetSha256: payload.assetSha256 },
    );
    const manifestPath = join(
      process.cwd(),
      "content",
      "question-media",
      "v18-private-240",
      "manifest.json",
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      assets?: Array<{
        mediaId?: string;
        assetSha256?: string;
        localFile?: string;
        width?: number;
        height?: number;
      }>;
    };
    const entry = manifest.assets?.find(
      (item) =>
        item.mediaId === media.mediaId &&
        item.assetSha256 === media.assetSha256,
    );
    if (
      !entry ||
      typeof entry.localFile !== "string" ||
      !/^[a-z0-9/.-]+$/i.test(entry.localFile)
    )
      throw new Error("MEDIA_ASSET_MISSING");
    const root = resolve(
      process.cwd(),
      "content",
      "question-media",
      "v18-private-240",
    );
    const target = resolve(root, entry.localFile);
    if (
      relative(root, target).startsWith(`..${sep}`) ||
      relative(root, target) === ".."
    )
      throw new Error("MEDIA_PATH_INVALID");
    const bytes = await readFile(target);
    verifyPrivateQuestionMediaBytes(
      bytes,
      media.assetSha256,
      entry.width,
      entry.height,
    );
    return { bytes, contentType: "image/png" };
  }
  private async freshBoard(room: Room): Promise<GameBoard> {
    const questions = await this.questions(
      room.demo,
      room.questionSourceSnapshot,
    );
    const selection =
      room.questionSelection ??
      (room.config.gameKind === "categories"
        ? createCategoryQuestionSelection(questions, {
            categories: room.config.categories,
            modality: "classic",
            seed: deriveBoardSeed(room.boardNonce, 0),
          })
        : createMatchQuestionSelection(questions, {
            categories: room.config.categories,
            modality: room.config.modality,
            seed: deriveBoardSeed(room.boardNonce, 0),
            reservePerLetter: room.demo ? 1 : 3,
          }));
    room.questionSelection = selection;
    const letters = Object.keys(selection.queues);
    let sequence = room.boardSequence;
    let seed = deriveBoardSeed(room.boardNonce, sequence);
    // Legacy rooms can have an existing revision-derived board. Do not repeat it
    // when their first new round is created after the safe upcast.
    while (seed === room.game.board?.seed) {
      sequence++;
      seed = deriveBoardSeed(room.boardNonce, sequence);
    }
    const shuffled = letters
      .map((letter, index) => ({
        letter,
        order: (seed * 1103515245 + index * 12345) >>> 0,
      }))
      .sort((a, b) => a.order - b.order)
      .map(({ letter }) => letter);
    if (room.config.gameKind === "categories") {
      room.boardSequence = sequence + 1;
      const board = generateCategoryBoard(
        seed,
        room.config.categorySnapshot ?? [],
      );
      room.categoryOccurrences = Object.fromEntries(
        board.cells.reduce<Map<string, number>>(
          (counts, cell) =>
            counts.set(
              cell.categoryId!,
              Math.max(
                counts.get(cell.categoryId!) ?? 0,
                cell.categoryOccurrence ?? 0,
              ),
            ),
          new Map(),
        ),
      );
      return board;
    }
    room.surpriseLetters = shuffled.slice(16, 25);
    room.boardSequence = sequence + 1;
    return generateBoard(seed, shuffled.slice(0, 16));
  }
  private releaseRoundReservations(room: Room): void {
    if (!room.questionSelection) return;
    room.questionSelection = {
      ...room.questionSelection,
      reservedQuestionIds: [],
      reservedAnswerConceptIds: [],
      reservedForCell: {},
    };
  }
  private holdContent(
    room: Room,
    operation: "SELECT_CELL" | "START_NEXT_ROUND" | "CONTINUE",
    cellId = room.game.activeCellId,
  ): void {
    room.game = {
      ...room.game,
      contentHold: {
        reason: "CONTENT_EXHAUSTED",
        operation,
        ...(cellId ? { cellId } : {}),
        heldAtRevision: room.revision + 1,
      },
    };
    room.buzzOpen = false;
    room.deadlineAt = undefined;
    room.buzzWinner = undefined;
  }
  async startBoard(room: Room, nextRound = false): Promise<void> {
    if (nextRound) this.releaseRoundReservations(room);
    const board = await this.freshBoard(room);
    room.game = reduceGame(
      room.game,
      nextRound
        ? { type: "START_NEXT_ROUND", board }
        : { type: "START_MATCH", board },
    );
  }
  private openQuestionBuzzer(
    room: Room,
    seconds = room.config.questionSeconds,
  ): void {
    room.buzzWinner = undefined;
    room.buzzOpen = true;
    room.deadlineAt = new Date(
      this.clock().getTime() + seconds * 1000,
    ).toISOString();
  }
  /** Authoritative deadline processing, invoked by the HTTP service loop and before every intent. */
  private async serialize<T>(
    roomId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = this.roomSerial.get(roomId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.roomSerial.set(
      roomId,
      previous.then(() => current),
    );
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
  async tick(): Promise<string[]> {
    const changed: string[] = [];
    for (const snapshot of this.store.rooms()) {
      try {
        if (
          await this.serialize(snapshot.id, async () =>
            this.expire(this.mustRoom(snapshot.id)),
          )
        )
          changed.push(snapshot.id);
      } catch (error) {
        // A restored DB-backed room stays unavailable until its exact source snapshot
        // returns; it must not interrupt ticks for unrelated local rooms.
        if (
          !(error instanceof Error) ||
          error.message !== "QUESTION_SOURCE_SNAPSHOT_UNAVAILABLE"
        )
          throw error;
      }
    }
    return changed;
  }
  async intent(
    roomId: string,
    token: string,
    intent: GameIntent,
  ): Promise<{
    revision: number;
    replayed: boolean;
    projection: ProjectionEnvelope;
    stale?: boolean;
  }> {
    return this.serialize(roomId, () =>
      this.intentSerialized(roomId, token, intent),
    );
  }
  private expire(room: Room): boolean {
    if (
      !room.buzzOpen ||
      !room.deadlineAt ||
      this.clock().getTime() < Date.parse(room.deadlineAt)
    )
      return false;
    if (
      room.game.lifecycle !== "QUESTION_READING" &&
      room.game.lifecycle !== "OPPONENT_CHANCE"
    ) {
      room.buzzOpen = false;
      room.deadlineAt = undefined;
      return false;
    }
    room.game = reduceGame(room.game, { type: "TIME_EXPIRED" });
    room.buzzOpen = false;
    room.deadlineAt = undefined;
    this.commit(room, "SERVER_TIME_EXPIRED", "server", {}, undefined);
    return true;
  }
  private async intentSerialized(
    roomId: string,
    token: string,
    intent: GameIntent,
  ): Promise<{
    revision: number;
    replayed: boolean;
    projection: ProjectionEnvelope;
    stale?: boolean;
  }> {
    if (!validIntent(intent)) throw new Error("INVALID_INTENT");
    const capability = this.mustCapability(roomId, token);
    const room = this.mustRoom(roomId);
    this.expire(room);
    const receiptKey = `${capability.uid}:${intent.intentId}`;
    const receiptHash = canonicalIntentHash(intent);
    const seen = room.intentIds[receiptKey];
    if (seen !== undefined) {
      if (room.intentHashes?.[receiptKey] !== receiptHash)
        throw new Error("INTENT_ID_REUSED");
      return {
        revision: seen,
        replayed: true,
        projection: this.project(room, capability),
      };
    }
    if (intent.expectedRevision !== room.revision)
      return {
        revision: room.revision,
        replayed: false,
        stale: true,
        projection: this.project(room, capability),
      };
    if (intent.type === "LOBBY_SET_READY") {
      this.require(capability, "player");
      if (room.game.lifecycle !== "LOBBY") throw new Error("READY_NOT_ALLOWED");
      const member = room.members.find(
        (value) => value.uid === capability.uid,
      )!;
      member.ready = Boolean(intent.payload.ready);
      this.commit(
        room,
        intent.type,
        capability.uid,
        intent.payload,
        receiptKey,
        receiptHash,
      );
      return {
        revision: room.revision,
        replayed: false,
        projection: this.project(room, capability),
      };
    }
    if (intent.type === "BUZZ") {
      this.require(capability, "player");
      const member = room.members.find(
        (value) => value.uid === capability.uid,
      )!;
      if (
        !member?.team ||
        room.buzzWinner ||
        !room.buzzOpen ||
        !room.deadlineAt ||
        (room.game.lifecycle !== "QUESTION_READING" &&
          room.game.lifecycle !== "OPPONENT_CHANCE") ||
        (room.game.lifecycle === "OPPONENT_CHANCE" &&
          member.team !== room.game.entitledTeam)
      )
        throw new Error("BUZZ_NOT_OPEN");
      room.game = reduceGame(room.game, {
        type: "BUZZ_ACCEPTED",
        team: member.team,
      });
      room.buzzOpen = false;
      room.deadlineAt = undefined;
      room.buzzWinner = {
        uid: member.uid,
        displayName: member.displayName,
        team: member.team,
        method: "player",
      };
      this.commit(
        room,
        intent.type,
        capability.uid,
        { team: member.team },
        receiptKey,
        receiptHash,
      );
      return {
        revision: room.revision,
        replayed: false,
        projection: this.project(room, capability),
      };
    }
    this.require(capability, "host");
    if (room.game.contentHold && intent.type !== "END_WITHOUT_WINNER")
      throw new Error("CONTENT_HOLD_ACTIVE");
    if (intent.type === "SET_AUDIENCE_QUESTION_VISIBILITY") {
      room.config.showQuestionOnAudience = intent.payload
        .showQuestion as boolean;
      this.commit(
        room,
        intent.type,
        capability.uid,
        intent.payload,
        receiptKey,
        receiptHash,
      );
      return {
        revision: room.revision,
        replayed: false,
        projection: this.project(room, capability),
      };
    }
    if (intent.type === "LOBBY_ADD_MANUAL_PLAYER") {
      const { displayName, team } = intent.payload;
      if (
        Object.keys(intent.payload).length !== 2 ||
        room.game.lifecycle !== "LOBBY" ||
        (team !== "horizontal" && team !== "vertical")
      )
        throw new Error("MANUAL_ADD_NOT_ALLOWED");
      if (this.participantCount(room) >= 16)
        throw new Error("PLAYER_CAPACITY_REACHED");
      const participant: ManualParticipant = {
        id: randomUUID(),
        displayName: validDisplayName(displayName),
        team,
      };
      room.manualParticipants = [
        ...(room.manualParticipants ?? []),
        participant,
      ];
      this.commit(
        room,
        intent.type,
        capability.uid,
        { displayName: participant.displayName, team },
        receiptKey,
        receiptHash,
      );
      return {
        revision: room.revision,
        replayed: false,
        projection: this.project(room, capability),
      };
    }
    if (intent.type === "LOBBY_ASSIGN_TEAM") {
      const { memberUid, manualParticipantId, team } = intent.payload;
      const hasMember = typeof memberUid === "string" && memberUid.length > 0;
      const hasManual =
        typeof manualParticipantId === "string" &&
        manualParticipantId.length > 0;
      if (
        Object.keys(intent.payload).length !== 2 ||
        hasMember === hasManual ||
        (team !== "horizontal" && team !== "vertical") ||
        !canManageTeamsInState(room.game.lifecycle)
      )
        throw new Error("LOBBY_ASSIGNMENT_NOT_ALLOWED");
      if (hasManual) {
        const target = (room.manualParticipants ?? []).find(
          (participant) => participant.id === manualParticipantId,
        );
        if (!target) throw new Error("LOBBY_ASSIGNMENT_TARGET_INVALID");
        target.team = team;
      } else {
        const target = room.members.find((member) => member.uid === memberUid);
        if (!target || target.role !== "player")
          throw new Error("LOBBY_ASSIGNMENT_TARGET_INVALID");
        if (target.team !== team) {
          target.team = team;
          if (room.game.lifecycle === "LOBBY") target.ready = false;
        }
      }
      this.commit(
        room,
        intent.type,
        capability.uid,
        intent.payload,
        receiptKey,
        receiptHash,
      );
      return {
        revision: room.revision,
        replayed: false,
        projection: this.project(room, capability),
      };
    }
    const before = structuredClone(room);
    try {
      if (intent.type === "START_MATCH") {
        const reason = this.startBlockedReason(room);
        if (reason) throw new Error(reason);
        await this.startBoard(room);
      } else await this.applyHostIntent(room, intent);
    } catch (error) {
      if (
        error instanceof Error &&
        /CONTENT_EXHAUSTED|NO_UNUSED_SURPRISE_LETTER|No unused question/.test(
          error.message,
        ) &&
        [
          "SELECT_CELL",
          "LETTER_REVEALED",
          "RETRY_CELL",
          "RETURN_CELL",
          "START_NEXT_ROUND",
        ].includes(intent.type)
      ) {
        Object.assign(room, before);
        this.holdContent(
          room,
          intent.type === "START_NEXT_ROUND"
            ? "START_NEXT_ROUND"
            : intent.type === "SELECT_CELL" || intent.type === "LETTER_REVEALED"
              ? "SELECT_CELL"
              : "CONTINUE",
          intent.type === "SELECT_CELL"
            ? (intent.payload.cellId as string)
            : before.game.activeCellId,
        );
      } else throw error;
    }
    this.commit(
      room,
      intent.type,
      capability.uid,
      intent.payload,
      receiptKey,
      receiptHash,
    );
    return {
      revision: room.revision,
      replayed: false,
      projection: this.project(room, capability),
    };
  }
  private async applyHostIntent(room: Room, intent: GameIntent): Promise<void> {
    const payload = intent.payload;
    // Older clients may still send OPEN_QUESTION. It remains harmless, but cannot
    // reset the timer which is now opened atomically with question visibility.
    if (intent.type === "OPEN_QUESTION") {
      if (room.game.lifecycle !== "QUESTION_READING")
        throw new Error("QUESTION_NOT_READY");
      if (!room.buzzOpen || !room.deadlineAt) this.openQuestionBuzzer(room);
      return;
    }
    if (intent.type === "HOST_SELECT_TEAM") {
      const team = payload.team;
      if (
        Object.keys(payload).length !== 1 ||
        (team !== "horizontal" && team !== "vertical") ||
        (room.game.lifecycle !== "QUESTION_READING" &&
          room.game.lifecycle !== "OPPONENT_CHANCE") ||
        (room.game.lifecycle === "OPPONENT_CHANCE" &&
          room.game.entitledTeam !== team)
      )
        throw new Error("HOST_TEAM_SELECTION_NOT_ALLOWED");
      room.game = reduceGame(room.game, { type: "BUZZ_ACCEPTED", team });
      room.buzzOpen = false;
      room.deadlineAt = undefined;
      room.buzzWinner = {
        displayName: room.config.teams[team],
        team,
        method: "host",
      };
      return;
    }
    if (intent.type === "PAUSE") {
      const canPreserveTimer =
        room.buzzOpen &&
        room.deadlineAt &&
        (room.game.lifecycle === "QUESTION_READING" ||
          room.game.lifecycle === "OPPONENT_CHANCE");
      room.pausedTimer = canPreserveTimer
        ? {
            remainingMs: Math.max(
              0,
              Date.parse(room.deadlineAt!) - this.clock().getTime(),
            ),
            buzzOpen: true,
          }
        : undefined;
      room.game = reduceGame(room.game, { type: "PAUSE" });
      room.buzzOpen = false;
      room.deadlineAt = undefined;
      return;
    }
    if (intent.type === "RESUME") {
      room.game = reduceGame(room.game, { type: "RESUME" });
      const pausedTimer = room.pausedTimer;
      room.pausedTimer = undefined;
      if (
        pausedTimer &&
        (room.game.lifecycle === "QUESTION_READING" ||
          room.game.lifecycle === "OPPONENT_CHANCE")
      ) {
        room.buzzOpen = pausedTimer.buzzOpen;
        room.deadlineAt = pausedTimer.buzzOpen
          ? new Date(
              this.clock().getTime() + pausedTimer.remainingMs,
            ).toISOString()
          : undefined;
      }
      return;
    }
    if (intent.type === "START_NEXT_ROUND") {
      await this.startBoard(room, true);
      return;
    }
    if (intent.type === "END_WITHOUT_WINNER") {
      if (!room.game.contentHold && room.game.lifecycle !== "QUESTION_FAILED")
        throw new Error("END_WITHOUT_WINNER_NOT_ALLOWED");
      room.game = {
        ...room.game,
        lifecycle: "MATCH_COMPLETE",
        answeringTeam: undefined,
        activeCellId: undefined,
        contentHold: undefined,
        endedWithoutWinner: true,
      };
      room.activeQuestion = undefined;
      room.buzzOpen = false;
      room.deadlineAt = undefined;
      room.buzzWinner = undefined;
      return;
    }
    if (
      (intent.type === "RETRY_CELL" || intent.type === "RETURN_CELL") &&
      room.game.lifecycle === "QUESTION_FAILED"
    ) {
      if (room.config.gameKind === "categories")
        await this.replaceFailedCategory(room);
      else if (
        room.game.board?.cells.find(
          (cell) => cell.id === room.game.activeCellId,
        )?.kind === "surprise"
      )
        await this.replaceFailedSurprise(room);
      room.game = reduceGame(room.game, { type: "RETURN_CELL" });
      room.activeQuestion = undefined;
      return;
    }
    if (intent.type === "SELECT_CELL") {
      room.game = reduceGame(room.game, {
        type: "SELECT_CELL",
        cellId: String(payload.cellId),
      });
      // Selecting a cell defines a new question boundary; it must never inherit
      // a previous prompt before the atomic reveal below.
      room.activeQuestion = undefined;
      await this.revealActiveCell(room);
      return;
    }
    if (intent.type === "LETTER_REVEALED") {
      await this.revealActiveCell(room);
      return;
    }
    const events: Record<
      Exclude<
        GameIntent["type"],
        | "LOBBY_SET_READY"
        | "LOBBY_ASSIGN_TEAM"
        | "LOBBY_ADD_MANUAL_PLAYER"
        | "START_MATCH"
        | "START_NEXT_ROUND"
        | "BUZZ"
        | "HOST_SELECT_TEAM"
        | "OPEN_QUESTION"
        | "LETTER_REVEALED"
        | "PAUSE"
        | "RESUME"
        | "SELECT_CELL"
        | "SET_AUDIENCE_QUESTION_VISIBILITY"
        | "END_WITHOUT_WINNER"
      >,
      () => GameEvent
    > = {
      ROUND_READY: () => ({ type: "ROUND_READY" }),
      JUDGE_CORRECT: () => ({ type: "JUDGE_CORRECT" }),
      JUDGE_INCORRECT: () => ({ type: "JUDGE_INCORRECT" }),
      RETRY_CELL: () => ({ type: "RETRY_CELL" }),
      RETURN_CELL: () => ({ type: "RETURN_CELL" }),
      AWARD_CELL: () => ({ type: "AWARD_CELL" }),
      CHECK_PATH: () => ({ type: "CHECK_PATH" }),
      BEGIN_CORRECTION: () => {
        const reason = String(payload.reason ?? "").trim();
        if (!reason) throw new Error("CORRECTION_REASON_REQUIRED");
        return {
          type: "BEGIN_CORRECTION",
          cellId: String(payload.cellId),
          owner:
            payload.owner === "horizontal" || payload.owner === "vertical"
              ? payload.owner
              : undefined,
          reason,
        };
      },
      CONFIRM_CORRECTION: () => ({ type: "CONFIRM_CORRECTION" }),
      CANCEL_CORRECTION: () => ({ type: "CANCEL_CORRECTION" }),
    };
    const event = events[intent.type as keyof typeof events]?.();
    if (!event) throw new Error("UNKNOWN_INTENT");
    room.game = reduceGame(room.game, event);
    if (intent.type === "JUDGE_CORRECT") this.finalizeCorrectAnswer(room);
    // Older clients can still submit this once from CELL_AWARDED. Finish its
    // path check here so a deployed UI never leaves a room at an action it no
    // longer renders.
    if (intent.type === "AWARD_CELL")
      room.game = reduceGame(room.game, { type: "CHECK_PATH" });
    if (["JUDGE_CORRECT", "JUDGE_INCORRECT"].includes(intent.type)) {
      room.buzzOpen = false;
      room.deadlineAt = undefined;
    }
    if (
      intent.type === "JUDGE_INCORRECT" &&
      room.game.lifecycle === "OPPONENT_CHANCE"
    ) {
      room.buzzOpen = true;
      room.deadlineAt = new Date(
        this.clock().getTime() + room.config.opponentSeconds * 1000,
      ).toISOString();
      room.buzzWinner = undefined;
    }
    if (intent.type === "RETRY_CELL") this.openQuestionBuzzer(room);
  }
  /** Award and path evaluation are one authoritative consequence of a correct judgment. */
  private finalizeCorrectAnswer(room: Room): void {
    if (room.config.modality === "charades") {
      const winner = room.game.answeringTeam!;
      const version =
        room.game.roundOutcomeHistory
          .filter((entry) => entry.round === room.game.currentRound)
          .reduce((latest, entry) => Math.max(latest, entry.version), 0) + 1;
      room.game = {
        ...room.game,
        lifecycle: "ROUND_COMPLETE",
        questionScores: {
          ...room.game.questionScores,
          [winner]: room.game.questionScores[winner] + 1,
        },
        roundOutcomeHistory: [
          ...room.game.roundOutcomeHistory,
          { round: room.game.currentRound, version, winner },
        ],
        answeringTeam: undefined,
        activeCellId: undefined,
      };
      return;
    }
    room.game = reduceGame(room.game, { type: "AWARD_CELL" });
    room.game = reduceGame(room.game, { type: "CHECK_PATH" });
  }
  /** Keeps old LETTER_REVEAL rooms recoverable while new SELECT_CELL intents reveal atomically. */
  private async revealActiveCell(room: Room): Promise<void> {
    const cell = room.game.board?.cells.find(
      (value) => value.id === room.game.activeCellId,
    );
    const questionMustBeSelectedNow =
      !room.activeQuestion ||
      (cell?.kind === "surprise" && !cell.revealedLetter);
    if (cell?.kind === "surprise" && !cell.revealedLetter) {
      const letter = room.surpriseLetters.shift();
      if (!letter) throw new Error("NO_UNUSED_SURPRISE_LETTER");
      room.game = {
        ...room.game,
        board: revealSurprise(room.game.board!, cell.id, letter),
      };
    }
    room.game = reduceGame(room.game, { type: "LETTER_REVEALED" });
    if (questionMustBeSelectedNow) await this.assignQuestion(room);
    this.openQuestionBuzzer(room);
  }
  private async assignQuestion(room: Room): Promise<void> {
    const questions = await this.questions(room.demo);
    const cell = room.game.board?.cells.find(
      (value) => value.id === room.game.activeCellId,
    );
    if (!cell || !room.questionSelection)
      throw new Error("QUESTION_SELECTION_NOT_INITIALIZED");
    const promoted = promoteReservedQuestion(
      questions,
      room.questionSelection,
      cell.id,
    );
    const selected =
      promoted ??
      (room.config.gameKind === "categories"
        ? selectCategoryQuestion(
            questions,
            room.questionSelection,
            cell.categoryId ?? "",
          )
        : selectMatchQuestion(
            questions,
            room.questionSelection,
            cell.revealedLetter ?? cell.visibleValue ?? "",
          ));
    room.activeQuestion = selected.question as StoredQuestion;
    room.questionSelection = selected.selection;
  }
  private async replaceFailedCategory(room: Room): Promise<void> {
    const cell = room.game.board?.cells.find(
      (value) => value.id === room.game.activeCellId,
    );
    if (!cell?.categoryId || !room.questionSelection || !room.game.board)
      throw new Error("CONTENT_EXHAUSTED");
    const questions = await this.questions(
      room.demo,
      room.questionSourceSnapshot,
    );
    const alternatives = room.config.categories
      .filter((id) => id !== cell.categoryId)
      .sort();
    let selected: ReturnType<typeof reserveQuestionForCell> | undefined;
    for (const categoryId of alternatives)
      try {
        selected = reserveQuestionForCell(
          questions,
          room.questionSelection,
          categoryId,
          cell.id,
        );
        break;
      } catch {
        /* try next eligible category */
      }
    if (!selected) throw new Error("CONTENT_EXHAUSTED");
    const label = room.config.categorySnapshot?.find(
      (item) => item.id === selected.question.categoryId,
    )?.labelAr;
    if (!label) throw new Error("CATEGORY_SNAPSHOT_INVALID");
    const occurrence =
      (room.categoryOccurrences?.[selected.question.categoryId] ?? 0) + 1;
    room.questionSelection = selected.selection;
    room.categoryOccurrences = {
      ...(room.categoryOccurrences ?? {}),
      [selected.question.categoryId]: occurrence,
    };
    room.game = {
      ...room.game,
      board: {
        ...room.game.board,
        cells: room.game.board.cells.map((item) =>
          item.id === cell.id
            ? {
                ...item,
                categoryId: selected!.question.categoryId,
                categoryLabelAr: label,
                categoryOccurrence: occurrence,
                visibleValue: String(occurrence),
              }
            : item,
        ),
      },
    };
  }
  private async replaceFailedSurprise(room: Room): Promise<void> {
    const cell = room.game.board?.cells.find(
      (value) => value.id === room.game.activeCellId,
    );
    if (
      !cell ||
      cell.kind !== "surprise" ||
      !room.questionSelection ||
      !room.game.board
    )
      throw new Error("CONTENT_EXHAUSTED");
    const questions = await this.questions(
      room.demo,
      room.questionSourceSnapshot,
    );
    const used = new Set(
      room.game.board.cells.flatMap((item) =>
        item.kind === "letter"
          ? [item.visibleValue]
          : item.revealedLetter
            ? [item.revealedLetter]
            : [],
      ),
    );
    const candidates = Object.keys(room.questionSelection.queues)
      .filter((letter) => letter !== cell.revealedLetter && !used.has(letter))
      .sort();
    let selected: ReturnType<typeof reserveQuestionForCell> | undefined;
    let letter: string | undefined;
    for (const candidate of candidates)
      try {
        selected = reserveQuestionForCell(
          questions,
          room.questionSelection,
          candidate,
          cell.id,
        );
        letter = candidate;
        break;
      } catch {
        /* retain explicit exhaustion state */
      }
    if (!selected || !letter) throw new Error("CONTENT_EXHAUSTED");
    room.questionSelection = selected.selection;
    room.game = {
      ...room.game,
      board: {
        ...room.game.board,
        cells: room.game.board.cells.map((item) =>
          item.id === cell.id ? { ...item, revealedLetter: letter } : item,
        ),
      },
    };
  }
  questionInventory() {
    return this.localFirestoreQuestionSource?.inventory;
  }
  private firestoreQuestions(snapshot?: string): StoredQuestion[] {
    if (
      !this.localFirestoreQuestionSource ||
      snapshot !== this.localFirestoreQuestionSource.snapshotId
    )
      throw new Error("QUESTION_SOURCE_SNAPSHOT_UNAVAILABLE");
    return this.localFirestoreQuestionSource.questions as StoredQuestion[];
  }
  private async fileQuestions(demo: boolean): Promise<StoredQuestion[]> {
    const file = demo
      ? join(process.cwd(), "content", "questions", "drafts", "questions.jsonl")
      : join(
          process.cwd(),
          "content",
          "questions",
          "approved",
          "questions.jsonl",
        );
    const content = await readFile(file, "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const question = JSON.parse(line) as Partial<StoredQuestion>;
        return {
          ...question,
          modality: question.modality ?? "classic",
          answerConceptId: question.answerConceptId ?? `legacy:${question.id}`,
        } as StoredQuestion;
      })
      .filter((question) => demo || question.status === "approved");
  }
  private async questions(
    demo: boolean,
    snapshot?: string,
  ): Promise<StoredQuestion[]> {
    if (snapshot) return this.firestoreQuestions(snapshot);
    if (demo && this.localFirestoreQuestionSource)
      return this.firestoreQuestions(
        this.localFirestoreQuestionSource.snapshotId,
      );
    return this.fileQuestions(demo);
  }
  private questionsSync(demo: boolean, snapshot?: string): StoredQuestion[] {
    if (snapshot) return this.firestoreQuestions(snapshot);
    if (demo && this.localFirestoreQuestionSource)
      return this.firestoreQuestions(
        snapshot ?? this.localFirestoreQuestionSource.snapshotId,
      );
    const file = demo
      ? join(process.cwd(), "content", "questions", "drafts", "questions.jsonl")
      : join(
          process.cwd(),
          "content",
          "questions",
          "approved",
          "questions.jsonl",
        );
    try {
      return readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const question = JSON.parse(line) as Partial<StoredQuestion>;
          return {
            ...question,
            modality: question.modality ?? "classic",
            answerConceptId:
              question.answerConceptId ?? `legacy:${question.id}`,
          } as StoredQuestion;
        })
        .filter((question) => demo || question.status === "approved");
    } catch {
      return [];
    }
  }
  /** Reject an unusable category scope before it can create a lobby that will fail on start. */
  private requirePlayableQuestionScope(
    demo: boolean,
    categories: string[],
    modality: MatchConfig["modality"],
    gameKind: MatchConfig["gameKind"] = "huroof",
  ): void {
    if (modality === "charades") return;
    try {
      if (gameKind === "categories")
        createCategoryQuestionSelection(this.questionsSync(demo), {
          categories,
          modality: "classic",
          seed: 0,
        });
      else
        createMatchQuestionSelection(this.questionsSync(demo), {
          categories,
          modality,
          seed: 0,
          reservePerLetter: demo ? 1 : 3,
        });
    } catch (reason) {
      if (
        reason instanceof Error &&
        /^Insufficient (?:16 visible \+ 9 surprise letter coverage|concept reserve)/.test(
          reason.message,
        )
      )
        throw new Error("QUESTION_SCOPE_INSUFFICIENT_COVERAGE");
      throw reason;
    }
  }
  private startBlockedReason(room: Room): string | undefined {
    if (!room.demo && !this.questionsSync(false).length)
      return "NO_APPROVED_QUESTION_STOCK";
    const players = room.members.filter((member) => member.role === "player");
    const manual = room.manualParticipants ?? [];
    const teams = [
      ...players.map((member) => member.team),
      ...manual.map((participant) => participant.team),
    ];
    if (!teams.length) return undefined;
    if (
      teams.length < 2 ||
      !teams.includes("horizontal") ||
      !teams.includes("vertical")
    )
      return "LOBBY_NEEDS_TWO_TEAMS";
    if (players.some((member) => !member.ready))
      return "LOBBY_ALL_MEMBERS_MUST_BE_READY";
    return undefined;
  }
  private participantCount(room: Room) {
    return (
      room.members.filter((member) => member.role === "player").length +
      (room.manualParticipants?.length ?? 0)
    );
  }
  private memberTeam(room: Room): TeamAxis {
    const horizontal =
      room.members.filter(
        (member) => member.role === "player" && member.team === "horizontal",
      ).length +
      (room.manualParticipants ?? []).filter(
        (participant) => participant.team === "horizontal",
      ).length;
    const vertical = this.participantCount(room) - horizontal;
    return horizontal <= vertical ? "horizontal" : "vertical";
  }
  /** Local-admin boundary: answer-bearing drafts are read by the server, never bundled into Vite. */
  async adminQuestions(): Promise<StoredQuestion[]> {
    return [...this.store.adminDrafts(), ...(await this.fileQuestions(true))];
  }
  async adminQuestion(id: string): Promise<StoredQuestion | undefined> {
    return (await this.adminQuestions()).find((question) => question.id === id);
  }
  /** Imported intake records have a dedicated private review route and never flow through legacy admin APIs. */
  async legacyAdminQuestions(): Promise<StoredQuestion[]> {
    return (await this.adminQuestions()).filter(
      (question) => !("importSource" in question),
    );
  }
  async legacyAdminQuestion(id: string): Promise<StoredQuestion | undefined> {
    return (await this.legacyAdminQuestions()).find(
      (question) => question.id === id,
    );
  }
  saveAdminDraft(input: Record<string, unknown>): {
    id: string;
    status: "draft";
  } {
    const id =
      typeof input.id === "string" && input.id
        ? input.id
        : `local-${randomUUID()}`;
    const existing = this.store
      .adminDrafts()
      .find((question) => question.id === id);
    // Imported T16 rows are immutable intake evidence. Ordinary local drafts retain
    // their existing write behavior, but a client cannot turn this convention off.
    if (existing?.readOnly === true)
      throw new Error("IMPORTED_DRAFT_READ_ONLY");
    const draft = { ...input, id, status: "draft", updatedAt: this.now() };
    this.store.saveAdminDraft(id, draft, this.now());
    return { id, status: "draft" };
  }
  private require(capability: Capability, role: ClientRole): void {
    if (capability.role !== role) throw new Error("FORBIDDEN_ROLE");
  }
  private commit(
    room: Room,
    type: string,
    actor: string,
    payload: unknown,
    intentId?: string,
    intentHash?: string,
  ): void {
    room.revision++;
    if (intentId) {
      room.intentIds[intentId] = room.revision;
      if (intentHash)
        room.intentHashes = {
          ...(room.intentHashes ?? {}),
          [intentId]: intentHash,
        };
    }
    const audit = {
      revision: room.revision,
      type,
      at: this.now(),
      actor,
      payload,
    };
    room.audit.push(audit);
    this.store.save(room);
    this.store.event(room, audit, audit.at);
  }
  project(room: Room, capability: Capability): ProjectionEnvelope {
    const member = room.members.find((value) => value.uid === capability.uid);
    const isHost = capability.role === "host";
    const questionVisible =
      room.game.lifecycle === "QUESTION_READING" ||
      room.game.lifecycle === "FIRST_ANSWER" ||
      room.game.lifecycle === "OPPONENT_CHANCE" ||
      room.game.lifecycle === "QUESTION_FAILED";
    const startBlockedReason =
      room.game.lifecycle === "LOBBY"
        ? this.startBlockedReason(room)
        : undefined;
    const match = deriveMatch(room.game);
    const matchRule =
      room.ruleSet === "v2"
        ? {
            ruleSet: "v2" as const,
            victoryAr:
              "تنتهي المباراة بفوز فريق بجولتين متتاليتين أو بثلاث جولات إجمالاً",
          }
        : {
            ruleSet: "legacy-v1" as const,
            victoryAr: "غرفة قديمة محفوظة بقواعدها السابقة",
          };
    const manualParticipants = room.manualParticipants ?? [];
    const displayedMembers = [
      ...room.members.map(({ uid, displayName, team, ready, role }) => ({
        displayName,
        team,
        ready,
        role,
        ...(isHost ? { uid } : {}),
      })),
      ...manualParticipants.map((participant) => ({
        displayName: participant.displayName,
        team: participant.team,
        ready: true,
        role: "player" as const,
        participation: "manual" as const,
        ...(isHost ? { manualParticipantId: participant.id } : {}),
      })),
    ];
    const projection: SafeProjection & Record<string, unknown> = {
      room: {
        roomCode: room.code,
        state: room.game.lifecycle,
        readyCount:
          room.members.filter((value) => value.role === "player" && value.ready)
            .length + manualParticipants.length,
        memberCount: this.participantCount(room),
        teams: room.config.teams,
        members: displayedMembers,
        matchSettings: {
          demo: room.demo,
          gameKind: room.config.gameKind ?? "huroof",
          questionSeconds: room.config.questionSeconds,
          opponentSeconds: room.config.opponentSeconds,
          teams: room.config.teams,
          categories: room.config.categories,
          modality: room.config.modality,
          difficulty: room.config.difficulty,
          mode: room.config.mode,
          showQuestionOnAudience: room.config.showQuestionOnAudience !== false,
        },
        audienceQuestionVisible: room.config.showQuestionOnAudience !== false,
        canStart: !startBlockedReason,
        ...(startBlockedReason ? { startBlockedReason } : {}),
      },
      ...(room.demo ? { demo: true as const } : {}),
      matchRule,
      board: room.game.board?.cells.map((cell) => ({
        id: cell.id,
        q: cell.q,
        r: cell.r,
        kind: cell.kind,
        visibleValue: cell.visibleValue,
        ...(cell.categoryId ? { categoryId: cell.categoryId } : {}),
        ...(cell.categoryLabelAr
          ? { categoryLabelAr: cell.categoryLabelAr }
          : {}),
        ...(cell.categoryOccurrence
          ? { categoryOccurrence: cell.categoryOccurrence }
          : {}),
        ...(cell.revealedLetter ? { revealedLetter: cell.revealedLetter } : {}),
        ...(cell.owner ? { owner: cell.owner } : {}),
      })),
      activeCellId: room.game.activeCellId,
      currentRound: room.game.currentRound,
      questionScores: room.game.questionScores,
      roundWins: match.roundWins,
      currentStreak: match.currentStreak,
      roundResults: match.roundResults.map(({ round, winner }) => ({
        round,
        winner,
      })),
      ...(room.game.contentHold
        ? {
            contentHold: {
              reason: room.game.contentHold.reason,
              operation: room.game.contentHold.operation,
              ...(room.game.contentHold.cellId
                ? { cellId: room.game.contentHold.cellId }
                : {}),
            },
          }
        : {}),
      ...(room.game.endedWithoutWinner ? { endedWithoutWinner: true } : {}),
      ...(match.matchWinner
        ? {
            matchWinner: match.matchWinner,
            matchWinReason: match.matchWinReason,
          }
        : {}),
      entitledTeam: room.game.entitledTeam,
      answeringTeam: room.game.answeringTeam,
      winningPath: room.game.winningPath,
      ...(room.deadlineAt
        ? { deadlineAt: room.deadlineAt, buzzOpen: room.buzzOpen }
        : {}),
      ...(room.buzzWinner &&
      (capability.role === "host" || capability.role === "audience")
        ? {
            buzzWinner: {
              displayName: room.buzzWinner.displayName,
              team: room.buzzWinner.team,
              method: room.buzzWinner.method,
            },
          }
        : {}),
      ...(capability.role === "audience"
        ? {}
        : {
            self: {
              uid: capability.uid,
              ready: member?.ready ?? false,
              team: member?.team,
              canBuzz:
                capability.role === "player" &&
                !room.buzzWinner &&
                Boolean(room.buzzOpen) &&
                (room.game.lifecycle === "QUESTION_READING" ||
                  (room.game.lifecycle === "OPPONENT_CHANCE" &&
                    member?.team === room.game.entitledTeam)),
              ...(room.buzzWinner?.method === "player" &&
              room.buzzWinner.uid === capability.uid
                ? { isBuzzWinner: true }
                : {}),
            },
          }),
    };
    if (questionVisible && room.activeQuestion)
      projection.question = {
        headerAr: room.activeQuestion.headerAr,
        promptAr: room.activeQuestion.promptAr,
        ...(capability.role !== "player" &&
        (capability.role === "host" ||
          room.config.showQuestionOnAudience !== false) &&
        room.activeQuestion.media
          ? { media: room.activeQuestion.media }
          : {}),
      };
    if (room.game.lifecycle === "QUESTION_FAILED" && room.activeQuestion)
      projection.question = {
        ...(projection.question as object),
        revealedAnswer: room.activeQuestion.canonicalAnswer,
      };
    if (isHost) {
      if (room.activeQuestion)
        projection.question = {
          headerAr: room.activeQuestion.headerAr,
          promptAr: room.activeQuestion.promptAr,
          ...(questionVisible && room.activeQuestion.media
            ? { media: room.activeQuestion.media }
            : {}),
          primaryAnswer: room.activeQuestion.canonicalAnswer,
          acceptedAnswers: room.activeQuestion.acceptedAnswers,
          sources: room.activeQuestion.sources ?? [],
          moderation: { status: room.activeQuestion.status },
        };
      if (room.game.correction)
        projection.correction = {
          ...room.game.correction,
          priorOwner: room.game.board?.cells.find(
            (cell) => cell.id === room.game.correction?.cellId,
          )?.owner,
        };
      projection.audit = room.audit.slice(-20);
    }
    return {
      roomId: room.id,
      revision: room.revision,
      serverTime: this.now(),
      role: capability.role,
      projection,
    };
  }
}
