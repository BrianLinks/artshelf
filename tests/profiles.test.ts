import { beforeEach, describe, expect, it } from "vitest";
import { getProfile, listApproved, listByStatus, setTier, transitionStatus, upsertProfile } from "../src/artists/profiles.js";
import { setDisabled } from "../src/auth/users.js";
import { listCategories } from "../src/catalog/categories.js";
import { CATEGORY_RULES } from "../src/catalog/rules.js";
import { DomainError } from "../src/errors.js";
import { makeTestApp, seedArtist, seedUser, type TestContext } from "./helpers.js";

describe("categories", () => {
  it("seeds the eight marketplace categories, each with upload rules", () => {
    const { db } = makeTestApp();
    const categories = listCategories(db);
    expect(categories.map((category) => category.slug)).toEqual([
      "character-illustration",
      "illustration",
      "live2d",
      "virtual-3d",
      "design",
      "video",
      "sound",
      "webtoon-comic",
    ]);
    for (const category of categories) expect(CATEGORY_RULES[category.slug]).toBeDefined();
  });
});

describe("artist profiles", () => {
  let ctx: TestContext;
  beforeEach(() => {
    ctx = makeTestApp();
  });

  it("creates a pending standard profile", async () => {
    const user = await seedUser(ctx, "a@example.com", "artist");
    const profile = upsertProfile(ctx.db, user.id, { bio: "Hi", specialty: "live2d" });
    expect(profile).toMatchObject({ status: "pending", tier: "standard", specialty: "live2d", bio: "Hi" });
  });

  it("rejects an unknown specialty", async () => {
    const user = await seedUser(ctx, "a@example.com", "artist");
    expect(() => upsertProfile(ctx.db, user.id, { bio: "Hi", specialty: "pottery" })).toThrow(DomainError);
  });

  it("keeps approval when an approved artist edits, and resubmits a rejected one", async () => {
    const user = await seedArtist(ctx, "a@example.com");
    expect(upsertProfile(ctx.db, user.id, { bio: "New", specialty: "design" })).toMatchObject({
      status: "approved",
      bio: "New",
      specialty: "design",
    });
    transitionStatus(ctx.db, user.id, "rejected");
    expect(upsertProfile(ctx.db, user.id, { bio: "Fixed", specialty: "design" }).status).toBe("pending");
  });

  it("enforces the status state machine", async () => {
    const user = await seedUser(ctx, "a@example.com", "artist");
    upsertProfile(ctx.db, user.id, { bio: "Hi", specialty: "video" });
    expect(() => transitionStatus(ctx.db, user.id, "pending")).toThrow(/Cannot move/);
    transitionStatus(ctx.db, user.id, "approved");
    expect(() => transitionStatus(ctx.db, user.id, "approved")).toThrow(DomainError);
    transitionStatus(ctx.db, user.id, "rejected");
    expect(transitionStatus(ctx.db, user.id, "approved").status).toBe("approved");
  });

  it("reports missing profiles as not_found", () => {
    expect(() => transitionStatus(ctx.db, 999, "approved")).toThrow(/not found/i);
    expect(() => setTier(ctx.db, 999, "premium")).toThrow(DomainError);
    expect(getProfile(ctx.db, 999)).toBeUndefined();
  });

  it("lists only approved, active artists, premium first, with filters and paging", async () => {
    const a = await seedArtist(ctx, "a@example.com", { specialty: "illustration" });
    const b = await seedArtist(ctx, "b@example.com", { specialty: "illustration" });
    const c = await seedArtist(ctx, "c@example.com", { specialty: "sound" });
    await seedArtist(ctx, "pending@example.com", { approved: false });
    const gone = await seedArtist(ctx, "gone@example.com");
    setDisabled(ctx.db, gone.id, true);
    setTier(ctx.db, b.id, "premium");

    const all = listApproved(ctx.db, { limit: 20, offset: 0 });
    expect(all.map((profile) => profile.userId)).toEqual([b.id, a.id, c.id]);
    expect(listApproved(ctx.db, { category: "sound", limit: 20, offset: 0 }).map((p) => p.userId)).toEqual([c.id]);
    expect(listApproved(ctx.db, { tier: "premium", limit: 20, offset: 0 }).map((p) => p.userId)).toEqual([b.id]);
    expect(listApproved(ctx.db, { limit: 1, offset: 1 }).map((p) => p.userId)).toEqual([a.id]);
  });

  it("lists profiles by status for moderators", async () => {
    await seedArtist(ctx, "ok@example.com");
    const waiting = await seedArtist(ctx, "wait@example.com", { approved: false });
    expect(listByStatus(ctx.db, "pending", 20, 0).map((p) => p.userId)).toEqual([waiting.id]);
  });
});
