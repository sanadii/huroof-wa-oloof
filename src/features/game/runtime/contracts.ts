/** Vendor-neutral boundary defined by ADR-001. */
import { isQuestionTypeCounts, type QuestionTypeCounts } from './question-type-counts.js';

export type ClientRole = 'host' | 'player' | 'audience';
export type RoomState = import('../domain/lifecycle.js').LifecycleState;
export const CHALLENGE_PROTOCOL_VERSION = 't36-challenge-runtime-v1' as const;
/** Capabilities are negotiated separately from the frozen T36 wire protocol. */
export const T37_DEFINITION_SCHEMA = 't37-clean70-challenge-definition-v1' as const;
export const T37_WORD_SEARCH_DEFINITION_SCHEMA = 't37-topup-word-search-definition-v1' as const;
export const T36_DEFINITION_SCHEMA = 't36-challenge-definition-v1' as const;
export type ChallengeMechanic = 'navigation' | 'missing_tile' | 'memory' | 'qatar_map' | 'word_search';
export type ChallengeDefinitionSchema = typeof T36_DEFINITION_SCHEMA | typeof T37_DEFINITION_SCHEMA | typeof T37_WORD_SEARCH_DEFINITION_SCHEMA;
export type ChallengeCapabilityOffer = { protocolVersion: typeof CHALLENGE_PROTOCOL_VERSION; mechanics: readonly ChallengeMechanic[]; definitionSchemas?: readonly ChallengeDefinitionSchema[] };
export const CLIENT_CHALLENGE_CAPABILITY: ChallengeCapabilityOffer = { protocolVersion: CHALLENGE_PROTOCOL_VERSION, mechanics: ['navigation', 'missing_tile', 'memory', 'qatar_map', 'word_search'], definitionSchemas: [T36_DEFINITION_SCHEMA, T37_DEFINITION_SCHEMA, T37_WORD_SEARCH_DEFINITION_SCHEMA] };

export interface SafeRoomSummary {
  roomCode: string;
  state: RoomState;
  readyCount: number;
  memberCount: number;
  buzzWinnerUid?: string;
  teams?: { horizontal: string; vertical: string };
  /** Member IDs are included only in the host projection for lobby assignments. */
  members?: Array<{
    uid?: string;
    /** Manual IDs are host-only targets and are never auth/member UIDs. */
    manualParticipantId?: string;
    participation?: 'manual';
    displayName: string;
    team?: 'horizontal' | 'vertical';
    ready: boolean;
    role: ClientRole;
  }>;
  matchSettings?: { demo: boolean; gameKind?: 'huroof' | 'categories'; questionSeconds: number; opponentSeconds: number; teams: { horizontal: string; vertical: string }; categories: string[]; modality: 'classic' | 'image' | 'charades'; difficulty: string; mode: 'classic' | 'fast' | 'custom'; showQuestionOnAudience?: boolean; labelledColours?: boolean; expectedRelease?: { releaseId: string; releaseRootSha256: string }; challenge?: ChallengeCapabilityOffer };
  /** Host-controlled room preference. Missing legacy values deliberately remain visible. */
  audienceQuestionVisible?: boolean;
  canStart?: boolean;
  startBlockedReason?: string;
}

/** This shape intentionally cannot represent answers, sources, or unrevealed letters. */
export interface SafeProjection {
  room: SafeRoomSummary;
  messageAr?: string;
  demo?: true;
  board?: Array<{ id: string; q: number; r: number; kind: 'letter' | 'surprise' | 'category'; visibleValue: string; revealedLetter?: string; categoryId?: string; categoryLabelAr?: string; categoryOccurrence?: number; owner?: 'horizontal' | 'vertical' }>;
  activeCellId?: string;
  deadlineAt?: string;
  buzzOpen?: boolean;
  matchRule?: { ruleSet: 'v2' | 'legacy-v1'; victoryAr: string };
  currentRound?: number;
  questionScores?: { horizontal: number; vertical: number };
  roundWins?: { horizontal: number; vertical: number };
  currentStreak?: { team?: 'horizontal' | 'vertical'; count: number };
  roundResults?: Array<{ round: number; winner: 'horizontal' | 'vertical' }>;
  matchWinner?: 'horizontal' | 'vertical';
  matchWinReason?: 'two_consecutive_round_wins' | 'three_total_round_wins';
  contentHold?: { reason: 'CONTENT_EXHAUSTED'; operation: 'SELECT_CELL' | 'START_NEXT_ROUND' | 'CONTINUE'; cellId?: string };
  endedWithoutWinner?: true;
  entitledTeam?: 'horizontal' | 'vertical';
  answeringTeam?: 'horizontal' | 'vertical';
  winningPath?: string[];
  correction?: { cellId: string; owner?: 'horizontal' | 'vertical'; priorOwner?: 'horizontal' | 'vertical'; reason: string };
  self?: { uid: string; ready: boolean; team?: 'horizontal' | 'vertical'; canBuzz: boolean; isBuzzWinner?: boolean };
  /** Public only for host/audience; players learn only whether they themselves won. */
  buzzWinner?: { displayName: string; team: 'horizontal' | 'vertical'; method: 'player' | 'host' };
  /** Immutable identity only. A delivery grant is authorized separately. */
  question?: { occurrence?: string; headerAr?: string; promptAr?: string; media?: { mediaId: string; assetSha256: string; altAr: string; type?: "image" | "video"; contentType?: string; audiencePresentation?: "clear" | "concealed" }; revealedAnswer?: string; primaryAnswer?: string; acceptedAnswers?: string[]; sources?: unknown[]; moderation?: unknown };
  /** Strict allowlisted challenge delivery; it cannot represent private grading or source assets. */
  challenge?: import('../challenges/integration.js').ChallengeProjection;
}

export interface ProjectionEnvelope<TProjection extends SafeProjection = SafeProjection> {
  roomId: string;
  revision: number;
  serverTime: string;
  role: ClientRole;
  projection: TProjection;
  /**
   * Firebase marks cached snapshots until Firestore confirms a server read.
   * Cached projections remain safe to render, but cannot authorize a revisioned
   * game intent.
   */
  authoritative?: boolean;
}

/** TIME_EXPIRED is deliberately absent: only the server clock may emit it. */
export type IntentType = 'LOBBY_SET_READY' | 'LOBBY_ASSIGN_TEAM' | 'LOBBY_ADD_MANUAL_PLAYER' | 'START_MATCH' | 'ROUND_READY' | 'SELECT_CELL' | 'LETTER_REVEALED' | 'OPEN_QUESTION' | 'BUZZ' | 'HOST_SELECT_TEAM' | 'JUDGE_CORRECT' | 'JUDGE_INCORRECT' | 'RETRY_CELL' | 'RETURN_CELL' | 'END_WITHOUT_WINNER' | 'AWARD_CELL' | 'CHECK_PATH' | 'START_NEXT_ROUND' | 'PAUSE' | 'RESUME' | 'BEGIN_CORRECTION' | 'CONFIRM_CORRECTION' | 'CANCEL_CORRECTION' | 'SET_AUDIENCE_QUESTION_VISIBILITY' | 'REVEAL_ANSWER' | 'CHALLENGE_ASSIGN' | 'CHALLENGE_READY' | 'CHALLENGE_START' | 'CHALLENGE_MOVE' | 'CHALLENGE_SUBMIT' | 'CHALLENGE_START_STEAL' | 'CHALLENGE_DECLINE_STEAL' | 'CHALLENGE_PAUSE' | 'CHALLENGE_RESUME' | 'CHALLENGE_VOID' | 'CHALLENGE_REVEAL' | 'CHALLENGE_CONTINUE';
export type GameIntent = {
  type: IntentType;
  intentId: string;
  expectedRevision: number;
  payload: Record<string, unknown>;
};

export interface CreateRoomRequest { displayName?: string; demo?: boolean; bestOf?: 1 | 3 | 5 | 7; questionSeconds?: number; opponentSeconds?: number; teams?: { horizontal?: string; vertical?: string }; categories?: string[]; modality?: 'classic' | 'image' | 'charades'; gameKind?: 'huroof' | 'categories'; difficulty?: string; mode?: 'classic' | 'fast' | 'custom'; showQuestionOnAudience?: boolean; labelledColours?: boolean; /** Pinned at room creation; absent legacy rooms are ordinary. */ mapPresentation?: 'ordinary' | 'interactive'; /** Server-issued, opaque, flags-off QA permit reference. */ qaChallengePermitId?: string; expectedRelease?: { releaseId: string; releaseRootSha256: string }; challenge?: ChallengeCapabilityOffer; }
/** Metadata-only active-release discovery. It deliberately contains no runtime questions or media bindings. */
export interface ApprovedReleaseCatalog {
  releaseId: string;
  releaseRootSha256: string;
  /** True only for the Firebase emulator's explicit fixture release. */
  demoFixture: boolean;
  /** Challenge data remains metadata-only. M6 publishers may pin a category's kinds here. */
  categories: Array<{ id: string; labelAr: string; playable: { huroof: boolean; categories: boolean; charades: boolean }; /** Absent when this release has no verified type-index sidecar. */ questionTypeCounts?: QuestionTypeCounts; /** Hidden until every required mechanic is enabled. */ challengeOnly?: boolean; challengeKinds?: ChallengeMechanic[] }>;
  boardCapabilities: { huroof: boolean; categories: boolean; charades: boolean };
  /** Current runtime flags, projected without reading any canonical questions. */
  challengeAvailability?: { enabledMechanics: ChallengeMechanic[] };
}
export const isApprovedReleaseCatalog = (value: unknown): value is ApprovedReleaseCatalog => {
  if (!value || typeof value !== 'object') return false;
  const catalog = value as Partial<ApprovedReleaseCatalog>;
  if (typeof catalog.releaseId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(catalog.releaseId) || typeof catalog.releaseRootSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(catalog.releaseRootSha256) || typeof catalog.demoFixture !== 'boolean' || !Array.isArray(catalog.categories) || !catalog.boardCapabilities || typeof catalog.boardCapabilities.huroof !== 'boolean' || typeof catalog.boardCapabilities.categories !== 'boolean' || typeof catalog.boardCapabilities.charades !== 'boolean') return false;
  const ids = new Set<string>();
  const isChallengeMechanic = (value: unknown): value is ChallengeMechanic => value === 'navigation' || value === 'missing_tile' || value === 'memory' || value === 'qatar_map' || value === 'word_search';
  for (const category of catalog.categories) {
    if (!category || typeof category.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(category.id) || typeof category.labelAr !== 'string' || !category.labelAr.trim() || !category.playable || typeof category.playable.huroof !== 'boolean' || typeof category.playable.categories !== 'boolean' || typeof category.playable.charades !== 'boolean' || ids.has(category.id)) return false;
    if (category.questionTypeCounts !== undefined && !isQuestionTypeCounts(category.questionTypeCounts)) return false;
    if (category.challengeOnly !== undefined && typeof category.challengeOnly !== 'boolean') return false;
    if (category.challengeOnly === true && (!Array.isArray(category.challengeKinds) || category.challengeKinds.length === 0)) return false;
    if (category.challengeKinds !== undefined && (!Array.isArray(category.challengeKinds) || category.challengeKinds.some((kind) => !isChallengeMechanic(kind)) || new Set(category.challengeKinds).size !== category.challengeKinds.length)) return false;
    ids.add(category.id);
  }
  if (catalog.challengeAvailability !== undefined && (!catalog.challengeAvailability || !Array.isArray(catalog.challengeAvailability.enabledMechanics) || catalog.challengeAvailability.enabledMechanics.some((kind) => !isChallengeMechanic(kind)) || new Set(catalog.challengeAvailability.enabledMechanics).size !== catalog.challengeAvailability.enabledMechanics.length)) return false;
  return ids.size > 0;
};
export interface JoinRoomRequest { roomCode: string; displayName: string; challenge?: ChallengeCapabilityOffer; }
export type PlayerPresenceState = 'connected' | 'disconnected' | 'unknown';
export interface HostPresenceSnapshot {
  roomId: string;
  serverTime: string;
  /** Echoed only for a host-requested local refresh; never an actor identity. */
  refreshId?: string;
  players: Record<string, { state: PlayerPresenceState; lastSeen?: string }>;
}

export interface GameRuntimeAdapter {
  readonly kind: 'fixture' | 'firebase' | 'local';
  createRoom(request: CreateRoomRequest): Promise<{ roomId: string; roomCode: string; revision: number; token?: string }>;
  /** Firebase obtains this through an authenticated App Check callable; local/fixture do not need it. */
  getApprovedReleaseCatalog?(): Promise<ApprovedReleaseCatalog>;
  /** Local runtime flags are metadata only; room creation remains authoritative. */
  getChallengeAvailability?(): Promise<{ enabledMechanics: ChallengeMechanic[] }>;
  joinRoom(request: JoinRoomRequest): Promise<{ roomId: string; revision: number; token?: string }>;
  joinAudience?(roomCode: string, challenge?: ChallengeCapabilityOffer): Promise<{ roomId: string; revision: number; token?: string }>;
  /** Reconnect handshake also returns a fresh authority clock sample for deadline-only client masking. */
  resumeRoom?(roomId: string, challenge?: ChallengeCapabilityOffer): Promise<{ revision: number; serverTime?: string }>;
  syncDeadline?(roomId: string): Promise<{ revision: number; expired: boolean }>;
  submitGameIntent(roomId: string, intent: GameIntent): Promise<{ revision: number; replayed: boolean }>;
  subscribeProjection(roomId: string, role: ClientRole, uid: string, onProjection: (value: ProjectionEnvelope) => void, onError?: (error: Error) => void): () => void;
  subscribeHostPresence?(roomId: string, onPresence: (value: HostPresenceSnapshot) => void, onError?: (error: Error) => void): () => void;
  startPlayerPresence?(roomId: string, onError?: (error: Error) => void): () => void;
  /** Returns bytes for the current immutable media binding as a revocable local URL. */
  getCurrentQuestionMedia?(request: { roomId: string; mediaId: string; assetSha256: string }): Promise<{ mediaId: string; assetSha256: string; url: string; expiresAt: string }>;
  /** Restores a route-owned local capability after a page load without exposing it in a projection. */
  setCapabilityToken?(token: string): void;
}
