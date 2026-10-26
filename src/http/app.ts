import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express, { type Express } from "express";
import { LocalStorage } from "../assets/storage.js";
import type { Config } from "../config.js";
import type { Db } from "../db/connection.js";
import { errorHandler, notFound } from "./errors.js";
import { authenticate, sameOriginGuard, securityHeaders } from "./middleware.js";
import { adminRouter } from "./routes/admin.js";
import { artistsRouter } from "./routes/artists.js";
import { assetsRouter } from "./routes/assets.js";
import { authRouter } from "./routes/auth.js";
import { catalogRouter } from "./routes/catalog.js";
import { licensesRouter } from "./routes/licenses.js";
import { listingsRouter } from "./routes/listings.js";
import { moderationRouter } from "./routes/moderation.js";
import { notificationsRouter } from "./routes/notifications.js";
import { ordersRouter } from "./routes/orders.js";
import { requestsRouter } from "./routes/requests.js";
import { reviewsRouter } from "./routes/reviews.js";
import { royaltiesRouter } from "./routes/royalties.js";
import { searchRouter } from "./routes/search.js";
import { supportRouter } from "./routes/support.js";
import { takedownsRouter } from "./routes/takedowns.js";
import { walletRouter } from "./routes/wallet.js";

export function createApp(db: Db, config: Config): Express {
  const app = express();
  const storage = new LocalStorage(config.UPLOAD_DIR);
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(express.json({ limit: "16kb" }));
  app.use(sameOriginGuard);
  app.use(authenticate(db));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use("/api/auth", authRouter(db, config));
  app.use("/api/categories", catalogRouter(db));
  app.use("/api/licenses", licensesRouter());
  app.use("/api/artists", artistsRouter(db));
  app.use("/api/listings", listingsRouter(db, storage));
  app.use("/api/assets", assetsRouter(db, config, storage));
  app.use("/api/wallet", walletRouter(db));
  app.use("/api/orders", ordersRouter(db, config, storage));
  app.use("/api/requests", requestsRouter(db, config, storage));
  app.use("/api/royalties", royaltiesRouter(db));
  app.use("/api/search", searchRouter(db));
  app.use("/api/reviews", reviewsRouter(db));
  app.use("/api/support", supportRouter(db));
  app.use("/api/takedowns", takedownsRouter(db));
  app.use("/api/notifications", notificationsRouter(db));
  app.use("/api/moderation", moderationRouter(db));
  app.use("/api/admin", adminRouter(db));

  serveWebApp(app, config.WEB_DIST);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

/** Restricts what the page may load: only this site's own scripts, styles and images. */
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

/**
 * Serves the built web app (npm run web:build) when it exists. Unknown GET paths outside /api return index.html so
 * the single-page app can handle them; /api paths keep their JSON errors.
 */
function serveWebApp(app: Express, directory: string): void {
  const root = resolve(directory);
  const index = resolve(root, "index.html");
  if (!existsSync(index)) return;

  app.use((req, res, next) => {
    if (!req.path.startsWith("/api")) res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    next();
  });
  app.use(express.static(root, { index: false, dotfiles: "ignore", maxAge: "1h" }));
  app.use((req, res, next) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api")) return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(index);
  });
}
