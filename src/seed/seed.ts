/**
 * Seeds the configured database.
 *
 *   npm run seed            # only seeds an empty database
 *   npm run seed -- --force # wipes and reseeds
 */
import { connectDatabase, disconnectDatabase } from "../config/db";
import { runSeed } from "./seed-data";

async function main() {
  await connectDatabase();
  await runSeed({ force: process.argv.includes("--force") });
  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error("[seed] failed:", err);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
