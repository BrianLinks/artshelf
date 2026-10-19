import type { Db } from "../db/connection.js";
import { ESCROWED_STATUSES } from "../requests/machine.js";

/**
 * Double-entry ledger. Every journal entry has two or more lines whose signed amounts sum to zero.
 * An account's balance is the sum of its lines. Lines are append-only (enforced by triggers).
 * Callers must run postEntry inside the same transaction as the business change it records.
 */
export const ENTRY_KINDS = ["deposit", "escrow_hold", "escrow_release", "escrow_refund"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export interface EntryLine {
  accountId: number;
  amountCents: number;
}

export interface NewEntry {
  kind: EntryKind;
  orderId?: number;
  requestId?: number;
  memo: string;
  createdByUserId?: number | null;
  lines: EntryLine[];
}

interface AccountOwner {
  userId?: number;
  orderId?: number;
  requestId?: number;
}

function findAccount(db: Db, kind: string, owner: AccountOwner): number | undefined {
  const row = db
    .prepare("SELECT id FROM accounts WHERE kind = ? AND user_id IS ? AND order_id IS ? AND request_id IS ?")
    .get(kind, owner.userId ?? null, owner.orderId ?? null, owner.requestId ?? null) as { id: number } | undefined;
  return row?.id;
}

export function systemAccountId(db: Db, kind: "external" | "platform_revenue"): number {
  const id = findAccount(db, kind, {});
  if (id === undefined) throw new Error(`System account missing: ${kind}`);
  return id;
}

function getOrCreate(db: Db, kind: "user_wallet" | "escrow", owner: AccountOwner): number {
  db.prepare("INSERT OR IGNORE INTO accounts (kind, user_id, order_id, request_id) VALUES (?, ?, ?, ?)").run(
    kind,
    owner.userId ?? null,
    owner.orderId ?? null,
    owner.requestId ?? null,
  );
  const id = findAccount(db, kind, owner);
  if (id === undefined) throw new Error("Account could not be created");
  return id;
}

export const walletAccountId = (db: Db, userId: number): number => getOrCreate(db, "user_wallet", { userId });
export const escrowAccountId = (db: Db, orderId: number): number => getOrCreate(db, "escrow", { orderId });
export const requestEscrowAccountId = (db: Db, requestId: number): number => getOrCreate(db, "escrow", { requestId });

export function balanceOf(db: Db, accountId: number): number {
  const row = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS balance FROM ledger_lines WHERE account_id = ?").get(
    accountId,
  ) as { balance: number };
  return row.balance;
}

export function postEntry(db: Db, entry: NewEntry): number {
  if (entry.lines.length < 2) throw new Error("A ledger entry needs at least two lines");
  let sum = 0;
  for (const line of entry.lines) {
    if (!Number.isSafeInteger(line.amountCents) || line.amountCents === 0) {
      throw new Error("Ledger amounts must be non-zero safe integers");
    }
    sum += line.amountCents;
  }
  if (sum !== 0) throw new Error(`Unbalanced ledger entry: lines sum to ${sum}`);

  return db.transaction(() => {
    const info = db
      .prepare(
        "INSERT INTO journal_entries (kind, order_id, request_id, memo, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(entry.kind, entry.orderId ?? null, entry.requestId ?? null, entry.memo, entry.createdByUserId ?? null, new Date().toISOString());
    const entryId = Number(info.lastInsertRowid);
    const insertLine = db.prepare("INSERT INTO ledger_lines (entry_id, account_id, amount_cents) VALUES (?, ?, ?)");
    for (const line of entry.lines) insertLine.run(entryId, line.accountId, line.amountCents);
    return entryId;
  })();
}

export interface WalletEntry {
  entryId: number;
  kind: EntryKind;
  orderId: number | null;
  memo: string;
  amountCents: number;
  createdAt: string;
}

export function recentWalletEntries(db: Db, userId: number, limit = 20): WalletEntry[] {
  const rows = db
    .prepare(
      `SELECT je.id AS entry_id, je.kind, je.order_id, je.memo, ll.amount_cents, je.created_at
       FROM ledger_lines ll JOIN journal_entries je ON je.id = ll.entry_id
       WHERE ll.account_id = ? ORDER BY ll.id DESC LIMIT ?`,
    )
    .all(walletAccountId(db, userId), limit) as {
    entry_id: number;
    kind: EntryKind;
    order_id: number | null;
    memo: string;
    amount_cents: number;
    created_at: string;
  }[];
  return rows.map((row) => ({
    entryId: row.entry_id,
    kind: row.kind,
    orderId: row.order_id,
    memo: row.memo,
    amountCents: row.amount_cents,
    createdAt: row.created_at,
  }));
}

export interface LedgerReport {
  ok: boolean;
  problems: string[];
  totals: { entries: number; lines: number; platformRevenueCents: number };
}

/** Reconciles the ledger against itself and against the orders table. Read-only. */
export function verifyLedger(db: Db): LedgerReport {
  const problems: string[] = [];

  const unbalanced = db
    .prepare("SELECT entry_id, SUM(amount_cents) AS total FROM ledger_lines GROUP BY entry_id HAVING total <> 0")
    .all() as { entry_id: number; total: number }[];
  for (const row of unbalanced) problems.push(`Entry ${row.entry_id} is unbalanced by ${row.total}`);

  const thin = db
    .prepare(
      `SELECT e.id FROM journal_entries e LEFT JOIN ledger_lines l ON l.entry_id = e.id
       GROUP BY e.id HAVING COUNT(l.id) < 2`,
    )
    .all() as { id: number }[];
  for (const row of thin) problems.push(`Entry ${row.id} has fewer than two lines`);

  const overdrawn = db
    .prepare(
      `SELECT a.id, a.user_id, SUM(l.amount_cents) AS balance
       FROM accounts a JOIN ledger_lines l ON l.account_id = a.id
       WHERE a.kind = 'user_wallet' GROUP BY a.id HAVING balance < 0`,
    )
    .all() as { id: number; user_id: number; balance: number }[];
  for (const row of overdrawn) problems.push(`Wallet of user ${row.user_id} is overdrawn (${row.balance})`);

  const orders = db
    .prepare(
      `SELECT o.id, o.status, o.price_cents,
              COALESCE((SELECT SUM(l.amount_cents) FROM accounts a JOIN ledger_lines l ON l.account_id = a.id
                        WHERE a.kind = 'escrow' AND a.order_id = o.id), 0) AS held
       FROM orders o`,
    )
    .all() as { id: number; status: string; price_cents: number; held: number }[];
  for (const order of orders) {
    const expected = order.status === "escrow" || order.status === "disputed" ? order.price_cents : 0;
    if (order.held !== expected) {
      problems.push(`Order ${order.id} (${order.status}) holds ${order.held} in escrow, expected ${expected}`);
    }
  }

  const requests = db
    .prepare(
      `SELECT r.id, r.status, COALESCE(r.price_cents, 0) AS price_cents,
              COALESCE((SELECT SUM(l.amount_cents) FROM accounts a JOIN ledger_lines l ON l.account_id = a.id
                        WHERE a.kind = 'escrow' AND a.request_id = r.id), 0) AS held
       FROM requests r`,
    )
    .all() as { id: number; status: string; price_cents: number; held: number }[];
  for (const request of requests) {
    const expected = (ESCROWED_STATUSES as readonly string[]).includes(request.status) ? request.price_cents : 0;
    if (request.held !== expected) {
      problems.push(`Request ${request.id} (${request.status}) holds ${request.held} in escrow, expected ${expected}`);
    }
  }

  const revenue = balanceOf(db, systemAccountId(db, "platform_revenue"));
  const commissions = db
    .prepare(
      `SELECT (SELECT COALESCE(SUM(commission_cents), 0) FROM orders WHERE status = 'completed')
            + (SELECT COALESCE(SUM(commission_cents), 0) FROM requests WHERE status = 'completed') AS total`,
    )
    .get() as { total: number };
  if (revenue !== commissions.total) {
    problems.push(`Platform revenue is ${revenue} but completed sales and commissions earned ${commissions.total}`);
  }

  const counts = db
    .prepare("SELECT (SELECT COUNT(*) FROM journal_entries) AS entries, (SELECT COUNT(*) FROM ledger_lines) AS lines")
    .get() as { entries: number; lines: number };
  return {
    ok: problems.length === 0,
    problems,
    totals: { entries: counts.entries, lines: counts.lines, platformRevenueCents: revenue },
  };
}
