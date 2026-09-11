import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { Admin } from "../models/Admin";
import { ApiError } from "../utils/ApiError";
import { AdminRole } from "../types/enums";

export interface AuthPayload {
  sub: string;
  role: AdminRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: {
        id: string;
        name: string;
        email: string;
        role: AdminRole;
      };
    }
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }
  return null;
}

/** Verifies the JWT and loads the admin, rejecting deactivated accounts. */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  try {
    const token = extractToken(req);
    if (!token) throw ApiError.unauthorized("Authentication required");

    let payload: AuthPayload;
    try {
      payload = jwt.verify(token, env.jwtSecret) as AuthPayload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw ApiError.unauthorized("Session expired, please log in again");
      }
      throw ApiError.unauthorized("Invalid authentication token");
    }

    const admin = await Admin.findById(payload.sub);
    if (!admin) throw ApiError.unauthorized("Account no longer exists");
    if (admin.status !== "ACTIVE") {
      throw ApiError.forbidden("This account has been deactivated");
    }

    req.admin = {
      id: admin._id.toString(),
      name: admin.name,
      email: admin.email,
      role: admin.role,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/** Restricts a route to the given admin roles. Must run after `authenticate`. */
export function authorize(...roles: AdminRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.admin) return next(ApiError.unauthorized());
    if (!roles.includes(req.admin.role)) {
      return next(
        ApiError.forbidden("You do not have permission to perform this action")
      );
    }
    next();
  };
}

export function signToken(adminId: string, role: AdminRole): string {
  return jwt.sign({ sub: adminId, role } as AuthPayload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  } as jwt.SignOptions);
}
