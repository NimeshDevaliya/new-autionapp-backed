import { Router } from "express";
import * as tournamentController from "../controllers/tournament.controller";
import { getTournamentPointsTable } from "../controllers/statistics.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { idParam } from "../validators/common";
import {
  createTournamentSchema,
  tournamentListQuery,
  updateTournamentSchema,
} from "../validators/schemas";

const router = Router();

// public reads — the tournament pages are viewer-facing
router.get(
  "/",
  validate(tournamentListQuery, "query"),
  tournamentController.listTournaments
);
router.get("/:id", validate(idParam, "params"), tournamentController.getTournament);
router.get(
  "/:id/statistics",
  validate(idParam, "params"),
  tournamentController.getTournamentStats
);
router.get("/:id/points-table", validate(idParam, "params"), getTournamentPointsTable);

// writes require an authenticated admin
router.post(
  "/",
  authenticate,
  validate(createTournamentSchema),
  tournamentController.createTournament
);
router.patch(
  "/:id",
  authenticate,
  validate(idParam, "params"),
  validate(updateTournamentSchema),
  tournamentController.updateTournament
);
router.delete(
  "/:id",
  authenticate,
  validate(idParam, "params"),
  tournamentController.deleteTournament
);
router.post(
  "/:id/start",
  authenticate,
  validate(idParam, "params"),
  tournamentController.setTournamentStatus("ONGOING")
);
router.post(
  "/:id/end",
  authenticate,
  validate(idParam, "params"),
  tournamentController.setTournamentStatus("COMPLETED")
);

export default router;
