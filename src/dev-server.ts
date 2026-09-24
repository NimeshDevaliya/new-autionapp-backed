/**
 * Development server backed by an in-memory MongoDB.
 *
 * Use this when the real database isn't reachable (for example while an Atlas
 * IP allowlist entry is pending). Data lives only for the life of the process.
 *
 *   npm run dev:memory
 */
import http from "http";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

process.env.JWT_SECRET ??= "dev-only-in-memory-secret-not-for-production";
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/placeholder";

async function main() {
  console.log("[dev] starting in-memory MongoDB (first run downloads a binary)…");
  // a replica set is required because the sale path uses transactions
  const replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replset.getUri();

  await mongoose.connect(uri);
  console.log("[dev] in-memory MongoDB ready");

  const { runSeed } = await import("./seed/seed-data");
  await runSeed();

  const { createApp } = await import("./app");
  const { initWebSocket } = await import("./sockets");
  const { env } = await import("./config/env");

  const app = createApp();
  const server = http.createServer(app);
  initWebSocket(server);

  server.listen(env.port, () => {
    console.log(`\n[dev] API on http://localhost:${env.port}`);
    console.log(`[dev] WebSocket on ws://localhost:${env.port}${env.wsPath}`);
    console.log("[dev] admin@medianv.com / Admin@12345");
    console.log("[dev] team owner: owner-rv@medianv.com / Owner@12345  (team app: /team/login)");
    console.log("[dev] live board: http://localhost:3000/live\n");
  });

  const shutdown = async () => {
    server.close();
    await mongoose.disconnect();
    await replset.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error("[dev] failed to start:", err);
  process.exit(1);
});
