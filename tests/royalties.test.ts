import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createPublishedListing, fund, makeTestApp, seedArtist, seedUser, signedInAgent, type TestContext } from "./helpers.js";

type Agent = Awaited<ReturnType<typeof signedInAgent>>;

describe("royalty statements", () => {
  let ctx: TestContext;
  let artist: Agent;
  let artistId: number;
  let orderIds: number[];

  beforeEach(async () => {
    ctx = makeTestApp();
    artistId = (await seedArtist(ctx, "artist@example.com")).id;
    await seedArtist(ctx, "rival@example.com");
    await seedUser(ctx, "buyer@example.com", "client");
    await seedUser(ctx, "admin@example.com", "admin");
    artist = await signedInAgent(ctx, "artist@example.com");
    const buyer = await signedInAgent(ctx, "buyer@example.com");
    await fund(buyer, 1_000_000);
    await fund(buyer, 1_000_000);

    const first = await createPublishedListing(artist, { color: 20, basePriceCents: 10_000 });
    const second = await createPublishedListing(artist, { color: 21, basePriceCents: 20_000 });
    const third = await createPublishedListing(artist, { color: 22, basePriceCents: 40_000 });
    orderIds = [];
    for (const listing of [first, second, third]) {
      const order = await buyer.post("/api/orders").send({ listingId: listing.id, license: "non_commercial" });
      orderIds.push(order.body.order.id);
    }
    await buyer.post(`/api/orders/${orderIds[0]}/confirm`);
    await buyer.post(`/api/orders/${orderIds[1]}/confirm`);
    // third stays in escrow
    ctx.db.prepare("UPDATE orders SET completed_at = '2026-03-10T12:00:00.000Z' WHERE id = ?").run(orderIds[0]);
    ctx.db.prepare("UPDATE orders SET completed_at = '2026-04-20T09:00:00.000Z' WHERE id = ?").run(orderIds[1]);
  });

  it("totals completed orders and reports pending escrow separately", async () => {
    const { statement } = (await artist.get("/api/royalties")).body;
    expect(statement.totals).toEqual({ orderCount: 2, grossCents: 30_000, commissionCents: 4_500, netCents: 25_500 });
    expect(statement.pendingNetCents).toBe(34_000); // 40,000 less 15%
    expect(statement.orders.map((line: { orderId: number }) => line.orderId)).toEqual([orderIds[0], orderIds[1]]);
    expect(statement.orders[0]).toMatchObject({ grossCents: 10_000, commissionCents: 1_500, netCents: 8_500 });
    for (const line of statement.orders) expect(line.grossCents - line.commissionCents).toBe(line.netCents);
  });

  it("filters by inclusive date range", async () => {
    const march = (await artist.get("/api/royalties?from=2026-03-01&to=2026-03-10")).body.statement;
    expect(march.totals.orderCount).toBe(1);
    expect(march.totals.netCents).toBe(8_500);
    const gap = (await artist.get("/api/royalties?from=2026-03-11&to=2026-04-19")).body.statement;
    expect(gap.totals).toEqual({ orderCount: 0, grossCents: 0, commissionCents: 0, netCents: 0 });
    const fromApril = (await artist.get("/api/royalties?from=2026-04-20")).body.statement;
    expect(fromApril.totals.orderCount).toBe(1);
  });

  it("validates dates", async () => {
    for (const query of ["from=2026-13-01", "from=2026-02-30", "to=yesterday", "from=2026-05-01&to=2026-04-01"]) {
      expect((await artist.get(`/api/royalties?${query}`)).status).toBe(400);
    }
  });

  it("matches what the artist's wallet received", async () => {
    const { statement } = (await artist.get("/api/royalties")).body;
    const wallet = (await artist.get("/api/wallet")).body.balanceCents;
    expect(wallet).toBe(statement.totals.netCents);
  });

  it("keeps artists out of each other's statements", async () => {
    const rival = await signedInAgent(ctx, "rival@example.com");
    expect((await rival.get("/api/royalties")).body.statement.totals.orderCount).toBe(0);
    expect((await rival.get(`/api/royalties?artistId=${artistId}`)).status).toBe(403);
    expect((await artist.get(`/api/royalties?artistId=${artistId}`)).status).toBe(200);
  });

  it("requires an artist or admin, and admins must name the artist", async () => {
    expect((await request(ctx.app).get("/api/royalties")).status).toBe(401);
    expect((await (await signedInAgent(ctx, "buyer@example.com")).get("/api/royalties")).status).toBe(403);
    const admin = await signedInAgent(ctx, "admin@example.com");
    expect((await admin.get("/api/royalties")).status).toBe(400);
    expect((await admin.get(`/api/royalties?artistId=${artistId}`)).body.statement.totals.orderCount).toBe(2);
  });
});
