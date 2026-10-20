import { Router } from "express";
import { z } from "zod";
import type { Db } from "../../db/connection.js";
import { listNotifications, markAllRead, markRead } from "../../notifications/notifications.js";
import { parse } from "../errors.js";
import { currentUser, requireAuth } from "../middleware.js";

const idParams = z.object({ id: z.coerce.number().int().positive() });
const listQuery = z.object({
  unread: z.enum(["true", "false"]).default("false"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export function notificationsRouter(db: Db): Router {
  const router = Router();
  router.use(requireAuth);

  router.get("/", (req, res) => {
    const query = parse(listQuery, req.query);
    res.json(listNotifications(db, currentUser(req).id, { unreadOnly: query.unread === "true", limit: query.limit, offset: query.offset }));
  });

  router.post("/read-all", (req, res) => {
    res.json({ marked: markAllRead(db, currentUser(req).id) });
  });

  router.post("/:id/read", (req, res) => {
    const { id } = parse(idParams, req.params);
    markRead(db, currentUser(req).id, id);
    res.status(204).end();
  });

  return router;
}
