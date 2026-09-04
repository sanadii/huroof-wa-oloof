export type GameRuntimeKind = 'firebase' | 'fixture' | 'local';

/** Unknown and absent runtime values stay in deterministic fixture mode. */
export function selectGameRuntimeKind(value: string | undefined): GameRuntimeKind {
  if (value === 'firebase') return 'firebase';
  if (value === 'local') return 'local';
  return 'fixture';
}
