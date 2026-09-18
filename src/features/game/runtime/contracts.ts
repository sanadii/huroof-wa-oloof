/** Vendor-neutral boundary defined by ADR-001. */
export type ClientRole = 'host' | 'player' | 'audience';
export type RoomState = import('../domain/lifecycle.js').LifecycleState;

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
  matchSettings?: { demo: boolean; gameKind?: 'huroof' | 'categories'; questionSeconds: number; opponentSeconds: number; teams: { horizontal: string; vertical: string }; categories: string[]; modality: 'classic' | 'image' | 'charades'; difficulty: string; mode: 'classic' | 'fast' | 'custom'; showQuestionOnAudience?: boolean; expectedRelease?: { releaseId: string; releaseRootSha256: string } };
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
  question?: { occurrence?: string; headerAr?: string; promptAr?: string; media?: { mediaId: string; assetSha256: string; altAr: string; type?: "image" | "video"; contentType?: string }; revealedAnswer?: string; primaryAnswer?: string; acceptedAnswers?: string[]; sources?: unknown[]; moderation?: unknown };
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
export type IntentType = 'LOBBY_SET_READY' | 'LOBBY_ASSIGN_TEAM' | 'LOBBY_ADD_MANUAL_PLAYER' | 'START_MATCH' | 'ROUND_READY' | 'SELECT_CELL' | 'LETTER_REVEALED' | 'OPEN_QUESTION' | 'BUZZ' | 'HOST_SELECT_TEAM' | 'JUDGE_CORRECT' | 'JUDGE_INCORRECT' | 'RETRY_CELL' | 'RETURN_CELL' | 'END_WITHOUT_WINNER' | 'AWARD_CELL' | 'CHECK_PATH' | 'START_NEXT_ROUND' | 'PAUSE' | 'RESUME' | 'BEGIN_CORRECTION' | 'CONFIRM_CORRECTION' | 'CANCEL_CORRECTION' | 'SET_AUDIENCE_QUESTION_VISIBILITY' | 'REVEAL_ANSWER';
export type GameIntent = {
  type: IntentType;
  intentId: string;
  expectedRevision: number;
  payload: Record<string, unknown>;
};

export interface CreateRoomRequest { displayName?: string; demo?: boolean; bestOf?: 1 | 3 | 5 | 7; questionSeconds?: number; opponentSeconds?: number; teams?: { horizontal?: string; vertical?: string }; categories?: string[]; modality?: 'classic' | 'image' | 'charades'; gameKind?: 'huroof' | 'categories'; difficulty?: string; mode?: 'classic' | 'fast' | 'custom'; showQuestionOnAudience?: boolean; expectedRelease?: { releaseId: string; releaseRootSha256: string }; }
/** Metadata-only active-release discovery. It deliberately contains no runtime questions or media bindings. */
export interface ApprovedReleaseCatalog {
  releaseId: string;
  releaseRootSha256: string;
  /** True only for the Firebase emulator's explicit fixture release. */
  demoFixture: boolean;
  categories: Array<{ id: string; labelAr: string; playable: { huroof: boolean; categories: boolean; charades: boolean } }>;
  boardCapabilities: { huroof: boolean; categories: boolean; charades: boolean };
}
export const isApprovedReleaseCatalog = (value: unknown): value is ApprovedReleaseCatalog => {
  if (!value || typeof value !== 'object') return false;
  const catalog = value as Partial<ApprovedReleaseCatalog>;
  if (typeof catalog.releaseId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(catalog.releaseId) || typeof catalog.releaseRootSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(catalog.releaseRootSha256) || typeof catalog.demoFixture !== 'boolean' || !Array.isArray(catalog.categories) || !catalog.boardCapabilities || typeof catalog.boardCapabilities.huroof !== 'boolean' || typeof catalog.boardCapabilities.categories !== 'boolean' || typeof catalog.boardCapabilities.charades !== 'boolean') return false;
  const ids = new Set<string>();
  for (const category of catalog.categories) {
    if (!category || typeof category.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(category.id) || typeof category.labelAr !== 'string' || !category.labelAr.trim() || !category.playable || typeof category.playable.huroof !== 'boolean' || typeof category.playable.categories !== 'boolean' || typeof category.playable.charades !== 'boolean' || ids.has(category.id)) return false;
    ids.add(category.id);
  }
  return ids.size > 0;
};
export interface JoinRoomRequest { roomCode: string; displayName: string; }
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
  joinRoom(request: JoinRoomRequest): Promise<{ roomId: string; revision: number; token?: string }>;
  joinAudience?(roomCode: string): Promise<{ roomId: string; revision: number; token?: string }>;
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
