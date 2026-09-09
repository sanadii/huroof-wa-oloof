import type { ClientRole, CreateRoomRequest, GameIntent, GameRuntimeAdapter, JoinRoomRequest, ProjectionEnvelope } from './contracts';

/** Default adapter; the Node service validates its capability token on every request. */
export class LocalRealtimeGameAdapter implements GameRuntimeAdapter {
  readonly kind = 'local' as const;
  private token = '';
  setCapabilityToken(token: string) { this.token = token; }
  async createRoom(request: CreateRoomRequest) { const response = await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }); if (!response.ok) throw new Error(await response.text()); const value = await response.json(); this.token = value.token; return value; }
  async joinRoom(request: JoinRoomRequest) { const response = await fetch(`/api/rooms/${encodeURIComponent(request.roomCode)}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }); if (!response.ok) throw new Error(await response.text()); const value = await response.json(); this.token = value.token; return value; }
  async submitGameIntent(roomId: string, intent: GameIntent) { const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/intents`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` }, body: JSON.stringify(intent) }); if (!response.ok) throw new Error(await response.text()); return response.json(); }
  async getCurrentQuestionMedia(request: { roomId: string; mediaId: string; assetSha256: string }) {
    const issued = await fetch(`/api/rooms/${encodeURIComponent(request.roomId)}/current-question-media`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` }, body: JSON.stringify({ mediaId: request.mediaId, assetSha256: request.assetSha256 }) });
    if (!issued.ok) throw new Error(await issued.text());
    const ticket = await issued.json() as { ticket?: unknown; expiresAt?: unknown };
    if (typeof ticket.ticket !== 'string' || typeof ticket.expiresAt !== 'string') throw new Error('MEDIA_UNAVAILABLE');
    const response = await fetch(`/api/question-media/${encodeURIComponent(ticket.ticket)}`, { headers: { authorization: `Bearer ${this.token}` }, cache: 'no-store' });
    if (!response.ok) throw new Error(await response.text());
    const blob = await response.blob();
    if (blob.type !== 'image/png') throw new Error('MEDIA_INVALID_TYPE');
    return { mediaId: request.mediaId, assetSha256: request.assetSha256, url: URL.createObjectURL(blob), expiresAt: ticket.expiresAt };
  }
  subscribeProjection(roomId: string, _role: ClientRole, _uid: string, onProjection: (value: ProjectionEnvelope) => void) { const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; const socket = new WebSocket(`${protocol}//${location.host}/ws?roomId=${encodeURIComponent(roomId)}&token=${encodeURIComponent(this.token)}`); socket.addEventListener('message', (event) => onProjection(JSON.parse(String(event.data)) as ProjectionEnvelope)); return () => socket.close(); }
}
