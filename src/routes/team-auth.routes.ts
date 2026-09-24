import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as controller from "../controllers/team-auth.controller";
import { authenticateOwner } from "../middleware/team-auth";
import { validate } from "../middleware/validate";
import { loginSchema } from "../validators/schemas";

const router = Router();

// throttle credential stuffing without locking out honest retries
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Please try again in a few minutes.",
  },
});

router.post("/login", loginLimiter, validate(loginSchema), controller.login);
router.get("/me", authenticateOwner, controller.me);

export default router;
