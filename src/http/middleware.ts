import type { Request, RequestHandler } from "express";
import { hasRole, type Role } from "../auth/roles.js";
import { resolveSession } from "../auth/sessions.js";
import type { User } from "../auth/users.js";
import type { Db } from "../db/connection.js";
import { parseCookies, SESSION_COOKIE } from "./cookies.js";
import { HttpError } from "./errors.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: User;
  }
}

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Rejects state-changing requests whose Origin header names a different host. Complements SameSite=Lax cookies. */
export const sameOriginGuard: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.headers.origin;
  if (origin === undefined) return next();
  let originHost: string | null;
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = null;
  }
  if (originHost !== req.headers.host) {
    return next(new HttpError(403, "cross_origin", "Cross-origin request rejected"));
  }
  next();
};

/** Attaches req.user when the request carries a valid session cookie. Never rejects. */
export function authenticate(db: Db): RequestHandler {
  return (req, _res, next) => {
    const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
    if (token) req.user = resolveSession(db, token);
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, "unauthenticated", "Sign in required"));
  next();
};

export function requireRole(...allowed: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, "unauthenticated", "Sign in required"));
    if (!hasRole(req.user.role, allowed)) return next(new HttpError(403, "forbidden", "Insufficient permissions"));
    next();
  };
}

/** For handlers behind requireAuth/requireRole: returns the signed-in user or throws 401. */
export function currentUser(req: Request): User {
  if (!req.user) throw new HttpError(401, "unauthenticated", "Sign in required");
  return req.user;
}
