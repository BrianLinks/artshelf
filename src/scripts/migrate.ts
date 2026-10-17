import { loadConfig } from "../config.js";
import { openDatabase } from "../db/connection.js";
import { migrate } from "../db/migrate.js";

const config = loadConfig();
const db = openDatabase(config.DATABASE_PATH);
const applied = migrate(db);
console.log(applied.length > 0 ? `Applied migrations: ${applied.join(", ")}` : "Database is up to date");
db.close();
