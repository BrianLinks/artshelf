import { Router } from "express";
import { z } from "zod";
import type { Db } from "../../db/connection.js";
import { artistStatement } from "../../royalties/statement.js";
import { HttpError, parse } from "../errors.js";
import { currentUser, requireRole } from "../middleware.js";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => {
    const time = Date.parse(`${value}T00:00:00.000Z`);
    return !Number.isNaN(time) && new Date(time).toISOString().startsWith(value);
  }, "Not a real date");

const query = z
  .object({
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    artistId: z.coerce.number().int().positive().optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, "from must not be after to");

export function royaltiesRouter(db: Db): Router {
  const router = Router();

  router.get("/", requireRole("artist", "admin"), (req, res) => {
    const user = currentUser(req);
    const { from, to, artistId } = parse(query, req.query);
    let target: number;
    if (user.role === "admin") {
      if (artistId === undefined) throw new HttpError(400, "artist_id_required", "Admins must pass artistId");
      target = artistId;
    } else {
      if (artistId !== undefined && artistId !== user.id) {
        throw new HttpError(403, "forbidden", "Insufficient permissions");
      }
      target = user.id;
    }
    res.json({ statement: artistStatement(db, target, { from, to }) });
  });

  return router;
}
