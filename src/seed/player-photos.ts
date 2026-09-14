import fs from "fs";
import path from "path";
import { nameSlug } from "../utils/slug";

/**
 * Player photos live in the frontend's public folder, one file per player named
 * after them (dishang-chavda.jpg). This mapping — written by `import:photos` —
 * lets the seed and the CricHeroes import point players at those files without
 * needing the folder to be reachable at runtime.
 */
export const PHOTO_MAP_FILE = path.join(__dirname, "player-photos.json");

let cache: Record<string, string> | null = null;

export function loadPlayerPhotos(): Record<string, string> {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(PHOTO_MAP_FILE, "utf8")) as Record<string, string>;
  } catch {
    cache = {};
  }
  return cache;
}

/** Public URL path of a player's photo, if one has been downloaded. */
export function photoFor(fullName: string): string | undefined {
  return loadPlayerPhotos()[nameSlug(fullName)];
}
