import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";
import sharp from "sharp";
import request from "supertest";
import { upsertProfile, transitionStatus } from "../src/artists/profiles.js";
import { hashPassword } from "../src/auth/password.js";
import type { Role } from "../src/auth/roles.js";
import { createUser, type User } from "../src/auth/users.js";
import { loadConfig, type Config } from "../src/config.js";
import { openDatabase, type Db } from "../src/db/connection.js";
import { migrate } from "../src/db/migrate.js";
import { createApp } from "../src/http/app.js";

export const PASSWORD = "correct horse battery";

export interface TestContext {
  app: Express;
  db: Db;
  config: Config;
  uploadDir: string;
}

const tempDirs: string[] = [];
process.on("exit", () => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

export function makeTestApp(overrides: Record<string, string> = {}): TestContext {
  const uploadDir = mkdtempSync(join(tmpdir(), "artshelf-test-"));
  tempDirs.push(uploadDir);
  const config = loadConfig({
    NODE_ENV: "test",
    BCRYPT_ROUNDS: "4",
    LOGIN_RATE_LIMIT_MAX: "1000",
    DATABASE_PATH: ":memory:",
    UPLOAD_DIR: uploadDir,
    ...overrides,
  });
  const db = openDatabase(":memory:");
  migrate(db);
  return { app: createApp(db, config), db, config, uploadDir };
}

export async function seedUser(ctx: TestContext, email: string, role: Role): Promise<User> {
  return createUser(ctx.db, {
    email,
    passwordHash: await hashPassword(PASSWORD, ctx.config.BCRYPT_ROUNDS),
    displayName: email.split("@")[0] ?? "user",
    role,
  });
}

/** Seeds an artist account with a profile. Approved by default. */
export async function seedArtist(
  ctx: TestContext,
  email: string,
  options: { specialty?: string; approved?: boolean } = {},
): Promise<User> {
  const user = await seedUser(ctx, email, "artist");
  upsertProfile(ctx.db, user.id, { bio: `Bio of ${email}`, specialty: options.specialty ?? "illustration" });
  if (options.approved ?? true) transitionStatus(ctx.db, user.id, "approved");
  return user;
}

/** Returns a supertest agent that keeps cookies, already signed in as the given email. */
export async function signedInAgent(ctx: TestContext, email: string) {
  const agent = request.agent(ctx.app);
  const response = await agent.post("/api/auth/login").send({ email, password: PASSWORD });
  if (response.status !== 200) throw new Error(`Login failed in test helper: ${response.status}`);
  return agent;
}

/** A small real PNG. Different colors produce different bytes. */
export function makePng(r = 200, g = 30, b = 30, width = 64, height = 48): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
}

export function upload(
  agent: ReturnType<typeof request.agent>,
  options: { category: string; filename: string; data: Buffer },
) {
  return agent
    .post(`/api/assets?category=${options.category}&filename=${encodeURIComponent(options.filename)}`)
    .set("Content-Type", "application/octet-stream")
    .send(options.data);
}

/** Bytes that start with a zip signature followed by filler. Enough for a signature-only format check. */
export function fakeZip(size: number, seed: number): Buffer {
  const buffer = Buffer.alloc(size, seed);
  Buffer.from([0x50, 0x4b, 0x03, 0x04]).copy(buffer);
  return buffer;
}

type Agent = ReturnType<typeof request.agent>;

/** Uploads a PNG, creates a listing for it and publishes it. Returns the listing id and the PNG bytes. */
export async function createPublishedListing(
  artist: Agent,
  options: { category?: string; color?: number; basePriceCents?: number; licenses?: string[] } = {},
): Promise<{ id: number; png: Buffer }> {
  const png = await makePng(options.color ?? 90, 60, 30);
  const uploaded = await upload(artist, { category: options.category ?? "illustration", filename: "art.png", data: png });
  if (uploaded.status !== 201) throw new Error(`Upload failed in test helper: ${uploaded.status}`);
  const created = await artist.post("/api/listings").send({
    assetId: uploaded.body.asset.id,
    title: "Test Artwork",
    basePriceCents: options.basePriceCents ?? 50_000,
    licenses: options.licenses ?? ["non_commercial", "commercial", "broadcast"],
  });
  if (created.status !== 201) throw new Error(`Listing failed in test helper: ${created.status}`);
  const published = await artist.post(`/api/listings/${created.body.listing.id}/publish`);
  if (published.status !== 200) throw new Error(`Publish failed in test helper: ${published.status}`);
  return { id: created.body.listing.id, png };
}

export async function fund(agent: Agent, amountCents: number): Promise<void> {
  const response = await agent.post("/api/wallet/deposit").send({ amountCents });
  if (response.status !== 201) throw new Error(`Deposit failed in test helper: ${response.status}`);
}

/** Buys a license and confirms the order so it completes. Returns the order id. */
export async function completeSale(buyer: Agent, listingId: number, license = "commercial"): Promise<number> {
  const placed = await buyer.post("/api/orders").send({ listingId, license });
  if (placed.status !== 201) throw new Error(`Purchase failed in test helper: ${placed.status}`);
  const confirmed = await buyer.post(`/api/orders/${placed.body.order.id}/confirm`);
  if (confirmed.status !== 200) throw new Error(`Confirm failed in test helper: ${confirmed.status}`);
  return placed.body.order.id;
}

/** Runs a commission from request to approval. The client needs at least $800.00 in the wallet. */
export async function completeCommission(client: Agent, artist: Agent, color = 150): Promise<number> {
  const created = await client
    .post("/api/requests")
    .send({ title: "Portrait of my cat", description: "A watercolor portrait.", category: "illustration", budgetCents: 100_000 });
  const id: number = created.body.request.id;
  await artist.post(`/api/requests/${id}/proposals`).send({ priceCents: 80_000, message: "Happy to.", deliveryDays: 5, maxRevisions: 2 });
  const proposals = await client.get(`/api/requests/${id}/proposals`);
  await client.post(`/api/requests/${id}/accept`).send({ proposalId: proposals.body.proposals[0].id });
  await artist.post(`/api/requests/${id}/start`);
  const uploaded = await upload(artist, { category: "illustration", filename: "done.png", data: await makePng(color, 20, 20) });
  await artist.post(`/api/requests/${id}/deliver`).send({ assetId: uploaded.body.asset.id });
  const approved = await client.post(`/api/requests/${id}/approve`);
  if (approved.status !== 200) throw new Error(`Commission helper failed: ${approved.status}`);
  return id;
}
