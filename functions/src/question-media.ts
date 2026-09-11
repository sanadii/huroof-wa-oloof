import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hasRevealedOccurrence, type CanonicalMember, type CanonicalRoom } from './game.js';

export type CurrentQuestionMediaRequest = { roomId: string; mediaId: string; assetSha256: string };
export const activeImageStates = new Set(['QUESTION_READING', 'FIRST_ANSWER', 'OPPONENT_CHANCE', 'QUESTION_FAILED', 'PAUSED']);

type ManifestAsset = { mediaId: string; assetSha256?: string; sha256?: string; localFile: string; mediaType?: string; contentType?: string; width?: number; height?: number; bytes?: number; durationSeconds?: number };

const pngDimensions = (bytes: Buffer) => {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('emulator-media-invalid-png');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096) throw new Error('emulator-media-invalid-bounds');
  return { width, height };
};

async function manifestPath(directory = 'v18-private-240', filename = 'manifest.json') {
  const suffix = ['content', 'question-media', directory, filename];
  for (const base of [process.cwd(), resolve(process.cwd(), '..'), resolve(process.cwd(), '..', '..')]) {
    const candidate = resolve(base, ...suffix);
    try { await access(candidate); return candidate; } catch { /* try the next fixed parent only */ }
  }
  throw new Error('emulator-media-manifest-unavailable');
}

/** Emulator byte delivery is deliberately unavailable outside the Functions emulator. */
export async function emulatorCurrentQuestionMediaUrl(media: { mediaId: string; assetSha256: string; contentType?: string }) {
  if (process.env.FUNCTIONS_EMULATOR !== 'true') throw new Error('emulator-media-disabled');
  const rebuiltJpeg = media.contentType === 'image/jpeg' && /^rebuild-v2-photo-\d{3}-\d{3}$/.test(media.mediaId);
  const goalVideo = media.contentType === 'video/mp4' && /^goal-quiz-2026:\d{3}:(blur|clean)$/.test(media.mediaId);
  const path = await manifestPath(goalVideo ? 'goal-quiz-2026' : rebuiltJpeg ? 'guess-picture-rebuild-v2' : undefined, goalVideo ? 'media-registry.json' : undefined);
  const manifest = JSON.parse(await readFile(path, 'utf8')) as { assets?: unknown[] };
  const asset = manifest.assets?.find((value): value is ManifestAsset => Boolean(value && typeof value === 'object' && (value as ManifestAsset).mediaId === media.mediaId && ((value as ManifestAsset).assetSha256 ?? (value as ManifestAsset).sha256) === media.assetSha256));
  const assetSha256 = asset?.assetSha256 ?? asset?.sha256;
  const expectedBytes = asset?.bytes;
  if (!asset || !/^[a-f0-9]{64}$/i.test(assetSha256 ?? '') || (goalVideo ? asset.contentType !== 'video/mp4' || !/^assets\/[a-f0-9]{64}\.mp4$/.test(asset.localFile) || !Number.isInteger(asset.width) || !Number.isInteger(asset.height) || typeof asset.durationSeconds !== 'number' || asset.durationSeconds <= 0 || typeof expectedBytes !== 'number' || !Number.isInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > 1_000_000 : rebuiltJpeg ? asset.mediaType !== 'image/jpeg' || !/^images\/\d{3}-\d{3}\.jpg$/.test(asset.localFile) : asset.mediaType !== 'image/png' || !/^originals\/[a-f0-9]{64}\.png$/.test(asset.localFile))) throw new Error('emulator-media-binding-mismatch');
  const bytes = await readFile(resolve(path, '..', asset.localFile));
  if (createHash('sha256').update(bytes).digest('hex') !== assetSha256) throw new Error('emulator-media-hash-mismatch');
  if (goalVideo) {
    if (bytes.length !== expectedBytes || bytes.length < 8 || bytes.toString('ascii', 4, 8) !== 'ftyp') throw new Error('emulator-media-invalid-mp4');
    return `data:video/mp4;base64,${bytes.toString('base64')}`;
  }
  if (rebuiltJpeg) {
    if (!bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) throw new Error('emulator-media-invalid-jpeg');
    return `data:image/jpeg;base64,${bytes.toString('base64')}`;
  }
  const size = pngDimensions(bytes);
  if (size.width !== asset.width || size.height !== asset.height) throw new Error('emulator-media-dimensions-mismatch');
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

/** Pure callable authorization boundary; the caller supplies identity from Auth. */
export function authorizeCurrentQuestionMedia(roomId: string, room: CanonicalRoom, members: CanonicalMember[], uid: string, request: unknown) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('invalid-media-request');
  const value = request as Partial<CurrentQuestionMediaRequest>;
  if (Object.keys(value).length !== 3 || value.roomId !== roomId || typeof value.mediaId !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(value.mediaId) || typeof value.assetSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.assetSha256)) throw new Error('invalid-media-request');
  if ((room as CanonicalRoom & { closedAt?: unknown }).closedAt) throw new Error('media-not-visible');
  const member = members.find((candidate) => candidate.uid === uid && candidate.active);
  if (!member || member.role === 'player') throw new Error('media-role-forbidden');
  if (!activeImageStates.has(room.game.lifecycle)) throw new Error('media-not-visible');
  if (member.role === 'audience' && room.config.showQuestionOnAudience === false) throw new Error('media-not-visible');
  const revealed = hasRevealedOccurrence(room.activeQuestionOccurrence, room.answerRevealedOccurrence);
  const media = revealed ? room.activeQuestion?.answerMedia ?? room.activeQuestion?.media : room.activeQuestion?.media;
  if (!['image', 'video'].includes(room.activeQuestion?.modality ?? '') || !media || media.mediaId !== value.mediaId || media.assetSha256 !== value.assetSha256) throw new Error('media-binding-mismatch');
  return media;
}
