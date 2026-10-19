import type { Db } from "../db/connection.js";
import type { LicenseType } from "../licenses/definitions.js";

export interface StatementLine {
  source: "sale" | "commission";
  orderId?: number;
  requestId?: number;
  title: string;
  license?: LicenseType;
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

/** Completed sales and commissions whose completion falls in [from, to] (inclusive dates, UTC). */
export function artistStatement(db: Db, artistUserId: number, range: { from?: string; to?: string }): Statement {
  const dateConditions: string[] = [];
  const dateParams: string[] = [];
  if (range.from) {
    dateConditions.push("completed_at >= ?");
    dateParams.push(`${range.from}T00:00:00.000Z`);
  }
  if (range.to) {
    dateConditions.push("completed_at < ?");
    dateParams.push(new Date(Date.parse(`${range.to}T00:00:00.000Z`) + DAY_MS).toISOString());
  }
  const extra = dateConditions.length > 0 ? ` AND ${dateConditions.join(" AND ")}` : "";

  const sales = (
    db
      .prepare(
        `SELECT id, listing_title, license_type, completed_at, price_cents, commission_cents, payout_cents
         FROM orders WHERE artist_user_id = ? AND status = 'completed'${extra}`,
      )
      .all(artistUserId, ...dateParams) as {
      id: number;
      listing_title: string;
      license_type: LicenseType;
      completed_at: string;
      price_cents: number;
      commission_cents: number;
      payout_cents: number;
    }[]
  ).map(
    (row): StatementLine => ({
      source: "sale",
      orderId: row.id,
      title: row.listing_title,
      license: row.license_type,
      completedAt: row.completed_at,
      grossCents: row.price_cents,
      commissionCents: row.commission_cents,
      netCents: row.payout_cents,
    }),
  );

  const commissions = (
    db
      .prepare(
        `SELECT id, title, completed_at, price_cents, commission_cents, payout_cents
         FROM requests WHERE artist_user_id = ? AND status = 'completed'${extra}`,
      )
      .all(artistUserId, ...dateParams) as {
      id: number;
      title: string;
      completed_at: string;
      price_cents: number;
      commission_cents: number;
      payout_cents: number;
    }[]
  ).map(
    (row): StatementLine => ({
      source: "commission",
      requestId: row.id,
      title: row.title,
      completedAt: row.completed_at,
      grossCents: row.price_cents,
      commissionCents: row.commission_cents,
      netCents: row.payout_cents,
    }),
  );

  const orders = [...sales, ...commissions].sort(
    (a, b) => a.completedAt.localeCompare(b.completedAt) || (a.orderId ?? a.requestId ?? 0) - (b.orderId ?? b.requestId ?? 0),
  );
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
    .prepare(
      `SELECT (SELECT COALESCE(SUM(payout_cents), 0) FROM orders WHERE artist_user_id = ? AND status IN ('escrow', 'disputed'))
            + (SELECT COALESCE(SUM(payout_cents), 0) FROM requests
               WHERE artist_user_id = ? AND status IN ('accepted', 'in_progress', 'delivered', 'revised', 'disputed')) AS total`,
    )
    .get(artistUserId, artistUserId) as { total: number };

  return { artistUserId, from: range.from ?? null, to: range.to ?? null, orders, totals, pendingNetCents: pending.total };
}
