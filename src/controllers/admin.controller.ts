import { Request, Response } from "express";
import { Admin } from "../models/Admin";
import { ApiError } from "../utils/ApiError";
import {
  buildPaginationMeta,
  parsePagination,
  sendCreated,
  sendSuccess,
} from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";
import { buildSort } from "../validators/common";

const SORTABLE = ["name", "email", "role", "status", "createdAt"];

export const listAdmins = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { search, role, status, sortBy, sortOrder } = req.query as Record<
    string,
    string | undefined
  >;

  const filter: Record<string, unknown> = {};
  if (role) filter.role = role;
  if (status) filter.status = status;
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }

  const [admins, total] = await Promise.all([
    Admin.find(filter)
      .sort(buildSort(sortBy, sortOrder, SORTABLE))
      .skip(skip)
      .limit(limit),
    Admin.countDocuments(filter),
  ]);

  return sendSuccess(
    res,
    admins,
    "Admins loaded",
    200,
    buildPaginationMeta(page, limit, total)
  );
});

export const getAdmin = asyncHandler(async (req: Request, res: Response) => {
  const admin = await Admin.findById(req.params.id);
  if (!admin) throw ApiError.notFound("Admin not found");
  return sendSuccess(res, admin, "Admin loaded");
});

export const createAdmin = asyncHandler(async (req: Request, res: Response) => {
  const existing = await Admin.findOne({ email: req.body.email });
  if (existing) throw ApiError.conflict("An admin with this email already exists");

  const admin = await Admin.create(req.body);
  return sendCreated(res, admin, "Admin created successfully");
});

export const updateAdmin = asyncHandler(async (req: Request, res: Response) => {
  const admin = await Admin.findById(req.params.id);
  if (!admin) throw ApiError.notFound("Admin not found");

  if (req.body.email && req.body.email !== admin.email) {
    const clash = await Admin.findOne({ email: req.body.email });
    if (clash) throw ApiError.conflict("An admin with this email already exists");
  }

  // guard against removing the last active super admin
  if (
    admin.role === "SUPER_ADMIN" &&
    (req.body.role === "AUCTION_ADMIN" || req.body.status === "INACTIVE")
  ) {
    const activeSuperAdmins = await Admin.countDocuments({
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      _id: { $ne: admin._id },
    });
    if (activeSuperAdmins === 0) {
      throw ApiError.conflict(
        "At least one active super admin must remain"
      );
    }
  }

  Object.assign(admin, req.body);
  await admin.save();

  return sendSuccess(res, admin, "Admin updated successfully");
});

export const resetAdminPassword = asyncHandler(
  async (req: Request, res: Response) => {
    const admin = await Admin.findById(req.params.id).select("+password");
    if (!admin) throw ApiError.notFound("Admin not found");

    admin.password = req.body.newPassword;
    await admin.save();

    return sendSuccess(res, null, "Password reset successfully");
  }
);

export const deleteAdmin = asyncHandler(async (req: Request, res: Response) => {
  const admin = await Admin.findById(req.params.id);
  if (!admin) throw ApiError.notFound("Admin not found");

  if (admin._id.toString() === req.admin!.id) {
    throw ApiError.conflict("You cannot delete your own account");
  }

  if (admin.role === "SUPER_ADMIN") {
    const remaining = await Admin.countDocuments({
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      _id: { $ne: admin._id },
    });
    if (remaining === 0) {
      throw ApiError.conflict("At least one active super admin must remain");
    }
  }

  await admin.deleteOne();
  return sendSuccess(res, null, "Admin deleted successfully");
});
