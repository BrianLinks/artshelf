import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createPublishedListing, fund, makeTestApp, seedArtist, seedUser, signedInAgent, type TestContext } from "./helpers.js";

type Agent = Awaited<ReturnType<typeof signedInAgent>>;

describe("staff lists of disputed orders and requests", () => {
  let ctx: TestContext;
  let artist: Agent;
  let client: Agent;
  let mod: Agent;
  let admin: Agent;
  let orderId: number;
  let requestId: number;

  beforeEach(async () => {
    ctx = makeTestApp();
    await seedArtist(ctx, "artist@example.com");
    await seedUser(ctx, "client@example.com", "client");
    await seedUser(ctx, "mod@example.com", "moderator");
    await seedUser(ctx, "admin@example.com", "admin");
    artist = await signedInAgent(ctx, "artist@example.com");
    client = await signedInAgent(ctx, "client@example.com");
    mod = await signedInAgent(ctx, "mod@example.com");
    admin = await signedInAgent(ctx, "admin@example.com");
    await fund(client, 1_000_000);

    const listing = await createPublishedListing(artist);
    const order = await client.post("/api/orders").send({ listingId: listing.id, license: "commercial" });
    orderId = order.body.order.id;
    await client.post(`/api/orders/${orderId}/dispute`).send({ reason: "Wrong file" });

    const created = await client.post("/api/requests").send({ title: "Poster", description: "A poster", category: "illustration", budgetCents: 100_000 });
    requestId = created.body.request.id;
    await artist.post(`/api/requests/${requestId}/proposals`).send({ priceCents: 80_000, message: "Yes", deliveryDays: 5, maxRevisions: 2 });
    const proposals = await client.get(`/api/requests/${requestId}/proposals`);
    await client.post(`/api/requests/${requestId}/accept`).send({ proposalId: proposals.body.proposals[0].id });
    await client.post(`/api/requests/${requestId}/dispute`).send({ reason: "No updates" });
  });

  it("lists disputed orders and requests for moderators and admins", async () => {
    for (const staff of [mod, admin]) {
      const orders = await staff.get("/api/moderation/orders");
      expect(orders.status).toBe(200);
      expect(orders.body.orders).toHaveLength(1);
      expect(orders.body.orders[0]).toMatchObject({ id: orderId, status: "disputed", disputeReason: "Wrong file", priceCents: 125_000 });

      const requests = await staff.get("/api/moderation/requests");
      expect(requests.body.requests).toHaveLength(1);
      expect(requests.body.requests[0]).toMatchObject({ id: requestId, status: "disputed", disputeReason: "No updates", priceCents: 80_000 });
    }
  });

  it("keeps everyone else out", async () => {
    for (const path of ["/api/moderation/orders", "/api/moderation/requests"]) {
      expect((await request(ctx.app).get(path)).status).toBe(401);
      expect((await client.get(path)).status).toBe(403);
      expect((await artist.get(path)).status).toBe(403);
    }
  });

  it("filters by status and validates the query", async () => {
    expect((await mod.get("/api/moderation/orders?status=escrow")).body.orders).toEqual([]);
    expect((await mod.get("/api/moderation/requests?status=accepted")).body.requests).toEqual([]);
    for (const query of ["status=bogus", "limit=0", "limit=101", "offset=-1"]) {
      expect((await mod.get(`/api/moderation/orders?${query}`)).status).toBe(400);
      expect((await mod.get(`/api/moderation/requests?${query}`)).status).toBe(400);
    }
  });

  it("drops a case from the list once it is resolved", async () => {
    await mod.post(`/api/moderation/orders/${orderId}/resolve`).send({ outcome: "refund" });
    await mod.post(`/api/moderation/requests/${requestId}/resolve`).send({ outcome: "release" });
    expect((await mod.get("/api/moderation/orders")).body.orders).toEqual([]);
    expect((await mod.get("/api/moderation/requests")).body.requests).toEqual([]);
    expect((await mod.get("/api/moderation/orders?status=refunded")).body.orders).toHaveLength(1);
    expect((await mod.get("/api/moderation/requests?status=completed")).body.requests).toHaveLength(1);
  });

  it("pages the results", async () => {
    expect((await mod.get("/api/moderation/orders?limit=1&offset=1")).body.orders).toEqual([]);
    expect((await mod.get("/api/moderation/orders?limit=1&offset=0")).body.orders).toHaveLength(1);
  });
});
