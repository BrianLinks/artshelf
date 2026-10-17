import bcrypt from "bcryptjs";
import { z } from "zod";

/** bcrypt ignores bytes past 72, so longer passwords are rejected instead of silently truncated. */
export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Password must be at most 72 bytes");

export function hashPassword(password: string, rounds: number): Promise<string> {
  return bcrypt.hash(password, rounds);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** A hash to compare against when the email is unknown, so timing does not reveal which emails exist. */
export function makeDummyHash(rounds: number): string {
  return bcrypt.hashSync("not-a-real-password", rounds);
}
