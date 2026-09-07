import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateBoard, revealSurprise, type GameBoard, type TeamAxis } from '../src/features/game/domain/board.js';
import { deriveMatch, initialGameState, reduceGame, type GameEvent, type GameState, type RuleSet } from '../src/features/game/domain/lifecycle.js';
import { createMatchQuestionSelection, selectMatchQuestion, type MatchQuestionSelection, type RuntimeQuestionV32 } from '../src/features/game/runtime/question-selector.js';
import type { ClientRole, GameIntent, ProjectionEnvelope, SafeProjection } from '../src/features/game/runtime/contracts.js';

type Member = { uid: string; role: ClientRole; displayName: string; team?: TeamAxis; ready: boolean };
type StoredQuestion = RuntimeQuestionV32 & { targetLetter: string; sources?: unknown[]; status: string; difficulty?: string; useCount?: number; objectionCount?: number; reviewError?: string; readOnly?: boolean; sourceUrl?: string };
export type MatchConfig = { questionSeconds: number; opponentSeconds: number; teams: Record<TeamAxis, string>; categories: string[]; modality: 'classic' | 'image' | 'charades'; difficulty: string; mode: 'classic' | 'fast' | 'custom' };
type CreateMatchConfig = Partial<MatchConfig> & { bestOf?: 1 | 3 | 5 | 7 };
type Room = { id: string; code: string; revision: number; demo: boolean; roomSchemaVersion: 1 | 2; ruleSet: RuleSet; config: MatchConfig; game: GameState; members: Member[]; intentIds: Record<string, number>; boardNonce: string; boardSequence: number; activeQuestion?: StoredQuestion; surpriseLetters: string[]; questionSelection?: MatchQuestionSelection; deadlineAt?: string; buzzOpen?: boolean; pausedTimer?: { remainingMs: number; buzzOpen: boolean }; buzzWinner?: { uid?: string; displayName: string; team: TeamAxis; method: 'player' | 'host' }; audit: Array<{ revision: number; type: string; at: string; actor: string; payload: unknown }> };
type Capability = { roomId: string; uid: string; role: ClientRole };
export type Clock = () => Date;

const scores = (value?: unknown): Record<TeamAxis, number> => {
  const record = value as Partial<Record<TeamAxis, unknown>> | undefined;
  return { horizontal: typeof record?.horizontal === 'number' ? record.horizontal : 0, vertical: typeof record?.vertical === 'number' ? record.vertical : 0 };
};

/** Produces a browser-safe deterministic board seed from persisted room entropy. */
export function deriveBoardSeed(boardNonce: string, boardSequence: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < boardNonce.length; index++) hash = Math.imul(hash ^ boardNonce.charCodeAt(index), 0x01000193);
  return (hash ^ Math.imul(boardSequence + 1, 0x9e3779b1)) >>> 0;
}

function boardDefaults<T extends { boardNonce?: unknown; boardSequence?: unknown }>(room: T): T & Pick<Room, 'boardNonce' | 'boardSequence'> {
  return {
    ...room,
    boardNonce: typeof room.boardNonce === 'string' && room.boardNonce ? room.boardNonce : randomUUID(),
    boardSequence: Number.isSafeInteger(room.boardSequence) && Number(room.boardSequence) >= 0 ? Number(room.boardSequence) : 0,
  };
}

/** Bounded JSON upcast: untouched lobbies become v2; started legacy rooms retain legacy authority without invented round order. */
function upcastRoom(value: unknown): Room {
  const room = boardDefaults(value as Room & { roomSchemaVersion?: number; ruleSet?: RuleSet; config?: MatchConfig & { bestOf?: 1 | 3 | 5 | 7 }; game?: GameState & { points?: Record<TeamAxis, number>; roundWins?: Record<TeamAxis, number> } });
  if (room.roomSchemaVersion === 2 && room.ruleSet === 'v2') return room;
  const legacyBestOf = room.config?.bestOf && [1, 3, 5, 7].includes(room.config.bestOf) ? room.config.bestOf : 3;
  const config: MatchConfig = { questionSeconds: room.config?.questionSeconds ?? 20, opponentSeconds: room.config?.opponentSeconds ?? 10, teams: room.config?.teams ?? { horizontal: 'فريق ↔', vertical: 'فريق ↕' }, categories: room.config?.categories ?? [], modality: room.config?.modality === 'image' || room.config?.modality === 'charades' ? room.config.modality : 'classic', difficulty: room.config?.difficulty ?? 'mixed', mode: room.config?.mode ?? 'classic' };
  if (!room.game || room.game.lifecycle === 'LOBBY') return { ...room, roomSchemaVersion: 2, ruleSet: 'v2', config, game: initialGameState() };
  const game = room.game;
  return {
    ...room,
    roomSchemaVersion: 1,
    ruleSet: 'legacy-v1',
    config,
    game: {
      ...game,
      ruleSet: 'legacy-v1',
      questionScores: game.questionScores ?? scores(game.points),
      currentRound: game.currentRound ?? 0,
      roundOutcomeHistory: game.roundOutcomeHistory ?? [],
      legacyRoundWins: game.legacyRoundWins ?? scores(game.roundWins),
      legacyBestOf,
    },
  };
}

export class RoomStore {
  private readonly db: DatabaseSync;
  /** The development database lives outside the worktree unless GAME_DB_PATH explicitly opts in. */
  constructor(path = join(tmpdir(), 'huroof-wa-oloof-local-game.sqlite')) {
    this.db = new DatabaseSync(path);
    this.db.exec('CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (room_id TEXT NOT NULL, revision INTEGER NOT NULL, event TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(room_id, revision)); CREATE TABLE IF NOT EXISTS snapshots (room_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(room_id, revision)); CREATE TABLE IF NOT EXISTS local_admin_drafts (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);');
  }
  save(room: Room): void { const data = JSON.stringify(room); this.db.prepare('INSERT INTO rooms(id, code, revision, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data').run(room.id, room.code, room.revision, data); this.db.prepare('INSERT OR REPLACE INTO snapshots(room_id, revision, data) VALUES (?, ?, ?)').run(room.id, room.revision, data); }
  event(room: Room, value: unknown, at: string): void { this.db.prepare('INSERT OR REPLACE INTO events(room_id, revision, event, created_at) VALUES (?, ?, ?, ?)').run(room.id, room.revision, JSON.stringify(value), at); }
  private hydrate(data: string): Room {
    const room = upcastRoom(JSON.parse(data)); const upgraded = JSON.stringify(room);
    // Persist the bounded schema marker without inventing an event, revision, or legacy round order.
    if (upgraded !== data) this.db.prepare('UPDATE rooms SET data=? WHERE id=?').run(upgraded, room.id);
    return room;
  }
  load(idOrCode: string): Room | undefined { const row = this.db.prepare('SELECT data FROM rooms WHERE id=? OR code=?').get(idOrCode, idOrCode) as { data: string } | undefined; return row ? this.hydrate(row.data) : undefined; }
  rooms(): Room[] { return (this.db.prepare('SELECT data FROM rooms').all() as Array<{ data: string }>).map((row) => this.hydrate(row.data)); }
  saveAdminDraft(id: string, draft: unknown, at: string): void { this.db.prepare('INSERT INTO local_admin_drafts(id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').run(id, JSON.stringify(draft), at); }
  adminDrafts(): StoredQuestion[] { return (this.db.prepare('SELECT data FROM local_admin_drafts ORDER BY updated_at DESC').all() as Array<{ data: string }>).map((row) => JSON.parse(row.data) as StoredQuestion); }
  close(): void { this.db.close(); }
}

export class AuthoritativeGameService {
  readonly store: RoomStore; private readonly secret: string; private readonly clock: Clock; private readonly newBoardNonce: () => string;
  constructor(options: { dbPath?: string; secret?: string; clock?: Clock; boardNonce?: () => string } = {}) { this.store = new RoomStore(options.dbPath); this.secret = options.secret ?? 'local-development-secret'; this.clock = options.clock ?? (() => new Date()); this.newBoardNonce = options.boardNonce ?? randomUUID; }
  close(): void { this.store.close(); }
  private now(): string { return this.clock().toISOString(); }
  private token(capability: Capability): string { const encoded = Buffer.from(JSON.stringify(capability)).toString('base64url'); return `${encoded}.${createHmac('sha256', this.secret).update(encoded).digest('base64url')}`; }
  verify(token: string): Capability | undefined { const [encoded, signature] = token.split('.'); if (!encoded || !signature) return undefined; const expected = createHmac('sha256', this.secret).update(encoded).digest('base64url'); if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return undefined; try { return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Capability; } catch { return undefined; } }
  createAudienceCapability(roomId: string): string { this.mustRoom(roomId); return this.token({ roomId, uid: 'audience', role: 'audience' }); }
  create(displayName = 'المضيف', demo = false, requested: CreateMatchConfig = {}): { roomId: string; roomCode: string; revision: number; token: string; audienceToken: string } {
    if (!demo && !this.questionsSync(false).length) throw new Error('NO_APPROVED_QUESTION_STOCK');
    const id = randomUUID(); const code = id.replaceAll('-', '').slice(0, 6).toUpperCase(); const host = { uid: randomUUID(), role: 'host' as const, displayName, ready: true };
    // bestOf is accepted only for stale clients and deliberately has no v2 effect.
    const requestedCategories = [...new Set((requested.categories ?? []).filter((category): category is string => typeof category === 'string' && category.trim().length > 0).map((category) => category.trim()))].sort(); const categories = requestedCategories.length ? requestedCategories : demo ? [...new Set(this.questionsSync(true).map((question) => question.categoryId).filter((category): category is string => typeof category === 'string'))].sort() : []; if (!categories.length) throw new Error('QUESTION_CATEGORY_SCOPE_REQUIRED'); const modality = requested.modality === 'image' || requested.modality === 'charades' ? requested.modality : 'classic'; this.requirePlayableQuestionScope(demo, categories, modality); const config: MatchConfig = { questionSeconds: Math.max(10, Math.min(60, requested.questionSeconds ?? 20)), opponentSeconds: Math.max(10, Math.min(60, requested.opponentSeconds ?? 10)), teams: { horizontal: requested.teams?.horizontal?.trim() || 'فريق ↔', vertical: requested.teams?.vertical?.trim() || 'فريق ↕' }, categories, modality, difficulty: requested.difficulty ?? 'mixed', mode: requested.mode ?? 'classic' };
    const room: Room = { id, code, revision: 1, demo, roomSchemaVersion: 2, ruleSet: 'v2', config, game: initialGameState(), members: [host], intentIds: {}, boardNonce: this.newBoardNonce(), boardSequence: 0, surpriseLetters: [], audit: [{ revision: 1, type: 'ROOM_CREATED', at: this.now(), actor: host.uid, payload: { demo, config, ruleSet: 'v2' } }] };
    this.store.save(room); this.store.event(room, room.audit[0], this.now()); return { roomId: id, roomCode: code, revision: 1, token: this.token({ roomId: id, uid: host.uid, role: 'host' }), audienceToken: this.token({ roomId: id, uid: 'audience', role: 'audience' }) };
  }
  join(code: string, displayName = 'لاعب'): { roomId: string; revision: number; token: string } {
    const room = this.store.load(code); if (!room) throw new Error('ROOM_NOT_FOUND'); const team: TeamAxis = room.members.filter((member) => member.role === 'player').length % 2 ? 'vertical' : 'horizontal'; const member: Member = { uid: randomUUID(), role: 'player', displayName, team, ready: false }; room.members.push(member); this.commit(room, 'PLAYER_JOINED', member.uid, { team }); return { roomId: room.id, revision: room.revision, token: this.token({ roomId: room.id, uid: member.uid, role: 'player' }) };
  }
  metadata(roomId: string, token: string): ProjectionEnvelope { const capability = this.mustCapability(roomId, token); const room = this.mustRoom(roomId); return this.project(room, capability); }
  private mustRoom(id: string): Room { const room = this.store.load(id); if (!room) throw new Error('ROOM_NOT_FOUND'); return room; }
  private mustCapability(roomId: string, token: string): Capability { const capability = this.verify(token); if (!capability || capability.roomId !== roomId) throw new Error('UNAUTHORIZED'); return capability; }
  private async freshBoard(room: Room): Promise<GameBoard> {
    const questions = await this.questions(room.demo);
    const selection = room.questionSelection ?? createMatchQuestionSelection(questions, { categories: room.config.categories, modality: room.config.modality, seed: deriveBoardSeed(room.boardNonce, 0), reservePerLetter: room.demo ? 1 : 3 });
    room.questionSelection = selection;
    const letters = Object.keys(selection.queues);
    let sequence = room.boardSequence;
    let seed = deriveBoardSeed(room.boardNonce, sequence);
    // Legacy rooms can have an existing revision-derived board. Do not repeat it
    // when their first new round is created after the safe upcast.
    while (seed === room.game.board?.seed) { sequence++; seed = deriveBoardSeed(room.boardNonce, sequence); }
    const shuffled = letters.map((letter, index) => ({ letter, order: ((seed * 1103515245 + index * 12345) >>> 0) })).sort((a, b) => a.order - b.order).map(({ letter }) => letter);
    room.surpriseLetters = shuffled.slice(16, 25);
    room.boardSequence = sequence + 1;
    return generateBoard(seed, shuffled.slice(0, 16));
  }
  async startBoard(room: Room, nextRound = false): Promise<void> {
    const board = await this.freshBoard(room);
    room.game = reduceGame(room.game, nextRound ? { type: 'START_NEXT_ROUND', board } : { type: 'START_MATCH', board });
  }
  /** Authoritative deadline processing, invoked by the HTTP service loop and before every intent. */
  async tick(): Promise<string[]> { const changed: string[] = []; for (const room of this.store.rooms()) if (this.expire(room)) changed.push(room.id); return changed; }
  private expire(room: Room): boolean {
    if (!room.buzzOpen || !room.deadlineAt || this.clock().getTime() < Date.parse(room.deadlineAt)) return false;
    if (room.game.lifecycle !== 'QUESTION_READING' && room.game.lifecycle !== 'OPPONENT_CHANCE') { room.buzzOpen = false; room.deadlineAt = undefined; return false; }
    room.game = reduceGame(room.game, { type: 'TIME_EXPIRED' }); room.buzzOpen = false; room.deadlineAt = undefined;
    this.commit(room, 'SERVER_TIME_EXPIRED', 'server', {}, undefined); return true;
  }
  async intent(roomId: string, token: string, intent: GameIntent): Promise<{ revision: number; replayed: boolean; projection: ProjectionEnvelope; stale?: boolean }> {
    const capability = this.mustCapability(roomId, token); const room = this.mustRoom(roomId); this.expire(room); const seen = room.intentIds[intent.intentId];
    if (seen !== undefined) return { revision: seen, replayed: true, projection: this.project(room, capability) };
    if (intent.expectedRevision !== room.revision) return { revision: room.revision, replayed: false, stale: true, projection: this.project(room, capability) };
    if (intent.type === 'LOBBY_SET_READY') { this.require(capability, 'player'); const member = room.members.find((value) => value.uid === capability.uid)!; member.ready = Boolean(intent.payload.ready); this.commit(room, intent.type, capability.uid, intent.payload, intent.intentId); return { revision: room.revision, replayed: false, projection: this.project(room, capability) }; }
    if (intent.type === 'BUZZ') { this.require(capability, 'player'); const member = room.members.find((value) => value.uid === capability.uid)!; if (!member?.team || room.buzzWinner || !room.buzzOpen || !room.deadlineAt || (room.game.lifecycle !== 'QUESTION_READING' && room.game.lifecycle !== 'OPPONENT_CHANCE') || (room.game.lifecycle === 'OPPONENT_CHANCE' && member.team !== room.game.entitledTeam)) throw new Error('BUZZ_NOT_OPEN'); room.game = reduceGame(room.game, { type: 'BUZZ_ACCEPTED', team: member.team }); room.buzzOpen = false; room.deadlineAt = undefined; room.buzzWinner = { uid: member.uid, displayName: member.displayName, team: member.team, method: 'player' }; this.commit(room, intent.type, capability.uid, { team: member.team }, intent.intentId); return { revision: room.revision, replayed: false, projection: this.project(room, capability) }; }
    this.require(capability, 'host');
    if (intent.type === 'START_MATCH') { const reason = this.startBlockedReason(room); if (reason) throw new Error(reason); await this.startBoard(room); }
    else await this.applyHostIntent(room, intent);
    this.commit(room, intent.type, capability.uid, intent.payload, intent.intentId); return { revision: room.revision, replayed: false, projection: this.project(room, capability) };
  }
  private async applyHostIntent(room: Room, intent: GameIntent): Promise<void> {
    const payload = intent.payload;
    // Opening the timed buzzer is an authoritative side effect within QUESTION_READING,
    // not a second lifecycle state transition.
    if (intent.type === 'OPEN_QUESTION') { if (room.game.lifecycle !== 'QUESTION_READING') throw new Error('QUESTION_NOT_READY'); room.buzzWinner = undefined; room.buzzOpen = true; room.deadlineAt = new Date(this.clock().getTime() + room.config.questionSeconds * 1000).toISOString(); return; }
    if (intent.type === 'HOST_SELECT_TEAM') { const team = payload.team; if (Object.keys(payload).length !== 1 || (team !== 'horizontal' && team !== 'vertical') || (room.game.lifecycle !== 'QUESTION_READING' && room.game.lifecycle !== 'OPPONENT_CHANCE') || (room.game.lifecycle === 'OPPONENT_CHANCE' && room.game.entitledTeam !== team)) throw new Error('HOST_TEAM_SELECTION_NOT_ALLOWED'); room.game = reduceGame(room.game, { type: 'BUZZ_ACCEPTED', team }); room.buzzOpen = false; room.deadlineAt = undefined; room.buzzWinner = { displayName: room.config.teams[team], team, method: 'host' }; return; }
    if (intent.type === 'PAUSE') {
      const canPreserveTimer = room.buzzOpen && room.deadlineAt && (room.game.lifecycle === 'QUESTION_READING' || room.game.lifecycle === 'OPPONENT_CHANCE');
      room.pausedTimer = canPreserveTimer ? { remainingMs: Math.max(0, Date.parse(room.deadlineAt!) - this.clock().getTime()), buzzOpen: true } : undefined;
      room.game = reduceGame(room.game, { type: 'PAUSE' }); room.buzzOpen = false; room.deadlineAt = undefined;
      return;
    }
    if (intent.type === 'RESUME') {
      room.game = reduceGame(room.game, { type: 'RESUME' });
      const pausedTimer = room.pausedTimer; room.pausedTimer = undefined;
      if (pausedTimer && (room.game.lifecycle === 'QUESTION_READING' || room.game.lifecycle === 'OPPONENT_CHANCE')) {
        room.buzzOpen = pausedTimer.buzzOpen; room.deadlineAt = pausedTimer.buzzOpen ? new Date(this.clock().getTime() + pausedTimer.remainingMs).toISOString() : undefined;
      }
      return;
    }
    if (intent.type === 'START_NEXT_ROUND') { await this.startBoard(room, true); return; }
    if (intent.type === 'LETTER_REVEALED') {
      const cell = room.game.board?.cells.find((value) => value.id === room.game.activeCellId);
      const questionMustBeSelectedNow = !room.activeQuestion || (cell?.kind === 'surprise' && !cell.revealedLetter);
      if (cell?.kind === 'surprise' && !cell.revealedLetter) {
        const letter = room.surpriseLetters.shift();
        if (!letter) throw new Error('NO_UNUSED_SURPRISE_LETTER');
        room.game = { ...room.game, board: revealSurprise(room.game.board!, cell.id, letter) };
      }
      room.game = reduceGame(room.game, { type: 'LETTER_REVEALED' });
      if (questionMustBeSelectedNow) await this.assignQuestion(room);
      return;
    }
    const events: Record<Exclude<GameIntent['type'], 'LOBBY_SET_READY' | 'START_MATCH' | 'START_NEXT_ROUND' | 'BUZZ' | 'HOST_SELECT_TEAM' | 'OPEN_QUESTION' | 'LETTER_REVEALED' | 'PAUSE' | 'RESUME'>, () => GameEvent> = {
      ROUND_READY: () => ({ type: 'ROUND_READY' }), SELECT_CELL: () => ({ type: 'SELECT_CELL', cellId: String(payload.cellId) }), JUDGE_CORRECT: () => ({ type: 'JUDGE_CORRECT' }), JUDGE_INCORRECT: () => ({ type: 'JUDGE_INCORRECT' }), RETRY_CELL: () => ({ type: 'RETRY_CELL' }), RETURN_CELL: () => ({ type: 'RETURN_CELL' }), AWARD_CELL: () => ({ type: 'AWARD_CELL' }), CHECK_PATH: () => ({ type: 'CHECK_PATH' }), BEGIN_CORRECTION: () => { const reason = String(payload.reason ?? '').trim(); if (!reason) throw new Error('CORRECTION_REASON_REQUIRED'); return { type: 'BEGIN_CORRECTION', cellId: String(payload.cellId), owner: payload.owner === 'horizontal' || payload.owner === 'vertical' ? payload.owner : undefined, reason }; }, CONFIRM_CORRECTION: () => ({ type: 'CONFIRM_CORRECTION' }), CANCEL_CORRECTION: () => ({ type: 'CANCEL_CORRECTION' }),
    };
    const event = events[intent.type as keyof typeof events]?.(); if (!event) throw new Error('UNKNOWN_INTENT');
    room.game = reduceGame(room.game, event);
    if (['JUDGE_CORRECT', 'JUDGE_INCORRECT'].includes(intent.type)) { room.buzzOpen = false; room.deadlineAt = undefined; }
    if (intent.type === 'JUDGE_INCORRECT' && room.game.lifecycle === 'OPPONENT_CHANCE') { room.buzzOpen = true; room.deadlineAt = new Date(this.clock().getTime() + room.config.opponentSeconds * 1000).toISOString(); room.buzzWinner = undefined; }
    if (intent.type === 'RETRY_CELL') room.buzzWinner = undefined;
    if (intent.type === 'SELECT_CELL') {
      // A new cell starts a new question boundary. Surprise cells do not have a
      // letter until LETTER_REVEALED, so they must not inherit the prior prompt.
      room.activeQuestion = undefined;
      const cell = room.game.board?.cells.find((value) => value.id === room.game.activeCellId);
      if (cell?.kind === 'letter') await this.assignQuestion(room);
    }
  }
  private async assignQuestion(room: Room): Promise<void> { const questions = await this.questions(room.demo); const cell = room.game.board?.cells.find((value) => value.id === room.game.activeCellId); if (!room.questionSelection) throw new Error('QUESTION_SELECTION_NOT_INITIALIZED'); const selected = selectMatchQuestion(questions, room.questionSelection, cell?.revealedLetter ?? cell?.visibleValue ?? ''); room.activeQuestion = selected.question as StoredQuestion; room.questionSelection = selected.selection; }
  private async questions(demo: boolean): Promise<StoredQuestion[]> {
    const file = demo ? join(process.cwd(), 'content', 'questions', 'drafts', 'questions.jsonl') : join(process.cwd(), 'content', 'questions', 'approved', 'questions.jsonl');
    const text = await readFile(file, 'utf8'); return text.split(/\r?\n/).filter(Boolean).map((line) => { const question = JSON.parse(line) as Partial<StoredQuestion>; return { ...question, modality: question.modality ?? 'classic', answerConceptId: question.answerConceptId ?? `legacy:${question.id}` } as StoredQuestion; }).filter((question) => demo || question.status === 'approved');
  }
  private questionsSync(demo: boolean): StoredQuestion[] {
    const file = demo ? join(process.cwd(), 'content', 'questions', 'drafts', 'questions.jsonl') : join(process.cwd(), 'content', 'questions', 'approved', 'questions.jsonl');
    try { return readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => { const question = JSON.parse(line) as Partial<StoredQuestion>; return { ...question, modality: question.modality ?? 'classic', answerConceptId: question.answerConceptId ?? `legacy:${question.id}` } as StoredQuestion; }).filter((question) => demo || question.status === 'approved'); } catch { return []; }
  }
  /** Reject an unusable category scope before it can create a lobby that will fail on start. */
  private requirePlayableQuestionScope(demo: boolean, categories: string[], modality: MatchConfig['modality']): void {
    if (modality === 'charades') return;
    try {
      createMatchQuestionSelection(this.questionsSync(demo), { categories, modality, seed: 0, reservePerLetter: demo ? 1 : 3 });
    } catch (reason) {
      if (reason instanceof Error && /^Insufficient (?:16 visible \+ 9 surprise letter coverage|concept reserve)/.test(reason.message)) throw new Error('QUESTION_SCOPE_INSUFFICIENT_COVERAGE');
      throw reason;
    }
  }
  private startBlockedReason(room: Room): string | undefined {
    if (!room.demo && !this.questionsSync(false).length) return 'NO_APPROVED_QUESTION_STOCK';
    const players = room.members.filter((member) => member.role === 'player');
    if (!players.length) return undefined;
    if (players.length < 2 || !players.some((member) => member.team === 'horizontal') || !players.some((member) => member.team === 'vertical')) return 'LOBBY_NEEDS_TWO_TEAMS';
    if (players.some((member) => !member.ready)) return 'LOBBY_ALL_MEMBERS_MUST_BE_READY';
    return undefined;
  }
  /** Local-admin boundary: answer-bearing drafts are read by the server, never bundled into Vite. */
  async adminQuestions(): Promise<StoredQuestion[]> { return [...this.store.adminDrafts(), ...await this.questions(true)]; }
  async adminQuestion(id: string): Promise<StoredQuestion | undefined> { return (await this.adminQuestions()).find((question) => question.id === id); }
  saveAdminDraft(input: Record<string, unknown>): { id: string; status: 'draft' } {
    const id = typeof input.id === 'string' && input.id ? input.id : `local-${randomUUID()}`;
    const draft = { ...input, id, status: 'draft', updatedAt: this.now() };
    this.store.saveAdminDraft(id, draft, this.now());
    return { id, status: 'draft' };
  }
  private require(capability: Capability, role: ClientRole): void { if (capability.role !== role) throw new Error('FORBIDDEN_ROLE'); }
  private commit(room: Room, type: string, actor: string, payload: unknown, intentId?: string): void { room.revision++; if (intentId) room.intentIds[intentId] = room.revision; const audit = { revision: room.revision, type, at: this.now(), actor, payload }; room.audit.push(audit); this.store.save(room); this.store.event(room, audit, audit.at); }
  project(room: Room, capability: Capability): ProjectionEnvelope {
    const member = room.members.find((value) => value.uid === capability.uid); const isHost = capability.role === 'host'; const questionVisible = room.game.lifecycle === 'QUESTION_READING' || room.game.lifecycle === 'FIRST_ANSWER' || room.game.lifecycle === 'OPPONENT_CHANCE' || room.game.lifecycle === 'QUESTION_FAILED';
    const startBlockedReason = room.game.lifecycle === 'LOBBY' ? this.startBlockedReason(room) : undefined;
    const match = deriveMatch(room.game);
    const matchRule = room.ruleSet === 'v2'
      ? { ruleSet: 'v2' as const, victoryAr: 'تنتهي المباراة بفوز فريق بجولتين متتاليتين أو بثلاث جولات إجمالاً' }
      : { ruleSet: 'legacy-v1' as const, victoryAr: 'غرفة قديمة محفوظة بقواعدها السابقة' };
    const projection: SafeProjection & Record<string, unknown> = { room: { roomCode: room.code, state: room.game.lifecycle, readyCount: room.members.filter((value) => value.role === 'player' && value.ready).length, memberCount: room.members.filter((value) => value.role === 'player').length, teams: room.config.teams, members: room.members.map(({ displayName, team, ready, role }) => ({ displayName, team, ready, role })), matchSettings: { demo: room.demo, questionSeconds: room.config.questionSeconds, opponentSeconds: room.config.opponentSeconds, teams: room.config.teams, categories: room.config.categories, modality: room.config.modality, difficulty: room.config.difficulty, mode: room.config.mode }, canStart: !startBlockedReason, ...(startBlockedReason ? { startBlockedReason } : {}) }, ...(room.demo ? { demo: true as const } : {}), matchRule, board: room.game.board?.cells.map((cell) => ({ id: cell.id, q: cell.q, r: cell.r, kind: cell.kind, visibleValue: cell.visibleValue, ...(cell.revealedLetter ? { revealedLetter: cell.revealedLetter } : {}), ...(cell.owner ? { owner: cell.owner } : {}) })), activeCellId: room.game.activeCellId, currentRound: room.game.currentRound, questionScores: room.game.questionScores, roundWins: match.roundWins, currentStreak: match.currentStreak, roundResults: match.roundResults.map(({ round, winner }) => ({ round, winner })), ...(match.matchWinner ? { matchWinner: match.matchWinner, matchWinReason: match.matchWinReason } : {}), entitledTeam: room.game.entitledTeam, answeringTeam: room.game.answeringTeam, winningPath: room.game.winningPath, ...(room.deadlineAt ? { deadlineAt: room.deadlineAt, buzzOpen: room.buzzOpen } : {}), ...(room.buzzWinner && (capability.role === 'host' || capability.role === 'audience') ? { buzzWinner: { displayName: room.buzzWinner.displayName, team: room.buzzWinner.team, method: room.buzzWinner.method } } : {}), ...(capability.role === 'audience' ? {} : { self: { uid: capability.uid, ready: member?.ready ?? false, team: member?.team, canBuzz: capability.role === 'player' && !room.buzzWinner && Boolean(room.buzzOpen) && (room.game.lifecycle === 'QUESTION_READING' || (room.game.lifecycle === 'OPPONENT_CHANCE' && member?.team === room.game.entitledTeam)), ...(room.buzzWinner?.method === 'player' && room.buzzWinner.uid === capability.uid ? { isBuzzWinner: true } : {}) } }) };
    if (questionVisible && room.activeQuestion) projection.question = { headerAr: room.activeQuestion.headerAr, promptAr: room.activeQuestion.promptAr };
    if (room.game.lifecycle === 'QUESTION_FAILED' && room.activeQuestion) projection.question = { ...projection.question as object, revealedAnswer: room.activeQuestion.canonicalAnswer };
    if (isHost) { if (room.activeQuestion) projection.question = { headerAr: room.activeQuestion.headerAr, promptAr: room.activeQuestion.promptAr, primaryAnswer: room.activeQuestion.canonicalAnswer, acceptedAnswers: room.activeQuestion.acceptedAnswers, sources: room.activeQuestion.sources ?? [], moderation: { status: room.activeQuestion.status } }; if (room.game.correction) projection.correction = { ...room.game.correction, priorOwner: room.game.board?.cells.find((cell) => cell.id === room.game.correction?.cellId)?.owner }; projection.audit = room.audit.slice(-20); }
    return { roomId: room.id, revision: room.revision, serverTime: this.now(), role: capability.role, projection };
  }
}
