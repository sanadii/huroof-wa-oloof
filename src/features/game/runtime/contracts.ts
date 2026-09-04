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
  members?: Array<{ displayName: string; team?: 'horizontal' | 'vertical'; ready: boolean; role: ClientRole }>;
  matchSettings?: { demo: boolean; questionSeconds: number; opponentSeconds: number; teams: { horizontal: string; vertical: string }; categories: string[]; modality: 'classic' | 'image'; difficulty: string; mode: 'classic' | 'fast' | 'custom' };
  canStart?: boolean;
  startBlockedReason?: string;
}

/** This shape intentionally cannot represent answers, sources, or unrevealed letters. */
export interface SafeProjection {
  room: SafeRoomSummary;
  messageAr?: string;
  demo?: true;
  board?: Array<{ id: string; q: number; r: number; kind: 'letter' | 'surprise'; visibleValue: string; revealedLetter?: string; owner?: 'horizontal' | 'vertical' }>;
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
  entitledTeam?: 'horizontal' | 'vertical';
  answeringTeam?: 'horizontal' | 'vertical';
  winningPath?: string[];
  correction?: { cellId: string; owner?: 'horizontal' | 'vertical'; priorOwner?: 'horizontal' | 'vertical'; reason: string };
  self?: { uid: string; ready: boolean; team?: 'horizontal' | 'vertical'; canBuzz: boolean; isBuzzWinner?: boolean };
  /** Public only for host/audience; players learn only whether they themselves won. */
  buzzWinner?: { displayName: string; team: 'horizontal' | 'vertical'; method: 'player' | 'host' };
}

export interface ProjectionEnvelope<TProjection extends SafeProjection = SafeProjection> {
  roomId: string;
  revision: number;
  serverTime: string;
  role: ClientRole;
  projection: TProjection;
}

/** TIME_EXPIRED is deliberately absent: only the server clock may emit it. */
export type IntentType = 'LOBBY_SET_READY' | 'START_MATCH' | 'ROUND_READY' | 'SELECT_CELL' | 'LETTER_REVEALED' | 'OPEN_QUESTION' | 'BUZZ' | 'HOST_SELECT_TEAM' | 'JUDGE_CORRECT' | 'JUDGE_INCORRECT' | 'RETRY_CELL' | 'RETURN_CELL' | 'AWARD_CELL' | 'CHECK_PATH' | 'START_NEXT_ROUND' | 'PAUSE' | 'RESUME' | 'BEGIN_CORRECTION' | 'CONFIRM_CORRECTION' | 'CANCEL_CORRECTION';
export type GameIntent = {
  type: IntentType;
  intentId: string;
  expectedRevision: number;
  payload: Record<string, unknown>;
};

export interface CreateRoomRequest { displayName?: string; demo?: boolean; bestOf?: 1 | 3 | 5 | 7; questionSeconds?: number; opponentSeconds?: number; teams?: { horizontal?: string; vertical?: string }; categories?: string[]; difficulty?: string; mode?: 'classic' | 'fast' | 'custom'; }
export interface JoinRoomRequest { roomCode: string; displayName?: string; }

export interface GameRuntimeAdapter {
  readonly kind: 'fixture' | 'firebase' | 'local';
  createRoom(request: CreateRoomRequest): Promise<{ roomId: string; roomCode: string; revision: number; token?: string }>;
  joinRoom(request: JoinRoomRequest): Promise<{ roomId: string; revision: number; token?: string }>;
  joinAudience?(roomCode: string): Promise<{ roomId: string; revision: number; token?: string }>;
  syncDeadline?(roomId: string): Promise<{ revision: number; expired: boolean }>;
  submitGameIntent(roomId: string, intent: GameIntent): Promise<{ revision: number; replayed: boolean }>;
  subscribeProjection(roomId: string, role: ClientRole, uid: string, onProjection: (value: ProjectionEnvelope) => void, onError?: (error: Error) => void): () => void;
}
