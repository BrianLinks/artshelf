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
import { ordersRouter } from "./routes/orders.js";
import { royaltiesRouter } from "./routes/royalties.js";
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
  app.use("/api/royalties", royaltiesRouter(db));
  app.use("/api/moderation", moderationRouter(db));
  app.use("/api/admin", adminRouter(db));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
