import { z } from "zod";
import {
  ADMIN_ROLES,
  ADMIN_STATUSES,
  AUCTION_PLAYER_STATUSES,
  DISMISSAL_TYPES,
  MATCH_STATUSES,
  PLAYER_CATEGORIES,
  PLAYER_ROLES,
  TEAM_STATUSES,
  TOURNAMENT_STATUSES,
} from "../types/enums";
import { listQuery, objectId } from "./common";

/* ---------------------------------------------------------------- auth --- */

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("A valid email is required"),
  password: z.string().min(1, "Password is required"),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

/* -------------------------------------------------------------- admins --- */

export const createAdminSchema = z.object({
  name: z.string().trim().min(2, "Name is required"),
  email: z.string().trim().toLowerCase().email("A valid email is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(ADMIN_ROLES).optional(),
  status: z.enum(ADMIN_STATUSES).optional(),
});

export const updateAdminSchema = z.object({
  name: z.string().trim().min(2).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  role: z.enum(ADMIN_ROLES).optional(),
  status: z.enum(ADMIN_STATUSES).optional(),
});

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

export const adminListQuery = listQuery.extend({
  role: z.enum(ADMIN_ROLES).optional(),
  status: z.enum(ADMIN_STATUSES).optional(),
});

/* --------------------------------------------------------- tournaments --- */

export const createTournamentSchema = z.object({
  name: z.string().trim().min(2, "Name is required"),
  shortName: z.string().trim().optional(),
  seriesName: z.string().trim().optional(),
  seasonName: z.string().trim().optional(),
  seasonNumber: z.coerce.number().int().min(0).optional(),
  logo: z.string().trim().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  location: z.string().trim().optional(),
  status: z.enum(TOURNAMENT_STATUSES).optional(),
  description: z.string().trim().optional(),
});

export const updateTournamentSchema = createTournamentSchema.partial();

export const tournamentListQuery = listQuery.extend({
  status: z.enum(TOURNAMENT_STATUSES).optional(),
  seriesName: z.string().trim().optional(),
});

/* --------------------------------------------------------------- teams --- */

export const createTeamSchema = z.object({
  name: z.string().trim().min(2, "Name is required"),
  shortName: z.string().trim().optional(),
  logo: z.string().trim().optional(),
  ownerName: z.string().trim().optional(),
  color: z.string().trim().optional(),
  budget: z.coerce.number().min(0, "Budget must be zero or more"),
  maxPlayers: z.coerce.number().int().min(1).optional(),
  minPlayers: z.coerce.number().int().min(0).optional(),
  maxForeignPlayers: z.coerce.number().int().min(0).optional(),
  status: z.enum(TEAM_STATUSES).optional(),
  tournament: objectId,
});

export const updateTeamSchema = createTeamSchema.partial().omit({ tournament: true });

export const teamListQuery = listQuery.extend({
  tournament: objectId.optional(),
  status: z.enum(TEAM_STATUSES).optional(),
});

/* ------------------------------------------------------------- players --- */

export const createPlayerSchema = z.object({
  fullName: z.string().trim().min(2, "Name is required"),
  profileImage: z.string().trim().optional(),
  dateOfBirth: z.coerce.date().optional(),
  battingStyle: z.string().trim().optional(),
  bowlingStyle: z.string().trim().optional(),
  role: z.enum(PLAYER_ROLES),
  category: z.enum(PLAYER_CATEGORIES).optional(),
  basePrice: z.coerce.number().min(0, "Base price must be zero or more"),
  isActive: z.boolean().optional(),
  externalProfileUrl: z.string().trim().optional(),
});

export const updatePlayerSchema = createPlayerSchema.partial();

export const playerListQuery = listQuery.extend({
  role: z.enum(PLAYER_ROLES).optional(),
  category: z.enum(PLAYER_CATEGORIES).optional(),
  tournament: objectId.optional(),
  team: objectId.optional(),
  auction: objectId.optional(),
  auctionStatus: z.enum(AUCTION_PLAYER_STATUSES).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  isActive: z.enum(["true", "false"]).optional(),
});

/* ------------------------------------------------------------ auctions --- */

const bidIncrementTierSchema = z.object({
  threshold: z.coerce.number().min(0),
  increment: z.coerce.number().min(1),
});

export const createAuctionSchema = z.object({
  name: z.string().trim().min(2, "Name is required"),
  tournament: objectId,
  bidIncrementTiers: z.array(bidIncrementTierSchema).min(1).optional(),
  maxSquadSize: z.coerce.number().int().min(1).optional(),
  minSquadSize: z.coerce.number().int().min(0).optional(),
  maxForeignPlayers: z.coerce.number().int().min(0).optional(),
  timerSeconds: z.coerce.number().int().min(0).optional(),
});

export const updateAuctionSchema = createAuctionSchema
  .partial()
  .omit({ tournament: true });

export const addAuctionPlayersSchema = z.object({
  players: z
    .array(
      z.object({
        player: objectId,
        basePrice: z.coerce.number().min(0).optional(),
        order: z.coerce.number().int().min(0).optional(),
        category: z.string().trim().optional(),
      })
    )
    .min(1, "At least one player is required"),
});

export const placeBidSchema = z.object({
  teamId: objectId,
  amount: z.coerce.number().min(0).optional(),
});

export const setCurrentPlayerSchema = z.object({
  auctionPlayerId: objectId.optional(),
});

/* ------------------------------------------------------------- matches --- */

export const createMatchSchema = z.object({
  tournament: objectId,
  matchNumber: z.coerce.number().int().min(1).optional(),
  teamA: objectId,
  teamB: objectId,
  matchDate: z.coerce.date().optional(),
  venue: z.string().trim().optional(),
  status: z.enum(MATCH_STATUSES).optional(),
  tossWonBy: objectId.optional(),
  tossDecision: z.enum(["BAT", "BOWL"]).optional(),
  winner: objectId.optional(),
  result: z.string().trim().optional(),
  overs: z.coerce.number().min(1).optional(),
});

export const updateMatchSchema = createMatchSchema.partial().omit({ tournament: true });

export const matchListQuery = listQuery.extend({
  tournament: objectId.optional(),
  team: objectId.optional(),
  status: z.enum(MATCH_STATUSES).optional(),
});

const battingScoreSchema = z.object({
  player: objectId,
  runs: z.coerce.number().min(0).optional(),
  balls: z.coerce.number().min(0).optional(),
  fours: z.coerce.number().min(0).optional(),
  sixes: z.coerce.number().min(0).optional(),
  isOut: z.boolean().optional(),
  dismissalType: z.enum(DISMISSAL_TYPES).optional(),
  dismissalBowler: objectId.optional().nullable(),
  dismissalFielder: objectId.optional().nullable(),
  battingPosition: z.coerce.number().int().min(1).optional(),
});

const bowlingFigureSchema = z.object({
  player: objectId,
  overs: z.coerce.number().min(0).optional(),
  maidens: z.coerce.number().min(0).optional(),
  runsConceded: z.coerce.number().min(0).optional(),
  wickets: z.coerce.number().min(0).optional(),
  wides: z.coerce.number().min(0).optional(),
  noBalls: z.coerce.number().min(0).optional(),
});

/** Full scorecard for one innings, replacing any existing entry. */
export const recordInningsSchema = z.object({
  battingTeam: objectId,
  bowlingTeam: objectId,
  inningsNumber: z.coerce.number().int().min(1),
  totalRuns: z.coerce.number().min(0).optional(),
  totalWickets: z.coerce.number().min(0).optional(),
  totalOvers: z.coerce.number().min(0).optional(),
  extras: z.coerce.number().min(0).optional(),
  batting: z.array(battingScoreSchema).optional(),
  bowling: z.array(bowlingFigureSchema).optional(),
});

/* ---------------------------------------------------------- statistics --- */

export const statsQuery = z.object({
  tournament: objectId.optional(),
  seriesName: z.string().trim().optional(),
  team: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const searchQuery = z.object({
  q: z.string().trim().min(1, "A search term is required"),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});
