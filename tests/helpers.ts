import type { Express } from "express";
import request from "supertest";
import { hashPassword } from "../src/auth/password.js";
import type { Role } from "../src/auth/roles.js";
import { createUser, type User } from "../src/auth/users.js";
import { loadConfig, type Config } from "../src/config.js";
import { openDatabase, type Db } from "../src/db/connection.js";
import { migrate } from "../src/db/migrate.js";
import { createApp } from "../src/http/app.js";

export const PASSWORD = "correct horse battery";

export interface TestContext {
  app: Express;
  db: Db;
  config: Config;
}

export function makeTestApp(overrides: Record<string, string> = {}): TestContext {
  const config = loadConfig({
    NODE_ENV: "test",
    BCRYPT_ROUNDS: "4",
    LOGIN_RATE_LIMIT_MAX: "1000",
    DATABASE_PATH: ":memory:",
    ...overrides,
  });
  const db = openDatabase(":memory:");
  migrate(db);
  return { app: createApp(db, config), db, config };
}

export async function seedUser(ctx: TestContext, email: string, role: Role): Promise<User> {
  return createUser(ctx.db, {
    email,
    passwordHash: await hashPassword(PASSWORD, ctx.config.BCRYPT_ROUNDS),
    displayName: email.split("@")[0] ?? "user",
    role,
  });
}

/** Returns a supertest agent that keeps cookies, already signed in as the given email. */
export async function signedInAgent(ctx: TestContext, email: string) {
  const agent = request.agent(ctx.app);
  const response = await agent.post("/api/auth/login").send({ email, password: PASSWORD });
  if (response.status !== 200) throw new Error(`Login failed in test helper: ${response.status}`);
  return agent;
}
