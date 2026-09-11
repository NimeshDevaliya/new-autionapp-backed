import mongoose, { Document, Schema, Types } from "mongoose";

export interface IInnings extends Document {
  _id: Types.ObjectId;
  match: Types.ObjectId;
  tournament: Types.ObjectId;
  battingTeam: Types.ObjectId;
  bowlingTeam: Types.ObjectId;
  inningsNumber: number;
  totalRuns: number;
  totalWickets: number;
  /** Overs bowled, as a decimal where .1-.5 are balls (cricket notation). */
  totalOvers: number;
  extras: number;
  /** An all-out side is charged its full quota of overs when net run rate is worked out. */
  allOut: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const inningsSchema = new Schema<IInnings>(
  {
    match: { type: Schema.Types.ObjectId, ref: "Match", required: true, index: true },
    tournament: {
      type: Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },
    battingTeam: { type: Schema.Types.ObjectId, ref: "Team", required: true },
    bowlingTeam: { type: Schema.Types.ObjectId, ref: "Team", required: true },
    inningsNumber: { type: Number, required: true, min: 1 },
    totalRuns: { type: Number, default: 0, min: 0 },
    totalWickets: { type: Number, default: 0, min: 0 },
    totalOvers: { type: Number, default: 0, min: 0 },
    extras: { type: Number, default: 0, min: 0 },
    allOut: { type: Boolean, default: false },
  },
  { timestamps: true }
);

inningsSchema.index({ match: 1, inningsNumber: 1 }, { unique: true });

export const Innings = mongoose.model<IInnings>("Innings", inningsSchema);
