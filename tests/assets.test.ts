import { readdirSync } from "node:fs";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { uploadAsset } from "../src/assets/service.js";
import { LocalStorage } from "../src/assets/storage.js";
import { fakeZip, makePng, makeTestApp, seedArtist, seedUser, signedInAgent, upload, type TestContext } from "./helpers.js";

describe("asset upload", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = makeTestApp();
    await seedArtist(ctx, "artist@example.com"); // id 1
    await seedUser(ctx, "client@example.com", "client");
  });

  it("stores a PNG, records its dimensions and creates a thumbnail", async () => {
    const agent = await signedInAgent(ctx, "artist@example.com");
    const png = await makePng();
    const response = await upload(agent, { category: "illustration", filename: "cat.png", data: png });
    expect(response.status).toBe(201);
    expect(response.body.asset).toMatchObject({
      category: "illustration",
      originalName: "cat.png",
      mime: "image/png",
      sizeBytes: png.length,
      width: 64,
      height: 48,
      hasThumbnail: true,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/stored|thumb_name/i);
    expect(readdirSync(ctx.uploadDir)).toHaveLength(2);
  });

  it("serves the file and the thumbnail back to the owner", async () => {
    const agent = await signedInAgent(ctx, "artist@example.com");
    const png = await makePng();
    const id = (await upload(agent, { category: "illustration", filename: "cat.png", data: png })).body.asset.id;
    const file = await agent.get(`/api/assets/${id}/file`).buffer(true).parse(binaryParser);
    expect(file.headers["content-type"]).toBe("image/png");
    expect(Buffer.from(file.body).equals(png)).toBe(true);
    const thumb = await agent.get(`/api/assets/${id}/thumbnail`);
    expect(thumb.headers["content-type"]).toBe("image/webp");
  });

  it("accepts a non-image format allowed by the category and serves it as an attachment", async () => {
    const agent = await signedInAgent(ctx, "artist@example.com");
    const response = await upload(agent, { category: "live2d", filename: "rig.zip", data: fakeZip(2_000, 1) });
    expect(response.status).toBe(201);
    expect(response.body.asset).toMatchObject({ mime: "application/zip", hasThumbnail: false, width: null });
    const file = await agent.get(`/api/assets/${response.body.asset.id}/file`);
    expect(file.headers["content-disposition"]).toMatch(/^attachment/);
    expect((await agent.get(`/api/assets/${response.body.asset.id}/thumbnail`)).status).toBe(404);
  });

  it("rejects a text file renamed to .png", async () => {
    const agent = await signedInAgent(ctx, "artist@example.com");
    const response = await upload(agent, { category: "illustration", filename: "evil.png", data: Buffer.from("<script>alert(1)</script>") });
    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe("unsupported_type");
    expect(readdirSync(ctx.uploadDir)).toHaveLength(0);
  });

  it("rejects a real format the category does not allow", async () => {
    const agent = await signedInAgent(ctx, "artist@example.com");
    const response = await upload(agent, { category: "sound", filename: "pic.png", data: await makePng() });
    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe("type_not_allowed");
  });

  it("rejects a PNG header with a corrupt body and writes nothing", async () => {
    const agent = await signedInAgent(ctx, "artist@example.com");
    const fake = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("garbage garbage")]);
    const response = await upload(agent, { category: "illustration", filename: "x.png", data: fake });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("invalid_image");
    expect(readdirSync(ctx.uploadDir)).toHaveLength(0);
  });

  it("validates the category, content type and query", async () => {
    const agent = await signedInAgent(ctx, "artist@example.com");
    const png = await makePng();
    expect((await upload(agent, { category: "pottery", filename: "a.png", data: png })).status).toBe(400);
    expect((await agent.post("/api/assets?filename=a.png").set("Content-Type", "application/octet-stream").send(png)).status).toBe(400);
    expect((await agent.post("/api/assets?category=illustration&filename=a.png").send({ not: "binary" })).status).toBe(415);
  });

  it("sanitizes hostile filenames and never writes outside the upload directory", async () => {
    const agent = await signedInAgent(ctx, "artist@example.com");
    const response = await upload(agent, { category: "illustration", filename: "../../etc/passwd.png", data: await makePng() });
    expect(response.status).toBe(201);
    expect(response.body.asset.originalName).toBe("passwd.png");
    expect(readdirSync(ctx.uploadDir).every((name) => /^[a-f0-9]{32}(\.thumb)?\.[a-z0-9]+$/.test(name))).toBe(true);
  });

  it("rejects duplicate uploads by the same artist", async () => {
    const agent = await signedInAgent(ctx, "artist@example.com");
    const png = await makePng();
    expect((await upload(agent, { category: "illustration", filename: "a.png", data: png })).status).toBe(201);
    const again = await upload(agent, { category: "illustration", filename: "b.png", data: png });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("duplicate_asset");
    expect(readdirSync(ctx.uploadDir)).toHaveLength(2);
  });

  it("enforces the per-user storage quota", async () => {
    const small = makeTestApp({ USER_QUOTA_MB: "1" });
    await seedArtist(small, "q@example.com");
    const agent = await signedInAgent(small, "q@example.com");
    const first = await upload(agent, { category: "live2d", filename: "a.zip", data: fakeZip(600_000, 1) });
    expect(first.status).toBe(201);
    const second = await upload(agent, { category: "live2d", filename: "b.zip", data: fakeZip(600_000, 2) });
    expect(second.status).toBe(413);
    expect(second.body.error.code).toBe("quota_exceeded");
  });

  it("enforces size limits before inspecting content", async () => {
    const small = makeTestApp({ MAX_UPLOAD_MB: "1" });
    const artist = await seedArtist(small, "big@example.com");
    const storage = new LocalStorage(small.uploadDir);
    await expect(
      uploadAsset(
        { db: small.db, storage, config: small.config },
        { ownerId: artist.id, categorySlug: "live2d", filename: "big.zip", data: fakeZip(1_100_000, 1) },
      ),
    ).rejects.toMatchObject({ code: "too_large" });
    await expect(
      uploadAsset(
        { db: small.db, storage, config: small.config },
        { ownerId: artist.id, categorySlug: "live2d", filename: "empty.zip", data: Buffer.alloc(0) },
      ),
    ).rejects.toMatchObject({ code: "empty_file" });
  });

  it("requires an artist account with a profile", async () => {
    const png = await makePng();
    expect((await upload(request.agent(ctx.app), { category: "illustration", filename: "a.png", data: png })).status).toBe(401);
    const client = await signedInAgent(ctx, "client@example.com");
    expect((await upload(client, { category: "illustration", filename: "a.png", data: png })).status).toBe(403);
    await seedUser(ctx, "noprofile@example.com", "artist");
    const bare = await signedInAgent(ctx, "noprofile@example.com");
    const response = await upload(bare, { category: "illustration", filename: "a.png", data: png });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("profile_required");
  });
});

describe("asset access and deletion", () => {
  let ctx: TestContext;
  let assetId: number;
  beforeEach(async () => {
    ctx = makeTestApp();
    await seedArtist(ctx, "owner@example.com");
    await seedArtist(ctx, "other@example.com");
    await seedUser(ctx, "mod@example.com", "moderator");
    await seedUser(ctx, "admin@example.com", "admin");
    const owner = await signedInAgent(ctx, "owner@example.com");
    assetId = (await upload(owner, { category: "illustration", filename: "mine.png", data: await makePng() })).body.asset.id;
  });

  it("requires sign-in", async () => {
    expect((await request(ctx.app).get(`/api/assets/${assetId}`)).status).toBe(401);
    expect((await request(ctx.app).get(`/api/assets/${assetId}/file`)).status).toBe(401);
  });

  it("hides the asset from other artists with a 404", async () => {
    const other = await signedInAgent(ctx, "other@example.com");
    for (const path of ["", "/file", "/thumbnail"]) {
      expect((await other.get(`/api/assets/${assetId}${path}`)).status).toBe(404);
    }
    expect((await other.delete(`/api/assets/${assetId}`)).status).toBe(404);
  });

  it("lets moderators and admins view but only the owner or an admin delete", async () => {
    const mod = await signedInAgent(ctx, "mod@example.com");
    expect((await mod.get(`/api/assets/${assetId}`)).status).toBe(200);
    expect((await mod.delete(`/api/assets/${assetId}`)).status).toBe(403);
    const admin = await signedInAgent(ctx, "admin@example.com");
    expect((await admin.get(`/api/assets/${assetId}`)).status).toBe(200);
  });

  it("lists only the caller's own assets", async () => {
    const owner = await signedInAgent(ctx, "owner@example.com");
    const other = await signedInAgent(ctx, "other@example.com");
    expect((await owner.get("/api/assets")).body.assets).toHaveLength(1);
    expect((await other.get("/api/assets")).body.assets).toHaveLength(0);
  });

  it("deletes the record and both files", async () => {
    const owner = await signedInAgent(ctx, "owner@example.com");
    expect(readdirSync(ctx.uploadDir)).toHaveLength(2);
    expect((await owner.delete(`/api/assets/${assetId}`)).status).toBe(204);
    expect((await owner.get(`/api/assets/${assetId}`)).status).toBe(404);
    expect(readdirSync(ctx.uploadDir)).toHaveLength(0);
  });
});

function binaryParser(res: request.Response, callback: (error: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
}
