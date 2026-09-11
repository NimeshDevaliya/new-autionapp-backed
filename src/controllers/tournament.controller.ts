import { Request, Response } from "express";
import { Tournament } from "../models/Tournament";
import { Team } from "../models/Team";
import { TeamSquad } from "../models/TeamSquad";
import { Match } from "../models/Match";
import { Auction } from "../models/Auction";
import { ApiError } from "../utils/ApiError";
import {
  buildPaginationMeta,
  parsePagination,
  sendCreated,
  sendSuccess,
} from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";
import { buildSort } from "../validators/common";
import { getTournamentStatistics } from "../services/statistics.service";

const SORTABLE = ["name", "startDate", "endDate", "status", "createdAt"];

export const listTournaments = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { search, status, seriesName, sortBy, sortOrder } = req.query as Record<
    string,
    string | undefined
  >;

  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (seriesName) filter.seriesName = seriesName;
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { seriesName: { $regex: search, $options: "i" } },
      { location: { $regex: search, $options: "i" } },
    ];
  }

  const [tournaments, total] = await Promise.all([
    Tournament.find(filter)
      .sort(buildSort(sortBy, sortOrder, SORTABLE, { startDate: -1 }))
      .skip(skip)
      .limit(limit)
      .lean(),
    Tournament.countDocuments(filter),
  ]);

  // attach lightweight counts so listing cards can show them without N+1 calls
  const ids = tournaments.map((t) => t._id);
  const [teamCounts, playerCounts] = await Promise.all([
    Team.aggregate<{ _id: unknown; count: number }>([
      { $match: { tournament: { $in: ids } } },
      { $group: { _id: "$tournament", count: { $sum: 1 } } },
    ]),
    TeamSquad.aggregate<{ _id: unknown; count: number }>([
      { $match: { tournament: { $in: ids } } },
      { $group: { _id: "$tournament", count: { $sum: 1 } } },
    ]),
  ]);

  const teamMap = new Map(teamCounts.map((c) => [String(c._id), c.count]));
  const playerMap = new Map(playerCounts.map((c) => [String(c._id), c.count]));

  const data = tournaments.map((t) => ({
    ...t,
    teamCount: teamMap.get(String(t._id)) ?? 0,
    playerCount: playerMap.get(String(t._id)) ?? 0,
  }));

  return sendSuccess(
    res,
    data,
    "Tournaments loaded",
    200,
    buildPaginationMeta(page, limit, total)
  );
});

export const getTournament = asyncHandler(async (req: Request, res: Response) => {
  const tournament = await Tournament.findById(req.params.id).lean();
  if (!tournament) throw ApiError.notFound("Tournament not found");

  const [teamCount, playerCount, matchCount, auction] = await Promise.all([
    Team.countDocuments({ tournament: tournament._id }),
    TeamSquad.countDocuments({ tournament: tournament._id }),
    Match.countDocuments({ tournament: tournament._id }),
    Auction.findOne({ tournament: tournament._id }).select("_id name status").lean(),
  ]);

  return sendSuccess(
    res,
    { ...tournament, teamCount, playerCount, matchCount, auction },
    "Tournament loaded"
  );
});

export const getTournamentStats = asyncHandler(
  async (req: Request, res: Response) => {
    const tournament = await Tournament.findById(req.params.id);
    if (!tournament) throw ApiError.notFound("Tournament not found");

    const stats = await getTournamentStatistics(req.params.id);
    return sendSuccess(res, stats, "Tournament statistics loaded");
  }
);

export const createTournament = asyncHandler(async (req: Request, res: Response) => {
  const tournament = await Tournament.create({
    ...req.body,
    createdBy: req.admin!.id,
  });
  return sendCreated(res, tournament, "Tournament created successfully");
});

export const updateTournament = asyncHandler(async (req: Request, res: Response) => {
  const tournament = await Tournament.findById(req.params.id);
  if (!tournament) throw ApiError.notFound("Tournament not found");

  Object.assign(tournament, req.body);
  await tournament.save();

  return sendSuccess(res, tournament, "Tournament updated successfully");
});

export const deleteTournament = asyncHandler(async (req: Request, res: Response) => {
  const tournament = await Tournament.findById(req.params.id);
  if (!tournament) throw ApiError.notFound("Tournament not found");

  // refuse to orphan teams/matches — force explicit cleanup first
  const [teamCount, matchCount] = await Promise.all([
    Team.countDocuments({ tournament: tournament._id }),
    Match.countDocuments({ tournament: tournament._id }),
  ]);
  if (teamCount > 0 || matchCount > 0) {
    throw ApiError.conflict(
      "Remove this tournament's teams and matches before deleting it"
    );
  }

  await tournament.deleteOne();
  return sendSuccess(res, null, "Tournament deleted successfully");
});

export const setTournamentStatus = (status: "ONGOING" | "COMPLETED") =>
  asyncHandler(async (req: Request, res: Response) => {
    const tournament = await Tournament.findById(req.params.id);
    if (!tournament) throw ApiError.notFound("Tournament not found");

    if (tournament.status === status) {
      throw ApiError.conflict(`Tournament is already ${status.toLowerCase()}`);
    }

    tournament.status = status;
    await tournament.save();

    return sendSuccess(
      res,
      tournament,
      status === "ONGOING" ? "Tournament started" : "Tournament ended"
    );
  });

/**
 * Seasons are tournament editions grouped by series name, so this derives the
 * season list from tournaments rather than duplicating them in their own
 * collection (which would have to be kept in sync).
 */
export const listSeasons = asyncHandler(async (_req: Request, res: Response) => {
  const tournaments = await Tournament.find()
    .select("name shortName seriesName seasonName seasonNumber startDate endDate status")
    .sort({ seriesName: 1, seasonNumber: -1, startDate: -1 })
    .lean();

  const seriesMap = new Map<string, typeof tournaments>();
  for (const t of tournaments) {
    const key = t.seriesName ?? "Other";
    seriesMap.set(key, [...(seriesMap.get(key) ?? []), t]);
  }

  const data = Array.from(seriesMap.entries()).map(([seriesName, seasons]) => ({
    seriesName,
    seasons,
  }));

  return sendSuccess(res, data, "Seasons loaded");
});
