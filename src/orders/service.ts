import { notify, notifyAll } from "../notifications/notifications.js";
import { recordAudit } from "../auth/audit.js";
import type { Db } from "../db/connection.js";
import { DomainError } from "../errors.js";
import { escrowAccountId, balanceOf, postEntry, systemAccountId, walletAccountId } from "../ledger/ledger.js";
import type { LicenseType } from "../licenses/definitions.js";
import { getView } from "../listings/repo.js";
import { cents } from "../money.js";
import { priceOrder } from "./pricing.js";
import { dueForRelease, findActivePurchase, findOrder, toOrderView, type OrderRecord, type OrderStatus, type OrderView } from "./repo.js";

const DAY_MS = 86_400_000;

const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  escrow: ["completed", "refunded", "disputed"],
  disputed: ["completed", "refunded"],
  completed: [],
  refunded: [],
};

function requireOrder(db: Db, id: number): OrderRecord {
  const order = findOrder(db, id);
  if (!order) throw new DomainError("not_found", "Order not found");
  return order;
}

/** Buyer-only access. Anyone else gets not_found so order ids do not leak. */
function buyerOrder(db: Db, buyerId: number, id: number): OrderRecord {
  const order = requireOrder(db, id);
  if (order.buyerUserId !== buyerId) throw new DomainError("not_found", "Order not found");
  return order;
}

function assertTransition(order: OrderRecord, to: OrderStatus): void {
  if (!TRANSITIONS[order.status].includes(to)) {
    throw new DomainError("invalid_order_state", `Cannot move a ${order.status} order to ${to}`);
  }
}

function view(db: Db, id: number): OrderView {
  return toOrderView(requireOrder(db, id));
}

/** Moves escrowed funds to the artist (minus commission). Caller owns the transaction. */
function releaseEscrow(db: Db, order: OrderRecord, actorId: number | null, memo: string, now: Date): void {
  assertTransition(order, "completed");
  const lines = [
    { accountId: escrowAccountId(db, order.id), amountCents: -order.priceCents },
    { accountId: walletAccountId(db, order.artistUserId), amountCents: order.payoutCents },
    { accountId: systemAccountId(db, "platform_revenue"), amountCents: order.commissionCents },
  ].filter((line) => line.amountCents !== 0);
  postEntry(db, { kind: "escrow_release", orderId: order.id, memo, createdByUserId: actorId, lines });
  db.prepare("UPDATE orders SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?").run(
    now.toISOString(),
    now.toISOString(),
    order.id,
  );
}

/** Returns escrowed funds to the buyer in full. Caller owns the transaction. */
function refundEscrow(db: Db, order: OrderRecord, actorId: number | null, memo: string, now: Date): void {
  assertTransition(order, "refunded");
  postEntry(db, {
    kind: "escrow_refund",
    orderId: order.id,
    memo,
    createdByUserId: actorId,
    lines: [
      { accountId: escrowAccountId(db, order.id), amountCents: -order.priceCents },
      { accountId: walletAccountId(db, order.buyerUserId), amountCents: order.priceCents },
    ],
  });
  db.prepare("UPDATE orders SET status = 'refunded', updated_at = ? WHERE id = ?").run(now.toISOString(), order.id);
}

export function placeOrder(
  db: Db,
  config: { ESCROW_HOLD_DAYS: number },
  buyerId: number,
  input: { listingId: number; license: LicenseType },
  now: Date = new Date(),
): OrderView {
  const orderId = db.transaction(() => {
    const listing = getView(db, input.listingId);
    if (!listing || !listing.publiclyVisible) throw new DomainError("listing_unavailable", "This listing is not available");
    if (listing.artist.userId === buyerId) throw new DomainError("cannot_buy_own_listing", "You cannot buy your own listing");
    const offered = listing.licenses.find((entry) => entry.license === input.license);
    if (!offered) throw new DomainError("license_not_offered", "That license is not offered for this listing");
    if (findActivePurchase(db, buyerId, listing.id, input.license)) {
      throw new DomainError("already_purchased", "You already bought this license for this listing");
    }

    const price = cents(offered.priceCents);
    const wallet = walletAccountId(db, buyerId);
    if (balanceOf(db, wallet) < price) throw new DomainError("insufficient_funds", "Your wallet balance is too low");

    const { commissionBps, commission, payout } = priceOrder(price, listing.artist.tier);
    const timestamp = now.toISOString();
    const holdUntil = new Date(now.getTime() + config.ESCROW_HOLD_DAYS * DAY_MS).toISOString();
    const info = db
      .prepare(
        `INSERT INTO orders (buyer_user_id, artist_user_id, listing_id, listing_title, license_type, price_cents,
                             commission_bps, commission_cents, payout_cents, hold_until, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(buyerId, listing.artist.userId, listing.id, listing.title, input.license, price, commissionBps, commission, payout, holdUntil, timestamp, timestamp);
    const id = Number(info.lastInsertRowid);
    postEntry(db, {
      kind: "escrow_hold",
      orderId: id,
      memo: `Order ${id} paid into escrow`,
      createdByUserId: buyerId,
      lines: [
        { accountId: wallet, amountCents: -price },
        { accountId: escrowAccountId(db, id), amountCents: price },
      ],
    });
    recordAudit(db, { actorUserId: buyerId, action: "order.placed", targetType: "order", targetId: id });
    notify(db, listing.artist.userId, { kind: "order_placed", title: "New sale", body: `"${listing.title}" was bought under the ${input.license} license.`, refType: "order", refId: id });
    return id;
  })();
  return view(db, orderId);
}

export function confirmOrder(db: Db, buyerId: number, id: number, now: Date = new Date()): OrderView {
  db.transaction(() => {
    const order = buyerOrder(db, buyerId, id);
    if (order.status !== "escrow") throw new DomainError("invalid_order_state", `Cannot confirm a ${order.status} order`);
    releaseEscrow(db, order, buyerId, `Order ${id} confirmed by buyer`, now);
    recordAudit(db, { actorUserId: buyerId, action: "order.confirmed", targetType: "order", targetId: id });
    notify(db, order.artistUserId, { kind: "order_completed", title: "Payment released", body: `The buyer confirmed "${order.listingTitle}". Your payout is in your wallet.`, refType: "order", refId: id });
  })();
  return view(db, id);
}

export function openDispute(db: Db, buyerId: number, id: number, reason: string, now: Date = new Date()): OrderView {
  db.transaction(() => {
    const order = buyerOrder(db, buyerId, id);
    if (order.status !== "escrow") throw new DomainError("invalid_order_state", `Cannot dispute a ${order.status} order`);
    db.prepare("UPDATE orders SET status = 'disputed', dispute_reason = ?, updated_at = ? WHERE id = ?").run(
      reason,
      now.toISOString(),
      id,
    );
    recordAudit(db, { actorUserId: buyerId, action: "order.disputed", targetType: "order", targetId: id });
    notify(db, order.artistUserId, { kind: "order_disputed", title: "Order disputed", body: `The buyer opened a dispute on "${order.listingTitle}". The payment is frozen until a moderator decides.`, refType: "order", refId: id });
  })();
  return view(db, id);
}

/** The artist voluntarily refunds an order that is still in escrow. */
export function sellerRefund(db: Db, artistId: number, id: number, now: Date = new Date()): OrderView {
  db.transaction(() => {
    const order = requireOrder(db, id);
    if (order.artistUserId !== artistId) throw new DomainError("not_found", "Order not found");
    if (order.status !== "escrow") throw new DomainError("invalid_order_state", `Cannot refund a ${order.status} order`);
    refundEscrow(db, order, artistId, `Order ${id} refunded by the artist`, now);
    recordAudit(db, { actorUserId: artistId, action: "order.refunded", targetType: "order", targetId: id });
    notify(db, order.buyerUserId, { kind: "order_refunded", title: "Order refunded", body: `"${order.listingTitle}" was refunded to your wallet.`, refType: "order", refId: id });
  })();
  return view(db, id);
}

/** A moderator or admin settles a disputed order either way. */
export function resolveDispute(
  db: Db,
  actorId: number,
  id: number,
  outcome: "release" | "refund",
  note: string | undefined,
  now: Date = new Date(),
): OrderView {
  db.transaction(() => {
    const order = requireOrder(db, id);
    if (order.status !== "disputed") throw new DomainError("invalid_order_state", `Cannot resolve a ${order.status} order`);
    const memo = `Order ${id} dispute resolved: ${outcome}`;
    if (outcome === "release") releaseEscrow(db, order, actorId, memo, now);
    else refundEscrow(db, order, actorId, memo, now);
    db.prepare("UPDATE orders SET resolution_note = ? WHERE id = ?").run(note ?? null, id);
    recordAudit(db, {
      actorUserId: actorId,
      action: "order.dispute_resolved",
      targetType: "order",
      targetId: id,
      detail: { outcome, ...(note ? { note } : {}) },
    });
    notifyAll(db, [order.buyerUserId, order.artistUserId], { kind: "order_dispute_resolved", title: "Dispute resolved", body: `The dispute on "${order.listingTitle}" was settled: ${outcome === "release" ? "payment released to the artist" : "refunded to the buyer"}.`, refType: "order", refId: id });
  })();
  return view(db, id);
}

/** Releases every escrowed order whose hold period has elapsed. Disputed orders are never auto-released. */
export function releaseDueEscrows(db: Db, now: Date = new Date()): number {
  let released = 0;
  for (const id of dueForRelease(db, now.toISOString())) {
    db.transaction(() => {
      const order = requireOrder(db, id);
      releaseEscrow(db, order, null, `Order ${id} auto-released after the hold period`, now);
      recordAudit(db, { actorUserId: null, action: "order.auto_released", targetType: "order", targetId: id });
      notify(db, order.artistUserId, { kind: "order_completed", title: "Payment released", body: `"${order.listingTitle}" was released to you after the hold period.`, refType: "order", refId: id });
    })();
    released += 1;
  }
  return released;
}
