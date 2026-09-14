/**
 * Downloads player profile photos from CricHeroes into the frontend's public
 * folder, one file per player named after them, and records the mapping the
 * seed uses so the photos survive database resets.
 *
 *   npm run import:photos                     # download + update the running API
 *   npm run import:photos -- --out /some/dir  # different folder
 *   npm run import:photos -- --no-apply       # files and mapping only
 *
 * Players are matched to CricHeroes by the ids the results import already
 * stored, so run the CricHeroes sync first. Players with no CricHeroes profile
 * (bought at auction but never played) have no photo to fetch and are listed.
 */
import fs from "fs";
import path from "path";
import { env } from "../config/env";
import { nameSlug } from "../utils/slug";
import { PHOTO_MAP_FILE } from "./player-photos";

const CH = env.cricheroes.apiBase;
const CH_HEADERS = {
  "api-key": env.cricheroes.apiKey,
  udid: "auction-platform-sync",
  "device-type": "web",
  Accept: "application/json",
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface ChPhoto {
  player_id: number;
  profile_photo?: string | null;
}

interface OurPlayer {
  _id: string;
  fullName: string;
  externalId?: number;
  externalAliases?: number[];
  profileImage?: string;
}

async function chGet<T>(p: string): Promise<T | undefined> {
  const res = await fetch(CH + p, { headers: CH_HEADERS });
  const text = await res.text();
  if (!text) return undefined;
  return (JSON.parse(text) as { data?: T }).data;
}

/** Every CricHeroes player id → photo URL this tournament exposes. */
async function collectPhotoUrls(tournamentId: number): Promise<Map<number, string>> {
  const urls = new Map<number, string>();
  const add = (rows: ChPhoto[] | undefined) => {
    for (const row of rows ?? []) {
      if (row.profile_photo && /^https?:\/\//.test(row.profile_photo) && !urls.has(row.player_id)) {
        urls.set(row.player_id, row.profile_photo);
      }
    }
  };

  const teams = await chGet<Array<{ players: ChPhoto[] }>>(
    `/api/v1/tournament/get-tournament-teams-and-players/${tournamentId}`
  );
  for (const team of teams ?? []) add(team.players);

  // substitutes who played but aren't on a roster show up on the leaderboards
  for (const board of ["batting", "bowling", "fielding"]) {
    add(
      await chGet<ChPhoto[]>(
        `/api/v1/leaderboard/get-${board}-leaderboard?tournamentId=${tournamentId}&pagesize=200&pageno=1`
      )
    );
  }
  return urls;
}

async function ourPlayers(api: string): Promise<OurPlayer[]> {
  const all: OurPlayer[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const res = (await (await fetch(`${api}/players?limit=100&page=${page}`)).json()) as {
      data: OurPlayer[];
      meta: { totalPages: number };
    };
    all.push(...res.data);
    if (page >= res.meta.totalPages) break;
  }
  return all;
}

async function main() {
  const api = arg("api") ?? `http://localhost:${env.port}/api`;
  const tournamentId = Number(arg("external") ?? 2000875);
  const outDir = path.resolve(
    arg("out") ??
      process.env.PLAYER_PHOTOS_DIR ??
      path.join(__dirname, "../../../new-autionapp-fronted/public/player-photos")
  );
  const apply = !process.argv.includes("--no-apply");

  fs.mkdirSync(outDir, { recursive: true });
  console.log(`[photos] folder: ${outDir}`);

  const [urls, players] = await Promise.all([collectPhotoUrls(tournamentId), ourPlayers(api)]);
  console.log(`[photos] CricHeroes photos available: ${urls.size} | our players: ${players.length}`);

  const mapping: Record<string, string> = fs.existsSync(PHOTO_MAP_FILE)
    ? (JSON.parse(fs.readFileSync(PHOTO_MAP_FILE, "utf8")) as Record<string, string>)
    : {};

  let downloaded = 0;
  let reused = 0;
  const noSource: string[] = [];
  const toApply: Array<{ id: string; path: string }> = [];

  for (const player of players) {
    const ids = [player.externalId, ...(player.externalAliases ?? [])].filter(
      (id): id is number => typeof id === "number"
    );
    const url = ids.map((id) => urls.get(id)).find(Boolean);
    if (!url) {
      noSource.push(player.fullName);
      continue;
    }

    const slug = nameSlug(player.fullName);
    const ext = (new URL(url).pathname.match(/\.(jpe?g|png|webp)$/i)?.[1] ?? "jpg").toLowerCase();
    const file = `${slug}.${ext === "jpeg" ? "jpg" : ext}`;
    const target = path.join(outDir, file);
    const publicPath = `/player-photos/${file}`;

    if (fs.existsSync(target) && fs.statSync(target).size > 0) {
      reused += 1;
    } else {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[photos] ${player.fullName}: download failed (${res.status})`);
        continue;
      }
      fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
      downloaded += 1;
      await new Promise((r) => setTimeout(r, 80));
    }

    mapping[slug] = publicPath;
    if (player.profileImage !== publicPath) toApply.push({ id: player._id, path: publicPath });
  }

  fs.writeFileSync(PHOTO_MAP_FILE, JSON.stringify(mapping, null, 2) + "\n");
  console.log(
    `[photos] downloaded ${downloaded}, already had ${reused}, mapping entries ${Object.keys(mapping).length}`
  );

  if (apply && toApply.length) {
    const email = process.env.ADMIN_EMAIL ?? "admin@medianv.com";
    const password = process.env.ADMIN_PASSWORD ?? "Admin@12345";
    const login = (await (
      await fetch(`${api}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
    ).json()) as { data?: { token: string } };
    if (!login.data?.token) {
      console.warn("[photos] could not sign in to apply photos — set ADMIN_EMAIL / ADMIN_PASSWORD");
    } else {
      let applied = 0;
      for (const { id, path: publicPath } of toApply) {
        const res = await fetch(`${api}/players/${id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${login.data.token}`,
          },
          body: JSON.stringify({ profileImage: publicPath }),
        });
        if (res.ok) applied += 1;
      }
      console.log(`[photos] applied to ${applied} players on ${api}`);
    }
  }

  if (noSource.length) {
    console.log(
      `[photos] no CricHeroes profile for ${noSource.length} players (never played this season): ${noSource.join(", ")}`
    );
  }
}

main().catch((err) => {
  console.error("[photos] failed:", err);
  process.exit(1);
});
