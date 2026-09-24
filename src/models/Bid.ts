import mongoose, { Document, Schema, Types } from "mongoose";
import { BID_SOURCES, BidSource } from "../types/enums";

/** Append-only bid history. One document per accepted bid. */
export interface IBid extends Document {
  _id: Types.ObjectId;
  auction: Types.ObjectId;
  auctionPlayer: Types.ObjectId;
  team: Types.ObjectId;
  amount: number;
  /** Where the bid came from: the operator console or the team's own app. */
  source: BidSource;
  /** The operator who registered a console bid. */
  placedBy?: Types.ObjectId;
  /** The team owner who tapped Bid in the team app. */
  placedByOwner?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const bidSchema = new Schema<IBid>(
  {
    auction: {
      type: Schema.Types.ObjectId,
      ref: "Auction",
      required: true,
      index: true,
    },
    auctionPlayer: {
      type: Schema.Types.ObjectId,
      ref: "AuctionPlayer",
      required: true,
      index: true,
    },
    team: {
      type: Schema.Types.ObjectId,
      ref: "Team",
      required: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 0 },
    source: { type: String, enum: BID_SOURCES, default: "CONSOLE" },
    placedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    placedByOwner: { type: Schema.Types.ObjectId, ref: "TeamOwner" },
  },
  { timestamps: true }
);

bidSchema.index({ auctionPlayer: 1, createdAt: -1 });

export const Bid = mongoose.model<IBid>("Bid", bidSchema);
