import { PipelineStage, Types } from "mongoose";
import { BattingScore } from "../models/BattingScore";
import { BowlingFigure } from "../models/BowlingFigure";
import { Match } from "../models/Match";
import { Team } from "../models/Team";
import { TeamSquad } from "../models/TeamSquad";
import { Tournament } from "../models/Tournament";
import { Player } from "../models/Player";
import { Auction } from "../models/Auction";
import { AuctionPlayer } from "../models/AuctionPlayer";

/** Converts cricket over notation (3.4 = 3 overs, 4 balls) to a ball count. */
export function oversToBalls(overs: number): number {
  const whole = Math.floor(overs);
  const balls = Math.round((overs - whole) * 10);
  return whole * 6 + balls;
}

/** Converts a ball count back to cricket over notation. */
export function ballsToOvers(balls: number): number {
  const whole = Math.floor(balls / 6);
  const remainder = balls % 6;
  return Number(`${whole}.${remainder}`);
}

function round(value: number, places = 2): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(places));
}

export interface BattingStats {
  matches: number;
  innings: number;
  runs: number;
  balls: number;
  notOuts: number;
  highestScore: number;
  average: number;
  strikeRate: number;
  fours: number;
  sixes: number;
  fifties: number;
  hundreds: number;
}

export interface BowlingStats {
  innings: number;
  overs: number;
  balls: number;
  maidens: number;
  runsConceded: number;
  wickets: number;
  economy: number;
  average: number;
  strikeRate: number;
  bestBowling: string;
}

export interface FieldingStats {
  catches: number;
  stumpings: number;
  runOuts: number;
}

export interface PlayerStatistics {
  batting: BattingStats;
  bowling: BowlingStats;
  fielding: FieldingStats;
}

export interface StatsScope {
  /** Restrict to a single tournament (i.e. one season). */
  tournament?: string;
  /** Restrict to every tournament in a series. */
  seriesName?: string;
}

/** Resolves a scope to the tournament ids it covers, or null for career-wide. */
async function resolveTournamentIds(
  scope: StatsScope
): Promise<Types.ObjectId[] | null> {
  if (scope.tournament) return [new Types.ObjectId(scope.tournament)];
  if (scope.seriesName) {
    const tournaments = await Tournament.find({ seriesName: scope.seriesName })
      .select("_id")
      .lean();
    return tournaments.map((t) => t._id as Types.ObjectId);
  }
  return null;
}

function emptyBatting(): BattingStats {
  return {
    matches: 0,
    innings: 0,
    runs: 0,
    balls: 0,
    notOuts: 0,
    highestScore: 0,
    average: 0,
    strikeRate: 0,
    fours: 0,
    sixes: 0,
    fifties: 0,
    hundreds: 0,
  };
}

function emptyBowling(): BowlingStats {
  return {
    innings: 0,
    overs: 0,
    balls: 0,
    maidens: 0,
    runsConceded: 0,
    wickets: 0,
    economy: 0,
    average: 0,
    strikeRate: 0,
    bestBowling: "-",
  };
}

/**
 * Computes a player's statistics from raw scorecard records.
 *
 * Nothing here is stored — totals are always derived, so they cannot drift from
 * the underlying match data.
 */
export async function getPlayerStatistics(
  playerId: string,
  scope: StatsScope = {}
): Promise<PlayerStatistics> {
  const tournamentIds = await resolveTournamentIds(scope);
  const playerObjectId = new Types.ObjectId(playerId);

  const baseMatch: Record<string, unknown> = { player: playerObjectId };
  if (tournamentIds) baseMatch.tournament = { $in: tournamentIds };

  const fieldingMatch: Record<string, unknown> = {
    dismissalFielder: playerObjectId,
  };
  if (tournamentIds) fieldingMatch.tournament = { $in: tournamentIds };

  const [battingRows, bowlingRows, fieldingRows] = await Promise.all([
    BattingScore.find(baseMatch).select("runs balls fours sixes isOut match").lean(),
    BowlingFigure.find(baseMatch)
      .select("overs maidens runsConceded wickets")
      .lean(),
    BattingScore.find(fieldingMatch).select("dismissalType").lean(),
  ]);

  // ---- batting ----
  const batting = emptyBatting();
  const matchIds = new Set<string>();
  let dismissals = 0;

  for (const row of battingRows) {
    matchIds.add(String(row.match));
    batting.innings += 1;
    batting.runs += row.runs;
    batting.balls += row.balls;
    batting.fours += row.fours;
    batting.sixes += row.sixes;
    if (row.isOut) dismissals += 1;
    else batting.notOuts += 1;
    if (row.runs > batting.highestScore) batting.highestScore = row.runs;
    if (row.runs >= 100) batting.hundreds += 1;
    else if (row.runs >= 50) batting.fifties += 1;
  }

  batting.matches = matchIds.size;
  batting.average = dismissals > 0 ? round(batting.runs / dismissals) : batting.runs;
  batting.strikeRate =
    batting.balls > 0 ? round((batting.runs / batting.balls) * 100) : 0;

  // ---- bowling ----
  const bowling = emptyBowling();
  let bestWickets = -1;
  let bestRuns = Number.POSITIVE_INFINITY;

  for (const row of bowlingRows) {
    bowling.innings += 1;
    bowling.balls += oversToBalls(row.overs);
    bowling.maidens += row.maidens;
    bowling.runsConceded += row.runsConceded;
    bowling.wickets += row.wickets;

    if (
      row.wickets > bestWickets ||
      (row.wickets === bestWickets && row.runsConceded < bestRuns)
    ) {
      bestWickets = row.wickets;
      bestRuns = row.runsConceded;
    }
  }

  bowling.overs = ballsToOvers(bowling.balls);
  bowling.economy =
    bowling.balls > 0 ? round(bowling.runsConceded / (bowling.balls / 6)) : 0;
  bowling.average =
    bowling.wickets > 0 ? round(bowling.runsConceded / bowling.wickets) : 0;
  bowling.strikeRate =
    bowling.wickets > 0 ? round(bowling.balls / bowling.wickets) : 0;
  bowling.bestBowling =
    bestWickets >= 0 ? `${bestWickets}/${bestRuns}` : "-";

  // ---- fielding (derived from dismissal records) ----
  const fielding: FieldingStats = { catches: 0, stumpings: 0, runOuts: 0 };
  for (const row of fieldingRows) {
    if (row.dismissalType === "CAUGHT") fielding.catches += 1;
    else if (row.dismissalType === "STUMPED") fielding.stumpings += 1;
    else if (row.dismissalType === "RUN_OUT") fielding.runOuts += 1;
  }

  return { batting, bowling, fielding };
}

/** Per-season breakdown for a player profile, newest season first. */
export async function getPlayerSeasonStatistics(playerId: string) {
  const tournamentIds = await BattingScore.distinct("tournament", {
    player: new Types.ObjectId(playerId),
  });
  const bowlingTournamentIds = await BowlingFigure.distinct("tournament", {
    player: new Types.ObjectId(playerId),
  });

  const allIds = Array.from(
    new Set([...tournamentIds, ...bowlingTournamentIds].map(String))
  );

  const tournaments = await Tournament.find({ _id: { $in: allIds } })
    .select("name seriesName seasonName seasonNumber startDate status")
    .sort({ startDate: -1 })
    .lean();

  return Promise.all(
    tournaments.map(async (tournament) => ({
      tournament: {
        _id: tournament._id,
        name: tournament.name,
        seriesName: tournament.seriesName,
        seasonName: tournament.seasonName,
        seasonNumber: tournament.seasonNumber,
        status: tournament.status,
      },
      stats: await getPlayerStatistics(playerId, {
        tournament: String(tournament._id),
      }),
    }))
  );
}

/** Aggregate totals and leaderboards for one tournament. */
export async function getTournamentStatistics(tournamentId: string) {
  const id = new Types.ObjectId(tournamentId);

  const [
    totalMatches,
    totalTeams,
    totalPlayers,
    runsAgg,
    wicketsAgg,
  ] = await Promise.all([
    Match.countDocuments({ tournament: id }),
    Team.countDocuments({ tournament: id }),
    TeamSquad.countDocuments({ tournament: id }),
    BattingScore.aggregate<{ total: number }>([
      { $match: { tournament: id } },
      { $group: { _id: null, total: { $sum: "$runs" } } },
    ]),
    BowlingFigure.aggregate<{ total: number }>([
      { $match: { tournament: id } },
      { $group: { _id: null, total: { $sum: "$wickets" } } },
    ]),
  ]);

  const [topRunScorers, topWicketTakers, highestScores] = await Promise.all([
    leaderboard("runs", id, 5),
    leaderboard("wickets", id, 5),
    highestIndividualScores(id, 5),
  ]);

  return {
    totals: {
      matches: totalMatches,
      teams: totalTeams,
      players: totalPlayers,
      runs: runsAgg[0]?.total ?? 0,
      wickets: wicketsAgg[0]?.total ?? 0,
    },
    topRunScorers,
    topWicketTakers,
    highestScores,
  };
}

async function withPlayerDetails<T extends { _id: unknown }>(rows: T[]) {
  const players = await Player.find({ _id: { $in: rows.map((r) => r._id) } })
    .select("fullName profileImage role")
    .lean();
  const map = new Map(players.map((p) => [String(p._id), p]));
  return rows.map((row) => ({
    ...row,
    player: map.get(String(row._id)) ?? null,
  }));
}

/** Top players by runs or wickets, optionally scoped to a tournament. */
export async function leaderboard(
  metric: "runs" | "wickets",
  tournamentId?: Types.ObjectId,
  limit = 10
) {
  const match: Record<string, unknown> = {};
  if (tournamentId) match.tournament = tournamentId;

  if (metric === "runs") {
    const pipeline: PipelineStage[] = [
      { $match: match },
      {
        $group: {
          _id: "$player",
          runs: { $sum: "$runs" },
          balls: { $sum: "$balls" },
          innings: { $sum: 1 },
          fours: { $sum: "$fours" },
          sixes: { $sum: "$sixes" },
        },
      },
      { $sort: { runs: -1 } },
      { $limit: limit },
    ];
    const rows = await BattingScore.aggregate(pipeline);
    return withPlayerDetails(
      rows.map((r) => ({
        ...r,
        strikeRate: r.balls > 0 ? round((r.runs / r.balls) * 100) : 0,
      }))
    );
  }

  const pipeline: PipelineStage[] = [
    { $match: match },
    {
      $group: {
        _id: "$player",
        wickets: { $sum: "$wickets" },
        runsConceded: { $sum: "$runsConceded" },
        innings: { $sum: 1 },
      },
    },
    { $sort: { wickets: -1 } },
    { $limit: limit },
  ];
  const rows = await BowlingFigure.aggregate(pipeline);
  return withPlayerDetails(rows);
}

async function highestIndividualScores(tournamentId?: Types.ObjectId, limit = 5) {
  const match: Record<string, unknown> = {};
  if (tournamentId) match.tournament = tournamentId;

  const rows = await BattingScore.find(match)
    .sort({ runs: -1 })
    .limit(limit)
    .populate("player", "fullName profileImage role")
    .populate("team", "name shortName logo")
    .select("runs balls fours sixes player team match")
    .lean();

  return rows;
}

/** Match record and aggregate run/wicket totals for a team. */
export async function getTeamStatistics(teamId: string) {
  const id = new Types.ObjectId(teamId);

  const [matches, wins, runsAgg, wicketsAgg, squadCount] = await Promise.all([
    Match.countDocuments({
      $or: [{ teamA: id }, { teamB: id }],
      status: "COMPLETED",
    }),
    Match.countDocuments({ winner: id, status: "COMPLETED" }),
    BattingScore.aggregate<{ total: number }>([
      { $match: { team: id } },
      { $group: { _id: null, total: { $sum: "$runs" } } },
    ]),
    BowlingFigure.aggregate<{ total: number }>([
      { $match: { team: id } },
      { $group: { _id: null, total: { $sum: "$wickets" } } },
    ]),
    TeamSquad.countDocuments({ team: id }),
  ]);

  const losses = Math.max(0, matches - wins);

  return {
    matches,
    wins,
    losses,
    // 2 points per win, the standard league scheme
    points: wins * 2,
    runs: runsAgg[0]?.total ?? 0,
    wickets: wicketsAgg[0]?.total ?? 0,
    players: squadCount,
  };
}

/** Points table for a tournament, ordered by points then win count. */
export async function getPointsTable(tournamentId: string) {
  const teams = await Team.find({ tournament: tournamentId })
    .select("name shortName logo color")
    .lean();

  const rows = await Promise.all(
    teams.map(async (team) => {
      const stats = await getTeamStatistics(String(team._id));
      return { team, ...stats };
    })
  );

  return rows.sort((a, b) => b.points - a.points || b.wins - a.wins);
}

/** Platform-wide counters for the admin dashboard. */
export async function getDashboardStatistics() {
  const [
    totalTournaments,
    activeTournaments,
    totalTeams,
    totalPlayers,
    totalAuctions,
    soldPlayers,
    unsoldPlayers,
    amountAgg,
  ] = await Promise.all([
    Tournament.countDocuments(),
    Tournament.countDocuments({ status: "ONGOING" }),
    Team.countDocuments(),
    Player.countDocuments(),
    Auction.countDocuments(),
    AuctionPlayer.countDocuments({ status: "SOLD" }),
    AuctionPlayer.countDocuments({ status: "UNSOLD" }),
    AuctionPlayer.aggregate<{ total: number }>([
      { $match: { status: "SOLD" } },
      { $group: { _id: null, total: { $sum: "$soldPrice" } } },
    ]),
  ]);

  return {
    totalTournaments,
    activeTournaments,
    totalTeams,
    totalPlayers,
    totalAuctions,
    soldPlayers,
    unsoldPlayers,
    totalAuctionAmount: amountAgg[0]?.total ?? 0,
  };
}
