import { PipelineStage, Types } from "mongoose";
import { BattingScore } from "../models/BattingScore";
import { BowlingFigure } from "../models/BowlingFigure";
import { Innings } from "../models/Innings";
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

/**
 * Aggregation expression turning stored over notation into balls, so bowling
 * totals can be summed inside MongoDB without a JS round trip.
 */
const BALLS_EXPR = {
  $add: [
    { $multiply: [{ $floor: "$overs" }, 6] },
    { $round: [{ $multiply: [{ $subtract: ["$overs", { $floor: "$overs" }] }, 10] }, 0] },
  ],
};

/** Points scheme. Wins are worth two, ties one; the league can add adjustments per team. */
const POINTS_FOR_WIN = 2;
const POINTS_FOR_TIE = 1;

/**
 * Weight of a wicket when ranking all-rounders. Stated in the API response and
 * shown in the UI so the ranking is transparent rather than a black box.
 */
export const ALL_ROUNDER_WICKET_WEIGHT = 20;

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

/* -------------------------------------------------------- leaderboards --- */

interface PlayerSummary {
  _id: Types.ObjectId;
  fullName: string;
  profileImage?: string;
  role: string;
}

interface TeamSummary {
  _id: Types.ObjectId;
  name: string;
  shortName?: string;
  logo?: string;
  color?: string;
}

/** Attaches player details and the team each player most recently played for. */
async function withPlayerAndTeam<T extends { _id: unknown; teamIds?: unknown[] }>(
  rows: T[]
): Promise<Array<T & { player: PlayerSummary | null; team: TeamSummary | null }>> {
  const playerIds = rows.map((r) => r._id);
  const teamIds = Array.from(
    new Set(rows.flatMap((r) => (r.teamIds ?? []).map(String)))
  );

  const [players, teams] = await Promise.all([
    Player.find({ _id: { $in: playerIds } })
      .select("fullName profileImage role")
      .lean<PlayerSummary[]>(),
    Team.find({ _id: { $in: teamIds } })
      .select("name shortName logo color")
      .lean<TeamSummary[]>(),
  ]);

  const playerMap = new Map(players.map((p) => [String(p._id), p]));
  const teamMap = new Map(teams.map((t) => [String(t._id), t]));

  return rows.map((row) => {
    const lastTeam = row.teamIds?.length ? row.teamIds[row.teamIds.length - 1] : null;
    const { teamIds: _teamIds, ...rest } = row;
    return {
      ...(rest as T),
      player: playerMap.get(String(row._id)) ?? null,
      team: lastTeam ? teamMap.get(String(lastTeam)) ?? null : null,
    };
  });
}

export interface BattingLeaderboardEntry {
  _id: Types.ObjectId;
  player: PlayerSummary | null;
  team: TeamSummary | null;
  matches: number;
  innings: number;
  runs: number;
  balls: number;
  notOuts: number;
  highestScore: number;
  /** null when the player has never been dismissed */
  average: number | null;
  strikeRate: number;
  fours: number;
  sixes: number;
  fifties: number;
  hundreds: number;
}

export async function battingLeaderboard(
  tournamentId?: Types.ObjectId,
  limit = 10
): Promise<BattingLeaderboardEntry[]> {
  const match: Record<string, unknown> = {};
  if (tournamentId) match.tournament = tournamentId;

  const pipeline: PipelineStage[] = [
    { $match: match },
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: "$player",
        matchIds: { $addToSet: "$match" },
        teamIds: { $push: "$team" },
        innings: { $sum: 1 },
        runs: { $sum: "$runs" },
        balls: { $sum: "$balls" },
        notOuts: { $sum: { $cond: [{ $eq: ["$isOut", false] }, 1, 0] } },
        highestScore: { $max: "$runs" },
        fours: { $sum: "$fours" },
        sixes: { $sum: "$sixes" },
        fifties: {
          $sum: {
            $cond: [{ $and: [{ $gte: ["$runs", 50] }, { $lt: ["$runs", 100] }] }, 1, 0],
          },
        },
        hundreds: { $sum: { $cond: [{ $gte: ["$runs", 100] }, 1, 0] } },
      },
    },
    { $sort: { runs: -1, balls: 1 } },
    { $limit: limit },
  ];

  const rows = await BattingScore.aggregate(pipeline);
  const enriched = await withPlayerAndTeam(rows);

  return enriched.map((r) => {
    const dismissals = r.innings - r.notOuts;
    return {
      _id: r._id,
      player: r.player,
      team: r.team,
      matches: r.matchIds.length,
      innings: r.innings,
      runs: r.runs,
      balls: r.balls,
      notOuts: r.notOuts,
      highestScore: r.highestScore,
      average: dismissals > 0 ? round(r.runs / dismissals) : null,
      strikeRate: r.balls > 0 ? round((r.runs / r.balls) * 100) : 0,
      fours: r.fours,
      sixes: r.sixes,
      fifties: r.fifties,
      hundreds: r.hundreds,
    };
  });
}

export interface BowlingLeaderboardEntry {
  _id: Types.ObjectId;
  player: PlayerSummary | null;
  team: TeamSummary | null;
  matches: number;
  innings: number;
  balls: number;
  overs: number;
  maidens: number;
  runsConceded: number;
  wickets: number;
  economy: number;
  /** null when the player has no wickets */
  average: number | null;
  strikeRate: number | null;
  bestBowling: string;
}

export async function bowlingLeaderboard(
  tournamentId?: Types.ObjectId,
  limit = 10
): Promise<BowlingLeaderboardEntry[]> {
  const match: Record<string, unknown> = {};
  if (tournamentId) match.tournament = tournamentId;

  const pipeline: PipelineStage[] = [
    { $match: match },
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: "$player",
        matchIds: { $addToSet: "$match" },
        teamIds: { $push: "$team" },
        innings: { $sum: 1 },
        balls: { $sum: BALLS_EXPR },
        maidens: { $sum: "$maidens" },
        runsConceded: { $sum: "$runsConceded" },
        wickets: { $sum: "$wickets" },
        spells: { $push: { w: "$wickets", r: "$runsConceded" } },
      },
    },
    { $sort: { wickets: -1, runsConceded: 1 } },
    { $limit: limit },
  ];

  const rows = await BowlingFigure.aggregate(pipeline);
  const enriched = await withPlayerAndTeam(rows);

  return enriched.map((r) => {
    let best: { w: number; r: number } | null = null;
    for (const spell of r.spells as Array<{ w: number; r: number }>) {
      if (!best || spell.w > best.w || (spell.w === best.w && spell.r < best.r)) {
        best = spell;
      }
    }
    return {
      _id: r._id,
      player: r.player,
      team: r.team,
      matches: r.matchIds.length,
      innings: r.innings,
      balls: r.balls,
      overs: ballsToOvers(r.balls),
      maidens: r.maidens,
      runsConceded: r.runsConceded,
      wickets: r.wickets,
      economy: r.balls > 0 ? round(r.runsConceded / (r.balls / 6)) : 0,
      average: r.wickets > 0 ? round(r.runsConceded / r.wickets) : null,
      strikeRate: r.wickets > 0 ? round(r.balls / r.wickets) : null,
      bestBowling: best ? `${best.w}/${best.r}` : "-",
    };
  });
}

export interface AllRounderLeaderboardEntry {
  _id: Types.ObjectId;
  player: PlayerSummary | null;
  team: TeamSummary | null;
  matches: number;
  battingInnings: number;
  runs: number;
  strikeRate: number;
  bowlingInnings: number;
  wickets: number;
  economy: number;
  /** runs + ALL_ROUNDER_WICKET_WEIGHT × wickets */
  points: number;
}

/**
 * Players who have both batted and bowled, ranked by a stated formula:
 * runs plus a fixed weight per wicket. The weight is exposed so the UI can say
 * exactly how the order was reached.
 */
export async function allRounderLeaderboard(
  tournamentId?: Types.ObjectId,
  limit = 10
): Promise<AllRounderLeaderboardEntry[]> {
  const match: Record<string, unknown> = {};
  if (tournamentId) match.tournament = tournamentId;

  const [batting, bowling] = await Promise.all([
    BattingScore.aggregate<{
      _id: Types.ObjectId;
      matchIds: Types.ObjectId[];
      teamIds: Types.ObjectId[];
      innings: number;
      runs: number;
      balls: number;
    }>([
      { $match: match },
      { $sort: { createdAt: 1 } },
      {
        $group: {
          _id: "$player",
          matchIds: { $addToSet: "$match" },
          teamIds: { $push: "$team" },
          innings: { $sum: 1 },
          runs: { $sum: "$runs" },
          balls: { $sum: "$balls" },
        },
      },
    ]),
    BowlingFigure.aggregate<{
      _id: Types.ObjectId;
      matchIds: Types.ObjectId[];
      innings: number;
      balls: number;
      runsConceded: number;
      wickets: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: "$player",
          matchIds: { $addToSet: "$match" },
          innings: { $sum: 1 },
          balls: { $sum: BALLS_EXPR },
          runsConceded: { $sum: "$runsConceded" },
          wickets: { $sum: "$wickets" },
        },
      },
    ]),
  ]);

  const bowlingMap = new Map(bowling.map((b) => [String(b._id), b]));

  const combined = batting
    .map((bat) => {
      const bowl = bowlingMap.get(String(bat._id));
      if (!bowl) return null;
      const matchIds = new Set([...bat.matchIds, ...bowl.matchIds].map(String));
      return {
        _id: bat._id,
        teamIds: bat.teamIds,
        matches: matchIds.size,
        battingInnings: bat.innings,
        runs: bat.runs,
        strikeRate: bat.balls > 0 ? round((bat.runs / bat.balls) * 100) : 0,
        bowlingInnings: bowl.innings,
        wickets: bowl.wickets,
        economy: bowl.balls > 0 ? round(bowl.runsConceded / (bowl.balls / 6)) : 0,
        points: bat.runs + ALL_ROUNDER_WICKET_WEIGHT * bowl.wickets,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.points - a.points || b.wickets - a.wickets)
    .slice(0, limit);

  const enriched = await withPlayerAndTeam(combined);
  return enriched.map(({ player, team, ...rest }) => ({ ...rest, player, team }));
}

export interface FieldingLeaderboardEntry {
  _id: Types.ObjectId;
  player: PlayerSummary | null;
  team: TeamSummary | null;
  catches: number;
  stumpings: number;
  runOuts: number;
  dismissals: number;
}

/** Fielders ranked by dismissals they were credited with on scorecards. */
export async function fieldingLeaderboard(
  tournamentId?: Types.ObjectId,
  limit = 10
): Promise<FieldingLeaderboardEntry[]> {
  const match: Record<string, unknown> = { dismissalFielder: { $ne: null } };
  if (tournamentId) match.tournament = tournamentId;

  const rows = await BattingScore.aggregate<{
    _id: Types.ObjectId;
    catches: number;
    stumpings: number;
    runOuts: number;
    dismissals: number;
  }>([
    { $match: match },
    {
      $group: {
        _id: "$dismissalFielder",
        catches: { $sum: { $cond: [{ $eq: ["$dismissalType", "CAUGHT"] }, 1, 0] } },
        stumpings: { $sum: { $cond: [{ $eq: ["$dismissalType", "STUMPED"] }, 1, 0] } },
        runOuts: { $sum: { $cond: [{ $eq: ["$dismissalType", "RUN_OUT"] }, 1, 0] } },
      },
    },
    { $addFields: { dismissals: { $add: ["$catches", "$stumpings", "$runOuts"] } } },
    { $sort: { dismissals: -1, catches: -1 } },
    { $limit: limit },
  ]);

  // the fielder's own team isn't on the batting record, so look up their squad
  const squads = await TeamSquad.find({
    player: { $in: rows.map((r) => r._id) },
    ...(tournamentId ? { tournament: tournamentId } : {}),
  })
    .select("player team")
    .lean();
  const squadTeam = new Map(squads.map((s) => [String(s.player), s.team]));

  const enriched = await withPlayerAndTeam(
    rows.map((r) => ({
      ...r,
      teamIds: squadTeam.has(String(r._id)) ? [squadTeam.get(String(r._id))] : [],
    }))
  );
  return enriched.map(({ player, team, ...rest }) => ({ ...rest, player, team }));
}

/**
 * Backwards-compatible entry point used by the leaderboards endpoint.
 * "runs" and "wickets" keep their original meaning; the other metrics are new.
 */
export async function leaderboard(
  metric: "runs" | "wickets" | "allrounder" | "fielding",
  tournamentId?: Types.ObjectId,
  limit = 10
) {
  switch (metric) {
    case "runs":
      return battingLeaderboard(tournamentId, limit);
    case "wickets":
      return bowlingLeaderboard(tournamentId, limit);
    case "allrounder":
      return allRounderLeaderboard(tournamentId, limit);
    case "fielding":
      return fieldingLeaderboard(tournamentId, limit);
  }
}

async function highestIndividualScores(tournamentId?: Types.ObjectId, limit = 10) {
  const match: Record<string, unknown> = {};
  if (tournamentId) match.tournament = tournamentId;

  return BattingScore.find(match)
    .sort({ runs: -1, balls: 1 })
    .limit(limit)
    .populate("player", "fullName profileImage role")
    .populate("team", "name shortName logo color")
    .populate({ path: "match", select: "matchNumber matchDate teamA teamB" })
    .select("runs balls fours sixes isOut player team match")
    .lean();
}

async function bestBowlingFigures(tournamentId?: Types.ObjectId, limit = 10) {
  const match: Record<string, unknown> = { wickets: { $gt: 0 } };
  if (tournamentId) match.tournament = tournamentId;

  return BowlingFigure.find(match)
    .sort({ wickets: -1, runsConceded: 1 })
    .limit(limit)
    .populate("player", "fullName profileImage role")
    .populate("team", "name shortName logo color")
    .populate({ path: "match", select: "matchNumber matchDate teamA teamB" })
    .select("overs maidens runsConceded wickets player team match")
    .lean();
}

/** Aggregate totals and leaderboards for one tournament. */
export async function getTournamentStatistics(tournamentId: string, limit = 10) {
  const id = new Types.ObjectId(tournamentId);

  const [
    totalMatches,
    completedMatches,
    totalTeams,
    squadCount,
    battedPlayers,
    bowledPlayers,
    runsAgg,
    wicketsAgg,
    boundariesAgg,
  ] = await Promise.all([
    Match.countDocuments({ tournament: id }),
    Match.countDocuments({ tournament: id, status: "COMPLETED" }),
    Team.countDocuments({ tournament: id }),
    TeamSquad.countDocuments({ tournament: id }),
    BattingScore.distinct("player", { tournament: id }),
    BowlingFigure.distinct("player", { tournament: id }),
    BattingScore.aggregate<{ total: number }>([
      { $match: { tournament: id } },
      { $group: { _id: null, total: { $sum: "$runs" } } },
    ]),
    BowlingFigure.aggregate<{ total: number }>([
      { $match: { tournament: id } },
      { $group: { _id: null, total: { $sum: "$wickets" } } },
    ]),
    BattingScore.aggregate<{ fours: number; sixes: number }>([
      { $match: { tournament: id } },
      { $group: { _id: null, fours: { $sum: "$fours" }, sixes: { $sum: "$sixes" } } },
    ]),
  ]);

  const [
    topRunScorers,
    topWicketTakers,
    topAllRounders,
    topFielders,
    highestScores,
    bestBowling,
  ] = await Promise.all([
    battingLeaderboard(id, limit),
    bowlingLeaderboard(id, limit),
    allRounderLeaderboard(id, limit),
    fieldingLeaderboard(id, limit),
    highestIndividualScores(id, limit),
    bestBowlingFigures(id, limit),
  ]);

  // Squads change over a season — replacements come in, buys drop out — so once
  // matches exist, count the people who actually took the field.
  const appeared = new Set([...battedPlayers, ...bowledPlayers].map(String)).size;

  return {
    totals: {
      matches: totalMatches,
      completedMatches,
      teams: totalTeams,
      players: appeared || squadCount,
      runs: runsAgg[0]?.total ?? 0,
      wickets: wicketsAgg[0]?.total ?? 0,
      fours: boundariesAgg[0]?.fours ?? 0,
      sixes: boundariesAgg[0]?.sixes ?? 0,
    },
    allRounderWicketWeight: ALL_ROUNDER_WICKET_WEIGHT,
    topRunScorers,
    topWicketTakers,
    topAllRounders,
    topFielders,
    highestScores,
    bestBowling,
  };
}

/* ------------------------------------------------------------ standings --- */

export interface TeamStanding {
  matches: number;
  wins: number;
  losses: number;
  ties: number;
  noResults: number;
  /** wins × 2 + ties × 1 + the league's adjustment */
  points: number;
  pointsAdjustment: number;
  /** Net run rate; null until the team has batted and bowled */
  netRunRate: number | null;
  runsFor: number;
  oversFor: number;
  runsAgainst: number;
  oversAgainst: number;
  runs: number;
  wickets: number;
  players: number;
  form: Array<"W" | "L" | "T" | "N">;
}

interface StandingAccumulator {
  matches: number;
  wins: number;
  losses: number;
  ties: number;
  noResults: number;
  runsFor: number;
  ballsFor: number;
  runsAgainst: number;
  ballsAgainst: number;
  form: Array<"W" | "L" | "T" | "N">;
}

function emptyAccumulator(): StandingAccumulator {
  return {
    matches: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    noResults: 0,
    runsFor: 0,
    ballsFor: 0,
    runsAgainst: 0,
    ballsAgainst: 0,
    form: [],
  };
}

/**
 * Builds every team's standing in a tournament from match results and innings.
 *
 * Net run rate follows the standard convention: a side bowled out is charged
 * its full quota of overs, not the overs it actually faced.
 */
async function computeStandings(
  tournamentId: Types.ObjectId
): Promise<Map<string, StandingAccumulator>> {
  const [matches, innings] = await Promise.all([
    Match.find({
      tournament: tournamentId,
      status: { $in: ["COMPLETED", "ABANDONED"] },
    })
      .select("teamA teamB winner status result overs matchDate")
      .sort({ matchDate: 1, createdAt: 1 })
      .lean(),
    Innings.find({ tournament: tournamentId })
      .select("match battingTeam bowlingTeam inningsNumber totalRuns totalOvers allOut")
      .lean(),
  ]);

  const table = new Map<string, StandingAccumulator>();
  const get = (id: unknown) => {
    const key = String(id);
    if (!table.has(key)) table.set(key, emptyAccumulator());
    return table.get(key)!;
  };

  const matchInfo = new Map(
    matches.map((m) => [
      String(m._id),
      { quota: m.overs ?? 20, winner: m.winner ? String(m.winner) : null },
    ])
  );

  for (const m of matches) {
    const a = get(m.teamA);
    const b = get(m.teamB);
    a.matches += 1;
    b.matches += 1;

    if (m.status === "ABANDONED" || (!m.winner && !/tie/i.test(m.result ?? ""))) {
      a.noResults += 1;
      b.noResults += 1;
      a.form.push("N");
      b.form.push("N");
      continue;
    }

    if (!m.winner) {
      a.ties += 1;
      b.ties += 1;
      a.form.push("T");
      b.form.push("T");
      continue;
    }

    const winner = String(m.winner);
    const [w, l] = winner === String(m.teamA) ? [a, b] : [b, a];
    w.wins += 1;
    l.losses += 1;
    w.form.push("W");
    l.form.push("L");
  }

  for (const inn of innings) {
    const info = matchInfo.get(String(inn.match));
    // innings from matches that didn't reach a result don't count towards NRR
    if (!info) continue;

    const quotaBalls = info.quota * 6;
    const actualBalls = oversToBalls(inn.totalOvers);
    // The one legitimate way to finish early is to win the chase. Any other
    // short innings — bowled out, or out of batters in a small-sided game —
    // is charged the full quota, which is how the official table works too.
    const chasedAndWon =
      inn.inningsNumber > 1 && info.winner !== null && info.winner === String(inn.battingTeam);
    const balls =
      inn.allOut || (actualBalls < quotaBalls && !chasedAndWon) ? quotaBalls : actualBalls;
    const bat = get(inn.battingTeam);
    const bowl = get(inn.bowlingTeam);
    bat.runsFor += inn.totalRuns;
    bat.ballsFor += balls;
    bowl.runsAgainst += inn.totalRuns;
    bowl.ballsAgainst += balls;
  }

  return table;
}

function finishStanding(
  acc: StandingAccumulator,
  pointsAdjustment: number,
  runs: number,
  wickets: number,
  players: number
): TeamStanding {
  const forRate = acc.ballsFor > 0 ? acc.runsFor / (acc.ballsFor / 6) : null;
  const againstRate =
    acc.ballsAgainst > 0 ? acc.runsAgainst / (acc.ballsAgainst / 6) : null;

  return {
    matches: acc.matches,
    wins: acc.wins,
    losses: acc.losses,
    ties: acc.ties,
    noResults: acc.noResults,
    points: acc.wins * POINTS_FOR_WIN + acc.ties * POINTS_FOR_TIE + pointsAdjustment,
    pointsAdjustment,
    netRunRate:
      forRate !== null && againstRate !== null ? round(forRate - againstRate, 3) : null,
    runsFor: acc.runsFor,
    oversFor: ballsToOvers(acc.ballsFor),
    runsAgainst: acc.runsAgainst,
    oversAgainst: ballsToOvers(acc.ballsAgainst),
    runs,
    wickets,
    players,
    form: acc.form.slice(-5),
  };
}

/** Match record, points, net run rate and aggregate totals for one team. */
export async function getTeamStatistics(teamId: string): Promise<TeamStanding> {
  const team = await Team.findById(teamId).select("tournament pointsAdjustment").lean();
  if (!team) {
    return finishStanding(emptyAccumulator(), 0, 0, 0, 0);
  }

  const id = new Types.ObjectId(teamId);
  const [standings, runsAgg, wicketsAgg, squadCount] = await Promise.all([
    computeStandings(team.tournament as Types.ObjectId),
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

  return finishStanding(
    standings.get(teamId) ?? emptyAccumulator(),
    team.pointsAdjustment ?? 0,
    runsAgg[0]?.total ?? 0,
    wicketsAgg[0]?.total ?? 0,
    squadCount
  );
}

/** Points table for a tournament: points, then wins, then net run rate. */
export async function getPointsTable(tournamentId: string) {
  const id = new Types.ObjectId(tournamentId);

  const [teams, standings, runsAgg, wicketsAgg, squadAgg] = await Promise.all([
    Team.find({ tournament: id })
      .select("name shortName logo color pointsAdjustment")
      .lean(),
    computeStandings(id),
    BattingScore.aggregate<{ _id: Types.ObjectId; total: number }>([
      { $match: { tournament: id } },
      { $group: { _id: "$team", total: { $sum: "$runs" } } },
    ]),
    BowlingFigure.aggregate<{ _id: Types.ObjectId; total: number }>([
      { $match: { tournament: id } },
      { $group: { _id: "$team", total: { $sum: "$wickets" } } },
    ]),
    TeamSquad.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { tournament: id } },
      { $group: { _id: "$team", count: { $sum: 1 } } },
    ]),
  ]);

  const runsMap = new Map(runsAgg.map((r) => [String(r._id), r.total]));
  const wicketsMap = new Map(wicketsAgg.map((r) => [String(r._id), r.total]));
  const squadMap = new Map(squadAgg.map((r) => [String(r._id), r.count]));

  const rows = teams.map((team) => {
    const key = String(team._id);
    const { pointsAdjustment, ...teamSummary } = team;
    return {
      team: teamSummary,
      ...finishStanding(
        standings.get(key) ?? emptyAccumulator(),
        pointsAdjustment ?? 0,
        runsMap.get(key) ?? 0,
        wicketsMap.get(key) ?? 0,
        squadMap.get(key) ?? 0
      ),
    };
  });

  return rows.sort(
    (a, b) =>
      b.points - a.points ||
      b.wins - a.wins ||
      (b.netRunRate ?? -Infinity) - (a.netRunRate ?? -Infinity)
  );
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
