import { z } from "zod";
import { hashPassword, passwordSchema } from "../auth/password.js";
import { createUser, EmailTakenError } from "../auth/users.js";
import { loadConfig } from "../config.js";
import { openDatabase } from "../db/connection.js";
import { migrate } from "../db/migrate.js";

const input = z
  .object({
    ADMIN_EMAIL: z.string().trim().toLowerCase().email(),
    ADMIN_PASSWORD: passwordSchema,
    ADMIN_NAME: z.string().trim().min(1).max(80).default("Administrator"),
  })
  .parse(process.env);

const config = loadConfig();
const db = openDatabase(config.DATABASE_PATH);
migrate(db);

try {
  const user = createUser(db, {
    email: input.ADMIN_EMAIL,
    passwordHash: await hashPassword(input.ADMIN_PASSWORD, config.BCRYPT_ROUNDS),
    displayName: input.ADMIN_NAME,
    role: "admin",
  });
  console.log(`Created admin ${user.email} (id ${user.id})`);
} catch (error) {
  if (error instanceof EmailTakenError) {
    console.error("A user with that email already exists");
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  db.close();
}
