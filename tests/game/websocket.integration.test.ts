import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

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
