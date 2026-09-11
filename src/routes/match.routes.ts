import { Router } from "express";
import * as matchController from "../controllers/match.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { idParam } from "../validators/common";
import {
  createMatchSchema,
  matchListQuery,
  recordInningsSchema,
  updateMatchSchema,
} from "../validators/schemas";

const router = Router();

router.get("/", validate(matchListQuery, "query"), matchController.listMatches);
router.get("/:id", validate(idParam, "params"), matchController.getMatch);

router.post("/", authenticate, validate(createMatchSchema), matchController.createMatch);
router.patch(
  "/:id",
  authenticate,
  validate(idParam, "params"),
  validate(updateMatchSchema),
  matchController.updateMatch
);
router.delete(
  "/:id",
  authenticate,
  validate(idParam, "params"),
  matchController.deleteMatch
);
router.post(
  "/:id/innings",
  authenticate,
  validate(idParam, "params"),
  validate(recordInningsSchema),
  matchController.recordInnings
);

export default router;
