import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { WebSocketServer } from "ws";
import { AuthoritativeGameService } from "./service.js";
import { isLocalAdminPath, isLoopbackAddress } from "./local-admin-guard.js";
import { loadLocalFirestoreQuestionSource } from "./local-firestore-question-source.js";
import { loadLocalSqliteImportQuestionSource } from "./local-sqlite-import-question-source.js";
import {
  isTrustedImportReviewRequest,
  localImportReviewDetail,
  localImportReviewPage,
  readLocalImportReviewMedia,
} from "./local-import-review.js";

const localFirestoreMode =
  process.env.LOCAL_DB_QUESTION_SOURCE === "firestore-import";
const localSqliteImportMode =
  process.env.LOCAL_DB_QUESTION_SOURCE === "sqlite-import";
const localImportedSourceMode = localFirestoreMode || localSqliteImportMode;
const trustedLocalOrigins = new Set(
  (
    process.env.LOCAL_DB_TRUSTED_ORIGINS ??
    "http://127.0.0.1:5199,http://localhost:5199,http://127.0.0.1:8787,http://localhost:8787"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const localFirestoreSource = localFirestoreMode
  ? await loadLocalFirestoreQuestionSource({
      maxReads: Number(process.env.LOCAL_DB_MAX_QUESTION_READS ?? 1400),
    })
  : undefined;
const localQuestionSource =
  localFirestoreSource ??
  (localSqliteImportMode
    ? await loadLocalSqliteImportQuestionSource({
        dbPath: process.env.GAME_DB_PATH,
      })
    : undefined);
const service = new AuthoritativeGameService({
  dbPath: process.env.GAME_DB_PATH,
  ...(localQuestionSource
    ? {
        localFirestoreQuestionSource: localQuestionSource,
        secret: randomUUID(),
      }
    : {}),
});
let sqliteRefresh = Promise.resolve();
const refreshLocalSqliteQuestionSource = () => {
  if (!localSqliteImportMode) return;
  const refresh = sqliteRefresh.then(async () => {
    service.replaceLocalQuestionSource(
      await loadLocalSqliteImportQuestionSource({
        dbPath: process.env.GAME_DB_PATH,
      }),
    );
  });
  sqliteRefresh = refresh.catch(() => undefined);
  return refresh;
};
const json = async (
  request: import("node:http").IncomingMessage,
): Promise<Record<string, unknown>> => {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
};
const token = (request: import("node:http").IncomingMessage): string =>
  String(request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
const isLoopback = (request: import("node:http").IncomingMessage) =>
  isLoopbackAddress(request.socket.remoteAddress);
const trustedLoopbackHost = (host: string | undefined) => {
  try {
    return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(
      new URL(`http://${host ?? ""}`).hostname,
    );
  } catch {
    return false;
  }
};
const trustedLocalDbRequest = (
  request: import("node:http").IncomingMessage,
) => {
  if (!localImportedSourceMode) return true;
  if (!isLoopback(request) || !trustedLoopbackHost(request.headers.host))
    return false;
  const origin = request.headers.origin;
  return typeof origin === "string"
    ? trustedLocalOrigins.has(origin)
    : request.headers["sec-fetch-site"] === "same-origin";
};
const server = createServer(async (request, response) => {
  try {
    const origin =
      typeof request.headers.origin === "string"
        ? request.headers.origin
        : undefined;
    const privateReadPath =
      /^\/api\/(?:admin\/questions|local-import-review)(?:\/|$)/u.test(
        request.url ?? "",
      );
    if (privateReadPath) {
      if (origin && isTrustedImportReviewRequest(request))
        response.setHeader("access-control-allow-origin", origin);
    } else if (localImportedSourceMode) {
      if (origin && trustedLocalOrigins.has(origin))
        response.setHeader("access-control-allow-origin", origin);
    } else
      response.setHeader(
        "access-control-allow-origin",
        process.env.CORS_ORIGIN ?? "*",
      );
    response.setHeader(
      "access-control-allow-headers",
      "content-type, authorization",
    );
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const parts = url.pathname.split("/").filter(Boolean);
    if (request.method === "GET" && url.pathname === "/health") {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ ok: true }));
      return;
    }
    if (
      isLocalAdminPath(url.pathname) &&
      !isTrustedImportReviewRequest(request)
    )
      throw new Error("LOCAL_ADMIN_REQUEST_REQUIRED");
    if (isLocalAdminPath(url.pathname)) {
      response.removeHeader("access-control-allow-origin");
      response.setHeader("cache-control", "private, no-store");
      response.setHeader("cross-origin-resource-policy", "same-origin");
      response.setHeader("x-content-type-options", "nosniff");
    }
    if (url.pathname.startsWith("/api/local-import-review")) {
      if (!isTrustedImportReviewRequest(request))
        throw new Error("LOCAL_IMPORT_REVIEW_REQUIRED");
      response.setHeader("cache-control", "private, no-store");
      response.setHeader("cross-origin-resource-policy", "same-origin");
      response.setHeader("x-content-type-options", "nosniff");
      if (
        request.method === "GET" &&
        url.pathname === "/api/local-import-review"
      ) {
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(await localImportReviewPage(url)));
        return;
      }
      if (
        request.method === "GET" &&
        parts.length === 4 &&
        parts[2] === "entries"
      ) {
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(await localImportReviewDetail(parts[3])));
        return;
      }
      if (
        request.method === "GET" &&
        parts.length === 5 &&
        parts[2] === "entries" &&
        parts[4] === "media"
      ) {
        const bytes = await readLocalImportReviewMedia(
          parts[3],
          url.searchParams.get("sha") ?? "",
        );
        response.writeHead(200, { "content-type": "image/png" }).end(bytes);
        return;
      }
      response.writeHead(404).end();
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/question-inventory"
    ) {
      if (!trustedLocalDbRequest(request))
        throw new Error("LOCAL_DB_ORIGIN_REQUIRED");
      await refreshLocalSqliteQuestionSource();
      const inventory = service.questionInventory();
      if (!inventory) throw new Error("LOCAL_DB_SOURCE_DISABLED");
      response
        .writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        })
        .end(JSON.stringify(inventory));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/admin/questions") {
      const payload = JSON.stringify(await service.legacyAdminQuestions());
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(payload);
      return;
    }
    if (
      request.method === "GET" &&
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "admin" &&
      parts[2] === "questions"
    ) {
      const question = await service.legacyAdminQuestion(parts[3]);
      if (!question) throw new Error("QUESTION_NOT_FOUND");
      const payload = JSON.stringify(question);
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(payload);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/admin/questions") {
      const payload = JSON.stringify(
        service.saveAdminDraft(await json(request)),
      );
      response
        .writeHead(201, { "content-type": "application/json" })
        .end(payload);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/rooms") {
      if (localImportedSourceMode && !trustedLocalDbRequest(request))
        throw new Error("LOCAL_DB_ORIGIN_REQUIRED");
      await refreshLocalSqliteQuestionSource();
      const body = await json(request);
      const payload = JSON.stringify(
        service.create(
          typeof body.displayName === "string" ? body.displayName : undefined,
          body.demo === true,
          body,
        ),
      );
      response
        .writeHead(201, { "content-type": "application/json" })
        .end(payload);
      return;
    }
    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "rooms" &&
      parts[3] === "join"
    ) {
      const body = await json(request);
      const joined = await service.join(
        parts[2],
        typeof body.displayName === "string" ? body.displayName : undefined,
      );
      broadcast(joined.roomId);
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(joined));
      return;
    }
    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "rooms" &&
      parts[3] === "audience"
    ) {
      if (localImportedSourceMode && !trustedLocalDbRequest(request))
        throw new Error("LOCAL_DB_ORIGIN_REQUIRED");
      const room = service.store.load(parts[2]);
      if (!room) throw new Error("ROOM_NOT_FOUND");
      const payload = JSON.stringify({
        roomId: room.id,
        revision: room.revision,
        token: service.createAudienceCapability(room.id),
      });
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(payload);
      return;
    }
    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "api" &&
      parts[1] === "rooms"
    ) {
      const payload = JSON.stringify(
        service.metadata(parts[2], token(request)),
      );
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(payload);
      return;
    }
    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "rooms" &&
      parts[3] === "intents"
    ) {
      const result = await service.intent(
        parts[2],
        token(request),
        (await json(request)) as never,
      );
      broadcast(parts[2]);
      const payload = JSON.stringify(result);
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(payload);
      return;
    }
    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "rooms" &&
      parts[3] === "current-question-media"
    ) {
      const payload = JSON.stringify(
        service.issueCurrentQuestionMedia(
          parts[2],
          token(request),
          await json(request),
        ),
      );
      response
        .writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        })
        .end(payload);
      return;
    }
    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "api" &&
      parts[1] === "question-media"
    ) {
      const media = await service.readCurrentQuestionMedia(
        parts[2],
        token(request),
      );
      response
        .writeHead(200, {
          "content-type": media.contentType,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        })
        .end(media.bytes);
      return;
    }
    if (
      request.method === "GET" &&
      !url.pathname.startsWith("/api/") &&
      url.pathname !== "/ws"
    ) {
      const dist = join(process.cwd(), "dist");
      const requested = normalize(
        join(dist, url.pathname === "/" ? "index.html" : url.pathname),
      );
      const safe = requested.startsWith(dist)
        ? requested
        : join(dist, "index.html");
      try {
        const file = await stat(safe).then(() => safe);
        const body = await readFile(file);
        const contentType =
          extname(file) === ".js"
            ? "text/javascript"
            : extname(file) === ".css"
              ? "text/css"
              : extname(file) === ".svg"
                ? "image/svg+xml"
                : "text/html";
        response.writeHead(200, { "content-type": contentType }).end(body);
      } catch {
        response
          .writeHead(200, { "content-type": "text/html" })
          .end(await readFile(join(dist, "index.html")));
      }
      return;
    }
    response.writeHead(404).end();
  } catch (error) {
    if (!response.headersSent)
      response
        .writeHead(
          String(error).includes("UNAUTHORIZED") ||
            String(error).includes("FORBIDDEN") ||
            String(error).includes("LOCAL_ONLY_") ||
            String(error).includes("LOCAL_ADMIN_REQUEST_REQUIRED") ||
            String(error).includes("LOCAL_IMPORT_REVIEW_REQUIRED")
            ? 403
            : 400,
          { "content-type": "application/json" },
        )
        .end(
          JSON.stringify({
            error: error instanceof Error ? error.message : "BAD_REQUEST",
          }),
        );
    else response.destroy(error instanceof Error ? error : undefined);
  }
});
const sockets = new WebSocketServer({ noServer: true });
type Connection = {
  ws: import("ws").WebSocket;
  token: string;
  uid: string;
  role: "host" | "player" | "audience";
  lastPong: number;
};
const connections = new Map<string, Set<Connection>>();
const presenceSeen = new Map<string, Map<string, number>>();
const broadcast = (roomId: string) => {
  for (const connection of connections.get(roomId) ?? [])
    if (connection.ws.readyState === connection.ws.OPEN)
      connection.ws.send(
        JSON.stringify(service.metadata(roomId, connection.token)),
      );
};
const presenceSnapshot = (roomId: string, refreshId?: string) => {
  const room = service.store.load(roomId);
  if (!room)
    return {
      type: "presence",
      roomId,
      serverTime: new Date().toISOString(),
      players: {},
    };
  const connected = new Set(
    [...(connections.get(roomId) ?? [])]
      .filter(
        (connection) =>
          connection.role === "player" &&
          connection.ws.readyState === connection.ws.OPEN,
      )
      .map((connection) => connection.uid),
  );
  const seen = presenceSeen.get(roomId) ?? new Map<string, number>();
  return {
    type: "presence" as const,
    roomId,
    serverTime: new Date().toISOString(),
    ...(refreshId ? { refreshId } : {}),
    players: Object.fromEntries(
      room.members
        .filter((member) => member.role === "player")
        .map((member) => [
          member.uid,
          {
            state: connected.has(member.uid)
              ? "connected"
              : seen.has(member.uid)
                ? "disconnected"
                : "unknown",
            ...(seen.has(member.uid)
              ? { lastSeen: new Date(seen.get(member.uid)!).toISOString() }
              : {}),
          },
        ]),
    ),
  };
};
const broadcastPresence = (roomId: string) => {
  const message = JSON.stringify(presenceSnapshot(roomId));
  for (const connection of connections.get(roomId) ?? [])
    if (
      connection.role === "host" &&
      connection.ws.readyState === connection.ws.OPEN
    )
      connection.ws.send(message);
};
const gameTick = setInterval(() => {
  void service.tick().then((ids) => ids.forEach(broadcast));
}, 250);
gameTick.unref();
const presenceTick = setInterval(() => {
  const current = Date.now();
  for (const [roomId, roomConnections] of connections) {
    for (const connection of roomConnections) {
      if (current - connection.lastPong > 45_000) connection.ws.terminate();
      else if (connection.ws.readyState === connection.ws.OPEN)
        connection.ws.ping();
    }
    broadcastPresence(roomId);
  }
}, 15_000);
presenceTick.unref();
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  if (url.pathname !== "/ws") return socket.destroy();
  const roomId = url.searchParams.get("roomId") ?? "";
  const capabilityToken = url.searchParams.get("token") ?? "";
  const capability = service.verify(capabilityToken);
  if (!capability || capability.roomId !== roomId) return socket.destroy();
  let actor: { uid: string; role: "host" | "player" | "audience" };
  try {
    actor = service.presenceActor(roomId, capabilityToken);
  } catch {
    return socket.destroy();
  }
  sockets.handleUpgrade(request, socket, head, (ws) => {
    const connection: Connection = {
      ws,
      token: capabilityToken,
      ...actor,
      lastPong: Date.now(),
    };
    const roomConnections = connections.get(roomId) ?? new Set<Connection>();
    roomConnections.add(connection);
    connections.set(roomId, roomConnections);
    if (actor.role === "player") {
      const seen = presenceSeen.get(roomId) ?? new Map<string, number>();
      seen.set(actor.uid, Date.now());
      presenceSeen.set(roomId, seen);
    }
    ws.send(JSON.stringify(service.metadata(roomId, capabilityToken)));
    if (actor.role === "host")
      ws.send(JSON.stringify(presenceSnapshot(roomId)));
    else broadcastPresence(roomId);
    ws.on("pong", () => {
      connection.lastPong = Date.now();
      if (actor.role === "player")
        presenceSeen.get(roomId)?.set(actor.uid, connection.lastPong);
    });
    ws.on("message", async (raw) => {
      try {
        const message = JSON.parse(String(raw)) as Record<string, unknown>;
        if (message.type === "presence-refresh") {
          if (
            actor.role === "host" &&
            typeof message.refreshId === "string" &&
            message.refreshId.length <= 128
          )
            ws.send(
              JSON.stringify(presenceSnapshot(roomId, message.refreshId)),
            );
          return;
        }
        await service.intent(roomId, capabilityToken, message as never);
        broadcast(roomId);
      } catch (error) {
        ws.send(
          JSON.stringify({
            error: error instanceof Error ? error.message : "BAD_REQUEST",
          }),
        );
      }
    });
    ws.on("close", () => {
      roomConnections.delete(connection);
      if (actor.role === "player")
        presenceSeen.get(roomId)?.set(actor.uid, Date.now());
      if (roomConnections.size === 0) {
        connections.delete(roomId);
        presenceSeen.delete(roomId);
      }
      broadcastPresence(roomId);
    });
  });
});
const port = Number(process.env.PORT ?? 8787);
const host = process.env.GAME_HOST ?? "127.0.0.1";
server.listen(port, host, () =>
  console.log(`Huroof local authority listening on ${host}:${port}`),
);
const close = () => {
  clearInterval(gameTick);
  clearInterval(presenceTick);
  sockets.clients.forEach((client) => client.close());
  connections.clear();
  presenceSeen.clear();
  server.close(() => service.close());
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
