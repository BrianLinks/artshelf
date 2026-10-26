import { LocalStorage } from "../assets/storage.js";
import { loadConfig } from "../config.js";
import { openDatabase } from "../db/connection.js";
import { migrate } from "../db/migrate.js";
import { DEMO_PASSWORD, seedDemoData } from "../seed/demo.js";

const config = loadConfig();
if (config.NODE_ENV === "production") {
  console.error("Refusing to create demo accounts with a known password when NODE_ENV=production.");
  process.exit(1);
}

const db = openDatabase(config.DATABASE_PATH);
migrate(db);
const summary = await seedDemoData(db, new LocalStorage(config.UPLOAD_DIR), config, process.env.DEMO_PASSWORD ?? DEMO_PASSWORD);

if (!summary.created) {
  console.log("Demo data is already present; nothing was changed.");
} else {
  console.log(`Created ${summary.listings} listings, ${summary.orders} orders, ${summary.reviews} reviews and ${summary.requests} request.`);
  console.log(`\nSign in with any of these (password: ${summary.password}):`);
  for (const account of summary.accounts) console.log(`  ${account.role.padEnd(9)} ${account.email}`);
  console.log("\nThen run: npm run reindex   (not needed for a fresh database)");
}
db.close();
