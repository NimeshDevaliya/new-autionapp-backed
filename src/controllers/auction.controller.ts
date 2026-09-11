import { Request, Response } from "express";
import { Auction } from "../models/Auction";
import { AuctionPlayer } from "../models/AuctionPlayer";
import { Bid } from "../models/Bid";
import { Player } from "../models/Player";
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
import { broadcast } from "../sockets";
import { AUCTION_EVENTS } from "../types/enums";
import {
  calculateNextBid,
  hasPendingPlayers,
  markCurrentPlayerUnsold,
  placeBid,
  sellCurrentPlayer,
  setCurrentPlayer,
} from "../services/auction.service";

/* ------------------------------------------------------------ auctions --- */

export const listAuctions = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { tournament, status } = req.query as Record<string, string | undefined>;

  const filter: Record<string, unknown> = {};
  if (tournament) filter.tournament = tournament;
  if (status) filter.status = status;

  const [auctions, total] = await Promise.all([
    Auction.find(filter)
      .populate("tournament", "name shortName status")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Auction.countDocuments(filter),
  ]);

  return sendSuccess(
    res,
    auctions,
    "Auctions loaded",
    200,
    buildPaginationMeta(page, limit, total)
  );
});

export const getAuction = asyncHandler(async (req: Request, res: Response) => {
  const auction = await Auction.findById(req.params.id)
    .populate("tournament", "name shortName status")
    .lean();
  if (!auction) throw ApiError.notFound("Auction not found");

  const [total, sold, unsold, pending] = await Promise.all([
    AuctionPlayer.countDocuments({ auction: auction._id }),
    AuctionPlayer.countDocuments({ auction: auction._id, status: "SOLD" }),
    AuctionPlayer.countDocuments({ auction: auction._id, status: "UNSOLD" }),
    AuctionPlayer.countDocuments({ auction: auction._id, status: "PENDING" }),
  ]);

  return sendSuccess(
    res,
    { ...auction, counts: { total, sold, unsold, pending } },
    "Auction loaded"
  );
});

/** Everything a live auction screen needs, in one request. */
export const getAuctionState = asyncHandler(async (req: Request, res: Response) => {
  const auction = await Auction.findById(req.params.id).lean();
  if (!auction) throw ApiError.notFound("Auction not found");

  const [currentPlayer, teams, squadCounts] = await Promise.all([
    auction.currentAuctionPlayer
      ? AuctionPlayer.findById(auction.currentAuctionPlayer)
          .populate("player")
          .populate("currentBiddingTeam", "name shortName logo color")
          .lean()
      : Promise.resolve(null),
    Team.find({ tournament: auction.tournament }).sort({ name: 1 }).lean(),
    TeamSquad.aggregate<{ _id: unknown; count: number; spent: number }>([
      { $match: { tournament: auction.tournament } },
      {
        $group: {
          _id: "$team",
          count: { $sum: 1 },
          spent: { $sum: "$soldPrice" },
        },
      },
    ]),
  ]);

  const countMap = new Map(squadCounts.map((c) => [String(c._id), c]));

  const teamState = teams.map((team) => {
    const agg = countMap.get(String(team._id));
    return {
      ...team,
      remainingBudget: team.budget - team.spent,
      playersBought: agg?.count ?? 0,
      isHighestBidder:
        !!currentPlayer?.currentBiddingTeam &&
        String(
          (currentPlayer.currentBiddingTeam as { _id?: unknown })._id ??
            currentPlayer.currentBiddingTeam
        ) === String(team._id),
    };
  });

  const bidHistory = currentPlayer
    ? await Bid.find({ auctionPlayer: currentPlayer._id })
        .populate("team", "name shortName logo color")
        .sort({ createdAt: -1 })
        .limit(25)
        .lean()
    : [];

  const nextBid = currentPlayer
    ? calculateNextBid(
        currentPlayer.basePrice,
        currentPlayer.currentBid,
        auction.bidIncrementTiers
      )
    : null;

  return sendSuccess(
    res,
    { auction, currentPlayer, nextBid, teams: teamState, bidHistory },
    "Auction state loaded"
  );
});

export const createAuction = asyncHandler(async (req: Request, res: Response) => {
  const tournament = await Tournament.findById(req.body.tournament);
  if (!tournament) throw ApiError.badRequest("Tournament not found");

  const auction = await Auction.create({ ...req.body, createdBy: req.admin!.id });
  return sendCreated(res, auction, "Auction created successfully");
});

export const updateAuction = asyncHandler(async (req: Request, res: Response) => {
  const auction = await Auction.findById(req.params.id);
  if (!auction) throw ApiError.notFound("Auction not found");

  if (auction.status === "COMPLETED") {
    throw ApiError.conflict("A completed auction cannot be modified");
  }

  Object.assign(auction, req.body);
  await auction.save();

  return sendSuccess(res, auction, "Auction updated successfully");
});

export const deleteAuction = asyncHandler(async (req: Request, res: Response) => {
  const auction = await Auction.findById(req.params.id);
  if (!auction) throw ApiError.notFound("Auction not found");

  const soldCount = await AuctionPlayer.countDocuments({
    auction: auction._id,
    status: "SOLD",
  });
  if (soldCount > 0) {
    throw ApiError.conflict(
      "This auction has completed sales and cannot be deleted"
    );
  }

  await AuctionPlayer.deleteMany({ auction: auction._id });
  await Bid.deleteMany({ auction: auction._id });
  await auction.deleteOne();

  return sendSuccess(res, null, "Auction deleted successfully");
});

/* ----------------------------------------------------- auction players --- */

export const listAuctionPlayers = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.query as Record<string, string | undefined>;

  const filter: Record<string, unknown> = { auction: req.params.id };
  if (status) filter.status = status;

  const players = await AuctionPlayer.find(filter)
    .populate("player", "fullName profileImage role battingStyle bowlingStyle category")
    .populate("soldToTeam", "name shortName logo color")
    .populate("currentBiddingTeam", "name shortName logo color")
    .sort({ order: 1, createdAt: 1 })
    .lean();

  return sendSuccess(res, players, "Auction players loaded");
});

export const addAuctionPlayers = asyncHandler(async (req: Request, res: Response) => {
  const auction = await Auction.findById(req.params.id);
  if (!auction) throw ApiError.notFound("Auction not found");
  if (auction.status === "COMPLETED") {
    throw ApiError.conflict("A completed auction cannot be modified");
  }

  const entries = req.body.players as Array<{
    player: string;
    basePrice?: number;
    order?: number;
    category?: string;
  }>;

  const playerDocs = await Player.find({
    _id: { $in: entries.map((e) => e.player) },
  }).lean();
  const playerMap = new Map(playerDocs.map((p) => [String(p._id), p]));

  const existing = await AuctionPlayer.distinct("player", { auction: auction._id });
  const existingSet = new Set(existing.map(String));

  const highestOrder = await AuctionPlayer.findOne({ auction: auction._id })
    .sort({ order: -1 })
    .select("order")
    .lean();
  let nextOrder = (highestOrder?.order ?? 0) + 1;

  const toInsert = [];
  const skipped: string[] = [];

  for (const entry of entries) {
    const player = playerMap.get(entry.player);
    if (!player) {
      skipped.push(entry.player);
      continue;
    }
    if (existingSet.has(entry.player)) {
      skipped.push(entry.player);
      continue;
    }
    toInsert.push({
      auction: auction._id,
      player: player._id,
      basePrice: entry.basePrice ?? player.basePrice,
      order: entry.order ?? nextOrder++,
      category: entry.category,
    });
  }

  const inserted = toInsert.length
    ? await AuctionPlayer.insertMany(toInsert)
    : [];

  return sendCreated(
    res,
    { added: inserted.length, skipped: skipped.length, players: inserted },
    `${inserted.length} player(s) added to the auction`
  );
});

export const removeAuctionPlayer = asyncHandler(
  async (req: Request, res: Response) => {
    const auctionPlayer = await AuctionPlayer.findOne({
      _id: req.params.playerId,
      auction: req.params.id,
    });
    if (!auctionPlayer) throw ApiError.notFound("Auction player not found");
    if (auctionPlayer.status === "SOLD") {
      throw ApiError.conflict("A sold player cannot be removed from the auction");
    }

    await auctionPlayer.deleteOne();
    return sendSuccess(res, null, "Player removed from the auction");
  }
);

/* ------------------------------------------------------ auction control --- */

export const startAuction = asyncHandler(async (req: Request, res: Response) => {
  const auction = await Auction.findById(req.params.id);
  if (!auction) throw ApiError.notFound("Auction not found");

  if (auction.status === "LIVE") throw ApiError.conflict("The auction is already live");
  if (auction.status === "COMPLETED") {
    throw ApiError.conflict("This auction has already been completed");
  }

  const queued = await AuctionPlayer.countDocuments({ auction: auction._id });
  if (queued === 0) {
    throw ApiError.conflict("Add players to the auction before starting it");
  }

  auction.status = "LIVE";
  auction.startedAt = auction.startedAt ?? new Date();
  await auction.save();

  broadcast(String(auction._id), AUCTION_EVENTS.AUCTION_STARTED, { auction });

  return sendSuccess(res, auction, "Auction started");
});

export const pauseAuction = asyncHandler(async (req: Request, res: Response) => {
  const auction = await Auction.findById(req.params.id);
  if (!auction) throw ApiError.notFound("Auction not found");
  if (auction.status !== "LIVE") throw ApiError.conflict("The auction is not live");

  auction.status = "PAUSED";
  auction.pausedAt = new Date();
  await auction.save();

  broadcast(String(auction._id), AUCTION_EVENTS.AUCTION_PAUSED, { auction });

  return sendSuccess(res, auction, "Auction paused");
});

export const resumeAuction = asyncHandler(async (req: Request, res: Response) => {
  const auction = await Auction.findById(req.params.id);
  if (!auction) throw ApiError.notFound("Auction not found");
  if (auction.status !== "PAUSED") throw ApiError.conflict("The auction is not paused");

  auction.status = "LIVE";
  await auction.save();

  broadcast(String(auction._id), AUCTION_EVENTS.AUCTION_RESUMED, { auction });

  return sendSuccess(res, auction, "Auction resumed");
});

export const completeAuction = asyncHandler(async (req: Request, res: Response) => {
  const auction = await Auction.findById(req.params.id);
  if (!auction) throw ApiError.notFound("Auction not found");
  if (auction.status === "COMPLETED") {
    throw ApiError.conflict("This auction is already completed");
  }

  auction.status = "COMPLETED";
  auction.completedAt = new Date();
  auction.currentAuctionPlayer = null;
  await auction.save();

  broadcast(String(auction._id), AUCTION_EVENTS.AUCTION_COMPLETED, { auction });

  return sendSuccess(res, auction, "Auction completed");
});

export const changeCurrentPlayer = asyncHandler(
  async (req: Request, res: Response) => {
    const { auction, auctionPlayer } = await setCurrentPlayer(
      req.params.id,
      req.body.auctionPlayerId
    );

    if (!auctionPlayer) {
      return sendSuccess(
        res,
        { auction, auctionPlayer: null },
        "No players remaining in the queue"
      );
    }

    const populated = await AuctionPlayer.findById(auctionPlayer._id)
      .populate("player")
      .lean();

    broadcast(String(auction._id), AUCTION_EVENTS.PLAYER_CHANGED, {
      auctionPlayer: populated,
      nextBid: calculateNextBid(
        auctionPlayer.basePrice,
        auctionPlayer.currentBid,
        auction.bidIncrementTiers
      ),
    });

    return sendSuccess(
      res,
      { auction, auctionPlayer: populated },
      "Player is now under the hammer"
    );
  }
);

export const placeBidHandler = asyncHandler(async (req: Request, res: Response) => {
  const { auction, auctionPlayer, bid, team } = await placeBid({
    auctionId: req.params.id,
    teamId: req.body.teamId,
    amount: req.body.amount,
    placedBy: req.admin!.id,
  });

  const nextBid = calculateNextBid(
    auctionPlayer.basePrice,
    auctionPlayer.currentBid,
    auction.bidIncrementTiers
  );

  broadcast(String(auction._id), AUCTION_EVENTS.BID_PLACED, {
    auctionPlayerId: auctionPlayer._id,
    currentBid: auctionPlayer.currentBid,
    nextBid,
    team: {
      _id: team._id,
      name: team.name,
      shortName: team.shortName,
      logo: team.logo,
      color: team.color,
    },
    bidId: bid._id,
  });

  return sendSuccess(
    res,
    { auctionPlayer, bid, nextBid },
    "Bid placed successfully"
  );
});

export const sellPlayerHandler = asyncHandler(async (req: Request, res: Response) => {
  const { auction, auctionPlayer, team, soldPrice } = await sellCurrentPlayer(
    req.params.id
  );

  const populated = await AuctionPlayer.findById(auctionPlayer._id)
    .populate("player", "fullName profileImage role")
    .lean();

  broadcast(String(auction._id), AUCTION_EVENTS.PLAYER_SOLD, {
    auctionPlayer: populated,
    soldPrice,
    team: {
      _id: team._id,
      name: team.name,
      shortName: team.shortName,
      logo: team.logo,
      remainingBudget: team.budget - team.spent,
    },
  });

  return sendSuccess(
    res,
    { auctionPlayer: populated, team, soldPrice },
    "Player sold successfully"
  );
});

export const markUnsoldHandler = asyncHandler(async (req: Request, res: Response) => {
  const { auction, auctionPlayer } = await markCurrentPlayerUnsold(req.params.id);

  const populated = await AuctionPlayer.findById(auctionPlayer._id)
    .populate("player", "fullName profileImage role")
    .lean();

  broadcast(String(auction._id), AUCTION_EVENTS.PLAYER_UNSOLD, {
    auctionPlayer: populated,
  });

  return sendSuccess(res, populated, "Player marked unsold");
});

/** Moves to the next pending player, completing the auction if none remain. */
export const nextPlayerHandler = asyncHandler(async (req: Request, res: Response) => {
  const stillPending = await hasPendingPlayers(req.params.id);
  if (!stillPending) {
    const auction = await Auction.findById(req.params.id);
    if (!auction) throw ApiError.notFound("Auction not found");

    auction.status = "COMPLETED";
    auction.completedAt = new Date();
    auction.currentAuctionPlayer = null;
    await auction.save();

    broadcast(String(auction._id), AUCTION_EVENTS.AUCTION_COMPLETED, { auction });
    return sendSuccess(res, { auction, auctionPlayer: null }, "Auction completed");
  }

  const { auction, auctionPlayer } = await setCurrentPlayer(req.params.id);
  const populated = auctionPlayer
    ? await AuctionPlayer.findById(auctionPlayer._id).populate("player").lean()
    : null;

  broadcast(String(auction._id), AUCTION_EVENTS.PLAYER_CHANGED, {
    auctionPlayer: populated,
  });

  return sendSuccess(
    res,
    { auction, auctionPlayer: populated },
    "Moved to the next player"
  );
});

/* -------------------------------------------------------------- results --- */

export const getAuctionResults = asyncHandler(async (req: Request, res: Response) => {
  const auction = await Auction.findById(req.params.id).lean();
  if (!auction) throw ApiError.notFound("Auction not found");

  const { team, role } = req.query as Record<string, string | undefined>;

  const [sold, unsold, teams] = await Promise.all([
    AuctionPlayer.find({ auction: auction._id, status: "SOLD" })
      .populate("player", "fullName profileImage role category")
      .populate("soldToTeam", "name shortName logo color")
      .sort({ soldPrice: -1 })
      .lean(),
    AuctionPlayer.find({ auction: auction._id, status: "UNSOLD" })
      .populate("player", "fullName profileImage role category")
      .lean(),
    Team.find({ tournament: auction.tournament }).lean(),
  ]);

  let soldFiltered = sold;
  if (team) {
    soldFiltered = soldFiltered.filter(
      (p) => String((p.soldToTeam as { _id?: unknown })?._id) === team
    );
  }
  if (role) {
    soldFiltered = soldFiltered.filter(
      (p) => (p.player as { role?: string })?.role === role
    );
  }

  const totalAmount = sold.reduce((sum, p) => sum + (p.soldPrice ?? 0), 0);

  const teamWise = teams.map((t) => {
    const players = sold.filter(
      (p) => String((p.soldToTeam as { _id?: unknown })?._id) === String(t._id)
    );
    return {
      team: t,
      players,
      totalSpent: players.reduce((sum, p) => sum + (p.soldPrice ?? 0), 0),
      playerCount: players.length,
      remainingBudget: t.budget - t.spent,
    };
  });

  return sendSuccess(
    res,
    {
      sold: soldFiltered,
      unsold,
      teamWise,
      summary: {
        totalSold: sold.length,
        totalUnsold: unsold.length,
        totalAmount,
        highestBuy: sold[0] ?? null,
        lowestBuy: sold.length ? sold[sold.length - 1] : null,
      },
    },
    "Auction results loaded"
  );
});
