import { Router } from "express";
import * as auctionController from "../controllers/auction.controller";
import { authenticate } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { idParam } from "../validators/common";
import {
  addAuctionPlayersSchema,
  createAuctionSchema,
  placeBidSchema,
  setCurrentPlayerSchema,
  updateAuctionSchema,
} from "../validators/schemas";

const router = Router();

/* reads — the live auction screen is viewer-facing */
router.get("/", auctionController.listAuctions);
router.get("/:id", validate(idParam, "params"), auctionController.getAuction);
router.get("/:id/state", validate(idParam, "params"), auctionController.getAuctionState);
router.get(
  "/:id/players",
  validate(idParam, "params"),
  auctionController.listAuctionPlayers
);
router.get(
  "/:id/results",
  validate(idParam, "params"),
  auctionController.getAuctionResults
);

/* writes — operators only */
router.use(authenticate);

router.post("/", validate(createAuctionSchema), auctionController.createAuction);
router.patch(
  "/:id",
  validate(idParam, "params"),
  validate(updateAuctionSchema),
  auctionController.updateAuction
);
router.delete("/:id", validate(idParam, "params"), auctionController.deleteAuction);

router.post(
  "/:id/players",
  validate(idParam, "params"),
  validate(addAuctionPlayersSchema),
  auctionController.addAuctionPlayers
);
router.delete(
  "/:id/players/:playerId",
  validate(idParam, "params"),
  auctionController.removeAuctionPlayer
);

router.post("/:id/start", validate(idParam, "params"), auctionController.startAuction);
router.post("/:id/pause", validate(idParam, "params"), auctionController.pauseAuction);
router.post("/:id/resume", validate(idParam, "params"), auctionController.resumeAuction);
router.post(
  "/:id/complete",
  validate(idParam, "params"),
  auctionController.completeAuction
);

router.post(
  "/:id/current-player",
  validate(idParam, "params"),
  validate(setCurrentPlayerSchema),
  auctionController.changeCurrentPlayer
);
router.post(
  "/:id/bids",
  validate(idParam, "params"),
  validate(placeBidSchema),
  auctionController.placeBidHandler
);
router.post("/:id/sell", validate(idParam, "params"), auctionController.sellPlayerHandler);
router.post(
  "/:id/unsold",
  validate(idParam, "params"),
  auctionController.markUnsoldHandler
);
router.post(
  "/:id/next-player",
  validate(idParam, "params"),
  auctionController.nextPlayerHandler
);

export default router;
