import mongoose, { Document, Schema, Types } from "mongoose";
import { DISMISSAL_TYPES, DismissalType } from "../types/enums";

/**
 * One batter's innings. Fielding statistics (catches, stumpings, run outs) are
 * derived from the dismissal fields here rather than stored separately, so they
 * can never disagree with the scorecard.
 */
export interface IBattingScore extends Document {
  _id: Types.ObjectId;
  innings: Types.ObjectId;
  match: Types.ObjectId;
  tournament: Types.ObjectId;
  player: Types.ObjectId;
  team: Types.ObjectId;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  isOut: boolean;
  dismissalType: DismissalType;
  /** Bowler credited with the wicket, when applicable. */
  dismissalBowler?: Types.ObjectId | null;
  /** Catcher / stumper / run-out fielder, when applicable. */
  dismissalFielder?: Types.ObjectId | null;
  battingPosition?: number;
  createdAt: Date;
  updatedAt: Date;
}

const battingScoreSchema = new Schema<IBattingScore>(
  {
    innings: { type: Schema.Types.ObjectId, ref: "Innings", required: true, index: true },
    match: { type: Schema.Types.ObjectId, ref: "Match", required: true, index: true },
    tournament: {
      type: Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },
    player: { type: Schema.Types.ObjectId, ref: "Player", required: true, index: true },
    team: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true },
    runs: { type: Number, default: 0, min: 0 },
    balls: { type: Number, default: 0, min: 0 },
    fours: { type: Number, default: 0, min: 0 },
    sixes: { type: Number, default: 0, min: 0 },
    isOut: { type: Boolean, default: false },
    dismissalType: {
      type: String,
      enum: DISMISSAL_TYPES,
      default: "NOT_OUT",
      index: true,
    },
    dismissalBowler: { type: Schema.Types.ObjectId, ref: "Player", default: null },
    dismissalFielder: {
      type: Schema.Types.ObjectId,
      ref: "Player",
      default: null,
      index: true,
    },
    battingPosition: { type: Number },
  },
  { timestamps: true }
);

battingScoreSchema.index({ player: 1, tournament: 1 });
battingScoreSchema.index({ innings: 1, player: 1 }, { unique: true });

export const BattingScore = mongoose.model<IBattingScore>(
  "BattingScore",
  battingScoreSchema
);
