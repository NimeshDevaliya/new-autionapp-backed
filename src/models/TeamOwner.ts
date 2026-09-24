import mongoose, { Document, Schema, Types } from "mongoose";
import bcrypt from "bcryptjs";
import { TEAM_OWNER_STATUSES, TeamOwnerStatus } from "../types/enums";

/** A team owner's login. Owners bid for their own team from the team app. */
export interface ITeamOwner extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password: string;
  team: Types.ObjectId;
  status: TeamOwnerStatus;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

const teamOwnerSchema = new Schema<ITeamOwner>(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    // never returned by default — must be explicitly selected for auth checks
    password: { type: String, required: true, select: false },
    team: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true },
    status: { type: String, enum: TEAM_OWNER_STATUSES, default: "ACTIVE" },
    lastLoginAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete (ret as Record<string, unknown>).password;
        return ret;
      },
    },
  }
);

teamOwnerSchema.pre("save", async function hashPassword(next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

teamOwnerSchema.methods.comparePassword = function comparePassword(
  candidate: string
): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

export const TeamOwner = mongoose.model<ITeamOwner>("TeamOwner", teamOwnerSchema);
