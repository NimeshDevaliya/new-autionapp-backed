import { Router } from "express";
import authRoutes from "./auth.routes";
import teamAuthRoutes from "./team-auth.routes";
import adminRoutes from "./admin.routes";
import tournamentRoutes from "./tournament.routes";
import teamRoutes from "./team.routes";
import playerRoutes from "./player.routes";
import auctionRoutes from "./auction.routes";
import matchRoutes from "./match.routes";
import { listSeasons } from "../controllers/tournament.controller";
import { globalSearch } from "../controllers/search.controller";
import {
  getDashboard,
  getLeaderboards,
} from "../controllers/statistics.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { searchQuery, statsQuery } from "../validators/schemas";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({ success: true, message: "API is healthy", data: { uptime: process.uptime() } });
});

router.use("/auth", authRoutes);
router.use("/team-auth", teamAuthRoutes);
router.use("/admins", adminRoutes);
router.use("/tournaments", tournamentRoutes);
router.use("/teams", teamRoutes);
router.use("/players", playerRoutes);
router.use("/auctions", auctionRoutes);
router.use("/matches", matchRoutes);

// seasons are derived from tournaments grouped by series
router.get("/seasons", listSeasons);

router.get("/search", validate(searchQuery, "query"), globalSearch);

router.get("/statistics/dashboard", authenticate, getDashboard);
router.get("/statistics/leaderboards", validate(statsQuery, "query"), getLeaderboards);

export default router;
