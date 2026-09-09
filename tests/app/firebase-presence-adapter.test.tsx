// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

type Deferred = {
  resolve: (value: { data: { roomId: string; serverTime: string; players: Record<string, { state: "connected" }> } }) => void;
};

const mocks = vi.hoisted(() => {
  const calls: Deferred[] = [];
  return {
    calls,
    invoke: vi.fn(() => new Promise((resolve) => calls.push({ resolve }))),
  };
});

vi.mock("firebase/functions", () => ({
  httpsCallable: vi.fn(() => mocks.invoke),
}));
vi.mock("firebase/firestore", () => ({
  doc: vi.fn(),
  onSnapshot: vi.fn(),
}));
vi.mock("../../src/lib/firebase/client", () => ({
  getOptionalFirebaseClient: () => ({
    functions: {},
    auth: {
      currentUser: { uid: "player-1" },
      authStateReady: async () => undefined,
    },
    firestore: {},
  }),
  signInAnonymouslyIfNeeded: async () => undefined,
}));

import { FirebaseGameAdapter } from "../../src/features/game/runtime/firebase-game-adapter";

const snapshot = () => ({
  data: {
    roomId: "room-1",
    serverTime: new Date().toISOString(),
    players: { "player-1": { state: "connected" as const } },
  },
});

afterEach(() => {
  mocks.calls.length = 0;
  mocks.invoke.mockClear();
  vi.restoreAllMocks();
});

it("drops disposed, foreground-invalidated, and delayed Firebase presence callbacks", async () => {
  const now = vi.spyOn(performance, "now");
  now.mockReturnValue(0);
  const received = vi.fn();
  const adapter = new FirebaseGameAdapter();
  const stop = adapter.subscribeHostPresence("room-1", received);
  await Promise.resolve();
  expect(mocks.calls).toHaveLength(1);

  stop();
  mocks.calls[0].resolve(snapshot());
  await Promise.resolve();
  expect(received).not.toHaveBeenCalled();

  const refreshed = adapter.subscribeHostPresence("room-1", received);
  await Promise.resolve();
  const stale = mocks.calls[1];
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
  await Promise.resolve();
  expect(mocks.calls).toHaveLength(3);
  stale.resolve(snapshot());
  await Promise.resolve();
  expect(received).not.toHaveBeenCalled();
  mocks.calls[2].resolve(snapshot());
  await Promise.resolve();
  expect(received).toHaveBeenCalledTimes(1);
  refreshed();

  mocks.calls.splice(0);
  const delayed = adapter.subscribeHostPresence("room-1", received);
  await Promise.resolve();
  now.mockReturnValue(30_001);
  mocks.calls[0].resolve(snapshot());
  await Promise.resolve();
  expect(received).toHaveBeenCalledTimes(1);
  delayed();
});

it("labels cached projection snapshots as non-authoritative until Firestore confirms them", async () => {
  const received = vi.fn();
  const adapter = new FirebaseGameAdapter();
  adapter.subscribeProjection("room-1", "player", "", received);
  await Promise.resolve();
  await Promise.resolve();

  const projectionListener = vi.mocked(
    (await import("firebase/firestore")).onSnapshot,
  ).mock.calls[0]?.[2] as ((value: {
    exists: () => boolean;
    data: () => Record<string, unknown>;
    metadata: { fromCache: boolean };
  }) => void);
  const data = {
    roomId: "room-1",
    revision: 7,
    serverTime: new Date().toISOString(),
    role: "player",
    projection: { room: { roomCode: "ROOM0001", state: "LOBBY" } },
  };
  projectionListener({ exists: () => true, data: () => data, metadata: { fromCache: true } });
  projectionListener({ exists: () => true, data: () => data, metadata: { fromCache: false } });

  expect(received).toHaveBeenNthCalledWith(1, expect.objectContaining({ authoritative: false }));
  expect(received).toHaveBeenNthCalledWith(2, expect.objectContaining({ authoritative: true }));
});
