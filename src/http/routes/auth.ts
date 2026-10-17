import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { recordAudit } from "../../auth/audit.js";
import { hashPassword, makeDummyHash, passwordSchema, verifyPassword } from "../../auth/password.js";
import { SELF_REGISTERABLE_ROLES } from "../../auth/roles.js";
import { createSession, deleteSession } from "../../auth/sessions.js";
import { createUser, EmailTakenError, findCredentialsByEmail } from "../../auth/users.js";
import type { Config } from "../../config.js";
import type { Db } from "../../db/connection.js";
import { clearSessionCookie, parseCookies, SESSION_COOKIE, setSessionCookie } from "../cookies.js";
import { HttpError, parse } from "../errors.js";
import { currentUser, requireAuth } from "../middleware.js";

const emailSchema = z.string().trim().toLowerCase().email().max(254);

const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(80),
  role: z.enum(SELF_REGISTERABLE_ROLES).default("client"),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export function authRouter(db: Db, config: Config): Router {
  const router = Router();
  const secure = config.NODE_ENV === "production";
  const dummyHash = makeDummyHash(config.BCRYPT_ROUNDS);

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.LOGIN_RATE_LIMIT_MAX,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: "rate_limited", message: "Too many attempts, try again later" } });
    },
  });

  router.post("/register", limiter, async (req, res) => {
    const input = parse(registerSchema, req.body);
    const passwordHash = await hashPassword(input.password, config.BCRYPT_ROUNDS);
    let user;
    try {
      user = createUser(db, {
        email: input.email,
        passwordHash,
        displayName: input.displayName,
        role: input.role,
      });
    } catch (error) {
      if (error instanceof EmailTakenError) {
        throw new HttpError(409, "email_taken", "That email is already registered");
      }
      throw error;
    }
    recordAudit(db, { actorUserId: user.id, action: "user.register", targetType: "user", targetId: user.id });
    const session = createSession(db, user.id, config.SESSION_TTL_HOURS);
    setSessionCookie(res, session.token, config.SESSION_TTL_HOURS, secure);
    res.status(201).json({ user });
  });

  router.post("/login", limiter, async (req, res) => {
    const input = parse(loginSchema, req.body);
    const found = findCredentialsByEmail(db, input.email);
    const passwordOk = await verifyPassword(input.password, found?.passwordHash ?? dummyHash);
    if (!found || !passwordOk || found.user.disabledAt !== null) {
      recordAudit(db, { actorUserId: null, action: "auth.login_failed" });
      throw new HttpError(401, "invalid_credentials", "Invalid email or password");
    }
    const session = createSession(db, found.user.id, config.SESSION_TTL_HOURS);
    setSessionCookie(res, session.token, config.SESSION_TTL_HOURS, secure);
    recordAudit(db, { actorUserId: found.user.id, action: "auth.login" });
    res.json({ user: found.user });
  });

  router.post("/logout", (req, res) => {
    const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
    if (token) deleteSession(db, token);
    clearSessionCookie(res, secure);
    res.status(204).end();
  });

  router.get("/me", requireAuth, (req, res) => {
    res.json({ user: currentUser(req) });
  });

  return router;
}
