import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import { AuthoritativeGameService } from './service.js';

const service = new AuthoritativeGameService({ dbPath: process.env.GAME_DB_PATH });
const json = async (request: import('node:http').IncomingMessage): Promise<Record<string, unknown>> => { let body = ''; for await (const chunk of request) body += chunk; return body ? JSON.parse(body) : {}; };
const token = (request: import('node:http').IncomingMessage): string => String(request.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
const isLoopback = (request: import('node:http').IncomingMessage) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '');
const server = createServer(async (request, response) => {
  try {
    response.setHeader('access-control-allow-origin', process.env.CORS_ORIGIN ?? '*'); response.setHeader('access-control-allow-headers', 'content-type, authorization');
    if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`); const parts = url.pathname.split('/').filter(Boolean);
    if (request.method === 'GET' && url.pathname === '/health') { response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true })); return; }
    if ((request.method === 'GET' || request.method === 'POST') && url.pathname.startsWith('/api/admin/questions') && !isLoopback(request)) throw new Error('LOCAL_ONLY_ADMIN');
    if (request.method === 'GET' && url.pathname === '/api/admin/questions') { const payload = JSON.stringify(await service.adminQuestions()); response.writeHead(200, { 'content-type': 'application/json' }).end(payload); return; }
    if (request.method === 'GET' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'admin' && parts[2] === 'questions') { const question = await service.adminQuestion(parts[3]); if (!question) throw new Error('QUESTION_NOT_FOUND'); const payload = JSON.stringify(question); response.writeHead(200, { 'content-type': 'application/json' }).end(payload); return; }
    if (request.method === 'POST' && url.pathname === '/api/admin/questions') { const payload = JSON.stringify(service.saveAdminDraft(await json(request))); response.writeHead(201, { 'content-type': 'application/json' }).end(payload); return; }
    if (request.method === 'POST' && url.pathname === '/api/rooms') { const body = await json(request); const payload = JSON.stringify(service.create(typeof body.displayName === 'string' ? body.displayName : undefined, body.demo === true, body)); response.writeHead(201, { 'content-type': 'application/json' }).end(payload); return; }
    if (request.method === 'POST' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'rooms' && parts[3] === 'join') { const body = await json(request); const payload = JSON.stringify(service.join(parts[2], typeof body.displayName === 'string' ? body.displayName : undefined)); response.writeHead(200, { 'content-type': 'application/json' }).end(payload); return; }
    if (request.method === 'POST' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'rooms' && parts[3] === 'audience') { const room = service.store.load(parts[2]); if (!room) throw new Error('ROOM_NOT_FOUND'); const payload = JSON.stringify({ roomId: room.id, revision: room.revision, token: service.createAudienceCapability(room.id) }); response.writeHead(200, { 'content-type': 'application/json' }).end(payload); return; }
    if (request.method === 'GET' && parts.length === 3 && parts[0] === 'api' && parts[1] === 'rooms') { const payload = JSON.stringify(service.metadata(parts[2], token(request))); response.writeHead(200, { 'content-type': 'application/json' }).end(payload); return; }
    if (request.method === 'POST' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'rooms' && parts[3] === 'intents') { const result = await service.intent(parts[2], token(request), await json(request) as never); broadcast(parts[2]); const payload = JSON.stringify(result); response.writeHead(200, { 'content-type': 'application/json' }).end(payload); return; }
    if (request.method === 'GET' && !url.pathname.startsWith('/api/') && url.pathname !== '/ws') {
      const dist = join(process.cwd(), 'dist'); const requested = normalize(join(dist, url.pathname === '/' ? 'index.html' : url.pathname)); const safe = requested.startsWith(dist) ? requested : join(dist, 'index.html');
      try { const file = await stat(safe).then(() => safe); const body = await readFile(file); const contentType = extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : extname(file) === '.svg' ? 'image/svg+xml' : 'text/html'; response.writeHead(200, { 'content-type': contentType }).end(body); } catch { response.writeHead(200, { 'content-type': 'text/html' }).end(await readFile(join(dist, 'index.html'))); } return;
    }
    response.writeHead(404).end();
  } catch (error) { if (!response.headersSent) response.writeHead(String(error).includes('UNAUTHORIZED') || String(error).includes('FORBIDDEN') ? 403 : 400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error instanceof Error ? error.message : 'BAD_REQUEST' })); else response.destroy(error instanceof Error ? error : undefined); }
});
const sockets = new WebSocketServer({ noServer: true });
const connections = new Map<string, Set<{ ws: import('ws').WebSocket; token: string }>>();
const broadcast = (roomId: string) => { for (const connection of connections.get(roomId) ?? []) if (connection.ws.readyState === connection.ws.OPEN) connection.ws.send(JSON.stringify(service.metadata(roomId, connection.token))); };
setInterval(() => { void service.tick().then((ids) => ids.forEach(broadcast)); }, 250).unref();
server.on('upgrade', (request, socket, head) => { const url = new URL(request.url ?? '/', `http://${request.headers.host}`); if (url.pathname !== '/ws') return socket.destroy(); const roomId = url.searchParams.get('roomId') ?? ''; const capabilityToken = url.searchParams.get('token') ?? ''; const capability = service.verify(capabilityToken); if (!capability || capability.roomId !== roomId) return socket.destroy(); sockets.handleUpgrade(request, socket, head, (ws) => { const connection = { ws, token: capabilityToken }; const roomConnections = connections.get(roomId) ?? new Set(); roomConnections.add(connection); connections.set(roomId, roomConnections); ws.send(JSON.stringify(service.metadata(roomId, capabilityToken))); ws.on('message', async (raw) => { try { await service.intent(roomId, capabilityToken, JSON.parse(String(raw))); broadcast(roomId); } catch (error) { ws.send(JSON.stringify({ error: error instanceof Error ? error.message : 'BAD_REQUEST' })); } }); ws.on('close', () => roomConnections.delete(connection)); }); });
const port = Number(process.env.PORT ?? 8787); server.listen(port, () => console.log(`Huroof local authority listening on ${port}`));
const close = () => { sockets.clients.forEach((client) => client.close()); server.close(() => service.close()); };
process.once('SIGINT', close); process.once('SIGTERM', close);
