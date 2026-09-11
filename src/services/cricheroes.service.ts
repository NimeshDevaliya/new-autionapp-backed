import mongoose, { Types } from "mongoose";
import { env } from "../config/env";
import { Match } from "../models/Match";
import { Innings } from "../models/Innings";
import { BattingScore } from "../models/BattingScore";
import { BowlingFigure } from "../models/BowlingFigure";
import { Player, IPlayer } from "../models/Player";
import { Team, ITeam } from "../models/Team";
import { TeamSquad } from "../models/TeamSquad";
import { Tournament } from "../models/Tournament";
import { DismissalType } from "../types/enums";
import { ApiError } from "../utils/ApiError";
import { getPointsTable } from "./statistics.service";

/**
 * Imports a tournament's matches from CricHeroes, the scoring app the league
 * records its games on, into this database.
 *
 * Idempotent: matches are keyed by their CricHeroes id, and a re-run replaces
 * each match's scorecard rather than duplicating it. Players and teams are
 * linked by CricHeroes id after the first run. Squads (the auction record)
 * are never modified — a player's match statistics attach to the team they
 * actually played for, which is reported when it differs from their squad.
 *
 * Usage is deliberately light (one request per match, sequential) — this is a
 * sync of the league's own data, not a crawler.
 */

/* ------------------------------------------------------------- client --- */

interface ApiEnvelope<T> {
  status?: boolean;
  data?: T;
  page?: { next?: string | null } | null;
  error?: { message?: string };
}

async function apiGet<T>(path: string): Promise<ApiEnvelope<T>> {
  const url = path.startsWith("http") ? path : `${env.cricheroes.apiBase}${path}`;
  const res = await fetch(url, {
    headers: {
      "api-key": env.cricheroes.apiKey,
      udid: "auction-platform-sync",
      "device-type": "web",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw ApiError.internal(`CricHeroes responded ${res.status} for ${path}`);
  }
  const text = await res.text();
  if (!text) return {};
  return JSON.parse(text) as ApiEnvelope<T>;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------- CricHeroes types --- */

interface ChRosterPlayer {
  player_id: number;
  player_name: string;
}

interface ChRosterTeam {
  team_id: number;
  team_name: string;
  players: ChRosterPlayer[];
}

interface ChStandingRow {
  team_id: number;
  team_name: string;
  matches: number;
  won: number;
  lost: number;
  tied: number;
  no_result: number;
  points: number;
  net_rr: string;
  group_id: number;
  round_id: number;
}

interface ChResultRow {
  match_id: number;
  match_date: string;
}

interface ChBattingRow {
  player_id: number;
  name: string;
  runs: number;
  balls: number;
  "4s": number;
  "6s": number;
  how_to_out: string;
}

interface ChBowlingRow {
  player_id: number;
  name: string;
  overs: number;
  balls: number;
  maidens: number;
  runs: number;
  wickets: number;
  wide: number;
  noball: number;
}

interface ChInningsBlock {
  team_id: number;
  batting: ChBattingRow[];
  bowling: ChBowlingRow[];
  extras?: { total?: number };
}

interface ChInningsTotals {
  team_id: number;
  inning: number;
  is_allout: number;
  total_run: number;
  total_wicket: number;
  total_extra: number;
  overs_played: string;
}

interface ChScorecardTeam {
  id: number;
  name: string;
  innings: ChInningsTotals[];
  scorecard: ChInningsBlock[];
}

interface ChScorecard {
  match_id: number;
  start_datetime: string;
  /** Innings per side in this format (1 for limited overs). */
  match_inning?: number;
  /** Set when a tie was settled by a super over, which appears as extra innings. */
  is_super_over?: number;
  overs: number;
  ground_name?: string;
  city_name?: string;
  status: string;
  match_result?: string;
  win_by?: string;
  winning_team?: string;
  toss_details?: string;
  match_summary?: { summary?: string };
  team_a: ChScorecardTeam;
  team_b: ChScorecardTeam;
}

interface ChMatchInfo {
  toss_won_team_id?: number | null;
  bat_first_team_id?: number | null;
  winning_team_id?: number | string | null;
  team_a_id: number;
  team_b_id: number;
  match_start_time?: string;
}

interface ChSummary {
  player_of_the_match?: { player_id: number; player_name: string } | null;
}

/* ------------------------------------------------------------ parsing --- */

/** Strips scorer annotations: keeper daggers, captain marks, role suffixes, stray spaces. */
export function normaliseName(raw: string): string {
  return raw
    .replace(/†/g, "")
    .replace(/\((?:c|wk|c & wk|all-?rounder|batsman|bowler|sub)\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function nameKey(raw: string): string {
  return normaliseName(raw).toLowerCase();
}

function tokens(raw: string): string[] {
  return nameKey(raw).split(" ").filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

export interface ParsedDismissal {
  isOut: boolean;
  type: DismissalType;
  bowlerName?: string;
  fielderName?: string;
}

/** Parses CricHeroes' free-text dismissal ("c †Kunal Gajjar b Akash Patel"). */
export function parseDismissal(howToOut: string | undefined): ParsedDismissal {
  const text = normaliseName(howToOut ?? "").trim();
  const lower = text.toLowerCase();

  if (!text || lower === "not out" || lower === "batting" || lower === "did not bat") {
    return { isOut: false, type: "NOT_OUT" };
  }
  if (/^ret(ired|d)?\.? ?hurt/.test(lower)) {
    return { isOut: false, type: "RETIRED_HURT" };
  }

  let m: RegExpMatchArray | null;
  if ((m = text.match(/^c\s*&\s*b\s+(.+)$/i))) {
    return { isOut: true, type: "CAUGHT", bowlerName: m[1], fielderName: m[1] };
  }
  if ((m = text.match(/^c\s+(.+?)\s+b\s+(.+)$/i))) {
    return { isOut: true, type: "CAUGHT", fielderName: m[1], bowlerName: m[2] };
  }
  if ((m = text.match(/^st\s+(.+?)\s+b\s+(.+)$/i))) {
    return { isOut: true, type: "STUMPED", fielderName: m[1], bowlerName: m[2] };
  }
  if ((m = text.match(/^lbw\s+b\s+(.+)$/i))) {
    return { isOut: true, type: "LBW", bowlerName: m[1] };
  }
  if ((m = text.match(/^hit wicket\s+b\s+(.+)$/i))) {
    return { isOut: true, type: "HIT_WICKET", bowlerName: m[1] };
  }
  if ((m = text.match(/^run out\s*\(?([^)/]+)/i))) {
    return { isOut: true, type: "RUN_OUT", fielderName: m[1].trim() };
  }
  if (/^run out/i.test(text)) {
    return { isOut: true, type: "RUN_OUT" };
  }
  if ((m = text.match(/^b\s+(.+)$/i))) {
    return { isOut: true, type: "BOWLED", bowlerName: m[1] };
  }
  return { isOut: true, type: "OTHER" };
}

/** CricHeroes stores whole overs and leftover balls separately. */
function toOverNotation(overs: number, balls: number): number {
  const whole = Math.floor(Number(overs) || 0) + Math.floor((Number(balls) || 0) / 6);
  const rem = (Number(balls) || 0) % 6;
  return Number(`${whole}.${rem}`);
}

/* ----------------------------------------------------- player matching --- */

type PlayerDoc = Pick<IPlayer, "_id" | "fullName" | "externalId"> & {
  externalAliases?: number[];
};

interface MatchDecision {
  player: PlayerDoc;
  rule: "external-id" | "exact" | "token-subset" | "single-token" | "fuzzy-surname";
}

/**
 * Finds the one existing player a CricHeroes name can safely refer to.
 *
 * Candidates are tried in order of confidence, first inside the team's squad
 * (plus unattached players), then league-wide. A rule only counts when it
 * points at exactly one player; two different partial matches mean "unsure",
 * and the caller creates a new player instead of guessing.
 */
function resolveByName(
  chName: string,
  scoped: PlayerDoc[],
  everyone: PlayerDoc[]
): MatchDecision | null {
  const key = nameKey(chName);
  const chTokens = tokens(chName);
  if (!chTokens.length) return null;

  for (const pool of [scoped, everyone]) {
    const exact = pool.filter((p) => nameKey(p.fullName) === key);
    if (exact.length === 1) return { player: exact[0], rule: "exact" };
    if (exact.length > 1) return null;

    // "Mandeep Singh" ⊂ "Mandeep Singh Bagga", or "Patel Meet Maheshbhai" ⊃ "Meet Patel"
    const subset = pool.filter((p) => {
      const ours = tokens(p.fullName);
      const chIn = chTokens.every((t) => ours.includes(t));
      const oursIn = ours.every((t) => chTokens.includes(t));
      return (chIn || oursIn) && chTokens.length >= 2;
    });
    if (subset.length === 1) return { player: subset[0], rule: "token-subset" };
    if (subset.length > 1) return null;

    // a bare first name ("Rohit") — only meaningful inside the team
    if (chTokens.length === 1 && pool === scoped) {
      const first = pool.filter((p) => tokens(p.fullName)[0] === chTokens[0]);
      if (first.length === 1) return { player: first[0], rule: "single-token" };
      if (first.length > 1) return null;
    }

    // same surname, first name is a prefix or a near-miss spelling
    if (chTokens.length >= 2) {
      const chFirst = chTokens[0];
      const chLast = chTokens[chTokens.length - 1];
      const fuzzy = pool.filter((p) => {
        const ours = tokens(p.fullName);
        if (ours.length < 2) return false;
        const ourFirst = ours[0];
        const ourLast = ours[ours.length - 1];
        const lastClose = ourLast === chLast || levenshtein(ourLast, chLast) <= 2;
        const firstClose =
          ourFirst === chFirst ||
          ourFirst.startsWith(chFirst) ||
          chFirst.startsWith(ourFirst) ||
          levenshtein(ourFirst, chFirst) <= 1;
        return lastClose && firstClose;
      });
      if (fuzzy.length === 1) return { player: fuzzy[0], rule: "fuzzy-surname" };
      if (fuzzy.length > 1) return null;
    }
  }
  return null;
}

/* -------------------------------------------------------------- import --- */

export interface ImportReport {
  tournament: { id: string; name: string; externalId: number };
  matches: { found: number; imported: number; failed: Array<{ matchId: number; error: string }> };
  players: {
    linkedById: number;
    matched: Array<{ cricheroes: string; ours: string; rule: string }>;
    created: string[];
    /** a second CricHeroes profile folded into an existing player of the same name */
    aliased: Array<{ name: string; externalId: number }>;
  };
  outsideSquad: Array<{ player: string; playedFor: string }>;
  unresolvedNames: string[];
  warnings: string[];
  standings: Array<{
    team: string;
    official: { matches: number; won: number; lost: number; points: number; nrr: string };
    derived: { matches: number; wins: number; losses: number; points: number; nrr: number | null };
    pointsAdjustment: number;
  }>;
}

interface Context {
  tournamentId: Types.ObjectId;
  teamsByExternal: Map<number, ITeam>;
  playersByExternal: Map<number, PlayerDoc>;
  squadByTeam: Map<string, PlayerDoc[]>;
  freeAgents: PlayerDoc[];
  everyone: PlayerDoc[];
  createdBy?: string;
  report: ImportReport;
}

async function resolveTeams(ctx: Context, rosters: ChRosterTeam[]) {
  const ours = await Team.find({ tournament: ctx.tournamentId });
  const byKey = new Map(ours.map((t) => [t.name.toLowerCase().replace(/\s+/g, " ").trim(), t]));

  for (const roster of rosters) {
    let team = ours.find((t) => t.externalId === roster.team_id);
    if (!team) {
      team = byKey.get(roster.team_name.toLowerCase().replace(/\s+/g, " ").trim());
      if (!team) {
        throw ApiError.conflict(
          `CricHeroes team "${roster.team_name}" has no counterpart in this tournament. Create the team first.`
        );
      }
      team.externalId = roster.team_id;
      await team.save();
    }
    ctx.teamsByExternal.set(roster.team_id, team);
  }
}

async function loadPlayers(ctx: Context) {
  const players = await Player.find()
    .select("fullName externalId externalAliases")
    .lean<PlayerDoc[]>();
  ctx.everyone = players;
  for (const p of players) {
    if (p.externalId) ctx.playersByExternal.set(p.externalId, p);
    for (const alias of p.externalAliases ?? []) ctx.playersByExternal.set(alias, p);
  }

  const squads = await TeamSquad.find({ tournament: ctx.tournamentId })
    .select("team player")
    .lean();
  const byId = new Map(players.map((p) => [String(p._id), p]));
  const inSquad = new Set<string>();
  for (const s of squads) {
    const p = byId.get(String(s.player));
    if (!p) continue;
    inSquad.add(String(p._id));
    const key = String(s.team);
    ctx.squadByTeam.set(key, [...(ctx.squadByTeam.get(key) ?? []), p]);
  }
  ctx.freeAgents = players.filter((p) => !inSquad.has(String(p._id)));
}

/**
 * Returns our player for a CricHeroes player, linking or creating as needed.
 * `teamExternalId` scopes the name search to that team's squad.
 */
async function resolvePlayer(
  ctx: Context,
  chId: number,
  chName: string,
  teamExternalId: number
): Promise<PlayerDoc> {
  const linked = ctx.playersByExternal.get(chId);
  if (linked) return linked;

  const team = ctx.teamsByExternal.get(teamExternalId);
  const scoped = [
    ...(team ? ctx.squadByTeam.get(String(team._id)) ?? [] : []),
    ...ctx.freeAgents,
  ].filter((p) => !p.externalId); // already-linked players belong to someone else

  const decision = resolveByName(chName, scoped, ctx.everyone.filter((p) => !p.externalId));
  const clean = normaliseName(chName);

  if (decision) {
    await Player.updateOne({ _id: decision.player._id }, { $set: { externalId: chId } });
    decision.player.externalId = chId;
    ctx.playersByExternal.set(chId, decision.player);
    if (decision.rule !== "exact") {
      ctx.report.players.matched.push({
        cricheroes: clean,
        ours: decision.player.fullName,
        rule: decision.rule,
      });
    } else {
      ctx.report.players.linkedById += 1;
    }
    return decision.player;
  }

  // Same name as a player already linked to a different id: almost always one
  // person with two CricHeroes profiles. Fold the id in rather than duplicate.
  const sameName = ctx.everyone.find(
    (p) => p.externalId && p.externalId !== chId && nameKey(p.fullName) === nameKey(clean)
  );
  if (sameName) {
    await Player.updateOne({ _id: sameName._id }, { $addToSet: { externalAliases: chId } });
    sameName.externalAliases = [...(sameName.externalAliases ?? []), chId];
    ctx.playersByExternal.set(chId, sameName);
    ctx.report.players.aliased.push({ name: sameName.fullName, externalId: chId });
    return sameName;
  }

  const created = await Player.create({
    fullName: clean,
    role: "ALL_ROUNDER",
    category: "LOCAL",
    basePrice: 10,
    isActive: true,
    externalId: chId,
    createdBy: ctx.createdBy,
  });
  const doc: PlayerDoc = { _id: created._id, fullName: created.fullName, externalId: chId };
  ctx.playersByExternal.set(chId, doc);
  ctx.everyone.push(doc);
  ctx.report.players.created.push(clean);
  return doc;
}

/** Resolves a name from a dismissal string against the fielding side first. */
async function resolveNamed(
  ctx: Context,
  name: string | undefined,
  fieldingBlock: ChInningsBlock,
  fieldingRoster: ChRosterPlayer[],
  fieldingTeamExternalId: number
): Promise<Types.ObjectId | null> {
  if (!name) return null;
  const key = nameKey(name);
  const known =
    fieldingBlock.bowling.find((b) => nameKey(b.name) === key) ??
    fieldingRoster.find((p) => nameKey(p.player_name) === key);
  if (known) {
    const p = await resolvePlayer(
      ctx,
      "player_id" in known ? known.player_id : (known as ChBowlingRow).player_id,
      name,
      fieldingTeamExternalId
    );
    return p._id as Types.ObjectId;
  }
  const team = ctx.teamsByExternal.get(fieldingTeamExternalId);
  const scoped = team ? ctx.squadByTeam.get(String(team._id)) ?? [] : [];
  const decision = resolveByName(name, scoped, ctx.everyone);
  if (decision) return decision.player._id as Types.ObjectId;
  if (!ctx.report.unresolvedNames.includes(normaliseName(name))) {
    ctx.report.unresolvedNames.push(normaliseName(name));
  }
  return null;
}

async function listAllMatchIds(
  externalTournamentId: number,
  standing: ChStandingRow[]
): Promise<Map<number, string>> {
  const found = new Map<number, string>();
  for (const row of standing) {
    let next: string | null | undefined =
      `/api/v1/tournament/get-tournament-points-table-matches/${externalTournamentId}/${row.team_id}/${row.group_id}/${row.round_id}`;
    let guard = 0;
    while (next && guard < 10) {
      const res: ApiEnvelope<ChResultRow[]> = await apiGet(
        next.startsWith("/api") ? next : `/api/v1${next}`
      );
      for (const m of res.data ?? []) found.set(m.match_id, m.match_date);
      next = res.page?.next ?? null;
      guard += 1;
      await pause(120);
    }
  }
  return found;
}

function resultFor(sc: ChScorecard, info: ChMatchInfo) {
  const summary = sc.match_summary?.summary ?? "";
  const lower = `${summary} ${sc.match_result ?? ""} ${sc.win_by ?? ""}`.toLowerCase();
  if (/abandon|no result|cancel/.test(lower)) {
    return { status: "ABANDONED" as const, winnerExternal: null, result: summary || "Abandoned" };
  }
  // A tie settled by a super over still names a winner, so the winner decides —
  // the "tied" wording alone doesn't make it a shared result.
  const winner = info.winning_team_id ? Number(info.winning_team_id) : null;
  if (winner) {
    return { status: "COMPLETED" as const, winnerExternal: winner, result: summary };
  }
  if (/\btie/.test(lower)) {
    return { status: "COMPLETED" as const, winnerExternal: null, result: summary || "Match tied" };
  }
  return { status: "COMPLETED" as const, winnerExternal: null, result: summary || "No result" };
}

async function importMatch(
  ctx: Context,
  externalMatchId: number,
  rosters: Map<number, ChRosterPlayer[]>
) {
  const [scRes, infoRes, sumRes] = await Promise.all([
    apiGet<ChScorecard>(`/api/v1/scorecard/v2/get-scorecard/${externalMatchId}`),
    apiGet<ChMatchInfo>(`/api/v1/scorecard/v5/get-match-info/${externalMatchId}`),
    apiGet<ChSummary>(`/api/v1/scorecard/get-summary-scorecard/${externalMatchId}`),
  ]);
  const sc = scRes.data;
  const info = infoRes.data;
  if (!sc || !info) throw new Error("scorecard unavailable");

  const teamA = ctx.teamsByExternal.get(sc.team_a.id);
  const teamB = ctx.teamsByExternal.get(sc.team_b.id);
  if (!teamA || !teamB) throw new Error(`unknown team ${sc.team_a.name} / ${sc.team_b.name}`);

  const { status, winnerExternal, result } = resultFor(sc, info);
  const winner = winnerExternal ? ctx.teamsByExternal.get(winnerExternal) ?? null : null;
  const tossWon = info.toss_won_team_id ? ctx.teamsByExternal.get(info.toss_won_team_id) : null;
  const tossDecision =
    info.toss_won_team_id && info.bat_first_team_id
      ? info.toss_won_team_id === info.bat_first_team_id
        ? "BAT"
        : "BOWL"
      : undefined;

  const pom = sumRes.data?.player_of_the_match;
  const pomTeamExternal = pom
    ? [sc.team_a, sc.team_b].find((t) =>
        [...t.scorecard.flatMap((b) => [...b.batting, ...b.bowling])].some(
          (r) => r.player_id === pom.player_id
        )
      )?.id ?? sc.team_a.id
    : null;
  const pomPlayer =
    pom && pomTeamExternal
      ? await resolvePlayer(ctx, pom.player_id, pom.player_name, pomTeamExternal)
      : null;

  // build all rows before touching the database, so a parse error leaves nothing half-written
  const inningsDocs: Array<Record<string, unknown>> = [];
  const battingDocs: Array<Record<string, unknown> & { inningsNumber: number }> = [];
  const bowlingDocs: Array<Record<string, unknown> & { inningsNumber: number }> = [];

  for (const side of [sc.team_a, sc.team_b]) {
    const other = side === sc.team_a ? sc.team_b : sc.team_a;
    const battingTeam = ctx.teamsByExternal.get(side.id)!;
    const bowlingTeam = ctx.teamsByExternal.get(other.id)!;

    // A super over is listed as a further innings per side; it settles the
    // match but does not count towards player statistics or net run rate.
    // CricHeroes bumps match_inning when one is played, so rely on its flag.
    const realInnings = sc.is_super_over === 1 ? 1 : Math.max(1, sc.match_inning ?? 1);

    for (let i = 0; i < Math.min(side.innings.length, realInnings); i += 1) {
      const totals = side.innings[i];
      const block = side.scorecard[i] ?? side.scorecard[0];
      if (!totals || !block) continue;
      const inningsNumber = totals.inning || i + 1;

      inningsDocs.push({
        inningsNumber,
        battingTeam: battingTeam._id,
        bowlingTeam: bowlingTeam._id,
        totalRuns: totals.total_run ?? 0,
        totalWickets: totals.total_wicket ?? 0,
        totalOvers: Number(totals.overs_played) || 0,
        extras: totals.total_extra ?? block.extras?.total ?? 0,
        allOut: totals.is_allout === 1,
      });

      let position = 0;
      for (const row of block.batting) {
        position += 1;
        const player = await resolvePlayer(ctx, row.player_id, row.name, side.id);
        const dismissal = parseDismissal(row.how_to_out);
        const otherBlock = other.scorecard.find((b) => b.team_id === other.id) ?? other.scorecard[0];
        const bowler = await resolveNamed(ctx, dismissal.bowlerName, otherBlock ?? block, rosters.get(other.id) ?? [], other.id);
        const fielder = await resolveNamed(ctx, dismissal.fielderName, otherBlock ?? block, rosters.get(other.id) ?? [], other.id);

        battingDocs.push({
          inningsNumber,
          player: player._id,
          team: battingTeam._id,
          runs: row.runs ?? 0,
          balls: row.balls ?? 0,
          fours: row["4s"] ?? 0,
          sixes: row["6s"] ?? 0,
          isOut: dismissal.isOut,
          dismissalType: dismissal.type,
          dismissalBowler: bowler,
          dismissalFielder: fielder,
          battingPosition: position,
        });

        // players appearing for a team they weren't bought by
        const squad = ctx.squadByTeam.get(String(battingTeam._id)) ?? [];
        if (!squad.some((p) => String(p._id) === String(player._id))) {
          const entry = { player: player.fullName, playedFor: battingTeam.name };
          if (!ctx.report.outsideSquad.some((o) => o.player === entry.player && o.playedFor === entry.playedFor)) {
            ctx.report.outsideSquad.push(entry);
          }
        }
      }

      for (const row of block.bowling) {
        const player = await resolvePlayer(ctx, row.player_id, row.name, other.id);
        bowlingDocs.push({
          inningsNumber,
          player: player._id,
          team: bowlingTeam._id,
          overs: toOverNotation(row.overs, row.balls),
          maidens: row.maidens ?? 0,
          runsConceded: row.runs ?? 0,
          wickets: row.wickets ?? 0,
          wides: row.wide ?? 0,
          noBalls: row.noball ?? 0,
        });
      }
    }
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const match = await Match.findOneAndUpdate(
        { externalId: externalMatchId },
        {
          $set: {
            tournament: ctx.tournamentId,
            teamA: teamA._id,
            teamB: teamB._id,
            matchDate: new Date(info.match_start_time ?? sc.start_datetime),
            venue: [sc.ground_name, sc.city_name].filter(Boolean).join(", "),
            status,
            tossWonBy: tossWon?._id ?? null,
            ...(tossDecision ? { tossDecision } : {}),
            winner: winner?._id ?? null,
            result,
            overs: sc.overs || 20,
            playerOfTheMatch: pomPlayer?._id ?? null,
            externalId: externalMatchId,
          },
        },
        { upsert: true, new: true, session }
      );

      const oldInnings = await Innings.find({ match: match._id }).select("_id").session(session);
      const oldIds = oldInnings.map((i) => i._id);
      await BattingScore.deleteMany({ innings: { $in: oldIds } }).session(session);
      await BowlingFigure.deleteMany({ innings: { $in: oldIds } }).session(session);
      await Innings.deleteMany({ match: match._id }).session(session);

      // Mongoose requires `ordered` when creating several documents in a session
      for (const inn of inningsDocs) {
        const [created] = await Innings.create(
          [{ ...inn, match: match._id, tournament: ctx.tournamentId }],
          { session, ordered: true }
        );
        const bat = battingDocs.filter((b) => b.inningsNumber === inn.inningsNumber);
        const bowl = bowlingDocs.filter((b) => b.inningsNumber === inn.inningsNumber);
        if (bat.length) {
          await BattingScore.create(
            bat.map(({ inningsNumber: _n, ...b }) => ({
              ...b,
              innings: created._id,
              match: match._id,
              tournament: ctx.tournamentId,
            })),
            { session, ordered: true }
          );
        }
        if (bowl.length) {
          await BowlingFigure.create(
            bowl.map(({ inningsNumber: _n, ...b }) => ({
              ...b,
              innings: created._id,
              match: match._id,
              tournament: ctx.tournamentId,
            })),
            { session, ordered: true }
          );
        }
      }
    });
  } finally {
    await session.endSession();
  }
}

/** Numbers matches chronologically so the fixture list reads in order. */
async function renumberMatches(tournamentId: Types.ObjectId) {
  const matches = await Match.find({ tournament: tournamentId })
    .select("_id matchDate")
    .sort({ matchDate: 1, createdAt: 1 });
  await Promise.all(
    matches.map((m, i) => Match.updateOne({ _id: m._id }, { $set: { matchNumber: i + 1 } }))
  );
}

/**
 * Aligns points with the league's official table. Any difference between
 * "wins × 2 + ties" and the published points is stored as an adjustment, so
 * bonus or penalty points the organisers awarded are reflected rather than
 * silently lost.
 */
async function syncStandings(ctx: Context, standing: ChStandingRow[]) {
  const table = await getPointsTable(String(ctx.tournamentId));
  for (const row of standing) {
    const team = ctx.teamsByExternal.get(row.team_id);
    if (!team) continue;
    const derived = table.find((t) => String(t.team._id) === String(team._id));
    if (!derived) continue;
    const base = derived.points - derived.pointsAdjustment;

    // Only reconcile once every official match is in our records; otherwise the
    // "adjustment" would just be the points of matches we haven't imported yet.
    let adjustment = team.pointsAdjustment ?? 0;
    if (derived.matches === row.matches) {
      adjustment = row.points - base;
      if (adjustment !== team.pointsAdjustment) {
        await Team.updateOne({ _id: team._id }, { $set: { pointsAdjustment: adjustment } });
      }
    } else {
      ctx.report.warnings.push(
        `${team.name}: ${derived.matches} of ${row.matches} official matches imported — points adjustment left unchanged`
      );
    }
    ctx.report.standings.push({
      team: team.name,
      official: {
        matches: row.matches,
        won: row.won,
        lost: row.lost,
        points: row.points,
        nrr: row.net_rr,
      },
      derived: {
        matches: derived.matches,
        wins: derived.wins,
        losses: derived.losses,
        points: base + adjustment,
        nrr: derived.netRunRate,
      },
      pointsAdjustment: adjustment,
    });
  }
}

export interface ImportOptions {
  tournamentId: string;
  externalTournamentId?: number;
  createdBy?: string;
  /** Re-import matches already present. Default: only new ones. */
  refresh?: boolean;
}

export async function importTournamentFromCricHeroes(
  options: ImportOptions
): Promise<ImportReport> {
  const tournament = await Tournament.findById(options.tournamentId);
  if (!tournament) throw ApiError.notFound("Tournament not found");

  const externalId = options.externalTournamentId ?? tournament.externalId;
  if (!externalId) {
    throw ApiError.badRequest(
      "This tournament has no CricHeroes id. Pass externalTournamentId once; it is remembered."
    );
  }
  if (tournament.externalId !== externalId) {
    tournament.externalId = externalId;
    await tournament.save();
  }

  const ctx: Context = {
    tournamentId: tournament._id,
    teamsByExternal: new Map(),
    playersByExternal: new Map(),
    squadByTeam: new Map(),
    freeAgents: [],
    everyone: [],
    createdBy: options.createdBy,
    report: {
      tournament: { id: String(tournament._id), name: tournament.name, externalId },
      matches: { found: 0, imported: 0, failed: [] },
      players: { linkedById: 0, matched: [], created: [], aliased: [] },
      outsideSquad: [],
      unresolvedNames: [],
      warnings: [],
      standings: [],
    },
  };

  const [rostersRes, standingRes] = await Promise.all([
    apiGet<ChRosterTeam[]>(`/api/v1/tournament/get-tournament-teams-and-players/${externalId}`),
    apiGet<Array<{ standing: ChStandingRow[] }>>(`/api/v1/tournament/get-tournament-standing/${externalId}`),
  ]);
  const rosters = rostersRes.data ?? [];
  const standing = standingRes.data?.flatMap((g) => g.standing) ?? [];
  if (!rosters.length) throw ApiError.internal("CricHeroes returned no teams for this tournament");

  await resolveTeams(ctx, rosters);
  await loadPlayers(ctx);
  const rosterMap = new Map(rosters.map((r) => [r.team_id, r.players]));

  const matchIds = await listAllMatchIds(externalId, standing);
  ctx.report.matches.found = matchIds.size;

  const existing = new Set(
    (await Match.find({ tournament: tournament._id, externalId: { $ne: null } })
      .select("externalId")
      .lean()).map((m) => m.externalId as number)
  );

  const ordered = [...matchIds.entries()].sort(([, a], [, b]) => a.localeCompare(b));
  for (const [matchId] of ordered) {
    if (existing.has(matchId) && !options.refresh) continue;
    try {
      await importMatch(ctx, matchId, rosterMap);
      ctx.report.matches.imported += 1;
    } catch (err) {
      ctx.report.matches.failed.push({
        matchId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await pause(150);
  }

  await renumberMatches(tournament._id);
  await syncStandings(ctx, standing);

  return ctx.report;
}
