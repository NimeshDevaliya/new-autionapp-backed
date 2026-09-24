import { Request, Response } from "express";
import { Team } from "../models/Team";
import { TeamOwner } from "../models/TeamOwner";
import { ApiError } from "../utils/ApiError";
import { sendCreated, sendSuccess } from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";

async function requireTeam(id: string) {
  const team = await Team.findById(id);
  if (!team) throw ApiError.notFound("Team not found");
  return team;
}

export const listOwners = asyncHandler(async (req: Request, res: Response) => {
  await requireTeam(req.params.id);
  const owners = await TeamOwner.find({ team: req.params.id }).sort({ createdAt: 1 });
  return sendSuccess(res, owners, "Owners loaded");
});

export const createOwner = asyncHandler(async (req: Request, res: Response) => {
  const team = await requireTeam(req.params.id);
  const existing = await TeamOwner.findOne({ email: req.body.email });
  if (existing) throw ApiError.conflict("An owner with this email already exists");

  const owner = await TeamOwner.create({ ...req.body, team: team._id });
  return sendCreated(res, owner, "Owner created successfully");
});

export const updateOwner = asyncHandler(async (req: Request, res: Response) => {
  const owner = await TeamOwner.findOne({ _id: req.params.ownerId, team: req.params.id });
  if (!owner) throw ApiError.notFound("Owner not found");

  // password runs through the pre-save hash like any other change
  Object.assign(owner, req.body);
  await owner.save();
  return sendSuccess(res, owner, "Owner updated");
});

export const deleteOwner = asyncHandler(async (req: Request, res: Response) => {
  const owner = await TeamOwner.findOneAndDelete({
    _id: req.params.ownerId,
    team: req.params.id,
  });
  if (!owner) throw ApiError.notFound("Owner not found");
  return sendSuccess(res, null, "Owner deleted");
});
