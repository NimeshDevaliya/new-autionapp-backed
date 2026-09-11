import { Request, Response } from "express";
import { Team } from "../models/Team";
import { TeamSquad } from "../models/TeamSquad";
import { Tournament } from "../models/Tournament";
import { ApiError } from "../utils/ApiError";
import {
  buildPaginationMeta,
  parsePagination,
  sendCreated,
  sendSuccess,
} from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";
import { buildSort } from "../validators/common";
import { getTeamStatistics } from "../services/statistics.service";

const SORTABLE = ["name", "budget", "spent", "createdAt"];

export const listTeams = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { search, tournament, status, sortBy, sortOrder } = req.query as Record<
    string,
    string | undefined
  >;

  const filter: Record<string, unknown> = {};
  if (tournament) filter.tournament = tournament;
  if (status) filter.status = status;
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { shortName: { $regex: search, $options: "i" } },
      { ownerName: { $regex: search, $options: "i" } },
    ];
  }

  const [teams, total] = await Promise.all([
    Team.find(filter)
      .populate("tournament", "name shortName status")
      .sort(buildSort(sortBy, sortOrder, SORTABLE, { name: 1 }))
      .skip(skip)
      .limit(limit)
      .lean(),
    Team.countDocuments(filter),
  ]);

  const counts = await TeamSquad.aggregate<{ _id: unknown; count: number }>([
    { $match: { team: { $in: teams.map((t) => t._id) } } },
    { $group: { _id: "$team", count: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.count]));

  const data = teams.map((team) => ({
    ...team,
    playersBought: countMap.get(String(team._id)) ?? 0,
    remainingBudget: team.budget - team.spent,
  }));

  return sendSuccess(
    res,
    data,
    "Teams loaded",
    200,
    buildPaginationMeta(page, limit, total)
  );
});

export const getTeam = asyncHandler(async (req: Request, res: Response) => {
  const team = await Team.findById(req.params.id)
    .populate("tournament", "name shortName status startDate endDate")
    .lean();
  if (!team) throw ApiError.notFound("Team not found");

  const [squadCount, stats] = await Promise.all([
    TeamSquad.countDocuments({ team: team._id }),
    getTeamStatistics(String(team._id)),
  ]);

  return sendSuccess(
    res,
    {
      ...team,
      remainingBudget: team.budget - team.spent,
      playersBought: squadCount,
      playersRemaining: Math.max(0, team.minPlayers - squadCount),
      stats,
    },
    "Team loaded"
  );
});

export const getTeamSquad = asyncHandler(async (req: Request, res: Response) => {
  const team = await Team.findById(req.params.id);
  if (!team) throw ApiError.notFound("Team not found");

  const squad = await TeamSquad.find({ team: team._id })
    .populate("player", "fullName profileImage role battingStyle bowlingStyle category")
    .sort({ soldPrice: -1 })
    .lean();

  return sendSuccess(res, squad, "Squad loaded");
});

export const createTeam = asyncHandler(async (req: Request, res: Response) => {
  const tournament = await Tournament.findById(req.body.tournament);
  if (!tournament) throw ApiError.badRequest("Tournament not found");

  const team = await Team.create({ ...req.body, createdBy: req.admin!.id });
  return sendCreated(res, team, "Team created successfully");
});

export const updateTeam = asyncHandler(async (req: Request, res: Response) => {
  const team = await Team.findById(req.params.id);
  if (!team) throw ApiError.notFound("Team not found");

  // budget can't drop below what's already committed
  if (req.body.budget !== undefined && req.body.budget < team.spent) {
    throw ApiError.badRequest(
      `Budget cannot be lower than the ${team.spent} already spent`
    );
  }

  Object.assign(team, req.body);
  await team.save();

  return sendSuccess(res, team, "Team updated successfully");
});

export const deleteTeam = asyncHandler(async (req: Request, res: Response) => {
  const team = await Team.findById(req.params.id);
  if (!team) throw ApiError.notFound("Team not found");

  const squadCount = await TeamSquad.countDocuments({ team: team._id });
  if (squadCount > 0) {
    throw ApiError.conflict(
      "This team has players in its squad. Remove them before deleting the team."
    );
  }

  await team.deleteOne();
  return sendSuccess(res, null, "Team deleted successfully");
});
