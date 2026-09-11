import { Router } from "express";
import * as adminController from "../controllers/admin.controller";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { idParam } from "../validators/common";
import {
  adminListQuery,
  createAdminSchema,
  resetPasswordSchema,
  updateAdminSchema,
} from "../validators/schemas";

const router = Router();

// admin management is restricted to super admins
router.use(authenticate, authorize("SUPER_ADMIN"));

router.get("/", validate(adminListQuery, "query"), adminController.listAdmins);
router.post("/", validate(createAdminSchema), adminController.createAdmin);
router.get("/:id", validate(idParam, "params"), adminController.getAdmin);
router.patch(
  "/:id",
  validate(idParam, "params"),
  validate(updateAdminSchema),
  adminController.updateAdmin
);
router.post(
  "/:id/reset-password",
  validate(idParam, "params"),
  validate(resetPasswordSchema),
  adminController.resetAdminPassword
);
router.delete("/:id", validate(idParam, "params"), adminController.deleteAdmin);

export default router;
