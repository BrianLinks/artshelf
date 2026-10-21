import { Router } from "express";
import { z } from "zod";
import type { Db } from "../../db/connection.js";
import { LICENSE_TYPES } from "../../licenses/definitions.js";
import { parseHex } from "../../search/color.js";
import { SEARCH_SORTS, searchListings } from "../../search/service.js";
import { parse } from "../errors.js";

const query = z
  .object({
    q: z.string().trim().max(100).optional(),
    color: z
      .string()
      .trim()
      .refine((value) => parseHex(value) !== undefined, "Use a hex color such as ff0000 or #f00")
      .optional(),
    similarTo: z.coerce.number().int().positive().optional(),
    category: z.string().min(1).max(60).optional(),
    license: z.enum(LICENSE_TYPES).optional(),
    minPriceCents: z.coerce.number().int().min(0).optional(),
    maxPriceCents: z.coerce.number().int().min(0).optional(),
    tag: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9-]{0,29}$/)
      .optional(),
    artist: z.coerce.number().int().positive().optional(),
    sort: z.enum(SEARCH_SORTS).default("relevance"),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((value) => value.color === undefined || value.similarTo === undefined, "Use color or similarTo, not both");

export function searchRouter(db: Db): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const { color, q, ...rest } = parse(query, req.query);
    const result = searchListings(db, {
      ...rest,
      q: q === "" ? undefined : q, // an empty box means "browse everything"
      color: color === undefined ? undefined : parseHex(color),
    });
    res.json({ ...result, limit: rest.limit, offset: rest.offset });
  });

  return router;
}
