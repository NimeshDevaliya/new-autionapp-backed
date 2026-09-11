import { Router } from "express";
import * as teamController from "../controllers/team.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { idParam } from "../validators/common";
import { createTeamSchema, teamListQuery, updateTeamSchema } from "../validators/schemas";

const router = Router();

router.get("/", validate(teamListQuery, "query"), teamController.listTeams);
router.get("/:id", validate(idParam, "params"), teamController.getTeam);
router.get("/:id/squad", validate(idParam, "params"), teamController.getTeamSquad);

router.post("/", authenticate, validate(createTeamSchema), teamController.createTeam);
router.patch(
  "/:id",
  authenticate,
  validate(idParam, "params"),
  validate(updateTeamSchema),
  teamController.updateTeam
);
router.delete(
  "/:id",
  authenticate,
  validate(idParam, "params"),
  teamController.deleteTeam
);

export default router;
