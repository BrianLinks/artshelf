import type { Db } from "../db/connection.js";
import type { LicenseType } from "../licenses/definitions.js";

export interface StatementLine {
  orderId: number;
  listingTitle: string;
  license: LicenseType;
  completedAt: string;
  grossCents: number;
  commissionCents: number;
  netCents: number;
}

export interface Statement {
  artistUserId: number;
  from: string | null;
  to: string | null;
  orders: StatementLine[];
  totals: { orderCount: number; grossCents: number; commissionCents: number; netCents: number };
  /** Net amount still held in escrow or under dispute. Not limited to the period. */
  pendingNetCents: number;
}

const DAY_MS = 86_400_000;

/** Completed orders whose completion falls in [from, to] (inclusive dates, UTC). */
export function artistStatement(db: Db, artistUserId: number, range: { from?: string; to?: string }): Statement {
  const conditions = ["artist_user_id = ?", "status = 'completed'"];
  const params: (string | number)[] = [artistUserId];
  if (range.from) {
    conditions.push("completed_at >= ?");
    params.push(`${range.from}T00:00:00.000Z`);
  }
  if (range.to) {
    conditions.push("completed_at < ?");
    params.push(new Date(Date.parse(`${range.to}T00:00:00.000Z`) + DAY_MS).toISOString());
  }
  const rows = db
    .prepare(
      `SELECT id, listing_title, license_type, completed_at, price_cents, commission_cents, payout_cents
       FROM orders WHERE ${conditions.join(" AND ")} ORDER BY completed_at, id`,
    )
    .all(...params) as {
    id: number;
    listing_title: string;
    license_type: LicenseType;
    completed_at: string;
    price_cents: number;
    commission_cents: number;
    payout_cents: number;
  }[];

  const orders = rows.map((row) => ({
    orderId: row.id,
    listingTitle: row.listing_title,
    license: row.license_type,
    completedAt: row.completed_at,
    grossCents: row.price_cents,
    commissionCents: row.commission_cents,
    netCents: row.payout_cents,
  }));
  const totals = orders.reduce(
    (sum, line) => ({
      orderCount: sum.orderCount + 1,
      grossCents: sum.grossCents + line.grossCents,
      commissionCents: sum.commissionCents + line.commissionCents,
      netCents: sum.netCents + line.netCents,
    }),
    { orderCount: 0, grossCents: 0, commissionCents: 0, netCents: 0 },
  );
  const pending = db
    .prepare("SELECT COALESCE(SUM(payout_cents), 0) AS total FROM orders WHERE artist_user_id = ? AND status IN ('escrow', 'disputed')")
    .get(artistUserId) as { total: number };

  return { artistUserId, from: range.from ?? null, to: range.to ?? null, orders, totals, pendingNetCents: pending.total };
}
