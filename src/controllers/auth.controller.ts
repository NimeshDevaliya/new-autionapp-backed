import { Request, Response } from "express";
import { Admin } from "../models/Admin";
import { signToken } from "../middleware/auth";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body as { email: string; password: string };

  // password is select:false on the model, so request it explicitly
  const admin = await Admin.findOne({ email }).select("+password");

  // same message for unknown email and wrong password — don't leak which
  if (!admin || !(await admin.comparePassword(password))) {
    throw ApiError.unauthorized("Invalid email or password");
  }

  if (admin.status !== "ACTIVE") {
    throw ApiError.forbidden("This account has been deactivated");
  }

  admin.lastLoginAt = new Date();
  await admin.save();

  const token = signToken(admin._id.toString(), admin.role);

  return sendSuccess(
    res,
    {
      token,
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        status: admin.status,
      },
    },
    "Logged in successfully"
  );
});

/**
 * Tokens are stateless, so logout is acknowledged here and the client discards
 * the token. Kept as an endpoint so the frontend has a single place to hook
 * session teardown (and so audit logging can be added later).
 */
export const logout = asyncHandler(async (_req: Request, res: Response) => {
  return sendSuccess(res, null, "Logged out successfully");
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const admin = await Admin.findById(req.admin!.id);
  if (!admin) throw ApiError.notFound("Account not found");
  return sendSuccess(res, admin, "Profile loaded");
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword: string;
    newPassword: string;
  };

  const admin = await Admin.findById(req.admin!.id).select("+password");
  if (!admin) throw ApiError.notFound("Account not found");

  if (!(await admin.comparePassword(currentPassword))) {
    throw ApiError.badRequest("Current password is incorrect");
  }

  admin.password = newPassword;
  await admin.save();

  return sendSuccess(res, null, "Password changed successfully");
});
