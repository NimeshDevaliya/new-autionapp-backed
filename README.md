# Cricket Auction API

Express + Mongoose API with a WebSocket auction engine. Pairs with the
`auction-frontend` Next.js app, which runs as its own project.

## Requirements

- Node.js 22+
- MongoDB. The sale path uses transactions, so the database must be a
  **replica set** — MongoDB Atlas always is.

## Setup

```bash
npm install
cp .env.example .env
```

| Variable | Purpose |
| --- | --- |
| `PORT` | API port (default `3005`) |
| `NODE_ENV` | `development` or `production` |
| `MONGODB_URI` | Full connection string, including database name |
| `JWT_SECRET` | Long random string used to sign session tokens |
| `JWT_EXPIRES_IN` | Token lifetime, e.g. `7d` |
| `CORS_ORIGINS` | Comma-separated allowed frontend origins |
| `WS_PATH` | WebSocket path (default `/ws`) |

> Percent-encode reserved characters in `MONGODB_URI`. A `@` in the password
> becomes `%40`, otherwise the driver reads it as the host separator.

## Running

```bash
npm run dev          # watch mode against MONGODB_URI, on :3005
npm run dev:memory   # throwaway in-memory MongoDB, seeded and ready
npm start            # production, after npm run build
```

Use `dev:memory` when no database is reachable yet. Data lives only for the
life of that process.

## Seed data

```bash
npm run seed             # only seeds an empty database
npm run seed -- --force  # wipes and reseeds
```

Creates two admins, two tournament seasons, nine teams, 32 players, a completed
auction with bid history, a draft auction ready to run, and six matches with
full scorecards.

| Role | Email | Password |
| --- | --- | --- |
| Super admin | `admin@medianv.com` | `Admin@12345` |
| Auction operator | `operator@medianv.com` | `Operator@12345` |

Change these before deploying anywhere public.

## Checks

```bash
npm run typecheck
npm run lint
npm run build
npm test        # 25 end-to-end tests on an in-memory replica set
```

## Auction rules

Every rule is enforced here, server-side. The client is never trusted with
budget or increment arithmetic.

- The opening bid equals the player's base price. Later bids add the increment
  for the current level, configured per auction as tiers. The default mirrors
  the original system: +1 below 40, +2 at 40 and above.
- A bid is rejected when the auction is not live, the player is already sold or
  withdrawn, the team is inactive, the team already holds the highest bid, the
  amount is below the next legal bid, the team cannot afford it, or the squad
  is full.
- Completing a sale runs in a transaction: the player is marked sold, the purse
  debited and the squad record written together, or not at all.

## Realtime

Clients connect to `${WS_PATH}?auctionId=<id>` and receive `AUCTION_STARTED`,
`AUCTION_PAUSED`, `AUCTION_RESUMED`, `PLAYER_CHANGED`, `BID_PLACED`,
`PLAYER_SOLD`, `PLAYER_UNSOLD` and `AUCTION_COMPLETED`. Dead connections are
dropped by a heartbeat every 30 seconds.

## Statistics

Batting, bowling and fielding figures are derived from scorecard records rather
than stored as running totals, so they cannot drift. Fielding numbers come from
dismissal records on each innings, so catches, stumpings and run-outs never
disagree with the scorecard.

## API

Base path `/api`. Every response shares one envelope:

```json
{ "success": true, "message": "...", "data": {}, "meta": {} }
{ "success": false, "message": "Validation failed", "errors": {} }
```

| Group | Endpoints |
| --- | --- |
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password` |
| Admins | `GET/POST /admins`, `GET/PATCH/DELETE /admins/:id`, `POST /admins/:id/reset-password` |
| Tournaments | `GET/POST /tournaments`, `GET/PATCH/DELETE /tournaments/:id`, `GET /tournaments/:id/statistics`, `GET /tournaments/:id/points-table`, `POST /tournaments/:id/start`, `POST /tournaments/:id/end` |
| Seasons | `GET /seasons` |
| Teams | `GET/POST /teams`, `GET/PATCH/DELETE /teams/:id`, `GET /teams/:id/squad` |
| Players | `GET/POST /players`, `GET/PATCH/DELETE /players/:id`, `GET /players/:id/statistics` |
| Matches | `GET/POST /matches`, `GET/PATCH/DELETE /matches/:id`, `POST /matches/:id/innings` |
| Auctions | `GET/POST /auctions`, `GET/PATCH/DELETE /auctions/:id`, `GET /auctions/:id/state`, `GET /auctions/:id/players`, `GET /auctions/:id/results`, `POST /auctions/:id/players`, `DELETE /auctions/:id/players/:playerId` |
| Auction control | `POST /auctions/:id/{start,pause,resume,complete,current-player,bids,sell,unsold,next-player}` |
| Statistics | `GET /statistics/dashboard`, `GET /statistics/leaderboards` |
| Search | `GET /search?q=` |

Reads that power public pages are open. Every write requires a bearer token,
and admin management additionally requires the `SUPER_ADMIN` role.
