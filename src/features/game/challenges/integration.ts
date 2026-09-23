/**
 * Server-side persistence and delivery boundary for T36 challenges.
 *
 * This module contains no transport and intentionally has no client imports.
 * Firebase and the local authority store the envelope in a private namespace,
 * then use these helpers to reconstruct a validated definition and build a
 * role-safe projection.
 */
import type { TeamAxis } from "../domain/board.js";
import {
  CHALLENGE_SCHEMA_VERSION,
  T37_CHALLENGE_SCHEMA_VERSION,
  T37_WORD_SEARCH_CHALLENGE_SCHEMA_VERSION,
  validateCanonicalChallengeDefinition,
  type CanonicalChallengeDefinition,
  type Direction,
} from "./definition.js";
import type { ChallengeState, ChallengeTrailPoint } from "./engine.js";

export const CHALLENGE_PROTOCOL_VERSION = "t36-challenge-runtime-v1" as const;

export type ChallengeDefinitionEnvelope = {
  manifestSha256: string;
  id: string;
  schemaVersion: CanonicalChallengeDefinition["schemaVersion"];
  definitionSha256: string;
  /** Exact sorted-key JSON; it avoids Firestore nested-array encoding. */
  canonicalJson: string;
};

export type ChallengeDefinitionReference = Pick<ChallengeDefinitionEnvelope, "manifestSha256" | "id" | "schemaVersion" | "definitionSha256">;
/**
 * The public question metadata is an independently pinned claim about a
 * private definition.  Parsing a well-formed envelope is insufficient: a
 * corrupted release child must not be able to point a map definition at an
 * unrelated category or fact family.
 */
export type ChallengeQuestionBinding = {
  categoryId?: string;
  challenge?: {
    definition: ChallengeDefinitionReference;
    factFamilies: readonly string[];
    kind: CanonicalChallengeDefinition["kind"];
  };
};
export type ChallengeRecipient = "host" | "audience" | "waiting" | "guide" | "mover" | "captain" | "stealCaptain";

export type CompactNavigationState = {
  current?: ChallengeTrailPoint;
  /** Unique finite-grid edges, represented as strings so Firestore sees no nested arrays. */
  confirmedEdges: readonly string[];
};

export type PersistedChallengeState = Omit<ChallengeState, "receipts" | "moves"> & {
  /** Durable actor+intent receipts are external; never copy reducer receipts into a room. */
  navigation?: CompactNavigationState;
};

export type ChallengeProjection = {
  protocolVersion: typeof CHALLENGE_PROTOCOL_VERSION;
  kind: CanonicalChallengeDefinition["kind"];
  recipient: ChallengeRecipient;
  occurrence: string;
  revision: number;
  assignmentGeneration: number;
  disclosureGeneration: number;
  stage: ChallengeState["stage"];
  entitledTeam: TeamAxis;
  answeringTeam: TeamAxis;
  paused: boolean;
  strikes: number;
  readiness: { protocolHash: string; assignmentHash: string; stimulusHash: string; required: boolean; acknowledged: boolean };
  assignments: { guide?: string; mover?: string; captain?: string; stealCaptain?: string };
  /** Host-only assigned-participant acknowledgement summary; no answers or identity beyond existing assignment IDs. */
  readinessSummary?: readonly { participantId: string; acknowledged: boolean }[];
  legalActions: readonly string[];
  timing: { countdownSeconds: number; answerSeconds?: number; observationSeconds?: number };
  deadlineAt?: string;
  result?: ChallengeState["result"];
  attemptsClosed: boolean;
  solutionRevealed: boolean;
  /** Never contains raw definition identity, sources, grading, media paths, or answers in an open attempt. */
  stimulus?: Record<string, unknown>;
};

const sha = (value: string) => /^[a-f0-9]{64}$/u.test(value);
const point = (value: ChallengeTrailPoint) => `${value.row},${value.column}`;
const edge = (left: ChallengeTrailPoint, right: ChallengeTrailPoint) => [point(left), point(right)].sort().join("/");

/** M1-compatible sorted-key serialization. The definition hash excludes itself. */
export function canonicalChallengeJson(value: unknown): string {
  return JSON.stringify(value, (_key, child) => {
    if (child && typeof child === "object" && !Array.isArray(child))
      return Object.fromEntries(Object.entries(child).sort(([left], [right]) => left.localeCompare(right)));
    return child;
  });
}

export function definitionPayload(definition: CanonicalChallengeDefinition): Omit<CanonicalChallengeDefinition, "definitionSha256"> {
  const { definitionSha256: _ignored, ...payload } = definition;
  void _ignored;
  return payload;
}

/**
 * Parse and semantically validate an immutable Firestore envelope. The caller
 * supplies the trusted SHA-256 implementation because this module is shared
 * by Node authorities and must not pull Node crypto into a browser bundle.
 */
export function parseChallengeDefinitionEnvelope(
  envelope: ChallengeDefinitionEnvelope,
  hash: (canonicalJson: string) => string,
): CanonicalChallengeDefinition {
  if (!sha(envelope.manifestSha256) || !sha(envelope.definitionSha256) || !/^[a-z0-9-]+$/u.test(envelope.id) || ![CHALLENGE_SCHEMA_VERSION, T37_CHALLENGE_SCHEMA_VERSION, T37_WORD_SEARCH_CHALLENGE_SCHEMA_VERSION].includes(envelope.schemaVersion))
    throw new Error("CHALLENGE_DEFINITION_ENVELOPE_INVALID");
  let definition: CanonicalChallengeDefinition;
  try { definition = JSON.parse(envelope.canonicalJson) as CanonicalChallengeDefinition; }
  catch { throw new Error("CHALLENGE_DEFINITION_CANONICAL_JSON_INVALID"); }
  if (canonicalChallengeJson(definition) !== envelope.canonicalJson)
    throw new Error("CHALLENGE_DEFINITION_CANONICAL_JSON_MISMATCH");
  if (definition.id !== envelope.id || definition.schemaVersion !== envelope.schemaVersion || definition.definitionSha256 !== envelope.definitionSha256)
    throw new Error("CHALLENGE_DEFINITION_IDENTITY_MISMATCH");
  if (hash(canonicalChallengeJson(definitionPayload(definition))) !== envelope.definitionSha256)
    throw new Error("CHALLENGE_DEFINITION_HASH_MISMATCH");
  if (validateCanonicalChallengeDefinition(definition).length)
    throw new Error("CHALLENGE_DEFINITION_SEMANTIC_VALIDATION_FAILED");
  return definition;
}

export function challengeDefinitionReference(envelope: ChallengeDefinitionEnvelope): ChallengeDefinitionReference {
  return { manifestSha256: envelope.manifestSha256, id: envelope.id, schemaVersion: envelope.schemaVersion, definitionSha256: envelope.definitionSha256 };
}

/** Fail closed before a definition can be used for selection, grading or delivery. */
export function assertChallengeDefinitionBinding(
  definition: CanonicalChallengeDefinition,
  question: ChallengeQuestionBinding,
): void {
  const binding = question.challenge;
  if (!binding || !question.categoryId || definition.disposition !== "ready")
    throw new Error("CHALLENGE_DEFINITION_BINDING_INVALID");
  const expectedFamilies = [...binding.factFamilies].sort();
  const actualFamilies = [...definition.factFamilies].sort();
  if (
    binding.kind !== definition.kind ||
    question.categoryId !== definition.categoryId ||
    expectedFamilies.length !== actualFamilies.length ||
    expectedFamilies.some((value, index) => value !== actualFamilies[index])
  ) throw new Error("CHALLENGE_DEFINITION_SEMANTIC_PIN_MISMATCH");
}

/** Keeps room documents bounded while retaining every distinct confirmed visible edge. */
export function compactChallengeState(state: ChallengeState): PersistedChallengeState {
  const edges = new Set<string>(state.confirmedEdges);
  let previous: ChallengeTrailPoint | undefined;
  for (const move of state.moves) {
    if (previous) edges.add(edge(previous, move));
    previous = move;
  }
  const { receipts: _receipts, moves: _moves, ...persisted } = state;
  void _receipts;
  void _moves;
  return { ...persisted, ...(state.moves.length ? { navigation: { current: state.moves.at(-1), confirmedEdges: [...edges].sort() } } : {}) };
}

/** Restores the reducer's current position; detailed traversal remains an external private event stream. */
export function restoreChallengeState(persisted: PersistedChallengeState): ChallengeState {
  const { navigation, ...state } = persisted;
  return { ...state, moves: navigation?.current ? [navigation.current] : [], confirmedEdges: navigation?.confirmedEdges ?? [], receipts: {} };
}

function safeDeadline(state: ChallengeState) {
  return state.deadlineAt === undefined ? undefined : new Date(state.deadlineAt).toISOString();
}

/** Keep the host's acknowledgement summary on the same three-hash contract as the reducer. */
function readinessMatches(
  candidate: { protocolHash: string; assignmentHash: string; stimulusHash: string },
  expected: { protocolHash: string; assignmentHash: string; stimulusHash: string },
) {
  return candidate.protocolHash === expected.protocolHash
    && candidate.assignmentHash === expected.assignmentHash
    && candidate.stimulusHash === expected.stimulusHash;
}

function navStimulus(definition: Extract<CanonicalChallengeDefinition, { kind: "navigation" }>, state: ChallengeState, recipient: ChallengeRecipient) {
  const current = state.moves.at(-1) ?? { row: definition.publicData.start[0], column: definition.publicData.start[1] };
  if (recipient === "guide") return {
    rows: definition.publicData.rows, columns: definition.publicData.columns,
    start: flat(definition.publicData.start), goal: flat(definition.privateGrading.goal),
    blocked: definition.privateGrading.blocked.map(flat), current,
  };
  return { rows: definition.publicData.rows, columns: definition.publicData.columns, start: flat(definition.publicData.start), current, confirmedEdges: state.confirmedEdges };
}

function flat(value: readonly [number, number]) { return { row: value[0], column: value[1] }; }

/**
 * Builds a new allowlisted projection. Host is deliberately not privileged to
 * private grading while attempts are live; solution data appears only after a
 * closed explicit REVEAL.
 */
export function projectChallenge(
  definition: CanonicalChallengeDefinition,
  state: ChallengeState,
  recipient: ChallengeRecipient,
): ChallengeProjection {
  const projection: ChallengeProjection = {
    protocolVersion: CHALLENGE_PROTOCOL_VERSION,
    kind: definition.kind,
    recipient,
    occurrence: state.occurrence,
    revision: state.revision,
    assignmentGeneration: state.assignmentGeneration,
    disclosureGeneration: state.disclosureGeneration,
    stage: state.stage,
    entitledTeam: state.entitledTeam,
    answeringTeam: state.answeringTeam,
    paused: Boolean(state.paused),
    strikes: state.strikes,
    assignments: { ...state.assignments },
    ...(recipient === "host" ? { readinessSummary: Object.values(state.assignments).filter((id): id is string => Boolean(id)).map((participantId) => ({ participantId, acknowledged: readinessMatches(state.ready[participantId] ?? { protocolHash: "", assignmentHash: "", stimulusHash: "" }, state.expectedReadiness) })) } : {}),
    legalActions: legalActions(state, recipient),
    timing: timing(definition),
    readiness: { ...state.expectedReadiness, required: recipient === "guide" || recipient === "mover" || recipient === "captain" || recipient === "stealCaptain", acknowledged: (() => { const id = recipient === "guide" ? state.assignments.guide : recipient === "mover" ? state.assignments.mover : recipient === "captain" ? state.assignments.captain : recipient === "stealCaptain" ? state.assignments.stealCaptain : undefined; const value = id ? state.ready[id] : undefined; return Boolean(value && value.protocolHash === state.expectedReadiness.protocolHash && value.assignmentHash === state.expectedReadiness.assignmentHash && value.stimulusHash === state.expectedReadiness.stimulusHash); })() },
    ...(safeDeadline(state) ? { deadlineAt: safeDeadline(state) } : {}),
    ...(state.result ? { result: state.result } : {}),
    attemptsClosed: state.attemptsClosed,
    solutionRevealed: state.solutionRevealed,
  };
  if (definition.kind === "memory" && (state.stage === "setup" || state.stage === "countdown")) projection.stimulus = { rows: definition.publicData.rows, columns: definition.publicData.columns, palette: definition.publicData.palette.map(({ nameAr, hex }) => ({ nameAr, hex })), showSeconds: definition.publicData.showSeconds, answerSeconds: definition.publicData.answerSeconds };
  if (definition.kind === "missing_tile" && (state.stage === "setup" || state.stage === "countdown")) projection.stimulus = { rule: definition.publicData.rule };
  if (state.paused || state.stage === "setup" || state.stage === "countdown") return projection;
  if (definition.kind === "navigation") projection.stimulus = navStimulus(definition, state, recipient);
  if (definition.kind === "missing_tile") projection.stimulus = {
    rows: definition.publicData.rows, columns: definition.publicData.columns,
    cells: definition.publicData.cells.flatMap((cells, row) => cells.map((cell, column) => cell ? { row, column, id: cell.id, labelAr: cell.labelAr, shape: cell.shape, hex: cell.hex, ...(cell.bitmask === undefined ? {} : { bitmask: cell.bitmask }) } : { row, column, missing: true })),
    options: definition.publicData.options.map(({ id, labelAr, shape, hex, bitmask }) => ({ id, labelAr, shape, hex, ...(bitmask === undefined ? {} : { bitmask }) })), rule: definition.publicData.rule, promptAr: definition.publicData.promptAr,
  };
  if (definition.kind === "memory") {
    if (state.stage === "observation") projection.stimulus = {
      rows: definition.publicData.rows, columns: definition.publicData.columns,
      instructionAr: "احفظ الألوان",
      cells: definition.privateGrading.observationCells.map((cell) => ({ row: cell.row, column: cell.column, colorAr: cell.colorAr, hex: cell.hex, shapeAr: cell.shapeAr })),
    };
    if (state.stage === "answer" || state.stage === "steal" || state.stage === "steal_offer") projection.stimulus = { rows: definition.publicData.rows, columns: definition.publicData.columns, palette: definition.publicData.palette.map(({ nameAr, hex }) => ({ nameAr, hex })), promptAr: definition.privateGrading.recallData.promptAr, answerSlots: definition.privateGrading.targets.length };
  }
  if (definition.kind === "qatar_map") projection.stimulus = {
    mode: definition.publicData.mode, markers: definition.publicData.markers.map(({ id, x, y }) => ({ id, x, y })), optionIds: [...definition.publicData.optionIds], promptAr: definition.publicData.promptAr,
    ...(definition.publicData.mode === "identify" ? {} : { namedPoints: definition.publicData.namedPoints?.map(({ id, nameAr }) => ({ id, nameAr })) ?? [] }),
  };
  if (definition.kind === "word_search") projection.stimulus = {
    rows: definition.publicData.rows, columns: definition.publicData.columns,
    grid: definition.publicData.grid.map((row) => [...row]), clueAr: definition.publicData.clueAr,
  };
  if (state.solutionRevealed && state.attemptsClosed) projection.stimulus = { ...projection.stimulus, reveal: codeNativeReveal(definition) };
  return projection;
}

function legalActions(state: ChallengeState, recipient: ChallengeRecipient): readonly string[] {
  if (recipient === "host") {
    if (state.attemptsClosed) return ["REVEAL", "CONTINUE"];
    if (state.paused) return ["RESUME", "VOID"];
    if (state.stage === "setup") {
      const manualReady = Object.values(state.assignments).some((id) => id?.startsWith("manual:") && state.ready[id]?.protocolHash !== state.expectedReadiness.protocolHash);
      return manualReady ? ["ASSIGN", "READY", "START"] : ["ASSIGN", "START"];
    }
    if (state.stage === "steal_offer") return ["START_STEAL", "DECLINE_STEAL", "VOID"];
    const actions = ["PAUSE", "VOID"];
    if (state.stage === "answer" && state.assignments.mover?.startsWith("manual:")) actions.push("MOVE");
    if ((state.stage === "answer" && state.assignments.captain?.startsWith("manual:")) || (state.stage === "steal" && state.assignments.stealCaptain?.startsWith("manual:"))) actions.push("SUBMIT");
    return actions;
  }
  if (recipient === "guide") return state.stage === "setup" ? ["READY"] : [];
  if (recipient === "mover") return state.stage === "answer" ? ["MOVE"] : state.stage === "setup" ? ["READY"] : [];
  if (recipient === "captain") return state.stage === "setup" ? ["READY"] : state.stage === "answer" ? ["SUBMIT"] : [];
  if (recipient === "stealCaptain") return state.stage === "setup" ? ["READY"] : state.stage === "steal" ? ["SUBMIT"] : [];
  return [];
}
function timing(definition: CanonicalChallengeDefinition) {
  if (definition.kind === "memory") return { countdownSeconds: 3, observationSeconds: definition.publicData.showSeconds, answerSeconds: definition.publicData.answerSeconds };
  return { countdownSeconds: 3, answerSeconds: definition.publicData.timeLimitSeconds };
}

function codeNativeReveal(definition: CanonicalChallengeDefinition): Record<string, unknown> {
  if (definition.kind === "navigation") return { directions: definition.privateGrading.canonicalDirections as readonly Direction[] };
  if (definition.kind === "missing_tile") return { correctOptionId: definition.privateGrading.correctOptionId };
  if (definition.kind === "memory") return { answers: [...definition.privateGrading.targetAnswers] };
  if (definition.kind === "word_search") return { paths: definition.privateGrading.acceptedPaths.map(({ start, end }) => ({ start: flat(start), end: flat(end) })) };
  return { answerIds: [...definition.privateGrading.answerIds] };
}

/** Generic board controls may not overtake an active or retained challenge result. */
export function assertChallengeBoardIntentAllowed(challenge: ChallengeState | undefined, type: string): void {
  if (!challenge || challenge.continued) return;
  const allowed = new Set(["CHALLENGE_ASSIGN", "CHALLENGE_READY", "CHALLENGE_START", "CHALLENGE_MOVE", "CHALLENGE_SUBMIT", "CHALLENGE_START_STEAL", "CHALLENGE_DECLINE_STEAL", "CHALLENGE_PAUSE", "CHALLENGE_RESUME", "CHALLENGE_VOID", "CHALLENGE_REVEAL", "CHALLENGE_CONTINUE"]);
  if (!allowed.has(type)) throw new Error("CHALLENGE_ACTIVE_LEGACY_INTENT_BLOCKED");
}

export function participantRecipient(state: ChallengeState, uid: string, role: "host" | "player" | "audience"): ChallengeRecipient {
  if (role === "host" || role === "audience") return role;
  const memberId = `member:${uid}`;
  if (state.assignments.guide === memberId) return "guide";
  if (state.assignments.mover === memberId) return "mover";
  if (state.assignments.captain === memberId) return "captain";
  if (state.assignments.stealCaptain === memberId) return "stealCaptain";
  return "waiting";
}

export function teamForChallengeRecipient(state: ChallengeState, recipient: ChallengeRecipient): TeamAxis | undefined {
  if (recipient === "guide" || recipient === "mover" || recipient === "captain") return state.entitledTeam;
  if (recipient === "stealCaptain") return state.entitledTeam === "horizontal" ? "vertical" : "horizontal";
  return undefined;
}
