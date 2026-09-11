import mongoose, { Document, Schema, Types } from "mongoose";
import { TEAM_STATUSES, TeamStatus } from "../types/enums";

export interface ITeam extends Document {
  _id: Types.ObjectId;
  name: string;
  shortName?: string;
  logo?: string;
  ownerName?: string;
  color?: string;
  /** Total purse allocated to this team for the tournament. */
  budget: number;
  /** Purse already committed on bought players. Maintained by the auction engine. */
  spent: number;
  maxPlayers: number;
  minPlayers: number;
  maxForeignPlayers?: number;
  status: TeamStatus;
  tournament: Types.ObjectId;
  /** Team id in the scoring system the league records matches on (CricHeroes). */
  externalId?: number;
  /**
   * Points the league awarded outside the win/loss record (bonus or penalty
   * points), so the derived table can match the official one.
   */
  pointsAdjustment: number;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  readonly remainingBudget: number;
}

const teamSchema = new Schema<ITeam>(
  {
    name: { type: String, required: true, trim: true, index: true },
    shortName: { type: String, trim: true },
    logo: { type: String },
    ownerName: { type: String, trim: true },
    color: { type: String, default: "#1e293b" },
    budget: { type: Number, required: true, min: 0 },
    spent: { type: Number, default: 0, min: 0 },
    maxPlayers: { type: Number, default: 25, min: 1 },
    minPlayers: { type: Number, default: 11, min: 0 },
    maxForeignPlayers: { type: Number },
    status: { type: String, enum: TEAM_STATUSES, default: "ACTIVE", index: true },
    tournament: {
      type: Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },
    externalId: { type: Number, index: true },
    pointsAdjustment: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "Admin" },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/** Derived rather than stored, so it can never drift from budget/spent. */
teamSchema.virtual("remainingBudget").get(function remaining(this: ITeam) {
  return this.budget - this.spent;
});

teamSchema.index({ name: "text", shortName: "text", ownerName: "text" });
teamSchema.index({ tournament: 1, name: 1 }, { unique: true });

export const Team = mongoose.model<ITeam>("Team", teamSchema);
