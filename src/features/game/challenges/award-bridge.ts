/** Additive bridge to the existing board lifecycle; this module owns no board state. */
import { reduceGame, type GameState } from "../domain/lifecycle.js";
import { markChallengeAwarded, type ChallengeState } from "./engine.js";

export interface TrustedChallengeBridgeContext {
  /** Server-persisted active occurrence and selected cell, never client input. */
  activeOccurrence: string;
  selectedCellId: string;
  /** Persist this map with the room so bridge retries and restarts are no-ops. */
  applied: Readonly<Record<string, "award" | "continue">>;
}

export interface ChallengeAwardBridgeResult {
  challenge: ChallengeState;
  game: GameState;
  context: TrustedChallengeBridgeContext;
}

export function createChallengeBridgeContext(activeOccurrence: string, selectedCellId: string): TrustedChallengeBridgeContext {
  if (!activeOccurrence || !selectedCellId) throw new Error("Trusted active occurrence and selected cell are required.");
  return { activeOccurrence, selectedCellId, applied: {} };
}

/**
 * Applies a closed correct occurrence through the audited lifecycle's normal
 * sequence. A steal first advances the existing lifecycle to its opponent
 * attempt; arbitrary team mismatches and stale occurrence/cell bindings fail closed.
 */
export function applyChallengeAward(challenge: ChallengeState, game: GameState, context: TrustedChallengeBridgeContext): ChallengeAwardBridgeResult {
  const key = bridgeKey(challenge, context);
  if (context.applied[key]) return { challenge, game, context };
  if (challenge.result !== "correct" || !challenge.attemptsClosed || challenge.awarded) return { challenge, game, context };
  const synchronized = synchronizeAnsweringTeam(challenge, game, context);
  const judged = reduceGame(synchronized, { type: "JUDGE_CORRECT" });
  const awarded = reduceGame(judged, { type: "AWARD_CELL" });
  return { challenge: markChallengeAwarded(challenge), game: reduceGame(awarded, { type: "CHECK_PATH" }), context: markApplied(context, key, "award") };
}

/** Returns an unclaimed cell to normal selection only after the host continues a failed/void challenge. */
export function applyChallengeContinuation(challenge: ChallengeState, game: GameState, context: TrustedChallengeBridgeContext): ChallengeAwardBridgeResult {
  const key = bridgeKey(challenge, context);
  if (context.applied[key]) return { challenge, game, context };
  if (!challenge.continued || !challenge.attemptsClosed || challenge.result === "correct") return { challenge, game, context };
  const synchronized = synchronizeAnsweringTeam(challenge, game, context);
  const incorrect = reduceGame(synchronized, { type: "JUDGE_INCORRECT" });
  const failed = incorrect.lifecycle === "OPPONENT_CHANCE" ? reduceGame(incorrect, { type: "TIME_EXPIRED" }) : incorrect;
  if (failed.lifecycle !== "QUESTION_FAILED") throw new Error(`Challenge continuation requires a failed question lifecycle, got ${failed.lifecycle}.`);
  return { challenge, game: reduceGame(failed, { type: "RETURN_CELL" }), context: markApplied(context, key, "continue") };
}

function bridgeKey(challenge: ChallengeState, context: TrustedChallengeBridgeContext): string {
  if (challenge.occurrence !== context.activeOccurrence) throw new Error("Challenge bridge rejected a stale occurrence.");
  return `${context.activeOccurrence}\u0000${context.selectedCellId}`;
}

function markApplied(context: TrustedChallengeBridgeContext, key: string, operation: "award" | "continue"): TrustedChallengeBridgeContext {
  return { ...context, applied: { ...context.applied, [key]: operation } };
}

function synchronizeAnsweringTeam(challenge: ChallengeState, game: GameState, context: TrustedChallengeBridgeContext): GameState {
  if (game.activeCellId !== context.selectedCellId) throw new Error("Challenge bridge rejected a stale selected cell.");
  if (game.lifecycle !== "FIRST_ANSWER" || !game.answeringTeam) throw new Error(`Challenge bridge requires FIRST_ANSWER, got ${game.lifecycle}.`);
  if (game.answeringTeam === challenge.answeringTeam) return game;
  if (challenge.attempt !== "steal" || game.answeringTeam !== challenge.entitledTeam || game.attempt !== "initial") throw new Error("Challenge winner does not match the active lifecycle answering team.");
  const opponentChance = reduceGame(game, { type: "JUDGE_INCORRECT" });
  return reduceGame(opponentChance, { type: "BUZZ_ACCEPTED", team: challenge.answeringTeam });
}