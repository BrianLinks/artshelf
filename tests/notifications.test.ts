import { beforeEach, describe, expect, it } from "vitest";
import { releaseDueEscrows } from "../src/orders/service.js";
import { createPublishedListing, fund, makeTestApp, makePng, seedArtist, seedUser, signedInAgent, upload, type TestContext } from "./helpers.js";

type Agent = Awaited<ReturnType<typeof signedInAgent>>;

describe("notification outbox", () => {
  let ctx: TestContext;
  let artist: Agent;
  let buyer: Agent;
  let mod: Agent;
  let listingId: number;

  const kinds = async (agent: Agent): Promise<string[]> =>
    ((await agent.get("/api/notifications?limit=100")).body.notifications as { kind: string }[]).map((n) => n.kind);

  beforeEach(async () => {
    ctx = makeTestApp();
    await seedArtist(ctx, "artist@example.com");
    await seedUser(ctx, "buyer@example.com", "client");
    await seedUser(ctx, "mod@example.com", "moderator");
    artist = await signedInAgent(ctx, "artist@example.com");
    buyer = await signedInAgent(ctx, "buyer@example.com");
    mod = await signedInAgent(ctx, "mod@example.com");
    await fund(buyer, 1_000_000);
    listingId = (await createPublishedListing(artist)).id;
  });

  describe("sales", () => {
    const buy = async () => (await buyer.post("/api/orders").send({ listingId, license: "commercial" })).body.order.id as number;

    it("tells the artist about a sale and the payout", async () => {
      const id = await buy();
      expect(await kinds(artist)).toContain("order_placed");
      await buyer.post(`/api/orders/${id}/confirm`);
      expect(await kinds(artist)).toContain("order_completed");
      const note = (await artist.get("/api/notifications")).body.notifications.find((n: { kind: string }) => n.kind === "order_placed");
      expect(note).toMatchObject({ title: "New sale", ref: { type: "order", id } });
    });

    it("tells the artist about a dispute and both sides about its resolution", async () => {
      const id = await buy();
      await buyer.post(`/api/orders/${id}/dispute`).send({ reason: "Wrong file" });
      expect(await kinds(artist)).toContain("order_disputed");
      await mod.post(`/api/moderation/orders/${id}/resolve`).send({ outcome: "refund" });
      expect(await kinds(artist)).toContain("order_dispute_resolved");
      expect(await kinds(buyer)).toContain("order_dispute_resolved");
    });

    it("tells the buyer about a refund and the artist about an automatic release", async () => {
      const refunded = await buy();
      await artist.post(`/api/orders/${refunded}/refund`);
      expect(await kinds(buyer)).toContain("order_refunded");

      const second = (await createPublishedListing(artist, { color: 12 })).id;
      const placed = await buyer.post("/api/orders").send({ listingId: second, license: "commercial" });
      const before = (await kinds(artist)).filter((k) => k === "order_completed").length;
      releaseDueEscrows(ctx.db, new Date(Date.parse(placed.body.order.holdUntil)));
      expect((await kinds(artist)).filter((k) => k === "order_completed").length).toBe(before + 1);
    });

    it("does not notify the buyer of their own purchase", async () => {
      await buy();
      expect(await kinds(buyer)).toEqual([]);
    });
  });

  describe("commissions", () => {
    let requestId: number;
    const act = (agent: Agent, action: string, body: Record<string, unknown> = {}) =>
      agent.post(`/api/requests/${requestId}/${action}`).send(body);
    const deliverNow = async (color: number) => {
      const uploaded = await upload(artist, { category: "illustration", filename: "w.png", data: await makePng(color, 9, 9) });
      return act(artist, "deliver", { assetId: uploaded.body.asset.id });
    };

    beforeEach(async () => {
      const created = await buyer.post("/api/requests").send({ title: "Poster", description: "A poster", category: "illustration", budgetCents: 100_000 });
      requestId = created.body.request.id;
      await act(artist, "proposals", { priceCents: 80_000, message: "Yes", deliveryDays: 4, maxRevisions: 2 });
    });
    const accept = async () => {
      const proposals = (await buyer.get(`/api/requests/${requestId}/proposals`)).body.proposals;
      return act(buyer, "accept", { proposalId: proposals[0].id });
    };

    it("tells the client about proposals and the artist about being hired", async () => {
      expect(await kinds(buyer)).toContain("proposal_received");
      await accept();
      expect(await kinds(artist)).toContain("proposal_accepted");
    });

    it("keeps both sides informed through delivery, revisions and approval", async () => {
      await accept();
      await act(artist, "start");
      await deliverNow(21);
      expect(await kinds(buyer)).toContain("delivery_ready");
      await act(buyer, "revise", { note: "Bigger title" });
      expect(await kinds(artist)).toContain("revision_requested");
      await deliverNow(22);
      await act(buyer, "approve");
      expect(await kinds(artist)).toContain("request_completed");
    });

    it("tells the other party about a dispute, and both about its resolution", async () => {
      await accept();
      await act(buyer, "dispute", { reason: "No updates" });
      expect(await kinds(artist)).toContain("request_disputed");
      expect(await kinds(buyer)).not.toContain("request_disputed");
      await mod.post(`/api/moderation/requests/${requestId}/resolve`).send({ outcome: "refund" });
      expect(await kinds(artist)).toContain("request_dispute_resolved");
      expect(await kinds(buyer)).toContain("request_dispute_resolved");
    });

    it("tells the client when the artist withdraws", async () => {
      await accept();
      await act(artist, "withdraw");
      expect(await kinds(buyer)).toContain("request_refunded");
    });
  });
});
