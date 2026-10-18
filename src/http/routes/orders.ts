import { Router, type Request } from "express";
import { z } from "zod";
import type { LocalStorage } from "../../assets/storage.js";
import type { Config } from "../../config.js";
import type { Db } from "../../db/connection.js";
import { DomainError } from "../../errors.js";
import { LICENSE_TYPES, LICENSES } from "../../licenses/definitions.js";
import { findOrder, listForArtist, listForBuyer, purchasedFile, toOrderView, type OrderRecord } from "../../orders/repo.js";
import { confirmOrder, openDispute, placeOrder, sellerRefund } from "../../orders/service.js";
import { parse } from "../errors.js";
import { currentUser, requireAuth, requireRole } from "../middleware.js";

const idParams = z.object({ id: z.coerce.number().int().positive() });
const purchaseBody = z.object({ listingId: z.number().int().positive(), license: z.enum(LICENSE_TYPES) });
const disputeBody = z.object({ reason: z.string().trim().min(1).max(1000) });

export function ordersRouter(db: Db, config: Config, storage: LocalStorage): Router {
  const router = Router();

  /** Buyer, artist, moderators and admins may view an order. Everyone else gets 404. */
  function loadViewable(req: Request): OrderRecord {
    const user = currentUser(req);
    const { id } = parse(idParams, req.params);
    const order = findOrder(db, id);
    const allowed =
      order &&
      (order.buyerUserId === user.id || order.artistUserId === user.id || user.role === "moderator" || user.role === "admin");
    if (!order || !allowed) throw new DomainError("not_found", "Order not found");
    return order;
  }

  router.post("/", requireRole("client", "artist"), (req, res) => {
    const input = parse(purchaseBody, req.body);
    res.status(201).json({ order: placeOrder(db, config, currentUser(req).id, input) });
  });

  router.get("/", requireAuth, (req, res) => {
    res.json({ orders: listForBuyer(db, currentUser(req).id).map(toOrderView) });
  });

  router.get("/sales", requireRole("artist"), (req, res) => {
    res.json({ orders: listForArtist(db, currentUser(req).id).map(toOrderView) });
  });

  router.get("/:id", requireAuth, (req, res) => {
    res.json({ order: toOrderView(loadViewable(req)) });
  });

  router.post("/:id/confirm", requireAuth, (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json({ order: confirmOrder(db, currentUser(req).id, id) });
  });

  router.post("/:id/dispute", requireAuth, (req, res) => {
    const { id } = parse(idParams, req.params);
    const { reason } = parse(disputeBody, req.body);
    res.json({ order: openDispute(db, currentUser(req).id, id, reason) });
  });

  router.post("/:id/refund", requireRole("artist"), (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json({ order: sellerRefund(db, currentUser(req).id, id) });
  });

  router.get("/:id/license", requireAuth, (req, res) => {
    const order = loadViewable(req);
    const user = currentUser(req);
    if (order.buyerUserId !== user.id && order.artistUserId !== user.id) throw new DomainError("not_found", "Order not found");
    res.json({
      orderId: order.id,
      valid: order.status !== "refunded",
      status: order.status,
      listingTitle: order.listingTitle,
      license: order.license,
      licenseName: LICENSES[order.license].name,
      allowedUses: LICENSES[order.license].allowedUses,
      priceCents: order.priceCents,
      grantedAt: order.createdAt,
      buyerUserId: order.buyerUserId,
      artistUserId: order.artistUserId,
    });
  });

  router.get("/:id/download", requireAuth, async (req, res) => {
    const user = currentUser(req);
    const { id } = parse(idParams, req.params);
    const order = findOrder(db, id);
    if (!order || order.buyerUserId !== user.id) throw new DomainError("not_found", "Order not found");
    if (order.status === "refunded") throw new DomainError("invalid_order_state", "This order was refunded");
    const file = purchasedFile(db, order.id);
    if (!file) throw new DomainError("not_found", "File not found");
    const data = await storage.read(file.storedName);
    res.setHeader("Content-Type", file.mime);
    res.setHeader("Content-Disposition", `attachment; filename="${file.originalName}"`);
    res.send(data);
  });

  return router;
}
