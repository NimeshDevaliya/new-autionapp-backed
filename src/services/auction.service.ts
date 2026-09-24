import mongoose, { Types } from "mongoose";
import { Auction, IAuction, IBidIncrementTier } from "../models/Auction";
import { AuctionPlayer, IAuctionPlayer } from "../models/AuctionPlayer";
import { Bid } from "../models/Bid";
import { Team } from "../models/Team";
import { TeamSquad } from "../models/TeamSquad";
import { BidSource } from "../types/enums";
import { ApiError } from "../utils/ApiError";

/**
 * Resolves the bid increment that applies at a given bid level: the tier with the
 * highest `threshold` that is <= currentBid.
 */
export function incrementFor(
  currentBid: number,
  tiers: IBidIncrementTier[]
): number {
  if (!tiers.length) return 1;
  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);
  let applicable = sorted[0];
  for (const tier of sorted) {
    if (currentBid >= tier.threshold) applicable = tier;
  }
  return applicable.increment;
}

/**
 * The next legal bid for a player.
 *
 * Preserves the original rule: the opening bid equals the base price, and every
 * subsequent bid adds the increment for the current level.
 */
export function calculateNextBid(
  basePrice: number,
  currentBid: number,
  tiers: IBidIncrementTier[]
): number {
  if (!currentBid || currentBid <= 0) return basePrice;
  return currentBid + incrementFor(currentBid, tiers);
}

export const BID_ERROR_CODES = [
  "NOT_LIVE",
  "PAUSED",
  "NO_CURRENT_PLAYER",
  "TEAM_INACTIVE",
  "TEAM_NOT_IN_TOURNAMENT",
  "ALREADY_HIGHEST",
  "STALE_AMOUNT",
  "OUTBID",
  "OVER_BUDGET",
  "SQUAD_FULL",
] as const;
export type BidErrorCode = (typeof BID_ERROR_CODES)[number];

/** An ApiError with a machine-readable code so the socket can tell clients why. */
export class BidError extends ApiError {
  constructor(
    public readonly code: BidErrorCode,
    statusCode: number,
    message: string,
    public readonly nextBid?: number
  ) {
    super(statusCode, message);
  }
}

export interface PlaceBidInput {
  auctionId: string;
  teamId: string;
  /** Explicit amount. When omitted the next legal bid is used. */
  amount?: number;
  /**
   * Team-app mode: the amount must equal the next legal bid exactly, so a tap
   * meant for 42 can never land at 46.
   */
  exact?: boolean;
  source?: BidSource;
  placedBy?: string;
  placedByOwner?: string;
}

interface TeamBidState {
  squadCount: number;
  remainingBudget: number;
}

async function getTeamBidState(
  teamId: Types.ObjectId,
  tournamentId: Types.ObjectId,
  budget: number,
  spent: number
): Promise<TeamBidState> {
  const squadCount = await TeamSquad.countDocuments({
    team: teamId,
    tournament: tournamentId,
  });
  return { squadCount, remainingBudget: budget - spent };
}

/**
 * Validates and records a bid. Every rule is enforced here, server-side — the
 * client is never trusted with budget or increment arithmetic.
 *
 * The write is a conditional update on the bid the caller saw, so two teams
 * bidding in the same instant can never both succeed: the second one gets
 * OUTBID with the fresh next amount.
 */
export async function placeBid(input: PlaceBidInput) {
  const auction = await Auction.findById(input.auctionId);
  if (!auction) throw ApiError.notFound("Auction not found");

  if (auction.status === "PAUSED") {
    throw new BidError("PAUSED", 409, "The auction is paused");
  }
  if (auction.status !== "LIVE") {
    throw new BidError("NOT_LIVE", 409, "The auction is not live");
  }
  if (!auction.currentAuctionPlayer) {
    throw new BidError("NO_CURRENT_PLAYER", 409, "No player is currently under the hammer");
  }

  const auctionPlayer = await AuctionPlayer.findById(auction.currentAuctionPlayer);
  if (!auctionPlayer) throw ApiError.notFound("Current auction player not found");

  if (auctionPlayer.status === "SOLD") {
    throw new BidError("NO_CURRENT_PLAYER", 409, "This player has already been sold");
  }
  if (auctionPlayer.status === "UNSOLD") {
    throw new BidError("NO_CURRENT_PLAYER", 409, "This player has been marked unsold");
  }
  if (auctionPlayer.status !== "IN_AUCTION") {
    throw new BidError(
      "NO_CURRENT_PLAYER",
      409,
      "This player is not currently under the hammer"
    );
  }

  const team = await Team.findById(input.teamId);
  if (!team) throw ApiError.notFound("Team not found");
  if (team.status !== "ACTIVE") {
    throw new BidError("TEAM_INACTIVE", 403, "This team is not active in the auction");
  }
  if (team.tournament.toString() !== auction.tournament.toString()) {
    throw new BidError(
      "TEAM_NOT_IN_TOURNAMENT",
      400,
      "This team does not belong to the auction's tournament"
    );
  }

  if (
    auctionPlayer.currentBiddingTeam &&
    auctionPlayer.currentBiddingTeam.toString() === team._id.toString()
  ) {
    throw new BidError("ALREADY_HIGHEST", 409, "This team already holds the highest bid");
  }

  const nextBid = calculateNextBid(
    auctionPlayer.basePrice,
    auctionPlayer.currentBid,
    auction.bidIncrementTiers
  );
  const amount = input.amount ?? nextBid;

  if (amount < nextBid) {
    // the client saw an older state — someone else got there first
    throw new BidError(
      "OUTBID",
      400,
      `Bid must be at least ${nextBid}. Received ${amount}.`,
      nextBid
    );
  }
  if (input.exact && amount !== nextBid) {
    throw new BidError(
      "STALE_AMOUNT",
      409,
      `The next bid is ${nextBid}, not ${amount}.`,
      nextBid
    );
  }

  const { squadCount, remainingBudget } = await getTeamBidState(
    team._id,
    team.tournament,
    team.budget,
    team.spent
  );

  if (squadCount >= team.maxPlayers || squadCount >= auction.maxSquadSize) {
    throw new BidError("SQUAD_FULL", 409, `${team.name} has reached the maximum squad size`);
  }
  if (amount > remainingBudget) {
    throw new BidError(
      "OVER_BUDGET",
      409,
      `${team.name} has insufficient budget. Remaining: ${remainingBudget}, bid: ${amount}.`
    );
  }

  // Only succeeds if nobody changed the lot since we read it.
  const updated = await AuctionPlayer.findOneAndUpdate(
    {
      _id: auctionPlayer._id,
      status: "IN_AUCTION",
      currentBid: auctionPlayer.currentBid,
      currentBiddingTeam: { $ne: team._id },
    },
    { $set: { currentBid: amount, currentBiddingTeam: team._id } },
    { new: true }
  );

  if (!updated) {
    const fresh = await AuctionPlayer.findById(auctionPlayer._id);
    if (!fresh || fresh.status !== "IN_AUCTION") {
      throw new BidError("NO_CURRENT_PLAYER", 409, "This player is no longer under the hammer");
    }
    if (fresh.currentBiddingTeam?.toString() === team._id.toString()) {
      throw new BidError("ALREADY_HIGHEST", 409, "This team already holds the highest bid");
    }
    const freshNext = calculateNextBid(
      fresh.basePrice,
      fresh.currentBid,
      auction.bidIncrementTiers
    );
    throw new BidError(
      "OUTBID",
      409,
      `Another team bid first. The next bid is ${freshNext}.`,
      freshNext
    );
  }

  const bid = await Bid.create({
    auction: auction._id,
    auctionPlayer: updated._id,
    team: team._id,
    amount,
    source: input.source ?? "CONSOLE",
    placedBy: input.placedBy,
    placedByOwner: input.placedByOwner,
  });

  const nextAfter = calculateNextBid(
    updated.basePrice,
    updated.currentBid,
    auction.bidIncrementTiers
  );
  return { auction, auctionPlayer: updated, bid, team, nextBid: nextAfter };
}

/**
 * Finalises a sale atomically: marks the player sold, debits the team purse and
 * writes the squad record. Uses a transaction so the purse can never drift.
 */
export async function sellCurrentPlayer(auctionId: string) {
  const auction = await Auction.findById(auctionId);
  if (!auction) throw ApiError.notFound("Auction not found");
  if (auction.status !== "LIVE") {
    throw ApiError.conflict("The auction is not live");
  }
  if (!auction.currentAuctionPlayer) {
    throw ApiError.conflict("No player is currently under the hammer");
  }

  const auctionPlayer = await AuctionPlayer.findById(auction.currentAuctionPlayer);
  if (!auctionPlayer) throw ApiError.notFound("Current auction player not found");
  if (auctionPlayer.status === "SOLD") {
    throw ApiError.conflict("This player has already been sold");
  }
  if (!auctionPlayer.currentBiddingTeam || auctionPlayer.currentBid <= 0) {
    throw ApiError.conflict("No bids have been placed on this player");
  }

  const team = await Team.findById(auctionPlayer.currentBiddingTeam);
  if (!team) throw ApiError.notFound("Winning team not found");

  const soldPrice = auctionPlayer.currentBid;

  // Re-check affordability at settlement time to guard against races.
  const { squadCount, remainingBudget } = await getTeamBidState(
    team._id,
    team.tournament,
    team.budget,
    team.spent
  );
  if (soldPrice > remainingBudget) {
    throw ApiError.conflict(
      `${team.name} no longer has enough budget for this player`
    );
  }
  if (squadCount >= team.maxPlayers) {
    throw ApiError.conflict(`${team.name} has reached the maximum squad size`);
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      auctionPlayer.status = "SOLD";
      auctionPlayer.soldPrice = soldPrice;
      auctionPlayer.soldToTeam = team._id;
      auctionPlayer.soldAt = new Date();
      await auctionPlayer.save({ session });

      team.spent += soldPrice;
      await team.save({ session });

      await TeamSquad.create(
        [
          {
            tournament: team.tournament,
            team: team._id,
            player: auctionPlayer.player,
            basePrice: auctionPlayer.basePrice,
            soldPrice,
            acquisitionType: "AUCTION",
            auction: auction._id,
          },
        ],
        { session }
      );

      auction.currentAuctionPlayer = null;
      await auction.save({ session });
    });
  } finally {
    await session.endSession();
  }

  return { auction, auctionPlayer, team, soldPrice };
}

/** Marks the current player unsold and clears the live bid state. */
export async function markCurrentPlayerUnsold(auctionId: string) {
  const auction = await Auction.findById(auctionId);
  if (!auction) throw ApiError.notFound("Auction not found");
  if (auction.status !== "LIVE") {
    throw ApiError.conflict("The auction is not live");
  }
  if (!auction.currentAuctionPlayer) {
    throw ApiError.conflict("No player is currently under the hammer");
  }

  const auctionPlayer = await AuctionPlayer.findById(auction.currentAuctionPlayer);
  if (!auctionPlayer) throw ApiError.notFound("Current auction player not found");
  if (auctionPlayer.status === "SOLD") {
    throw ApiError.conflict("This player has already been sold");
  }

  auctionPlayer.status = "UNSOLD";
  auctionPlayer.currentBid = 0;
  auctionPlayer.currentBiddingTeam = null;
  await auctionPlayer.save();

  auction.currentAuctionPlayer = null;
  await auction.save();

  return { auction, auctionPlayer };
}

/**
 * Moves a specific player (or the next pending one) under the hammer.
 * Returns null when the queue is exhausted.
 */
export async function setCurrentPlayer(
  auctionId: string,
  auctionPlayerId?: string
): Promise<{ auction: IAuction; auctionPlayer: IAuctionPlayer | null }> {
  const auction = await Auction.findById(auctionId);
  if (!auction) throw ApiError.notFound("Auction not found");
  if (auction.status !== "LIVE") {
    throw ApiError.conflict("The auction is not live");
  }

  // Return any player still under the hammer to the queue before switching.
  if (auction.currentAuctionPlayer) {
    await AuctionPlayer.updateOne(
      { _id: auction.currentAuctionPlayer, status: "IN_AUCTION" },
      { $set: { status: "PENDING", currentBid: 0, currentBiddingTeam: null } }
    );
  }

  const next = auctionPlayerId
    ? await AuctionPlayer.findOne({ _id: auctionPlayerId, auction: auction._id })
    : await AuctionPlayer.findOne({
        auction: auction._id,
        status: "PENDING",
      }).sort({ order: 1, createdAt: 1 });

  if (!next) {
    auction.currentAuctionPlayer = null;
    await auction.save();
    return { auction, auctionPlayer: null };
  }

  if (next.status === "SOLD") {
    throw ApiError.conflict("That player has already been sold");
  }

  next.status = "IN_AUCTION";
  next.currentBid = 0;
  next.currentBiddingTeam = null;
  await next.save();

  auction.currentAuctionPlayer = next._id;
  await auction.save();

  return { auction, auctionPlayer: next };
}

/** True when no players remain to be auctioned. */
export async function hasPendingPlayers(auctionId: string): Promise<boolean> {
  const count = await AuctionPlayer.countDocuments({
    auction: auctionId,
    status: { $in: ["PENDING", "IN_AUCTION"] },
  });
  return count > 0;
}
