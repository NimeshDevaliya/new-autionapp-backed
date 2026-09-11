/**
 * End-to-end verification of the full platform flow against an in-memory MongoDB:
 * login -> tournament -> teams -> players -> auction -> bidding -> sale -> results.
 *
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

let replset: MongoMemoryReplSet;
let server: http.Server;
let baseUrl: string;
let token: string;

interface ApiResult<T = any> {
  status: number;
  body: { success: boolean; message: string; data: T; errors?: unknown };
}

async function api<T = any>(
  method: string,
  path: string,
  body?: unknown,
  auth = true
): Promise<ApiResult<T>> {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json()) as ApiResult["body"];
  return { status: res.status, body: json };
}

before(async () => {
  // transactions need a replica set, which the auction sale path relies on
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replset.getUri();

  await mongoose.connect(uri);

  const { createApp } = await import("../app");
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mongoose.disconnect();
  await replset.stop();
});

describe("Cricket auction platform — full flow", () => {
  const ids: Record<string, string> = {};

  test("rejects login with invalid credentials", async () => {
    const { Admin } = await import("../models/Admin");
    await Admin.create({
      name: "Super Admin",
      email: "admin@test.com",
      password: "Admin@12345",
      role: "SUPER_ADMIN",
    });

    const res = await api("POST", "/auth/login", {
      email: "admin@test.com",
      password: "wrong-password",
    }, false);

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  test("logs in with valid credentials and returns a token", async () => {
    const res = await api("POST", "/auth/login", {
      email: "admin@test.com",
      password: "Admin@12345",
    }, false);

    assert.equal(res.status, 200);
    assert.ok(res.body.data.token);
    assert.equal(res.body.data.admin.email, "admin@test.com");
    // password must never be exposed
    assert.equal((res.body.data.admin as Record<string, unknown>).password, undefined);
    token = res.body.data.token;
  });

  test("rejects protected routes without a token", async () => {
    const res = await api("GET", "/statistics/dashboard", undefined, false);
    assert.equal(res.status, 401);
  });

  test("creates a tournament", async () => {
    const res = await api("POST", "/tournaments", {
      name: "Test Premier League Season 1",
      shortName: "TPL S1",
      seriesName: "Test Premier League",
      seasonName: "Season 1",
      seasonNumber: 1,
      location: "Ahmedabad",
      status: "UPCOMING",
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.name, "Test Premier League Season 1");
    ids.tournament = res.body.data._id;
  });

  test("rejects an invalid tournament payload", async () => {
    const res = await api("POST", "/tournaments", { name: "X" });
    assert.equal(res.status, 422);
    assert.equal(res.body.success, false);
    assert.ok(res.body.errors);
  });

  test("creates teams", async () => {
    const teamA = await api("POST", "/teams", {
      name: "Royal Vikings",
      shortName: "RV",
      ownerName: "Owner A",
      budget: 100,
      maxPlayers: 3,
      minPlayers: 1,
      tournament: ids.tournament,
    });
    const teamB = await api("POST", "/teams", {
      name: "Storm Breakers",
      shortName: "SB",
      ownerName: "Owner B",
      budget: 20,
      maxPlayers: 3,
      minPlayers: 1,
      tournament: ids.tournament,
    });

    assert.equal(teamA.status, 201);
    assert.equal(teamB.status, 201);
    ids.teamA = teamA.body.data._id;
    ids.teamB = teamB.body.data._id;
  });

  test("creates players", async () => {
    const p1 = await api("POST", "/players", {
      fullName: "Arjun Patel",
      role: "BATTER",
      basePrice: 10,
      battingStyle: "Right-hand bat",
    });
    const p2 = await api("POST", "/players", {
      fullName: "Rohan Shah",
      role: "BOWLER",
      basePrice: 5,
      bowlingStyle: "Right-arm fast",
    });

    assert.equal(p1.status, 201);
    assert.equal(p2.status, 201);
    ids.player1 = p1.body.data._id;
    ids.player2 = p2.body.data._id;
  });

  test("creates an auction and queues players", async () => {
    const auction = await api("POST", "/auctions", {
      name: "TPL S1 Auction",
      tournament: ids.tournament,
      maxSquadSize: 3,
      bidIncrementTiers: [
        { threshold: 0, increment: 1 },
        { threshold: 40, increment: 2 },
      ],
    });
    assert.equal(auction.status, 201);
    ids.auction = auction.body.data._id;

    const added = await api("POST", `/auctions/${ids.auction}/players`, {
      players: [{ player: ids.player1 }, { player: ids.player2 }],
    });
    assert.equal(added.status, 201);
    assert.equal(added.body.data.added, 2);
  });

  test("refuses bids before the auction starts", async () => {
    const res = await api("POST", `/auctions/${ids.auction}/bids`, {
      teamId: ids.teamA,
    });
    assert.equal(res.status, 409);
  });

  test("starts the auction and puts a player under the hammer", async () => {
    const start = await api("POST", `/auctions/${ids.auction}/start`);
    assert.equal(start.status, 200);
    assert.equal(start.body.data.status, "LIVE");

    const current = await api("POST", `/auctions/${ids.auction}/current-player`, {});
    assert.equal(current.status, 200);
    assert.ok(current.body.data.auctionPlayer);
    ids.auctionPlayer = current.body.data.auctionPlayer._id;
    // first player queued is player1 (base price 10)
    assert.equal(current.body.data.auctionPlayer.basePrice, 10);
  });

  test("opening bid equals the base price", async () => {
    const state = await api("GET", `/auctions/${ids.auction}/state`);
    assert.equal(state.body.data.nextBid, 10);

    const bid = await api("POST", `/auctions/${ids.auction}/bids`, {
      teamId: ids.teamA,
    });
    assert.equal(bid.status, 200);
    assert.equal(bid.body.data.auctionPlayer.currentBid, 10);
    // next legal bid applies the +1 tier
    assert.equal(bid.body.data.nextBid, 11);
  });

  test("rejects a team outbidding itself", async () => {
    const res = await api("POST", `/auctions/${ids.auction}/bids`, {
      teamId: ids.teamA,
    });
    assert.equal(res.status, 409);
    assert.match(res.body.message, /highest bid/i);
  });

  test("rejects a bid below the next legal amount", async () => {
    const res = await api("POST", `/auctions/${ids.auction}/bids`, {
      teamId: ids.teamB,
      amount: 5,
    });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /at least/i);
  });

  test("rejects a bid beyond the team's remaining budget", async () => {
    // teamB has a purse of 20
    const res = await api("POST", `/auctions/${ids.auction}/bids`, {
      teamId: ids.teamB,
      amount: 50,
    });
    assert.equal(res.status, 409);
    assert.match(res.body.message, /insufficient budget/i);
  });

  test("rejects bids while the auction is paused", async () => {
    await api("POST", `/auctions/${ids.auction}/pause`);

    const res = await api("POST", `/auctions/${ids.auction}/bids`, {
      teamId: ids.teamB,
    });
    assert.equal(res.status, 409);
    assert.match(res.body.message, /paused/i);

    const resume = await api("POST", `/auctions/${ids.auction}/resume`);
    assert.equal(resume.body.data.status, "LIVE");
  });

  test("accepts a competing bid and applies the increment", async () => {
    const res = await api("POST", `/auctions/${ids.auction}/bids`, {
      teamId: ids.teamB,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.auctionPlayer.currentBid, 11);
  });

  test("sells the player, debits the purse and writes the squad", async () => {
    const res = await api("POST", `/auctions/${ids.auction}/sell`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.soldPrice, 11);

    const team = await api("GET", `/teams/${ids.teamB}`);
    assert.equal(team.body.data.spent, 11);
    assert.equal(team.body.data.remainingBudget, 9);
    assert.equal(team.body.data.playersBought, 1);

    const squad = await api("GET", `/teams/${ids.teamB}/squad`);
    assert.equal(squad.body.data.length, 1);
    assert.equal(squad.body.data[0].soldPrice, 11);
  });

  test("marks the next player unsold", async () => {
    const next = await api("POST", `/auctions/${ids.auction}/next-player`);
    assert.equal(next.status, 200);
    assert.ok(next.body.data.auctionPlayer);

    const unsold = await api("POST", `/auctions/${ids.auction}/unsold`);
    assert.equal(unsold.status, 200);
    assert.equal(unsold.body.data.status, "UNSOLD");
  });

  test("completes the auction when the queue is exhausted", async () => {
    const res = await api("POST", `/auctions/${ids.auction}/next-player`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.auction.status, "COMPLETED");
  });

  test("returns auction results with team-wise breakdown", async () => {
    const res = await api("GET", `/auctions/${ids.auction}/results`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.summary.totalSold, 1);
    assert.equal(res.body.data.summary.totalUnsold, 1);
    assert.equal(res.body.data.summary.totalAmount, 11);

    const teamB = res.body.data.teamWise.find(
      (t: any) => t.team._id === ids.teamB
    );
    assert.equal(teamB.playerCount, 1);
    assert.equal(teamB.totalSpent, 11);
  });

  test("reports dashboard statistics", async () => {
    const res = await api("GET", "/statistics/dashboard");
    assert.equal(res.status, 200);
    assert.equal(res.body.data.totalTournaments, 1);
    assert.equal(res.body.data.totalTeams, 2);
    assert.equal(res.body.data.soldPlayers, 1);
    assert.equal(res.body.data.totalAuctionAmount, 11);
  });

  test("supports global search", async () => {
    const res = await api("GET", "/search?q=Arjun", undefined, false);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.players.length, 1);
    assert.equal(res.body.data.players[0].fullName, "Arjun Patel");
  });

  test("paginates and filters the player list", async () => {
    const res = await api("GET", "/players?role=BOWLER&limit=10", undefined, false);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].role, "BOWLER");
  });

  test("returns 404 for unknown routes and ids", async () => {
    const unknownRoute = await api("GET", "/does-not-exist", undefined, false);
    assert.equal(unknownRoute.status, 404);

    const missing = await api(
      "GET",
      "/teams/000000000000000000000000",
      undefined,
      false
    );
    assert.equal(missing.status, 404);
  });

  test("blocks non-super-admins from admin management", async () => {
    const { Admin } = await import("../models/Admin");
    await Admin.create({
      name: "Operator",
      email: "operator@test.com",
      password: "Operator@12345",
      role: "AUCTION_ADMIN",
    });

    const login = await api("POST", "/auth/login", {
      email: "operator@test.com",
      password: "Operator@12345",
    }, false);

    const operatorToken = login.body.data.token;
    const res = await fetch(`${baseUrl}/api/admins`, {
      headers: { Authorization: `Bearer ${operatorToken}` },
    });
    assert.equal(res.status, 403);
  });
});
