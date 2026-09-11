import mongoose, { Document, Schema, Types } from "mongoose";
import bcrypt from "bcryptjs";
import { ADMIN_ROLES, ADMIN_STATUSES, AdminRole, AdminStatus } from "../types/enums";

export interface IAdmin extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password: string;
  role: AdminRole;
  status: AdminStatus;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

const adminSchema = new Schema<IAdmin>(
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
    role: { type: String, enum: ADMIN_ROLES, default: "AUCTION_ADMIN" },
    status: { type: String, enum: ADMIN_STATUSES, default: "ACTIVE" },
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

adminSchema.pre("save", async function hashPassword(next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

adminSchema.methods.comparePassword = function comparePassword(
  candidate: string
): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

export const Admin = mongoose.model<IAdmin>("Admin", adminSchema);
