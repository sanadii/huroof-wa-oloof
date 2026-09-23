import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import { canonicalChallengeJson } from '../../src/features/game/challenges/integration.js';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const next = (socket: WebSocket, label = 'projection') => new Promise<Record<string, unknown>>((resolve, reject) => { const timer = setTimeout(() => { socket.off('message', onMessage); reject(new Error(`websocket timeout: ${label}`)); }, 2_000); const onMessage = (message: WebSocket.RawData) => { const value = JSON.parse(String(message)) as Record<string, unknown>; if (value.type === 'presence') return; clearTimeout(timer); socket.off('message', onMessage); resolve(value); }; socket.on('message', onMessage); });
const waitFor = async (socket: WebSocket, predicate: (value: Record<string, unknown>) => boolean, label: string) => new Promise<Record<string, unknown>>((resolve, reject) => { const timer = setTimeout(() => { socket.off('message', onMessage); reject(new Error(`websocket timeout: ${label}`)); }, 2_500); const onMessage = (message: WebSocket.RawData) => { const value = JSON.parse(String(message)) as Record<string, unknown>; if (predicate(value)) { clearTimeout(timer); socket.off('message', onMessage); resolve(value); } }; socket.on('message', onMessage); });
test('two websocket clients receive safe projections; first buzz wins and reconnect gets snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'huroof-ws-')); const port = 8900 + Math.floor(Math.random() * 500); const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), GAME_DB_PATH: join(dir, 'state.sqlite') }, stdio: 'ignore' });
  try {
    for (let retry = 0; retry < 25; retry++) { try { if ((await fetch(`http://localhost:${port}/health`)).ok) break; } catch { /* service is still booting */ } await wait(40); }
    const create = await fetch(`http://localhost:${port}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ demo: true }) }); const host = await create.json() as { roomId: string; roomCode: string; revision: number; token: string };
    const connect = (token: string) => new WebSocket(`ws://localhost:${port}/ws?roomId=${host.roomId}&token=${token}`);
    const hostSocket = connect(host.token); const hostInitial = await next(hostSocket, 'host initial'); assert.equal((hostInitial.projection as { room: { memberCount: number } }).room.memberCount, 0);
    const join = async (name: string) => (await (await fetch(`http://localhost:${port}/api/rooms/${host.roomCode}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: name }) })).json()) as { token: string; revision: number };
    const afterFirstJoin = next(hostSocket, 'host after first join'); const one = await join('one'); const hostAfterOne = await afterFirstJoin; assert.equal((hostAfterOne.projection as { room: { memberCount: number } }).room.memberCount, 1);
    const afterSecondJoin = next(hostSocket, 'host after second join'); const two = await join('two'); const hostAfterTwo = await afterSecondJoin; assert.equal((hostAfterTwo.projection as { room: { memberCount: number } }).room.memberCount, 2); let revision = two.revision;
    const ready = async (token: string) => { const response = await fetch(`http://localhost:${port}/api/rooms/${host.roomId}/intents`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ type: 'LOBBY_SET_READY', intentId: `ready-${revision}`, expectedRevision: revision, payload: { ready: true } }) }); const value = await response.json() as { revision: number }; revision = value.revision; };
    await ready(one.token); await ready(two.token);
    const hostIntent = async (type: string, payload: Record<string, unknown> = {}) => { const response = await fetch(`http://localhost:${port}/api/rooms/${host.roomId}/intents`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${host.token}` }, body: JSON.stringify({ type, intentId: `${type}-${revision}`, expectedRevision: revision, payload }) }); const value = await response.json() as { revision: number }; revision = value.revision; };
    await hostIntent('START_MATCH'); await hostIntent('ROUND_READY'); await hostIntent('SELECT_CELL', { cellId: 'cell-0-0' });
    const wsOne = connect(one.token); const wsTwo = connect(two.token); const [oneInitial, twoInitial] = await Promise.all([next(wsOne), next(wsTwo)]); assert.equal(JSON.stringify(oneInitial).includes('primaryAnswer'), false); assert.equal(JSON.stringify(twoInitial).includes('acceptedAnswers'), false);
    wsOne.send(JSON.stringify({ type: 'BUZZ', intentId: 'race-one', expectedRevision: revision, payload: {} })); wsTwo.send(JSON.stringify({ type: 'BUZZ', intentId: 'race-two', expectedRevision: revision, payload: {} })); const winnerProjection = await next(wsOne); assert.equal((winnerProjection.projection as { room: { state: string } }).room.state, 'FIRST_ANSWER'); wsOne.close(); const reconnect = connect(one.token); const recovered = await next(reconnect); assert.equal(recovered.revision, winnerProjection.revision); reconnect.close(); wsTwo.close(); hostSocket.close();
  } finally { child.kill(); await new Promise<void>((resolve) => child.once('exit', () => resolve())); await rm(dir, { recursive: true, force: true }); }
});

test('local socket presence aggregates same-player tabs without game writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'huroof-presence-')); const port = 8900 + Math.floor(Math.random() * 500); const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), GAME_DB_PATH: join(dir, 'state.sqlite') }, stdio: 'ignore' });
  try {
    for (let retry = 0; retry < 25; retry++) { try { if ((await fetch(`http://localhost:${port}/health`)).ok) break; } catch { /* booting */ } await wait(40); }
    const created = await fetch(`http://localhost:${port}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ demo: true }) }); const host = await created.json() as { roomId: string; roomCode: string; token: string };
    const hostSocket = new WebSocket(`ws://localhost:${port}/ws?roomId=${host.roomId}&token=${host.token}`); await next(hostSocket);
    const joined = await fetch(`http://localhost:${port}/api/rooms/${host.roomCode}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'متصل' }) }); const player = await joined.json() as { token: string };
    const playerSocket = new WebSocket(`ws://localhost:${port}/ws?roomId=${host.roomId}&token=${player.token}`); const connected = await waitFor(hostSocket, (value) => value.type === 'presence' && Object.values(value.players as Record<string, { state: string }>).some((presence) => presence.state === 'connected'), 'connected presence'); assert.equal(connected.type, 'presence');
    const secondTab = new WebSocket(`ws://localhost:${port}/ws?roomId=${host.roomId}&token=${player.token}`); await waitFor(hostSocket, (value) => value.type === 'presence' && Object.values(value.players as Record<string, { state: string }>).some((presence) => presence.state === 'connected'), 'same uid connected'); playerSocket.close(); await waitFor(hostSocket, (value) => value.type === 'presence' && Object.values(value.players as Record<string, { state: string }>).some((presence) => presence.state === 'connected'), 'one tab remains connected'); secondTab.close(); await waitFor(hostSocket, (value) => value.type === 'presence' && Object.values(value.players as Record<string, { state: string }>).some((presence) => presence.state === 'disconnected'), 'last tab disconnected'); hostSocket.close();
  } finally { child.kill(); await new Promise<void>((resolve) => child.once('exit', () => resolve())); await rm(dir, { recursive: true, force: true }); }
});

test('a signed local audience socket receives live projections without entering player presence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'huroof-audience-')); const port = 8900 + Math.floor(Math.random() * 500); const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), GAME_DB_PATH: join(dir, 'state.sqlite') }, stdio: 'ignore' });
  try {
    for (let retry = 0; retry < 25; retry++) { try { if ((await fetch(`http://localhost:${port}/health`)).ok) break; } catch { /* booting */ } await wait(40); }
    const created = await fetch(`http://localhost:${port}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ demo: true }) }); const host = await created.json() as { roomId: string; audienceToken: string; revision: number; token: string };
    const audience = new WebSocket(`ws://localhost:${port}/ws?roomId=${host.roomId}&token=${host.audienceToken}`);
    const initial = await next(audience, 'audience initial');
    assert.equal(initial.role, 'audience');
    assert.equal(JSON.stringify(initial).includes('"uid"'), false);
    const update = next(audience, 'audience live update');
    const response = await fetch(`http://localhost:${port}/api/rooms/${host.roomId}/intents`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${host.token}` }, body: JSON.stringify({ type: 'START_MATCH', intentId: 'audience-start', expectedRevision: host.revision, payload: {} }) });
    assert.equal(response.ok, true);
    assert.equal((await update).revision, host.revision + 1);
    audience.close();
  } finally { child.kill(); await new Promise<void>((resolve) => child.once('exit', () => resolve())); await rm(dir, { recursive: true, force: true }); }
});

test('local challenge rooms require capability on resume and WebSocket before the resumed GET snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'huroof-challenge-ws-'));
  const port = 8900 + Math.floor(Math.random() * 500);
  const digest = 'a'.repeat(64), manifest = 'b'.repeat(64), id = 'local-ws-tile';
  const correct = { id: 'correct', labelAr: 'أحمر', shape: 'circle', hex: '#ef4444' }, two = { id: 'two', labelAr: 'أزرق', shape: 'square', hex: '#3b82f6' }, three = { id: 'three', labelAr: 'أخضر', shape: 'triangle', hex: '#22c55e' }, four = { id: 'four', labelAr: 'أصفر', shape: 'diamond', hex: '#eab308' };
  const payload = { schemaVersion: 't36-challenge-definition-v1' as const, id, kind: 'missing_tile' as const, categoryId: 'tahadani-006', ordinal: 1, disposition: 'ready' as const, source: { sourceId: 'local-ws', sourcePack: 'test', sourcePath: 'private', sourceRawSha256: digest, sourceContextsSha256: digest, mediaArchiveSha256: digest }, media: [{ role: 'answer' as const, visibility: 'host_only' as const, originalObjectName: 'answer', originalSha256: digest, derivativeObjectName: 'answer', derivativeSha256: digest }, { role: 'question' as const, visibility: 'player' as const, originalObjectName: 'question', originalSha256: digest, derivativeObjectName: 'question', derivativeSha256: digest }], publicData: { rows: 3 as const, columns: 3 as const, rule: 'vertical_mirror' as const, cells: [[null, two, correct], [three, four, three], [correct, two, correct]], missingCell: [0, 0] as const, options: [correct, two, three, four], timeLimitSeconds: 30 as const, promptAr: 'اختر القطعة' }, privateGrading: { correctOptionId: correct.id }, factFamilies: ['local-ws-tile'], maxPerGameFamily: 1 as const };
  const definitionSha256 = createHash('sha256').update(canonicalChallengeJson(payload)).digest('hex');
  const definitionPath = join(dir, 'definitions.json');
  await writeFile(definitionPath, JSON.stringify([{ manifestSha256: manifest, id, schemaVersion: payload.schemaVersion, definitionSha256, canonicalJson: canonicalChallengeJson({ ...payload, definitionSha256 }) }]));
  const categories = ['tahadani-006', 'tahadani-007'];
  const questions = categories.flatMap((categoryId) => Array.from({ length: 14 }, (_, index) => ({
    id: `local-ws-${categoryId}-${index}`, categoryId, modality: 'classic', answerConceptId: `concept:${categoryId}:${index}`, status: 'draft_test_import', sourceContentHash: `source:${categoryId}:${index}`, difficulty: 'mixed',
    ...(categoryId === 'tahadani-006' ? { challenge: { definition: { manifestSha256: manifest, id, schemaVersion: payload.schemaVersion, definitionSha256 }, factFamilies: [`family:${index}`], kind: 'missing_tile' } } : {}),
  })));
  const questionSourcePath = join(dir, 'questions.json');
  await writeFile(questionSourcePath, JSON.stringify({ snapshotId: 'socket-challenge-fixture', questions, inventory: { source: 'local_firestore_import', snapshotId: 'socket-challenge-fixture', bundleSha256: 'c'.repeat(64), boundedReadCount: questions.length, sourceCandidateCount: questions.length, usableQuestionCount: questions.length, heldQuestionCount: 0, huroofAvailable: true, categories: categories.map((categoryId) => ({ id: categoryId, labelAr: categoryId, sourceOnly: false, questionCount: 14, heldQuestionCount: 0, classicQuestionCount: 14, huroofQuestionCount: 14, categoryGameEligible: true, availability: 'ready' })) } }));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), GAME_DB_PATH: join(dir, 'state.sqlite'), LOCAL_CHALLENGE_QUESTION_SOURCE_PATH: questionSourcePath, LOCAL_CHALLENGE_DEFINITIONS_PATH: definitionPath, LOCAL_CHALLENGE_ENABLED_MECHANICS: 'missing_tile' }, stdio: 'ignore' });
  const capability = { protocolVersion: 't36-challenge-runtime-v1', mechanics: ['missing_tile'] };
  try {
    for (let retry = 0; retry < 25; retry++) { try { if ((await fetch(`http://localhost:${port}/health`)).ok) break; } catch { /* booting */ } await wait(40); }
    const create = await fetch(`http://localhost:${port}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ demo: true, gameKind: 'categories', categories, challenge: capability }) });
    assert.equal(create.status, 201);
    const host = await create.json() as { roomId: string; token: string; revision: number };
    const missing = await fetch(`http://localhost:${port}/api/rooms/${host.roomId}/resume`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${host.token}` }, body: '{}' });
    assert.equal(missing.status, 400); assert.match(await missing.text(), /CHALLENGE_PROTOCOL_REQUIRED/);
    const missingAudience = await fetch(`http://localhost:${port}/api/rooms/${host.roomId}/audience`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(missingAudience.status, 400); assert.match(await missingAudience.text(), /CHALLENGE_PROTOCOL_REQUIRED/);
    const audienceClaim = await fetch(`http://localhost:${port}/api/rooms/${host.roomId}/audience`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge: capability }) });
    assert.equal(audienceClaim.status, 200); assert.equal(typeof (await audienceClaim.json() as { token: unknown }).token, 'string');
    const resumed = await fetch(`http://localhost:${port}/api/rooms/${host.roomId}/resume`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${host.token}` }, body: JSON.stringify({ challenge: capability }) });
    assert.equal(resumed.status, 200); const handshake = await resumed.json() as { revision: number; serverTime: string }; assert.equal(handshake.revision, host.revision); assert.ok(Number.isFinite(Date.parse(handshake.serverTime)));
    const bareSnapshot = await fetch(`http://localhost:${port}/api/rooms/${host.roomId}`, { headers: { authorization: `Bearer ${host.token}` } });
    assert.equal(bareSnapshot.status, 400); assert.match(await bareSnapshot.text(), /CHALLENGE_PROTOCOL_REQUIRED/);
    const snapshot = await fetch(`http://localhost:${port}/api/rooms/${host.roomId}?challenge=${encodeURIComponent(JSON.stringify(capability))}`, { headers: { authorization: `Bearer ${host.token}` } });
    assert.equal(snapshot.status, 200); assert.equal((await snapshot.json() as { revision: number }).revision, handshake.revision);
    const rejectSocket = new WebSocket(`ws://localhost:${port}/ws?roomId=${host.roomId}&token=${encodeURIComponent(host.token)}`);
    await new Promise<void>((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('challenge socket should require capability')), 2_000); rejectSocket.once('close', () => { clearTimeout(timeout); resolve(); }); rejectSocket.once('error', () => undefined); });
    const accepted = new WebSocket(`ws://localhost:${port}/ws?roomId=${host.roomId}&token=${encodeURIComponent(host.token)}&challenge=${encodeURIComponent(JSON.stringify(capability))}`);
    const initial = await next(accepted, 'challenge initial');
    assert.equal(initial.revision, handshake.revision);
    accepted.close();
  } finally { child.kill(); await new Promise<void>((resolve) => child.once('exit', () => resolve())); await rm(dir, { recursive: true, force: true }); }
});

test('local HTTP create, join, and resume require the exact T37.F word-search schema offer', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'huroof-word-search-http-'));
  const port = 8900 + Math.floor(Math.random() * 500);
  const digest = 'a'.repeat(64), manifest = 'b'.repeat(64), id = 'local-word-search';
  const payload = {
    schemaVersion: 't37-topup-word-search-definition-v1' as const, id, kind: 'word_search' as const, categoryId: 'tahadani-games-122' as const, ordinal: 1, disposition: 'ready' as const,
    source: { sourceId: 'local-word-search', sourcePack: 'test', sourcePath: 'private', sourceRawSha256: digest, sourceContextsSha256: digest, mediaArchiveSha256: digest }, media: [],
    publicData: { rows: 8 as const, columns: 8 as const, grid: Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, column) => row === 0 && column < 5 ? ['ب', 'و', 'ص', 'ل', 'ة'][column]! : 'ا')), clueAr: 'أداة تعين المسافر على معرفة الشمال.', timeLimitSeconds: 60 as const },
    privateGrading: { normalizedAnswer: 'بوصله', acceptedPaths: [{ start: [0, 0] as [number, number], end: [0, 4] as [number, number] }], rawClaimedOccurrences: 1 }, factFamilies: ['local-word-search'], maxPerGameFamily: 1 as const,
  };
  const definitionSha256 = createHash('sha256').update(canonicalChallengeJson(payload)).digest('hex');
  const definitionPath = join(dir, 'definitions.json');
  await writeFile(definitionPath, JSON.stringify([{ manifestSha256: manifest, id, schemaVersion: payload.schemaVersion, definitionSha256, canonicalJson: canonicalChallengeJson({ ...payload, definitionSha256 }) }]));
  const categories = ['tahadani-games-122', 'tahadani-games-006'];
  const questions = categories.flatMap((categoryId) => Array.from({ length: 14 }, (_, index) => ({
    id: `local-http-${categoryId}-${index}`, categoryId, modality: 'classic', answerConceptId: `concept:${categoryId}:${index}`, status: 'draft_test_import', sourceContentHash: `source:${categoryId}:${index}`, difficulty: 'mixed',
    ...(categoryId === 'tahadani-games-122' ? { challenge: { definition: { manifestSha256: manifest, id, schemaVersion: payload.schemaVersion, definitionSha256 }, factFamilies: [`family:${index}`], kind: 'word_search' } } : {}),
  })));
  const questionSourcePath = join(dir, 'questions.json');
  await writeFile(questionSourcePath, JSON.stringify({ snapshotId: 'word-search-http-fixture', questions, inventory: { source: 'local_firestore_import', snapshotId: 'word-search-http-fixture', bundleSha256: 'c'.repeat(64), boundedReadCount: questions.length, sourceCandidateCount: questions.length, usableQuestionCount: questions.length, heldQuestionCount: 0, huroofAvailable: true, categories: categories.map((categoryId) => ({ id: categoryId, labelAr: categoryId, sourceOnly: false, questionCount: 14, heldQuestionCount: 0, classicQuestionCount: 14, huroofQuestionCount: 14, categoryGameEligible: true, availability: 'ready' })) } }));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), GAME_DB_PATH: join(dir, 'state.sqlite'), LOCAL_CHALLENGE_QUESTION_SOURCE_PATH: questionSourcePath, LOCAL_CHALLENGE_DEFINITIONS_PATH: definitionPath, LOCAL_CHALLENGE_ENABLED_MECHANICS: 'word_search' }, stdio: 'ignore' });
  const legacy = { protocolVersion: 't36-challenge-runtime-v1', mechanics: ['word_search'], definitionSchemas: ['t36-challenge-definition-v1'] };
  const current = { ...legacy, definitionSchemas: ['t37-topup-word-search-definition-v1'] };
  try {
    for (let retry = 0; retry < 25; retry++) { try { if ((await fetch(`http://localhost:${port}/health`)).ok) break; } catch { /* booting */ } await wait(40); }
    const rejectedCreate = await fetch(`http://localhost:${port}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ demo: true, gameKind: 'categories', categories, challenge: legacy }) });
    assert.equal(rejectedCreate.status, 400); assert.match(await rejectedCreate.text(), /CHALLENGE_DEFINITION_SCHEMA_UNSUPPORTED/);
    const create = await fetch(`http://localhost:${port}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ demo: true, gameKind: 'categories', categories, challenge: current }) });
    const createText = await create.text(); assert.equal(create.status, 201, createText);
    const host = JSON.parse(createText) as { roomId: string; roomCode: string; token: string; revision: number };
    const rejectedJoin = await fetch(`http://localhost:${port}/api/rooms/${host.roomCode}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'قديم', challenge: legacy }) });
    assert.equal(rejectedJoin.status, 400); assert.match(await rejectedJoin.text(), /CHALLENGE_PROTOCOL_REQUIRED/);
    const joined = await fetch(`http://localhost:${port}/api/rooms/${host.roomCode}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'حديث', challenge: current }) });
    assert.equal(joined.status, 200); assert.equal(typeof (await joined.json() as { token: unknown }).token, 'string');
    const rejectedResume = await fetch(`http://localhost:${port}/api/rooms/${host.roomId}/resume`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${host.token}` }, body: JSON.stringify({ challenge: legacy }) });
    assert.equal(rejectedResume.status, 400); assert.match(await rejectedResume.text(), /CHALLENGE_PROTOCOL_REQUIRED/);
    const resumed = await fetch(`http://localhost:${port}/api/rooms/${host.roomId}/resume`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${host.token}` }, body: JSON.stringify({ challenge: current }) });
    assert.equal(resumed.status, 200); assert.ok(Number.isFinite(Date.parse((await resumed.json() as { serverTime: string }).serverTime)));
  } finally { child.kill(); await new Promise<void>((resolve) => child.once('exit', () => resolve())); await rm(dir, { recursive: true, force: true }); }
});
