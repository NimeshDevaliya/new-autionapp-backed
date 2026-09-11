import { Request, Response } from "express";
import { Types } from "mongoose";
import { sendSuccess } from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";
import {
  ALL_ROUNDER_WICKET_WEIGHT,
  allRounderLeaderboard,
  battingLeaderboard,
  bowlingLeaderboard,
  fieldingLeaderboard,
  getDashboardStatistics,
  getPointsTable,
} from "../services/statistics.service";

export const getDashboard = asyncHandler(async (_req: Request, res: Response) => {
  const stats = await getDashboardStatistics();
  return sendSuccess(res, stats, "Dashboard statistics loaded");
});

export const getLeaderboards = asyncHandler(async (req: Request, res: Response) => {
  const { tournament, limit } = req.query as Record<string, string | undefined>;
  const tournamentId = tournament ? new Types.ObjectId(tournament) : undefined;
  const max = limit ? Number(limit) : 10;

  const [topRunScorers, topWicketTakers, topAllRounders, topFielders] =
    await Promise.all([
      battingLeaderboard(tournamentId, max),
      bowlingLeaderboard(tournamentId, max),
      allRounderLeaderboard(tournamentId, max),
      fieldingLeaderboard(tournamentId, max),
    ]);

  return sendSuccess(
    res,
    {
      allRounderWicketWeight: ALL_ROUNDER_WICKET_WEIGHT,
      topRunScorers,
      topWicketTakers,
      topAllRounders,
      topFielders,
    },
    "Leaderboards loaded"
  );
});

export const getTournamentPointsTable = asyncHandler(
  async (req: Request, res: Response) => {
    const table = await getPointsTable(req.params.id);
    return sendSuccess(res, table, "Points table loaded");
  }
);
