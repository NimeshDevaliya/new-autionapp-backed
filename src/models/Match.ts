import mongoose, { Document, Schema, Types } from "mongoose";
import { MATCH_STATUSES, MatchStatus } from "../types/enums";

export interface IMatch extends Document {
  _id: Types.ObjectId;
  tournament: Types.ObjectId;
  matchNumber?: number;
  teamA: Types.ObjectId;
  teamB: Types.ObjectId;
  matchDate?: Date;
  venue?: string;
  status: MatchStatus;
  tossWonBy?: Types.ObjectId | null;
  tossDecision?: "BAT" | "BOWL";
  winner?: Types.ObjectId | null;
  result?: string;
  overs?: number;
  createdAt: Date;
  updatedAt: Date;
}

const matchSchema = new Schema<IMatch>(
  {
    tournament: {
      type: Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },
    matchNumber: { type: Number },
    teamA: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true },
    teamB: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true },
    matchDate: { type: Date, index: true },
    venue: { type: String, trim: true },
    status: {
      type: String,
      enum: MATCH_STATUSES,
      default: "SCHEDULED",
      index: true,
    },
    tossWonBy: { type: Schema.Types.ObjectId, ref: "Team", default: null },
    tossDecision: { type: String, enum: ["BAT", "BOWL"] },
    winner: { type: Schema.Types.ObjectId, ref: "Team", default: null },
    result: { type: String },
    /** Overs per innings for this match format (e.g. 20 for T20). */
    overs: { type: Number, default: 20 },
  },
  { timestamps: true }
);

matchSchema.index({ tournament: 1, matchDate: -1 });

export const Match = mongoose.model<IMatch>("Match", matchSchema);
