import { Router } from "express";
import * as teamController from "../controllers/team.controller";
import * as teamOwnerController from "../controllers/team-owner.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { idParam } from "../validators/common";
import {
  createTeamOwnerSchema,
  createTeamSchema,
  teamListQuery,
  teamOwnerParams,
  updateTeamOwnerSchema,
  updateTeamSchema,
} from "../validators/schemas";

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

// owner logins — who may bid for this team from the team app
router.get(
  "/:id/owners",
  authenticate,
  validate(idParam, "params"),
  teamOwnerController.listOwners
);
router.post(
  "/:id/owners",
  authenticate,
  validate(idParam, "params"),
  validate(createTeamOwnerSchema),
  teamOwnerController.createOwner
);
router.patch(
  "/:id/owners/:ownerId",
  authenticate,
  validate(teamOwnerParams, "params"),
  validate(updateTeamOwnerSchema),
  teamOwnerController.updateOwner
);
router.delete(
  "/:id/owners/:ownerId",
  authenticate,
  validate(teamOwnerParams, "params"),
  teamOwnerController.deleteOwner
);

export default router;
