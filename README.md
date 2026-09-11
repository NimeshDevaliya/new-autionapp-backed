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

Loads the league's real data: all four MedianV Premier League seasons, the six
Season 4 franchises with their logos, colours and 2 Cr purses, 76 registered
players, every squad with sold prices and captain/vice-captain flags, and the
completed Season 4 auction record. Eleven players are registered without a team
and can be picked up in a future auction.

No match scorecards are seeded, so statistics stay empty until real results
are entered — nothing is invented.

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

Leaderboards cover batting, bowling, all-rounders and fielding. All-rounders are
ranked by a stated formula — runs plus 20 per wicket — and only players who have
both batted and bowled qualify. The points table awards two points for a win and
one for a tie, computes net run rate the standard way (an innings that ends short
of its quota is charged in full unless it was a successful chase), and carries a
per-team `pointsAdjustment` for anything the league awarded separately.

## Syncing results from CricHeroes

The league scores its matches on CricHeroes. Results can be pulled in from the
tournament page ("Sync from CricHeroes") or from the command line:

```bash
npm run import:cricheroes -- --external 2000875   # first run; the id is remembered
npm run import:cricheroes                          # later runs: only new matches
npm run import:cricheroes -- --refresh             # re-import everything
```

Every match is keyed by its CricHeroes id, so re-running is safe. Players and
teams are linked by CricHeroes id after the first run; before that, names are
matched conservatively — exact, then within-team rules such as a bare first name
or a surname spelling variant — and any name that could mean two people is
created as a new player rather than guessed. Duplicate CricHeroes profiles for
one person are folded in as aliases. Super overs settle the match but are not
counted in statistics. The response is a full report: matches, every non-exact
name match, players created, players who appeared for a team they are not on the
squad of, and the official standings beside ours.

Squads are the auction record and are never changed by a sync.

This uses the public web API the CricHeroes website itself calls, with the key
that site ships to every browser. It is the league's own data and the sync is
light (a few requests per match, run occasionally), but it is an undocumented
interface and may need adjusting if CricHeroes changes it. Don't poll it.

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
