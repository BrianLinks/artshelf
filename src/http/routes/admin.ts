import { Router } from "express";
import { z } from "zod";
import { recordAudit } from "../../auth/audit.js";
import { ROLES } from "../../auth/roles.js";
import { verifyLedger } from "../../ledger/ledger.js";
import { deleteUserSessions } from "../../auth/sessions.js";
import { setTier, TIERS } from "../../artists/profiles.js";
import { findById, listUsers, setDisabled, setRole } from "../../auth/users.js";
import type { Db } from "../../db/connection.js";
import { HttpError, parse } from "../errors.js";
import { currentUser, requireRole } from "../middleware.js";

const idParams = z.object({ id: z.coerce.number().int().positive() });
const roleBody = z.object({ role: z.enum(ROLES) });
const userIdParams = z.object({ userId: z.coerce.number().int().positive() });
const tierBody = z.object({ tier: z.enum(TIERS) });

export function adminRouter(db: Db): Router {
  const router = Router();
  router.use(requireRole("admin"));

  router.get("/users", (_req, res) => {
    res.json({ users: listUsers(db) });
  });

  router.patch("/users/:id/role", (req, res) => {
    const actor = currentUser(req);
    const { id } = parse(idParams, req.params);
    const { role } = parse(roleBody, req.body);
    if (id === actor.id) {
      throw new HttpError(409, "cannot_modify_self", "Admins cannot change their own role");
    }
    const target = findById(db, id);
    if (!target) throw new HttpError(404, "not_found", "User not found");
    if (target.role === role) {
      res.json({ user: target });
      return;
    }
    const updated = db.transaction(() => {
      const user = setRole(db, id, role);
      recordAudit(db, {
        actorUserId: actor.id,
        action: "user.role_changed",
        targetType: "user",
        targetId: id,
        detail: { from: target.role, to: role },
      });
      return user;
    })();
    res.json({ user: updated });
  });

  router.post("/users/:id/disable", (req, res) => {
    const actor = currentUser(req);
    const { id } = parse(idParams, req.params);
    if (id === actor.id) {
      throw new HttpError(409, "cannot_modify_self", "Admins cannot disable their own account");
    }
    if (!findById(db, id)) throw new HttpError(404, "not_found", "User not found");
    const updated = db.transaction(() => {
      const user = setDisabled(db, id, true);
      deleteUserSessions(db, id);
      recordAudit(db, { actorUserId: actor.id, action: "user.disabled", targetType: "user", targetId: id });
      return user;
    })();
    res.json({ user: updated });
  });

  router.post("/users/:id/enable", (req, res) => {
    const actor = currentUser(req);
    const { id } = parse(idParams, req.params);
    if (!findById(db, id)) throw new HttpError(404, "not_found", "User not found");
    const updated = db.transaction(() => {
      const user = setDisabled(db, id, false);
      recordAudit(db, { actorUserId: actor.id, action: "user.enabled", targetType: "user", targetId: id });
      return user;
    })();
    res.json({ user: updated });
  });

  router.patch("/artists/:userId/tier", (req, res) => {
    const actor = currentUser(req);
    const { userId } = parse(userIdParams, req.params);
    const { tier } = parse(tierBody, req.body);
    const profile = db.transaction(() => {
      const updated = setTier(db, userId, tier);
      recordAudit(db, {
        actorUserId: actor.id,
        action: "artist.tier_changed",
        targetType: "user",
        targetId: userId,
        detail: { tier },
      });
      return updated;
    })();
    res.json({ profile });
  });

  router.get("/ledger/verify", (_req, res) => {
    res.json(verifyLedger(db));
  });

  return router;
}
