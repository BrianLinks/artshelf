import { Router } from "express";
import { z } from "zod";
import type { Db } from "../../db/connection.js";
import { DomainError } from "../../errors.js";
import { findArticle, searchArticles } from "../../support/help.js";
import {
  assignTicket,
  closeTicket,
  createTicket,
  getTicket,
  listMine,
  listQueue,
  replyToTicket,
  resolveTicket,
  TICKET_CATEGORIES,
  TICKET_STATUSES,
  toTicketSummary,
} from "../../support/tickets.js";
import { parse } from "../errors.js";
import { currentUser, requireAuth, requireRole } from "../middleware.js";

const idParams = z.object({ id: z.coerce.number().int().positive() });
const createBody = z.object({
  category: z.enum(TICKET_CATEGORIES),
  subject: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(4000),
});
const replyBody = z.object({ body: z.string().trim().min(1).max(4000), internal: z.boolean().default(false) });
const queueQuery = z.object({
  status: z.enum(TICKET_STATUSES).default("open"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
const helpQuery = z.object({ q: z.string().max(100).optional() });
const slugParams = z.object({ slug: z.string().min(1).max(80) });

export function supportRouter(db: Db): Router {
  const router = Router();
  const actor = (req: Parameters<typeof currentUser>[0]) => {
    const user = currentUser(req);
    return { id: user.id, isStaff: user.role === "moderator" || user.role === "admin" };
  };

  // The in-app help system is public.
  router.get("/help", (req, res) => {
    const { q } = parse(helpQuery, req.query);
    res.json({ articles: searchArticles(q).map(({ slug, title, summary }) => ({ slug, title, summary })) });
  });

  router.get("/help/:slug", (req, res) => {
    const { slug } = parse(slugParams, req.params);
    const article = findArticle(slug);
    if (!article) throw new DomainError("not_found", "Article not found");
    res.json({ article });
  });

  router.post("/tickets", requireAuth, (req, res) => {
    const input = parse(createBody, req.body);
    res.status(201).json({ ticket: createTicket(db, currentUser(req).id, input) });
  });

  router.get("/tickets", requireAuth, (req, res) => {
    res.json({ tickets: listMine(db, currentUser(req).id).map(toTicketSummary) });
  });

  router.get("/queue", requireRole("moderator", "admin"), (req, res) => {
    const query = parse(queueQuery, req.query);
    res.json({ tickets: listQueue(db, query.status, query.limit, query.offset).map(toTicketSummary) });
  });

  router.get("/tickets/:id", requireAuth, (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json({ ticket: getTicket(db, id, actor(req)) });
  });

  router.post("/tickets/:id/messages", requireAuth, (req, res) => {
    const { id } = parse(idParams, req.params);
    const input = parse(replyBody, req.body);
    res.status(201).json({ ticket: replyToTicket(db, id, actor(req), input) });
  });

  router.post("/tickets/:id/close", requireAuth, (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json({ ticket: closeTicket(db, id, actor(req)) });
  });

  router.post("/tickets/:id/resolve", requireRole("moderator", "admin"), (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json({ ticket: resolveTicket(db, id, currentUser(req).id) });
  });

  router.post("/tickets/:id/assign", requireRole("moderator", "admin"), (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json({ ticket: assignTicket(db, id, currentUser(req).id) });
  });

  return router;
}
