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

/**
 * Real MedianV Premier League data.
 *
 * Every price is in lakhs. "RETAINED" players were kept by their team without
 * going to auction; "UNSOLD" players went to auction unsold but still sit on the
 * team's list, as the league records them. No match scorecards are seeded —
 * statistics stay empty until real results are entered, rather than invented.
 */

const SERIES = "MedianV Premier League";
const BASE_PRICE = 10;
/** Alpha Legacy Legends spent exactly 200, which pins the purse at 2 Cr. */
const TEAM_BUDGET = 200;
const SQUAD_SIZE = 11;

type SoldValue = number | "RETAINED" | "UNSOLD";

interface SquadRow {
  name: string;
  sold: SoldValue;
  captain?: boolean;
  viceCaptain?: boolean;
}

interface TeamSeed {
  name: string;
  shortName: string;
  color: string;
  logo: string;
  squad: SquadRow[];
}

const TEAMS: TeamSeed[] = [
  {
    name: "Royal Vikings",
    shortName: "RV",
    color: "#f59d39",
    logo: "/team-logos/royal-vikings.png",
    squad: [
      { name: "Akash Patel", sold: 10 },
      { name: "Dev Vasita", sold: "RETAINED" },
      { name: "Dishang Chavda", sold: 78 },
      { name: "Kunal Gajjar", sold: "RETAINED", viceCaptain: true },
      { name: "Nimesh Devaliya", sold: "RETAINED" },
      { name: "Pankaj Bhatt", sold: 11 },
      { name: "Raj Pandey", sold: 13 },
      { name: "Rohit Prajapati", sold: "RETAINED", captain: true },
      { name: "Soham Patel", sold: "RETAINED" },
      { name: "Taher Patwa", sold: 24 },
    ],
  },
  {
    name: "Storm Breakers",
    shortName: "SB",
    color: "#46acdc",
    logo: "/team-logos/storm-breakers.png",
    squad: [
      { name: "Akash Desai", sold: 17 },
      { name: "Amara Reddy", sold: 10 },
      { name: "Bhanu Pratap Singh", sold: 22 },
      { name: "Jatin Panchal", sold: "UNSOLD" },
      { name: "Jayesh Bhadane", sold: 10 },
      { name: "Mandeep Singh Bagga", sold: "RETAINED", captain: true },
      { name: "Meet Patel", sold: 26 },
      { name: "Prem Darji", sold: 22 },
      { name: "Rahul Kumar", sold: 10 },
      { name: "Ritesh Narnaware", sold: "RETAINED", viceCaptain: true },
      { name: "Vishal Rajpure", sold: 82 },
    ],
  },
  {
    name: "Game Changers",
    shortName: "GC",
    color: "#95aaff",
    logo: "/team-logos/game-changers.png",
    squad: [
      { name: "Chhatrapalsinh Rana", sold: 72 },
      { name: "Devyang Patel", sold: 10 },
      { name: "Dhruv Panchal", sold: "RETAINED", viceCaptain: true },
      { name: "Dinesh Prajapati", sold: "RETAINED", captain: true },
      { name: "Himanshu Singh", sold: 30 },
      { name: "Pratik Zajam", sold: 17 },
      { name: "Rushikesh Gaware", sold: 27 },
      { name: "Shashank Khede", sold: 12 },
      { name: "Siddharth Kanzariya", sold: 21 },
      { name: "Subhankar Guchait", sold: "UNSOLD" },
      { name: "Vaibhav Bhatt", sold: "RETAINED" },
    ],
  },
  {
    name: "Knight Hunters",
    shortName: "KH",
    color: "#fbd12f",
    logo: "/team-logos/knight-hunters.png",
    squad: [
      { name: "Agman Rajpurohit", sold: "RETAINED", viceCaptain: true },
      { name: "Akshat Shah", sold: 21 },
      { name: "Dwanish Patel", sold: 16 },
      { name: "Harsh Padaliya", sold: 46 },
      { name: "Pawan Kumar", sold: 23 },
      { name: "Rahul Rao", sold: 10 },
      { name: "Ram Pratap", sold: "RETAINED", captain: true },
      { name: "Sourav Yadav", sold: 21 },
      { name: "Viraj Singh", sold: 10 },
      { name: "Vivaan Kumar Pathak", sold: 12 },
      { name: "Vivek Lakhani", sold: 20 },
    ],
  },
  {
    name: "Viking Raiders",
    shortName: "VR",
    color: "#ffb799",
    logo: "/team-logos/viking-raiders.png",
    squad: [
      { name: "Aayush Pandey", sold: 17 },
      { name: "Gaurav Sharma", sold: 11 },
      { name: "Keval Barvaliya", sold: 29 },
      { name: "Lokesh Sharma", sold: "UNSOLD" },
      { name: "MD Shadab", sold: "RETAINED", viceCaptain: true },
      { name: "Meet Soni", sold: 78 },
      { name: "Sanjay Chary", sold: "UNSOLD" },
      { name: "Soumen Shit", sold: 29 },
      { name: "Vishal Mishra", sold: "RETAINED", captain: true },
      { name: "Vishnu Vardhan", sold: 19 },
      { name: "Yash Savariya", sold: 10 },
    ],
  },
  {
    name: "Alpha Legacy Legends",
    shortName: "ALL",
    color: "#0754cf",
    logo: "/team-logos/alpha-legacy-legends.png",
    squad: [
      { name: "Abhinav Sumra", sold: "RETAINED", viceCaptain: true },
      { name: "Arvind Rajput", sold: 10 },
      { name: "Ayush Patel", sold: 11 },
      { name: "Himanshu Pradhan", sold: 32 },
      { name: "Manav Jakhaniya", sold: "UNSOLD" },
      { name: "Pratik Vinayak Patil", sold: 15 },
      { name: "Raj Keshkar", sold: 84 },
      { name: "Ritesh Kushvah", sold: "RETAINED", captain: true },
      { name: "Sagar Kumar", sold: 17 },
      { name: "Vishal Panchal", sold: 10 },
      { name: "Vraj Parikh", sold: 21 },
    ],
  },
];

/**
 * Western Giants is not fielding a team, so its players are registered without
 * a squad — available to be picked up in a future auction.
 */
const FREE_AGENTS: string[] = [
  "Avi Patel",
  "Brijesh Sangani",
  "Harendrasingh Negi",
  "Harsh Raj",
  "Niraj Chander",
  "Pradeep Upadhyay",
  "Rahul Pratap Singh",
  "Ronak Chauhan",
  "Roshan Kumar Bhagat",
  "Saksham Jain",
  "Yagnesh Shiroya",
];

/** Every edition of the league so far, from the public fixture record. */
const SEASONS = [
  { number: 1, start: "2024-01-11", end: "2024-05-02", status: "COMPLETED", externalId: undefined },
  { number: 2, start: "2024-07-24", end: "2025-05-26", status: "COMPLETED", externalId: undefined },
  { number: 3, start: "2025-09-09", end: "2026-01-29", status: "COMPLETED", externalId: undefined },
  /** Season 4 is scored on CricHeroes; its id lets results sync without typing it in. */
  { number: 4, start: "2026-05-06", end: "2027-03-31", status: "ONGOING", externalId: 2000875 },
] as const;

/**
 * Populates a database with the league's real teams and players.
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
  const tournaments = await Tournament.create(
    SEASONS.map((season) => ({
      name: `${SERIES} Season ${season.number}`,
      shortName: `MPL S${season.number}`,
      seriesName: SERIES,
      seasonName: `Season ${season.number}`,
      seasonNumber: season.number,
      startDate: new Date(season.start),
      endDate: new Date(season.end),
      location: "Ahmedabad",
      status: season.status,
      externalId: season.externalId,
      createdBy: superAdmin._id,
    }))
  );
  const currentTournament = tournaments.find((t) => t.status === "ONGOING")!;
  console.log(`[seed] ${tournaments.length} seasons created`);

  /* --------------------------------------------------------------- teams -- */
  const teamDocs = await Team.create(
    TEAMS.map((team) => ({
      name: team.name,
      shortName: team.shortName,
      color: team.color,
      logo: team.logo,
      budget: TEAM_BUDGET,
      spent: team.squad.reduce(
        (sum, row) => sum + (typeof row.sold === "number" ? row.sold : 0),
        0
      ),
      maxPlayers: SQUAD_SIZE,
      minPlayers: 7,
      status: "ACTIVE",
      tournament: currentTournament._id,
      createdBy: superAdmin._id,
    }))
  );
  const teamByName = new Map(teamDocs.map((t) => [t.name, t]));
  console.log(`[seed] ${teamDocs.length} teams created`);

  /* ------------------------------------------------------------- players -- */
  const allNames = [
    ...TEAMS.flatMap((team) => team.squad.map((row) => row.name)),
    ...FREE_AGENTS,
  ];

  const playerDocs = await Player.create(
    allNames.map((fullName) => ({
      fullName,
      role: "ALL_ROUNDER",
      category: "LOCAL",
      basePrice: BASE_PRICE,
      isActive: true,
      createdBy: superAdmin._id,
    }))
  );
  const playerByName = new Map(playerDocs.map((p) => [p.fullName, p]));
  console.log(
    `[seed] ${playerDocs.length} players created (${FREE_AGENTS.length} without a team)`
  );

  /* ------------------------------------------ the season's auction record -- */
  const auction = await Auction.create({
    name: `${SERIES} Season 4 Auction`,
    tournament: currentTournament._id,
    status: "COMPLETED",
    bidIncrementTiers: [
      { threshold: 0, increment: 1 },
      { threshold: 40, increment: 2 },
    ],
    maxSquadSize: SQUAD_SIZE,
    minSquadSize: 7,
    startedAt: new Date(currentTournament.startDate!.getTime() - 14 * 86_400_000),
    completedAt: new Date(currentTournament.startDate!.getTime() - 14 * 86_400_000),
    createdBy: superAdmin._id,
  });

  /* ------------------------------------------------ squads and outcomes -- */
  const squadEntries = [];
  const auctionEntries = [];
  let order = 1;

  for (const team of TEAMS) {
    const teamDoc = teamByName.get(team.name)!;

    for (const row of team.squad) {
      const player = playerByName.get(row.name)!;
      const retained = row.sold === "RETAINED";
      const soldPrice = typeof row.sold === "number" ? row.sold : 0;

      squadEntries.push({
        tournament: currentTournament._id,
        team: teamDoc._id,
        player: player._id,
        basePrice: retained ? 0 : BASE_PRICE,
        soldPrice,
        acquisitionType: retained ? "RETAINED" : "AUCTION",
        auction: retained ? null : auction._id,
        isCaptain: row.captain ?? false,
        isViceCaptain: row.viceCaptain ?? false,
      });

      // retained players never went under the hammer, so they have no auction record
      if (!retained) {
        auctionEntries.push({
          auction: auction._id,
          player: player._id,
          basePrice: BASE_PRICE,
          currentBid: soldPrice,
          status: row.sold === "UNSOLD" ? "UNSOLD" : "SOLD",
          soldPrice: row.sold === "UNSOLD" ? null : soldPrice,
          soldToTeam: row.sold === "UNSOLD" ? null : teamDoc._id,
          order: order++,
          soldAt: row.sold === "UNSOLD" ? undefined : auction.completedAt,
        });
      }
    }
  }

  await TeamSquad.insertMany(squadEntries);
  await AuctionPlayer.insertMany(auctionEntries);

  const sold = auctionEntries.filter((e) => e.status === "SOLD").length;
  const unsold = auctionEntries.length - sold;
  const retained = squadEntries.length - auctionEntries.length;
  console.log(
    `[seed] squads filled: ${sold} sold, ${unsold} unsold, ${retained} retained`
  );

  console.log("\n=== Seed complete ===");
  console.log("Super admin:      admin@medianv.com / Admin@12345");
  console.log("Auction operator: operator@medianv.com / Operator@12345");
  console.log("");
}
