import mongoose from "mongoose";
import { Admin } from "../models/Admin";
import { Tournament } from "../models/Tournament";
import { Team } from "../models/Team";
import { Player } from "../models/Player";
import { Auction } from "../models/Auction";
import { AuctionPlayer } from "../models/AuctionPlayer";
import { Bid } from "../models/Bid";
import { TeamSquad } from "../models/TeamSquad";
import { Match } from "../models/Match";
import { Innings } from "../models/Innings";
import { BattingScore } from "../models/BattingScore";
import { BowlingFigure } from "../models/BowlingFigure";
import { PlayerRole } from "../types/enums";

const TEAM_SEED = [
  { name: "Royal Vikings", shortName: "RV", ownerName: "A. Mehta", color: "#0754cf" },
  { name: "Storm Breakers", shortName: "SB", ownerName: "R. Shah", color: "#c80000" },
  { name: "Western Giants", shortName: "WG", ownerName: "N. Patel", color: "#f59d39" },
  { name: "Knight Hunters", shortName: "KH", ownerName: "S. Desai", color: "#46acdc" },
  { name: "Alpha Legends", shortName: "AL", ownerName: "V. Joshi", color: "#fbd12f" },
];

const FIRST_NAMES = [
  "Arjun", "Rohan", "Kunal", "Manish", "Vivek", "Harsh", "Nikhil", "Parth",
  "Dhruv", "Yash", "Karan", "Raj", "Aditya", "Siddharth", "Mihir", "Tejas",
  "Jay", "Chirag", "Sameer", "Ankit", "Rahul", "Varun", "Neel", "Kartik",
  "Pranav", "Devansh", "Ishan", "Om",
];
const LAST_NAMES = [
  "Patel", "Shah", "Desai", "Mehta", "Joshi", "Trivedi", "Chauhan", "Solanki",
  "Rana", "Bhatt", "Parmar", "Vyas", "Gandhi", "Modi",
];

const ROLES: PlayerRole[] = ["BATTER", "BOWLER", "ALL_ROUNDER", "WICKET_KEEPER"];
const BATTING_STYLES = ["Right-hand bat", "Left-hand bat"];
const BOWLING_STYLES = [
  "Right-arm fast",
  "Right-arm medium",
  "Left-arm medium",
  "Right-arm off-break",
  "Left-arm orthodox",
];

/** Deterministic pseudo-random so reseeding produces comparable data. */
function seededRandom(seed: number) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

const rand = seededRandom(42);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const randInt = (min: number, max: number) =>
  Math.floor(rand() * (max - min + 1)) + min;

/**
 * Populates a database with demo league data.
 *
 * Existing data is left alone unless `force` is set, so this can never quietly
 * overwrite real records.
 */
export async function runSeed({ force = false }: { force?: boolean } = {}) {
  const existingAdmins = await Admin.countDocuments();
  const existingPlayers = await Player.countDocuments();

  if ((existingAdmins > 0 || existingPlayers > 0) && !force) {
    console.log(
      "\nDatabase already contains data. Re-run with --force to wipe and reseed.\n" +
        `  admins: ${existingAdmins}, players: ${existingPlayers}\n`
    );
    return;
  }

  if (force) {
    console.log("[seed] --force: clearing existing collections");
    await Promise.all([
      Admin.deleteMany({}),
      Tournament.deleteMany({}),
      Team.deleteMany({}),
      Player.deleteMany({}),
      Auction.deleteMany({}),
      AuctionPlayer.deleteMany({}),
      Bid.deleteMany({}),
      TeamSquad.deleteMany({}),
      Match.deleteMany({}),
      Innings.deleteMany({}),
      BattingScore.deleteMany({}),
      BowlingFigure.deleteMany({}),
    ]);
  }

  /* ------------------------------------------------------------- admins -- */
  const superAdmin = await Admin.create({
    name: "Super Admin",
    email: "admin@medianv.com",
    password: "Admin@12345",
    role: "SUPER_ADMIN",
    status: "ACTIVE",
  });

  await Admin.create({
    name: "Auction Operator",
    email: "operator@medianv.com",
    password: "Operator@12345",
    role: "AUCTION_ADMIN",
    status: "ACTIVE",
  });
  console.log("[seed] admins created");

  /* -------------------------------------------------------- tournaments -- */
  const series = "MedianV Premier League";

  const pastTournament = await Tournament.create({
    name: `${series} Season 3`,
    shortName: "MPL S3",
    seriesName: series,
    seasonName: "Season 3",
    seasonNumber: 3,
    startDate: new Date("2025-09-09"),
    endDate: new Date("2026-01-29"),
    location: "Ahmedabad",
    status: "COMPLETED",
    description: "Third season of the MedianV Premier League.",
    createdBy: superAdmin._id,
  });

  const currentTournament = await Tournament.create({
    name: `${series} Season 4`,
    shortName: "MPL S4",
    seriesName: series,
    seasonName: "Season 4",
    seasonNumber: 4,
    startDate: new Date("2026-05-06"),
    endDate: new Date("2027-03-31"),
    location: "Ahmedabad",
    status: "ONGOING",
    description: "The ongoing fourth season of the MedianV Premier League.",
    createdBy: superAdmin._id,
  });
  console.log("[seed] tournaments created");

  /* --------------------------------------------------------------- teams -- */
  const teams = await Team.create(
    TEAM_SEED.map((team) => ({
      ...team,
      budget: 120,
      spent: 0,
      maxPlayers: 11,
      minPlayers: 7,
      status: "ACTIVE",
      tournament: currentTournament._id,
      createdBy: superAdmin._id,
    }))
  );

  const pastTeams = await Team.create(
    TEAM_SEED.slice(0, 4).map((team) => ({
      ...team,
      budget: 100,
      spent: 0,
      maxPlayers: 11,
      minPlayers: 7,
      status: "ACTIVE",
      tournament: pastTournament._id,
      createdBy: superAdmin._id,
    }))
  );
  console.log(`[seed] ${teams.length + pastTeams.length} teams created`);

  /* ------------------------------------------------------------- players -- */
  const usedNames = new Set<string>();
  const playerDocs = [];

  for (let i = 0; i < 32; i += 1) {
    let fullName = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    let guard = 0;
    while (usedNames.has(fullName) && guard < 50) {
      fullName = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
      guard += 1;
    }
    usedNames.add(fullName);

    const role = ROLES[i % ROLES.length];
    playerDocs.push({
      fullName,
      role,
      category: rand() > 0.85 ? "INTERNATIONAL" : "LOCAL",
      battingStyle: pick(BATTING_STYLES),
      bowlingStyle: role === "BATTER" ? undefined : pick(BOWLING_STYLES),
      basePrice: [2, 4, 6, 8, 10][randInt(0, 4)],
      dateOfBirth: new Date(randInt(1990, 2004), randInt(0, 11), randInt(1, 28)),
      isActive: true,
      createdBy: superAdmin._id,
    });
  }

  const players = await Player.create(playerDocs);
  console.log(`[seed] ${players.length} players created`);

  /* ------------------------------------------------------------ auctions -- */
  const auction = await Auction.create({
    name: `${series} Season 4 Auction`,
    tournament: currentTournament._id,
    status: "DRAFT",
    bidIncrementTiers: [
      { threshold: 0, increment: 1 },
      { threshold: 40, increment: 2 },
    ],
    maxSquadSize: 11,
    minSquadSize: 7,
    timerSeconds: 30,
    createdBy: superAdmin._id,
  });

  // queue every player for the live auction
  await AuctionPlayer.insertMany(
    players.map((player, index) => ({
      auction: auction._id,
      player: player._id,
      basePrice: player.basePrice,
      order: index + 1,
      status: "PENDING",
    }))
  );
  console.log(`[seed] auction created with ${players.length} players queued`);

  /* ------------------------- completed past auction, squads and results -- */
  const pastAuction = await Auction.create({
    name: `${series} Season 3 Auction`,
    tournament: pastTournament._id,
    status: "COMPLETED",
    bidIncrementTiers: [
      { threshold: 0, increment: 1 },
      { threshold: 40, increment: 2 },
    ],
    maxSquadSize: 11,
    minSquadSize: 7,
    startedAt: new Date("2025-09-01"),
    completedAt: new Date("2025-09-02"),
    createdBy: superAdmin._id,
  });

  // sell the first 24 players across the four past-season teams
  const soldPlayers = players.slice(0, 24);
  const squadEntries = [];
  const auctionPlayerEntries = [];
  const bidEntries = [];
  const teamSpend = new Map<string, number>();

  for (let i = 0; i < soldPlayers.length; i += 1) {
    const player = soldPlayers[i];
    const team = pastTeams[i % pastTeams.length];
    const soldPrice = player.basePrice + randInt(0, 6);

    const auctionPlayerId = new mongoose.Types.ObjectId();
    auctionPlayerEntries.push({
      _id: auctionPlayerId,
      auction: pastAuction._id,
      player: player._id,
      basePrice: player.basePrice,
      currentBid: soldPrice,
      status: "SOLD",
      soldPrice,
      soldToTeam: team._id,
      order: i + 1,
      soldAt: new Date("2025-09-02"),
    });

    // a couple of bids of history leading to the sale
    let running = player.basePrice;
    bidEntries.push({
      auction: pastAuction._id,
      auctionPlayer: auctionPlayerId,
      team: pastTeams[(i + 1) % pastTeams.length]._id,
      amount: running,
      placedBy: superAdmin._id,
    });
    while (running < soldPrice) {
      running += running >= 40 ? 2 : 1;
      bidEntries.push({
        auction: pastAuction._id,
        auctionPlayer: auctionPlayerId,
        team: team._id,
        amount: Math.min(running, soldPrice),
        placedBy: superAdmin._id,
      });
    }

    squadEntries.push({
      tournament: pastTournament._id,
      team: team._id,
      player: player._id,
      basePrice: player.basePrice,
      soldPrice,
      acquisitionType: "AUCTION",
      auction: pastAuction._id,
      isCaptain: i < pastTeams.length,
    });

    teamSpend.set(
      String(team._id),
      (teamSpend.get(String(team._id)) ?? 0) + soldPrice
    );
  }

  await AuctionPlayer.insertMany(auctionPlayerEntries);
  await Bid.insertMany(bidEntries);
  await TeamSquad.insertMany(squadEntries);

  await Promise.all(
    pastTeams.map((team) =>
      Team.updateOne(
        { _id: team._id },
        { $set: { spent: teamSpend.get(String(team._id)) ?? 0 } }
      )
    )
  );
  console.log(`[seed] past auction settled: ${soldPlayers.length} players sold`);

  /* -------------------------------------------- matches and scorecards -- */
  const squadsByTeam = new Map<string, typeof squadEntries>();
  for (const entry of squadEntries) {
    const key = String(entry.team);
    squadsByTeam.set(key, [...(squadsByTeam.get(key) ?? []), entry]);
  }

  let matchNumber = 1;
  for (let i = 0; i < pastTeams.length; i += 1) {
    for (let j = i + 1; j < pastTeams.length; j += 1) {
      const teamA = pastTeams[i];
      const teamB = pastTeams[j];
      const winner = rand() > 0.5 ? teamA : teamB;

      const match = await Match.create({
        tournament: pastTournament._id,
        matchNumber: matchNumber++,
        teamA: teamA._id,
        teamB: teamB._id,
        matchDate: new Date(2025, 9, matchNumber),
        venue: "MedianV Ground, Ahmedabad",
        status: "COMPLETED",
        winner: winner._id,
        result: `${winner.name} won`,
        overs: 20,
      });

      for (const [inningsNumber, [batTeam, bowlTeam]] of [
        [teamA, teamB],
        [teamB, teamA],
      ].entries()) {
        const batSquad = squadsByTeam.get(String(batTeam._id)) ?? [];
        const bowlSquad = squadsByTeam.get(String(bowlTeam._id)) ?? [];
        if (!batSquad.length || !bowlSquad.length) continue;

        const battingRows = batSquad.slice(0, 6).map((entry, index) => {
          const runs = randInt(0, 75);
          const balls = Math.max(1, runs > 0 ? randInt(Math.ceil(runs / 2), runs + 12) : randInt(1, 8));
          const isOut = rand() > 0.25;
          const fielder = isOut ? pick(bowlSquad) : null;
          return {
            player: entry.player,
            runs,
            balls,
            fours: Math.floor(runs / 12),
            sixes: Math.floor(runs / 25),
            isOut,
            dismissalType: isOut ? (pick(["BOWLED", "CAUGHT", "LBW", "RUN_OUT"]) as string) : "NOT_OUT",
            dismissalBowler: isOut ? pick(bowlSquad).player : null,
            dismissalFielder: fielder ? fielder.player : null,
            battingPosition: index + 1,
          };
        });

        const totalRuns = battingRows.reduce((sum, r) => sum + r.runs, 0);
        const wickets = battingRows.filter((r) => r.isOut).length;

        const innings = await Innings.create({
          match: match._id,
          tournament: pastTournament._id,
          battingTeam: batTeam._id,
          bowlingTeam: bowlTeam._id,
          inningsNumber: inningsNumber + 1,
          totalRuns,
          totalWickets: wickets,
          totalOvers: 20,
          extras: randInt(2, 12),
        });

        await BattingScore.insertMany(
          battingRows.map((row) => ({
            ...row,
            innings: innings._id,
            match: match._id,
            tournament: pastTournament._id,
            team: batTeam._id,
          }))
        );

        await BowlingFigure.insertMany(
          bowlSquad.slice(0, 4).map((entry) => {
            const overs = 4;
            return {
              innings: innings._id,
              match: match._id,
              tournament: pastTournament._id,
              player: entry.player,
              team: bowlTeam._id,
              overs,
              maidens: rand() > 0.8 ? 1 : 0,
              runsConceded: randInt(15, 45),
              wickets: randInt(0, 3),
              wides: randInt(0, 4),
              noBalls: randInt(0, 2),
            };
          })
        );
      }
    }
  }
  console.log(`[seed] ${matchNumber - 1} matches with scorecards created`);

  console.log("\n=== Seed complete ===");
  console.log("Super admin:      admin@medianv.com / Admin@12345");
  console.log("Auction operator: operator@medianv.com / Operator@12345");
  console.log("");
}
