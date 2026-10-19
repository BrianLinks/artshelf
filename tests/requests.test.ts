import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { setTier } from "../src/artists/profiles.js";
import { balanceOf, requestEscrowAccountId, systemAccountId, verifyLedger, walletAccountId } from "../src/ledger/ledger.js";
import { autoApproveDue } from "../src/requests/service.js";
import {
  fund,
  makePng,
  makeTestApp,
  seedArtist,
  seedUser,
  signedInAgent,
  upload,
  type TestContext,
} from "./helpers.js";

type Agent = Awaited<ReturnType<typeof signedInAgent>>;
const DAY = 86_400_000;

describe("request board", () => {
  let ctx: TestContext;
  let client: Agent;
  let client2: Agent;
  let artistA: Agent;
  let artistB: Agent;
  let pending: Agent;
  let mod: Agent;
  let admin: Agent;
  let clientId: number;
  let artistAId: number;
  let artistBId: number;

  const wallet = (userId: number) => balanceOf(ctx.db, walletAccountId(ctx.db, userId));
  const escrow = (requestId: number) => balanceOf(ctx.db, requestEscrowAccountId(ctx.db, requestId));
  const revenue = () => balanceOf(ctx.db, systemAccountId(ctx.db, "platform_revenue"));
  const ledgerClean = () => expect(verifyLedger(ctx.db)).toMatchObject({ ok: true, problems: [] });

  const newRequest = async (agent: Agent = client, overrides: Record<string, unknown> = {}): Promise<number> => {
    const response = await agent.post("/api/requests").send({
      title: "Portrait of my cat",
      description: "A watercolor portrait, soft colors.",
      category: "illustration",
      budgetCents: 100_000,
      ...overrides,
    });
    expect(response.status).toBe(201);
    return response.body.request.id;
  };
  const bid = (agent: Agent, requestId: number, overrides: Record<string, unknown> = {}) =>
    agent.post(`/api/requests/${requestId}/proposals`).send({
      priceCents: 80_000,
      message: "I can do this.",
      deliveryDays: 5,
      maxRevisions: 2,
      ...overrides,
    });
  const proposalIdOf = async (requestId: number, artistId: number): Promise<number> => {
    const list = (await client.get(`/api/requests/${requestId}/proposals`)).body.proposals as { id: number; artist: { userId: number } }[];
    return list.find((proposal) => proposal.artist.userId === artistId)!.id;
  };
  const accept = async (requestId: number, artistId: number, agent: Agent = client) =>
    agent.post(`/api/requests/${requestId}/accept`).send({ proposalId: await proposalIdOf(requestId, artistId) });
  const newAsset = async (agent: Agent, color: number, category = "illustration"): Promise<number> => {
    const response = await upload(agent, { category, filename: `work-${color}.png`, data: await makePng(color, 80, 80) });
    expect(response.status).toBe(201);
    return response.body.asset.id;
  };
  /** Request created, bid placed by artist A, accepted by the client. Returns the request id. */
  const funded = async (bidOverrides: Record<string, unknown> = {}): Promise<number> => {
    const id = await newRequest();
    expect((await bid(artistA, id, bidOverrides)).status).toBe(201);
    expect((await accept(id, artistAId)).status).toBe(200);
    return id;
  };
  const act = (agent: Agent, id: number, action: string, body: Record<string, unknown> = {}) =>
    agent.post(`/api/requests/${id}/${action}`).send(body);
  const deliverWork = async (id: number, color = 30) =>
    act(artistA, id, "deliver", { assetId: await newAsset(artistA, color), note: "Here you go" });

  beforeEach(async () => {
    ctx = makeTestApp();
    clientId = (await seedUser(ctx, "client@example.com", "client")).id;
    await seedUser(ctx, "client2@example.com", "client");
    artistAId = (await seedArtist(ctx, "artista@example.com")).id;
    artistBId = (await seedArtist(ctx, "artistb@example.com")).id;
    await seedArtist(ctx, "pending@example.com", { approved: false });
    await seedUser(ctx, "mod@example.com", "moderator");
    await seedUser(ctx, "admin@example.com", "admin");
    client = await signedInAgent(ctx, "client@example.com");
    client2 = await signedInAgent(ctx, "client2@example.com");
    artistA = await signedInAgent(ctx, "artista@example.com");
    artistB = await signedInAgent(ctx, "artistb@example.com");
    pending = await signedInAgent(ctx, "pending@example.com");
    mod = await signedInAgent(ctx, "mod@example.com");
    admin = await signedInAgent(ctx, "admin@example.com");
    await fund(client, 1_000_000);
  });

  describe("posting and browsing", () => {
    it.each([
      ["a budget below $1.00", { budgetCents: 99 }],
      ["a budget above $100,000.00", { budgetCents: 10_000_001 }],
      ["a fractional budget", { budgetCents: 500.5 }],
      ["an empty title", { title: "  " }],
      ["an empty description", { description: "" }],
      ["an unknown category", { category: "pottery" }],
    ])("rejects %s", async (_label, overrides) => {
      const response = await client.post("/api/requests").send({
        title: "T",
        description: "D",
        category: "illustration",
        budgetCents: 5_000,
        ...overrides,
      });
      expect(response.status).toBe(400);
    });

    it("requires a client or artist account", async () => {
      const body = { title: "T", description: "D", category: "illustration", budgetCents: 5_000 };
      expect((await request(ctx.app).post("/api/requests").send(body)).status).toBe(401);
      expect((await mod.post("/api/requests").send(body)).status).toBe(403);
    });

    it("shows open requests publicly without exposing money fields", async () => {
      const id = await newRequest();
      const detail = await request(ctx.app).get(`/api/requests/${id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.request).toMatchObject({
        status: "open",
        category: { slug: "illustration" },
        client: { userId: clientId },
        artist: null,
        priceCents: null,
        proposalCount: 0,
      });
    });

    it("filters, sorts and paginates the board", async () => {
      await newRequest(client, { title: "Cheap", budgetCents: 10_000 });
      await newRequest(client, { title: "Middle", budgetCents: 50_000 });
      await newRequest(client2, { title: "Sound job", budgetCents: 90_000, category: "sound" });
      const titles = async (query: string) =>
        ((await request(ctx.app).get(`/api/requests${query}`)).body.requests as { title: string }[]).map((r) => r.title);

      expect(await titles("")).toEqual(["Sound job", "Middle", "Cheap"]);
      expect(await titles("?sort=budget_asc")).toEqual(["Cheap", "Middle", "Sound job"]);
      expect(await titles("?sort=budget_desc")).toEqual(["Sound job", "Middle", "Cheap"]);
      expect(await titles("?category=sound")).toEqual(["Sound job"]);
      expect(await titles("?minBudgetCents=20000&maxBudgetCents=60000")).toEqual(["Middle"]);
      const page = await request(ctx.app).get("/api/requests?sort=budget_asc&limit=1&offset=1");
      expect(page.body.total).toBe(3);
      expect(page.body.requests.map((r: { title: string }) => r.title)).toEqual(["Middle"]);
      for (const query of ["?limit=0", "?sort=random", "?status=completed", "?minBudgetCents=-1"]) {
        expect((await request(ctx.app).get(`/api/requests${query}`)).status).toBe(400);
      }
    });

    it("hides cancelled requests from the board but not from their owner", async () => {
      const id = await newRequest();
      expect((await act(client2, id, "cancel")).status).toBe(404);
      expect((await act(client, id, "cancel")).body.request.status).toBe("cancelled");
      expect((await request(ctx.app).get("/api/requests")).body.total).toBe(0);
      expect((await request(ctx.app).get(`/api/requests/${id}`)).status).toBe(404);
      expect((await client.get(`/api/requests/${id}`)).status).toBe(200);
      expect((await client.get("/api/requests/mine")).body.requests).toHaveLength(1);
    });
  });

  describe("proposals", () => {
    it("moves an open request to proposed on the first bid", async () => {
      const id = await newRequest();
      const response = await bid(artistA, id);
      expect(response.status).toBe(201);
      expect(response.body.proposal).toMatchObject({ status: "pending", priceCents: 80_000, deliveryDays: 5, maxRevisions: 2 });
      const detail = (await request(ctx.app).get(`/api/requests/${id}`)).body.request;
      expect(detail).toMatchObject({ status: "proposed", proposalCount: 1 });
    });

    it("applies the bidding rules", async () => {
      const id = await newRequest();
      const unapproved = await bid(pending, id);
      expect(unapproved.status).toBe(409);
      expect(unapproved.body.error.code).toBe("profile_not_approved");
      expect((await bid(client2, id)).status).toBe(403);
      expect((await request(ctx.app).post(`/api/requests/${id}/proposals`).send({})).status).toBe(401);
      expect((await bid(artistA, id, { priceCents: 100_001 })).body.error.code).toBe("price_exceeds_budget");

      const own = await newRequest(artistA);
      expect((await bid(artistA, own)).body.error.code).toBe("cannot_propose_own_request");

      expect((await bid(artistA, id)).status).toBe(201);
      const again = await bid(artistA, id);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("already_proposed");
    });

    it.each([
      ["a price below $1.00", { priceCents: 99 }],
      ["zero delivery days", { deliveryDays: 0 }],
      ["a year-plus delivery", { deliveryDays: 366 }],
      ["too many revisions", { maxRevisions: 6 }],
      ["an empty message", { message: " " }],
    ])("rejects %s", async (_label, overrides) => {
      const id = await newRequest();
      expect((await bid(artistA, id, overrides)).status).toBe(400);
    });

    it("shows all proposals to the client, only your own to an artist, and nothing to others", async () => {
      const id = await newRequest();
      await bid(artistA, id);
      await bid(artistB, id, { priceCents: 70_000 });
      expect((await client.get(`/api/requests/${id}/proposals`)).body.proposals).toHaveLength(2);
      expect((await artistA.get(`/api/requests/${id}/proposals`)).body.proposals).toHaveLength(1);
      expect((await pending.get(`/api/requests/${id}/proposals`)).body.proposals).toHaveLength(0);
      expect((await mod.get(`/api/requests/${id}/proposals`)).body.proposals).toHaveLength(2);
      expect((await client2.get(`/api/requests/${id}/proposals`)).status).toBe(404);
      expect((await request(ctx.app).get(`/api/requests/${id}/proposals`)).status).toBe(401);
    });

    it("lets an artist edit, withdraw and revive a proposal, reopening the request when none are pending", async () => {
      const id = await newRequest();
      await bid(artistA, id);
      await bid(artistB, id);
      const edited = await artistA.put(`/api/requests/${id}/proposals`).send({ priceCents: 60_000, message: "Lower!", deliveryDays: 3, maxRevisions: 1 });
      expect(edited.body.proposal).toMatchObject({ priceCents: 60_000, deliveryDays: 3, status: "pending" });

      expect((await artistA.delete(`/api/requests/${id}/proposals`)).body.proposal.status).toBe("withdrawn");
      expect((await request(ctx.app).get(`/api/requests/${id}`)).body.request.status).toBe("proposed");
      await artistB.delete(`/api/requests/${id}/proposals`);
      expect((await request(ctx.app).get(`/api/requests/${id}`)).body.request.status).toBe("open");

      const revived = await artistA.put(`/api/requests/${id}/proposals`).send({ priceCents: 65_000, message: "Back", deliveryDays: 4, maxRevisions: 2 });
      expect(revived.body.proposal.status).toBe("pending");
      expect((await request(ctx.app).get(`/api/requests/${id}`)).body.request.status).toBe("proposed");
      expect((await artistB.put(`/api/requests/${id}/proposals`).send({ priceCents: 65_000, message: "x", deliveryDays: 4, maxRevisions: 2 })).status).toBe(200);
      expect((await pending.put(`/api/requests/${id}/proposals`).send({ priceCents: 65_000, message: "x", deliveryDays: 4, maxRevisions: 2 })).status).toBe(404);
    });
  });

  describe("accepting a proposal", () => {
    it("holds the price in escrow, snapshots the commission and rejects the other bids", async () => {
      const id = await newRequest();
      await bid(artistA, id);
      await bid(artistB, id, { priceCents: 70_000 });
      const response = await accept(id, artistAId);
      expect(response.status).toBe(200);
      expect(response.body.request).toMatchObject({
        status: "accepted",
        priceCents: 80_000,
        commissionBps: 1_500,
        commissionCents: 12_000,
        payoutCents: 68_000,
        maxRevisions: 2,
        revisionsUsed: 0,
        artist: { userId: artistAId },
      });
      expect(Math.abs(Date.parse(response.body.request.dueAt) - (Date.now() + 5 * DAY))).toBeLessThan(60_000);
      expect(wallet(clientId)).toBe(1_000_000 - 80_000);
      expect(escrow(id)).toBe(80_000);
      ledgerClean();

      const proposals = (await client.get(`/api/requests/${id}/proposals`)).body.proposals as { artist: { userId: number }; status: string }[];
      expect(proposals.find((p) => p.artist.userId === artistAId)?.status).toBe("accepted");
      expect(proposals.find((p) => p.artist.userId === artistBId)?.status).toBe("rejected");
    });

    it("charges premium artists a lower commission", async () => {
      setTier(ctx.db, artistAId, "premium");
      const id = await funded();
      const detail = (await client.get(`/api/requests/${id}`)).body.request;
      expect(detail).toMatchObject({ commissionBps: 1_000, commissionCents: 8_000, payoutCents: 72_000 });
    });

    it("refuses when the wallet is short and changes nothing", async () => {
      const id = await newRequest(client2);
      await bid(artistA, id);
      const proposalId = (await client2.get(`/api/requests/${id}/proposals`)).body.proposals[0].id;
      const response = await client2.post(`/api/requests/${id}/accept`).send({ proposalId });
      expect(response.status).toBe(402);
      expect(response.body.error.code).toBe("insufficient_funds");
      expect((await request(ctx.app).get(`/api/requests/${id}`)).body.request.status).toBe("proposed");
      expect(escrow(id)).toBe(0);
      ledgerClean();
    });

    it("only lets the owner accept, once, and only a pending proposal of that request", async () => {
      const id = await newRequest();
      await bid(artistA, id);
      const proposalId = await proposalIdOf(id, artistAId);
      expect((await client2.post(`/api/requests/${id}/accept`).send({ proposalId })).status).toBe(404);
      expect((await artistA.post(`/api/requests/${id}/accept`).send({ proposalId })).status).toBe(404);
      const other = await newRequest();
      await bid(artistB, other);
      expect((await client.post(`/api/requests/${other}/accept`).send({ proposalId })).status).toBe(404);
      expect((await accept(id, artistAId)).status).toBe(200);
      const twice = await client.post(`/api/requests/${id}/accept`).send({ proposalId });
      expect(twice.status).toBe(409);
      expect(twice.body.error.code).toBe("invalid_request_state");
      expect(wallet(clientId)).toBe(1_000_000 - 80_000);
    });
  });

  describe("doing the work", () => {
    it("runs the full lifecycle and pays the artist and the platform", async () => {
      const id = await funded();
      expect((await act(artistA, id, "start")).body.request.status).toBe("in_progress");
      expect((await deliverWork(id, 31)).body.request.status).toBe("delivered");
      const revised = await act(client, id, "revise", { note: "Make the eyes bluer" });
      expect(revised.body.request).toMatchObject({ status: "revised", revisionsUsed: 1, autoApproveAt: null });
      expect((await deliverWork(id, 32)).body.request.status).toBe("delivered");
      const approved = await act(client, id, "approve");
      expect(approved.body.request.status).toBe("completed");
      expect(approved.body.request.completedAt).toBeTruthy();

      expect(escrow(id)).toBe(0);
      expect(wallet(artistAId)).toBe(68_000);
      expect(revenue()).toBe(12_000);
      ledgerClean();

      const events = (await client.get(`/api/requests/${id}/events`)).body.events as { kind: string; fromStatus: string | null; toStatus: string }[];
      expect(events.map((event) => event.kind)).toEqual([
        "created", "proposed", "accepted", "started", "delivered", "revision_requested", "delivered", "approved",
      ]);
      expect(events[0]).toMatchObject({ fromStatus: null, toStatus: "open" });
      expect(events.at(-1)).toMatchObject({ fromStatus: "delivered", toStatus: "completed" });
    });

    it("keeps the history append-only", async () => {
      await funded();
      expect(() => ctx.db.prepare("UPDATE request_events SET note = 'x'").run()).toThrow(/append-only/);
      expect(() => ctx.db.prepare("DELETE FROM request_events").run()).toThrow(/append-only/);
    });

    it("enforces the order of steps and who may take them", async () => {
      const id = await funded();
      const early = await deliverWork(id);
      expect(early.status).toBe(409);
      expect(early.body.error.code).toBe("invalid_request_state");
      expect((await act(client, id, "start")).status).toBe(403);
      expect((await act(artistB, id, "start")).status).toBe(404);
      await act(artistA, id, "start");
      expect((await act(artistA, id, "start")).status).toBe(409);
      expect((await act(client, id, "approve")).status).toBe(409);
      expect((await act(client, id, "revise", { note: "x" })).status).toBe(409);
      await deliverWork(id);
      expect((await act(artistA, id, "approve")).status).toBe(404);
      expect((await act(client2, id, "approve")).status).toBe(404);
      expect((await act(client, id, "revise", {})).status).toBe(400);
    });

    it("accepts only the artist's own, unused uploads from the request's category", async () => {
      const id = await funded();
      await act(artistA, id, "start");
      const theirs = await newAsset(artistB, 40);
      expect((await act(artistA, id, "deliver", { assetId: theirs })).body.error.code).toBe("invalid_asset");
      const wrongCategory = await newAsset(artistA, 41, "design");
      expect((await act(artistA, id, "deliver", { assetId: wrongCategory })).body.error.code).toBe("invalid_asset");
      expect((await act(artistA, id, "deliver", { assetId: 9999 })).body.error.code).toBe("invalid_asset");

      const listed = await newAsset(artistA, 42);
      await artistA.post("/api/listings").send({ assetId: listed, title: "For sale", basePriceCents: 5_000, licenses: ["commercial"] });
      const inUse = await act(artistA, id, "deliver", { assetId: listed });
      expect(inUse.status).toBe(409);
      expect(inUse.body.error.code).toBe("asset_in_use");
    });

    it("limits revisions to what the proposal promised", async () => {
      const id = await funded({ maxRevisions: 1 });
      await act(artistA, id, "start");
      await deliverWork(id, 50);
      expect((await act(client, id, "revise", { note: "First" })).status).toBe(200);
      await deliverWork(id, 51);
      const second = await act(client, id, "revise", { note: "Second" });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe("revision_limit_reached");

      const none = await funded({ maxRevisions: 0 });
      await act(artistA, none, "start");
      await deliverWork(none, 52);
      expect((await act(client, none, "revise", { note: "Any" })).body.error.code).toBe("revision_limit_reached");
    });

    it("approves automatically when the client stays silent, but not before", async () => {
      const id = await funded();
      await act(artistA, id, "start");
      const delivered = (await deliverWork(id)).body.request;
      expect(Date.parse(delivered.autoApproveAt) - Date.parse(delivered.deliveredAt)).toBe(7 * DAY);
      const due = new Date(Date.parse(delivered.autoApproveAt));
      expect(autoApproveDue(ctx.db, new Date(due.getTime() - 1))).toBe(0);
      expect(autoApproveDue(ctx.db, due)).toBe(1);
      expect(autoApproveDue(ctx.db, due)).toBe(0);
      expect((await client.get(`/api/requests/${id}`)).body.request.status).toBe("completed");
      expect(wallet(artistAId)).toBe(68_000);
      ledgerClean();
    });

    it("stops the auto-approval clock during revisions and disputes", async () => {
      const revising = await funded();
      await act(artistA, revising, "start");
      await deliverWork(revising, 60);
      await act(client, revising, "revise", { note: "Change it" });
      const disputed = await funded();
      await act(artistA, disputed, "start");
      await deliverWork(disputed, 61);
      await act(client, disputed, "dispute", { reason: "Wrong style" });
      expect(autoApproveDue(ctx.db, new Date(Date.now() + 60 * DAY))).toBe(0);
    });

    it("lets the parties download the latest delivery, and staff only during a dispute", async () => {
      const id = await funded();
      await act(artistA, id, "start");
      const first = await makePng(70, 80, 80);
      const second = await makePng(71, 80, 80);
      const send = async (png: Buffer) => {
        const uploaded = await upload(artistA, { category: "illustration", filename: "w.png", data: png });
        return act(artistA, id, "deliver", { assetId: uploaded.body.asset.id });
      };
      await send(first);
      await act(client, id, "revise", { note: "Again" });
      await send(second);

      const download = await client.get(`/api/requests/${id}/delivery`).buffer(true).parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
      expect(download.status).toBe(200);
      expect(download.headers["x-delivery-version"]).toBe("2");
      expect(Buffer.from(download.body).equals(second)).toBe(true);
      expect((await artistA.get(`/api/requests/${id}/delivery`)).status).toBe(200);
      expect((await client2.get(`/api/requests/${id}/delivery`)).status).toBe(404);
      expect((await mod.get(`/api/requests/${id}/delivery`)).status).toBe(404);
      await act(client, id, "dispute", { reason: "Not what I asked" });
      expect((await mod.get(`/api/requests/${id}/delivery`)).status).toBe(200);
      expect((await admin.get(`/api/requests/${id}/delivery`)).status).toBe(200);
    });

    it("keeps delivered files from being deleted", async () => {
      const id = await funded();
      await act(artistA, id, "start");
      const assetId = await newAsset(artistA, 80);
      await act(artistA, id, "deliver", { assetId });
      const blocked = await artistA.delete(`/api/assets/${assetId}`);
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe("asset_in_use");
    });
  });

  describe("disputes, withdrawals and cancellation", () => {
    it("freezes a disputed request until staff resolve it, then releases to the artist", async () => {
      const id = await funded();
      await act(artistA, id, "start");
      expect((await act(client2, id, "dispute", { reason: "x" })).status).toBe(404);
      expect((await act(client, id, "dispute", { reason: "" })).status).toBe(400);
      const disputed = await act(client, id, "dispute", { reason: "Artist went quiet" });
      expect(disputed.body.request).toMatchObject({ status: "disputed", disputeReason: "Artist went quiet" });

      expect((await act(artistA, id, "withdraw")).status).toBe(409);
      expect((await act(client, id, "approve")).status).toBe(409);
      expect((await act(artistA, id, "dispute", { reason: "again" })).status).toBe(409);
      expect((await act(client, id, "resolve", {})).status).toBe(404);
      expect((await client.post(`/api/moderation/requests/${id}/resolve`).send({ outcome: "release" })).status).toBe(403);
      expect((await mod.post(`/api/moderation/requests/${id}/resolve`).send({ outcome: "keep" })).status).toBe(400);

      const resolved = await mod.post(`/api/moderation/requests/${id}/resolve`).send({ outcome: "release", note: "Work shown" });
      expect(resolved.body.request).toMatchObject({ status: "completed", resolutionNote: "Work shown" });
      expect(wallet(artistAId)).toBe(68_000);
      expect(revenue()).toBe(12_000);
      expect((await mod.post(`/api/moderation/requests/${id}/resolve`).send({ outcome: "refund" })).status).toBe(409);
      ledgerClean();
    });

    it("lets staff refund a disputed request to the client, and the artist can dispute too", async () => {
      const id = await funded();
      await act(artistA, id, "start");
      await deliverWork(id);
      expect((await act(artistA, id, "dispute", { reason: "Client unreachable" })).body.request.status).toBe("disputed");
      const refunded = await admin.post(`/api/moderation/requests/${id}/resolve`).send({ outcome: "refund" });
      expect(refunded.body.request.status).toBe("refunded");
      expect(wallet(clientId)).toBe(1_000_000);
      expect(revenue()).toBe(0);
      expect(escrow(id)).toBe(0);
      expect((await client.get(`/api/requests/${id}/delivery`)).status).toBe(409);
      ledgerClean();
    });

    it("only resolves requests that are actually disputed", async () => {
      const id = await funded();
      const response = await mod.post(`/api/moderation/requests/${id}/resolve`).send({ outcome: "release" });
      expect(response.status).toBe(409);
      expect(escrow(id)).toBe(80_000);
      expect((await mod.post("/api/moderation/requests/999/resolve").send({ outcome: "release" })).status).toBe(404);
    });

    it("refunds the client when the artist withdraws before delivery", async () => {
      const id = await funded();
      await act(artistA, id, "start");
      expect((await act(artistB, id, "withdraw")).status).toBe(404);
      const withdrawn = await act(artistA, id, "withdraw");
      expect(withdrawn.body.request.status).toBe("refunded");
      expect(wallet(clientId)).toBe(1_000_000);
      expect(escrow(id)).toBe(0);
      ledgerClean();

      const delivered = await funded();
      await act(artistA, delivered, "start");
      await deliverWork(delivered, 90);
      expect((await act(artistA, delivered, "withdraw")).status).toBe(409);
    });

    it("lets the client cancel only before accepting, rejecting pending bids", async () => {
      const id = await newRequest();
      await bid(artistA, id);
      expect((await act(client, id, "cancel")).body.request.status).toBe("cancelled");
      const proposals = (await client.get(`/api/requests/${id}/proposals`)).body.proposals as { status: string }[];
      expect(proposals.map((p) => p.status)).toEqual(["rejected"]);
      expect((await bid(artistB, id)).status).toBe(409);

      const accepted = await funded();
      expect((await act(client, accepted, "cancel")).status).toBe(409);
      expect(escrow(accepted)).toBe(80_000);
    });

    it("keeps private requests away from outsiders but open to staff", async () => {
      const id = await funded();
      expect((await request(ctx.app).get(`/api/requests/${id}`)).status).toBe(404);
      expect((await client2.get(`/api/requests/${id}`)).status).toBe(404);
      expect((await artistB.get(`/api/requests/${id}`)).status).toBe(404);
      expect((await client2.get(`/api/requests/${id}/events`)).status).toBe(404);
      for (const agent of [client, artistA, mod, admin]) {
        expect((await agent.get(`/api/requests/${id}`)).status).toBe(200);
        expect((await agent.get(`/api/requests/${id}/events`)).status).toBe(200);
      }
      expect((await artistA.get("/api/requests/assigned")).body.requests).toHaveLength(1);
      expect((await artistB.get("/api/requests/assigned")).body.requests).toHaveLength(0);
      expect((await client.get("/api/requests/assigned")).status).toBe(403);
    });
  });

  describe("money across the board", () => {
    it("keeps the ledger balanced through a mix of outcomes and exposes it to admins", async () => {
      const completed = await funded();
      await act(artistA, completed, "start");
      await deliverWork(completed, 100);
      await act(client, completed, "approve");

      const refunded = await funded();
      await act(artistA, refunded, "withdraw");

      const disputed = await funded();
      await act(client, disputed, "dispute", { reason: "Late" });
      await mod.post(`/api/moderation/requests/${disputed}/resolve`).send({ outcome: "release" });

      const stillHeld = await funded();
      expect(escrow(stillHeld)).toBe(80_000);

      expect(ctx.db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM ledger_lines").get()).toEqual({ total: 0 });
      expect(revenue()).toBe(24_000);
      expect(wallet(artistAId)).toBe(136_000);
      expect(wallet(clientId)).toBe(1_000_000 - 80_000 - 80_000 - 80_000);
      ledgerClean();
      const report = await admin.get("/api/admin/ledger/verify");
      expect(report.body).toMatchObject({ ok: true, problems: [] });
    });

    it("detects tampering with a request's escrow", async () => {
      const id = await funded();
      ctx.db.prepare("UPDATE requests SET status = 'cancelled' WHERE id = ?").run(id);
      expect(verifyLedger(ctx.db).problems.join("\n")).toMatch(new RegExp(`Request ${id} \\(cancelled\\) holds 80000 in escrow, expected 0`));
    });

    it("appears on the artist's royalty statement next to sales", async () => {
      const id = await funded();
      await act(artistA, id, "start");
      await deliverWork(id, 110);
      await act(client, id, "approve");
      const open = await funded();
      expect(open).not.toBe(id);

      const { statement } = (await artistA.get("/api/royalties")).body;
      expect(statement.orders).toHaveLength(1);
      expect(statement.orders[0]).toMatchObject({
        source: "commission",
        requestId: id,
        title: "Portrait of my cat",
        grossCents: 80_000,
        commissionCents: 12_000,
        netCents: 68_000,
      });
      expect(statement.totals).toEqual({ orderCount: 1, grossCents: 80_000, commissionCents: 12_000, netCents: 68_000 });
      expect(statement.pendingNetCents).toBe(68_000);
      expect((await artistA.get("/api/wallet")).body.balanceCents).toBe(statement.totals.netCents);
    });
  });
});
