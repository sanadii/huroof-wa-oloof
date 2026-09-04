import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const next = (socket: WebSocket) => new Promise<Record<string, unknown>>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('websocket timeout')), 2_000); socket.once('message', (message) => { clearTimeout(timer); resolve(JSON.parse(String(message))); }); });
test('two websocket clients receive safe projections; first buzz wins and reconnect gets snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'huroof-ws-')); const port = 8900 + Math.floor(Math.random() * 500); const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), GAME_DB_PATH: join(dir, 'state.sqlite') }, stdio: 'ignore' });
  try {
    for (let retry = 0; retry < 25; retry++) { try { if ((await fetch(`http://localhost:${port}/health`)).ok) break; } catch { /* service is still booting */ } await wait(40); }
    const create = await fetch(`http://localhost:${port}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ demo: true }) }); const host = await create.json() as { roomId: string; roomCode: string; revision: number; token: string };
    const join = async (name: string) => (await (await fetch(`http://localhost:${port}/api/rooms/${host.roomCode}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: name }) })).json()) as { token: string; revision: number };
    const one = await join('one'); const two = await join('two'); let revision = two.revision;
    const ready = async (token: string) => { const response = await fetch(`http://localhost:${port}/api/rooms/${host.roomId}/intents`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ type: 'LOBBY_SET_READY', intentId: `ready-${revision}`, expectedRevision: revision, payload: { ready: true } }) }); const value = await response.json() as { revision: number }; revision = value.revision; };
    await ready(one.token); await ready(two.token);
    const hostIntent = async (type: string, payload: Record<string, unknown> = {}) => { const response = await fetch(`http://localhost:${port}/api/rooms/${host.roomId}/intents`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${host.token}` }, body: JSON.stringify({ type, intentId: `${type}-${revision}`, expectedRevision: revision, payload }) }); const value = await response.json() as { revision: number }; revision = value.revision; };
    await hostIntent('START_MATCH'); await hostIntent('ROUND_READY'); await hostIntent('SELECT_CELL', { cellId: 'cell-0-0' }); await hostIntent('LETTER_REVEALED'); await hostIntent('OPEN_QUESTION');
    const connect = (token: string) => new WebSocket(`ws://localhost:${port}/ws?roomId=${host.roomId}&token=${token}`); const wsOne = connect(one.token); const wsTwo = connect(two.token); const [oneInitial, twoInitial] = await Promise.all([next(wsOne), next(wsTwo)]); assert.equal(JSON.stringify(oneInitial).includes('primaryAnswer'), false); assert.equal(JSON.stringify(twoInitial).includes('acceptedAnswers'), false);
    wsOne.send(JSON.stringify({ type: 'BUZZ', intentId: 'race-one', expectedRevision: revision, payload: {} })); wsTwo.send(JSON.stringify({ type: 'BUZZ', intentId: 'race-two', expectedRevision: revision, payload: {} })); const winnerProjection = await next(wsOne); assert.equal((winnerProjection.projection as { room: { state: string } }).room.state, 'FIRST_ANSWER'); wsOne.close(); const reconnect = connect(one.token); const recovered = await next(reconnect); assert.equal(recovered.revision, winnerProjection.revision); reconnect.close(); wsTwo.close();
  } finally { child.kill(); await new Promise<void>((resolve) => child.once('exit', () => resolve())); await rm(dir, { recursive: true, force: true }); }
});
