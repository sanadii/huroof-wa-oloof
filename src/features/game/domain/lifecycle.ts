import { type GameBoard, type TeamAxis, withOwner, findWinningPath } from './board.js';

export const LIFECYCLE_STATES = ['LOBBY', 'ROUND_SETUP', 'CELL_SELECTION', 'LETTER_REVEAL', 'QUESTION_READING', 'FIRST_ANSWER', 'OPPONENT_CHANCE', 'QUESTION_FAILED', 'CELL_AWARDED', 'PATH_CHECK', 'ROUND_COMPLETE', 'MATCH_COMPLETE', 'PAUSED', 'CORRECTION'] as const;
export type LifecycleState = typeof LIFECYCLE_STATES[number];
export type RuleSet = 'v2' | 'legacy-v1';
export type MatchWinReason = 'two_consecutive_round_wins' | 'three_total_round_wins';
export type RoundOutcomeRecord = { round: number; version: number; winner?: TeamAxis; winningPath?: string[] };
export type EffectiveRoundResult = { round: number; winner: TeamAxis; winningPath?: string[] };
export type CurrentStreak = { team?: TeamAxis; count: number };
export type DerivedMatch = {
  roundWins: Record<TeamAxis, number>;
  currentStreak: CurrentStreak;
  roundResults: EffectiveRoundResult[];
  matchWinner?: TeamAxis;
  matchWinReason?: MatchWinReason;
};

export interface GameState {
  lifecycle: LifecycleState;
  ruleSet: RuleSet;
  board?: GameBoard;
  activeCellId?: string;
  entitledTeam: TeamAxis;
  answeringTeam?: TeamAxis;
  winningPath?: string[];
  /** One accepted, finalized cell ownership is exactly one question point. */
  questionScores: Record<TeamAxis, number>;
  currentRound: number;
  /** Append-only; the latest version for each round is its effective result. */
  roundOutcomeHistory: RoundOutcomeRecord[];
  /** Explicitly grandfathered state only. v2 never reads or writes this counter. */
  legacyRoundWins?: Record<TeamAxis, number>;
  legacyBestOf?: 1 | 3 | 5 | 7;
  /** The second attempt is terminal on an incorrect judgment. */
  attempt: 'initial' | 'opponent';
  pausedFrom?: LifecycleState;
  correction?: { cellId: string; owner?: TeamAxis; reason: string };
  /** A persisted, non-scoring stop when pinned content cannot safely continue. */
  contentHold?: { reason: 'CONTENT_EXHAUSTED'; operation: 'SELECT_CELL' | 'START_NEXT_ROUND' | 'CONTINUE'; cellId?: string; heldAtRevision: number };
  /** A host may explicitly end an exhausted match without inventing a winner. Recovery creates a new room. */
  endedWithoutWinner?: true;
}

export type GameEvent =
  | { type: 'START_MATCH'; board: GameBoard } | { type: 'ROUND_READY' } | { type: 'SELECT_CELL'; cellId: string }
  | { type: 'LETTER_REVEALED' } | { type: 'OPEN_QUESTION' } | { type: 'BUZZ_ACCEPTED'; team: TeamAxis }
  | { type: 'JUDGE_CORRECT' } | { type: 'JUDGE_INCORRECT' } | { type: 'TIME_EXPIRED' } | { type: 'RETRY_CELL' }
  | { type: 'RETURN_CELL' } | { type: 'AWARD_CELL' } | { type: 'CHECK_PATH' }
  | { type: 'START_NEXT_ROUND'; board: GameBoard }
  | { type: 'PAUSE' } | { type: 'RESUME' } | { type: 'BEGIN_CORRECTION'; cellId: string; owner?: TeamAxis; reason: string }
  | { type: 'CONFIRM_CORRECTION' } | { type: 'CANCEL_CORRECTION' };

const emptyScores = (): Record<TeamAxis, number> => ({ horizontal: 0, vertical: 0 });
export const initialGameState = (): GameState => ({ lifecycle: 'LOBBY', ruleSet: 'v2', entitledTeam: 'horizontal', attempt: 'initial', questionScores: emptyScores(), currentRound: 0, roundOutcomeHistory: [] });
function reject(state: GameState, event: GameEvent): never { throw new Error(`Illegal transition: ${state.lifecycle} → ${event.type}`); }
function opposite(team: TeamAxis): TeamAxis { return team === 'horizontal' ? 'vertical' : 'horizontal'; }

/** The latest record per round is authoritative. Earlier records stay auditably append-only. */
export function effectiveRoundResults(history: RoundOutcomeRecord[]): EffectiveRoundResult[] {
  const latest = new Map<number, RoundOutcomeRecord>();
  for (const record of history) {
    const prior = latest.get(record.round);
    if (!prior || record.version >= prior.version) latest.set(record.round, record);
  }
  return [...latest.values()]
    .sort((a, b) => a.round - b.round || a.version - b.version)
    .filter((record): record is RoundOutcomeRecord & { winner: TeamAxis } => Boolean(record.winner))
    .map(({ round, winner, winningPath }) => ({ round, winner, ...(winningPath ? { winningPath } : {}) }));
}

/** Fold the effective sequence; no v2 round-win counter is stored or mutated. */
export function deriveMatch(state: Pick<GameState, 'ruleSet' | 'roundOutcomeHistory' | 'legacyRoundWins' | 'legacyBestOf'>): DerivedMatch {
  if (state.ruleSet === 'legacy-v1') {
    const roundWins = state.legacyRoundWins ?? emptyScores();
    const needed = Math.ceil((state.legacyBestOf ?? 3) / 2);
    const winner = roundWins.horizontal >= needed && roundWins.horizontal > roundWins.vertical ? 'horizontal' : roundWins.vertical >= needed && roundWins.vertical > roundWins.horizontal ? 'vertical' : undefined;
    return { roundWins, currentStreak: { count: 0 }, roundResults: [], ...(winner ? { matchWinner: winner, matchWinReason: 'three_total_round_wins' as const } : {}) };
  }

  const roundWins = emptyScores();
  let streak: CurrentStreak = { count: 0 };
  let matchWinner: TeamAxis | undefined;
  let matchWinReason: MatchWinReason | undefined;
  const roundResults = effectiveRoundResults(state.roundOutcomeHistory);
  for (const result of roundResults) {
    roundWins[result.winner] += 1;
    streak = streak.team === result.winner ? { team: result.winner, count: streak.count + 1 } : { team: result.winner, count: 1 };
    if (!matchWinner && streak.count >= 2) { matchWinner = result.winner; matchWinReason = 'two_consecutive_round_wins'; }
    if (!matchWinner && roundWins[result.winner] >= 3) { matchWinner = result.winner; matchWinReason = 'three_total_round_wins'; }
  }
  return { roundWins, currentStreak: streak, roundResults, ...(matchWinner ? { matchWinner, matchWinReason } : {}) };
}

function appendRoundOutcome(state: GameState, winner: TeamAxis | undefined, winningPath?: string[]): GameState {
  if (state.ruleSet === 'legacy-v1') return { ...state, legacyRoundWins: { ...(state.legacyRoundWins ?? emptyScores()), ...(winner ? { [winner]: (state.legacyRoundWins ?? emptyScores())[winner] + 1 } : {}) } };
  const version = state.roundOutcomeHistory.filter((record) => record.round === state.currentRound).reduce((latest, record) => Math.max(latest, record.version), 0) + 1;
  return { ...state, roundOutcomeHistory: [...state.roundOutcomeHistory, { round: state.currentRound, version, ...(winner ? { winner } : {}), ...(winningPath ? { winningPath } : {}) }] };
}

function replaceCurrentRoundOutcome(state: GameState, winner: TeamAxis | undefined, winningPath: string[] | undefined, priorWinner?: TeamAxis): GameState {
  if (state.ruleSet === 'legacy-v1') {
    const legacyRoundWins = { ...(state.legacyRoundWins ?? emptyScores()) };
    if (priorWinner) legacyRoundWins[priorWinner] = Math.max(0, legacyRoundWins[priorWinner] - 1);
    if (winner) legacyRoundWins[winner] += 1;
    return { ...state, legacyRoundWins };
  }
  return appendRoundOutcome(state, winner, winningPath);
}

function currentRoundOutcome(state: GameState): { winner?: TeamAxis; winningPath?: string[] } {
  if (state.ruleSet === 'legacy-v1') {
    const winner = state.winningPath ? state.board?.cells.find((cell) => state.winningPath?.includes(cell.id))?.owner : undefined;
    return { ...(winner ? { winner } : {}), ...(state.winningPath ? { winningPath: state.winningPath } : {}) };
  }
  const latest = state.roundOutcomeHistory.filter((record) => record.round === state.currentRound).sort((a, b) => a.version - b.version).at(-1);
  return latest ? { ...(latest.winner ? { winner: latest.winner } : {}), ...(latest.winningPath ? { winningPath: latest.winningPath } : {}) } : {};
}

function correctedRoundWinner(state: GameState, board: GameBoard, correctionOwner: TeamAxis | undefined): { winner?: TeamAxis; winningPath?: string[] } {
  const paths: Record<TeamAxis, string[] | undefined> = { horizontal: findWinningPath(board, 'horizontal'), vertical: findWinningPath(board, 'vertical') };
  const prior = currentRoundOutcome(state).winner;
  // Preserve the existing effective winner whenever its path still exists. When a
  // correction changes ownership, prefer the corrected owner next; horizontal is
  // the final deterministic tie-breaker if both paths are newly possible.
  const winner = prior && paths[prior]
    ? prior
    : correctionOwner && paths[correctionOwner]
      ? correctionOwner
      : paths.horizontal ? 'horizontal' : paths.vertical ? 'vertical' : undefined;
  return { ...(winner ? { winner, winningPath: paths[winner] } : {}) };
}

function resultLifecycle(state: GameState, path?: string[]): Pick<GameState, 'lifecycle' | 'winningPath'> {
  if (!path) return { lifecycle: 'CELL_SELECTION', winningPath: undefined };
  return deriveMatch(state).matchWinner ? { lifecycle: 'MATCH_COMPLETE', winningPath: path } : { lifecycle: 'ROUND_COMPLETE', winningPath: path };
}

function scoreOwnershipDelta(scores: Record<TeamAxis, number>, priorOwner: TeamAxis | undefined, nextOwner: TeamAxis | undefined): Record<TeamAxis, number> {
  if (priorOwner === nextOwner) return scores;
  const next = { ...scores };
  if (priorOwner) next[priorOwner] = Math.max(0, next[priorOwner] - 1);
  if (nextOwner) next[nextOwner] += 1;
  return next;
}

/** Pure, total-on-valid-events reducer. The switch is intentionally exhaustive by lifecycle. */
export function reduceGame(state: GameState, event: GameEvent): GameState {
  if (event.type === 'PAUSE' && state.lifecycle !== 'PAUSED' && state.lifecycle !== 'MATCH_COMPLETE') return { ...state, lifecycle: 'PAUSED', pausedFrom: state.lifecycle };
  // Corrections intentionally remain available from MATCH_COMPLETE: they can reopen a terminal match.
  if (event.type === 'BEGIN_CORRECTION' && state.lifecycle !== 'CORRECTION' && state.board) return { ...state, lifecycle: 'CORRECTION', pausedFrom: state.lifecycle, correction: { cellId: event.cellId, owner: event.owner, reason: event.reason } };
  switch (state.lifecycle) {
    case 'LOBBY': if (event.type === 'START_MATCH') return { ...state, lifecycle: 'ROUND_SETUP', board: event.board, currentRound: Math.max(1, state.currentRound) }; return reject(state, event);
    case 'ROUND_SETUP': if (event.type === 'ROUND_READY') return { ...state, lifecycle: 'CELL_SELECTION' }; return reject(state, event);
    case 'CELL_SELECTION': if (event.type === 'SELECT_CELL' && state.board?.cells.some((cell) => cell.id === event.cellId && !cell.owner)) return { ...state, lifecycle: 'LETTER_REVEAL', activeCellId: event.cellId }; return reject(state, event);
    case 'LETTER_REVEAL': if (event.type === 'LETTER_REVEALED') return { ...state, lifecycle: 'QUESTION_READING' }; return reject(state, event);
    case 'QUESTION_READING': if (event.type === 'BUZZ_ACCEPTED') return { ...state, lifecycle: 'FIRST_ANSWER', answeringTeam: event.team, attempt: 'initial' }; if (event.type === 'TIME_EXPIRED') return { ...state, lifecycle: 'QUESTION_FAILED' }; return reject(state, event);
    case 'FIRST_ANSWER': if (event.type === 'JUDGE_CORRECT') return { ...state, lifecycle: 'CELL_AWARDED' }; if (event.type === 'JUDGE_INCORRECT') return state.attempt === 'opponent' ? { ...state, lifecycle: 'QUESTION_FAILED' } : { ...state, lifecycle: 'OPPONENT_CHANCE', entitledTeam: opposite(state.answeringTeam!), answeringTeam: undefined, attempt: 'opponent' }; return reject(state, event);
    case 'OPPONENT_CHANCE': if (event.type === 'BUZZ_ACCEPTED' && event.team === state.entitledTeam) return { ...state, lifecycle: 'FIRST_ANSWER', answeringTeam: event.team, attempt: 'opponent' }; if (event.type === 'TIME_EXPIRED') return { ...state, lifecycle: 'QUESTION_FAILED' }; return reject(state, event);
    case 'QUESTION_FAILED': if (event.type === 'RETRY_CELL') return { ...state, lifecycle: 'QUESTION_READING', answeringTeam: undefined, attempt: 'initial' }; if (event.type === 'RETURN_CELL') return { ...state, lifecycle: 'CELL_SELECTION', activeCellId: undefined, answeringTeam: undefined, attempt: 'initial' }; return reject(state, event);
    case 'CELL_AWARDED': if (event.type === 'AWARD_CELL') {
      // This is the sole normal-path question-score mutation. The cell was selectable and is
      // now atomically owned, so replays/stale intents cannot score again at the service boundary.
      const owner = state.answeringTeam!;
      const board = withOwner(state.board!, state.activeCellId!, owner);
      return { ...state, board, lifecycle: 'PATH_CHECK', questionScores: scoreOwnershipDelta(state.questionScores, undefined, owner) };
    } return reject(state, event);
    case 'PATH_CHECK': if (event.type === 'CHECK_PATH') {
      const path = findWinningPath(state.board!, state.answeringTeam!);
      if (!path) return { ...state, lifecycle: 'CELL_SELECTION', entitledTeam: state.answeringTeam!, activeCellId: undefined, answeringTeam: undefined };
      const withOutcome = appendRoundOutcome(state, state.answeringTeam!, path);
      return { ...withOutcome, ...resultLifecycle(withOutcome, path) };
    } return reject(state, event);
    case 'ROUND_COMPLETE': if (event.type === 'START_NEXT_ROUND') return { ...state, lifecycle: 'ROUND_SETUP', board: event.board, currentRound: state.currentRound + 1, activeCellId: undefined, winningPath: undefined, answeringTeam: undefined, attempt: 'initial' }; return reject(state, event);
    case 'MATCH_COMPLETE': return reject(state, event);
    case 'PAUSED': if (event.type === 'RESUME') return { ...state, lifecycle: state.pausedFrom ?? 'CELL_SELECTION', pausedFrom: undefined }; return reject(state, event);
    case 'CORRECTION': if (event.type === 'CANCEL_CORRECTION') return { ...state, lifecycle: state.pausedFrom ?? 'CELL_SELECTION', correction: undefined, pausedFrom: undefined }; if (event.type === 'CONFIRM_CORRECTION') {
      const correction = state.correction!;
      const priorOwner = state.board!.cells.find((cell) => cell.id === correction.cellId)?.owner;
      const board = withOwner(state.board!, correction.cellId, correction.owner);
      const result = correctedRoundWinner(state, board, correction.owner);
      const ownershipChanged = priorOwner !== correction.owner;
      const base = { ...state, board, questionScores: scoreOwnershipDelta(state.questionScores, priorOwner, correction.owner) };
      // A no-op correction has no score or outcome-history side effect; it still
      // recomputes both board paths so the terminal state remains authoritative.
      const corrected = ownershipChanged ? replaceCurrentRoundOutcome(base, result.winner, result.winningPath, currentRoundOutcome(state).winner) : base;
      const lifecycle = resultLifecycle(corrected, result.winningPath);
      return { ...corrected, ...lifecycle, correction: undefined, pausedFrom: undefined, activeCellId: result.winningPath ? corrected.activeCellId : undefined, answeringTeam: result.winner };
    } return reject(state, event);
    default: return reject(state, event);
  }
}
