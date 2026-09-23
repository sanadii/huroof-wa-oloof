import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalChallengeDefinition } from "../../src/features/game/challenges/definition.js";
import { applyChallengeAward, applyChallengeContinuation, createChallengeBridgeContext } from "../../src/features/game/challenges/award-bridge.js";
import { generateBoard } from "../../src/features/game/domain/board.js";
import type { GameState } from "../../src/features/game/domain/lifecycle.js";
import {
  createChallengeState,
  markChallengeAwarded,
  reconcileChallengeDeadline,
  reduceChallenge,
  resumeChallenge,
  type ChallengeIntent,
  type ChallengeRuntimeConfig,
  type ChallengeState,
  type Participant,
} from "../../src/features/game/challenges/engine.js";

const hash = "a".repeat(64);
const source = { sourceId: "s", sourcePack: "p", sourcePath: "x", sourceRawSha256: hash, sourceContextsSha256: hash, mediaArchiveSha256: hash };
const media = [{ role: "question", visibility: "player", originalObjectName: "o", originalSha256: hash, derivativeObjectName: "d", derivativeSha256: hash }] as const;
const base = { schemaVersion: "t36-challenge-definition-v1" as const, definitionSha256: hash, ordinal: 1, disposition: "ready" as const, source, media, factFamilies: ["fact"], maxPerGameFamily: 1 };
const nav = (blocked: readonly (readonly [number, number])[] = []): CanonicalChallengeDefinition => ({
  ...base, id: "nav", kind: "navigation", categoryId: "tahadani-games-120",
  publicData: { rows: 5, columns: 5, start: [0, 0], timeLimitSeconds: 60, promptAr: "اتجه" },
  privateGrading: { goal: [0, 2], blocked, canonicalDirections: ["east", "east"], canonicalPath: [[0, 0], [0, 1], [0, 2]] },
});
const tile: CanonicalChallengeDefinition = {
  ...base, id: "tile", kind: "missing_tile", categoryId: "tahadani-games-127",
  publicData: { rows: 3, columns: 3, rule: "vertical_mirror", cells: [], missingCell: [0, 0], options: [], timeLimitSeconds: 30, promptAr: "" },
  privateGrading: { correctOptionId: "correct" },
};
const memory: CanonicalChallengeDefinition = {
  ...base, id: "memory", kind: "memory", categoryId: "tahadani-games-132",
  publicData: { rows: 2, columns: 2, showSeconds: 6, answerSeconds: 20, palette: [] },
  privateGrading: { board: [["أزرق", "أحمر"], ["أصفر", "أخضر"]], observationCells: [], targets: [[0, 0], [1, 1]], targetAnswers: ["أزرق", "أخضر"], recallData: { promptAr: "" } },
};
const people: Participant[] = [
  { kind: "member", uid: "guide", team: "horizontal" },
  { kind: "member", uid: "mover", team: "horizontal" },
  { kind: "member", uid: "captain", team: "horizontal" },
  { kind: "member", uid: "opponent", team: "vertical" },
  { kind: "manual", id: "manual-mover", controllerUid: "host", team: "horizontal" },
];
const config = (assignments: ChallengeRuntimeConfig["assignments"]): ChallengeRuntimeConfig => ({ hostUid: "host", protocolHash: "protocol", assignmentHash: "assignment", stimulusHash: hash, assignments });
const intent = (state: ChallengeState, actor: string, type: ChallengeIntent["type"], at: number, extra: object = {}) => ({ id: `${state.revision}-${type}-${actor}-${at}`, actor, payloadHash: `${state.revision}-${type}-${actor}-${at}`, type, occurrence: state.occurrence, revision: state.revision, expectedStage: state.stage, at, ...extra } as ChallengeIntent);
const hasNestedArray = (value: unknown): boolean => Array.isArray(value)
  ? value.some((item) => Array.isArray(item) || hasNestedArray(item))
  : Boolean(value && typeof value === "object" && Object.values(value).some(hasNestedArray));

function start(definition: CanonicalChallengeDefinition, runtime: ChallengeRuntimeConfig): ChallengeState {
  let state = createChallengeState(definition, "occurrence-1", "horizontal", 0, runtime);
  const assignedIds = definition.kind === "navigation"
    ? [runtime.assignments?.guide, runtime.assignments?.mover]
    : definition.kind === "memory" ? [runtime.assignments?.captain] : [runtime.assignments?.captain, runtime.assignments?.stealCaptain];
  for (const assignedId of assignedIds) {
    const participant = people.find((value) => value.kind === "member" ? value.uid === assignedId : value.id === assignedId)!;
    const actor = participant.kind === "member" ? participant.uid : participant.controllerUid;
    state = reduceChallenge(definition, state, intent(state, actor, "READY", 0, { participantId: assignedId, readiness: state.expectedReadiness }), people, runtime);
  }
  state = reduceChallenge(definition, state, intent(state, "host", "START", 0), people, runtime);
  assert.equal(state.stage, "countdown");
  return state;
}

test("navigation assigns authenticated distinct guide/mover, rejects forged bounds, and accepts an alternate legal route", () => {
  const runtime = config({ guide: "guide", mover: "mover" });
  let state = start(nav(), runtime);
  state = reconcileChallengeDeadline(nav(), state, 3_000);
  assert.equal(state.stage, "answer");

  const guideMove = reduceChallenge(nav(), state, intent(state, "guide", "MOVE", 3_001, { direction: "east" }), people, runtime);
  assert.deepEqual(guideMove, state);
  const forgedBounds = reduceChallenge(nav(), state, intent(state, "mover", "MOVE", 3_001, { direction: "north" }), people, runtime);
  assert.equal(forgedBounds.strikes, 0);
  assert.equal(forgedBounds.revision, state.revision);

  state = reduceChallenge(nav(), state, intent(state, "mover", "MOVE", 3_001, { direction: "east" }), people, runtime);
  state = reduceChallenge(nav(), state, intent(state, "mover", "MOVE", 3_002, { direction: "south" }), people, runtime);
  state = reduceChallenge(nav(), state, intent(state, "mover", "MOVE", 3_003, { direction: "north" }), people, runtime);
  state = reduceChallenge(nav(), state, intent(state, "mover", "MOVE", 3_004, { direction: "east" }), people, runtime);
  assert.equal(state.result, "correct");
  assert.deepEqual(state.moves, [{ row: 0, column: 1 }, { row: 1, column: 1 }, { row: 0, column: 1 }, { row: 0, column: 2 }]);
  assert.equal(hasNestedArray(JSON.parse(JSON.stringify(state))), false);
});

test("receipts bind authenticated actor and canonical payload, while a revoked mover cannot move", () => {
  const runtime = config({ guide: "guide", mover: "mover" });
  let state = createChallengeState(nav(), "receipt-occurrence", "horizontal", 0, runtime);
  const guideReady = { ...intent(state, "guide", "READY", 0, { participantId: "guide", readiness: state.expectedReadiness }), id: "same-id", payloadHash: "guide-ready" } as ChallengeIntent;
  state = reduceChallenge(nav(), state, guideReady, people, runtime);
  const validReplay = reduceChallenge(nav(), state, guideReady, people, runtime);
  assert.deepEqual(validReplay, state);
  assert.throws(() => reduceChallenge(nav(), state, { ...guideReady, payloadHash: "altered" }, people, runtime), /different canonical payload/);
  const moverReady = { ...intent(state, "mover", "READY", 0, { participantId: "mover", readiness: state.expectedReadiness }), id: "same-id", payloadHash: "mover-ready" } as ChallengeIntent;
  state = reduceChallenge(nav(), state, moverReady, people, runtime);
  state = reduceChallenge(nav(), state, intent(state, "host", "START", 0), people, runtime);
  state = reconcileChallengeDeadline(nav(), state, 3_000);
  const revoked = people.map((participant) => participant.kind === "member" && participant.uid === "mover" ? { ...participant, team: "vertical" as const } : participant);
  const rejected = reduceChallenge(nav(), state, intent(state, "mover", "MOVE", 3_001, { direction: "east" }), revoked, runtime);
  assert.equal(rejected.revision, state.revision);
  assert.equal(rejected.strikes, 0);

  const manualRuntime = config({ guide: "guide", mover: "manual-mover" });
  const manualState = reconcileChallengeDeadline(nav(), start(nav(), manualRuntime), 3_000);
  const switchedManual = people.map((participant) => participant.kind === "manual" && participant.id === "manual-mover" ? { ...participant, team: "vertical" as const } : participant);
  const manualRejected = reduceChallenge(nav(), manualState, intent(manualState, "host", "MOVE", 3_001, { direction: "east" }), switchedManual, manualRuntime);
  assert.equal(manualRejected.revision, manualState.revision);
  assert.equal(manualRejected.moves.length, 0);
});

test("blocked navigation consumes exactly three strikes while a host only controls an assigned manual mover", () => {
  const runtime = config({ guide: "guide", mover: "manual-mover" });
  let state = start(nav([[1, 0]]), runtime);
  state = reconcileChallengeDeadline(nav([[1, 0]]), state, 3_000);
  for (let index = 0; index < 3; index += 1) state = reduceChallenge(nav([[1, 0]]), state, intent(state, "host", "MOVE", 3_001 + index, { direction: "south" }), people, runtime);
  assert.equal(state.strikes, 3);
  assert.equal(state.result, "failed");
});

test("tile submission is stable, requires a host-started steal, and closes once", () => {
  const runtime = config({ captain: "captain", stealCaptain: "opponent" });
  let state = start(tile, runtime);
  state = reconcileChallengeDeadline(tile, state, 3_000);
  state = reduceChallenge(tile, state, intent(state, "captain", "SUBMIT", 3_001, { answers: ["wrong"] }), people, runtime);
  assert.equal(state.stage, "steal_offer");
  assert.equal(state.solutionRevealed, false);
  const prematureReveal = reduceChallenge(tile, state, intent(state, "host", "REVEAL", 3_002), people, runtime);
  assert.equal(prematureReveal.solutionRevealed, false);
  state = reduceChallenge(tile, state, intent(state, "host", "START_STEAL", 3_003), people, runtime);
  assert.equal(state.deadlineAt, 18_003);
  const submitted = reduceChallenge(tile, state, intent(state, "opponent", "SUBMIT", 3_004, { answers: ["correct"] }), people, runtime);
  const replayId = Object.keys(submitted.receipts).at(-1)!;
  const replay = reduceChallenge(tile, submitted, { ...intent(submitted, "opponent", "SUBMIT", 3_005, { answers: ["wrong"] }), id: replayId }, people, runtime);
  assert.equal(submitted.result, "correct");
  assert.deepEqual(replay, submitted);
  assert.equal(markChallengeAwarded(markChallengeAwarded(submitted)).awarded, true);
});

test("the exact answer deadline wins, and a host may decline a pending steal", () => {
  const runtime = config({ captain: "captain", stealCaptain: "opponent" });
  let state = start(tile, runtime);
  state = reconcileChallengeDeadline(tile, state, 3_000);
  const atDeadline = reduceChallenge(tile, state, intent(state, "captain", "SUBMIT", 33_000, { answers: ["correct"] }), people, runtime);
  assert.equal(atDeadline.stage, "steal_offer");
  state = reduceChallenge(tile, atDeadline, intent(atDeadline, "host", "DECLINE_STEAL", 33_001), people, runtime);
  assert.equal(state.result, "failed");
  state = reduceChallenge(tile, state, intent(state, "host", "REVEAL", 33_002), people, runtime);
  assert.equal(state.solutionRevealed, true);
});

test("memory keeps target grading until answer stage and catch-up never restarts observation", () => {
  const runtime = config({ captain: "captain", stealCaptain: "opponent" });
  let state = start(memory, runtime);
  state = reconcileChallengeDeadline(memory, state, 3_000);
  assert.equal(state.stage, "observation");
  assert.equal(state.stageStartedAt, 3_000);
  assert.equal(state.deadlineAt, 9_000);
  assert.ok(state.revision > 0);
  const tooEarly = reduceChallenge(memory, state, intent(state, "captain", "SUBMIT", 3_001, { answers: ["أزرق", "أخضر"] }), people, runtime);
  assert.equal(tooEarly.revision, state.revision);
  state = reconcileChallengeDeadline(memory, state, 9_000);
  assert.equal(state.stage, "answer");
  assert.equal(state.stageStartedAt, 9_000);
  assert.equal(state.deadlineAt, 29_000);
  const partial = reduceChallenge(memory, state, intent(state, "captain", "SUBMIT", 9_001, { answers: ["أزرق"] }), people, runtime);
  assert.equal(partial.result, "failed");

  const resumed = start(memory, runtime);
  const persisted = JSON.parse(JSON.stringify(resumed)) as ChallengeState;
  const expired = reconcileChallengeDeadline(memory, persisted, 100_000);
  assert.equal(expired.stage, "result");
  assert.equal(expired.result, "failed");
  assert.ok(expired.revision > persisted.revision);
});

test("pause reconciles a due observation before freezing it and resume extends its scheduled deadline", () => {
  const runtime = config({ captain: "captain", stealCaptain: "opponent" });
  let state = start(memory, runtime);
  state = reconcileChallengeDeadline(memory, state, 3_000);
  state = reconcileChallengeDeadline(memory, state, 9_000);
  state = reduceChallenge(memory, state, intent(state, "host", "PAUSE", 9_000), people, runtime);
  assert.equal(state.stage, "answer");
  assert.equal(state.paused?.deadlineAt, 29_000);
  state = resumeChallenge(memory, state, intent(state, "host", "RESUME", 10_000) as Extract<ChallengeIntent, { type: "RESUME" }>, runtime);
  assert.equal(state.deadlineAt, 30_000);
  assert.equal(reconcileChallengeDeadline(memory, state, 30_000).result, "failed");
});

test("setup state excludes private grading and conflicting RESUME retries fail closed", () => {
  const runtime = config({ captain: "captain" });
  let state = createChallengeState(memory, "private-setup", "horizontal", 0, runtime);
  const serializedSetup = JSON.stringify(state);
  assert.ok(!serializedSetup.includes("أزرق"));
  assert.ok(!serializedSetup.includes("targetAnswers"));

  state = start(memory, runtime);
  state = reconcileChallengeDeadline(memory, state, 3_000);
  state = reduceChallenge(memory, state, intent(state, "host", "PAUSE", 3_001), people, runtime);
  const resume = { ...intent(state, "host", "RESUME", 3_002), id: "resume-receipt", payloadHash: "resume-canonical" } as Extract<ChallengeIntent, { type: "RESUME" }>;
  state = resumeChallenge(memory, state, resume, runtime);
  assert.deepEqual(resumeChallenge(memory, state, resume, runtime), state);
  assert.throws(() => resumeChallenge(memory, state, { ...resume, payloadHash: "resume-changed" }, runtime), /different canonical payload/);
});

test("assignment changes invalidate readiness, and invalid initial roles cannot start", () => {
  const invalid = config({ guide: "guide", mover: "guide" });
  let state = createChallengeState(nav(), "occurrence-1", "horizontal", 0, invalid);
  state = reduceChallenge(nav(), state, intent(state, "guide", "READY", 0, { participantId: "guide", readiness: state.expectedReadiness }), people, invalid);
  state = reduceChallenge(nav(), state, intent(state, "host", "START", 0), people, invalid);
  assert.equal(state.stage, "setup");

  const runtime = config({});
  state = createChallengeState(tile, "occurrence-2", "horizontal", 0, runtime);
  state = reduceChallenge(tile, state, intent(state, "host", "ASSIGN", 0, { assignment: "captain", participantId: "captain" }), people, runtime);
  const stale = { ...state.expectedReadiness, assignmentHash: "assignment:0" };
  const staleReady = reduceChallenge(tile, state, intent(state, "captain", "READY", 0, { participantId: "captain", readiness: stale }), people, runtime);
  assert.equal(staleReady.revision, state.revision);
  assert.equal(state.expectedReadiness.assignmentHash, "assignment:1");
  assert.throws(() => createChallengeState({ ...tile, disposition: "held" }, "held-map", "horizontal", 0, config({ captain: "captain", stealCaptain: "opponent" })), /cannot be played/);
});

test("a host can explicitly ready and control distinct assigned manual participants, then void a paused exposure", () => {
  const manualPeople: Participant[] = [
    { kind: "manual", id: "initial-manual", controllerUid: "host", team: "horizontal" },
    { kind: "manual", id: "steal-manual", controllerUid: "host", team: "vertical" },
  ];
  const runtime = config({ captain: "initial-manual", stealCaptain: "steal-manual" });
  let state = createChallengeState(tile, "manual-occurrence", "horizontal", 0, runtime);
  for (const participantId of ["initial-manual", "steal-manual"]) state = reduceChallenge(tile, state, intent(state, "host", "READY", 0, { participantId, readiness: state.expectedReadiness }), manualPeople, runtime);
  state = reduceChallenge(tile, state, intent(state, "host", "START", 0), manualPeople, runtime);
  state = reconcileChallengeDeadline(tile, state, 3_000);
  state = reduceChallenge(tile, state, intent(state, "host", "SUBMIT", 3_001, { answers: ["wrong"] }), manualPeople, runtime);
  state = reduceChallenge(tile, state, intent(state, "host", "START_STEAL", 3_002), manualPeople, runtime);
  state = reduceChallenge(tile, state, intent(state, "host", "SUBMIT", 3_003, { answers: ["correct"] }), manualPeople, runtime);
  assert.equal(state.result, "correct");

  const memoryRuntime = config({ captain: "captain" });
  let exposed = start(memory, memoryRuntime);
  exposed = reconcileChallengeDeadline(memory, exposed, 3_000);
  const priorDisclosure = exposed.disclosureGeneration;
  exposed = reduceChallenge(memory, exposed, intent(exposed, "host", "PAUSE", 3_001), people, memoryRuntime);
  exposed = reduceChallenge(memory, exposed, intent(exposed, "host", "VOID", 3_002), people, memoryRuntime);
  assert.equal(exposed.result, "void");
  assert.equal(exposed.paused, undefined);
  assert.ok(exposed.disclosureGeneration > priorDisclosure);
});

test("the board bridge awards a correct closed occurrence once and preserves its retained terminal result", () => {
  const runtime = config({ guide: "guide", mover: "mover" });
  let challenge = start(nav(), runtime);
  challenge = reconcileChallengeDeadline(nav(), challenge, 3_000);
  challenge = reduceChallenge(nav(), challenge, intent(challenge, "mover", "MOVE", 3_001, { direction: "east" }), people, runtime);
  challenge = reduceChallenge(nav(), challenge, intent(challenge, "mover", "MOVE", 3_002, { direction: "east" }), people, runtime);
  const board = generateBoard(1, ["أ", "ب", "ت", "ث", "ج", "ح", "خ", "د", "ذ", "ر", "ز", "س", "ش", "ص", "ض", "ط"]);
  const game: GameState = { lifecycle: "FIRST_ANSWER", ruleSet: "v2", board, activeCellId: board.cells[0]!.id, entitledTeam: "horizontal", answeringTeam: "horizontal", questionScores: { horizontal: 0, vertical: 0 }, currentRound: 1, roundOutcomeHistory: [], attempt: "initial" };
  const context = createChallengeBridgeContext(challenge.occurrence, game.activeCellId!);
  const first = applyChallengeAward(challenge, game, context);
  const replay = applyChallengeAward(first.challenge, first.game, first.context);
  assert.equal(first.challenge.result, "correct");
  assert.equal(first.game.questionScores.horizontal, 1);
  assert.equal(replay.game.questionScores.horizontal, 1);
  assert.equal(replay.game.board?.cells.find((cell) => cell.id === game.activeCellId)?.owner, "horizontal");
  const persistedReplay = applyChallengeAward(
    JSON.parse(JSON.stringify(first.challenge)) as typeof first.challenge,
    JSON.parse(JSON.stringify(first.game)) as typeof first.game,
    JSON.parse(JSON.stringify(first.context)) as typeof first.context,
  );
  assert.equal(JSON.stringify(persistedReplay), JSON.stringify({ challenge: first.challenge, game: first.game, context: first.context }));
  assert.throws(() => applyChallengeAward({ ...challenge, answeringTeam: "vertical" }, game, context), /does not match/);
  assert.throws(() => applyChallengeAward({ ...challenge, occurrence: "stale" }, game, context), /stale occurrence/);
  assert.throws(() => applyChallengeAward(challenge, { ...game, activeCellId: board.cells[1]!.id }, context), /stale selected cell/);
});

test("the board bridge synchronizes an audited steal and returns a continued failed cell unclaimed", () => {
  const runtime = config({ captain: "captain", stealCaptain: "opponent" });
  let challenge = start(tile, runtime);
  challenge = reconcileChallengeDeadline(tile, challenge, 3_000);
  challenge = reduceChallenge(tile, challenge, intent(challenge, "captain", "SUBMIT", 3_001, { answers: ["wrong"] }), people, runtime);
  challenge = reduceChallenge(tile, challenge, intent(challenge, "host", "START_STEAL", 3_002), people, runtime);
  challenge = reduceChallenge(tile, challenge, intent(challenge, "opponent", "SUBMIT", 3_003, { answers: ["correct"] }), people, runtime);
  const board = generateBoard(2, ["أ", "ب", "ت", "ث", "ج", "ح", "خ", "د", "ذ", "ر", "ز", "س", "ش", "ص", "ض", "ط"]);
  const game: GameState = { lifecycle: "FIRST_ANSWER", ruleSet: "v2", board, activeCellId: board.cells[0]!.id, entitledTeam: "horizontal", answeringTeam: "horizontal", questionScores: { horizontal: 0, vertical: 0 }, currentRound: 1, roundOutcomeHistory: [], attempt: "initial" };
  const context = createChallengeBridgeContext(challenge.occurrence, game.activeCellId!);
  assert.equal(applyChallengeAward(challenge, game, context).game.questionScores.vertical, 1);

  const memoryRuntime = config({ captain: "captain" });
  let failed = start(memory, memoryRuntime);
  failed = reconcileChallengeDeadline(memory, failed, 3_000);
  failed = reconcileChallengeDeadline(memory, failed, 29_000);
  failed = reduceChallenge(memory, failed, intent(failed, "host", "CONTINUE", 29_001), people, memoryRuntime);
  const continuationContext = createChallengeBridgeContext(failed.occurrence, game.activeCellId!);
  const returned = applyChallengeContinuation(failed, game, continuationContext);
  assert.equal(returned.game.lifecycle, "CELL_SELECTION");
  assert.equal(returned.game.board?.cells.find((cell) => cell.id === game.activeCellId)?.owner, undefined);
  assert.deepEqual(applyChallengeContinuation(failed, returned.game, returned.context), { challenge: failed, game: returned.game, context: returned.context });
  assert.throws(() => applyChallengeContinuation({ ...failed, occurrence: "revisited-occurrence" }, game, continuationContext), /stale occurrence/);
  assert.throws(() => applyChallengeContinuation(failed, { ...game, activeCellId: board.cells[1]!.id }, continuationContext), /stale selected cell/);
  const persistedContinuation = applyChallengeContinuation(
    JSON.parse(JSON.stringify(failed)) as typeof failed,
    JSON.parse(JSON.stringify(returned.game)) as typeof returned.game,
    JSON.parse(JSON.stringify(returned.context)) as typeof returned.context,
  );
  assert.equal(JSON.stringify(persistedContinuation), JSON.stringify({ challenge: failed, game: returned.game, context: returned.context }));
});

test("a voided occurrence continues its unclaimed cell exactly once after JSON persistence", () => {
  const runtime = config({ captain: "captain" });
  let voided = start(memory, runtime);
  voided = reconcileChallengeDeadline(memory, voided, 3_000);
  voided = reduceChallenge(memory, voided, intent(voided, "host", "VOID", 3_001), people, runtime);
  voided = reduceChallenge(memory, voided, intent(voided, "host", "CONTINUE", 3_002), people, runtime);
  assert.equal(voided.result, "void");
  assert.equal(voided.continued, true);

  const board = generateBoard(3, ["أ", "ب", "ت", "ث", "ج", "ح", "خ", "د", "ذ", "ر", "ز", "س", "ش", "ص", "ض", "ط"]);
  const game: GameState = { lifecycle: "FIRST_ANSWER", ruleSet: "v2", board, activeCellId: board.cells[0]!.id, entitledTeam: "horizontal", answeringTeam: "horizontal", questionScores: { horizontal: 0, vertical: 0 }, currentRound: 1, roundOutcomeHistory: [], attempt: "initial" };
  const first = applyChallengeContinuation(voided, game, createChallengeBridgeContext(voided.occurrence, game.activeCellId!));
  assert.equal(first.game.lifecycle, "CELL_SELECTION");
  const replay = applyChallengeContinuation(
    JSON.parse(JSON.stringify(voided)) as typeof voided,
    JSON.parse(JSON.stringify(first.game)) as typeof first.game,
    JSON.parse(JSON.stringify(first.context)) as typeof first.context,
  );
  assert.equal(JSON.stringify(replay), JSON.stringify({ challenge: voided, game: first.game, context: first.context }));
});
