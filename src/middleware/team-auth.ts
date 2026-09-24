import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { TeamOwner } from "../models/TeamOwner";
import { ApiError } from "../utils/ApiError";

export interface OwnerAuthPayload {
  sub: string;
  kind: "owner";
  teamId: string;
}

export interface OwnerIdentity {
  id: string;
  name: string;
  email: string;
  teamId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      owner?: OwnerIdentity;
    }
  }
}

export function signOwnerToken(ownerId: string, teamId: string): string {
  return jwt.sign(
    { sub: ownerId, kind: "owner", teamId } as OwnerAuthPayload,
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn } as jwt.SignOptions
  );
}

/**
 * Turns a bearer token into an owner identity, or null for anything that is not
 * a valid, unexpired token of an ACTIVE owner. Shared by the REST middleware and
 * the WebSocket `auth` message.
 */
export async function resolveOwnerToken(token: string): Promise<OwnerIdentity | null> {
  let payload: OwnerAuthPayload;
  try {
    payload = jwt.verify(token, env.jwtSecret) as OwnerAuthPayload;
  } catch {
    return null;
  }
  if (payload.kind !== "owner") return null;

  const owner = await TeamOwner.findById(payload.sub);
  if (!owner || owner.status !== "ACTIVE") return null;

  return {
    id: owner._id.toString(),
    name: owner.name,
    email: owner.email,
    teamId: owner.team.toString(),
  };
}

/** Requires a team-owner session. Admin tokens are rejected here on purpose. */
export async function authenticateOwner(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
    if (!token) throw ApiError.unauthorized("Authentication required");

    const owner = await resolveOwnerToken(token);
    if (!owner) throw ApiError.unauthorized("Invalid or expired team session");

    req.owner = owner;
    next();
  } catch (err) {
    next(err);
  }
}
