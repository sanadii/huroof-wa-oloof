import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CanonicalMember, CanonicalRoom } from './game.js';

export type CurrentQuestionMediaRequest = { roomId: string; mediaId: string; assetSha256: string };
export const activeImageStates = new Set(['QUESTION_READING', 'FIRST_ANSWER', 'OPPONENT_CHANCE', 'QUESTION_FAILED']);

type ManifestAsset = { mediaId: string; assetSha256: string; localFile: string; mediaType: string; width: number; height: number };

const pngDimensions = (bytes: Buffer) => {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('emulator-media-invalid-png');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096) throw new Error('emulator-media-invalid-bounds');
  return { width, height };
};

async function manifestPath() {
  const suffix = ['content', 'question-media', 'v18-private-240', 'manifest.json'];
  for (const base of [process.cwd(), resolve(process.cwd(), '..'), resolve(process.cwd(), '..', '..')]) {
    const candidate = resolve(base, ...suffix);
    try { await access(candidate); return candidate; } catch { /* try the next fixed parent only */ }
  }
  throw new Error('emulator-media-manifest-unavailable');
}

/** Emulator byte delivery is deliberately unavailable outside the Functions emulator. */
export async function emulatorCurrentQuestionMediaUrl(media: { mediaId: string; assetSha256: string }) {
  if (process.env.FUNCTIONS_EMULATOR !== 'true') throw new Error('emulator-media-disabled');
  const path = await manifestPath();
  const manifest = JSON.parse(await readFile(path, 'utf8')) as { assets?: unknown[] };
  const asset = manifest.assets?.find((value): value is ManifestAsset => Boolean(value && typeof value === 'object' && (value as ManifestAsset).mediaId === media.mediaId && (value as ManifestAsset).assetSha256 === media.assetSha256));
  if (!asset || asset.mediaType !== 'image/png' || !/^[a-f0-9]{64}$/i.test(asset.assetSha256) || !/^originals\/[a-f0-9]{64}\.png$/.test(asset.localFile)) throw new Error('emulator-media-binding-mismatch');
  const bytes = await readFile(resolve(path, '..', asset.localFile));
  if (createHash('sha256').update(bytes).digest('hex') !== asset.assetSha256) throw new Error('emulator-media-hash-mismatch');
  const size = pngDimensions(bytes);
  if (size.width !== asset.width || size.height !== asset.height) throw new Error('emulator-media-dimensions-mismatch');
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

/** Pure callable authorization boundary; the caller supplies identity from Auth. */
export function authorizeCurrentQuestionMedia(roomId: string, room: CanonicalRoom, members: CanonicalMember[], uid: string, request: unknown) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('invalid-media-request');
  const value = request as Partial<CurrentQuestionMediaRequest>;
  if (Object.keys(value).length !== 3 || value.roomId !== roomId || typeof value.mediaId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.mediaId) || typeof value.assetSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.assetSha256)) throw new Error('invalid-media-request');
  if ((room as CanonicalRoom & { closedAt?: unknown }).closedAt) throw new Error('media-not-visible');
  const member = members.find((candidate) => candidate.uid === uid && candidate.active);
  if (!member || member.role === 'player') throw new Error('media-role-forbidden');
  if (member.role === 'audience' && (!activeImageStates.has(room.game.lifecycle) || room.config.showQuestionOnAudience === false)) throw new Error('media-not-visible');
  const media = room.activeQuestion?.media;
  if (room.activeQuestion?.modality !== 'image' || !media || media.mediaId !== value.mediaId || media.assetSha256 !== value.assetSha256) throw new Error('media-binding-mismatch');
  return media;
}
