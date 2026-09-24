import { Server as HttpServer } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { env } from "../config/env";
import { resolveOwnerToken } from "../middleware/team-auth";
import { Auction } from "../models/Auction";
import { TeamOwner } from "../models/TeamOwner";
import { bidPlacedPayload } from "../services/bid-events";
import { BidError, placeBid } from "../services/auction.service";
import { AUCTION_EVENTS, AuctionEvent } from "../types/enums";
import { ApiError } from "../utils/ApiError";

interface AuctionClient extends WebSocket {
  auctionId?: string;
  isAlive?: boolean;
  /** Set once the socket proves it belongs to a team owner. */
  owner?: { id: string; teamId: string; name: string };
  bidInFlight?: boolean;
}

interface ClientMessage {
  action?: string;
  auctionId?: unknown;
  token?: unknown;
  auctionPlayerId?: unknown;
  amount?: unknown;
}

/** Replies that go to one socket only (never broadcast). */
type SocketReply = "AUTHED" | "AUTH_FAILED" | "BID_ACCEPTED" | "BID_REJECTED";

let wss: WebSocketServer | null = null;

function reply(socket: AuctionClient, event: SocketReply, data: unknown) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ event, data, at: Date.now() }));
}

async function handleAuth(socket: AuctionClient, msg: ClientMessage) {
  const owner = typeof msg.token === "string" ? await resolveOwnerToken(msg.token) : null;
  if (!owner) {
    socket.owner = undefined;
    return reply(socket, "AUTH_FAILED", { message: "Invalid or expired team session" });
  }
  socket.owner = { id: owner.id, teamId: owner.teamId, name: owner.name };
  reply(socket, "AUTHED", { teamId: owner.teamId });
}

async function handleBid(socket: AuctionClient, msg: ClientMessage) {
  const auctionPlayerId = typeof msg.auctionPlayerId === "string" ? msg.auctionPlayerId : "";
  const rejected = (code: string, message: string, nextBid?: number) =>
    reply(socket, "BID_REJECTED", { code, message, nextBid, auctionPlayerId });

  if (!socket.owner) return rejected("NOT_AUTHED", "Sign in as a team owner to bid");
  if (!socket.auctionId) return rejected("NO_AUCTION", "This socket is not following an auction");
  if (typeof msg.amount !== "number" || !Number.isFinite(msg.amount)) {
    return rejected("INVALID_AMOUNT", "Bid amount must be a number");
  }
  if (socket.bidInFlight) {
    return rejected("RATE_LIMITED", "Your previous bid is still being placed");
  }

  socket.bidInFlight = true;
  try {
    // an owner deactivated mid-auction loses the right to bid immediately
    const stillActive = await TeamOwner.exists({ _id: socket.owner.id, status: "ACTIVE" });
    if (!stillActive) {
      socket.owner = undefined;
      return rejected("NOT_AUTHED", "Your team account has been deactivated");
    }

    // the client names the lot it saw, so a tap that arrives after Sell/Next is refused
    const auction = await Auction.findById(socket.auctionId)
      .select("currentAuctionPlayer")
      .lean();
    if (!auction || String(auction.currentAuctionPlayer ?? "") !== auctionPlayerId) {
      return rejected("NO_CURRENT_PLAYER", "That player is no longer under the hammer");
    }

    const result = await placeBid({
      auctionId: socket.auctionId,
      teamId: socket.owner.teamId,
      amount: msg.amount,
      exact: true,
      source: "TEAM",
      placedByOwner: socket.owner.id,
    });

    reply(socket, "BID_ACCEPTED", {
      bidId: result.bid._id,
      amount: result.bid.amount,
      auctionPlayerId,
    });
    broadcast(socket.auctionId, AUCTION_EVENTS.BID_PLACED, bidPlacedPayload(result));
  } catch (err) {
    if (err instanceof BidError) return rejected(err.code, err.message, err.nextBid);
    if (err instanceof ApiError) return rejected("REJECTED", err.message);
    console.error("[ws] bid failed", err);
    rejected("ERROR", "Could not place the bid. Please try again.");
  } finally {
    socket.bidInFlight = false;
  }
}

/**
 * Attaches the realtime auction socket to the HTTP server.
 *
 * Clients connect to `${WS_PATH}?auctionId=<id>` and receive every event for
 * that auction. Team owners additionally send `{action:"auth", token}` and then
 * `{action:"bid", auctionPlayerId, amount}`; replies go back on the same socket.
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
      let parsed: ClientMessage;
      try {
        parsed = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return; // ignore malformed frames
      }
      if (parsed.action === "subscribe" && typeof parsed.auctionId === "string") {
        socket.auctionId = parsed.auctionId;
      } else if (parsed.action === "auth") {
        void handleAuth(socket, parsed);
      } else if (parsed.action === "bid") {
        void handleBid(socket, parsed);
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
export function broadcast(auctionId: string, event: AuctionEvent, data: unknown): void {
  if (!wss) return;
  const payload = JSON.stringify({ event, auctionId, data, at: Date.now() });

  wss.clients.forEach((client) => {
    const c = client as AuctionClient;
    if (c.readyState === WebSocket.OPEN && c.auctionId === auctionId) {
      c.send(payload);
    }
  });
}
