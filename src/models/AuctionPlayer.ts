import mongoose, { Document, Schema, Types } from "mongoose";
import {
  AUCTION_PLAYER_STATUSES,
  AuctionPlayerStatus,
} from "../types/enums";

/** A player queued in a specific auction, with that auction's live bid state. */
export interface IAuctionPlayer extends Document {
  _id: Types.ObjectId;
  auction: Types.ObjectId;
  player: Types.ObjectId;
  /** Base price for this auction; may override the player's default base price. */
  basePrice: number;
  currentBid: number;
  currentBiddingTeam?: Types.ObjectId | null;
  status: AuctionPlayerStatus;
  soldPrice?: number | null;
  soldToTeam?: Types.ObjectId | null;
  /** Queue position for the auction order. */
  order: number;
  /** Optional grouping used to run category-wise auction rounds. */
  category?: string;
  soldAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const auctionPlayerSchema = new Schema<IAuctionPlayer>(
  {
    auction: {
      type: Schema.Types.ObjectId,
      ref: "Auction",
      required: true,
      index: true,
    },
    player: {
      type: Schema.Types.ObjectId,
      ref: "Player",
      required: true,
      index: true,
    },
    basePrice: { type: Number, required: true, min: 0 },
    currentBid: { type: Number, default: 0, min: 0 },
    currentBiddingTeam: {
      type: Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },
    status: {
      type: String,
      enum: AUCTION_PLAYER_STATUSES,
      default: "PENDING",
      index: true,
    },
    soldPrice: { type: Number, default: null },
    soldToTeam: { type: Schema.Types.ObjectId, ref: "Team", default: null },
    order: { type: Number, default: 0 },
    category: { type: String, trim: true },
    soldAt: { type: Date },
  },
  { timestamps: true }
);

// a player may only be queued once per auction
auctionPlayerSchema.index({ auction: 1, player: 1 }, { unique: true });
auctionPlayerSchema.index({ auction: 1, status: 1, order: 1 });

export const AuctionPlayer = mongoose.model<IAuctionPlayer>(
  "AuctionPlayer",
  auctionPlayerSchema
);
