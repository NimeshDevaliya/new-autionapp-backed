import mongoose, { Document, Schema, Types } from "mongoose";
import {
  PLAYER_CATEGORIES,
  PLAYER_ROLES,
  PlayerCategory,
  PlayerRole,
} from "../types/enums";

/**
 * A Player is a reusable profile. Team membership, sold price and auction status
 * are tournament-scoped and live on TeamSquad / AuctionPlayer, so the same player
 * can appear across multiple tournaments and seasons without data duplication.
 */
export interface IPlayer extends Document {
  _id: Types.ObjectId;
  fullName: string;
  profileImage?: string;
  dateOfBirth?: Date;
  battingStyle?: string;
  bowlingStyle?: string;
  role: PlayerRole;
  category: PlayerCategory;
  basePrice: number;
  isActive: boolean;
  /** Optional external cricket profile link (carried over from the previous system). */
  externalProfileUrl?: string;
  /** Player id in the scoring system the league records matches on (CricHeroes). */
  externalId?: number;
  /** Further CricHeroes ids that turned out to be the same person (duplicate profiles). */
  externalAliases: number[];
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const playerSchema = new Schema<IPlayer>(
  {
    fullName: { type: String, required: true, trim: true, index: true },
    profileImage: { type: String },
    dateOfBirth: { type: Date },
    battingStyle: { type: String, trim: true },
    bowlingStyle: { type: String, trim: true },
    role: { type: String, enum: PLAYER_ROLES, required: true, index: true },
    category: { type: String, enum: PLAYER_CATEGORIES, default: "LOCAL", index: true },
    basePrice: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true, index: true },
    externalProfileUrl: { type: String },
    externalId: { type: Number, index: true, unique: true, sparse: true },
    externalAliases: { type: [Number], default: [], index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true }
);

playerSchema.index({ fullName: "text" });
playerSchema.index({ role: 1, basePrice: 1 });

export const Player = mongoose.model<IPlayer>("Player", playerSchema);
