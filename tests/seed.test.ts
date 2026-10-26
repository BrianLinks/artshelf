import request from "supertest";
import { describe, expect, it } from "vitest";
import { LocalStorage } from "../src/assets/storage.js";
import { verifyLedger } from "../src/ledger/ledger.js";
import { DEMO_PASSWORD, seedDemoData } from "../src/seed/demo.js";
import { makeTestApp } from "./helpers.js";

describe("demo data", () => {
  it("fills an empty database with a working marketplace", async () => {
    const ctx = makeTestApp();
    const summary = await seedDemoData(ctx.db, new LocalStorage(ctx.uploadDir), ctx.config);
    expect(summary).toMatchObject({ created: true, listings: 12, orders: 5, reviews: 4, requests: 1, password: DEMO_PASSWORD });
    expect(summary.accounts).toHaveLength(8);

    const browse = await request(ctx.app).get("/api/listings?limit=50");
    expect(browse.body.total).toBe(12);
    for (const listing of browse.body.listings) {
      expect(listing.asset.previewUrl).toBeTruthy();
      expect(listing.asset.palette.length).toBeGreaterThan(0);
      expect(listing.licenses.length).toBeGreaterThan(0);
    }

    const premium = await request(ctx.app).get("/api/artists?tier=premium");
    expect(premium.body.artists).toHaveLength(2);
  });

  it("creates accounts that can sign in with the demo password", async () => {
    const ctx = makeTestApp();
    await seedDemoData(ctx.db, new LocalStorage(ctx.uploadDir), ctx.config);
    for (const email of ["ada@demo.artshelf.test", "lena@demo.artshelf.test", "mod@demo.artshelf.test", "admin@demo.artshelf.test"]) {
      const response = await request(ctx.app).post("/api/auth/login").send({ email, password: DEMO_PASSWORD });
      expect(response.status).toBe(200);
    }
  });

  it("produces sales, reviews, a wallet history and a request with proposals", async () => {
    const ctx = makeTestApp();
    await seedDemoData(ctx.db, new LocalStorage(ctx.uploadDir), ctx.config);

    const dragon = (await request(ctx.app).get("/api/search?q=crimson+dragon")).body.listings[0];
    expect(dragon.title).toBe("Crimson Dragon");
    expect(dragon.rating).toMatchObject({ count: 2, average: 4.5 });

    const ada = request.agent(ctx.app);
    await ada.post("/api/auth/login").send({ email: "ada@demo.artshelf.test", password: DEMO_PASSWORD });
    const wallet = await ada.get("/api/wallet");
    expect(wallet.body.balanceCents).toBe(1_000_000 - 112_500 - 87_500 - 30_000);

    const board = await request(ctx.app).get("/api/requests");
    expect(board.body.total).toBe(1);
    expect(board.body.requests[0]).toMatchObject({ status: "proposed", proposalCount: 2 });

    expect(verifyLedger(ctx.db)).toMatchObject({ ok: true, problems: [] });
  });

  it("leaves existing data alone when run twice", async () => {
    const ctx = makeTestApp();
    const storage = new LocalStorage(ctx.uploadDir);
    await seedDemoData(ctx.db, storage, ctx.config);
    const again = await seedDemoData(ctx.db, storage, ctx.config);
    expect(again.created).toBe(false);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 8 });
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM listings").get()).toEqual({ n: 12 });
  });

  it("uses a password of your choice", async () => {
    const ctx = makeTestApp();
    await seedDemoData(ctx.db, new LocalStorage(ctx.uploadDir), ctx.config, "another-long-password");
    const response = await request(ctx.app).post("/api/auth/login").send({ email: "ada@demo.artshelf.test", password: "another-long-password" });
    expect(response.status).toBe(200);
    expect((await request(ctx.app).post("/api/auth/login").send({ email: "ada@demo.artshelf.test", password: DEMO_PASSWORD })).status).toBe(401);
  });
});
