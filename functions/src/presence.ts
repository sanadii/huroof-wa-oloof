export const PRESENCE_HEARTBEAT_MS = 15_000;
export const PRESENCE_LEASE_MS = 45_000;

export type PresenceState = "connected" | "disconnected" | "unknown";

export function exactPresenceRoomId(value: unknown): string {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value as Record<string, unknown>).length !== 1 ||
    typeof (value as Record<string, unknown>).roomId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test((value as Record<string, string>).roomId)
  )
    throw new Error("invalid-presence-request");
  return (value as Record<string, string>).roomId;
}

export function leaseState(lease: unknown, currentTime: number): PresenceState {
  if (!lease || typeof lease !== "object") return "unknown";
  const expiresAtMs = (lease as Record<string, unknown>).expiresAtMs;
  if (typeof expiresAtMs !== "number") return "unknown";
  return expiresAtMs > currentTime ? "connected" : "disconnected";
}
