import { Router } from "express";
import * as playerController from "../controllers/player.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { idParam } from "../validators/common";
import {
  createPlayerSchema,
  playerListQuery,
  updatePlayerSchema,
} from "../validators/schemas";

const router = Router();

router.get("/", validate(playerListQuery, "query"), playerController.listPlayers);
router.get("/:id", validate(idParam, "params"), playerController.getPlayer);
router.get(
  "/:id/statistics",
  validate(idParam, "params"),
  playerController.getPlayerStats
);

router.post(
  "/",
  authenticate,
  validate(createPlayerSchema),
  playerController.createPlayer
);
router.patch(
  "/:id",
  authenticate,
  validate(idParam, "params"),
  validate(updatePlayerSchema),
  playerController.updatePlayer
);
router.delete(
  "/:id",
  authenticate,
  validate(idParam, "params"),
  playerController.deletePlayer
);

export default router;
