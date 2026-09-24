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

process.env.JWT_SECRET ??= "test-secret-value-for-local-testing-only";
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/placeholder";
process.env.CORS_ORIGINS ??= "http://localhost:3000";
process.env.WS_PATH ??= "/ws";

let replset: MongoMemoryReplSet;
let server: http.Server;
let wss: import("ws").WebSocketServer;
let baseUrl: string;
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
});

after(async () => {
  // the socket server's heartbeat interval would otherwise keep the runner alive
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mongoose.disconnect();
  await replset.stop();
});

/** ids shared across the ordered tests below */
const ids: Record<string, string> = {};
const ownerTokens: Record<string, string> = {};

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
