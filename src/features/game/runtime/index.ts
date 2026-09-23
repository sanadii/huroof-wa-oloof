import { FixtureGameAdapter } from './fixture-game-adapter';
import { LocalRealtimeGameAdapter } from './local-realtime-game-adapter';
import type { GameRuntimeAdapter } from './contracts';
import { DeferredFirebaseGameAdapter } from './deferred-firebase-adapter';
import { selectGameRuntimeKind } from './runtime-selector';

export * from './contracts';
export { LocalRealtimeGameAdapter } from './local-realtime-game-adapter';
export { selectGameRuntimeKind, type GameRuntimeKind } from './runtime-selector';

/**
 * Keeps optional Firebase code out of the public entry bundle. The adapter is
 * instantiated only when a Firebase-configured action or subscription is used.
 */
export function createGameRuntime(): GameRuntimeAdapter {
  switch (selectGameRuntimeKind(import.meta.env.VITE_GAME_RUNTIME)) {
    case 'firebase': return new DeferredFirebaseGameAdapter();
    case 'local': return new LocalRealtimeGameAdapter();
    case 'fixture': return new FixtureGameAdapter();
  }
}

/** One adapter instance preserves the local capability token and is the only room transport used by routes. */
export const gameRuntime = createGameRuntime();
