import express, { Router, type Request } from "express";
import { z } from "zod";
import { findAsset, deleteAsset, listAssetsByOwner, toPublicAsset, type AssetRecord } from "../../assets/repo.js";
import { uploadAsset } from "../../assets/service.js";
import type { LocalStorage } from "../../assets/storage.js";
import { getProfile } from "../../artists/profiles.js";
import { findListingByAsset } from "../../listings/repo.js";
import { assetDelivered } from "../../requests/repo.js";
import type { Config } from "../../config.js";
import type { Db } from "../../db/connection.js";
import { DomainError } from "../../errors.js";
import { HttpError, parse } from "../errors.js";
import { currentUser, requireAuth, requireRole } from "../middleware.js";

const uploadQuery = z.object({
  category: z.string().min(1).max(60),
  filename: z.string().min(1).max(255),
});
const idParams = z.object({ id: z.coerce.number().int().positive() });

export function assetsRouter(db: Db, config: Config, storage: LocalStorage): Router {
  const router = Router();

  /** Owners, moderators and admins may view an asset. Everyone else gets a 404, so ids do not leak. */
  function loadViewable(req: Request): AssetRecord {
    const user = currentUser(req);
    const { id } = parse(idParams, req.params);
    const asset = findAsset(db, id);
    const allowed = asset && (asset.ownerUserId === user.id || user.role === "moderator" || user.role === "admin");
    if (!asset || !allowed) throw new DomainError("not_found", "Asset not found");
    return asset;
  }

  router.post(
    "/",
    requireRole("artist"),
    express.raw({ type: "application/octet-stream", limit: config.MAX_UPLOAD_MB * 1024 * 1024 }),
    async (req, res) => {
      if (!req.headers["content-type"]?.startsWith("application/octet-stream")) {
        throw new HttpError(415, "unsupported_media_type", "Send the file as application/octet-stream");
      }
      const user = currentUser(req);
      const { category, filename } = parse(uploadQuery, req.query);
      if (!getProfile(db, user.id)) {
        throw new HttpError(409, "profile_required", "Create your artist profile before uploading");
      }
      const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const asset = await uploadAsset({ db, storage, config }, { ownerId: user.id, categorySlug: category, filename, data });
      res.status(201).json({ asset: toPublicAsset(asset) });
    },
  );

  router.get("/", requireAuth, (req, res) => {
    res.json({ assets: listAssetsByOwner(db, currentUser(req).id).map(toPublicAsset) });
  });

  router.get("/:id", requireAuth, (req, res) => {
    res.json({ asset: toPublicAsset(loadViewable(req)) });
  });

  router.get("/:id/file", requireAuth, async (req, res) => {
    const asset = loadViewable(req);
    const data = await storage.read(asset.storedName);
    const inline = asset.mime.startsWith("image/");
    res.setHeader("Content-Type", asset.mime);
    res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${asset.originalName}"`);
    res.send(data);
  });

  router.get("/:id/thumbnail", requireAuth, async (req, res) => {
    const asset = loadViewable(req);
    if (!asset.thumbName) throw new DomainError("not_found", "This asset has no thumbnail");
    const data = await storage.read(asset.thumbName);
    res.setHeader("Content-Type", "image/webp");
    res.send(data);
  });

  router.delete("/:id", requireAuth, async (req, res) => {
    const user = currentUser(req);
    const asset = loadViewable(req);
    if (asset.ownerUserId !== user.id && user.role !== "admin") {
      throw new HttpError(403, "forbidden", "Insufficient permissions");
    }
    if (findListingByAsset(db, asset.id) || assetDelivered(db, asset.id)) {
      throw new DomainError("asset_in_use", "This asset is used by a listing or a commission delivery");
    }
    deleteAsset(db, asset.id);
    await storage.remove(asset.storedName);
    if (asset.thumbName) await storage.remove(asset.thumbName);
    res.status(204).end();
  });

  return router;
}
