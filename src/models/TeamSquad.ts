import mongoose, { Document, Schema, Types } from "mongoose";
import { ACQUISITION_TYPES, AcquisitionType } from "../types/enums";

/**
 * Durable roster membership: "this player belongs to this team for this tournament".
 * Kept separate from AuctionPlayer so squads survive independently of the auction
 * event that produced them (and so retained players need no auction record).
 */
export interface ITeamSquad extends Document {
  _id: Types.ObjectId;
  tournament: Types.ObjectId;
  team: Types.ObjectId;
  player: Types.ObjectId;
  basePrice: number;
  soldPrice: number;
  acquisitionType: AcquisitionType;
  auction?: Types.ObjectId | null;
  isCaptain: boolean;
  isViceCaptain: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const teamSquadSchema = new Schema<ITeamSquad>(
  {
    tournament: {
      type: Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },
    team: {
      type: Schema.Types.ObjectId,
      ref: "Team",
      required: true,
      index: true,
    },
    player: {
      type: Schema.Types.ObjectId,
      ref: "Player",
      required: true,
      index: true,
    },
    basePrice: { type: Number, default: 0, min: 0 },
    soldPrice: { type: Number, default: 0, min: 0 },
    acquisitionType: {
      type: String,
      enum: ACQUISITION_TYPES,
      default: "AUCTION",
    },
    auction: { type: Schema.Types.ObjectId, ref: "Auction", default: null },
    isCaptain: { type: Boolean, default: false },
    isViceCaptain: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// a player can belong to only one team per tournament
teamSquadSchema.index({ tournament: 1, player: 1 }, { unique: true });
teamSquadSchema.index({ tournament: 1, team: 1 });

export const TeamSquad = mongoose.model<ITeamSquad>(
  "TeamSquad",
  teamSquadSchema
);
