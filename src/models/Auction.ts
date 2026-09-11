import mongoose, { Document, Schema, Types } from "mongoose";
import { AUCTION_STATUSES, AuctionStatus } from "../types/enums";

/**
 * A bid increment tier. The engine selects the tier with the highest `threshold`
 * that is <= the current bid, then adds its `increment`.
 *
 * The previous system hardcoded "+1 below 40, +2 at/above 40"; that rule is expressed
 * here as [{ threshold: 0, increment: 1 }, { threshold: 40, increment: 2 }].
 */
export interface IBidIncrementTier {
  threshold: number;
  increment: number;
}

export interface IAuction extends Document {
  _id: Types.ObjectId;
  name: string;
  tournament: Types.ObjectId;
  status: AuctionStatus;
  bidIncrementTiers: IBidIncrementTier[];
  /** Squad rules enforced server-side on every bid and sale. */
  maxSquadSize: number;
  minSquadSize: number;
  maxForeignPlayers?: number;
  /** Optional per-player countdown, in seconds. 0/undefined disables the timer. */
  timerSeconds?: number;
  currentAuctionPlayer?: Types.ObjectId | null;
  startedAt?: Date;
  pausedAt?: Date;
  completedAt?: Date;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const bidIncrementTierSchema = new Schema<IBidIncrementTier>(
  {
    threshold: { type: Number, required: true, min: 0 },
    increment: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const auctionSchema = new Schema<IAuction>(
  {
    name: { type: String, required: true, trim: true },
    tournament: {
      type: Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: AUCTION_STATUSES,
      default: "DRAFT",
      index: true,
    },
    bidIncrementTiers: {
      type: [bidIncrementTierSchema],
      default: () => [
        { threshold: 0, increment: 1 },
        { threshold: 40, increment: 2 },
      ],
    },
    maxSquadSize: { type: Number, default: 11, min: 1 },
    minSquadSize: { type: Number, default: 0, min: 0 },
    maxForeignPlayers: { type: Number },
    timerSeconds: { type: Number, default: 0, min: 0 },
    currentAuctionPlayer: {
      type: Schema.Types.ObjectId,
      ref: "AuctionPlayer",
      default: null,
    },
    startedAt: { type: Date },
    pausedAt: { type: Date },
    completedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true }
);

export const Auction = mongoose.model<IAuction>("Auction", auctionSchema);
