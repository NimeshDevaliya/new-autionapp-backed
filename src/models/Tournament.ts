import mongoose, { Document, Schema, Types } from "mongoose";
import { TOURNAMENT_STATUSES, TournamentStatus } from "../types/enums";

export interface ITournament extends Document {
  _id: Types.ObjectId;
  name: string;
  shortName?: string;
  /**
   * Name of the league/series this edition belongs to (e.g. "MedianV Premier League").
   * Tournaments sharing a seriesName form the "seasons" of that series, which is what
   * powers season-by-season statistics grouping on player profiles.
   */
  seriesName?: string;
  /** Season label within the series, e.g. "Season 4". */
  seasonName?: string;
  seasonNumber?: number;
  logo?: string;
  startDate?: Date;
  endDate?: Date;
  location?: string;
  status: TournamentStatus;
  description?: string;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const tournamentSchema = new Schema<ITournament>(
  {
    name: { type: String, required: true, trim: true, index: true },
    shortName: { type: String, trim: true },
    seriesName: { type: String, trim: true, index: true },
    seasonName: { type: String, trim: true },
    seasonNumber: { type: Number },
    logo: { type: String },
    startDate: { type: Date },
    endDate: { type: Date },
    location: { type: String, trim: true },
    status: {
      type: String,
      enum: TOURNAMENT_STATUSES,
      default: "UPCOMING",
      index: true,
    },
    description: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true }
);

// text index powers global search across tournaments
tournamentSchema.index({ name: "text", seriesName: "text", location: "text" });
tournamentSchema.index({ seriesName: 1, seasonNumber: 1 });

export const Tournament = mongoose.model<ITournament>(
  "Tournament",
  tournamentSchema
);
