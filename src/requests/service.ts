import { notify, notifyAll } from "../notifications/notifications.js";
import { getProfile } from "../artists/profiles.js";
import { recordAudit } from "../auth/audit.js";
import { findById } from "../auth/users.js";
import { findAsset } from "../assets/repo.js";
import { findCategoryBySlug } from "../catalog/categories.js";
import type { Db } from "../db/connection.js";
import { DomainError } from "../errors.js";
import { balanceOf, postEntry, requestEscrowAccountId, systemAccountId, walletAccountId } from "../ledger/ledger.js";
import { findListingByAsset } from "../listings/repo.js";
import { cents } from "../money.js";
import { priceOrder } from "../orders/pricing.js";
import { canTransition, type RequestStatus } from "./machine.js";
import {
  assetDelivered,
  deliveryCount,
  dueForAutoApproval,
  findProposal,
  findProposalByArtist,
  findRequest,
  pendingProposalCount,
  toProposalView,
  toRequestView,
  type ProposalRecord,
  type RequestRecord,
  type RequestView,
} from "./repo.js";

const DAY_MS = 86_400_000;
const ACTIVE_WORK: readonly RequestStatus[] = ["accepted", "in_progress", "delivered", "revised"];

export interface RequestConfig {
  REQUEST_AUTO_APPROVE_DAYS: number;
}

// ---- helpers ----

function requireRequest(db: Db, id: number): RequestRecord {
  const request = findRequest(db, id);
  if (!request) throw new DomainError("not_found", "Request not found");
  return request;
}

/** Client-only access. Anyone else gets not_found so private requests are not revealed. */
function clientRequest(db: Db, clientId: number, id: number): RequestRecord {
  const request = requireRequest(db, id);
  if (request.clientUserId !== clientId) throw new DomainError("not_found", "Request not found");
  return request;
}

/** Access for the artist assigned to the request. */
function artistRequest(db: Db, artistId: number, id: number): RequestRecord {
  const request = requireRequest(db, id);
  if (request.artistUserId !== artistId) throw new DomainError("not_found", "Request not found");
  return request;
}

function view(db: Db, id: number): RequestView {
  return toRequestView(requireRequest(db, id));
}

function logEvent(
  db: Db,
  requestId: number,
  actorUserId: number | null,
  kind: string,
  from: RequestStatus | null,
  to: RequestStatus | null,
  note: string | null,
  now: Date,
): void {
  db.prepare(
    "INSERT INTO request_events (request_id, actor_user_id, kind, from_status, to_status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(requestId, actorUserId, kind, from, to, note, now.toISOString());
}

type StatusFields = Partial<{
  artist_user_id: number;
  accepted_proposal_id: number;
  price_cents: number;
  commission_bps: number;
  commission_cents: number;
  payout_cents: number;
  max_revisions: number;
  revisions_used: number;
  due_at: string | null;
  delivered_at: string | null;
  auto_approve_at: string | null;
  completed_at: string | null;
  dispute_reason: string | null;
  resolution_note: string | null;
}>;

/** The only place a request's status changes. Enforces the state machine and writes the history entry. */
function move(
  db: Db,
  request: RequestRecord,
  to: RequestStatus,
  actorId: number | null,
  kind: string,
  note: string | null,
  now: Date,
  fields: StatusFields = {},
): void {
  if (!canTransition(request.status, to)) {
    throw new DomainError("invalid_request_state", `Cannot move a ${request.status} request to ${to}`);
  }
  const columns = Object.keys(fields) as (keyof StatusFields)[];
  const assignments = ["status = ?", "updated_at = ?", ...columns.map((column) => `${column} = ?`)];
  db.prepare(`UPDATE requests SET ${assignments.join(", ")} WHERE id = ?`).run(
    to,
    now.toISOString(),
    ...columns.map((column) => fields[column] ?? null),
    request.id,
  );
  logEvent(db, request.id, actorId, kind, request.status, to, note, now);
}

function releaseFunds(db: Db, request: RequestRecord, actorId: number | null, memo: string): void {
  if (request.artistUserId === null || request.priceCents === null || request.payoutCents === null || request.commissionCents === null) {
    throw new Error("Cannot release a request that was never funded");
  }
  const lines = [
    { accountId: requestEscrowAccountId(db, request.id), amountCents: -request.priceCents },
    { accountId: walletAccountId(db, request.artistUserId), amountCents: request.payoutCents },
    { accountId: systemAccountId(db, "platform_revenue"), amountCents: request.commissionCents },
  ].filter((line) => line.amountCents !== 0);
  postEntry(db, { kind: "escrow_release", requestId: request.id, memo, createdByUserId: actorId, lines });
}

function refundFunds(db: Db, request: RequestRecord, actorId: number | null, memo: string): void {
  if (request.priceCents === null) throw new Error("Cannot refund a request that was never funded");
  postEntry(db, {
    kind: "escrow_refund",
    requestId: request.id,
    memo,
    createdByUserId: actorId,
    lines: [
      { accountId: requestEscrowAccountId(db, request.id), amountCents: -request.priceCents },
      { accountId: walletAccountId(db, request.clientUserId), amountCents: request.priceCents },
    ],
  });
}

// ---- requests ----

export interface NewRequest {
  title: string;
  description: string;
  category: string;
  budgetCents: number;
}

export function createRequest(db: Db, clientId: number, input: NewRequest, now: Date = new Date()): RequestView {
  const category = findCategoryBySlug(db, input.category);
  if (!category) throw new DomainError("unknown_category", "Unknown category");
  const id = db.transaction(() => {
    const timestamp = now.toISOString();
    const info = db
      .prepare(
        "INSERT INTO requests (client_user_id, category_id, title, description, budget_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(clientId, category.id, input.title, input.description, input.budgetCents, timestamp, timestamp);
    const requestId = Number(info.lastInsertRowid);
    logEvent(db, requestId, clientId, "created", null, "open", null, now);
    return requestId;
  })();
  return view(db, id);
}

export function cancelRequest(db: Db, clientId: number, id: number, now: Date = new Date()): RequestView {
  db.transaction(() => {
    const request = clientRequest(db, clientId, id);
    move(db, request, "cancelled", clientId, "cancelled", null, now);
    db.prepare("UPDATE proposals SET status = 'rejected', updated_at = ? WHERE request_id = ? AND status = 'pending'").run(
      now.toISOString(),
      id,
    );
  })();
  return view(db, id);
}

// ---- proposals ----

export interface ProposalInput {
  priceCents: number;
  message: string;
  deliveryDays: number;
  maxRevisions: number;
}

function biddable(request: RequestRecord): void {
  if (request.status !== "open" && request.status !== "proposed") {
    throw new DomainError("invalid_request_state", "This request is no longer taking proposals");
  }
}

export function submitProposal(db: Db, artistId: number, requestId: number, input: ProposalInput, now: Date = new Date()) {
  const proposalId = db.transaction(() => {
    const request = requireRequest(db, requestId);
    biddable(request);
    if (request.clientUserId === artistId) throw new DomainError("cannot_propose_own_request", "You cannot bid on your own request");
    if (getProfile(db, artistId)?.status !== "approved") {
      throw new DomainError("profile_not_approved", "Your artist profile must be approved before you can bid");
    }
    if (input.priceCents > request.budgetCents) {
      throw new DomainError("price_exceeds_budget", "Your price is above the client's budget");
    }
    if (findProposalByArtist(db, requestId, artistId)) {
      throw new DomainError("already_proposed", "You already have a proposal on this request; edit it instead");
    }
    const timestamp = now.toISOString();
    const info = db
      .prepare(
        `INSERT INTO proposals (request_id, artist_user_id, price_cents, message, delivery_days, max_revisions, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(requestId, artistId, input.priceCents, input.message, input.deliveryDays, input.maxRevisions, timestamp, timestamp);
    if (request.status === "open") move(db, request, "proposed", artistId, "proposed", null, now);
    notify(db, request.clientUserId, { kind: "proposal_received", title: "New proposal", body: `An artist bid on "${request.title}".`, refType: "request", refId: requestId });
    return Number(info.lastInsertRowid);
  })();
  return proposalView(db, proposalId);
}

function proposalView(db: Db, id: number) {
  const proposal = findProposal(db, id);
  if (!proposal) throw new DomainError("not_found", "Proposal not found");
  return toProposalView(proposal);
}

/** Edits a pending proposal, or revives a withdrawn one. */
export function updateProposal(db: Db, artistId: number, requestId: number, input: ProposalInput, now: Date = new Date()) {
  const proposalId = db.transaction(() => {
    const request = requireRequest(db, requestId);
    const existing = findProposalByArtist(db, requestId, artistId);
    if (!existing) throw new DomainError("not_found", "Proposal not found");
    biddable(request);
    if (existing.status !== "pending" && existing.status !== "withdrawn") {
      throw new DomainError("proposal_not_pending", `A ${existing.status} proposal cannot be edited`);
    }
    if (input.priceCents > request.budgetCents) {
      throw new DomainError("price_exceeds_budget", "Your price is above the client's budget");
    }
    db.prepare(
      `UPDATE proposals SET price_cents = ?, message = ?, delivery_days = ?, max_revisions = ?, status = 'pending', updated_at = ?
       WHERE id = ?`,
    ).run(input.priceCents, input.message, input.deliveryDays, input.maxRevisions, now.toISOString(), existing.id);
    if (request.status === "open") move(db, request, "proposed", artistId, "proposed", null, now);
    return existing.id;
  })();
  return proposalView(db, proposalId);
}

export function withdrawProposal(db: Db, artistId: number, requestId: number, now: Date = new Date()) {
  const proposalId = db.transaction(() => {
    const request = requireRequest(db, requestId);
    const existing = findProposalByArtist(db, requestId, artistId);
    if (!existing) throw new DomainError("not_found", "Proposal not found");
    if (existing.status !== "pending") throw new DomainError("proposal_not_pending", `A ${existing.status} proposal cannot be withdrawn`);
    db.prepare("UPDATE proposals SET status = 'withdrawn', updated_at = ? WHERE id = ?").run(now.toISOString(), existing.id);
    if (request.status === "proposed" && pendingProposalCount(db, requestId) === 0) {
      move(db, request, "open", artistId, "proposals_withdrawn", null, now);
    }
    return existing.id;
  })();
  return proposalView(db, proposalId);
}

// ---- accepting and working ----

/** The client picks a proposal. The price moves from their wallet into escrow. */
export function acceptProposal(db: Db, clientId: number, requestId: number, proposalId: number, now: Date = new Date()): RequestView {
  db.transaction(() => {
    const request = clientRequest(db, clientId, requestId);
    if (request.status !== "proposed") throw new DomainError("invalid_request_state", `Cannot accept a proposal on a ${request.status} request`);
    const proposal: ProposalRecord | undefined = findProposal(db, proposalId);
    if (!proposal || proposal.requestId !== requestId) throw new DomainError("not_found", "Proposal not found");
    if (proposal.status !== "pending") throw new DomainError("proposal_not_pending", `A ${proposal.status} proposal cannot be accepted`);

    const artist = findById(db, proposal.artistUserId);
    if (!artist || artist.disabledAt !== null || getProfile(db, proposal.artistUserId)?.status !== "approved") {
      throw new DomainError("profile_not_approved", "This artist is no longer available");
    }

    const price = cents(proposal.priceCents);
    const wallet = walletAccountId(db, clientId);
    if (balanceOf(db, wallet) < price) throw new DomainError("insufficient_funds", "Your wallet balance is too low");
    const { commissionBps, commission, payout } = priceOrder(price, proposal.artistTier);

    postEntry(db, {
      kind: "escrow_hold",
      requestId,
      memo: `Request ${requestId} funded into escrow`,
      createdByUserId: clientId,
      lines: [
        { accountId: wallet, amountCents: -price },
        { accountId: requestEscrowAccountId(db, requestId), amountCents: price },
      ],
    });
    move(db, request, "accepted", clientId, "accepted", `Proposal ${proposalId}`, now, {
      artist_user_id: proposal.artistUserId,
      accepted_proposal_id: proposal.id,
      price_cents: price,
      commission_bps: commissionBps,
      commission_cents: commission,
      payout_cents: payout,
      max_revisions: proposal.maxRevisions,
      due_at: new Date(now.getTime() + proposal.deliveryDays * DAY_MS).toISOString(),
    });
    db.prepare("UPDATE proposals SET status = 'accepted', updated_at = ? WHERE id = ?").run(now.toISOString(), proposal.id);
    db.prepare("UPDATE proposals SET status = 'rejected', updated_at = ? WHERE request_id = ? AND id <> ? AND status = 'pending'").run(
      now.toISOString(),
      requestId,
      proposal.id,
    );
    recordAudit(db, { actorUserId: clientId, action: "request.accepted", targetType: "request", targetId: requestId });
    notify(db, proposal.artistUserId, { kind: "proposal_accepted", title: "Your proposal was accepted", body: `You were hired for "${request.title}". The payment is held in escrow.`, refType: "request", refId: requestId });
  })();
  return view(db, requestId);
}

export function startWork(db: Db, artistId: number, id: number, now: Date = new Date()): RequestView {
  db.transaction(() => {
    move(db, artistRequest(db, artistId, id), "in_progress", artistId, "started", null, now);
  })();
  return view(db, id);
}

export function deliver(
  db: Db,
  config: RequestConfig,
  artistId: number,
  id: number,
  input: { assetId: number; note: string },
  now: Date = new Date(),
): RequestView {
  db.transaction(() => {
    const request = artistRequest(db, artistId, id);
    if (request.status !== "in_progress" && request.status !== "revised") {
      throw new DomainError("invalid_request_state", `Cannot deliver on a ${request.status} request`);
    }
    const asset = findAsset(db, input.assetId);
    if (!asset || asset.ownerUserId !== artistId || asset.categorySlug !== request.categorySlug) {
      throw new DomainError("invalid_asset", "Deliver one of your own uploads from the request's category");
    }
    if (findListingByAsset(db, asset.id) || assetDelivered(db, asset.id)) {
      throw new DomainError("asset_in_use", "This asset is already used by a listing or another delivery");
    }
    const version = deliveryCount(db, id) + 1;
    db.prepare("INSERT INTO request_deliveries (request_id, asset_id, version, note, created_at) VALUES (?, ?, ?, ?, ?)").run(
      id,
      asset.id,
      version,
      input.note,
      now.toISOString(),
    );
    move(db, request, "delivered", artistId, "delivered", input.note || `Version ${version}`, now, {
      delivered_at: now.toISOString(),
      auto_approve_at: new Date(now.getTime() + config.REQUEST_AUTO_APPROVE_DAYS * DAY_MS).toISOString(),
    });
    notify(db, request.clientUserId, { kind: "delivery_ready", title: "Delivery ready", body: `Your commission "${request.title}" has a new delivery to review.`, refType: "request", refId: id });
  })();
  return view(db, id);
}

export function requestRevision(db: Db, clientId: number, id: number, note: string, now: Date = new Date()): RequestView {
  db.transaction(() => {
    const request = clientRequest(db, clientId, id);
    if (request.status === "delivered" && request.revisionsUsed >= (request.maxRevisions ?? 0)) {
      throw new DomainError("revision_limit_reached", "All revisions in this proposal have been used");
    }
    move(db, request, "revised", clientId, "revision_requested", note, now, {
      revisions_used: request.revisionsUsed + 1,
      auto_approve_at: null,
    });
    notifyAll(db, [request.artistUserId], { kind: "revision_requested", title: "Revision requested", body: `The client asked for changes on "${request.title}".`, refType: "request", refId: id });
  })();
  return view(db, id);
}

export function approveDelivery(db: Db, clientId: number, id: number, now: Date = new Date()): RequestView {
  db.transaction(() => {
    const request = clientRequest(db, clientId, id);
    if (request.status !== "delivered") throw new DomainError("invalid_request_state", `Cannot approve a ${request.status} request`);
    move(db, request, "completed", clientId, "approved", null, now, { completed_at: now.toISOString(), auto_approve_at: null });
    releaseFunds(db, request, clientId, `Request ${id} approved by the client`);
    notifyAll(db, [request.artistUserId], { kind: "request_completed", title: "Payment released", body: `The client approved "${request.title}". Your payout is in your wallet.`, refType: "request", refId: id });
  })();
  return view(db, id);
}

/** Approves every delivery the client has left untouched past the auto-approval date. */
export function autoApproveDue(db: Db, now: Date = new Date()): number {
  let approved = 0;
  for (const id of dueForAutoApproval(db, now.toISOString())) {
    db.transaction(() => {
      const request = requireRequest(db, id);
      move(db, request, "completed", null, "auto_approved", null, now, { completed_at: now.toISOString(), auto_approve_at: null });
      releaseFunds(db, request, null, `Request ${id} auto-approved after the review period`);
      recordAudit(db, { actorUserId: null, action: "request.auto_approved", targetType: "request", targetId: id });
      notifyAll(db, [request.artistUserId], { kind: "request_completed", title: "Payment released", body: `"${request.title}" was approved automatically after the review period.`, refType: "request", refId: id });
    })();
    approved += 1;
  }
  return approved;
}

// ---- disputes, withdrawals, resolution ----

/** Either party may freeze a funded request. */
export function openRequestDispute(db: Db, userId: number, id: number, reason: string, now: Date = new Date()): RequestView {
  db.transaction(() => {
    const request = requireRequest(db, id);
    if (request.clientUserId !== userId && request.artistUserId !== userId) throw new DomainError("not_found", "Request not found");
    if (!ACTIVE_WORK.includes(request.status)) {
      throw new DomainError("invalid_request_state", `Cannot dispute a ${request.status} request`);
    }
    move(db, request, "disputed", userId, "disputed", reason, now, { dispute_reason: reason, auto_approve_at: null });
    recordAudit(db, { actorUserId: userId, action: "request.disputed", targetType: "request", targetId: id });
    notifyAll(db, [request.clientUserId, request.artistUserId].filter((party) => party !== userId), { kind: "request_disputed", title: "Commission disputed", body: `A dispute was opened on "${request.title}". The payment is frozen until a moderator decides.`, refType: "request", refId: id });
  })();
  return view(db, id);
}

/** The artist walks away from funded work that has not been delivered, and the client is refunded. */
export function artistWithdraw(db: Db, artistId: number, id: number, now: Date = new Date()): RequestView {
  db.transaction(() => {
    const request = artistRequest(db, artistId, id);
    if (request.status !== "accepted" && request.status !== "in_progress" && request.status !== "revised") {
      throw new DomainError("invalid_request_state", `Cannot withdraw from a ${request.status} request`);
    }
    move(db, request, "refunded", artistId, "withdrawn", null, now);
    refundFunds(db, request, artistId, `Request ${id} withdrawn by the artist`);
    notify(db, request.clientUserId, { kind: "request_refunded", title: "Commission refunded", body: `The artist withdrew from "${request.title}". Your payment was refunded.`, refType: "request", refId: id });
  })();
  return view(db, id);
}

export function resolveRequestDispute(
  db: Db,
  actorId: number,
  id: number,
  outcome: "release" | "refund",
  note: string | undefined,
  now: Date = new Date(),
): RequestView {
  db.transaction(() => {
    const request = requireRequest(db, id);
    if (request.status !== "disputed") throw new DomainError("invalid_request_state", `Cannot resolve a ${request.status} request`);
    const memo = `Request ${id} dispute resolved: ${outcome}`;
    if (outcome === "release") {
      move(db, request, "completed", actorId, "dispute_resolved", note ?? null, now, { completed_at: now.toISOString(), resolution_note: note ?? null });
      releaseFunds(db, request, actorId, memo);
    } else {
      move(db, request, "refunded", actorId, "dispute_resolved", note ?? null, now, { resolution_note: note ?? null });
      refundFunds(db, request, actorId, memo);
    }
    recordAudit(db, {
      actorUserId: actorId,
      action: "request.dispute_resolved",
      targetType: "request",
      targetId: id,
      detail: { outcome, ...(note ? { note } : {}) },
    });
    notifyAll(db, [request.clientUserId, request.artistUserId], { kind: "request_dispute_resolved", title: "Dispute resolved", body: `The dispute on "${request.title}" was settled: ${outcome === "release" ? "payment released to the artist" : "refunded to the client"}.`, refType: "request", refId: id });
  })();
  return view(db, id);
}
