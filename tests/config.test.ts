import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("applies defaults", () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      NODE_ENV: "development",
      PORT: 3000,
      DATABASE_PATH: "./data/artshelf.db",
      SESSION_TTL_HOURS: 24,
      BCRYPT_ROUNDS: 12,
    });
  });

  it("coerces numeric strings", () => {
    expect(loadConfig({ PORT: "8080" }).PORT).toBe(8080);
  });

  it.each([{ PORT: "0" }, { PORT: "70000" }, { PORT: "abc" }, { NODE_ENV: "staging" }, { BCRYPT_ROUNDS: "2" }])(
    "rejects invalid input %j",
    (env) => {
      expect(() => loadConfig(env)).toThrow();
    },
  );

  it("refuses weak password hashing in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production", BCRYPT_ROUNDS: "8" })).toThrow(/BCRYPT_ROUNDS/);
    expect(loadConfig({ NODE_ENV: "production", BCRYPT_ROUNDS: "12" }).BCRYPT_ROUNDS).toBe(12);
  });
});
