import type { ClientRole, CreateRoomRequest, GameIntent, GameRuntimeAdapter, JoinRoomRequest, ProjectionEnvelope } from './contracts';

/** Default adapter; the Node service validates its capability token on every request. */
export class LocalRealtimeGameAdapter implements GameRuntimeAdapter {
  readonly kind = 'local' as const;
  private token = '';
  async createRoom(request: CreateRoomRequest) { const response = await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }); if (!response.ok) throw new Error(await response.text()); const value = await response.json(); this.token = value.token; return value; }
  async joinRoom(request: JoinRoomRequest) { const response = await fetch(`/api/rooms/${encodeURIComponent(request.roomCode)}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }); if (!response.ok) throw new Error(await response.text()); const value = await response.json(); this.token = value.token; return value; }
  async submitGameIntent(roomId: string, intent: GameIntent) { const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/intents`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` }, body: JSON.stringify(intent) }); if (!response.ok) throw new Error(await response.text()); return response.json(); }
  subscribeProjection(roomId: string, _role: ClientRole, _uid: string, onProjection: (value: ProjectionEnvelope) => void) { const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; const socket = new WebSocket(`${protocol}//${location.host}/ws?roomId=${encodeURIComponent(roomId)}&token=${encodeURIComponent(this.token)}`); socket.addEventListener('message', (event) => onProjection(JSON.parse(String(event.data)) as ProjectionEnvelope)); return () => socket.close(); }
}
