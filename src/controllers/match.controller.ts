import { Request, Response } from "express";
import mongoose from "mongoose";
import { Match } from "../models/Match";
import { Innings } from "../models/Innings";
import { BattingScore } from "../models/BattingScore";
import { BowlingFigure } from "../models/BowlingFigure";
import { ApiError } from "../utils/ApiError";
import {
  buildPaginationMeta,
  parsePagination,
  sendCreated,
  sendSuccess,
} from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";

export const listMatches = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { tournament, team, status } = req.query as Record<string, string | undefined>;

  const filter: Record<string, unknown> = {};
  if (tournament) filter.tournament = tournament;
  if (status) filter.status = status;
  if (team) filter.$or = [{ teamA: team }, { teamB: team }];

  const [matches, total] = await Promise.all([
    Match.find(filter)
      .populate("teamA", "name shortName logo color")
      .populate("teamB", "name shortName logo color")
      .populate("winner", "name shortName")
      .populate("tournament", "name shortName")
      .sort({ matchDate: -1, matchNumber: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Match.countDocuments(filter),
  ]);

  return sendSuccess(
    res,
    matches,
    "Matches loaded",
    200,
    buildPaginationMeta(page, limit, total)
  );
});

export const getMatch = asyncHandler(async (req: Request, res: Response) => {
  const match = await Match.findById(req.params.id)
    .populate("teamA", "name shortName logo color")
    .populate("teamB", "name shortName logo color")
    .populate("winner", "name shortName")
    .populate("tournament", "name shortName")
    .lean();
  if (!match) throw ApiError.notFound("Match not found");

  const innings = await Innings.find({ match: match._id })
    .sort({ inningsNumber: 1 })
    .lean();

  const scorecard = await Promise.all(
    innings.map(async (inn) => {
      const [batting, bowling] = await Promise.all([
        BattingScore.find({ innings: inn._id })
          .populate("player", "fullName profileImage role")
          .populate("dismissalBowler", "fullName")
          .populate("dismissalFielder", "fullName")
          .sort({ battingPosition: 1 })
          .lean(),
        BowlingFigure.find({ innings: inn._id })
          .populate("player", "fullName profileImage role")
          .lean(),
      ]);
      return { innings: inn, batting, bowling };
    })
  );

  return sendSuccess(res, { ...match, scorecard }, "Match loaded");
});

export const createMatch = asyncHandler(async (req: Request, res: Response) => {
  if (req.body.teamA === req.body.teamB) {
    throw ApiError.badRequest("A match needs two different teams");
  }
  const match = await Match.create(req.body);
  return sendCreated(res, match, "Match created successfully");
});

export const updateMatch = asyncHandler(async (req: Request, res: Response) => {
  const match = await Match.findById(req.params.id);
  if (!match) throw ApiError.notFound("Match not found");

  Object.assign(match, req.body);
  await match.save();

  return sendSuccess(res, match, "Match updated successfully");
});

export const deleteMatch = asyncHandler(async (req: Request, res: Response) => {
  const match = await Match.findById(req.params.id);
  if (!match) throw ApiError.notFound("Match not found");

  const inningsIds = await Innings.distinct("_id", { match: match._id });
  await Promise.all([
    BattingScore.deleteMany({ innings: { $in: inningsIds } }),
    BowlingFigure.deleteMany({ innings: { $in: inningsIds } }),
    Innings.deleteMany({ match: match._id }),
  ]);
  await match.deleteOne();

  return sendSuccess(res, null, "Match deleted successfully");
});

/**
 * Records (or replaces) a full innings scorecard. Written in a transaction so a
 * partially-saved scorecard can never skew derived statistics.
 */
export const recordInnings = asyncHandler(async (req: Request, res: Response) => {
  const match = await Match.findById(req.params.id);
  if (!match) throw ApiError.notFound("Match not found");

  const {
    battingTeam,
    bowlingTeam,
    inningsNumber,
    totalRuns,
    totalWickets,
    totalOvers,
    extras,
    batting = [],
    bowling = [],
  } = req.body;

  const session = await mongoose.startSession();
  let inningsDoc;

  try {
    await session.withTransaction(async () => {
      const existing = await Innings.findOne({
        match: match._id,
        inningsNumber,
      }).session(session);

      if (existing) {
        await BattingScore.deleteMany({ innings: existing._id }).session(session);
        await BowlingFigure.deleteMany({ innings: existing._id }).session(session);
        await existing.deleteOne({ session });
      }

      const [created] = await Innings.create(
        [
          {
            match: match._id,
            tournament: match.tournament,
            battingTeam,
            bowlingTeam,
            inningsNumber,
            totalRuns: totalRuns ?? 0,
            totalWickets: totalWickets ?? 0,
            totalOvers: totalOvers ?? 0,
            extras: extras ?? 0,
          },
        ],
        { session }
      );
      inningsDoc = created;

      if (batting.length) {
        await BattingScore.create(
          batting.map((row: Record<string, unknown>) => ({
            ...row,
            innings: created._id,
            match: match._id,
            tournament: match.tournament,
            team: battingTeam,
          })),
          { session }
        );
      }

      if (bowling.length) {
        await BowlingFigure.create(
          bowling.map((row: Record<string, unknown>) => ({
            ...row,
            innings: created._id,
            match: match._id,
            tournament: match.tournament,
            team: bowlingTeam,
          })),
          { session }
        );
      }
    });
  } finally {
    await session.endSession();
  }

  return sendCreated(res, inningsDoc, "Scorecard saved successfully");
});
