import { Router } from "express";
import { z } from "zod";
import { recordAudit } from "../../auth/audit.js";
import { getProfile, listApproved, TIERS, upsertProfile } from "../../artists/profiles.js";
import type { Db } from "../../db/connection.js";
import { DomainError } from "../../errors.js";
import { parse } from "../errors.js";
import { currentUser, requireRole } from "../middleware.js";

const profileBody = z.object({
  bio: z.string().trim().min(1).max(2000),
  specialty: z.string().min(1).max(60),
});
const listQuery = z.object({
  category: z.string().min(1).max(60).optional(),
  tier: z.enum(TIERS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
const userIdParams = z.object({ userId: z.coerce.number().int().positive() });

export function artistsRouter(db: Db): Router {
  const router = Router();

  router.put("/me", requireRole("artist"), (req, res) => {
    const user = currentUser(req);
    const input = parse(profileBody, req.body);
    const profile = upsertProfile(db, user.id, input);
    recordAudit(db, { actorUserId: user.id, action: "artist.profile_saved", targetType: "user", targetId: user.id });
    res.json({ profile });
  });

  router.get("/me", requireRole("artist"), (req, res) => {
    const profile = getProfile(db, currentUser(req).id);
    if (!profile) throw new DomainError("not_found", "You have not created a profile yet");
    res.json({ profile });
  });

  router.get("/", (req, res) => {
    const query = parse(listQuery, req.query);
    res.json({ artists: listApproved(db, query) });
  });

  router.get("/:userId", (req, res) => {
    const { userId } = parse(userIdParams, req.params);
    const profile = getProfile(db, userId);
    const viewer = req.user;
    const privileged = viewer !== undefined && (viewer.id === userId || viewer.role === "moderator" || viewer.role === "admin");
    if (!profile || (profile.status !== "approved" && !privileged)) {
      throw new DomainError("not_found", "Artist not found");
    }
    res.json({ profile });
  });

  return router;
}
