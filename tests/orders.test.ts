import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { setTier } from "../src/artists/profiles.js";
import { balanceOf, escrowAccountId, systemAccountId, verifyLedger, walletAccountId } from "../src/ledger/ledger.js";
import { releaseDueEscrows } from "../src/orders/service.js";
import {
  createPublishedListing,
  fund,
  makeTestApp,
  seedArtist,
  seedUser,
  signedInAgent,
  type TestContext,
} from "./helpers.js";

type Agent = Awaited<ReturnType<typeof signedInAgent>>;

describe("wallet", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = makeTestApp();
    await seedUser(ctx, "buyer@example.com", "client");
    await seedUser(ctx, "mod@example.com", "moderator");
  });

  it("tops up a simulated balance and lists the history", async () => {
    const buyer = await signedInAgent(ctx, "buyer@example.com");
    const response = await buyer.post("/api/wallet/deposit").send({ amountCents: 20_000 });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ balanceCents: 20_000, simulated: true });
    const wallet = await buyer.get("/api/wallet");
    expect(wallet.body.balanceCents).toBe(20_000);
    expect(wallet.body.entries[0]).toMatchObject({ kind: "deposit", amountCents: 20_000 });
  });

  it.each([{ amountCents: 99 }, { amountCents: 1_000_001 }, { amountCents: 100.5 }, { amountCents: "500" }, {}])(
    "rejects the deposit %j",
    async (payload) => {
      const buyer = await signedInAgent(ctx, "buyer@example.com");
      expect((await buyer.post("/api/wallet/deposit").send(payload)).status).toBe(400);
    },
  );

  it("is limited to clients and artists", async () => {
    expect((await request(ctx.app).get("/api/wallet")).status).toBe(401);
    const mod = await signedInAgent(ctx, "mod@example.com");
    expect((await mod.get("/api/wallet")).status).toBe(403);
    expect((await mod.post("/api/wallet/deposit").send({ amountCents: 500 })).status).toBe(403);
  });
});

describe("orders and escrow", () => {
  let ctx: TestContext;
  let artist: Agent;
  let buyer: Agent;
  let artistId: number;
  let buyerId: number;
  let listing: { id: number; png: Buffer };

  const wallet = (userId: number) => balanceOf(ctx.db, walletAccountId(ctx.db, userId));
  const revenue = () => balanceOf(ctx.db, systemAccountId(ctx.db, "platform_revenue"));
  const escrow = (orderId: number) => balanceOf(ctx.db, escrowAccountId(ctx.db, orderId));
  const buy = (agent: Agent, license = "commercial", listingId = listing.id) =>
    agent.post("/api/orders").send({ listingId, license });
  const expectLedgerClean = () => expect(verifyLedger(ctx.db)).toMatchObject({ ok: true, problems: [] });

  beforeEach(async () => {
    ctx = makeTestApp();
    artistId = (await seedArtist(ctx, "artist@example.com")).id;
    buyerId = (await seedUser(ctx, "buyer@example.com", "client")).id;
    await seedUser(ctx, "other@example.com", "client");
    await seedUser(ctx, "mod@example.com", "moderator");
    await seedUser(ctx, "admin@example.com", "admin");
    artist = await signedInAgent(ctx, "artist@example.com");
    buyer = await signedInAgent(ctx, "buyer@example.com");
    listing = await createPublishedListing(artist); // base 50,000: commercial 125,000
    await fund(buyer, 1_000_000);
  });

  describe("placing an order", () => {
    it("holds the price in escrow and snapshots the commission", async () => {
      const response = await buy(buyer);
      expect(response.status).toBe(201);
      expect(response.body.order).toMatchObject({
        status: "escrow",
        license: "commercial",
        priceCents: 125_000,
        commissionBps: 1_500,
        commissionCents: 18_750,
        payoutCents: 106_250,
        listing: { id: listing.id, title: "Test Artwork" },
      });
      const id = response.body.order.id;
      expect(wallet(buyerId)).toBe(1_000_000 - 125_000);
      expect(escrow(id)).toBe(125_000);
      expect(wallet(artistId)).toBe(0);
      expectLedgerClean();
    });

    it("charges premium artists a lower commission", async () => {
      setTier(ctx.db, artistId, "premium");
      const order = (await buy(buyer)).body.order;
      expect(order).toMatchObject({ commissionBps: 1_000, commissionCents: 12_500, payoutCents: 112_500 });
    });

    it("keeps the original price after the artist changes the listing", async () => {
      const id = (await buy(buyer)).body.order.id;
      await artist.put(`/api/listings/${listing.id}`).send({ title: "Renamed", basePriceCents: 10_000, licenses: ["commercial"] });
      const order = (await buyer.get(`/api/orders/${id}`)).body.order;
      expect(order).toMatchObject({ priceCents: 125_000, listing: { title: "Test Artwork" } });
    });

    it("rejects an order the wallet cannot cover, changing nothing", async () => {
      const poor = await signedInAgent(ctx, "other@example.com");
      await fund(poor, 100_000);
      const response = await buy(poor);
      expect(response.status).toBe(402);
      expect(response.body.error.code).toBe("insufficient_funds");
      expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM orders").get()).toEqual({ n: 0 });
      expectLedgerClean();
    });

    it("rejects invalid purchases", async () => {
      const own = await buy(artist);
      expect(own.status).toBe(409);
      expect(own.body.error.code).toBe("cannot_buy_own_listing");
      const narrow = await createPublishedListing(artist, { color: 12, licenses: ["non_commercial"] });
      expect((await buy(buyer, "broadcast", narrow.id)).body.error.code).toBe("license_not_offered");
      expect((await buy(buyer, "commercial", 9999)).body.error.code).toBe("listing_unavailable");
      await artist.post(`/api/listings/${narrow.id}/unpublish`);
      expect((await buy(buyer, "non_commercial", narrow.id)).body.error.code).toBe("listing_unavailable");
      expect((await buyer.post("/api/orders").send({ listingId: listing.id, license: "exclusive" })).status).toBe(400);
      expect((await request(ctx.app).post("/api/orders").send({ listingId: listing.id, license: "commercial" })).status).toBe(401);
      const mod = await signedInAgent(ctx, "mod@example.com");
      expect((await buy(mod)).status).toBe(403);
    });

    it("rejects buying the same license twice but allows a different license", async () => {
      expect((await buy(buyer)).status).toBe(201);
      const again = await buy(buyer);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("already_purchased");
      expect((await buy(buyer, "non_commercial")).status).toBe(201);
    });
  });

  describe("completing", () => {
    it("pays the artist and the platform when the buyer confirms", async () => {
      const id = (await buy(buyer)).body.order.id;
      const confirmed = await buyer.post(`/api/orders/${id}/confirm`);
      expect(confirmed.body.order.status).toBe("completed");
      expect(confirmed.body.order.completedAt).toBeTruthy();
      expect(escrow(id)).toBe(0);
      expect(wallet(artistId)).toBe(106_250);
      expect(revenue()).toBe(18_750);
      expectLedgerClean();
    });

    it("cannot be confirmed twice, or by anyone but the buyer", async () => {
      const id = (await buy(buyer)).body.order.id;
      const other = await signedInAgent(ctx, "other@example.com");
      expect((await other.post(`/api/orders/${id}/confirm`)).status).toBe(404);
      expect((await artist.post(`/api/orders/${id}/confirm`)).status).toBe(404);
      await buyer.post(`/api/orders/${id}/confirm`);
      const twice = await buyer.post(`/api/orders/${id}/confirm`);
      expect(twice.status).toBe(409);
      expect(twice.body.error.code).toBe("invalid_order_state");
      expect(wallet(artistId)).toBe(106_250);
    });

    it("releases automatically once the hold period has passed, and not before", async () => {
      const order = (await buy(buyer)).body.order;
      const holdUntil = new Date(order.holdUntil);
      expect(holdUntil.getTime() - new Date(order.createdAt).getTime()).toBe(7 * 86_400_000);
      expect(releaseDueEscrows(ctx.db, new Date(holdUntil.getTime() - 1))).toBe(0);
      expect(releaseDueEscrows(ctx.db, holdUntil)).toBe(1);
      expect(releaseDueEscrows(ctx.db, holdUntil)).toBe(0);
      expect((await buyer.get(`/api/orders/${order.id}`)).body.order.status).toBe("completed");
      expect(wallet(artistId)).toBe(106_250);
      expectLedgerClean();
    });
  });

  describe("refunds and disputes", () => {
    it("lets the artist refund an escrowed order in full, then buy again", async () => {
      const id = (await buy(buyer)).body.order.id;
      const other = await signedInAgent(ctx, "other@example.com");
      expect((await other.post(`/api/orders/${id}/refund`)).status).toBe(403);
      const refunded = await artist.post(`/api/orders/${id}/refund`);
      expect(refunded.body.order.status).toBe("refunded");
      expect(wallet(buyerId)).toBe(1_000_000);
      expect(escrow(id)).toBe(0);
      expect(revenue()).toBe(0);
      expectLedgerClean();
      expect((await buy(buyer)).status).toBe(201);
    });

    it("blocks the artist from refunding a completed order", async () => {
      const id = (await buy(buyer)).body.order.id;
      await buyer.post(`/api/orders/${id}/confirm`);
      const response = await artist.post(`/api/orders/${id}/refund`);
      expect(response.status).toBe(409);
      expect(wallet(buyerId)).toBe(1_000_000 - 125_000);
    });

    it("freezes a disputed order until a moderator resolves it", async () => {
      const id = (await buy(buyer)).body.order.id;
      expect((await buyer.post(`/api/orders/${id}/dispute`).send({ reason: "" })).status).toBe(400);
      const disputed = await buyer.post(`/api/orders/${id}/dispute`).send({ reason: "Not as described" });
      expect(disputed.body.order).toMatchObject({ status: "disputed", disputeReason: "Not as described" });
      expect((await buyer.post(`/api/orders/${id}/confirm`)).status).toBe(409);
      expect((await artist.post(`/api/orders/${id}/refund`)).status).toBe(409);
      expect(releaseDueEscrows(ctx.db, new Date(Date.now() + 30 * 86_400_000))).toBe(0);
      expect(escrow(id)).toBe(125_000);
    });

    it("lets a moderator release a disputed order to the artist", async () => {
      const id = (await buy(buyer)).body.order.id;
      await buyer.post(`/api/orders/${id}/dispute`).send({ reason: "Changed my mind" });
      expect((await buyer.post(`/api/moderation/orders/${id}/resolve`).send({ outcome: "release" })).status).toBe(403);
      const mod = await signedInAgent(ctx, "mod@example.com");
      const resolved = await mod.post(`/api/moderation/orders/${id}/resolve`).send({ outcome: "release", note: "Work matches listing" });
      expect(resolved.body.order).toMatchObject({ status: "completed", resolutionNote: "Work matches listing" });
      expect(wallet(artistId)).toBe(106_250);
      expect(revenue()).toBe(18_750);
      expectLedgerClean();
    });

    it("lets a moderator refund a disputed order to the buyer", async () => {
      const id = (await buy(buyer)).body.order.id;
      await buyer.post(`/api/orders/${id}/dispute`).send({ reason: "Wrong file" });
      const mod = await signedInAgent(ctx, "mod@example.com");
      expect((await mod.post(`/api/moderation/orders/${id}/resolve`).send({ outcome: "refund" })).body.order.status).toBe("refunded");
      expect(wallet(buyerId)).toBe(1_000_000);
      expect(revenue()).toBe(0);
      const again = await mod.post(`/api/moderation/orders/${id}/resolve`).send({ outcome: "refund" });
      expect(again.status).toBe(409);
      expect((await mod.post(`/api/moderation/orders/${id}/resolve`).send({ outcome: "keep" })).status).toBe(400);
      expectLedgerClean();
    });

    it("only resolves orders that are actually disputed", async () => {
      const id = (await buy(buyer)).body.order.id;
      const mod = await signedInAgent(ctx, "mod@example.com");
      expect((await mod.post(`/api/moderation/orders/${id}/resolve`).send({ outcome: "release" })).status).toBe(409);
    });
  });

  describe("access", () => {
    it("shows an order to the buyer, the artist, moderators and admins only", async () => {
      const id = (await buy(buyer)).body.order.id;
      for (const email of ["buyer@example.com", "artist@example.com", "mod@example.com", "admin@example.com"]) {
        expect((await (await signedInAgent(ctx, email)).get(`/api/orders/${id}`)).status).toBe(200);
      }
      expect((await (await signedInAgent(ctx, "other@example.com")).get(`/api/orders/${id}`)).status).toBe(404);
      expect((await request(ctx.app).get(`/api/orders/${id}`)).status).toBe(401);
    });

    it("lists purchases for the buyer and sales for the artist", async () => {
      await buy(buyer);
      expect((await buyer.get("/api/orders")).body.orders).toHaveLength(1);
      expect((await artist.get("/api/orders/sales")).body.orders).toHaveLength(1);
      expect((await (await signedInAgent(ctx, "other@example.com")).get("/api/orders")).body.orders).toHaveLength(0);
      expect((await buyer.get("/api/orders/sales")).status).toBe(403);
    });

    it("lets the buyer download the original file, even after the listing is removed", async () => {
      const id = (await buy(buyer)).body.order.id;
      const mod = await signedInAgent(ctx, "mod@example.com");
      await mod.post(`/api/moderation/listings/${listing.id}/remove`);
      const file = await buyer.get(`/api/orders/${id}/download`).buffer(true).parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
      expect(file.status).toBe(200);
      expect(file.headers["content-disposition"]).toMatch(/^attachment/);
      expect(Buffer.from(file.body).equals(listing.png)).toBe(true);
      expect((await (await signedInAgent(ctx, "other@example.com")).get(`/api/orders/${id}/download`)).status).toBe(404);
      expect((await artist.get(`/api/orders/${id}/download`)).status).toBe(404);
    });

    it("stops downloads once refunded and marks the license invalid", async () => {
      const id = (await buy(buyer)).body.order.id;
      await artist.post(`/api/orders/${id}/refund`);
      const download = await buyer.get(`/api/orders/${id}/download`);
      expect(download.status).toBe(409);
      expect((await buyer.get(`/api/orders/${id}/license`)).body.valid).toBe(false);
    });

    it("issues a license grant with the allowed uses", async () => {
      const id = (await buy(buyer)).body.order.id;
      const grant = (await buyer.get(`/api/orders/${id}/license`)).body;
      expect(grant).toMatchObject({ valid: true, license: "commercial", licenseName: "Commercial", priceCents: 125_000 });
      expect(grant.allowedUses).toContain("advertising");
      expect(grant.allowedUses).not.toContain("broadcast");
      expect((await (await signedInAgent(ctx, "mod@example.com")).get(`/api/orders/${id}/license`)).status).toBe(404);
    });
  });

  describe("conservation of money", () => {
    it("keeps the ledger balanced across a mix of outcomes", async () => {
      const second = await createPublishedListing(artist, { color: 14, basePriceCents: 30_000 });
      const third = await createPublishedListing(artist, { color: 15, basePriceCents: 10_000 });
      const a = (await buy(buyer, "commercial")).body.order.id;
      const b = (await buy(buyer, "non_commercial", second.id)).body.order.id;
      const c = (await buy(buyer, "broadcast", third.id)).body.order.id;
      await buyer.post(`/api/orders/${a}/confirm`);
      await artist.post(`/api/orders/${b}/refund`);
      await buyer.post(`/api/orders/${c}/dispute`).send({ reason: "Late" });
      const mod = await signedInAgent(ctx, "mod@example.com");
      await mod.post(`/api/moderation/orders/${c}/resolve`).send({ outcome: "release" });

      const total = ctx.db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM ledger_lines").get();
      expect(total).toEqual({ total: 0 });
      expect(revenue()).toBe(18_750 + 7_500); // orders a (125,000 at 15%) and c (50,000 at 15%)
      expect(wallet(artistId)).toBe(106_250 + 42_500);
      expect(wallet(buyerId)).toBe(1_000_000 - 125_000 - 50_000);
      expectLedgerClean();
    });

    it("exposes the reconciliation report to admins only", async () => {
      await buy(buyer);
      const admin = await signedInAgent(ctx, "admin@example.com");
      const report = await admin.get("/api/admin/ledger/verify");
      expect(report.status).toBe(200);
      expect(report.body).toMatchObject({ ok: true, problems: [] });
      expect((await (await signedInAgent(ctx, "mod@example.com")).get("/api/admin/ledger/verify")).status).toBe(403);
    });
  });
});
