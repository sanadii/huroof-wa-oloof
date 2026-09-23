import { createHash } from 'node:crypto';
import { generateBoard, generateCategoryBoard, revealSurprise, type TeamAxis } from '../../src/features/game/domain/board.js';
import { deriveMatch, reduceGame, type GameEvent, type GameState } from '../../src/features/game/domain/lifecycle.js';
import type { MatchQuestionSelection, ChallengeCategoryQuestionSelection } from '../../src/features/game/runtime/challenge-question-selector.js';
import { type ChallengeCapabilityOffer, type ChallengeMechanic } from '../../src/features/game/runtime/contracts.js';
import { canonicalChallengeJson, participantRecipient, projectChallenge, restoreChallengeState, teamForChallengeRecipient, type ChallengeDefinitionReference, type PersistedChallengeState } from '../../src/features/game/challenges/integration.js';
import type { CanonicalChallengeDefinition } from '../../src/features/game/challenges/definition.js';

export type MemberRole = 'host' | 'player' | 'audience';
export type CanonicalMember = { uid: string; role: MemberRole; displayName: string; ready: boolean; active: boolean; team?: TeamAxis; joinedAt?: unknown };
export type ManualParticipant = { id: string; displayName: string; team: TeamAxis };
export type CanonicalQuestion = { id: string; targetLetter?: string; headerAr: string; promptAr: string; canonicalAnswer: string; acceptedAnswers: string[]; categoryId?: string; modality?: 'classic' | 'image' | 'video' | 'charades'; answerConceptId?: string; /** Metadata only: private grading remains in the definition envelope. */ challenge?: { definition: ChallengeDefinitionReference; factFamilies: string[]; kind: ChallengeMechanic }; media?: { mediaId: string; altAr: string; assetSha256: string; type?: 'image' | 'video'; contentType?: string; audiencePresentation?: 'clear' | 'concealed' }; answerMedia?: { mediaId: string; altAr: string; assetSha256: string; type?: 'image' | 'video'; contentType?: string }; sources?: Array<{ title?: string; url?: string }>; review?: unknown; moderation?: unknown };
export type CanonicalRoom = { schemaVersion: 2; roomCode: string; revision: number; game: GameState; config: { policyVersion?: 1; demo: boolean; questionSeconds: number; opponentSeconds: number; teams: Record<TeamAxis, string>; releaseId: string; releaseRootSha256: string; releaseDemoFixture: boolean; gameKind?: 'huroof' | 'categories'; categorySnapshot?: Array<{ id: string; labelAr: string }>; categories?: string[]; modality?: 'classic' | 'image' | 'video' | 'charades'; difficulty?: string; mode?: 'classic' | 'fast' | 'custom'; showQuestionOnAudience?: boolean; labelledColours?: boolean; mapPresentation?: 'ordinary' | 'interactive'; /** Immutable sidecar namespace pin; absent only for legacy ordinary releases. */ mapVariantBinding?: { schemaVersion: 't36-map-variant-v1'; definitionManifestSha256: string; definitionEnvelopeRootSha256: string; sidecarSha256: string; count: 300; reviewed: 205; held: 95 }; challenge?: ChallengeCapabilityOffer; /** Server-only marker; permit data and host identity never enter projections. */ qaAdmission?: { permitId: string } }; categoryOccurrences?: Record<string, number>; manualParticipants?: ManualParticipant[]; timer?: { deadlineMs: number; buzzOpen: boolean; remainingMs?: number; pausedBuzzOpen?: boolean }; buzzWinner?: { uid?: string; displayName: string; team: TeamAxis; method: 'player' | 'host' }; activeQuestion?: CanonicalQuestion; activeQuestionOccurrence?: string; answerRevealedOccurrence?: string; questionSelection?: MatchQuestionSelection | ChallengeCategoryQuestionSelection; /** The canonical definition is never embedded in this room. */ challenge?: PersistedChallengeState; challengeBridge?: import('../../src/features/game/challenges/award-bridge.js').TrustedChallengeBridgeContext; questionCursor: number; createdAt?: unknown; updatedAt?: unknown };
export type IntentType = 'LOBBY_SET_READY' | 'LOBBY_ASSIGN_TEAM' | 'LOBBY_ADD_MANUAL_PLAYER' | 'START_MATCH' | 'ROUND_READY' | 'SELECT_CELL' | 'LETTER_REVEALED' | 'OPEN_QUESTION' | 'BUZZ' | 'HOST_SELECT_TEAM' | 'JUDGE_CORRECT' | 'JUDGE_INCORRECT' | 'RETRY_CELL' | 'RETURN_CELL' | 'END_WITHOUT_WINNER' | 'AWARD_CELL' | 'CHECK_PATH' | 'START_NEXT_ROUND' | 'PAUSE' | 'RESUME' | 'BEGIN_CORRECTION' | 'CONFIRM_CORRECTION' | 'CANCEL_CORRECTION' | 'SET_AUDIENCE_QUESTION_VISIBILITY' | 'REVEAL_ANSWER' | 'CHALLENGE_ASSIGN' | 'CHALLENGE_READY' | 'CHALLENGE_START' | 'CHALLENGE_MOVE' | 'CHALLENGE_SUBMIT' | 'CHALLENGE_START_STEAL' | 'CHALLENGE_DECLINE_STEAL' | 'CHALLENGE_PAUSE' | 'CHALLENGE_RESUME' | 'CHALLENGE_VOID' | 'CHALLENGE_REVEAL' | 'CHALLENGE_CONTINUE';
export type GameIntent = { type: IntentType; intentId: string; expectedRevision: number; payload: Record<string, unknown> };
export const MAX_PLAYERS = 16; export const MAX_AUDIENCE = 200;
export const canManageTeamsInState = (lifecycle: GameState['lifecycle']) =>
  ['LOBBY', 'ROUND_SETUP', 'CELL_SELECTION', 'QUESTION_FAILED', 'ROUND_COMPLETE'].includes(lifecycle);
export function isRoomClosed(room: CanonicalRoom) { return Boolean((room as CanonicalRoom & { closedAt?: unknown }).closedAt); }
/** An absent legacy occurrence is always unrevealed; equality alone is unsafe. */
export function hasRevealedOccurrence(activeOccurrence: unknown, revealedOccurrence: unknown) { return typeof activeOccurrence === 'string' && activeOccurrence.length > 0 && activeOccurrence === revealedOccurrence; }
export function roomGameKind(room: CanonicalRoom): 'huroof' | 'categories' { const version = room.config.policyVersion; const value = room.config.gameKind; if (version === undefined) { if (value === undefined || value === 'huroof') return 'huroof'; throw new Error('unknown-room-policy'); } if (version !== 1 || (value !== 'huroof' && value !== 'categories')) throw new Error('unknown-room-policy'); return value; }
const types = new Set<IntentType>(['LOBBY_SET_READY', 'LOBBY_ASSIGN_TEAM', 'LOBBY_ADD_MANUAL_PLAYER', 'START_MATCH', 'ROUND_READY', 'SELECT_CELL', 'LETTER_REVEALED', 'OPEN_QUESTION', 'BUZZ', 'HOST_SELECT_TEAM', 'JUDGE_CORRECT', 'JUDGE_INCORRECT', 'RETRY_CELL', 'RETURN_CELL', 'END_WITHOUT_WINNER', 'AWARD_CELL', 'CHECK_PATH', 'START_NEXT_ROUND', 'PAUSE', 'RESUME', 'BEGIN_CORRECTION', 'CONFIRM_CORRECTION', 'CANCEL_CORRECTION', 'SET_AUDIENCE_QUESTION_VISIBILITY', 'REVEAL_ANSWER', 'CHALLENGE_ASSIGN', 'CHALLENGE_READY', 'CHALLENGE_START', 'CHALLENGE_MOVE', 'CHALLENGE_SUBMIT', 'CHALLENGE_START_STEAL', 'CHALLENGE_DECLINE_STEAL', 'CHALLENGE_PAUSE', 'CHALLENGE_RESUME', 'CHALLENGE_VOID', 'CHALLENGE_REVEAL', 'CHALLENGE_CONTINUE']);

export function validateDisplayName(value: unknown, fallback?: string): string { const name = typeof value === 'string' ? value.trim() : fallback?.trim(); if (!name || name.length > 48 || /\p{Cc}/u.test(name)) throw new Error('invalid-display-name'); return name; }
export function normalizeRoomCode(value: string): string { const code = value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (!/^[A-Z0-9]{8}$/.test(code)) throw new Error('invalid-room-code'); return code; }
export function intentReceiptId(uid: string, intentId: string): string { return createHash('sha256').update(uid).update('\0').update(intentId).digest('hex'); }
export function intentHash(intent: GameIntent): string {
  const body = { type: intent.type, expectedRevision: intent.expectedRevision, payload: intent.payload };
  // Ordinary receipts keep their established byte-for-byte JSON digest. T36
  // receipts canonicalize nested readiness objects so semantically identical
  // client serializations replay across local and Firebase authorities.
  return createHash('sha256').update(intent.type.startsWith('CHALLENGE_') ? canonicalChallengeJson(body) : JSON.stringify(body)).digest('hex');
}
function validChallengePayload(type: IntentType, payload: Record<string, unknown>) {
  const common = ['occurrence', 'challengeRevision', 'stage'];
  const keys = Object.keys(payload);
  const challengeRevision = payload.challengeRevision;
  if (!keys.every((key) => common.includes(key) || ['assignment', 'participantId', 'readiness', 'direction', 'answers'].includes(key)) || typeof payload.occurrence !== 'string' || !/^[A-Za-z0-9:_-]{1,180}$/.test(payload.occurrence) || typeof challengeRevision !== 'number' || !Number.isSafeInteger(challengeRevision) || challengeRevision < 0 || !['setup', 'countdown', 'observation', 'answer', 'steal_offer', 'steal', 'result', 'void'].includes(payload.stage as string)) return false;
  if (type === 'CHALLENGE_ASSIGN') return keys.length === 5 && ['guide', 'mover', 'captain', 'stealCaptain'].includes(payload.assignment as string) && typeof payload.participantId === 'string' && /^(member|manual):[A-Za-z0-9_-]{1,120}$/.test(payload.participantId);
  if (type === 'CHALLENGE_READY') { const value = payload.readiness as Record<string, unknown> | undefined; return keys.length === 5 && typeof payload.participantId === 'string' && /^(member|manual):[A-Za-z0-9_-]{1,120}$/.test(payload.participantId) && value !== undefined && Object.keys(value).length === 3 && ['protocolHash', 'assignmentHash', 'stimulusHash'].every((key) => typeof value[key] === 'string' && (value[key] as string).length > 0 && (value[key] as string).length <= 256); }
  if (type === 'CHALLENGE_MOVE') return keys.length === 4 && ['north', 'east', 'south', 'west'].includes(payload.direction as string);
  if (type === 'CHALLENGE_SUBMIT') return keys.length === 4 && Array.isArray(payload.answers) && payload.answers.length > 0 && payload.answers.length <= 3 && payload.answers.every((answer) => typeof answer === 'string' && answer.length <= 64);
  return keys.length === 3;
}
export function validIntent(intent: unknown): intent is GameIntent { if (!intent || typeof intent !== 'object') return false; const value = intent as GameIntent; if (!Object.keys(value).every((key) => ['type', 'intentId', 'expectedRevision', 'payload'].includes(key)) || typeof value.type !== 'string' || typeof value.intentId !== 'string' || !types.has(value.type as IntentType) || !/^[A-Za-z0-9_-]{1,120}$/.test(value.intentId) || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0 || !value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) return false; const keys = Object.keys(value.payload); if (value.type.startsWith('CHALLENGE_')) return validChallengePayload(value.type, value.payload); if (value.type === 'LOBBY_SET_READY') return keys.length === 1 && typeof value.payload.ready === 'boolean'; if (value.type === 'LOBBY_ASSIGN_TEAM') { const hasMember = typeof value.payload.memberUid === 'string' && value.payload.memberUid.length > 0 && value.payload.memberUid.length <= 128; const hasManual = typeof value.payload.manualParticipantId === 'string' && value.payload.manualParticipantId.length > 0 && value.payload.manualParticipantId.length <= 128; return keys.length === 2 && (hasMember !== hasManual) && (value.payload.team === 'horizontal' || value.payload.team === 'vertical'); } if (value.type === 'LOBBY_ADD_MANUAL_PLAYER') return keys.length === 2 && typeof value.payload.displayName === 'string' && (value.payload.team === 'horizontal' || value.payload.team === 'vertical'); if (value.type === 'SELECT_CELL') return keys.length === 1 && typeof value.payload.cellId === 'string' && /^cell-[0-4]-[0-4]$/.test(value.payload.cellId); if (value.type === 'HOST_SELECT_TEAM') return keys.length === 1 && (value.payload.team === 'horizontal' || value.payload.team === 'vertical'); if (value.type === 'SET_AUDIENCE_QUESTION_VISIBILITY') return keys.length === 1 && typeof value.payload.showQuestion === 'boolean'; if (value.type === 'REVEAL_ANSWER') return keys.length === 1 && typeof value.payload.occurrence === 'string' && /^[A-Za-z0-9:_-]{1,180}$/.test(value.payload.occurrence); if (value.type === 'BEGIN_CORRECTION') return keys.every((key) => ['cellId', 'owner', 'reason'].includes(key)) && typeof value.payload.cellId === 'string' && /^cell-[0-4]-[0-4]$/.test(value.payload.cellId) && (value.payload.owner === undefined || value.payload.owner === 'horizontal' || value.payload.owner === 'vertical') && typeof value.payload.reason === 'string' && value.payload.reason.trim().length > 0 && value.payload.reason.length <= 240; return keys.length === 0; }

export function activePlayerCount(room: CanonicalRoom, members: CanonicalMember[]) { return members.filter((member) => member.active && member.role === 'player').length + (room.manualParticipants?.length ?? 0); }
function allReady(room: CanonicalRoom, members: CanonicalMember[]) { const players = members.filter((member) => member.active && member.role === 'player'); const manual = room.manualParticipants ?? []; const teams = [...players.map((member) => member.team), ...manual.map((participant) => participant.team)]; return teams.length === 0 || (teams.length >= 2 && new Set(teams).size === 2 && players.every((member) => member.ready)); }
function teamCanBuzz(room: CanonicalRoom, team: TeamAxis) { return room.game.lifecycle === 'QUESTION_READING' || (room.game.lifecycle === 'OPPONENT_CHANCE' && room.game.entitledTeam === team); }
function timerIsOpen(room: CanonicalRoom, now: number) { return !hasRevealedOccurrence(room.activeQuestionOccurrence, room.answerRevealedOccurrence) && (room.game.lifecycle === 'QUESTION_READING' || room.game.lifecycle === 'OPPONENT_CHANCE') && (!room.timer || Boolean(room.timer.buzzOpen && room.timer.deadlineMs > now)); }

/** This always builds a new role-safe object; canonical question/review fields cannot serialize by accident. */
export function projectRoom(roomId: string, room: CanonicalRoom, members: CanonicalMember[], role: MemberRole, uid?: string, now = Date.now(), definition?: CanonicalChallengeDefinition) {
  const gameKind = roomGameKind(room);
const closed = isRoomClosed(room); const active = members.filter((member) => member.active); const participants = active.filter((member) => member.role !== 'audience'); const self = uid ? active.find((member) => member.uid === uid) : undefined; const match = deriveMatch(room.game); const canStart = allReady(room, participants); const challengeActive = Boolean(room.challenge && !room.challenge.continued && !closed); const questionVisible = !closed && !challengeActive && ['QUESTION_READING', 'FIRST_ANSWER', 'OPPONENT_CHANCE', 'QUESTION_FAILED', 'PAUSED'].includes(room.game.lifecycle); const mediaVisible = role === 'host' || role === 'audience'; const revealed = hasRevealedOccurrence(room.activeQuestionOccurrence, room.answerRevealedOccurrence); const sharedAnswerVisible = !closed && mediaVisible && (role === 'host' || !room.activeQuestion?.media) && (revealed || room.game.lifecycle === 'QUESTION_FAILED'); const visibleMedia = role === 'host' && revealed ? room.activeQuestion?.answerMedia ?? room.activeQuestion?.media : room.activeQuestion?.media; const mediaOccurrence = room.activeQuestionOccurrence; const publicQuestion = room.activeQuestion && questionVisible ? { ...(mediaOccurrence ? { occurrence: mediaOccurrence } : {}), headerAr: room.activeQuestion.headerAr, promptAr: room.activeQuestion.promptAr, ...(mediaVisible && visibleMedia ? { media: visibleMedia } : {}), ...(sharedAnswerVisible ? { revealedAnswer: room.activeQuestion.canonicalAnswer } : {}) } : undefined; const winner = room.buzzWinner ? { displayName: room.buzzWinner.displayName, team: room.buzzWinner.team, method: room.buzzWinner.method } : undefined;
const players = active.filter((member) => member.role === 'player'); const manual = room.manualParticipants ?? []; const displayedParticipants = [...participants.map((member) => ({ displayName: member.displayName, team: member.team, ready: member.ready, role: member.role, ...(role === 'host' ? { uid: member.uid } : {}) })), ...manual.map((participant) => ({ displayName: participant.displayName, team: participant.team, ready: true, role: 'player' as const, participation: 'manual' as const, ...(role === 'host' ? { manualParticipantId: participant.id } : {}) }))]; const projection: Record<string, unknown> = { room: { roomCode: room.roomCode, state: room.game.lifecycle, readyCount: players.filter((member) => member.ready).length + manual.length, memberCount: players.length + manual.length, teams: room.config.teams, members: displayedParticipants, matchSettings: { demo: room.config.demo, gameKind, questionSeconds: room.config.questionSeconds, opponentSeconds: room.config.opponentSeconds, teams: room.config.teams, categories: room.config.categories ?? [], modality: room.config.modality ?? 'classic', difficulty: room.config.difficulty ?? 'mixed', mode: room.config.mode ?? 'classic', showQuestionOnAudience: room.config.showQuestionOnAudience !== false, labelledColours: room.config.labelledColours === true, expectedRelease: { releaseId: room.config.releaseId, releaseRootSha256: room.config.releaseRootSha256 } }, audienceQuestionVisible: room.config.showQuestionOnAudience !== false, canStart, ...(canStart ? {} : { startBlockedReason: 'READY_TEAMS_REQUIRED' }) }, ...(room.config.demo ? { demo: true } : {}), board: room.game.board?.cells.map(({ id, q, r, kind, visibleValue, categoryId, categoryLabelAr, categoryOccurrence, revealedLetter, owner }) => ({ id, q, r, kind, visibleValue, ...(categoryId ? { categoryId } : {}), ...(categoryLabelAr ? { categoryLabelAr } : {}), ...(categoryOccurrence ? { categoryOccurrence } : {}), ...(revealedLetter ? { revealedLetter } : {}), ...(owner ? { owner } : {}) })), activeCellId: room.game.activeCellId, currentRound: room.game.currentRound, questionScores: room.game.questionScores, roundWins: match.roundWins, currentStreak: match.currentStreak, roundResults: match.roundResults.map(({ round, winner: roundWinner }) => ({ round, winner: roundWinner })), entitledTeam: room.game.entitledTeam, answeringTeam: room.game.answeringTeam, winningPath: room.game.winningPath, ...(room.game.contentHold ? { contentHold: { reason: room.game.contentHold.reason, operation: room.game.contentHold.operation, ...(room.game.contentHold.cellId ? { cellId: room.game.contentHold.cellId } : {}) } } : {}), ...(room.game.endedWithoutWinner ? { endedWithoutWinner: true } : {}), ...(match.matchWinner ? { matchWinner: match.matchWinner, matchWinReason: match.matchWinReason } : {}), ...(publicQuestion ? { question: publicQuestion } : {}), ...(!closed && room.timer && room.game.lifecycle !== 'QUESTION_READING' ? { deadlineAt: new Date(room.timer.deadlineMs).toISOString(), buzzOpen: timerIsOpen(room, now) } : {}), ...(!closed && winner && (role === 'host' || role === 'audience') ? { buzzWinner: winner } : {}) };
  if (self && role !== 'audience') projection.self = { uid: self.uid, ready: self.ready, team: self.team, canBuzz: !closed && self.role === 'player' && self.team !== undefined && !room.buzzWinner && timerIsOpen(room, now) && teamCanBuzz(room, self.team), ...(!closed && room.buzzWinner?.uid === self.uid ? { isBuzzWinner: true } : {}) };
  if (role === 'host') { if (!closed && room.activeQuestion && !challengeActive) projection.question = { ...(mediaOccurrence ? { occurrence: mediaOccurrence } : {}), headerAr: room.activeQuestion.headerAr, promptAr: room.activeQuestion.promptAr, ...(questionVisible && visibleMedia ? { media: visibleMedia } : {}), ...(sharedAnswerVisible ? { revealedAnswer: room.activeQuestion.canonicalAnswer } : {}), primaryAnswer: room.activeQuestion.canonicalAnswer, acceptedAnswers: room.activeQuestion.acceptedAnswers, sources: room.activeQuestion.sources ?? [] }; if (!closed && room.game.correction) projection.correction = { ...room.game.correction, priorOwner: room.game.board?.cells.find((cell) => cell.id === room.game.correction?.cellId)?.owner }; }
  if (challengeActive && room.challenge && definition) {
    const state = restoreChallengeState(room.challenge);
    const recipient = participantRecipient(state, uid ?? '', role);
    const expectedTeam = teamForChallengeRecipient(state, recipient);
    if (role !== 'player' || !expectedTeam || self?.team === expectedTeam) projection.challenge = projectChallenge(definition, state, recipient);
  }
  return { roomId, revision: room.revision, serverTime: new Date(now).toISOString(), role, projection };
}
export function expireRoom(room: CanonicalRoom, now: number): CanonicalRoom { if (!room.timer || room.timer.deadlineMs > now || !['FIRST_ANSWER', 'OPPONENT_CHANCE'].includes(room.game.lifecycle)) return room; if (room.game.lifecycle === 'FIRST_ANSWER') return room; return { ...room, revision: room.revision + 1, game: reduceGame(room.game, { type: 'TIME_EXPIRED' }), timer: undefined, buzzWinner: undefined }; }
export function makeBoard(room: CanonicalRoom, letters = [...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي']) { return roomGameKind(room) === 'categories' ? generateCategoryBoard((room.questionCursor + 1) * 0x9e3779b1, room.config.categorySnapshot ?? []) : generateBoard((room.questionCursor + 1) * 0x9e3779b1, letters); }

function assertMutationAuthority(room: CanonicalRoom, member: CanonicalMember, intent: GameIntent) {
  roomGameKind(room);
  if (isRoomClosed(room)) throw new Error('room-closed');
  if (intent.expectedRevision !== room.revision) throw new Error('stale-revision');
  if (!member.active) throw new Error('inactive-member');
  if (room.challenge && !room.challenge.continued && !intent.type.startsWith('CHALLENGE_')) throw new Error('challenge-active-legacy-intent-blocked');
  const hostOnly = intent.type !== 'LOBBY_SET_READY' && intent.type !== 'BUZZ';
  if (hostOnly && member.role !== 'host') throw new Error('host-only');
  // A content hold is intentionally recoverable only by pausing, then using the
  // same explicit end confirmation available to every paused match. Keeping the
  // hold immutable here prevents an exhausted room from resuming play.
  if (room.game.contentHold && !['PAUSE', 'END_WITHOUT_WINNER'].includes(intent.type)) throw new Error('content-hold-active');
}

const contentPreparationIntents = new Set<IntentType>([
  'SELECT_CELL', 'LETTER_REVEALED', 'RETRY_CELL', 'RETURN_CELL', 'START_MATCH', 'START_NEXT_ROUND',
]);

/**
 * Content selection and reservation happen before the reducer so they can be
 * persisted atomically. Validate the expired canonical room first: a rejected
 * actor or transition must never turn content depletion into a stored hold.
 */
export function preflightContentPreparation(room: CanonicalRoom, member: CanonicalMember, intent: GameIntent, members: CanonicalMember[] = [member]) {
  if (!contentPreparationIntents.has(intent.type)) return;
  assertMutationAuthority(room, member, intent);
  const charades = room.config.modality === 'charades';
  if (charades && ['SELECT_CELL', 'LETTER_REVEALED'].includes(intent.type)) throw new Error('charades-no-letter-board');
  if (intent.type === 'START_MATCH') {
    if (room.game.lifecycle !== 'LOBBY') throw new Error('Illegal transition');
    if (!allReady(room, members)) throw new Error('teams-not-ready');
    return;
  }
  if (intent.type === 'START_NEXT_ROUND') {
    if (room.game.lifecycle !== 'ROUND_COMPLETE') throw new Error('Illegal transition');
    return;
  }
  if (intent.type === 'SELECT_CELL') {
    if (room.game.lifecycle !== 'CELL_SELECTION') throw new Error('Illegal transition');
    const cell = room.game.board?.cells.find((item) => item.id === intent.payload.cellId);
    if (!cell || cell.owner) throw new Error('Illegal transition');
    return;
  }
  if (intent.type === 'LETTER_REVEALED') {
    if (room.game.lifecycle !== 'LETTER_REVEAL' || !room.game.activeCellId) throw new Error('Illegal transition');
    return;
  }
  if (!charades && room.game.lifecycle !== 'QUESTION_FAILED') throw new Error('Illegal transition');
}

export function reduceIntent(room: CanonicalRoom, member: CanonicalMember, intent: GameIntent, now: number, question?: CanonicalQuestion, members: CanonicalMember[] = [member], boardLetters?: string[], surpriseLetter?: string, manualParticipantId?: string): { room: CanonicalRoom; member: CanonicalMember; targetMember?: CanonicalMember; eventType: string } {
  assertMutationAuthority(room, member, intent);
  if (intent.type === 'LOBBY_SET_READY') { if (member.role !== 'player' || room.game.lifecycle !== 'LOBBY') throw new Error('ready-not-allowed'); return { room: { ...room, revision: room.revision + 1 }, member: { ...member, ready: intent.payload.ready as boolean }, eventType: intent.type }; }
  if (intent.type === 'SET_AUDIENCE_QUESTION_VISIBILITY') return { room: { ...room, revision: room.revision + 1, config: { ...room.config, showQuestionOnAudience: intent.payload.showQuestion as boolean } }, member, eventType: intent.type };
  if (intent.type === 'REVEAL_ANSWER') {
    const occurrence = intent.payload.occurrence;
    if (typeof occurrence !== 'string' || occurrence !== room.activeQuestionOccurrence || !room.activeQuestion || !['QUESTION_READING', 'FIRST_ANSWER', 'OPPONENT_CHANCE', 'QUESTION_FAILED', 'PAUSED'].includes(room.game.lifecycle)) throw new Error('stale-question-occurrence');
    return { room: { ...room, revision: room.revision + 1, answerRevealedOccurrence: occurrence, timer: undefined, buzzWinner: undefined }, member, eventType: intent.type };
  }
  if (intent.type === 'LOBBY_ADD_MANUAL_PLAYER') { if (room.game.lifecycle !== 'LOBBY') throw new Error('manual-add-not-allowed'); if (activePlayerCount(room, members) >= MAX_PLAYERS) throw new Error('player-capacity-reached'); if (!manualParticipantId || !/^[A-Za-z0-9_-]{1,128}$/.test(manualParticipantId)) throw new Error('manual-participant-id-invalid'); const displayName = validateDisplayName(intent.payload.displayName); const team = intent.payload.team as TeamAxis; if (team !== 'horizontal' && team !== 'vertical') throw new Error('manual-add-not-allowed'); if ((room.manualParticipants ?? []).some((participant) => participant.id === manualParticipantId)) throw new Error('manual-participant-id-conflict'); return { room: { ...room, revision: room.revision + 1, manualParticipants: [...(room.manualParticipants ?? []), { id: manualParticipantId, displayName, team }] }, member, eventType: intent.type }; }
  if (intent.type === 'LOBBY_ASSIGN_TEAM') { if (!canManageTeamsInState(room.game.lifecycle)) throw new Error('lobby-assignment-not-allowed'); const team = intent.payload.team as TeamAxis; if (team !== 'horizontal' && team !== 'vertical') throw new Error('lobby-assignment-not-allowed'); if (typeof intent.payload.manualParticipantId === 'string') { const target = (room.manualParticipants ?? []).find((participant) => participant.id === intent.payload.manualParticipantId); if (!target) throw new Error('lobby-assignment-target-invalid'); const manualParticipants = target.team === team ? room.manualParticipants : (room.manualParticipants ?? []).map((participant) => participant.id === target.id ? { ...participant, team } : participant); return { room: { ...room, revision: room.revision + 1, manualParticipants }, member, eventType: intent.type }; } const target = members.find((value) => value.uid === intent.payload.memberUid); if (!target || !target.active || target.role !== 'player') throw new Error('lobby-assignment-target-invalid'); const targetMember = target.team === team ? target : { ...target, team, ...(room.game.lifecycle === 'LOBBY' ? { ready: false } : {}) }; return { room: { ...room, revision: room.revision + 1 }, member, targetMember, eventType: intent.type }; }
  if (intent.type === 'BUZZ') { if (member.role !== 'player' || !member.team || room.buzzWinner || !timerIsOpen(room, now) || !teamCanBuzz(room, member.team)) throw new Error('buzz-not-allowed'); return { room: { ...room, revision: room.revision + 1, game: reduceGame(room.game, { type: 'BUZZ_ACCEPTED', team: member.team }), timer: { deadlineMs: now + (room.game.lifecycle === 'OPPONENT_CHANCE' ? room.config.opponentSeconds : room.config.questionSeconds) * 1000, buzzOpen: false }, buzzWinner: { uid: member.uid, displayName: member.displayName, team: member.team, method: 'player' } }, member, eventType: intent.type }; }
  if (intent.type === 'HOST_SELECT_TEAM') { const team = intent.payload.team; if ((team !== 'horizontal' && team !== 'vertical') || !teamCanBuzz(room, team)) throw new Error('host-team-selection-not-allowed'); return { room: { ...room, revision: room.revision + 1, game: reduceGame(room.game, { type: 'BUZZ_ACCEPTED', team }), timer: hasRevealedOccurrence(room.activeQuestionOccurrence, room.answerRevealedOccurrence) ? undefined : { deadlineMs: now + (room.game.lifecycle === 'OPPONENT_CHANCE' ? room.config.opponentSeconds : room.config.questionSeconds) * 1000, buzzOpen: false }, buzzWinner: { displayName: room.config.teams[team], team, method: 'host' } }, member, eventType: intent.type }; }
  const charades = room.config.modality === 'charades';
  if (charades && ['SELECT_CELL', 'LETTER_REVEALED', 'BEGIN_CORRECTION'].includes(intent.type)) throw new Error('charades-no-letter-board');
  if (charades && (intent.type === 'START_MATCH' || intent.type === 'START_NEXT_ROUND')) {
    if (!question || question.modality !== 'charades' || question.targetLetter) throw new Error('no-charades-release-question');
    if (intent.type === 'START_MATCH' && !allReady(room, members)) throw new Error('teams-not-ready');
    const currentRound = intent.type === 'START_MATCH' ? Math.max(1, room.game.currentRound) : room.game.currentRound + 1;
    const game = { ...room.game, lifecycle: 'QUESTION_READING' as const, board: undefined, activeCellId: undefined, currentRound, answeringTeam: undefined, attempt: 'initial' as const, winningPath: undefined };
    return { room: { ...room, revision: room.revision + 1, game, activeQuestion: question, activeQuestionOccurrence: `${room.revision + 1}:charades:${question.id}`, answerRevealedOccurrence: undefined, timer: undefined, buzzWinner: undefined, questionCursor: room.questionCursor + 1 }, member, eventType: intent.type };
  }
  if (charades && intent.type === 'AWARD_CELL' && room.game.lifecycle === 'CELL_AWARDED') {
    const winner = room.game.answeringTeam!;
    const version = room.game.roundOutcomeHistory.filter((entry) => entry.round === room.game.currentRound).reduce((latest, entry) => Math.max(latest, entry.version), 0) + 1;
    const game = { ...room.game, lifecycle: 'ROUND_COMPLETE' as const, questionScores: { ...room.game.questionScores, [winner]: room.game.questionScores[winner] + 1 }, roundOutcomeHistory: [...room.game.roundOutcomeHistory, { round: room.game.currentRound, version, winner }], answeringTeam: undefined, activeCellId: undefined };
    return { room: { ...room, revision: room.revision + 1, game, timer: undefined, buzzWinner: undefined }, member, eventType: intent.type };
  }
  if (charades && intent.type === 'RETURN_CELL' && room.game.lifecycle === 'QUESTION_FAILED') {
    return { room: { ...room, revision: room.revision + 1, game: { ...room.game, lifecycle: 'ROUND_COMPLETE', answeringTeam: undefined, activeCellId: undefined }, timer: undefined, buzzWinner: undefined }, member, eventType: intent.type };
  }
  // RETRY_CELL keeps the active cell in play with a replacement already chosen
  // by the callable. RETURN_CELL clears the disclosed question and returns to
  // the board, where its prepared replacement remains private until selected.
  if (!charades && intent.type === 'RETRY_CELL' && room.game.lifecycle === 'QUESTION_FAILED') {
    if (!question) throw new Error('no-release-question');
    const game = reduceGame(room.game, { type: 'RETRY_CELL' });
    return { room: { ...room, revision: room.revision + 1, game, activeQuestion: question, activeQuestionOccurrence: `${room.revision + 1}:${game.activeCellId}:${question.id}`, answerRevealedOccurrence: undefined, timer: undefined, buzzWinner: undefined, questionCursor: room.questionCursor + 1 }, member, eventType: intent.type };
  }
  if (!charades && intent.type === 'RETURN_CELL' && room.game.lifecycle === 'QUESTION_FAILED') {
    return { room: { ...room, revision: room.revision + 1, game: reduceGame(room.game, { type: 'RETURN_CELL' }), activeQuestion: undefined, activeQuestionOccurrence: undefined, answerRevealedOccurrence: undefined, timer: undefined, buzzWinner: undefined }, member, eventType: intent.type };
  }
  if (intent.type === 'END_WITHOUT_WINNER') {
    if (room.game.lifecycle !== 'PAUSED') throw new Error('end-without-winner-not-allowed');
    return { room: { ...room, revision: room.revision + 1, game: { ...room.game, lifecycle: 'MATCH_COMPLETE', answeringTeam: undefined, activeCellId: undefined, endedWithoutWinner: true, contentHold: undefined }, activeQuestion: undefined, activeQuestionOccurrence: undefined, answerRevealedOccurrence: undefined, timer: undefined, buzzWinner: undefined }, member, eventType: intent.type };
  }
  if (intent.type === 'JUDGE_CORRECT') {
    let game = reduceGame(room.game, { type: 'JUDGE_CORRECT' });
    if (charades) {
      const winner = game.answeringTeam!;
      const version = game.roundOutcomeHistory.filter((entry) => entry.round === game.currentRound).reduce((latest, entry) => Math.max(latest, entry.version), 0) + 1;
      game = { ...game, lifecycle: 'ROUND_COMPLETE', questionScores: { ...game.questionScores, [winner]: game.questionScores[winner] + 1 }, roundOutcomeHistory: [...game.roundOutcomeHistory, { round: game.currentRound, version, winner }], answeringTeam: undefined, activeCellId: undefined };
    } else {
      game = reduceGame(game, { type: 'AWARD_CELL' });
      game = reduceGame(game, { type: 'CHECK_PATH' });
    }
    return { room: { ...room, revision: room.revision + 1, game, timer: undefined, buzzWinner: room.buzzWinner }, member, eventType: intent.type };
  }
  if (intent.type === 'AWARD_CELL' && !charades) {
    let game = reduceGame(room.game, { type: 'AWARD_CELL' });
    game = reduceGame(game, { type: 'CHECK_PATH' });
    return { room: { ...room, revision: room.revision + 1, game, timer: undefined, buzzWinner: room.buzzWinner }, member, eventType: intent.type };
  }
  if (intent.type === 'SELECT_CELL') {
    if (!question) throw new Error('no-release-question');
    let game = reduceGame(room.game, { type: 'SELECT_CELL', cellId: intent.payload.cellId as string });
    const selectedCell = game.board?.cells.find((cell) => cell.id === game.activeCellId);
    if (selectedCell?.kind === 'surprise' && !selectedCell.revealedLetter) {
      if (!surpriseLetter || !game.board || !game.activeCellId) throw new Error('no-surprise-letter');
      game = { ...game, board: revealSurprise(game.board, game.activeCellId, surpriseLetter) };
    }
    game = reduceGame(game, { type: 'LETTER_REVEALED' });
    return { room: { ...room, revision: room.revision + 1, game, timer: undefined, activeQuestion: question, activeQuestionOccurrence: `${room.revision + 1}:${game.activeCellId}:${question.id}`, answerRevealedOccurrence: undefined, buzzWinner: undefined, questionCursor: room.questionCursor + 1 }, member, eventType: intent.type };
  }
  let event: GameEvent;
  switch (intent.type) {
    case 'START_MATCH': event = { type: 'START_MATCH', board: makeBoard(room, boardLetters) }; break;
    case 'START_NEXT_ROUND': event = { type: 'START_NEXT_ROUND', board: makeBoard(room, boardLetters) }; break;
    case 'BEGIN_CORRECTION': event = { type: 'BEGIN_CORRECTION', cellId: intent.payload.cellId as string, owner: intent.payload.owner as TeamAxis | undefined, reason: (intent.payload.reason as string).trim() }; break;
    case 'OPEN_QUESTION': event = { type: 'OPEN_QUESTION' } as GameEvent; break;
    default: event = { type: intent.type as Exclude<GameEvent['type'], 'START_MATCH' | 'START_NEXT_ROUND' | 'SELECT_CELL' | 'BEGIN_CORRECTION' | 'BUZZ_ACCEPTED'> } as GameEvent;
  }
  if (intent.type === 'START_MATCH' && !allReady(room, members)) throw new Error('teams-not-ready');
  let game = intent.type === 'OPEN_QUESTION' ? room.game : reduceGame(room.game, event);
  let timer = room.timer;
  let activeQuestion = room.activeQuestion;
  let activeQuestionOccurrence = room.activeQuestionOccurrence;
  let answerRevealedOccurrence = room.answerRevealedOccurrence;
  let buzzWinner = room.buzzWinner;
  const revealingCell = intent.type === 'LETTER_REVEALED' ? room.game.board?.cells.find((cell) => cell.id === room.game.activeCellId) : undefined;
  const questionSelectedAtReveal = intent.type === 'LETTER_REVEALED' && (!room.activeQuestion || (revealingCell?.kind === 'surprise' && !revealingCell.revealedLetter));
  if (intent.type === 'LETTER_REVEALED') {
    if (!question) throw new Error('no-release-question');
    if (revealingCell?.kind === 'surprise' && !revealingCell.revealedLetter) {
      if (!surpriseLetter || !room.game.board || !room.game.activeCellId) throw new Error('no-surprise-letter');
      game = { ...game, board: revealSurprise(room.game.board, room.game.activeCellId, surpriseLetter) };
    }
    activeQuestion = question;
    activeQuestionOccurrence = `${room.revision + 1}:${game.activeCellId}:${question.id}`;
    answerRevealedOccurrence = undefined;
  }
  if ((intent.type === 'LETTER_REVEALED' || intent.type === 'RETRY_CELL') && game.lifecycle === 'QUESTION_READING' && !hasRevealedOccurrence(activeQuestionOccurrence, answerRevealedOccurrence)) { timer = undefined; buzzWinner = undefined; }
  if (intent.type === 'OPEN_QUESTION') {
    if (game.lifecycle !== 'QUESTION_READING') throw new Error('question-not-ready');
    if (!timer?.buzzOpen && !hasRevealedOccurrence(activeQuestionOccurrence, answerRevealedOccurrence)) { timer = undefined; buzzWinner = undefined; }
  }
  if (intent.type === 'JUDGE_INCORRECT' && game.lifecycle === 'OPPONENT_CHANCE' && !hasRevealedOccurrence(activeQuestionOccurrence, answerRevealedOccurrence)) { timer = undefined; buzzWinner = undefined; }
  if (intent.type === 'PAUSE' && room.timer) timer = { deadlineMs: 0, buzzOpen: false, remainingMs: Math.max(0, room.timer.deadlineMs - now), pausedBuzzOpen: room.timer.buzzOpen };
  if (intent.type === 'RESUME' && room.timer?.remainingMs !== undefined && !hasRevealedOccurrence(activeQuestionOccurrence, answerRevealedOccurrence)) timer = { deadlineMs: now + room.timer.remainingMs, buzzOpen: Boolean(room.timer.pausedBuzzOpen) };
  if (['JUDGE_CORRECT', 'RETURN_CELL', 'AWARD_CELL', 'CHECK_PATH', 'START_NEXT_ROUND'].includes(intent.type)) timer = undefined;
  if (intent.type === 'START_MATCH' || intent.type === 'START_NEXT_ROUND') { activeQuestion = undefined; activeQuestionOccurrence = undefined; answerRevealedOccurrence = undefined; }
  return { room: { ...room, revision: room.revision + 1, game, timer, activeQuestion, activeQuestionOccurrence, answerRevealedOccurrence, buzzWinner, questionCursor: room.questionCursor + (questionSelectedAtReveal ? 1 : 0) }, member, eventType: intent.type };
}
