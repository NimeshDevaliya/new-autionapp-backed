import mongoose, { Document, Schema, Types } from "mongoose";

/** Append-only bid history. One document per accepted bid. */
export interface IBid extends Document {
  _id: Types.ObjectId;
  auction: Types.ObjectId;
  auctionPlayer: Types.ObjectId;
  team: Types.ObjectId;
  amount: number;
  /** The operator who registered the bid. */
  placedBy?: Types.ObjectId;
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
    placedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true }
);

bidSchema.index({ auctionPlayer: 1, createdAt: -1 });

export const Bid = mongoose.model<IBid>("Bid", bidSchema);
