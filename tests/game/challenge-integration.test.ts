import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { CanonicalChallengeDefinition } from "../../src/features/game/challenges/definition.js";
import {
  assertChallengeBoardIntentAllowed,
  canonicalChallengeJson,
  teamForChallengeRecipient,
  compactChallengeState,
  definitionPayload,
  parseChallengeDefinitionEnvelope,
  projectChallenge,
  restoreChallengeState,
} from "../../src/features/game/challenges/integration.js";
import { createChallengeState, reconcileChallengeDeadline, reduceChallenge, type ChallengeIntent, type ChallengeRuntimeConfig, type Participant } from "../../src/features/game/challenges/engine.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const hash = "a".repeat(64);
const source = { sourceId: "synthetic", sourcePack: "test", sourcePath: "private", sourceRawSha256: hash, sourceContextsSha256: hash, mediaArchiveSha256: hash };
const navPayload = {
  schemaVersion: "t36-challenge-definition-v1" as const,
  id: "synthetic-nav",
  kind: "navigation" as const,
  categoryId: "tahadani-games-120" as const,
  ordinal: 1,
  disposition: "ready" as const,
  source,
  media: [
    { role: "answer" as const, visibility: "host_only" as const, originalObjectName: "private-answer", originalSha256: hash, derivativeObjectName: "private-answer", derivativeSha256: hash },
    { role: "question" as const, visibility: "guide_only" as const, originalObjectName: "private-guide", originalSha256: hash, derivativeObjectName: "private-guide", derivativeSha256: hash },
    { role: "question" as const, visibility: "player" as const, originalObjectName: "private-player", originalSha256: hash, derivativeObjectName: "private-player", derivativeSha256: hash },
  ],
  publicData: { rows: 5 as const, columns: 5 as const, start: [0, 0] as const, timeLimitSeconds: 60 as const, promptAr: "اتجه" },
  privateGrading: { goal: [0, 2] as const, blocked: [[1, 0]] as const, canonicalDirections: ["east", "east"] as const, canonicalPath: [[0, 0], [0, 1], [0, 2]] as const },
  factFamilies: ["synthetic-place"],
  maxPerGameFamily: 1 as const,
};
const definition: CanonicalChallengeDefinition = { ...navPayload, definitionSha256: digest(canonicalChallengeJson(navPayload)) };
const envelope = { manifestSha256: "b".repeat(64), id: definition.id, schemaVersion: definition.schemaVersion, definitionSha256: definition.definitionSha256, canonicalJson: canonicalChallengeJson(definition) };
const participants: Participant[] = [{ kind: "member", uid: "guide", team: "horizontal" }, { kind: "member", uid: "mover", team: "horizontal" }];
const config: ChallengeRuntimeConfig = { hostUid: "host", protocolHash: "protocol", assignmentHash: "assignments", stimulusHash: "stimulus", assignments: { guide: "guide", mover: "mover" } };
const intent = (state: ReturnType<typeof createChallengeState>, actor: string, type: ChallengeIntent["type"], at: number, extra: object = {}) => ({ id: `${actor}-${type}-${state.revision}`, actor, payloadHash: `${actor}-${type}-${state.revision}`, occurrence: state.occurrence, revision: state.revision, expectedStage: state.stage, at, type, ...extra } as ChallengeIntent);

test("private envelope is byte-canonical, hash-bound, and fails closed on identity drift", () => {
  assert.deepEqual(parseChallengeDefinitionEnvelope(envelope, digest), definition);
  assert.throws(() => parseChallengeDefinitionEnvelope({ ...envelope, id: "other" }, digest), /IDENTITY_MISMATCH/);
  assert.throws(() => parseChallengeDefinitionEnvelope({ ...envelope, canonicalJson: `${envelope.canonicalJson} ` }, digest), /CANONICAL_JSON_MISMATCH/);
  assert.equal(JSON.stringify(definitionPayload(definition)).includes("definitionSha256"), false);
});

test("compact persistence removes reducer receipts and preserves only current navigation position", () => {
  let state = createChallengeState(definition, "occurrence", "horizontal", 0, config);
  for (const participant of participants) {
    const participantId = participant.kind === "member" ? participant.uid : participant.id;
    const actor = participant.kind === "member" ? participant.uid : participant.controllerUid;
    state = reduceChallenge(definition, state, intent(state, actor, "READY", 0, { participantId, readiness: state.expectedReadiness }), participants, config);
  }
  state = reduceChallenge(definition, state, intent(state, "host", "START", 0), participants, config);
  state = reconcileChallengeDeadline(definition, state, 3_000);
  state = reduceChallenge(definition, state, intent(state, "mover", "MOVE", 3_001, { direction: "east" }), participants, config);
  state = reduceChallenge(definition, state, intent(state, "mover", "MOVE", 3_002, { direction: "west" }), participants, config);
  const persisted = compactChallengeState(state);
  assert.equal("receipts" in persisted, false);
  assert.equal("moves" in persisted, false);
  assert.deepEqual(persisted.navigation, { current: { row: 0, column: 0 }, confirmedEdges: ["0,0/0,1"] });
  assert.deepEqual(restoreChallengeState(JSON.parse(JSON.stringify(persisted))).moves, [{ row: 0, column: 0 }]);
  assert.deepEqual(restoreChallengeState(JSON.parse(JSON.stringify(persisted))).confirmedEdges, ["0,0/0,1"]);
});

test("projection allowlists guide-only navigation details and blocks generic board bypass", () => {
  const state = { ...reconcileChallengeDeadline(definition, createChallengeState(definition, "occurrence", "horizontal", 0, config), 0), stage: "answer" as const, deadlineAt: 10_000 };
  const guide = projectChallenge(definition, state, "guide");
  const mover = projectChallenge(definition, state, "mover");
  assert.match(JSON.stringify(guide), /blocked/);
  assert.match(JSON.stringify(guide), /goal/);
  assert.equal(JSON.stringify(mover).includes("blocked"), false);
  assert.equal(JSON.stringify(mover).includes("goal"), false);
  assert.equal(JSON.stringify(projectChallenge(definition, state, "host")).includes("canonicalDirections"), false);
  assert.deepEqual(projectChallenge(definition, state, "guide").legalActions, []);
  assert.deepEqual(projectChallenge(definition, { ...state, stage: "steal_offer", attempt: "steal" }, "host").legalActions, ["START_STEAL", "DECLINE_STEAL", "VOID"]);
  assert.deepEqual(projectChallenge(definition, { ...state, paused: { at: 1, from: "answer", deadlineAt: 10_000 } }, "host").legalActions, ["RESUME", "VOID"]);
  assert.throws(() => assertChallengeBoardIntentAllowed(state, "JUDGE_CORRECT"), /CHALLENGE_ACTIVE_LEGACY_INTENT_BLOCKED/);
  assert.doesNotThrow(() => assertChallengeBoardIntentAllowed(state, "CHALLENGE_MOVE"));
});

test("a paused challenge masks previously visible stimuli", () => {
  const paused = { ...createChallengeState(definition, "occurrence", "horizontal", 0, config), stage: "answer" as const, paused: { at: 1, from: "observation" as const, deadlineAt: 9_000 } };
  const projection = projectChallenge(definition, paused, "guide");
  assert.equal(projection.paused, true);
  assert.equal(projection.stimulus, undefined);
});


test("restored navigation retains every finite confirmed edge through a later move", () => {
  let state = createChallengeState(definition, "occurrence", "horizontal", 0, config);
  for (const participant of participants) {
    const participantId = participant.kind === "member" ? participant.uid : participant.id;
    const actor = participant.kind === "member" ? (participant.actorUid ?? participant.uid) : participant.controllerUid;
    state = reduceChallenge(definition, state, intent(state, actor, "READY", 0, { participantId, readiness: state.expectedReadiness }), participants, config);
  }
  state = reduceChallenge(definition, state, intent(state, "host", "START", 0), participants, config);
  state = reconcileChallengeDeadline(definition, state, 3_000);
  state = reduceChallenge(definition, state, intent(state, "mover", "MOVE", 3_001, { direction: "east" }), participants, config);
  const restored = restoreChallengeState(JSON.parse(JSON.stringify(compactChallengeState(state))));
  const next = reduceChallenge(definition, restored, intent(restored, "mover", "MOVE", 3_002, { direction: "east" }), participants, config);
  assert.deepEqual(next.confirmedEdges, ["0,0/0,1", "0,1/0,2"]);
  assert.deepEqual(compactChallengeState(next).navigation?.confirmedEdges, ["0,0/0,1", "0,1/0,2"]);
});

test("qualified manual and authenticated member IDs cannot collide in assignments", () => {
  const identities: Participant[] = [
    { kind: "member", uid: "member:shared", actorUid: "member-auth", team: "horizontal" },
    { kind: "manual", id: "manual:shared", controllerUid: "host", team: "horizontal" },
  ];
  let state = createChallengeState(definition, "collision", "horizontal", 0, { ...config, assignments: {} });
  state = reduceChallenge(definition, state, intent(state, "host", "ASSIGN", 0, { assignment: "guide", participantId: "member:shared" }), identities, config);
  state = reduceChallenge(definition, state, intent(state, "host", "ASSIGN", 0, { assignment: "mover", participantId: "manual:shared" }), identities, config);
  assert.deepEqual(state.assignments, { guide: "member:shared", mover: "manual:shared" });
  const forged = reduceChallenge(definition, state, intent(state, "shared", "READY", 0, { participantId: "member:shared", readiness: state.expectedReadiness }), identities, config);
  assert.equal(forged, state);
  const memberReady = reduceChallenge(definition, state, intent(state, "member-auth", "READY", 0, { participantId: "member:shared", readiness: state.expectedReadiness }), identities, config);
  assert.notEqual(memberReady, state);
});


test("steal captain is projected to the opposing team during setup and steal", () => {
  const state = { entitledTeam: "horizontal", answeringTeam: "horizontal", assignments: { stealCaptain: "member:opponent" } } as never;
  assert.equal(teamForChallengeRecipient(state, "stealCaptain"), "vertical");
  assert.equal(teamForChallengeRecipient({ ...(state as Record<string, unknown>), answeringTeam: "vertical" } as never, "stealCaptain"), "vertical");
});


test("only the current captain projection can submit during answer or steal", () => {
  const base = { stage: "answer", occurrence: "o", revision: 1, assignmentGeneration: 1, disclosureGeneration: 1, entitledTeam: "horizontal", answeringTeam: "horizontal", paused: false, strikes: 0, assignments: { captain: "member:captain", stealCaptain: "member:opponent" }, moves: [], confirmedEdges: [], ready: {}, expectedReadiness: { protocolHash: "p", assignmentHash: "a", stimulusHash: "s" }, attemptsClosed: false, solutionRevealed: false } as never;
  assert.deepEqual(projectChallenge(definition, base, "captain").legalActions, ["SUBMIT"]);
  assert.deepEqual(projectChallenge(definition, base, "stealCaptain").legalActions, []);
  const steal = { ...(base as Record<string, unknown>), stage: "steal", answeringTeam: "vertical" } as never;
  assert.deepEqual(projectChallenge(definition, steal, "captain").legalActions, []);
  assert.deepEqual(projectChallenge(definition, steal, "stealCaptain").legalActions, ["SUBMIT"]);
});
