import express, { type Express } from "express";
import type { Config } from "../config.js";
import type { Db } from "../db/connection.js";
import { errorHandler, notFound } from "./errors.js";
import { authenticate, sameOriginGuard, securityHeaders } from "./middleware.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";

export function createApp(db: Db, config: Config): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(express.json({ limit: "16kb" }));
  app.use(sameOriginGuard);
  app.use(authenticate(db));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use("/api/auth", authRouter(db, config));
  app.use("/api/admin", adminRouter(db));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
