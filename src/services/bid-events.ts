import type { IAuctionPlayer } from "../models/AuctionPlayer";
import type { IBid } from "../models/Bid";
import type { ITeam } from "../models/Team";

/** The BID_PLACED payload every screen consumes — one shape for REST and socket bids. */
export function bidPlacedPayload(result: {
  auctionPlayer: IAuctionPlayer;
  team: ITeam;
  bid: IBid;
  nextBid: number;
}) {
  const { auctionPlayer, team, bid, nextBid } = result;
  return {
    auctionPlayerId: auctionPlayer._id,
    currentBid: auctionPlayer.currentBid,
    nextBid,
    team: {
      _id: team._id,
      name: team.name,
      shortName: team.shortName,
      logo: team.logo,
      color: team.color,
    },
    bidId: bid._id,
    source: bid.source,
  };
}
