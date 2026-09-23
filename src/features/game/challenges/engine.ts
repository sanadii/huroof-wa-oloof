/**
 * Authoritative, transport-free state machine for one pinned challenge
 * occurrence. Firebase and the local service will call this reducer in M3;
 * neither transport-specific identity nor definition source data is stored here.
 */
import type { TeamAxis } from "../domain/board.js";
import { straightWordSearchPath, type CanonicalChallengeDefinition, type Direction, type Point } from "./definition.js";

export type Participant =
  | { kind: "member"; uid: string; /** Auth UID may differ from a kind-qualified assignment ID. */ actorUid?: string; team: TeamAxis }
  | { kind: "manual"; id: string; team: TeamAxis; controllerUid: string };

export type Assignment = { guide?: string; mover?: string; captain?: string; stealCaptain?: string };
export type ChallengeStage = "setup" | "countdown" | "observation" | "answer" | "steal_offer" | "steal" | "result" | "void";
export type ChallengeResult = "correct" | "failed" | "void";
/** Firestore-safe persisted navigation trail point; canonical definitions keep tuple points separately. */
export interface ChallengeTrailPoint { row: number; column: number; }

export interface ChallengeReadiness {
  protocolHash: string;
  assignmentHash: string;
  stimulusHash: string;
}

export interface ChallengeRuntimeConfig {
  /**
   * Server-side occurrence snapshot. M3 adapters construct this from trusted
   * auth/session data; none of these fields are accepted from client payloads.
   */
  hostUid: string;
  protocolHash: string;
  assignmentHash: string;
  stimulusHash: string;
  assignments?: Assignment;
}

export interface ChallengeState {
  schemaVersion: "t36-challenge-state-v1";
  occurrence: string;
  definitionId: string;
  definitionHash: string;
  revision: number;
  assignmentGeneration: number;
  /** Changes only when recipient-visible stage disclosure changes, never per move. */
  disclosureGeneration: number;
  stage: ChallengeStage;
  stageStartedAt: number;
  deadlineAt?: number;
  entitledTeam: TeamAxis;
  answeringTeam: TeamAxis;
  assignments: Assignment;
  assignmentsLocked: boolean;
  expectedReadiness: ChallengeReadiness;
  ready: Readonly<Record<string, ChallengeReadiness>>;
  strikes: number;
  moves: readonly ChallengeTrailPoint[];
  /** Bounded unique grid edges for persisted/public navigation trails. */
  confirmedEdges: readonly string[];
  initialSubmission?: readonly string[];
  stealSubmission?: readonly string[];
  attempt: "initial" | "steal";
  attemptsClosed: boolean;
  result?: ChallengeResult;
  solutionRevealed: boolean;
  continued?: true;
  awarded?: true;
  paused?: { at: number; from: ChallengeStage; deadlineAt: number };
  /** Idempotency receipts for accepted intents only. */
  receipts: Readonly<Record<string, { type: ChallengeIntent["type"]; payloadHash: string }>>;
}

type IntentBase = {
  /** Trusted adapter stamps auth UID, server time, and a canonical payload hash. */
  id: string;
  actor: string;
  payloadHash: string;
  occurrence: string;
  revision: number;
  expectedStage: ChallengeStage;
  at: number;
};

export type ChallengeIntent = IntentBase & (
  | { type: "ASSIGN"; assignment: keyof Assignment; participantId: string }
  | { type: "READY"; participantId: string; readiness: ChallengeReadiness }
  | { type: "START" }
  | { type: "MOVE"; direction: Direction }
  | { type: "SUBMIT"; answers?: readonly string[]; start?: ChallengeTrailPoint; end?: ChallengeTrailPoint }
  | { type: "START_STEAL" }
  | { type: "DECLINE_STEAL" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "VOID" }
  | { type: "REVEAL" }
  | { type: "CONTINUE" }
);

const directionDelta: Record<Direction, Point> = {
  north: [-1, 0], east: [0, 1], south: [1, 0], west: [0, -1],
};

const opposite = (team: TeamAxis): TeamAxis => team === "horizontal" ? "vertical" : "horizontal";
const participantId = (participant: Participant) => participant.kind === "member" ? participant.uid : participant.id;
const samePoint = (left: Point, right: Point) => left[0] === right[0] && left[1] === right[1];
const equalAnswers = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((answer, index) => answer === right[index]);
const sameReadiness = (left: ChallengeReadiness, right: ChallengeReadiness) =>
  left.protocolHash === right.protocolHash && left.assignmentHash === right.assignmentHash && left.stimulusHash === right.stimulusHash;
const receiptKey = (actor: string, id: string) => `${actor}\u0000${id}`;

export function createChallengeState(
  definition: CanonicalChallengeDefinition,
  occurrence: string,
  entitledTeam: TeamAxis,
  now: number,
  config: ChallengeRuntimeConfig,
): ChallengeState {
  if (definition.disposition !== "ready") throw new Error(`Challenge ${definition.id} is ${definition.disposition} and cannot be played.`);
  if (!occurrence || !config.hostUid || !config.protocolHash || !config.assignmentHash || !config.stimulusHash) {
    throw new Error("Challenge occurrence and pinned runtime hashes are required.");
  }
  return {
    schemaVersion: "t36-challenge-state-v1",
    occurrence,
    definitionId: definition.id,
    definitionHash: definition.definitionSha256,
    revision: 0,
    assignmentGeneration: 0,
    disclosureGeneration: 0,
    stage: "setup",
    stageStartedAt: now,
    entitledTeam,
    answeringTeam: entitledTeam,
    assignments: { ...(config.assignments ?? {}) },
    assignmentsLocked: false,
    expectedReadiness: {
      protocolHash: config.protocolHash,
      assignmentHash: `${config.assignmentHash}:0`,
      stimulusHash: config.stimulusHash,
    },
    ready: {},
    strikes: 0,
    moves: [],
    confirmedEdges: [],
    attempt: "initial",
    attemptsClosed: false,
    solutionRevealed: false,
    receipts: {},
  };
}

/**
 * Advances due stages from their previous scheduled deadline. It deliberately
 * never creates a fresh observation window when reconnecting after expiry.
 */
export function reconcileChallengeDeadline(
  definition: CanonicalChallengeDefinition,
  state: ChallengeState,
  now: number,
): ChallengeState {
  if (state.definitionId !== definition.id || state.definitionHash !== definition.definitionSha256) return state;
  let next = state;
  while (!next.paused && next.deadlineAt !== undefined && now >= next.deadlineAt && !next.result) {
    const deadline = next.deadlineAt;
    if (next.stage === "countdown") {
      if (definition.kind === "memory") {
        next = { ...next, stage: "observation", stageStartedAt: deadline, deadlineAt: deadline + definition.publicData.showSeconds * 1000, disclosureGeneration: next.disclosureGeneration + 1, revision: next.revision + 1 };
      } else {
        next = { ...next, stage: "answer", stageStartedAt: deadline, deadlineAt: deadline + definition.publicData.timeLimitSeconds * 1000, disclosureGeneration: next.disclosureGeneration + 1, revision: next.revision + 1 };
      }
      continue;
    }
    if (next.stage === "observation") {
      if (definition.kind !== "memory") return { ...next, ...closeState(next, "failed"), revision: next.revision + 1 };
      next = { ...next, stage: "answer", stageStartedAt: deadline, deadlineAt: deadline + definition.publicData.answerSeconds * 1000, disclosureGeneration: next.disclosureGeneration + 1, revision: next.revision + 1 };
      continue;
    }
    if (next.stage === "answer" && hasSteal(definition) && next.attempt === "initial") {
      return { ...next, stage: "steal_offer", stageStartedAt: deadline, deadlineAt: undefined, answeringTeam: opposite(next.entitledTeam), attempt: "steal", disclosureGeneration: next.disclosureGeneration + 1, revision: next.revision + 1 };
    }
    return { ...next, ...closeState(next, "failed"), revision: next.revision + 1 };
  }
  return next;
}

export function reduceChallenge(
  definition: CanonicalChallengeDefinition,
  state: ChallengeState,
  intent: ChallengeIntent,
  participants: readonly Participant[],
  config: ChallengeRuntimeConfig,
): ChallengeState {
  if (state.definitionId !== definition.id || state.definitionHash !== definition.definitionSha256) return state;
  const reconciled = reconcileChallengeDeadline(definition, state, intent.at);
  if (hasMatchingReceipt(reconciled, intent)) return reconciled;
  if (intent.type === "RESUME") return resumeChallenge(definition, reconciled, intent, config);
  if (!intentMatches(reconciled, intent)) return reconciled;

  const accept = (change: Omit<Partial<ChallengeState>, "revision" | "receipts">): ChallengeState => ({
    ...reconciled,
    ...change,
    revision: reconciled.revision + 1,
    receipts: { ...reconciled.receipts, [receiptKey(intent.actor, intent.id)]: { type: intent.type, payloadHash: intent.payloadHash } },
  });
  const isHost = intent.actor === config.hostUid;

  if (reconciled.result) {
    if (intent.type === "REVEAL" && isHost && reconciled.attemptsClosed) return accept({ solutionRevealed: true, disclosureGeneration: reconciled.disclosureGeneration + 1 });
    if (intent.type === "CONTINUE" && isHost && reconciled.attemptsClosed) return accept({ continued: true });
    return reconciled;
  }
  if (reconciled.paused) {
    if (intent.type === "VOID" && isHost) return accept({ stage: "void", result: "void", attemptsClosed: true, deadlineAt: undefined, paused: undefined, disclosureGeneration: reconciled.disclosureGeneration + 1 });
    return reconciled;
  }

  if (intent.type === "ASSIGN") {
    if (!isHost || reconciled.stage !== "setup" || reconciled.assignmentsLocked) return reconciled;
    const selected = participants.find((participant) => participantId(participant) === intent.participantId);
    if (!selected || !isRoleParticipantAllowed(intent.assignment, selected, reconciled.entitledTeam, config.hostUid) || !assignmentAllowed(intent.assignment, selected, reconciled.assignments)) return reconciled;
    const assignmentGeneration = reconciled.assignmentGeneration + 1;
    return accept({ assignments: { ...reconciled.assignments, [intent.assignment]: intent.participantId }, ready: {}, assignmentGeneration, expectedReadiness: { ...reconciled.expectedReadiness, assignmentHash: `${config.assignmentHash}:${assignmentGeneration}` } });
  }

  if (intent.type === "READY") {
    if (reconciled.stage !== "setup" || !sameReadiness(intent.readiness, reconciled.expectedReadiness)) return reconciled;
    if (!requiredParticipantIds(definition, reconciled.assignments).includes(intent.participantId)) return reconciled;
    const participant = controlledAssignedParticipant(participants, intent.participantId, intent.actor, config.hostUid);
    if (!participant) return reconciled;
    return accept({ ready: { ...reconciled.ready, [participantId(participant)]: intent.readiness } });
  }

  if (intent.type === "START") {
    if (!isHost || reconciled.stage !== "setup" || !isReady(definition, reconciled, participants, config)) return reconciled;
    return accept({ stage: "countdown", stageStartedAt: intent.at, deadlineAt: intent.at + 3_000, assignmentsLocked: true, disclosureGeneration: reconciled.disclosureGeneration + 1 });
  }

  if (intent.type === "PAUSE") {
    if (!isHost || reconciled.stage === "setup" || reconciled.deadlineAt === undefined) return reconciled;
    return accept({ paused: { at: intent.at, from: reconciled.stage, deadlineAt: reconciled.deadlineAt ?? intent.at }, disclosureGeneration: reconciled.disclosureGeneration + 1 });
  }
  if (intent.type === "VOID") {
    if (!isHost) return reconciled;
    return accept({ stage: "void", result: "void", attemptsClosed: true, deadlineAt: undefined, disclosureGeneration: reconciled.disclosureGeneration + 1 });
  }
  if (intent.type === "MOVE") {
    const mover = reconciled.assignments.mover ? controlledAssignedParticipant(participants, reconciled.assignments.mover, intent.actor, config.hostUid) : undefined;
    return mover ? reduceMove(definition, reconciled, intent, mover, accept) : reconciled;
  }
  if (intent.type === "SUBMIT") {
    const captainId = reconciled.stage === "steal" ? reconciled.assignments.stealCaptain : reconciled.assignments.captain;
    const captain = captainId ? controlledAssignedParticipant(participants, captainId, intent.actor, config.hostUid) : undefined;
    return captain ? reduceSubmission(definition, reconciled, intent, captain, accept) : reconciled;
  }
  if (intent.type === "START_STEAL") return isHost && reconciled.stage === "steal_offer" ? accept({ stage: "steal", stageStartedAt: intent.at, deadlineAt: intent.at + 15_000, disclosureGeneration: reconciled.disclosureGeneration + 1 }) : reconciled;
  if (intent.type === "DECLINE_STEAL") return isHost && reconciled.stage === "steal_offer" ? accept(closeState(reconciled, "failed")) : reconciled;
  return reconciled;
}

/** Resume is separate because an intent cannot match a paused stage after reconciliation. */
export function resumeChallenge(
  definition: CanonicalChallengeDefinition,
  state: ChallengeState,
  intent: Extract<ChallengeIntent, { type: "RESUME" }>,
  config: ChallengeRuntimeConfig,
): ChallengeState {
  const reconciled = reconcileChallengeDeadline(definition, state, intent.at);
  if (hasMatchingReceipt(reconciled, intent) || !reconciled.paused || intent.actor !== config.hostUid || !intentMatches(reconciled, intent)) return reconciled;
  const paused = reconciled.paused;
  const resumed: ChallengeState = {
    ...reconciled,
    paused: undefined,
    stage: paused.from,
    deadlineAt: paused.deadlineAt + (intent.at - paused.at),
    revision: reconciled.revision + 1,
    receipts: { ...reconciled.receipts, [receiptKey(intent.actor, intent.id)]: { type: intent.type, payloadHash: intent.payloadHash } },
    disclosureGeneration: reconciled.disclosureGeneration + 1,
  };
  return reconcileChallengeDeadline(definition, resumed, intent.at);
}

/** Marks a correct closed occurrence consumed exactly once before a board bridge runs. */
export function markChallengeAwarded(state: ChallengeState): ChallengeState {
  return state.result === "correct" && !state.awarded ? { ...state, awarded: true } : state;
}

function reduceMove(
  definition: CanonicalChallengeDefinition,
  state: ChallengeState,
  intent: Extract<ChallengeIntent, { type: "MOVE" }>,
  actor: Participant,
  accept: (change: Omit<Partial<ChallengeState>, "revision" | "receipts">) => ChallengeState,
): ChallengeState {
  if (definition.kind !== "navigation" || state.stage !== "answer" || state.answeringTeam !== state.entitledTeam || actor.team !== state.entitledTeam || actor.team !== state.answeringTeam) return state;
  if (!canActAsAssignment(actor, intent.actor, state.assignments.mover) || participantId(actor) === state.assignments.guide) return state;
  const lastMove = state.moves.at(-1);
  const at: Point = lastMove ? [lastMove.row, lastMove.column] : definition.publicData.start;
  const delta = directionDelta[intent.direction];
  const next: Point = [at[0] + delta[0], at[1] + delta[1]];
  const inBounds = next[0] >= 0 && next[0] < definition.publicData.rows && next[1] >= 0 && next[1] < definition.publicData.columns;
  if (!inBounds) return state;
  if (definition.privateGrading.blocked.some((point) => samePoint(point, next))) {
    const strikes = state.strikes + 1;
    return strikes >= 3 ? accept({ strikes, ...closeState(state, "failed") }) : accept({ strikes });
  }
  const move: ChallengeTrailPoint = { row: next[0], column: next[1] };
  const prior = `${at[0]},${at[1]}`;
  const edge = [prior, `${move.row},${move.column}`].sort().join("/");
  const confirmedEdges = state.confirmedEdges.includes(edge) ? state.confirmedEdges : [...state.confirmedEdges, edge].sort();
  if (samePoint(next, definition.privateGrading.goal)) return accept({ moves: [...state.moves, move], confirmedEdges, ...closeState(state, "correct") });
  return accept({ moves: [...state.moves, move], confirmedEdges });
}

function reduceSubmission(
  definition: CanonicalChallengeDefinition,
  state: ChallengeState,
  intent: Extract<ChallengeIntent, { type: "SUBMIT" }>,
  actor: Participant,
  accept: (change: Omit<Partial<ChallengeState>, "revision" | "receipts">) => ChallengeState,
): ChallengeState {
  if ((state.stage !== "answer" && state.stage !== "steal") || definition.kind === "navigation") return state;
  const assignedCaptain = state.stage === "steal" ? state.assignments.stealCaptain : state.assignments.captain;
  if (actor.team !== state.answeringTeam || !canActAsAssignment(actor, intent.actor, assignedCaptain)) return state;
  const answers = [...(intent.answers ?? [])];
  const good = isCorrect(definition, answers, intent.start, intent.end);
  const submitted = state.stage === "steal" ? { stealSubmission: answers } : { initialSubmission: answers };
  if (good) return accept({ ...submitted, ...closeState(state, "correct") });
  if (state.stage === "steal" || !hasSteal(definition)) return accept({ ...submitted, ...closeState(state, "failed") });
  return accept({ ...submitted, stage: "steal_offer", stageStartedAt: intent.at, deadlineAt: undefined, answeringTeam: opposite(state.entitledTeam), attempt: "steal", disclosureGeneration: state.disclosureGeneration + 1 });
}

function controls(participant: Participant, actorUid: string): boolean {
  return participant.kind === "member" ? (participant.actorUid ?? participant.uid) === actorUid : participant.controllerUid === actorUid;
}

/** Manual IDs are never impersonated: only their preassigned host controller may act. */
function controlledAssignedParticipant(participants: readonly Participant[], assignedId: string, actorUid: string, hostUid: string): Participant | undefined {
  const participant = participants.find((candidate) => participantId(candidate) === assignedId);
  if (!participant) return undefined;
  if (participant.kind === "manual") return participant.controllerUid === hostUid && actorUid === hostUid ? participant : undefined;
  return (participant.actorUid ?? participant.uid) === actorUid ? participant : undefined;
}

function canActAsAssignment(participant: Participant, actorUid: string, assignedId: string | undefined): boolean {
  return assignedId === participantId(participant) && controls(participant, actorUid);
}

function assignmentAllowed(role: keyof Assignment, participant: Participant, assignments: Assignment): boolean {
  if (role === "guide" && participant.kind !== "member") return false;
  if (role === "guide") return participantId(participant) !== assignments.mover;
  if (role === "mover") return participantId(participant) !== assignments.guide;
  return true;
}

function isRoleParticipantAllowed(role: keyof Assignment, participant: Participant, entitledTeam: TeamAxis, hostUid: string): boolean {
  return participant.team === (role === "stealCaptain" ? opposite(entitledTeam) : entitledTeam)
    && (role !== "guide" || participant.kind === "member")
    && (participant.kind !== "manual" || participant.controllerUid === hostUid);
}

function requiredParticipantIds(definition: CanonicalChallengeDefinition, assignments: Assignment): string[] {
  if (definition.kind === "navigation") return assignments.guide && assignments.mover ? [assignments.guide, assignments.mover] : [];
  if (definition.kind === "memory" || definition.kind === "word_search") return assignments.captain ? [assignments.captain] : [];
  return assignments.captain && assignments.stealCaptain ? [assignments.captain, assignments.stealCaptain] : [];
}

function isReady(definition: CanonicalChallengeDefinition, state: ChallengeState, participants: readonly Participant[], config: ChallengeRuntimeConfig): boolean {
  if (!validAssignments(definition, state.assignments, participants, state.entitledTeam, config.hostUid)) return false;
  const required = requiredParticipantIds(definition, state.assignments);
  return required.length > 0 && required.every((assignedId) =>
    participants.some((participant) => participantId(participant) === assignedId) && sameReadiness(state.ready[assignedId] ?? { protocolHash: "", assignmentHash: "", stimulusHash: "" }, state.expectedReadiness),
  );
}

function validAssignments(definition: CanonicalChallengeDefinition, assignments: Assignment, participants: readonly Participant[], entitledTeam: TeamAxis, hostUid: string): boolean {
  const required = requiredParticipantIds(definition, assignments);
  if (!required.length || new Set(required).size !== required.length) return false;
  const roleEntries = Object.entries(assignments) as Array<[keyof Assignment, string | undefined]>;
  for (const [role, id] of roleEntries) {
    if (!id) continue;
    const participant = participants.find((candidate) => participantId(candidate) === id);
    const team = role === "stealCaptain" ? opposite(entitledTeam) : entitledTeam;
    if (!participant || participant.team !== team || (participant.kind === "manual" && participant.controllerUid !== hostUid)) return false;
    if (role === "guide" && participant.kind !== "member") return false;
  }
  return true;
}

function intentMatches(state: ChallengeState, intent: ChallengeIntent): boolean {
  return intent.occurrence === state.occurrence && intent.revision === state.revision && intent.expectedStage === state.stage;
}

/**
 * The adapter provides a hash of the complete canonical payload. A reused
 * actor/intent ID is a retry only when both that payload and its operation are
 * unchanged; otherwise it is a protocol violation, including for RESUME.
 */
function hasMatchingReceipt(state: ChallengeState, intent: ChallengeIntent): boolean {
  const receipt = state.receipts[receiptKey(intent.actor, intent.id)];
  if (!receipt) return false;
  if (receipt.type !== intent.type || receipt.payloadHash !== intent.payloadHash) {
    throw new Error(`Challenge intent ${intent.id} was replayed with a different canonical payload.`);
  }
  return true;
}

function hasSteal(definition: CanonicalChallengeDefinition): boolean {
  return definition.kind === "missing_tile" || definition.kind === "qatar_map";
}

function isCorrect(definition: CanonicalChallengeDefinition, answers: readonly string[], start?: ChallengeTrailPoint, end?: ChallengeTrailPoint): boolean {
  if (definition.kind === "missing_tile") return answers.length === 1 && answers[0] === definition.privateGrading.correctOptionId;
  if (definition.kind === "memory") return equalAnswers(answers, definition.privateGrading.targetAnswers);
  if (definition.kind === "qatar_map") return equalAnswers(answers, definition.privateGrading.answerIds);
  if (definition.kind === "word_search") {
    if (answers.length || !start || !end) return false;
    const submittedStart: Point = [start.row, start.column], submittedEnd: Point = [end.row, end.column];
    const path = straightWordSearchPath(submittedStart, submittedEnd);
    if (!path.length) return false;
    return definition.privateGrading.acceptedPaths.some((candidate) =>
      (samePoint(candidate.start, submittedStart) && samePoint(candidate.end, submittedEnd)) ||
      (samePoint(candidate.start, submittedEnd) && samePoint(candidate.end, submittedStart)),
    );
  }
  return false;
}

function closeState(state: ChallengeState, result: Exclude<ChallengeResult, "void">): Pick<ChallengeState, "stage" | "result" | "attemptsClosed" | "deadlineAt" | "disclosureGeneration"> {
  return { stage: "result", result, attemptsClosed: true, deadlineAt: undefined, disclosureGeneration: state.disclosureGeneration + 1 };
}
