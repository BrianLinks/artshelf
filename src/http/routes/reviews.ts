import { Router } from "express";
import { z } from "zod";
import type { Db } from "../../db/connection.js";
import { artistRating } from "../../reviews/stats.js";
import {
  createReview,
  FLAG_REASONS,
  flagReview,
  getReviewFor,
  listPublicReviews,
  listReviewable,
  updateReview,
} from "../../reviews/service.js";
import { parse } from "../errors.js";
import { currentUser, requireAuth } from "../middleware.js";

const idParams = z.object({ id: z.coerce.number().int().positive() });
const ratingField = z.number().int().min(1).max(5);
const commentField = z.string().trim().max(2000).default("");
const createBody = z
  .object({
    orderId: z.number().int().positive().optional(),
    requestId: z.number().int().positive().optional(),
    rating: ratingField,
    comment: commentField,
  })
  .refine((value) => (value.orderId === undefined) !== (value.requestId === undefined), "Provide exactly one of orderId or requestId");
const updateBody = z.object({ rating: ratingField, comment: commentField });
const flagBody = z.object({ reason: z.enum(FLAG_REASONS), note: z.string().trim().max(500).default("") });
const listQuery = z
  .object({
    artist: z.coerce.number().int().positive().optional(),
    listing: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((value) => value.artist !== undefined || value.listing !== undefined, "Provide artist or listing");

export function reviewsRouter(db: Db): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const query = parse(listQuery, req.query);
    res.json({ ...listPublicReviews(db, query), limit: query.limit, offset: query.offset });
  });

  router.get("/artist/:id/rating", (req, res) => {
    const { id } = parse(idParams, req.params);
    res.json({ rating: artistRating(db, id) });
  });

  router.get("/reviewable", requireAuth, (req, res) => {
    res.json(listReviewable(db, currentUser(req).id));
  });

  router.post("/", requireAuth, (req, res) => {
    const input = parse(createBody, req.body);
    res.status(201).json({ review: createReview(db, currentUser(req).id, input) });
  });

  router.get("/:id", (req, res) => {
    const { id } = parse(idParams, req.params);
    const viewer = req.user;
    const isStaff = viewer?.role === "moderator" || viewer?.role === "admin";
    res.json({ review: getReviewFor(db, viewer?.id ?? 0, isStaff, id) });
  });

  router.put("/:id", requireAuth, (req, res) => {
    const { id } = parse(idParams, req.params);
    const input = parse(updateBody, req.body);
    res.json({ review: updateReview(db, currentUser(req).id, id, input) });
  });

  router.post("/:id/flag", requireAuth, (req, res) => {
    const { id } = parse(idParams, req.params);
    const input = parse(flagBody, req.body);
    flagReview(db, currentUser(req).id, id, input);
    res.status(201).json({ flagged: true });
  });

  return router;
}
