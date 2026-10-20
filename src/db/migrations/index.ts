import type { Migration } from "../migrate.js";
import { migration001 } from "./001_init.js";
import { migration002 } from "./002_catalog.js";
import { migration003 } from "./003_listings.js";
import { migration004 } from "./004_orders_ledger.js";
import { migration005 } from "./005_requests.js";
import { migration006 } from "./006_reviews_support.js";

export const MIGRATIONS: readonly Migration[] = [migration001, migration002, migration003, migration004, migration005, migration006];
