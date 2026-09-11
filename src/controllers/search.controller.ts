import { Request, Response } from "express";
import { Player } from "../models/Player";
import { Team } from "../models/Team";
import { Tournament } from "../models/Tournament";
import { Match } from "../models/Match";
import { TeamSquad } from "../models/TeamSquad";
import { sendSuccess } from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";

/** Global search across players, teams, tournaments and matches. */
export const globalSearch = asyncHandler(async (req: Request, res: Response) => {
  const { q, limit } = req.query as { q: string; limit?: string };
  const max = limit ? Number(limit) : 5;
  const regex = { $regex: q, $options: "i" };

  const [players, teams, tournaments, matches] = await Promise.all([
    Player.find({ fullName: regex })
      .select("fullName profileImage role basePrice category")
      .limit(max)
      .lean(),
    Team.find({ $or: [{ name: regex }, { shortName: regex }, { ownerName: regex }] })
      .select("name shortName logo color ownerName budget spent tournament")
      .populate("tournament", "name")
      .limit(max)
      .lean(),
    Tournament.find({
      $or: [{ name: regex }, { seriesName: regex }, { location: regex }],
    })
      .select("name shortName logo status startDate endDate location")
      .limit(max)
      .lean(),
    Match.find({ venue: regex })
      .select("matchNumber venue matchDate status teamA teamB")
      .populate("teamA", "name shortName logo")
      .populate("teamB", "name shortName logo")
      .limit(max)
      .lean(),
  ]);

  // enrich player hits with their current team, as the search UI shows it
  const squads = await TeamSquad.find({ player: { $in: players.map((p) => p._id) } })
    .populate("team", "name shortName logo color")
    .select("player team")
    .lean();
  const squadMap = new Map(squads.map((s) => [String(s.player), s.team]));

  return sendSuccess(
    res,
    {
      players: players.map((p) => ({
        ...p,
        currentTeam: squadMap.get(String(p._id)) ?? null,
      })),
      teams,
      tournaments,
      matches,
    },
    "Search results loaded"
  );
});
