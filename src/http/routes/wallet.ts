import { Router } from "express";
import { z } from "zod";
import type { Db } from "../../db/connection.js";
import { deposit, walletSummary } from "../../ledger/wallet.js";
import { parse } from "../errors.js";
import { currentUser, requireRole } from "../middleware.js";

const depositBody = z.object({ amountCents: z.number().int().min(100).max(1_000_000) });

export function walletRouter(db: Db): Router {
  const router = Router();
  router.use(requireRole("client", "artist"));

  router.get("/", (req, res) => {
    res.json(walletSummary(db, currentUser(req).id));
  });

  router.post("/deposit", (req, res) => {
    const user = currentUser(req);
    const { amountCents } = parse(depositBody, req.body);
    const balanceCents = deposit(db, user.id, amountCents);
    res.status(201).json({ balanceCents, simulated: true });
  });

  return router;
}
