import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { findArticle, HELP_ARTICLES, searchArticles } from "../src/support/help.js";
import { MAX_ACTIVE_TICKETS } from "../src/support/tickets.js";
import { makeTestApp, seedUser, signedInAgent, type TestContext } from "./helpers.js";

type Agent = Awaited<ReturnType<typeof signedInAgent>>;

describe("support desk", () => {
  let ctx: TestContext;
  let user: Agent;
  let other: Agent;
  let mod: Agent;
  let admin: Agent;
  let userId: number;

  const open = async (agent: Agent = user, overrides: Record<string, unknown> = {}): Promise<number> => {
    const response = await agent.post("/api/support/tickets").send({
      category: "payment",
      subject: "Wallet question",
      message: "My deposit is missing.",
      ...overrides,
    });
    expect(response.status).toBe(201);
    return response.body.ticket.id;
  };
  const reply = (agent: Agent, id: number, body: string, internal = false) =>
    agent.post(`/api/support/tickets/${id}/messages`).send({ body, internal });
  const statusOf = async (id: number) => (await mod.get(`/api/support/tickets/${id}`)).body.ticket.status;

  beforeEach(async () => {
    ctx = makeTestApp();
    userId = (await seedUser(ctx, "user@example.com", "client")).id;
    await seedUser(ctx, "other@example.com", "artist");
    await seedUser(ctx, "mod@example.com", "moderator");
    await seedUser(ctx, "admin@example.com", "admin");
    user = await signedInAgent(ctx, "user@example.com");
    other = await signedInAgent(ctx, "other@example.com");
    mod = await signedInAgent(ctx, "mod@example.com");
    admin = await signedInAgent(ctx, "admin@example.com");
  });

  describe("tickets", () => {
    it("opens a ticket with its first message", async () => {
      const response = await user.post("/api/support/tickets").send({ category: "order", subject: "Where is my file?", message: "It will not download." });
      expect(response.body.ticket).toMatchObject({
        status: "open",
        category: "order",
        subject: "Where is my file?",
        requester: { userId },
        assignee: null,
        messageCount: 1,
      });
      expect(response.body.ticket.messages).toEqual([expect.objectContaining({ body: "It will not download.", internal: false })]);
    });

    it.each([
      ["a bad category", { category: "billing" }],
      ["an empty subject", { subject: " " }],
      ["an empty message", { message: "" }],
      ["a long subject", { subject: "x".repeat(121) }],
    ])("rejects %s", async (_label, overrides) => {
      const response = await user.post("/api/support/tickets").send({ category: "other", subject: "S", message: "M", ...overrides });
      expect(response.status).toBe(400);
    });

    it("needs a signed-in user and limits open tickets", async () => {
      expect((await request(ctx.app).post("/api/support/tickets").send({ category: "other", subject: "S", message: "M" })).status).toBe(401);
      for (let i = 0; i < MAX_ACTIVE_TICKETS; i++) await open(user, { subject: `Ticket ${i}` });
      const extra = await user.post("/api/support/tickets").send({ category: "other", subject: "One more", message: "M" });
      expect(extra.status).toBe(429);
      expect(extra.body.error.code).toBe("too_many_tickets");
      expect(await open(other)).toBeGreaterThan(0);
    });

    it("lists only your own tickets", async () => {
      await open(user);
      await open(other, { subject: "Mine" });
      const mine = (await user.get("/api/support/tickets")).body.tickets;
      expect(mine).toHaveLength(1);
      expect(mine[0].requester.userId).toBe(userId);
    });
  });

  describe("conversation", () => {
    it("moves between waiting for staff and waiting for the user", async () => {
      const id = await open();
      expect(await statusOf(id)).toBe("open");
      const answered = await reply(mod, id, "Looking into it.");
      expect(answered.body.ticket.status).toBe("pending_user");
      expect(answered.body.ticket.messages.at(-1).author).toMatchObject({ staff: true });

      const followUp = await reply(user, id, "Thanks, here is the reference.");
      expect(followUp.body.ticket.status).toBe("open");
      expect(followUp.body.ticket.messages).toHaveLength(3);
    });

    it("tells the user when staff reply", async () => {
      const id = await open();
      await reply(mod, id, "We fixed it.");
      const inbox = (await user.get("/api/notifications")).body.notifications as { kind: string; ref: { id: number } | null }[];
      const note = inbox.find((n) => n.kind === "support_reply");
      expect(note?.ref).toEqual({ type: "ticket", id });
    });

    it("keeps internal notes away from the requester and does not change the status", async () => {
      const id = await open();
      const note = await reply(mod, id, "Possible duplicate deposit, check the ledger.", true);
      expect(note.body.ticket.status).toBe("open");
      expect(note.body.ticket.messages.at(-1).internal).toBe(true);
      const requesterView = (await user.get(`/api/support/tickets/${id}`)).body.ticket;
      expect(requesterView.messages).toHaveLength(1);
      expect(requesterView.messageCount).toBe(1);
      expect(JSON.stringify(requesterView)).not.toMatch(/duplicate deposit/);
      expect((await reply(user, id, "sneaky note", true)).status).toBe(404);
      expect((await user.get("/api/notifications")).body.notifications.some((n: { kind: string }) => n.kind === "support_reply")).toBe(false);
    });

    it("hides tickets from other users but not from staff", async () => {
      const id = await open();
      expect((await other.get(`/api/support/tickets/${id}`)).status).toBe(404);
      expect((await reply(other, id, "hello")).status).toBe(404);
      expect((await other.post(`/api/support/tickets/${id}/close`)).status).toBe(404);
      expect((await request(ctx.app).get(`/api/support/tickets/${id}`)).status).toBe(401);
      for (const staff of [mod, admin]) expect((await staff.get(`/api/support/tickets/${id}`)).status).toBe(200);
      expect((await mod.get("/api/support/tickets/999")).status).toBe(404);
    });

    it("validates replies", async () => {
      const id = await open();
      expect((await user.post(`/api/support/tickets/${id}/messages`).send({ body: " " })).status).toBe(400);
      expect((await user.post(`/api/support/tickets/${id}/messages`).send({ body: "x".repeat(4001) })).status).toBe(400);
    });
  });

  describe("staff tools", () => {
    it("shows the queue by status to staff only", async () => {
      const first = await open(user, { subject: "First" });
      const second = await open(other, { subject: "Second" });
      await reply(mod, second, "On it");
      expect((await user.get("/api/support/queue")).status).toBe(403);
      expect((await request(ctx.app).get("/api/support/queue")).status).toBe(401);
      const waiting = (await mod.get("/api/support/queue")).body.tickets as { id: number }[];
      expect(waiting.map((t) => t.id)).toEqual([first]);
      const pending = (await admin.get("/api/support/queue?status=pending_user")).body.tickets as { id: number }[];
      expect(pending.map((t) => t.id)).toEqual([second]);
      expect((await mod.get("/api/support/queue?status=nope")).status).toBe(400);
    });

    it("assigns a ticket to the staff member who takes it", async () => {
      const id = await open();
      expect((await user.post(`/api/support/tickets/${id}/assign`)).status).toBe(403);
      const assigned = await mod.post(`/api/support/tickets/${id}/assign`);
      expect(assigned.body.ticket.assignee).toMatchObject({ displayName: "mod" });
      expect((await mod.post("/api/support/tickets/999/assign")).status).toBe(404);
    });

    it("resolves a ticket, notifies the user, and reopens it when they reply", async () => {
      const id = await open();
      expect((await user.post(`/api/support/tickets/${id}/resolve`)).status).toBe(403);
      expect((await mod.post(`/api/support/tickets/${id}/resolve`)).body.ticket.status).toBe("resolved");
      expect((await user.get("/api/notifications")).body.notifications.some((n: { kind: string }) => n.kind === "support_resolved")).toBe(true);
      expect((await reply(user, id, "Still broken")).body.ticket.status).toBe("open");
    });

    it("closes tickets for good, for the requester or staff", async () => {
      const id = await open();
      expect((await user.post(`/api/support/tickets/${id}/close`)).body.ticket.status).toBe("closed");
      const blocked = await reply(user, id, "One more thing");
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe("ticket_closed");
      expect((await reply(mod, id, "note", true)).status).toBe(409);
      expect((await user.post(`/api/support/tickets/${id}/close`)).status).toBe(409);
      expect((await mod.post(`/api/support/tickets/${id}/assign`)).status).toBe(409);

      const second = await open();
      expect((await admin.post(`/api/support/tickets/${second}/close`)).body.ticket.status).toBe("closed");
    });

    it("treats a repeated resolve as a no-op without a second notification, and blocks it once closed", async () => {
      const id = await open();
      await mod.post(`/api/support/tickets/${id}/resolve`);
      expect((await mod.post(`/api/support/tickets/${id}/resolve`)).status).toBe(200);
      const resolvedNotices = (await user.get("/api/notifications")).body.notifications.filter((n: { kind: string }) => n.kind === "support_resolved");
      expect(resolvedNotices).toHaveLength(1);
      await mod.post(`/api/support/tickets/${id}/close`);
      expect((await mod.post(`/api/support/tickets/${id}/resolve`)).status).toBe(409);
    });

    it("keeps the conversation append-only", async () => {
      await open();
      expect(() => ctx.db.prepare("UPDATE ticket_messages SET body = 'edited'").run()).toThrow(/append-only/);
      expect(() => ctx.db.prepare("DELETE FROM ticket_messages").run()).toThrow(/append-only/);
    });
  });
});

describe("help center", () => {
  let ctx: TestContext;
  beforeEach(() => {
    ctx = makeTestApp();
  });

  it("lists articles publicly without their bodies", async () => {
    const response = await request(ctx.app).get("/api/support/help");
    expect(response.status).toBe(200);
    expect(response.body.articles.length).toBe(HELP_ARTICLES.length);
    expect(response.body.articles[0]).toEqual({
      slug: expect.any(String),
      title: expect.any(String),
      summary: expect.any(String),
    });
  });

  it("serves one article, or 404", async () => {
    const article = (await request(ctx.app).get("/api/support/help/licenses")).body.article;
    expect(article.title).toMatch(/Licenses/);
    expect(article.body.length).toBeGreaterThan(100);
    expect((await request(ctx.app).get("/api/support/help/nope")).status).toBe(404);
  });

  it("searches titles before summaries before bodies", async () => {
    const hits = (await request(ctx.app).get("/api/support/help?q=escrow")).body.articles as { slug: string }[];
    expect(hits[0]?.slug).toBe("escrow-and-payments");
    expect(hits.length).toBeGreaterThan(1);
    expect((await request(ctx.app).get("/api/support/help?q=zzzznothing")).body.articles).toEqual([]);
    expect((await request(ctx.app).get(`/api/support/help?q=${"x".repeat(101)}`)).status).toBe(400);
  });

  it("has unique slugs and no empty content", () => {
    const slugs = HELP_ARTICLES.map((article) => article.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const article of HELP_ARTICLES) {
      expect(article.title.trim()).not.toBe("");
      expect(article.summary.trim()).not.toBe("");
      expect(article.body.trim().length).toBeGreaterThan(40);
    }
    expect(findArticle("getting-started")).toBeDefined();
  });

  it("quotes the real numbers from the code, so the help cannot drift", () => {
    const text = (slug: string) => findArticle(slug)?.body ?? "";
    expect(text("escrow-and-payments")).toContain("15%");
    expect(text("escrow-and-payments")).toContain("10%");
    expect(text("licenses")).toContain("2.5x");
    expect(text("licenses")).toContain("5x");
    expect(text("licenses")).toContain("resale_as_is");
    expect(text("uploads")).toContain("live2d: zip, png");
    expect(text("uploads")).toContain("100 MB");
    expect(searchArticles("copyright").map((a) => a.slug)).toContain("copyright-takedowns");
  });
});
