import { Server as HttpServer } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { env } from "../config/env";
import { AuctionEvent } from "../types/enums";

interface AuctionClient extends WebSocket {
  auctionId?: string;
  isAlive?: boolean;
}

let wss: WebSocketServer | null = null;

/**
 * Attaches the realtime auction socket to the HTTP server.
 *
 * Clients connect to `${WS_PATH}?auctionId=<id>` and receive every event for
 * that auction. A client with no auctionId receives nothing but stays connected.
 */
export function initWebSocket(server: HttpServer): WebSocketServer {
  wss = new WebSocketServer({ server, path: env.wsPath });

  wss.on("connection", (socket: AuctionClient, request) => {
    const url = new URL(request.url ?? "", `http://${request.headers.host}`);
    socket.auctionId = url.searchParams.get("auctionId") ?? undefined;
    socket.isAlive = true;

    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("message", (raw) => {
      // The only client->server message supported is re-subscription.
      try {
        const parsed = JSON.parse(raw.toString()) as {
          action?: string;
          auctionId?: string;
        };
        if (parsed.action === "subscribe" && parsed.auctionId) {
          socket.auctionId = parsed.auctionId;
        }
      } catch {
        // ignore malformed frames
      }
    });

    socket.send(
      JSON.stringify({ event: "CONNECTED", data: { auctionId: socket.auctionId } })
    );
  });

  // Drop dead connections so broadcasts don't pile up against stale sockets.
  const heartbeat = setInterval(() => {
    wss?.clients.forEach((client) => {
      const c = client as AuctionClient;
      if (c.isAlive === false) return c.terminate();
      c.isAlive = false;
      c.ping();
    });
  }, 30_000);

  wss.on("close", () => clearInterval(heartbeat));

  console.log(`[ws] listening on ${env.wsPath}`);
  return wss;
}

/** Broadcasts an auction event to every client subscribed to that auction. */
export function broadcast(
  auctionId: string,
  event: AuctionEvent,
  data: unknown
): void {
  if (!wss) return;
  const payload = JSON.stringify({ event, auctionId, data, at: Date.now() });

  wss.clients.forEach((client) => {
    const c = client as AuctionClient;
    if (c.readyState === WebSocket.OPEN && c.auctionId === auctionId) {
      c.send(payload);
    }
  });
}
