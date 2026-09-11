/**
 * Pulls a tournament's matches, scorecards and standings from CricHeroes.
 *
 *   npm run import:cricheroes -- --tournament <ourTournamentId> --external 2000875
 *   npm run import:cricheroes -- --external 2000875          # uses the ongoing tournament
 *   npm run import:cricheroes -- --refresh                  # re-import matches already stored
 *
 * Safe to re-run: matches are keyed by their CricHeroes id.
 */
import { connectDatabase, disconnectDatabase } from "../config/db";
import { Tournament } from "../models/Tournament";
import { importTournamentFromCricHeroes } from "../services/cricheroes.service";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  await connectDatabase();

  let tournamentId = arg("tournament");
  if (!tournamentId) {
    const ongoing = await Tournament.findOne({ status: "ONGOING" }).sort({ startDate: -1 });
    if (!ongoing) throw new Error("No ongoing tournament found — pass --tournament <id>");
    tournamentId = String(ongoing._id);
  }

  const externalArg = arg("external");
  const report = await importTournamentFromCricHeroes({
    tournamentId,
    externalTournamentId: externalArg ? Number(externalArg) : undefined,
    refresh: process.argv.includes("--refresh"),
  });

  console.log(`\n=== ${report.tournament.name} ← CricHeroes #${report.tournament.externalId} ===`);
  console.log(`matches: ${report.matches.imported} imported of ${report.matches.found} found`);
  for (const f of report.matches.failed) console.log(`  FAILED ${f.matchId}: ${f.error}`);
  console.log(`players: ${report.players.linkedById} linked exactly, ${report.players.matched.length} matched by name, ${report.players.created.length} created`);
  for (const m of report.players.matched) console.log(`  ${m.cricheroes.padEnd(26)} → ${m.ours.padEnd(26)} (${m.rule})`);
  if (report.players.created.length) console.log(`  created: ${report.players.created.join(", ")}`);
  if (report.unresolvedNames.length) console.log(`unresolved fielder/bowler names: ${report.unresolvedNames.join(", ")}`);
  if (report.outsideSquad.length) {
    console.log("played for a team without being on its squad:");
    for (const o of report.outsideSquad) console.log(`  ${o.player} → ${o.playedFor}`);
  }
  console.log("standings (official vs derived):");
  for (const s of report.standings) {
    console.log(
      `  ${s.team.padEnd(22)} P${s.official.matches}/${s.derived.matches} W${s.official.won}/${s.derived.wins} pts ${s.official.points}/${s.derived.points} nrr ${s.official.nrr}/${s.derived.nrr ?? "-"} adj ${s.pointsAdjustment}`
    );
  }

  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error("[import] failed:", err);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
