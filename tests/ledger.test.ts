import { beforeEach, describe, expect, it } from "vitest";
import {
  balanceOf,
  escrowAccountId,
  postEntry,
  recentWalletEntries,
  systemAccountId,
  verifyLedger,
  walletAccountId,
} from "../src/ledger/ledger.js";
import { deposit, walletSummary } from "../src/ledger/wallet.js";
import { COMMISSION_BPS, priceOrder } from "../src/orders/pricing.js";
import { cents } from "../src/money.js";
import { makeTestApp, seedUser, type TestContext } from "./helpers.js";

describe("ledger", () => {
  let ctx: TestContext;
  let userId: number;
  beforeEach(async () => {
    ctx = makeTestApp();
    userId = (await seedUser(ctx, "buyer@example.com", "client")).id;
  });

  it("creates wallet accounts once per user", () => {
    expect(walletAccountId(ctx.db, userId)).toBe(walletAccountId(ctx.db, userId));
    expect(walletAccountId(ctx.db, userId)).not.toBe(systemAccountId(ctx.db, "external"));
  });

  it("posts balanced entries and tracks balances", () => {
    const wallet = walletAccountId(ctx.db, userId);
    const external = systemAccountId(ctx.db, "external");
    postEntry(ctx.db, { kind: "deposit", memo: "top-up", lines: [{ accountId: external, amountCents: -700 }, { accountId: wallet, amountCents: 700 }] });
    expect(balanceOf(ctx.db, wallet)).toBe(700);
    expect(balanceOf(ctx.db, external)).toBe(-700);
  });

  it("refuses unbalanced, single-line, zero and fractional entries and writes nothing", () => {
    const wallet = walletAccountId(ctx.db, userId);
    const external = systemAccountId(ctx.db, "external");
    const attempt = (lines: { accountId: number; amountCents: number }[]) => () =>
      postEntry(ctx.db, { kind: "deposit", memo: "bad", lines });
    expect(attempt([{ accountId: wallet, amountCents: 100 }, { accountId: external, amountCents: -99 }])).toThrow(/Unbalanced/);
    expect(attempt([{ accountId: wallet, amountCents: 0 }])).toThrow(/at least two/);
    expect(attempt([{ accountId: wallet, amountCents: 0 }, { accountId: external, amountCents: 0 }])).toThrow(/non-zero/);
    expect(attempt([{ accountId: wallet, amountCents: 0.5 }, { accountId: external, amountCents: -0.5 }])).toThrow(/safe integers/);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get()).toEqual({ n: 0 });
  });

  it("is append-only", () => {
    deposit(ctx.db, userId, 500);
    expect(() => ctx.db.prepare("UPDATE ledger_lines SET amount_cents = 1").run()).toThrow(/append-only/);
    expect(() => ctx.db.prepare("DELETE FROM ledger_lines").run()).toThrow(/append-only/);
    expect(() => ctx.db.prepare("UPDATE journal_entries SET memo = 'x'").run()).toThrow(/append-only/);
    expect(() => ctx.db.prepare("DELETE FROM journal_entries").run()).toThrow(/append-only/);
  });

  it("reports wallet history, newest first", () => {
    deposit(ctx.db, userId, 500);
    deposit(ctx.db, userId, 250);
    const entries = recentWalletEntries(ctx.db, userId);
    expect(entries.map((entry) => entry.amountCents)).toEqual([250, 500]);
    expect(walletSummary(ctx.db, userId).balanceCents).toBe(750);
  });

  describe("verifyLedger", () => {
    it("passes on a clean ledger", () => {
      deposit(ctx.db, userId, 500);
      expect(verifyLedger(ctx.db)).toMatchObject({ ok: true, problems: [] });
    });

    it("detects an unbalanced entry inserted behind the API's back", () => {
      const entry = ctx.db.prepare("INSERT INTO journal_entries (kind, memo, created_at) VALUES ('deposit', 'forged', 't')").run();
      ctx.db.prepare("INSERT INTO ledger_lines (entry_id, account_id, amount_cents) VALUES (?, ?, 999)").run(
        entry.lastInsertRowid,
        walletAccountId(ctx.db, userId),
      );
      const report = verifyLedger(ctx.db);
      expect(report.ok).toBe(false);
      expect(report.problems.join("\n")).toMatch(/unbalanced/i);
      expect(report.problems.join("\n")).toMatch(/fewer than two/i);
    });

    it("detects an overdrawn wallet", () => {
      postEntry(ctx.db, {
        kind: "deposit",
        memo: "forged debit",
        lines: [{ accountId: walletAccountId(ctx.db, userId), amountCents: -100 }, { accountId: systemAccountId(ctx.db, "external"), amountCents: 100 }],
      });
      expect(verifyLedger(ctx.db).problems.join("\n")).toMatch(/overdrawn/i);
    });

    it("detects escrow that does not match its order", async () => {
      const artist = await seedUser(ctx, "artist@example.com", "artist");
      ctx.db.prepare("INSERT INTO artist_profiles (user_id, bio, category_id, created_at, updated_at) VALUES (?, 'b', 2, 't', 't')").run(artist.id);
      ctx.db.prepare("INSERT INTO assets (owner_user_id, category_id, original_name, stored_name, mime, size_bytes, sha256, created_at) VALUES (?, 2, 'a', 'a', 'image/png', 1, 'h', 't')").run(artist.id);
      ctx.db.prepare("INSERT INTO listings (artist_user_id, asset_id, category_id, title, base_price_cents, created_at, updated_at) VALUES (?, 1, 2, 'T', 5000, 't', 't')").run(artist.id);
      ctx.db.prepare(
        `INSERT INTO orders (buyer_user_id, artist_user_id, listing_id, listing_title, license_type, price_cents, commission_bps, commission_cents, payout_cents, hold_until, created_at, updated_at)
         VALUES (?, ?, 1, 'T', 'commercial', 100, 1500, 15, 85, 't', 't', 't')`,
      ).run(userId, artist.id);
      expect(escrowAccountId(ctx.db, 1)).toBeGreaterThan(0);
      expect(verifyLedger(ctx.db).problems.join("\n")).toMatch(/Order 1 \(escrow\) holds 0 in escrow, expected 100/);
    });
  });
});

describe("commission pricing", () => {
  it("uses the tier's rate", () => {
    expect(COMMISSION_BPS).toEqual({ standard: 1_500, premium: 1_000 });
    expect(priceOrder(cents(125_000), "standard")).toEqual({ commissionBps: 1_500, commission: 18_750, payout: 106_250 });
    expect(priceOrder(cents(125_000), "premium")).toEqual({ commissionBps: 1_000, commission: 12_500, payout: 112_500 });
  });

  it("never loses a cent to rounding", () => {
    for (let price = 100; price <= 3_000; price += 13) {
      for (const tier of ["standard", "premium"] as const) {
        const { commission, payout } = priceOrder(cents(price), tier);
        expect(commission + payout).toBe(price);
      }
    }
  });
});
