import { Request, Response } from "express";
import { Auction } from "../models/Auction";
import { Team } from "../models/Team";
import { TeamOwner } from "../models/TeamOwner";
import { TeamSquad } from "../models/TeamSquad";
import { signOwnerToken } from "../middleware/team-auth";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body as { email: string; password: string };

  const owner = await TeamOwner.findOne({ email }).select("+password");
  // same message for unknown email and wrong password — don't leak which
  if (!owner || !(await owner.comparePassword(password))) {
    throw ApiError.unauthorized("Invalid email or password");
  }
  if (owner.status !== "ACTIVE") {
    throw ApiError.forbidden("This account has been deactivated");
  }

  const team = await Team.findById(owner.team).lean();
  if (!team) throw ApiError.notFound("This account's team no longer exists");

  owner.lastLoginAt = new Date();
  await owner.save();

  return sendSuccess(
    res,
    {
      token: signOwnerToken(owner._id.toString(), owner.team.toString()),
      owner: { id: owner._id, name: owner.name, email: owner.email },
      team: {
        _id: team._id,
        name: team.name,
        shortName: team.shortName,
        logo: team.logo,
        color: team.color,
      },
    },
    "Logged in successfully"
  );
});

/** Owner + their team's purse/squad count + the auction their team app should follow. */
export const me = asyncHandler(async (req: Request, res: Response) => {
  const owner = await TeamOwner.findById(req.owner!.id).lean();
  if (!owner) throw ApiError.notFound("Account not found");

  const team = await Team.findById(owner.team).lean();
  if (!team) throw ApiError.notFound("Team not found");

  const [squadCount, auctions] = await Promise.all([
    TeamSquad.countDocuments({ team: team._id, tournament: team.tournament }),
    Auction.find({ tournament: team.tournament })
      .sort({ createdAt: -1 })
      .select("name status")
      .lean(),
  ]);
  // prefer whatever is running right now, otherwise the newest auction
  const auction =
    auctions.find((a) => a.status === "LIVE" || a.status === "PAUSED") ??
    auctions[0] ??
    null;

  return sendSuccess(
    res,
    {
      owner: { id: owner._id, name: owner.name, email: owner.email },
      team: { ...team, remainingBudget: team.budget - team.spent, squadCount },
      auction,
    },
    "Profile loaded"
  );
});
