import { deleteExpiredSessions } from "./auth/sessions.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/connection.js";
import { migrate } from "./db/migrate.js";
import { createApp } from "./http/app.js";
import { releaseDueEscrows } from "./orders/service.js";

const config = loadConfig();
const db = openDatabase(config.DATABASE_PATH);
const applied = migrate(db);
if (applied.length > 0) console.log(`Applied migrations: ${applied.join(", ")}`);

const app = createApp(db, config);
const server = app.listen(config.PORT, () => {
  console.log(`ArtShelf listening on http://localhost:${config.PORT}`);
});

const hourly = (): void => {
  deleteExpiredSessions(db);
  const released = releaseDueEscrows(db);
  if (released > 0) console.log(`Auto-released ${released} escrowed order(s)`);
};
hourly();
const cleanup = setInterval(hourly, 60 * 60 * 1000);
cleanup.unref();

function shutdown(): void {
  clearInterval(cleanup);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
