export const ADMIN_ROLES = ["SUPER_ADMIN", "AUCTION_ADMIN"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type AdminStatus = (typeof ADMIN_STATUSES)[number];

export const TOURNAMENT_STATUSES = ["UPCOMING", "ONGOING", "COMPLETED"] as const;
export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number];

export const TEAM_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type TeamStatus = (typeof TEAM_STATUSES)[number];

export const PLAYER_ROLES = [
  "BATTER",
  "BOWLER",
  "ALL_ROUNDER",
  "WICKET_KEEPER",
] as const;
export type PlayerRole = (typeof PLAYER_ROLES)[number];

export const PLAYER_CATEGORIES = ["LOCAL", "INTERNATIONAL"] as const;
export type PlayerCategory = (typeof PLAYER_CATEGORIES)[number];

export const AUCTION_STATUSES = [
  "DRAFT",
  "LIVE",
  "PAUSED",
  "COMPLETED",
] as const;
export type AuctionStatus = (typeof AUCTION_STATUSES)[number];

export const AUCTION_PLAYER_STATUSES = [
  "PENDING",
  "IN_AUCTION",
  "SOLD",
  "UNSOLD",
] as const;
export type AuctionPlayerStatus = (typeof AUCTION_PLAYER_STATUSES)[number];

export const ACQUISITION_TYPES = ["AUCTION", "RETAINED"] as const;
export type AcquisitionType = (typeof ACQUISITION_TYPES)[number];

export const MATCH_STATUSES = [
  "SCHEDULED",
  "LIVE",
  "COMPLETED",
  "ABANDONED",
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const DISMISSAL_TYPES = [
  "NOT_OUT",
  "BOWLED",
  "CAUGHT",
  "LBW",
  "RUN_OUT",
  "STUMPED",
  "HIT_WICKET",
  "RETIRED_HURT",
] as const;
export type DismissalType = (typeof DISMISSAL_TYPES)[number];

/** Realtime auction events broadcast over WebSocket. */
export const AUCTION_EVENTS = {
  AUCTION_STARTED: "AUCTION_STARTED",
  AUCTION_PAUSED: "AUCTION_PAUSED",
  AUCTION_RESUMED: "AUCTION_RESUMED",
  PLAYER_CHANGED: "PLAYER_CHANGED",
  BID_PLACED: "BID_PLACED",
  PLAYER_SOLD: "PLAYER_SOLD",
  PLAYER_UNSOLD: "PLAYER_UNSOLD",
  AUCTION_COMPLETED: "AUCTION_COMPLETED",
} as const;
export type AuctionEvent = (typeof AUCTION_EVENTS)[keyof typeof AUCTION_EVENTS];
