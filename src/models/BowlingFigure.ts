import mongoose, { Document, Schema, Types } from "mongoose";

/** One bowler's spell in an innings. */
export interface IBowlingFigure extends Document {
  _id: Types.ObjectId;
  innings: Types.ObjectId;
  match: Types.ObjectId;
  tournament: Types.ObjectId;
  player: Types.ObjectId;
  team: Types.ObjectId;
  /** Overs bowled in cricket notation (e.g. 3.4 = 3 overs and 4 balls). */
  overs: number;
  maidens: number;
  runsConceded: number;
  wickets: number;
  wides: number;
  noBalls: number;
  createdAt: Date;
  updatedAt: Date;
}

const bowlingFigureSchema = new Schema<IBowlingFigure>(
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
    overs: { type: Number, default: 0, min: 0 },
    maidens: { type: Number, default: 0, min: 0 },
    runsConceded: { type: Number, default: 0, min: 0 },
    wickets: { type: Number, default: 0, min: 0 },
    wides: { type: Number, default: 0, min: 0 },
    noBalls: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

bowlingFigureSchema.index({ player: 1, tournament: 1 });
bowlingFigureSchema.index({ innings: 1, player: 1 }, { unique: true });

export const BowlingFigure = mongoose.model<IBowlingFigure>(
  "BowlingFigure",
  bowlingFigureSchema
);
