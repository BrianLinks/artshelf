import { LocalStorage } from "../assets/storage.js";
import { loadConfig } from "../config.js";
import { openDatabase } from "../db/connection.js";
import { migrate } from "../db/migrate.js";
import { backfillPalettes, rebuildSearchIndex } from "../search/indexer.js";

const config = loadConfig();
const db = openDatabase(config.DATABASE_PATH);
migrate(db);
const listings = rebuildSearchIndex(db);
const palettes = await backfillPalettes(db, new LocalStorage(config.UPLOAD_DIR));
console.log(`Indexed ${listings} listing(s) and added ${palettes} palette(s)`);
db.close();
