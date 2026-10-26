import type { Db } from "../db/connection.js";
import type { Tier } from "../artists/profiles.js";
import type { BOARD_STATUSES, RequestStatus } from "./machine.js";

export interface RequestRecord {
  id: number;
  clientUserId: number;
  clientDisplayName: string;
  artistUserId: number | null;
  artistDisplayName: string | null;
  categorySlug: string;
  categoryName: string;
  title: string;
  description: string;
  budgetCents: number;
  status: RequestStatus;
  acceptedProposalId: number | null;
  priceCents: number | null;
  commissionBps: number | null;
  commissionCents: number | null;
  payoutCents: number | null;
  maxRevisions: number | null;
  revisionsUsed: number;
  dueAt: string | null;
  deliveredAt: string | null;
  autoApproveAt: string | null;
  completedAt: string | null;
  disputeReason: string | null;
  resolutionNote: string | null;
  proposalCount: number;
  createdAt: string;
  updatedAt: string;
}

interface RequestRow {
  id: number;
  client_user_id: number;
  client_display_name: string;
  artist_user_id: number | null;
  artist_display_name: string | null;
  category_slug: string;
  category_name: string;
  title: string;
  description: string;
  budget_cents: number;
  status: RequestStatus;
  accepted_proposal_id: number | null;
  price_cents: number | null;
  commission_bps: number | null;
  commission_cents: number | null;
  payout_cents: number | null;
  max_revisions: number | null;
  revisions_used: number;
  due_at: string | null;
  delivered_at: string | null;
  auto_approve_at: string | null;
  completed_at: string | null;
  dispute_reason: string | null;
  resolution_note: string | null;
  proposal_count: number;
  created_at: string;
  updated_at: string;
}

const SELECT = `
  SELECT r.id, r.client_user_id, cu.display_name AS client_display_name, r.artist_user_id, au.display_name AS artist_display_name,
         c.slug AS category_slug, c.name AS category_name, r.title, r.description, r.budget_cents, r.status,
         r.accepted_proposal_id, r.price_cents, r.commission_bps, r.commission_cents, r.payout_cents, r.max_revisions,
         r.revisions_used, r.due_at, r.delivered_at, r.auto_approve_at, r.completed_at, r.dispute_reason, r.resolution_note,
         (SELECT COUNT(*) FROM proposals p WHERE p.request_id = r.id AND p.status = 'pending') AS proposal_count,
         r.created_at, r.updated_at
  FROM requests r
  JOIN categories c ON c.id = r.category_id
  JOIN users cu ON cu.id = r.client_user_id
  LEFT JOIN users au ON au.id = r.artist_user_id`;

function toRecord(row: RequestRow): RequestRecord {
  return {
    id: row.id,
    clientUserId: row.client_user_id,
    clientDisplayName: row.client_display_name,
    artistUserId: row.artist_user_id,
    artistDisplayName: row.artist_display_name,
    categorySlug: row.category_slug,
    categoryName: row.category_name,
    title: row.title,
    description: row.description,
    budgetCents: row.budget_cents,
    status: row.status,
    acceptedProposalId: row.accepted_proposal_id,
    priceCents: row.price_cents,
    commissionBps: row.commission_bps,
    commissionCents: row.commission_cents,
    payoutCents: row.payout_cents,
    maxRevisions: row.max_revisions,
    revisionsUsed: row.revisions_used,
    dueAt: row.due_at,
    deliveredAt: row.delivered_at,
    autoApproveAt: row.auto_approve_at,
    completedAt: row.completed_at,
    disputeReason: row.dispute_reason,
    resolutionNote: row.resolution_note,
    proposalCount: row.proposal_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toRequestView(request: RequestRecord) {
  return {
    id: request.id,
    title: request.title,
    description: request.description,
    category: { slug: request.categorySlug, name: request.categoryName },
    budgetCents: request.budgetCents,
    status: request.status,
    client: { userId: request.clientUserId, displayName: request.clientDisplayName },
    artist: request.artistUserId === null ? null : { userId: request.artistUserId, displayName: request.artistDisplayName },
    proposalCount: request.proposalCount,
    priceCents: request.priceCents,
    commissionBps: request.commissionBps,
    commissionCents: request.commissionCents,
    payoutCents: request.payoutCents,
    maxRevisions: request.maxRevisions,
    revisionsUsed: request.revisionsUsed,
    dueAt: request.dueAt,
    deliveredAt: request.deliveredAt,
    autoApproveAt: request.autoApproveAt,
    completedAt: request.completedAt,
    disputeReason: request.disputeReason,
    resolutionNote: request.resolutionNote,
    createdAt: request.createdAt,
  };
}
export type RequestView = ReturnType<typeof toRequestView>;

export function findRequest(db: Db, id: number): RequestRecord | undefined {
  const row = db.prepare(`${SELECT} WHERE r.id = ?`).get(id) as RequestRow | undefined;
  return row ? toRecord(row) : undefined;
}

export function listForClient(db: Db, clientUserId: number): RequestRecord[] {
  const rows = db.prepare(`${SELECT} WHERE r.client_user_id = ? ORDER BY r.id DESC`).all(clientUserId) as RequestRow[];
  return rows.map(toRecord);
}

export function listForArtist(db: Db, artistUserId: number): RequestRecord[] {
  const rows = db.prepare(`${SELECT} WHERE r.artist_user_id = ? ORDER BY r.id DESC`).all(artistUserId) as RequestRow[];
  return rows.map(toRecord);
}

export function listRequestsByStatus(db: Db, status: RequestStatus, limit: number, offset: number): RequestRecord[] {
  const rows = db.prepare(`${SELECT} WHERE r.status = ? ORDER BY r.updated_at, r.id LIMIT ? OFFSET ?`).all(status, limit, offset) as RequestRow[];
  return rows.map(toRecord);
}

export const BOARD_SORTS = ["newest", "budget_asc", "budget_desc"] as const;
export type BoardSort = (typeof BOARD_SORTS)[number];
const ORDER_BY: Record<BoardSort, string> = {
  newest: "r.id DESC",
  budget_asc: "r.budget_cents ASC, r.id ASC",
  budget_desc: "r.budget_cents DESC, r.id ASC",
};

export interface BoardFilters {
  category?: string;
  status?: (typeof BOARD_STATUSES)[number];
  minBudgetCents?: number;
  maxBudgetCents?: number;
  sort: BoardSort;
  limit: number;
  offset: number;
}

export function listBoard(db: Db, filters: BoardFilters): { requests: RequestRecord[]; total: number } {
  const conditions = [`r.status IN ('open', 'proposed')`, "cu.disabled_at IS NULL"];
  const params: (string | number)[] = [];
  if (filters.category) {
    conditions.push("c.slug = ?");
    params.push(filters.category);
  }
  if (filters.status) {
    conditions.push("r.status = ?");
    params.push(filters.status);
  }
  if (filters.minBudgetCents !== undefined) {
    conditions.push("r.budget_cents >= ?");
    params.push(filters.minBudgetCents);
  }
  if (filters.maxBudgetCents !== undefined) {
    conditions.push("r.budget_cents <= ?");
    params.push(filters.maxBudgetCents);
  }
  const where = conditions.join(" AND ");
  const rows = db
    .prepare(`${SELECT} WHERE ${where} ORDER BY ${ORDER_BY[filters.sort]} LIMIT ? OFFSET ?`)
    .all(...params, filters.limit, filters.offset) as RequestRow[];
  const count = db
    .prepare(
      `SELECT COUNT(*) AS total FROM requests r
       JOIN categories c ON c.id = r.category_id JOIN users cu ON cu.id = r.client_user_id WHERE ${where}`,
    )
    .get(...params) as { total: number };
  return { requests: rows.map(toRecord), total: count.total };
}

export function dueForAutoApproval(db: Db, nowIso: string): number[] {
  const rows = db
    .prepare("SELECT id FROM requests WHERE status = 'delivered' AND auto_approve_at IS NOT NULL AND auto_approve_at <= ? ORDER BY id")
    .all(nowIso) as { id: number }[];
  return rows.map((row) => row.id);
}

// ---- proposals ----

export const PROPOSAL_STATUSES = ["pending", "accepted", "rejected", "withdrawn"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface ProposalRecord {
  id: number;
  requestId: number;
  artistUserId: number;
  artistDisplayName: string;
  artistTier: Tier;
  priceCents: number;
  message: string;
  deliveryDays: number;
  maxRevisions: number;
  status: ProposalStatus;
  createdAt: string;
  updatedAt: string;
}

interface ProposalRow {
  id: number;
  request_id: number;
  artist_user_id: number;
  display_name: string;
  tier: Tier;
  price_cents: number;
  message: string;
  delivery_days: number;
  max_revisions: number;
  status: ProposalStatus;
  created_at: string;
  updated_at: string;
}

const PROPOSAL_SELECT = `
  SELECT p.id, p.request_id, p.artist_user_id, u.display_name, ap.tier, p.price_cents, p.message,
         p.delivery_days, p.max_revisions, p.status, p.created_at, p.updated_at
  FROM proposals p
  JOIN users u ON u.id = p.artist_user_id
  JOIN artist_profiles ap ON ap.user_id = p.artist_user_id`;

function toProposal(row: ProposalRow): ProposalRecord {
  return {
    id: row.id,
    requestId: row.request_id,
    artistUserId: row.artist_user_id,
    artistDisplayName: row.display_name,
    artistTier: row.tier,
    priceCents: row.price_cents,
    message: row.message,
    deliveryDays: row.delivery_days,
    maxRevisions: row.max_revisions,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toProposalView(proposal: ProposalRecord) {
  return {
    id: proposal.id,
    requestId: proposal.requestId,
    artist: { userId: proposal.artistUserId, displayName: proposal.artistDisplayName, tier: proposal.artistTier },
    priceCents: proposal.priceCents,
    message: proposal.message,
    deliveryDays: proposal.deliveryDays,
    maxRevisions: proposal.maxRevisions,
    status: proposal.status,
    createdAt: proposal.createdAt,
  };
}

export function findProposal(db: Db, id: number): ProposalRecord | undefined {
  const row = db.prepare(`${PROPOSAL_SELECT} WHERE p.id = ?`).get(id) as ProposalRow | undefined;
  return row ? toProposal(row) : undefined;
}

export function findProposalByArtist(db: Db, requestId: number, artistUserId: number): ProposalRecord | undefined {
  const row = db.prepare(`${PROPOSAL_SELECT} WHERE p.request_id = ? AND p.artist_user_id = ?`).get(requestId, artistUserId) as
    | ProposalRow
    | undefined;
  return row ? toProposal(row) : undefined;
}

export function listProposals(db: Db, requestId: number, artistUserId?: number): ProposalRecord[] {
  const rows =
    artistUserId === undefined
      ? (db.prepare(`${PROPOSAL_SELECT} WHERE p.request_id = ? ORDER BY p.id`).all(requestId) as ProposalRow[])
      : (db.prepare(`${PROPOSAL_SELECT} WHERE p.request_id = ? AND p.artist_user_id = ? ORDER BY p.id`).all(
          requestId,
          artistUserId,
        ) as ProposalRow[]);
  return rows.map(toProposal);
}

export function pendingProposalCount(db: Db, requestId: number): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM proposals WHERE request_id = ? AND status = 'pending'").get(requestId) as {
    n: number;
  };
  return row.n;
}

// ---- deliveries and history ----

export function assetDelivered(db: Db, assetId: number): boolean {
  return db.prepare("SELECT 1 AS found FROM request_deliveries WHERE asset_id = ?").get(assetId) !== undefined;
}

export function deliveryCount(db: Db, requestId: number): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM request_deliveries WHERE request_id = ?").get(requestId) as { n: number };
  return row.n;
}

export function latestDelivery(
  db: Db,
  requestId: number,
): { version: number; note: string; storedName: string; mime: string; originalName: string; createdAt: string } | undefined {
  const row = db
    .prepare(
      `SELECT d.version, d.note, d.created_at, a.stored_name, a.mime, a.original_name
       FROM request_deliveries d JOIN assets a ON a.id = d.asset_id
       WHERE d.request_id = ? ORDER BY d.version DESC LIMIT 1`,
    )
    .get(requestId) as
    | { version: number; note: string; created_at: string; stored_name: string; mime: string; original_name: string }
    | undefined;
  return row
    ? {
        version: row.version,
        note: row.note,
        storedName: row.stored_name,
        mime: row.mime,
        originalName: row.original_name,
        createdAt: row.created_at,
      }
    : undefined;
}

export interface RequestEvent {
  id: number;
  actorUserId: number | null;
  kind: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  createdAt: string;
}

export function listEvents(db: Db, requestId: number): RequestEvent[] {
  const rows = db
    .prepare(
      "SELECT id, actor_user_id, kind, from_status, to_status, note, created_at FROM request_events WHERE request_id = ? ORDER BY id",
    )
    .all(requestId) as {
    id: number;
    actor_user_id: number | null;
    kind: string;
    from_status: string | null;
    to_status: string | null;
    note: string | null;
    created_at: string;
  }[];
  return rows.map((row) => ({
    id: row.id,
    actorUserId: row.actor_user_id,
    kind: row.kind,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    note: row.note,
    createdAt: row.created_at,
  }));
}
