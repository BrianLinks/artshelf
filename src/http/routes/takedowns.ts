import { Router } from "express";
import { z } from "zod";
import type { Db } from "../../db/connection.js";
import { DomainError } from "../../errors.js";
import {
  fileCounterNotice,
  fileNotice,
  findNotice,
  listAgainstArtist,
  listByClaimant,
  toNoticeView,
} from "../../takedowns/service.js";
import { parse } from "../errors.js";
import { currentUser, requireAuth, requireRole } from "../middleware.js";

const idParams = z.object({ id: z.coerce.number().int().positive() });
const noticeBody = z.object({
  listingId: z.number().int().positive(),
  workDescription: z.string().trim().min(10).max(2000),
  originalUrl: z.string().trim().url().max(500).optional(),
  goodFaithStatement: z.literal(true, { errorMap: () => ({ message: "You must state that you believe the use is unauthorized" }) }),
  accuracyStatement: z.literal(true, { errorMap: () => ({ message: "You must state that your notice is accurate" }) }),
  signature: z.string().trim().min(2).max(120),
});
const counterBody = z.object({
  statement: z.string().trim().min(10).max(2000),
  goodFaithStatement: z.literal(true, { errorMap: () => ({ message: "You must state that you believe the removal was a mistake" }) }),
  signature: z.string().trim().min(2).max(120),
});

export function takedownsRouter(db: Db): Router {
  const router = Router();

  router.post("/", requireAuth, (req, res) => {
    const body = parse(noticeBody, req.body);
    const notice = fileNotice(db, currentUser(req).id, {
      listingId: body.listingId,
      workDescription: body.workDescription,
      originalUrl: body.originalUrl,
      signature: body.signature,
    });
    res.status(201).json({ notice });
  });

  router.get("/mine", requireAuth, (req, res) => {
    res.json({ notices: listByClaimant(db, currentUser(req).id).map(toNoticeView) });
  });

  router.get("/against-me", requireRole("artist"), (req, res) => {
    res.json({ notices: listAgainstArtist(db, currentUser(req).id).map(toNoticeView) });
  });

  router.get("/:id", requireAuth, (req, res) => {
    const user = currentUser(req);
    const { id } = parse(idParams, req.params);
    const notice = findNotice(db, id);
    const allowed =
      notice &&
      (notice.claimantUserId === user.id || notice.artistUserId === user.id || user.role === "moderator" || user.role === "admin");
    if (!notice || !allowed) throw new DomainError("not_found", "Notice not found");
    res.json({ notice: toNoticeView(notice) });
  });

  router.post("/:id/counter", requireRole("artist"), (req, res) => {
    const { id } = parse(idParams, req.params);
    const { statement, signature } = parse(counterBody, req.body);
    res.json({ notice: fileCounterNotice(db, currentUser(req).id, id, { statement, signature }) });
  });

  return router;
}
