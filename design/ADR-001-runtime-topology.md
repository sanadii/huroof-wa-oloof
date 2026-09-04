# ADR-001 — Runtime Topology

Status: **proposed baseline; backend technology remains open**  
Date: 2026-09-03

## Context

React + TypeScript + Vite defines the web client, but the product has simultaneous host, player, and audience devices. Buzzer order, timers, role-filtered information, corrections, and reconnect recovery cannot be authoritative in browser-local state.

## Decision

Build one React/Vite client with role-specific route projections and two interchangeable runtime adapters:

1. `FixtureGameAdapter` for deterministic design development, Storybook-style states, and single-browser demos.
2. `RealtimeGameAdapter` for real matches, backed by one server-authoritative ordered event stream.

The production server—not any player browser—owns:

- room membership and roles;
- active game-state transition;
- buzzer-open timestamp and first accepted buzz;
- question/timer deadlines;
- cell ownership and path check;
- adjudication and correction ordering;
- reconnect snapshots and audit history.

Backend language, framework, database, hosting region, authentication, and realtime vendor are intentionally undecided. The frontend contract must not depend on a vendor-specific SDK.

## Client boundary

The React client consumes a role-filtered `GameProjection` and emits typed `GameIntent` messages. It never mutates canonical match state directly.

```ts
type ClientRole = "host" | "player" | "audience" | "question_admin";

interface ProjectionEnvelope<TProjection> {
  roomId: string;
  revision: number;
  serverTime: string;
  role: ClientRole;
  projection: TProjection;
}

interface GameIntent<TPayload = unknown> {
  intentId: string;
  expectedRevision: number;
  type: string;
  payload: TPayload;
}
```

Every server event receives a monotonic room revision. Stale intents are rejected with the current safe projection.

## Role filtering

- Host projection may contain `primaryAnswer`, accepted alternatives, source, and adjudication controls.
- Player and audience projections must omit those fields entirely before a host-approved reveal; masking them in CSS is forbidden.
- Players receive only their own device/connection details and public roster data.
- Audience projections contain no actionable host or player controls.
- Question-admin data is outside active-room projections unless explicitly requested by an authorized host workflow.

## Connection behavior

- Initial state: `connecting` with no interactive buzzer.
- Ready: show latest snapshot revision and server-synchronized timer deadline.
- Reconnecting: freeze actions, retain last safe visual state, show a textual status, and request a fresh snapshot.
- Resumed: replace local projection atomically; do not replay visual effects for historical events.
- Failed: present a specific retry action and room-code escape path.
- The player buzzer becomes enabled only after the server acknowledges `buzz_open` for the current question revision.

## Corrections

Corrections are new ordered events, never local rollbacks. The server recalculates ownership, paths, round result, and dependent events. The client receives a replacement projection and shows the correction reason in the host log. Audience/player surfaces announce only the corrected public result.

## Consequences

- V1 requires a small realtime service in addition to the Vite build for actual multi-device matches.
- UI development can start immediately against fixtures without pretending that fixture state is production authority.
- A future backend choice must implement this contract and the state matrix; it may not redefine the game rules.

## Rejected alternatives

- **Browser-only authoritative game:** unfair and unsafe for multi-device buzzing.
- **One universal projection:** risks exposing answers and controls.
- **Optimistic buzzer winner:** visually fast but can announce the wrong player under network contention.

