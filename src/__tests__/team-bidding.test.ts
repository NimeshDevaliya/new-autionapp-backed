/**
 * Team-owner accounts, owner auth, atomic bidding and the socket bid protocol.
 * Run with:  npm test
 */
import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";
import http from "http";
import { AddressInfo } from "net";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { WebSocket } from "ws";

process.env.JWT_SECRET ??= "test-secret-value-for-local-testing-only";
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/placeholder";
process.env.CORS_ORIGINS ??= "http://localhost:3000";
process.env.WS_PATH ??= "/ws";

let replset: MongoMemoryReplSet;
let server: http.Server;
let wss: import("ws").WebSocketServer;
let baseUrl: string;
let wsUrl: string;
let adminToken: string;

interface ApiResult<T = any> {
  status: number;
  body: { success: boolean; message: string; data: T; errors?: unknown };
}

async function api<T = any>(
  method: string,
  path: string,
  body?: unknown,
  token: string | null = adminToken
): Promise<ApiResult<T>> {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.json()) as ApiResult["body"] };
}

before(async () => {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replset.getUri());

  const { createApp } = await import("../app");
  const { initWebSocket } = await import("../sockets");
  server = http.createServer(createApp());
  wss = initWebSocket(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
});

after(async () => {
  // the socket server's heartbeat interval and any client left open by a failed
  // test would otherwise keep the runner alive
  wss.clients.forEach((client) => client.terminate());
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mongoose.disconnect();
  await replset.stop();
});

/** ids shared across the ordered tests below */
const ids: Record<string, string> = {};
const ownerTokens: Record<string, string> = {};

interface SocketMsg {
  event: string;
  data: Record<string, any>;
  auctionId?: string;
}
interface TestSocket {
  ws: WebSocket;
  send(msg: unknown): void;
  /** next message whose event is one of `events`, dropping others (broadcasts) in between */
  until(events: string | string[], timeoutMs?: number): Promise<SocketMsg>;
  close(): void;
}

function connectSocket(auctionId: string): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsUrl}?auctionId=${auctionId}`);
    const queue: SocketMsg[] = [];
    let waiter: ((m: SocketMsg) => void) | null = null;
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as SocketMsg;
      if (waiter) {
        const w = waiter;
        waiter = null;
        w(msg);
      } else {
        queue.push(msg);
      }
    });
    const next = () =>
      queue.length
        ? Promise.resolve(queue.shift()!)
        : new Promise<SocketMsg>((r) => {
            waiter = r;
          });
    ws.on("error", reject);
    ws.on("open", () =>
      resolve({
        ws,
        send: (msg) => ws.send(JSON.stringify(msg)),
        async until(events, timeoutMs = 3000) {
          // one waiter slot per socket: never call until() twice concurrently on
          // the same socket — pass several events instead
          const wanted = Array.isArray(events) ? events : [events];
          const deadline = Date.now() + timeoutMs;
          for (;;) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new Error(`timed out waiting for ${wanted.join("|")}`);
            const msg = await Promise.race([
              next(),
              new Promise<never>((_, rej) =>
                setTimeout(
                  () => rej(new Error(`timed out waiting for ${wanted.join("|")}`)),
                  remaining
                )
              ),
            ]);
            if (wanted.includes(msg.event)) return msg;
          }
        },
        close: () => ws.close(),
      })
    );
  });
}

async function authedSocket(teamKey: string): Promise<TestSocket> {
  const s = await connectSocket(ids.auction);
  await s.until("CONNECTED");
  s.send({ action: "auth", token: ownerTokens[teamKey] });
  const reply = await s.until("AUTHED");
  assert.equal(reply.data.teamId, ids[teamKey]);
  return s;
}

describe("Team bidding — setup", () => {
  test("admin logs in and builds a live auction with four teams", async () => {
    const { Admin } = await import("../models/Admin");
    await Admin.create({
      name: "Super Admin",
      email: "admin@test.com",
      password: "Admin@12345",
      role: "SUPER_ADMIN",
    });
    const login = await api("POST", "/auth/login", {
      email: "admin@test.com",
      password: "Admin@12345",
    }, null);
    assert.equal(login.status, 200);
    adminToken = login.body.data.token;

    const t = await api("POST", "/tournaments", {
      name: "Test Premier League Season 1",
      shortName: "TPL S1",
      seriesName: "Test Premier League",
      seasonName: "Season 1",
      seasonNumber: 1,
      location: "Ahmedabad",
      status: "ONGOING",
    });
    assert.equal(t.status, 201, t.body.message);
    ids.tournament = t.body.data._id;

    // B is deliberately poor (purse 11) so an over-budget bid is easy to provoke
    const teams: Array<[string, string, number]> = [
      ["teamA", "Royal Vikings", 100],
      ["teamB", "Storm Breakers", 11],
      ["teamC", "Golden Chargers", 100],
      ["teamD", "Knight Hawks", 100],
    ];
    for (const [key, name, budget] of teams) {
      const res = await api("POST", "/teams", {
        name,
        shortName: key.slice(-1),
        budget,
        maxPlayers: 3,
        minPlayers: 1,
        tournament: ids.tournament,
      });
      assert.equal(res.status, 201, `${name}: ${res.body.message}`);
      ids[key] = res.body.data._id;
    }

    const p1 = await api("POST", "/players", { fullName: "Arjun Patel", role: "BATTER", basePrice: 10 });
    const p2 = await api("POST", "/players", { fullName: "Rohan Shah", role: "BOWLER", basePrice: 5 });
    assert.equal(p1.status, 201, p1.body.message);
    assert.equal(p2.status, 201, p2.body.message);
    ids.player1 = p1.body.data._id;
    ids.player2 = p2.body.data._id;

    const auction = await api("POST", "/auctions", {
      name: "TPL S1 Auction",
      tournament: ids.tournament,
      maxSquadSize: 3,
      bidIncrementTiers: [{ threshold: 0, increment: 1 }, { threshold: 40, increment: 2 }],
    });
    assert.equal(auction.status, 201, auction.body.message);
    ids.auction = auction.body.data._id;
    const added = await api("POST", `/auctions/${ids.auction}/players`, {
      players: [{ player: ids.player1 }, { player: ids.player2 }],
    });
    assert.equal(added.status, 201, added.body.message);
    const start = await api("POST", `/auctions/${ids.auction}/start`);
    assert.equal(start.status, 200, start.body.message);
    const current = await api("POST", `/auctions/${ids.auction}/current-player`, {});
    assert.equal(current.status, 200, current.body.message);
    ids.auctionPlayer = current.body.data.auctionPlayer._id;
    assert.equal(current.body.data.auctionPlayer.basePrice, 10);
  });

  test("creates one owner per team directly on the model", async () => {
    const { TeamOwner } = await import("../models/TeamOwner");
    for (const key of ["teamA", "teamB", "teamC", "teamD"]) {
      const owner = await TeamOwner.create({
        name: `${key} owner`,
        email: `${key.toLowerCase()}@test.com`,
        password: "Owner@12345",
        team: ids[key],
      });
      ids[`${key}Owner`] = owner._id.toString();
      // the hash must never be returned by toJSON
      assert.equal((owner.toJSON() as Record<string, unknown>).password, undefined);
    }
  });
});

describe("Team bidding — owner auth", () => {
  test("rejects a wrong owner password with the same message as an unknown email", async () => {
    const res = await api("POST", "/team-auth/login", {
      email: "teama@test.com",
      password: "nope",
    }, null);
    assert.equal(res.status, 401);
    assert.equal(res.body.message, "Invalid email or password");
  });

  test("owner login returns a token and the team", async () => {
    for (const key of ["teamA", "teamB", "teamC", "teamD"]) {
      const res = await api("POST", "/team-auth/login", {
        email: `${key.toLowerCase()}@test.com`,
        password: "Owner@12345",
      }, null);
      assert.equal(res.status, 200, res.body.message);
      assert.ok(res.body.data.token);
      assert.equal(res.body.data.team._id, ids[key]);
      assert.equal(res.body.data.owner.email, `${key.toLowerCase()}@test.com`);
      ownerTokens[key] = res.body.data.token;
    }
  });

  test("/team-auth/me returns owner, team with purse and the current auction", async () => {
    const res = await api("GET", "/team-auth/me", undefined, ownerTokens.teamA);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.team._id, ids.teamA);
    assert.equal(res.body.data.team.remainingBudget, 100);
    assert.equal(res.body.data.team.squadCount, 0);
    assert.equal(res.body.data.auction._id, ids.auction);
    assert.equal(res.body.data.auction.status, "LIVE");
  });

  test("owner tokens are refused by admin routes", async () => {
    const dashboard = await api("GET", "/statistics/dashboard", undefined, ownerTokens.teamA);
    assert.equal(dashboard.status, 401);
    const bid = await api("POST", `/auctions/${ids.auction}/bids`, { teamId: ids.teamA }, ownerTokens.teamA);
    assert.equal(bid.status, 401);
  });

  test("admin tokens are refused by owner routes", async () => {
    const res = await api("GET", "/team-auth/me", undefined, adminToken);
    assert.equal(res.status, 401);
  });
});

describe("Team bidding — admin manages owners", () => {
  test("lists a team's owners without passwords", async () => {
    const res = await api("GET", `/teams/${ids.teamA}/owners`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].email, "teama@test.com");
    assert.equal(res.body.data[0].password, undefined);
  });

  test("requires an admin token", async () => {
    const res = await api("GET", `/teams/${ids.teamA}/owners`, undefined, ownerTokens.teamA);
    assert.equal(res.status, 401);
  });

  test("creates, renames, resets the password of and deletes an owner", async () => {
    const created = await api("POST", `/teams/${ids.teamA}/owners`, {
      name: "Temp Owner",
      email: "temp@test.com",
      password: "Temp@12345",
    });
    assert.equal(created.status, 201, created.body.message);
    const ownerId = created.body.data._id;

    const dup = await api("POST", `/teams/${ids.teamB}/owners`, {
      name: "Dup",
      email: "temp@test.com",
      password: "Temp@12345",
    });
    assert.equal(dup.status, 409);

    const short = await api("POST", `/teams/${ids.teamA}/owners`, {
      name: "X",
      email: "bad",
      password: "123",
    });
    assert.equal(short.status, 422);

    const renamed = await api("PATCH", `/teams/${ids.teamA}/owners/${ownerId}`, {
      name: "Temp Renamed",
      password: "Fresh@12345",
    });
    assert.equal(renamed.status, 200, renamed.body.message);
    assert.equal(renamed.body.data.name, "Temp Renamed");

    const login = await api("POST", "/team-auth/login", {
      email: "temp@test.com",
      password: "Fresh@12345",
    }, null);
    assert.equal(login.status, 200);

    // an owner is scoped to its team — the wrong team id is a 404
    const wrongTeam = await api("DELETE", `/teams/${ids.teamB}/owners/${ownerId}`);
    assert.equal(wrongTeam.status, 404);

    const removed = await api("DELETE", `/teams/${ids.teamA}/owners/${ownerId}`);
    assert.equal(removed.status, 200);
    const list = await api("GET", `/teams/${ids.teamA}/owners`);
    assert.equal(list.body.data.length, 1);
  });
});

describe("Team bidding — atomic placeBid", () => {
  test("two teams bidding at the same instant produce exactly one accepted bid", async () => {
    const { placeBid, BidError } = await import("../services/auction.service");
    const { Bid } = await import("../models/Bid");

    // both see nextBid = 10 (opening bid) and fire together
    const results = await Promise.allSettled([
      placeBid({ auctionId: ids.auction, teamId: ids.teamA, amount: 10, exact: true, source: "TEAM" }),
      placeBid({ auctionId: ids.auction, teamId: ids.teamC, amount: 10, exact: true, source: "TEAM" }),
    ]);

    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    assert.equal(won.length, 1, JSON.stringify(results.map((r) => r.status)));
    assert.equal(lost.length, 1);

    const winner = (won[0] as PromiseFulfilledResult<any>).value;
    assert.equal(winner.auctionPlayer.currentBid, 10);
    assert.equal(winner.nextBid, 11);
    assert.equal(winner.bid.source, "TEAM");
    ids.raceWinner = String(winner.team._id);

    const err = (lost[0] as PromiseRejectedResult).reason;
    assert.ok(err instanceof BidError, `expected BidError, got ${err}`);
    assert.equal(err.code, "OUTBID");
    assert.equal(err.nextBid, 11);

    assert.equal(await Bid.countDocuments({ auctionPlayer: ids.auctionPlayer }), 1);
  });

  test("exact mode rejects an amount above the next bid as stale", async () => {
    const { placeBid, BidError } = await import("../services/auction.service");
    const loser = ids.raceWinner === ids.teamA ? ids.teamC : ids.teamA;
    await assert.rejects(
      placeBid({ auctionId: ids.auction, teamId: loser, amount: 13, exact: true }),
      (err: unknown) =>
        err instanceof BidError && err.code === "STALE_AMOUNT" && err.nextBid === 11
    );
  });

  test("console REST bids still work and are tagged CONSOLE", async () => {
    const loser = ids.raceWinner === ids.teamA ? ids.teamC : ids.teamA;
    // REST keeps allowing a jump above nextBid (no exact mode)
    const res = await api("POST", `/auctions/${ids.auction}/bids`, { teamId: loser, amount: 12 });
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.data.auctionPlayer.currentBid, 12);
    assert.equal(res.body.data.nextBid, 13);
    assert.equal(res.body.data.bid.source, "CONSOLE");
    ids.consoleLeader = loser;
  });
});

describe("Team bidding — socket protocol", () => {
  const sockets: TestSocket[] = [];
  after(() => sockets.forEach((s) => s.close()));

  test("an unauthenticated socket cannot bid", async () => {
    const viewer = await connectSocket(ids.auction);
    sockets.push(viewer);
    await viewer.until("CONNECTED");
    viewer.send({ action: "bid", auctionPlayerId: ids.auctionPlayer, amount: 13 });
    const reply = await viewer.until("BID_REJECTED");
    assert.equal(reply.data.code, "NOT_AUTHED");
  });

  test("auth fails for garbage and for admin tokens, succeeds for an owner token", async () => {
    const s = await connectSocket(ids.auction);
    sockets.push(s);
    await s.until("CONNECTED");
    s.send({ action: "auth", token: "not-a-token" });
    assert.equal((await s.until("AUTH_FAILED")).data.message, "Invalid or expired team session");
    s.send({ action: "auth", token: adminToken });
    await s.until("AUTH_FAILED");
    s.send({ action: "auth", token: ownerTokens.teamB });
    assert.equal((await s.until("AUTHED")).data.teamId, ids.teamB);
  });

  test("an authed owner bids the exact next amount; everyone gets BID_PLACED", async () => {
    // state from Task 3: consoleLeader holds 12, nextBid 13. B has purse 11 → can't; use D.
    const viewer = await connectSocket(ids.auction);
    const d = await authedSocket("teamD");
    sockets.push(viewer, d);
    await viewer.until("CONNECTED");

    d.send({ action: "bid", auctionPlayerId: ids.auctionPlayer, amount: 13 });
    const accepted = await d.until("BID_ACCEPTED");
    assert.equal(accepted.data.amount, 13);
    assert.equal(accepted.data.auctionPlayerId, ids.auctionPlayer);

    const placed = await viewer.until("BID_PLACED");
    assert.equal(placed.data.currentBid, 13);
    assert.equal(placed.data.nextBid, 14);
    assert.equal(placed.data.team._id, ids.teamD);
    assert.equal(placed.data.source, "TEAM");

    const { Bid } = await import("../models/Bid");
    const row = await Bid.findById(accepted.data.bidId);
    assert.equal(row?.source, "TEAM");
    assert.equal(String(row?.placedByOwner), ids.teamDOwner);

    // team id comes from the token: bidding again is "already highest", not a second bid
    d.send({ action: "bid", auctionPlayerId: ids.auctionPlayer, amount: 14 });
    assert.equal((await d.until("BID_REJECTED")).data.code, "ALREADY_HIGHEST");
  });

  test("stale amounts, wrong player, pause and over-budget are rejected with codes", async () => {
    const a = await authedSocket("teamA");
    const b = await authedSocket("teamB");
    sockets.push(a, b);

    a.send({ action: "bid", auctionPlayerId: ids.auctionPlayer, amount: 13 }); // old amount
    let r = await a.until("BID_REJECTED");
    assert.equal(r.data.code, "OUTBID");
    assert.equal(r.data.nextBid, 14);

    a.send({ action: "bid", auctionPlayerId: ids.auctionPlayer, amount: 20 }); // too high
    r = await a.until("BID_REJECTED");
    assert.equal(r.data.code, "STALE_AMOUNT");
    assert.equal(r.data.nextBid, 14);

    a.send({ action: "bid", auctionPlayerId: ids.player2, amount: 14 }); // not the current lot
    r = await a.until("BID_REJECTED");
    assert.equal(r.data.code, "NO_CURRENT_PLAYER");

    a.send({ action: "bid", auctionPlayerId: ids.auctionPlayer, amount: "14" }); // wrong type
    r = await a.until("BID_REJECTED");
    assert.equal(r.data.code, "INVALID_AMOUNT");

    await api("POST", `/auctions/${ids.auction}/pause`);
    a.send({ action: "bid", auctionPlayerId: ids.auctionPlayer, amount: 14 });
    r = await a.until("BID_REJECTED");
    assert.equal(r.data.code, "PAUSED");
    await api("POST", `/auctions/${ids.auction}/resume`);

    b.send({ action: "bid", auctionPlayerId: ids.auctionPlayer, amount: 14 }); // purse is 11
    r = await b.until("BID_REJECTED");
    assert.equal(r.data.code, "OVER_BUDGET");
  });

  test("a deactivated owner's live socket can no longer bid", async () => {
    const c = await authedSocket("teamC");
    sockets.push(c);
    const off = await api("PATCH", `/teams/${ids.teamC}/owners/${ids.teamCOwner}`, {
      status: "INACTIVE",
    });
    assert.equal(off.status, 200);

    c.send({ action: "bid", auctionPlayerId: ids.auctionPlayer, amount: 14 });
    assert.equal((await c.until("BID_REJECTED")).data.code, "NOT_AUTHED");

    await api("PATCH", `/teams/${ids.teamC}/owners/${ids.teamCOwner}`, { status: "ACTIVE" });
  });

  test("two owners tapping together: one BID_ACCEPTED, one OUTBID, one Bid row", async () => {
    const a = await authedSocket("teamA");
    const c = await authedSocket("teamC");
    sockets.push(a, c);
    const { Bid } = await import("../models/Bid");
    const before = await Bid.countDocuments({ auctionPlayer: ids.auctionPlayer });

    a.send({ action: "bid", auctionPlayerId: ids.auctionPlayer, amount: 14 });
    c.send({ action: "bid", auctionPlayerId: ids.auctionPlayer, amount: 14 });

    const replies = await Promise.all([
      a.until(["BID_ACCEPTED", "BID_REJECTED"]),
      c.until(["BID_ACCEPTED", "BID_REJECTED"]),
    ]);
    const events = replies.map((r) => r.event).sort();
    assert.deepEqual(events, ["BID_ACCEPTED", "BID_REJECTED"]);
    const rejected = replies.find((r) => r.event === "BID_REJECTED")!;
    assert.equal(rejected.data.code, "OUTBID");
    assert.equal(rejected.data.nextBid, 15);
    assert.equal(await Bid.countDocuments({ auctionPlayer: ids.auctionPlayer }), before + 1);
  });

  test("the sale still broadcasts and stops further bids", async () => {
    const viewer = await connectSocket(ids.auction);
    const d = await authedSocket("teamD");
    sockets.push(viewer, d);
    await viewer.until("CONNECTED");
    const sold = await api("POST", `/auctions/${ids.auction}/sell`);
    assert.equal(sold.status, 200, sold.body.message);
    assert.equal(sold.body.data.soldPrice, 14);
    await viewer.until("PLAYER_SOLD");

    d.send({ action: "bid", auctionPlayerId: ids.auctionPlayer, amount: 15 });
    assert.equal((await d.until("BID_REJECTED")).data.code, "NO_CURRENT_PLAYER");
  });
});
