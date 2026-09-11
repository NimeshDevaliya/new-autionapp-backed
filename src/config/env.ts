import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3005),
  mongodbUri: required("MONGODB_URI"),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  wsPath: process.env.WS_PATH ?? "/ws",
  isProduction: process.env.NODE_ENV === "production",

  /**
   * The scoring service the league records matches on. The default key is the
   * one CricHeroes' own public website ships to every browser — it is not a
   * secret, but it can be overridden if it ever changes.
   */
  cricheroes: {
    apiBase: process.env.CRICHEROES_API_BASE ?? "https://api.cricheroes.in",
    webBase: process.env.CRICHEROES_WEB_BASE ?? "https://cricheroes.com",
    apiKey: process.env.CRICHEROES_API_KEY ?? "cr!CkH3r0s",
  },
};
