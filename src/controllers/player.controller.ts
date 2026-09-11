import { Request, Response } from "express";
import { Types } from "mongoose";
import { Player } from "../models/Player";
import { TeamSquad } from "../models/TeamSquad";
import { AuctionPlayer } from "../models/AuctionPlayer";
import { ApiError } from "../utils/ApiError";
import {
  buildPaginationMeta,
  parsePagination,
  sendCreated,
  sendSuccess,
} from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";
import { buildSort } from "../validators/common";
import {
  getPlayerSeasonStatistics,
  getPlayerStatistics,
} from "../services/statistics.service";

const SORTABLE = ["fullName", "basePrice", "role", "createdAt"];

export const listPlayers = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip } = parsePagination(req.query);
  const {
    search,
    role,
    category,
    tournament,
    team,
    auction,
    auctionStatus,
    minPrice,
    maxPrice,
    isActive,
    sortBy,
    sortOrder,
  } = req.query as Record<string, string | undefined>;

  const filter: Record<string, unknown> = {};
  if (role) filter.role = role;
  if (category) filter.category = category;
  if (isActive) filter.isActive = isActive === "true";
  if (search) filter.fullName = { $regex: search, $options: "i" };

  if (minPrice || maxPrice) {
    const range: Record<string, number> = {};
    if (minPrice) range.$gte = Number(minPrice);
    if (maxPrice) range.$lte = Number(maxPrice);
    filter.basePrice = range;
  }

  // team/tournament/auction filters narrow the player set by association
  if (team || tournament) {
    const squadFilter: Record<string, unknown> = {};
    if (team) squadFilter.team = team;
    if (tournament) squadFilter.tournament = tournament;
    const playerIds = await TeamSquad.distinct("player", squadFilter);
    filter._id = { $in: playerIds };
  }

  if (auction || auctionStatus) {
    const apFilter: Record<string, unknown> = {};
    if (auction) apFilter.auction = auction;
    if (auctionStatus) apFilter.status = auctionStatus;
    const playerIds = await AuctionPlayer.distinct("player", apFilter);
    filter._id = filter._id
      ? {
          $in: (filter._id as { $in: Types.ObjectId[] }).$in.filter((id) =>
            playerIds.some((pid) => String(pid) === String(id))
          ),
        }
      : { $in: playerIds };
  }

  const [players, total] = await Promise.all([
    Player.find(filter)
      .sort(buildSort(sortBy, sortOrder, SORTABLE, { fullName: 1 }))
      .skip(skip)
      .limit(limit)
      .lean(),
    Player.countDocuments(filter),
  ]);

  // attach current team membership so the list can show it without N+1 calls
  const squads = await TeamSquad.find({ player: { $in: players.map((p) => p._id) } })
    .populate("team", "name shortName logo color")
    .select("player team soldPrice tournament")
    .lean();
  const squadMap = new Map(squads.map((s) => [String(s.player), s]));

  const data = players.map((player) => {
    const squad = squadMap.get(String(player._id));
    return {
      ...player,
      currentTeam: squad?.team ?? null,
      soldPrice: squad?.soldPrice ?? null,
    };
  });

  return sendSuccess(
    res,
    data,
    "Players loaded",
    200,
    buildPaginationMeta(page, limit, total)
  );
});

export const getPlayer = asyncHandler(async (req: Request, res: Response) => {
  const player = await Player.findById(req.params.id).lean();
  if (!player) throw ApiError.notFound("Player not found");

  const [squads, auctionEntries] = await Promise.all([
    TeamSquad.find({ player: player._id })
      .populate("team", "name shortName logo color")
      .populate("tournament", "name seriesName seasonName status")
      .sort({ createdAt: -1 })
      .lean(),
    AuctionPlayer.find({ player: player._id })
      .populate("soldToTeam", "name shortName logo")
      .populate({
        path: "auction",
        select: "name tournament status",
        populate: { path: "tournament", select: "name seasonName" },
      })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  return sendSuccess(
    res,
    {
      ...player,
      currentTeam: squads[0]?.team ?? null,
      currentSquad: squads[0] ?? null,
      squadHistory: squads,
      auctionHistory: auctionEntries,
    },
    "Player loaded"
  );
});

export const getPlayerStats = asyncHandler(async (req: Request, res: Response) => {
  const player = await Player.findById(req.params.id);
  if (!player) throw ApiError.notFound("Player not found");

  const { tournament, seriesName } = req.query as Record<string, string | undefined>;

  const [career, scoped, seasons] = await Promise.all([
    getPlayerStatistics(req.params.id),
    tournament || seriesName
      ? getPlayerStatistics(req.params.id, { tournament, seriesName })
      : Promise.resolve(null),
    getPlayerSeasonStatistics(req.params.id),
  ]);

  return sendSuccess(
    res,
    { career, scoped, seasons },
    "Player statistics loaded"
  );
});

export const createPlayer = asyncHandler(async (req: Request, res: Response) => {
  const player = await Player.create({ ...req.body, createdBy: req.admin!.id });
  return sendCreated(res, player, "Player added successfully");
});

export const updatePlayer = asyncHandler(async (req: Request, res: Response) => {
  const player = await Player.findById(req.params.id);
  if (!player) throw ApiError.notFound("Player not found");

  Object.assign(player, req.body);
  await player.save();

  return sendSuccess(res, player, "Player updated successfully");
});

export const deletePlayer = asyncHandler(async (req: Request, res: Response) => {
  const player = await Player.findById(req.params.id);
  if (!player) throw ApiError.notFound("Player not found");

  const squadCount = await TeamSquad.countDocuments({ player: player._id });
  if (squadCount > 0) {
    throw ApiError.conflict(
      "This player belongs to a squad and cannot be deleted. Deactivate them instead."
    );
  }

  await AuctionPlayer.deleteMany({ player: player._id, status: "PENDING" });
  await player.deleteOne();

  return sendSuccess(res, null, "Player deleted successfully");
});
