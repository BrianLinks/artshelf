import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().min(1).default("./data/artshelf.db"),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(24),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  UPLOAD_DIR: z.string().min(1).default("./data/uploads"),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(500).default(20),
  USER_QUOTA_MB: z.coerce.number().int().min(1).default(200),
});

export type Config = z.infer<typeof schema>;

/** Parses and validates environment variables. Throws on invalid or unsafe values. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const config = schema.parse(env);
  if (config.NODE_ENV === "production" && config.BCRYPT_ROUNDS < 10) {
    throw new Error("BCRYPT_ROUNDS must be at least 10 when NODE_ENV=production");
  }
  return config;
}
