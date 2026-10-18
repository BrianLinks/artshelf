import type { ErrorRequestHandler, RequestHandler } from "express";
import type { ZodTypeAny, z } from "zod";
import { DomainError } from "../errors.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Validates untrusted input at the boundary. Throws a 400 HttpError listing every problem. */
export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(
      400,
      "validation_error",
      "Invalid request",
      result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  return result.data;
}

const DOMAIN_STATUS: Record<string, number> = {
  not_found: 404,
  unknown_category: 400,
  empty_file: 400,
  too_large: 413,
  quota_exceeded: 413,
  unsupported_type: 415,
  type_not_allowed: 415,
  invalid_image: 422,
  duplicate_asset: 409,
  invalid_transition: 409,
  profile_required: 409,
  profile_not_approved: 409,
  invalid_asset: 400,
  asset_already_listed: 409,
  asset_in_use: 409,
  invalid_listing_state: 409,
  listing_unavailable: 409,
  cannot_buy_own_listing: 409,
  license_not_offered: 400,
  already_purchased: 409,
  insufficient_funds: 402,
  invalid_order_state: 409,
};

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, "not_found", "Not found"));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof DomainError) {
    res.status(DOMAIN_STATUS[err.code] ?? 400).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (typeof err === "object" && err !== null && "status" in err && err.status === 413) {
    res.status(413).json({ error: { code: "payload_too_large", message: "Request body too large" } });
    return;
  }
  if (typeof err === "object" && err !== null && "status" in err && typeof err.status === "number") {
    if (err.status >= 400 && err.status < 500) {
      res.status(err.status).json({ error: { code: "bad_request", message: "Malformed request" } });
      return;
    }
  }
  console.error(err);
  res.status(500).json({ error: { code: "internal_error", message: "Internal server error" } });
};
