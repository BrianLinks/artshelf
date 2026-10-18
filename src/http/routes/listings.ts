import { Router, type Request } from "express";
import { z } from "zod";
import { recordAudit } from "../../auth/audit.js";
import type { LocalStorage } from "../../assets/storage.js";
import type { Db } from "../../db/connection.js";
import { DomainError } from "../../errors.js";
import { isUseAllowed, LICENSE_TYPES, USES } from "../../licenses/definitions.js";
import { getRecord, getView, listByArtist, listPublic, SORTS, type ListingView } from "../../listings/repo.js";
import { createListing, publishListing, unpublishListing, updateListing } from "../../listings/service.js";
import { parse } from "../errors.js";
import { currentUser, requireRole } from "../middleware.js";

const tagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,29}$/, "Tags use lowercase letters, digits and hyphens (max 30 characters)");

const listingFields = {
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(""),
  basePriceCents: z.number().int().min(100).max(10_000_000),
  licenses: z
    .array(z.enum(LICENSE_TYPES))
    .min(1)
    .refine((values) => new Set(values).size === values.length, "Licenses must be unique"),
  tags: z
    .array(tagSchema)
    .max(10)
    .default([])
    .transform((values) => [...new Set(values)]),
};
const createBody = z.object({ assetId: z.number().int().positive(), ...listingFields });
const updateBody = z.object(listingFields);

const idParams = z.object({ id: z.coerce.number().int().positive() });
const listQuery = z.object({
  category: z.string().min(1).max(60).optional(),
  license: z.enum(LICENSE_TYPES).optional(),
  minPriceCents: z.coerce.number().int().min(0).optional(),
  maxPriceCents: z.coerce.number().int().min(0).optional(),
  tag: tagSchema.optional(),
  artist: z.coerce.number().int().positive().optional(),
  sort: z.enum(SORTS).default("newest"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
const checkQuery = z.object({ license: z.enum(LICENSE_TYPES), use: z.enum(USES) });

export function listingsRouter(db: Db, storage: LocalStorage): Router {
  const router = Router();

  /** Public listings are open to everyone. Drafts and removed listings are visible to the owner, moderators and admins. */
  function loadVisible(req: Request): ListingView {
    const { id } = parse(idParams, req.params);
    const listing = getView(db, id);
    const viewer = req.user;
    const privileged =
      viewer !== undefined &&
      (viewer.id === listing?.artist.userId || viewer.role === "moderator" || viewer.role === "admin");
    if (!listing || (!listing.publiclyVisible && !privileged)) throw new DomainError("not_found", "Listing not found");
    return listing;
  }

  router.get("/", (req, res) => {
    const query = parse(listQuery, req.query);
    const { listings, total } = listPublic(db, query);
    res.json({ listings, total, limit: query.limit, offset: query.offset });
  });

  router.get("/mine", requireRole("artist"), (req, res) => {
    res.json({ listings: listByArtist(db, currentUser(req).id) });
  });

  router.post("/", requireRole("artist"), (req, res) => {
    const user = currentUser(req);
    const input = parse(createBody, req.body);
    const listing = db.transaction(() => {
      const created = createListing(db, user.id, input);
      recordAudit(db, { actorUserId: user.id, action: "listing.created", targetType: "listing", targetId: created.id });
      return created;
    })();
    res.status(201).json({ listing });
  });

  router.get("/:id", (req, res) => {
    res.json({ listing: loadVisible(req) });
  });

  router.put("/:id", requireRole("artist"), (req, res) => {
    const user = currentUser(req);
    const { id } = parse(idParams, req.params);
    const input = parse(updateBody, req.body);
    res.json({ listing: updateListing(db, user.id, id, input) });
  });

  router.post("/:id/publish", requireRole("artist"), (req, res) => {
    const user = currentUser(req);
    const { id } = parse(idParams, req.params);
    const listing = db.transaction(() => {
      const published = publishListing(db, user.id, id);
      recordAudit(db, { actorUserId: user.id, action: "listing.published", targetType: "listing", targetId: id });
      return published;
    })();
    res.json({ listing });
  });

  router.post("/:id/unpublish", requireRole("artist"), (req, res) => {
    const user = currentUser(req);
    const { id } = parse(idParams, req.params);
    const listing = db.transaction(() => {
      const unpublished = unpublishListing(db, user.id, id);
      recordAudit(db, { actorUserId: user.id, action: "listing.unpublished", targetType: "listing", targetId: id });
      return unpublished;
    })();
    res.json({ listing });
  });

  router.get("/:id/preview", async (req, res) => {
    const listing = loadVisible(req);
    const thumbName = getRecord(db, listing.id)?.thumbName;
    if (!thumbName) throw new DomainError("not_found", "This listing has no preview");
    const data = await storage.read(thumbName);
    res.setHeader("Content-Type", "image/webp");
    res.send(data);
  });

  router.get("/:id/license-check", (req, res) => {
    const listing = loadVisible(req);
    const { license, use } = parse(checkQuery, req.query);
    const offered = listing.licenses.some((entry) => entry.license === license);
    const allowed = offered && isUseAllowed(license, use);
    res.json({ listingId: listing.id, license, use, offered, allowed });
  });

  return router;
}
