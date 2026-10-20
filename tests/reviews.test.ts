import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import {
  completeCommission,
  completeSale,
  createPublishedListing,
  fund,
  makeTestApp,
  seedArtist,
  seedUser,
  signedInAgent,
  type TestContext,
} from "./helpers.js";

type Agent = Awaited<ReturnType<typeof signedInAgent>>;

describe("reviews", () => {
  let ctx: TestContext;
  let artist: Agent;
  let buyer: Agent;
  let other: Agent;
  let mod: Agent;
  let artistId: number;
  let buyerId: number;
  let listingId: number;
  let orderId: number;

  const review = (agent: Agent, body: Record<string, unknown>) => agent.post("/api/reviews").send(body);
  const publicRating = async (query: string) => (await request(ctx.app).get(`/api/reviews?${query}`)).body;

  beforeEach(async () => {
    ctx = makeTestApp();
    artistId = (await seedArtist(ctx, "artist@example.com")).id;
    buyerId = (await seedUser(ctx, "buyer@example.com", "client")).id;
    await seedUser(ctx, "other@example.com", "client");
    await seedUser(ctx, "mod@example.com", "moderator");
    await seedUser(ctx, "admin@example.com", "admin");
    artist = await signedInAgent(ctx, "artist@example.com");
    buyer = await signedInAgent(ctx, "buyer@example.com");
    other = await signedInAgent(ctx, "other@example.com");
    mod = await signedInAgent(ctx, "mod@example.com");
    await fund(buyer, 1_000_000);
    await fund(buyer, 1_000_000);
    listingId = (await createPublishedListing(artist)).id;
    orderId = await completeSale(buyer, listingId);
  });

  describe("who may review", () => {
    it("lets the buyer review a completed order, once", async () => {
      const created = await review(buyer, { orderId, rating: 5, comment: "Lovely work" });
      expect(created.status).toBe(201);
      expect(created.body.review).toMatchObject({
        rating: 5,
        comment: "Lovely work",
        status: "visible",
        edited: false,
        listingId,
        source: { type: "order", id: orderId },
        reviewer: { userId: buyerId },
        artistUserId: artistId,
      });
      const again = await review(buyer, { orderId, rating: 4 });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("already_reviewed");
    });

    it("refuses orders that are not completed", async () => {
      const second = (await createPublishedListing(artist, { color: 11 })).id;
      const placed = await buyer.post("/api/orders").send({ listingId: second, license: "commercial" });
      const response = await review(buyer, { orderId: placed.body.order.id, rating: 5 });
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("not_reviewable");
      await artist.post(`/api/orders/${placed.body.order.id}/refund`);
      expect((await review(buyer, { orderId: placed.body.order.id, rating: 5 })).status).toBe(409);
    });

    it("refuses people who were not part of the purchase, and unknown ids", async () => {
      expect((await review(other, { orderId, rating: 5 })).status).toBe(404);
      expect((await review(artist, { orderId, rating: 5 })).status).toBe(404);
      expect((await review(buyer, { orderId: 9999, rating: 5 })).status).toBe(404);
      expect((await review(buyer, { requestId: 9999, rating: 5 })).status).toBe(404);
      expect((await request(ctx.app).post("/api/reviews").send({ orderId, rating: 5 })).status).toBe(401);
    });

    it("validates the body", async () => {
      for (const body of [
        { orderId },
        { orderId, rating: 0 },
        { orderId, rating: 6 },
        { orderId, rating: 3.5 },
        { orderId, rating: "5" },
        { orderId, rating: 5, comment: "x".repeat(2001) },
        { rating: 5 },
        { orderId, requestId: 1, rating: 5 },
      ]) {
        expect((await review(buyer, body)).status).toBe(400);
      }
    });

    it("lets a client review a completed commission, once", async () => {
      const requestId = await completeCommission(buyer, artist);
      const created = await review(buyer, { requestId, rating: 4, comment: "Great" });
      expect(created.status).toBe(201);
      expect(created.body.review.source).toEqual({ type: "request", id: requestId });
      expect(created.body.review.listingId).toBeNull();
      expect((await review(buyer, { requestId, rating: 3 })).body.error.code).toBe("already_reviewed");
      expect((await review(other, { requestId, rating: 3 })).status).toBe(404);
    });

    it("refuses a commission that is still in progress", async () => {
      const created = await buyer.post("/api/requests").send({ title: "T", description: "D", category: "illustration", budgetCents: 5_000 });
      expect((await review(buyer, { requestId: created.body.request.id, rating: 5 })).status).toBe(409);
    });

    it("lists what is still waiting for a review", async () => {
      expect((await buyer.get("/api/reviews/reviewable")).body.orders).toEqual([expect.objectContaining({ orderId })]);
      await review(buyer, { orderId, rating: 5 });
      expect((await buyer.get("/api/reviews/reviewable")).body).toEqual({ orders: [], requests: [] });
      expect((await request(ctx.app).get("/api/reviews/reviewable")).status).toBe(401);
    });
  });

  describe("ratings", () => {
    it("starts empty, then follows reviews, edits and moderation", async () => {
      const empty = (await request(ctx.app).get(`/api/listings/${listingId}`)).body.listing.rating;
      expect(empty).toMatchObject({ count: 0, average: null, averageTenths: null });

      const created = await review(buyer, { orderId, rating: 5 });
      const reviewId = created.body.review.id;
      expect((await request(ctx.app).get(`/api/listings/${listingId}`)).body.listing.rating).toMatchObject({ count: 1, average: 5, averageTenths: 50 });

      await buyer.put(`/api/reviews/${reviewId}`).send({ rating: 2, comment: "Changed my mind" });
      expect((await request(ctx.app).get(`/api/listings/${listingId}`)).body.listing.rating).toMatchObject({ count: 1, average: 2 });

      await mod.post(`/api/moderation/reviews/${reviewId}/hide`).send({ note: "Spam" });
      expect((await request(ctx.app).get(`/api/listings/${listingId}`)).body.listing.rating).toMatchObject({ count: 0, average: null });
    });

    it("combines sales and commissions on the artist's rating", async () => {
      const requestId = await completeCommission(buyer, artist);
      await review(buyer, { orderId, rating: 5 });
      await review(buyer, { requestId, rating: 4 });
      const body = await publicRating(`artist=${artistId}`);
      expect(body.total).toBe(2);
      expect(body.rating).toMatchObject({ count: 2, average: 4.5, averageTenths: 45, distribution: { 4: 1, 5: 1 } });
      expect((await request(ctx.app).get(`/api/reviews/artist/${artistId}/rating`)).body.rating.average).toBe(4.5);

      const forListing = await publicRating(`listing=${listingId}`);
      expect(forListing.total).toBe(1);
      expect(forListing.rating).toBeNull();
      expect((await request(ctx.app).get(`/api/listings/${listingId}`)).body.listing.rating.count).toBe(1);
    });

    it("reports an unreviewed artist as having no rating", async () => {
      const body = (await request(ctx.app).get(`/api/reviews/artist/${artistId}/rating`)).body;
      expect(body.rating).toMatchObject({ count: 0, average: null });
    });

    it("needs an artist or a listing to list reviews, and validates paging", async () => {
      expect((await request(ctx.app).get("/api/reviews")).status).toBe(400);
      expect((await request(ctx.app).get(`/api/reviews?artist=${artistId}&limit=0`)).status).toBe(400);
      await review(buyer, { orderId, rating: 5 });
      const page = await request(ctx.app).get(`/api/reviews?artist=${artistId}&limit=1&offset=1`);
      expect(page.body).toMatchObject({ reviews: [], total: 1, limit: 1, offset: 1 });
    });
  });

  describe("editing and visibility", () => {
    let reviewId: number;
    beforeEach(async () => {
      reviewId = (await review(buyer, { orderId, rating: 5, comment: "Nice" })).body.review.id;
    });

    it("lets the reviewer edit and marks the review as edited", async () => {
      const edited = await buyer.put(`/api/reviews/${reviewId}`).send({ rating: 3, comment: "On reflection, fine" });
      expect(edited.body.review).toMatchObject({ rating: 3, comment: "On reflection, fine", edited: true });
      expect(edited.body.review.editedAt).toBeTruthy();
      expect((await other.put(`/api/reviews/${reviewId}`).send({ rating: 1 })).status).toBe(404);
      expect((await artist.put(`/api/reviews/${reviewId}`).send({ rating: 1 })).status).toBe(404);
      expect((await buyer.put(`/api/reviews/${reviewId}`).send({ rating: 9 })).status).toBe(400);
    });

    it("keeps moderation details away from the public", async () => {
      const publicView = (await request(ctx.app).get(`/api/reviews/${reviewId}`)).body.review;
      expect(publicView).toMatchObject({ rating: 5, reviewer: { userId: buyerId } });
      expect(publicView).not.toHaveProperty("status");
      expect(publicView).not.toHaveProperty("moderationNote");
      const own = (await buyer.get(`/api/reviews/${reviewId}`)).body.review;
      expect(own.status).toBe("visible");
      const list = (await publicRating(`artist=${artistId}`)).reviews[0];
      expect(list).not.toHaveProperty("status");
    });
  });

  describe("reports and moderation", () => {
    let reviewId: number;
    beforeEach(async () => {
      reviewId = (await review(buyer, { orderId, rating: 1, comment: "Terrible" })).body.review.id;
    });

    const flag = (agent: Agent, body: Record<string, unknown> = { reason: "abusive", note: "Rude" }) =>
      agent.post(`/api/reviews/${reviewId}/flag`).send(body);

    it("lets others report a review, once, but not the author", async () => {
      expect((await flag(other)).status).toBe(201);
      const again = await flag(other);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("already_flagged");
      const own = await flag(buyer);
      expect(own.status).toBe(409);
      expect(own.body.error.code).toBe("cannot_flag_own_review");
      expect((await flag(artist)).status).toBe(201);
      expect((await flag(other, { reason: "boring" })).status).toBe(400);
      expect((await request(ctx.app).post(`/api/reviews/${reviewId}/flag`).send({ reason: "spam" })).status).toBe(401);
    });

    it("keeps a reported review visible and counted until staff decide", async () => {
      await flag(other);
      expect((await publicRating(`artist=${artistId}`)).total).toBe(1);
      expect((await publicRating(`artist=${artistId}`)).rating.count).toBe(1);
      expect((await buyer.get(`/api/reviews/${reviewId}`)).body.review.status).toBe("flagged");
    });

    it("shows staff the queue with the reports", async () => {
      await flag(other, { reason: "spam", note: "Looks fake" });
      expect((await other.get("/api/moderation/reviews")).status).toBe(403);
      const queue = (await mod.get("/api/moderation/reviews")).body.reviews;
      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({ id: reviewId, status: "flagged", openFlags: 1 });
      expect(queue[0].flags[0]).toMatchObject({ reason: "spam", note: "Looks fake", resolved: false });
      expect((await mod.get("/api/moderation/reviews?status=bogus")).status).toBe(400);
    });

    it("hides a review, removes it from ratings, tells the reviewer and audits it", async () => {
      await flag(other);
      expect((await other.post(`/api/moderation/reviews/${reviewId}/hide`).send({})).status).toBe(403);
      const hidden = await mod.post(`/api/moderation/reviews/${reviewId}/hide`).send({ note: "Abusive language" });
      expect(hidden.body.review).toMatchObject({ status: "hidden", moderationNote: "Abusive language", openFlags: 0 });

      const body = await publicRating(`artist=${artistId}`);
      expect(body.total).toBe(0);
      expect(body.rating).toMatchObject({ count: 0, average: null });
      expect((await request(ctx.app).get(`/api/reviews/${reviewId}`)).status).toBe(404);
      expect((await mod.get(`/api/reviews/${reviewId}`)).status).toBe(200);
      expect((await buyer.get(`/api/reviews/${reviewId}`)).status).toBe(200);
      expect((await buyer.put(`/api/reviews/${reviewId}`).send({ rating: 5 })).status).toBe(409);
      expect((await flag(artist)).status).toBe(404);

      const notices = (await buyer.get("/api/notifications")).body.notifications as { kind: string; body: string }[];
      expect(notices.find((n) => n.kind === "review_hidden")?.body).toMatch(/Abusive language/);
      const audit = ctx.db.prepare("SELECT action FROM audit_log WHERE action = 'review.hidden'").get();
      expect(audit).toEqual({ action: "review.hidden" });
    });

    it("lets staff dismiss unfounded reports, and restore a hidden review", async () => {
      await flag(other);
      const dismissed = await mod.post(`/api/moderation/reviews/${reviewId}/dismiss`).send({});
      expect(dismissed.body.review).toMatchObject({ status: "visible", openFlags: 0 });
      expect((await mod.post(`/api/moderation/reviews/${reviewId}/dismiss`).send({})).status).toBe(409);

      await mod.post(`/api/moderation/reviews/${reviewId}/hide`).send({});
      expect((await mod.post(`/api/moderation/reviews/${reviewId}/hide`).send({})).status).toBe(409);
      const restored = await mod.post(`/api/moderation/reviews/${reviewId}/restore`).send({});
      expect(restored.body.review.status).toBe("visible");
      expect((await mod.post(`/api/moderation/reviews/${reviewId}/restore`).send({})).status).toBe(409);
      expect((await publicRating(`artist=${artistId}`)).total).toBe(1);
      expect((await mod.post("/api/moderation/reviews/999/hide").send({})).status).toBe(404);
    });

    it("lets a dismissed review be reported again by someone new", async () => {
      await flag(other);
      await mod.post(`/api/moderation/reviews/${reviewId}/dismiss`).send({});
      expect((await flag(other)).status).toBe(409);
      expect((await flag(artist)).status).toBe(201);
      expect((await buyer.get(`/api/reviews/${reviewId}`)).body.review.status).toBe("flagged");
    });
  });

  describe("notifications", () => {
    it("tells the artist about a new review, and lets them read it", async () => {
      await review(buyer, { orderId, rating: 5 });
      const inbox = (await artist.get("/api/notifications")).body;
      const kinds = inbox.notifications.map((n: { kind: string }) => n.kind);
      expect(kinds).toContain("review_received");
      expect(inbox.unreadCount).toBe(inbox.total);

      const item = inbox.notifications.find((n: { kind: string }) => n.kind === "review_received");
      expect(item).toMatchObject({ read: false, ref: { type: "review" } });
      expect((await artist.post(`/api/notifications/${item.id}/read`)).status).toBe(204);
      const after = (await artist.get("/api/notifications?unread=true")).body;
      expect(after.notifications.some((n: { id: number }) => n.id === item.id)).toBe(false);
      expect(after.unreadCount).toBe(inbox.unreadCount - 1);
    });

    it("keeps notifications private", async () => {
      await review(buyer, { orderId, rating: 5 });
      const item = (await artist.get("/api/notifications")).body.notifications[0];
      expect((await other.post(`/api/notifications/${item.id}/read`)).status).toBe(404);
      expect((await request(ctx.app).get("/api/notifications")).status).toBe(401);
      expect((await other.get("/api/notifications")).body.notifications.every((n: { id: number }) => n.id !== item.id)).toBe(true);
    });

    it("marks everything read at once", async () => {
      const response = await artist.post("/api/notifications/read-all");
      expect(response.body.marked).toBeGreaterThan(0);
      expect((await artist.get("/api/notifications")).body.unreadCount).toBe(0);
      expect((await artist.post("/api/notifications/read-all")).body.marked).toBe(0);
      expect((await artist.get("/api/notifications?limit=0")).status).toBe(400);
    });
  });
});
