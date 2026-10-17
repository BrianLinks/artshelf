import type { ErrorRequestHandler, RequestHandler } from "express";
import type { ZodTypeAny, z } from "zod";

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

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, "not_found", "Not found"));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
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
