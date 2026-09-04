import { FirebaseGameAdapter } from './firebase-game-adapter';
import { FixtureGameAdapter } from './fixture-game-adapter';
import { LocalRealtimeGameAdapter } from './local-realtime-game-adapter';
import type { GameRuntimeAdapter } from './contracts';
import { selectGameRuntimeKind } from './runtime-selector';

export * from './contracts';
export { LocalRealtimeGameAdapter } from './local-realtime-game-adapter';
export { selectGameRuntimeKind, type GameRuntimeKind } from './runtime-selector';
export function createGameRuntime(): GameRuntimeAdapter {
  switch (selectGameRuntimeKind(import.meta.env.VITE_GAME_RUNTIME)) {
    case 'firebase': return new FirebaseGameAdapter();
    case 'local': return new LocalRealtimeGameAdapter();
    case 'fixture': return new FixtureGameAdapter();
  }
}

/** One adapter instance preserves the local capability token and is the only room transport used by routes. */
export const gameRuntime = createGameRuntime();
