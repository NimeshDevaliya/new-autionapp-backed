import { Request, Response } from "express";
import { Types } from "mongoose";
import { sendSuccess } from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";
import {
  getDashboardStatistics,
  getPointsTable,
  leaderboard,
} from "../services/statistics.service";

export const getDashboard = asyncHandler(async (_req: Request, res: Response) => {
  const stats = await getDashboardStatistics();
  return sendSuccess(res, stats, "Dashboard statistics loaded");
});

export const getLeaderboards = asyncHandler(async (req: Request, res: Response) => {
  const { tournament, limit } = req.query as Record<string, string | undefined>;
  const tournamentId = tournament ? new Types.ObjectId(tournament) : undefined;
  const max = limit ? Number(limit) : 10;

  const [topRunScorers, topWicketTakers] = await Promise.all([
    leaderboard("runs", tournamentId, max),
    leaderboard("wickets", tournamentId, max),
  ]);

  return sendSuccess(
    res,
    { topRunScorers, topWicketTakers },
    "Leaderboards loaded"
  );
});

export const getTournamentPointsTable = asyncHandler(
  async (req: Request, res: Response) => {
    const table = await getPointsTable(req.params.id);
    return sendSuccess(res, table, "Points table loaded");
  }
);
