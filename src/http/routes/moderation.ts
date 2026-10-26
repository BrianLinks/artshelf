import { Router } from "express";
import { z } from "zod";
import { recordAudit } from "../../auth/audit.js";
import { listByStatus, PROFILE_STATUSES, transitionStatus } from "../../artists/profiles.js";
import type { Db } from "../../db/connection.js";
import { removeListing } from "../../listings/service.js";
import { listOrdersByStatus, ORDER_STATUSES, toOrderView } from "../../orders/repo.js";
import { resolveDispute } from "../../orders/service.js";
import { dismissFlags, hideReview, listForModeration, restoreReview } from "../../reviews/service.js";
import { closeNotice, listByStatus as listNoticesByStatus, reinstateNotice, rejectNotice, toNoticeView, upholdNotice } from "../../takedowns/service.js";
import { NOTICE_STATUSES } from "../../takedowns/machine.js";
import { REQUEST_STATUSES } from "../../requests/machine.js";
import { listRequestsByStatus, toRequestView } from "../../requests/repo.js";
import { resolveRequestDispute } from "../../requests/service.js";
import { parse } from "../errors.js";
import { currentUser, requireRole } from "../middleware.js";

const userIdParams = z.object({ userId: z.coerce.number().int().positive() });
const listQuery = z.object({
  status: z.enum(PROFILE_STATUSES).default("pending"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
const listingIdParams = z.object({ id: z.coerce.number().int().positive() });
const orderIdParams = z.object({ id: z.coerce.number().int().positive() });
const resolveBody = z.object({ outcome: z.enum(["release", "refund"]), note: z.string().trim().max(500).optional() });
const reviewIdParams = z.object({ id: z.coerce.number().int().positive() });
const reviewListQuery = z.object({
  status: z.enum(["flagged", "hidden"]).default("flagged"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
const noticeListQuery = z.object({
  status: z.enum(NOTICE_STATUSES).default("received"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
const pageFields = {
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
};
const orderListQuery = z.object({ status: z.enum(ORDER_STATUSES).default("disputed"), ...pageFields });
const requestListQuery = z.object({ status: z.enum(REQUEST_STATUSES).default("disputed"), ...pageFields });
const noteBody = z.object({ note: z.string().trim().max(500).optional() });
const rejectBody = z.object({ reason: z.string().trim().max(500).optional() });

export function moderationRouter(db: Db): Router {
  const router = Router();
  router.use(requireRole("moderator", "admin"));

  router.get("/artists", (req, res) => {
    const query = parse(listQuery, req.query);
    res.json({ artists: listByStatus(db, query.status, query.limit, query.offset) });
  });

  router.post("/artists/:userId/approve", (req, res) => {
    const actor = currentUser(req);
    const { userId } = parse(userIdParams, req.params);
    const profile = db.transaction(() => {
      const updated = transitionStatus(db, userId, "approved");
      recordAudit(db, { actorUserId: actor.id, action: "artist.approved", targetType: "user", targetId: userId });
      return updated;
    })();
    res.json({ profile });
  });

  router.post("/artists/:userId/reject", (req, res) => {
    const actor = currentUser(req);
    const { userId } = parse(userIdParams, req.params);
    const { reason } = parse(rejectBody, req.body ?? {});
    const profile = db.transaction(() => {
      const updated = transitionStatus(db, userId, "rejected");
      recordAudit(db, {
        actorUserId: actor.id,
        action: "artist.rejected",
        targetType: "user",
        targetId: userId,
        detail: reason ? { reason } : undefined,
      });
      return updated;
    })();
    res.json({ profile });
  });

  router.post("/listings/:id/remove", (req, res) => {
    const actor = currentUser(req);
    const { id } = parse(listingIdParams, req.params);
    const { reason } = parse(rejectBody, req.body ?? {});
    const listing = db.transaction(() => {
      const removed = removeListing(db, id);
      recordAudit(db, {
        actorUserId: actor.id,
        action: "listing.removed",
        targetType: "listing",
        targetId: id,
        detail: reason ? { reason } : undefined,
      });
      return removed;
    })();
    res.json({ listing });
  });

  router.get("/reviews", (req, res) => {
    const query = parse(reviewListQuery, req.query);
    res.json({ reviews: listForModeration(db, query.status, query.limit, query.offset) });
  });

  router.post("/reviews/:id/hide", (req, res) => {
    const { id } = parse(reviewIdParams, req.params);
    const { note } = parse(noteBody, req.body ?? {});
    res.json({ review: hideReview(db, currentUser(req).id, id, note) });
  });

  router.post("/reviews/:id/dismiss", (req, res) => {
    const { id } = parse(reviewIdParams, req.params);
    const { note } = parse(noteBody, req.body ?? {});
    res.json({ review: dismissFlags(db, currentUser(req).id, id, note) });
  });

  router.post("/reviews/:id/restore", (req, res) => {
    const { id } = parse(reviewIdParams, req.params);
    const { note } = parse(noteBody, req.body ?? {});
    res.json({ review: restoreReview(db, currentUser(req).id, id, note) });
  });

  router.get("/takedowns", (req, res) => {
    const query = parse(noticeListQuery, req.query);
    res.json({ notices: listNoticesByStatus(db, query.status, query.limit, query.offset).map(toNoticeView) });
  });

  const noticeActions = { uphold: upholdNotice, reject: rejectNotice, reinstate: reinstateNotice, close: closeNotice };
  for (const [action, handler] of Object.entries(noticeActions)) {
    router.post(`/takedowns/:id/${action}`, (req, res) => {
      const { id } = parse(reviewIdParams, req.params);
      const { note } = parse(noteBody, req.body ?? {});
      res.json({ notice: handler(db, currentUser(req).id, id, note) });
    });
  }

  router.get("/orders", (req, res) => {
    const query = parse(orderListQuery, req.query);
    res.json({ orders: listOrdersByStatus(db, query.status, query.limit, query.offset).map(toOrderView) });
  });

  router.get("/requests", (req, res) => {
    const query = parse(requestListQuery, req.query);
    res.json({ requests: listRequestsByStatus(db, query.status, query.limit, query.offset).map(toRequestView) });
  });

  router.post("/requests/:id/resolve", (req, res) => {
    const actor = currentUser(req);
    const { id } = parse(orderIdParams, req.params);
    const { outcome, note } = parse(resolveBody, req.body);
    res.json({ request: resolveRequestDispute(db, actor.id, id, outcome, note) });
  });

  router.post("/orders/:id/resolve", (req, res) => {
    const actor = currentUser(req);
    const { id } = parse(orderIdParams, req.params);
    const { outcome, note } = parse(resolveBody, req.body);
    res.json({ order: resolveDispute(db, actor.id, id, outcome, note) });
  });

  return router;
}
