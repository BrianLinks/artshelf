import type { Db } from "../db/connection.js";
import { DomainError } from "../errors.js";
import { notify } from "../notifications/notifications.js";

export const TICKET_CATEGORIES = ["account", "payment", "order", "technical", "other"] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_STATUSES = ["open", "pending_user", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** open: waiting for staff. pending_user: staff replied, waiting for the requester. */
export const TICKET_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ["pending_user", "resolved", "closed"],
  pending_user: ["open", "resolved", "closed"],
  resolved: ["open", "closed"],
  closed: [],
};

export function canMoveTicket(from: TicketStatus, to: TicketStatus): boolean {
  return TICKET_TRANSITIONS[from].includes(to);
}

export const MAX_ACTIVE_TICKETS = 10;

interface TicketRow {
  id: number;
  requester_user_id: number;
  requester_name: string;
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  assignee_user_id: number | null;
  assignee_name: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
}

const SELECT = `
  SELECT t.id, t.requester_user_id, ru.display_name AS requester_name, t.category, t.subject, t.status, t.assignee_user_id,
         au.display_name AS assignee_name, t.created_at, t.updated_at,
         (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id AND m.internal = 0) AS message_count
  FROM tickets t
  JOIN users ru ON ru.id = t.requester_user_id
  LEFT JOIN users au ON au.id = t.assignee_user_id`;

export interface TicketRecord {
  id: number;
  requesterUserId: number;
  requesterName: string;
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  assigneeUserId: number | null;
  assigneeName: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

function toRecord(row: TicketRow): TicketRecord {
  return {
    id: row.id,
    requesterUserId: row.requester_user_id,
    requesterName: row.requester_name,
    category: row.category,
    subject: row.subject,
    status: row.status,
    assigneeUserId: row.assignee_user_id,
    assigneeName: row.assignee_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
  };
}

export function toTicketSummary(ticket: TicketRecord) {
  return {
    id: ticket.id,
    category: ticket.category,
    subject: ticket.subject,
    status: ticket.status,
    requester: { userId: ticket.requesterUserId, displayName: ticket.requesterName },
    assignee: ticket.assigneeUserId === null ? null : { userId: ticket.assigneeUserId, displayName: ticket.assigneeName },
    messageCount: ticket.messageCount,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

export function findTicket(db: Db, id: number): TicketRecord | undefined {
  const row = db.prepare(`${SELECT} WHERE t.id = ?`).get(id) as TicketRow | undefined;
  return row ? toRecord(row) : undefined;
}

function requireTicket(db: Db, id: number): TicketRecord {
  const ticket = findTicket(db, id);
  if (!ticket) throw new DomainError("not_found", "Ticket not found");
  return ticket;
}

export function listMine(db: Db, userId: number): TicketRecord[] {
  return (db.prepare(`${SELECT} WHERE t.requester_user_id = ? ORDER BY t.updated_at DESC, t.id DESC`).all(userId) as TicketRow[]).map(toRecord);
}

export function listQueue(db: Db, status: TicketStatus, limit: number, offset: number): TicketRecord[] {
  return (db.prepare(`${SELECT} WHERE t.status = ? ORDER BY t.updated_at, t.id LIMIT ? OFFSET ?`).all(status, limit, offset) as TicketRow[]).map(toRecord);
}

/** A ticket with its conversation. Requesters never see staff-only notes. */
export function getTicket(db: Db, id: number, viewer: { id: number; isStaff: boolean }) {
  const ticket = requireTicket(db, id);
  if (!viewer.isStaff && ticket.requesterUserId !== viewer.id) throw new DomainError("not_found", "Ticket not found");
  const rows = db
    .prepare(
      `SELECT m.id, m.author_user_id, u.display_name, u.role, m.body, m.internal, m.created_at
       FROM ticket_messages m JOIN users u ON u.id = m.author_user_id
       WHERE m.ticket_id = ? ${viewer.isStaff ? "" : "AND m.internal = 0"} ORDER BY m.id`,
    )
    .all(id) as { id: number; author_user_id: number; display_name: string; role: string; body: string; internal: number; created_at: string }[];
  return {
    ...toTicketSummary(ticket),
    messages: rows.map((row) => ({
      id: row.id,
      author: { userId: row.author_user_id, displayName: row.display_name, staff: row.role === "moderator" || row.role === "admin" },
      body: row.body,
      internal: row.internal === 1,
      createdAt: row.created_at,
    })),
  };
}

function addMessage(db: Db, ticketId: number, authorId: number, body: string, internal: boolean, now: Date): void {
  db.prepare("INSERT INTO ticket_messages (ticket_id, author_user_id, body, internal, created_at) VALUES (?, ?, ?, ?, ?)").run(
    ticketId,
    authorId,
    body,
    internal ? 1 : 0,
    now.toISOString(),
  );
}

function setStatus(db: Db, ticket: TicketRecord, to: TicketStatus, now: Date): void {
  if (ticket.status === to) return;
  if (!canMoveTicket(ticket.status, to)) throw new DomainError("invalid_ticket_state", `Cannot move a ${ticket.status} ticket to ${to}`);
  db.prepare("UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?").run(to, now.toISOString(), ticket.id);
}

export function createTicket(
  db: Db,
  requesterId: number,
  input: { category: TicketCategory; subject: string; message: string },
  now: Date = new Date(),
) {
  const id = db.transaction(() => {
    const active = db
      .prepare("SELECT COUNT(*) AS n FROM tickets WHERE requester_user_id = ? AND status IN ('open', 'pending_user')")
      .get(requesterId) as { n: number };
    if (active.n >= MAX_ACTIVE_TICKETS) throw new DomainError("too_many_tickets", "Please wait for your open tickets to be answered first");
    const timestamp = now.toISOString();
    const info = db
      .prepare("INSERT INTO tickets (requester_user_id, category, subject, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(requesterId, input.category, input.subject, timestamp, timestamp);
    const ticketId = Number(info.lastInsertRowid);
    addMessage(db, ticketId, requesterId, input.message, false, now);
    return ticketId;
  })();
  return getTicket(db, id, { id: requesterId, isStaff: false });
}

/**
 * Posts a reply. A requester's reply reopens a waiting or resolved ticket; a staff reply marks it as waiting
 * for the requester and notifies them; an internal staff note changes nothing and is never shown to the requester.
 */
export function replyToTicket(
  db: Db,
  ticketId: number,
  author: { id: number; isStaff: boolean },
  input: { body: string; internal: boolean },
  now: Date = new Date(),
) {
  db.transaction(() => {
    const ticket = requireTicket(db, ticketId);
    if (!author.isStaff && ticket.requesterUserId !== author.id) throw new DomainError("not_found", "Ticket not found");
    if (ticket.status === "closed") throw new DomainError("ticket_closed", "This ticket is closed");
    if (input.internal && !author.isStaff) throw new DomainError("not_found", "Ticket not found");

    addMessage(db, ticketId, author.id, input.body, input.internal, now);
    if (input.internal) return;
    if (author.isStaff) {
      setStatus(db, ticket, "pending_user", now);
      notify(db, ticket.requesterUserId, {
        kind: "support_reply",
        title: "Support replied to your ticket",
        body: `New reply on "${ticket.subject}".`,
        refType: "ticket",
        refId: ticketId,
      });
    } else {
      setStatus(db, ticket, "open", now);
    }
  })();
  return getTicket(db, ticketId, author);
}

export function resolveTicket(db: Db, ticketId: number, staffId: number, now: Date = new Date()) {
  db.transaction(() => {
    const ticket = requireTicket(db, ticketId);
    if (ticket.status === "resolved") return;
    setStatus(db, ticket, "resolved", now);
    notify(db, ticket.requesterUserId, {
      kind: "support_resolved",
      title: "Your ticket was resolved",
      body: `"${ticket.subject}" was marked resolved. Reply to reopen it.`,
      refType: "ticket",
      refId: ticketId,
    });
  })();
  return getTicket(db, ticketId, { id: staffId, isStaff: true });
}

/** The requester or staff close a ticket for good. */
export function closeTicket(db: Db, ticketId: number, actor: { id: number; isStaff: boolean }, now: Date = new Date()) {
  db.transaction(() => {
    const ticket = requireTicket(db, ticketId);
    if (!actor.isStaff && ticket.requesterUserId !== actor.id) throw new DomainError("not_found", "Ticket not found");
    if (ticket.status === "closed") throw new DomainError("ticket_closed", "This ticket is already closed");
    setStatus(db, ticket, "closed", now);
  })();
  return getTicket(db, ticketId, actor);
}

export function assignTicket(db: Db, ticketId: number, staffId: number, now: Date = new Date()) {
  db.transaction(() => {
    const ticket = requireTicket(db, ticketId);
    if (ticket.status === "closed") throw new DomainError("ticket_closed", "This ticket is closed");
    db.prepare("UPDATE tickets SET assignee_user_id = ?, updated_at = ? WHERE id = ?").run(staffId, now.toISOString(), ticketId);
  })();
  return getTicket(db, ticketId, { id: staffId, isStaff: true });
}
